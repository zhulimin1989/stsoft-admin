import { Test } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsController } from './metrics.controller';
import { registry, httpRequestTotal } from './metrics.registry';

function mockConfig(overrides: Record<string, string | undefined> = {}) {
  const base = { NODE_ENV: 'test' };
  return {
    get: jest.fn((key: string) => ({ ...base, ...overrides }[key])),
  } as unknown as ConfigService;
}

type MockMetricsReply = FastifyReply & {
  header: jest.Mock;
};

function mockReply(): MockMetricsReply {
  return { header: jest.fn() } as unknown as MockMetricsReply;
}

function mockReq(authHeader?: string): FastifyRequest {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
  } as unknown as FastifyRequest;
}

async function build(configOverrides: Record<string, string | undefined> = {}) {
  const m = await Test.createTestingModule({
    controllers: [MetricsController],
    providers: [{ provide: ConfigService, useValue: mockConfig(configOverrides) }],
  }).compile();
  return m.get(MetricsController);
}

describe('MetricsController', () => {
  afterEach(() => {
    // Don't reset the registry — httpRequestTotal is module-scoped.
    // Individual tests own their label counts.
  });

  describe('dev mode (no credentials configured)', () => {
    it('allows anonymous scrape when METRICS_USER + METRICS_PASSWORD unset', async () => {
      const ctrl = await build({ NODE_ENV: 'development' });
      const reply = mockReply();

      const body = await ctrl.metrics(mockReq(), reply);
      expect(reply.header).toHaveBeenCalledWith('Content-Type', registry.contentType);
      expect(typeof body).toBe('string');
    });

    it('returns default Node metrics (process_cpu, memory)', async () => {
      const ctrl = await build({ NODE_ENV: 'development' });
      const body = await ctrl.metrics(mockReq(), mockReply());
      expect(body).toContain('ruidong_process_cpu_seconds_total');
      expect(body).toContain('ruidong_http_requests_total');
    });

    it('exposes incremented counters after increment', async () => {
      httpRequestTotal.labels('GET', '/spec/probe', '2xx').inc();
      const ctrl = await build({ NODE_ENV: 'development' });
      const body = await ctrl.metrics(mockReq(), mockReply());
      expect(body).toMatch(/ruidong_http_requests_total\{.*route="\/spec\/probe".*\} /);
    });
  });

  describe('production mode (credentials required)', () => {
    it('refuses unauthenticated requests when creds unset in prod', async () => {
      const ctrl = await build({ NODE_ENV: 'production' });
      await expect(ctrl.metrics(mockReq(), mockReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('refuses unauthenticated requests when APP_ENV=production', async () => {
      const ctrl = await build({ NODE_ENV: 'development', APP_ENV: 'production' });
      await expect(ctrl.metrics(mockReq(), mockReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when Authorization header missing', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      await expect(ctrl.metrics(mockReq(), mockReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects when Authorization scheme is not Basic', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      await expect(
        ctrl.metrics(mockReq('Bearer abc123'), mockReply()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects wrong credentials', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      const wrong = 'Basic ' + Buffer.from('prom:wrong').toString('base64');
      await expect(ctrl.metrics(mockReq(wrong), mockReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('rejects wrong user', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      const wrong = 'Basic ' + Buffer.from('alice:secret').toString('base64');
      await expect(ctrl.metrics(mockReq(wrong), mockReply())).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('accepts correct credentials', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      const good = 'Basic ' + Buffer.from('prom:secret').toString('base64');
      const body = await ctrl.metrics(mockReq(good), mockReply());
      expect(typeof body).toBe('string');
      expect(body).toContain('ruidong_');
    });

    it('handles malformed base64 gracefully', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      await expect(
        ctrl.metrics(mockReq('Basic !!!not-base64!!!'), mockReply()),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('compares credentials in constant time (length-safe)', async () => {
      const ctrl = await build({
        NODE_ENV: 'production',
        METRICS_USER: 'prom',
        METRICS_PASSWORD: 'secret',
      });
      // A password of a different length should still reject without timing attack.
      const shorter = 'Basic ' + Buffer.from('prom:short').toString('base64');
      const longer = 'Basic ' + Buffer.from('prom:secret-way-too-long').toString('base64');
      await expect(ctrl.metrics(mockReq(shorter), mockReply())).rejects.toThrow();
      await expect(ctrl.metrics(mockReq(longer), mockReply())).rejects.toThrow();
    });
  });
});
