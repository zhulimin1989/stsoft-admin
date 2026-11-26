import { CallHandler, ExecutionContext } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable, of, throwError, lastValueFrom } from 'rxjs';
import { MetricsInterceptor } from './metrics.interceptor';
import { registry } from './metrics.registry';

function ctx(opts: {
  method?: string;
  url?: string;
  routerPath?: string;
  statusCode?: number;
}): ExecutionContext {
  const req = {
    method: opts.method ?? 'GET',
    url: opts.url ?? '/api/thing',
    routerPath: opts.routerPath,
  };
  const reply = { statusCode: opts.statusCode ?? 200 };
  return {
    switchToHttp: () => ({
      getRequest: <T = FastifyRequest>() => req as unknown as T,
      getResponse: <T = FastifyReply>() => reply as unknown as T,
    }),
  } as unknown as ExecutionContext;
}

describe('MetricsInterceptor', () => {
  const interceptor = new MetricsInterceptor();

  async function run(
    context: ExecutionContext,
    handler: CallHandler,
  ): Promise<void> {
    const observable = interceptor.intercept(context, handler);
    await lastValueFrom(observable).catch(() => {});
  }

  const handlerOf = (observable: Observable<unknown>): CallHandler => ({
    handle: () => observable,
  });

  function countFor(method: string, route: string, statusClass: string): Promise<number> {
    return registry
      .getSingleMetricAsString('ruidong_http_requests_total')
      .then((text) => {
        // Find the matching sample line and parse its count.
        const pattern = new RegExp(
          `ruidong_http_requests_total\\{method="${method}",route="${route}",status_class="${statusClass}"\\}\\s+(\\S+)`,
        );
        const match = text.match(pattern);
        return match ? Number(match[1]) : 0;
      });
  }

  it('increments counter for successful request with matched route pattern', async () => {
    const before = await countFor('GET', '/api/user/:id', '2xx');

    await run(
      ctx({ method: 'GET', routerPath: '/api/user/:id', statusCode: 200 }),
      handlerOf(of('result')),
    );

    const after = await countFor('GET', '/api/user/:id', '2xx');
    expect(after).toBe(before + 1);
  });

  it('classifies 4xx and 5xx status codes', async () => {
    const before5xx = await countFor('POST', '/api/err', '5xx');

    await run(
      ctx({ method: 'POST', routerPath: '/api/err', statusCode: 500 }),
      handlerOf(of(null)),
    );

    const after5xx = await countFor('POST', '/api/err', '5xx');
    expect(after5xx).toBe(before5xx + 1);
  });

  it('records errors with status from the thrown exception', async () => {
    const before = await countFor('POST', '/api/broken', '4xx');

    await run(
      ctx({ method: 'POST', routerPath: '/api/broken', statusCode: 200 }),
      handlerOf(throwError(() => ({ status: 404 }))),
    );

    const after = await countFor('POST', '/api/broken', '4xx');
    expect(after).toBe(before + 1);
  });

  it('defaults to 500 when thrown error has no status', async () => {
    const before = await countFor('GET', '/api/boom', '5xx');

    await run(
      ctx({ method: 'GET', routerPath: '/api/boom' }),
      handlerOf(throwError(() => new Error('weird'))),
    );

    const after = await countFor('GET', '/api/boom', '5xx');
    expect(after).toBe(before + 1);
  });

  it('skips /metrics to avoid scrape self-observation loop', async () => {
    const metricsText = await registry.getSingleMetricAsString('ruidong_http_requests_total');
    const skippedRouteAbsent = !metricsText.match(/route="\/metrics"/);
    // Process one metrics-path request.
    await run(
      ctx({ method: 'GET', url: '/metrics', statusCode: 200 }),
      handlerOf(of('# HELP ...')),
    );
    const metricsText2 = await registry.getSingleMetricAsString('ruidong_http_requests_total');
    const stillAbsent = !metricsText2.match(/route="\/metrics"/);
    expect(skippedRouteAbsent).toBe(true);
    expect(stillAbsent).toBe(true);
  });

  it('falls back to URL path when no routerPath matched (e.g. 404)', async () => {
    const before = await countFor('GET', '/api/nope', '4xx');

    await run(
      ctx({ method: 'GET', url: '/api/nope?trace=1', statusCode: 404 }),
      handlerOf(of(null)),
    );

    const after = await countFor('GET', '/api/nope', '4xx');
    expect(after).toBe(before + 1);
  });

  it('observes a duration histogram entry', async () => {
    await run(
      ctx({ method: 'GET', routerPath: '/api/timed', statusCode: 200 }),
      handlerOf(of('ok')),
    );
    const histogramText = await registry.getSingleMetricAsString(
      'ruidong_http_request_duration_seconds',
    );
    expect(histogramText).toContain('/api/timed');
    expect(histogramText).toContain('status_class="2xx"');
  });
});
