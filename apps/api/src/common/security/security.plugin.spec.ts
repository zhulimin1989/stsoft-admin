import Fastify, { FastifyInstance } from 'fastify';
import {
  registerSecurityPlugins,
  resolveSecurityOptions,
  isExemptPath,
  DEFAULT_SECURITY_OPTIONS,
} from './security.plugin';

describe('resolveSecurityOptions', () => {
  it('fills defaults when no opts passed', () => {
    const resolved = resolveSecurityOptions({ env: 'test' });
    expect(resolved.globalMax).toBe(DEFAULT_SECURITY_OPTIONS.globalMax);
    expect(resolved.globalTimeWindow).toBe(DEFAULT_SECURITY_OPTIONS.globalTimeWindow);
    expect(resolved.exemptPaths).toEqual(DEFAULT_SECURITY_OPTIONS.exemptPaths);
  });

  it('respects overrides', () => {
    const resolved = resolveSecurityOptions({
      env: 'production',
      globalMax: 50,
      globalTimeWindow: '10 seconds',
      exemptPaths: ['/ping'],
    });
    expect(resolved.globalMax).toBe(50);
    expect(resolved.globalTimeWindow).toBe('10 seconds');
    expect(resolved.exemptPaths).toEqual(['/ping']);
    expect(resolved.env).toBe('production');
  });
});

describe('isExemptPath', () => {
  const paths = ['/metrics', '/api/health', '/api/webhooks/'];

  it.each([
    ['/metrics', true],
    ['/metrics?x=1', true],
    ['/api/health', true],
    ['/api/health/ready', true],
    ['/api/admin/auth/login', false],
    ['/api/webhooks/abc', true],
    ['/api/user', false],
    ['/api/auth/login', false],
    ['/', false],
  ])('exempt(%s) === %s', (url, expected) => {
    expect(isExemptPath(url, paths)).toBe(expected);
  });
});

// ---- Integration: register against a bare Fastify instance ----
describe('registerSecurityPlugins (integration)', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = Fastify({ trustProxy: true });
    // Plugins MUST register before route definitions. Fastify's onRequest hooks
    // only attach to routes registered after the plugin — exactly how main.ts
    // bootstraps (helmet+rate-limit before Nest builds controllers).
    await registerSecurityPlugins(app, {
      env: 'test',
      globalMax: 3,
      globalTimeWindow: '10 seconds',
    });

    app.get('/foo', async () => ({ ok: true }));
    app.get('/metrics', async () => ({ ok: true }));
    app.post('/api/admin/auth/login', async () => ({ ok: true }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('sets security response headers on every request', async () => {
    const res = await app.inject({ method: 'GET', url: '/foo' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toMatch(/SAMEORIGIN/i);
    // HSTS off outside prod
    expect(res.headers['strict-transport-security']).toBeUndefined();
    // x-powered-by should be stripped by helmet
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('enables HSTS in production', async () => {
    const prodApp = Fastify({ trustProxy: true });
    await registerSecurityPlugins(prodApp, { env: 'production', globalMax: 100 });
    prodApp.get('/foo', async () => ({ ok: true }));
    await prodApp.ready();

    const res = await prodApp.inject({ method: 'GET', url: '/foo' });
    expect(res.headers['strict-transport-security']).toMatch(/max-age=31536000/);
    await prodApp.close();
  });

  it('rate-limits anonymous IPs at the global ceiling', async () => {
    // 3 allowed, 4th should 429
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({ method: 'GET', url: '/foo' });
      expect(ok.statusCode).toBe(200);
    }
    const blocked = await app.inject({ method: 'GET', url: '/foo' });
    expect(blocked.statusCode).toBe(429);
    const body = blocked.json();
    expect(body.code).toBe(429);
    expect(body.message).toContain('请求过于频繁');
  });

  it('adds rate-limit response headers', async () => {
    const res = await app.inject({ method: 'GET', url: '/foo' });
    expect(res.headers['x-ratelimit-limit']).toBeDefined();
    expect(res.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('exempts /metrics from rate-limit', async () => {
    // 10 calls >> limit of 3, all should 200
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: 'GET', url: '/metrics' });
      expect(res.statusCode).toBe(200);
    }
  });

  it('rate-limits admin POST routes at the global ceiling', async () => {
    for (let i = 0; i < 3; i++) {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        payload: {},
      });
      expect(ok.statusCode).toBe(200);
    }

    const blocked = await app.inject({
      method: 'POST',
      url: '/api/admin/auth/login',
      payload: {},
    });
    expect(blocked.statusCode).toBe(429);
  });
});
