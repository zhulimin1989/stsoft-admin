import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RedisService } from '../../redis/redis.service';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';

/**
 * Global security plugins for the Fastify adapter.
 *
 * Kept as a plain function (not a Nest module) so it can be composed in
 * main.ts next to the existing cookie/CORS/CSRF registrations, and so it
 * can be unit-tested against a bare Fastify instance without booting Nest.
 */

export interface SecurityOptions {
  /** ioredis-compatible client for the rate-limit store. Missing → in-memory store (single-instance only). */
  redis?: RedisService;
  /**
   * Ceiling for anonymous IPs. Can be overridden per-route via
   * `@RateLimit({ max, timeWindow })` decorator + Fastify hooks if needed.
   */
  globalMax?: number;
  globalTimeWindow?: string;
  /** Paths exempt from global rate-limit. Matched as URL prefixes. */
  exemptPaths?: string[];
  /** NODE_ENV passthrough — prod tightens helmet settings. */
  env?: string;
}

export const DEFAULT_SECURITY_OPTIONS: Required<
  Omit<SecurityOptions, 'redis' | 'env'>
> & { env: string } = {
  globalMax: 300,
  globalTimeWindow: '1 minute',
  exemptPaths: [
    // Metrics scrape from Prometheus (basic auth already gates it).
    '/metrics',
    // Readiness/liveness probes hit by Docker/ALB — limiting them can
    // cause healthy instances to be taken out of rotation.
    '/api/health',
    // Outbound webhook receivers (BullMQ-backed), signature-verified.
    '/api/webhooks/',
  ],
  env: 'development',
};

export function resolveSecurityOptions(opts: SecurityOptions = {}): Required<
  Omit<SecurityOptions, 'redis'>
> & { redis?: RedisService } {
  return {
    ...DEFAULT_SECURITY_OPTIONS,
    env: opts.env ?? process.env.NODE_ENV ?? DEFAULT_SECURITY_OPTIONS.env,
    globalMax: opts.globalMax ?? DEFAULT_SECURITY_OPTIONS.globalMax,
    globalTimeWindow: opts.globalTimeWindow ?? DEFAULT_SECURITY_OPTIONS.globalTimeWindow,
    exemptPaths: opts.exemptPaths ?? DEFAULT_SECURITY_OPTIONS.exemptPaths,
    redis: opts.redis,
  };
}

export function isExemptPath(url: string, exemptPaths: string[]): boolean {
  return exemptPaths.some((p) => url.startsWith(p));
}

/**
 * Register @fastify/helmet and @fastify/rate-limit against a Fastify instance.
 *
 * Helmet default headers: X-Frame-Options=SAMEORIGIN, X-Content-Type-Options=nosniff,
 * Strict-Transport-Security (prod only), Referrer-Policy=no-referrer, hides X-Powered-By.
 * CSP is deliberately left off — the Nginx/ALB layer sets it (we'd conflict) and
 * Swagger UI in dev needs inline script/style.
 */
export async function registerSecurityPlugins(
  fastify: FastifyInstance,
  opts: SecurityOptions = {},
): Promise<void> {
  const resolved = resolveSecurityOptions(opts);
  const isProd = resolved.env === 'production';

  // ---- Helmet ----
  type RegisterPlugin = Parameters<typeof fastify.register>[0];
  const helmetPlugin = fastifyHelmet as unknown as RegisterPlugin;
  await fastify.register(helmetPlugin, {
    // Let the edge (Nginx/ALB) own CSP so we don't double-ship policy.
    contentSecurityPolicy: false,
    // HSTS is only meaningful over HTTPS; enable in prod where TLS is guaranteed.
    strictTransportSecurity: isProd
      ? { maxAge: 31536000, includeSubDomains: true, preload: false }
      : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    // X-Frame-Options + frame-ancestors handled by helmet defaults.
    frameguard: { action: 'sameorigin' },
  });

  // ---- Rate limit ----
  const rateLimitPlugin = fastifyRateLimit as unknown as RegisterPlugin;
  await fastify.register(rateLimitPlugin, {
    global: true,
    max: resolved.globalMax,
    timeWindow: resolved.globalTimeWindow,
    // Use Redis store when available so horizontal scaling shares counters.
    // Without it (single instance dev), fall back to the default memory store.
    redis: resolved.redis,
    // Exempt readiness and metrics. Admin state-changing routes still pass
    // through the global limiter.
    // The fn returns true
    // to skip the limiter for this request.
    skipOnError: true, // don't block traffic if Redis is down
    allowList: (req: FastifyRequest) => isExemptPath(req.url ?? '', resolved.exemptPaths),
    // Identify by IP. Respect x-forwarded-for because Fastify trustProxy is on.
    keyGenerator: (req: FastifyRequest) => req.ip,
    // body.statusCode is what Fastify's default error handler consumes to set
    // the response code. Omitting it makes Fastify treat the body as data and
    // fall through to 500. Keep statusCode here in addition to our ApiResponse
    // envelope fields so existing clients keep parsing normally.
    errorResponseBuilder: (_req: FastifyRequest, ctx: { max: number; after: string }) => ({
      statusCode: 429,
      code: 429,
      message: `请求过于频繁，请 ${ctx.after} 后再试`,
      data: null,
      retryAfter: ctx.after,
    }),
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
  });
}
