import { buildSentryOptions, initSentry } from './instrument';

describe('buildSentryOptions', () => {
  it('returns null when SENTRY_DSN is unset', () => {
    expect(buildSentryOptions({} as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns null when SENTRY_DSN is empty string', () => {
    expect(buildSentryOptions({ SENTRY_DSN: '' } as NodeJS.ProcessEnv)).toBeNull();
  });

  it('returns production sampling when NODE_ENV=production', () => {
    const opts = buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);

    expect(opts).not.toBeNull();
    expect(opts!.dsn).toBe('https://x@y/1');
    expect(opts!.tracesSampleRate).toBe(0.1);
    expect(opts!.profileSessionSampleRate).toBe(0.1);
    expect(opts!.environment).toBe('production');
  });

  it('returns production sampling when APP_ENV=production', () => {
    const opts = buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      NODE_ENV: 'development',
      APP_ENV: 'production',
    } as NodeJS.ProcessEnv);

    expect(opts).not.toBeNull();
    expect(opts!.tracesSampleRate).toBe(0.1);
    expect(opts!.profileSessionSampleRate).toBe(0.1);
    expect(opts!.environment).toBe('development');
  });

  it('returns full sampling in development', () => {
    const opts = buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      NODE_ENV: 'development',
    } as NodeJS.ProcessEnv);

    expect(opts!.tracesSampleRate).toBe(1.0);
    expect(opts!.profileSessionSampleRate).toBe(1.0);
    expect(opts!.environment).toBe('development');
  });

  it('prefers SENTRY_RELEASE over GIT_COMMIT_SHA when both set', () => {
    const opts = buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      SENTRY_RELEASE: 'v1.2.3',
      GIT_COMMIT_SHA: 'abcdef',
    } as NodeJS.ProcessEnv);
    expect(opts!.release).toBe('v1.2.3');
  });

  it('falls back to GIT_COMMIT_SHA when SENTRY_RELEASE unset', () => {
    const opts = buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      GIT_COMMIT_SHA: 'abc123',
    } as NodeJS.ProcessEnv);
    expect(opts!.release).toBe('abc123');
  });
});

describe('buildSentryOptions.beforeSend', () => {
  function make() {
    return buildSentryOptions({
      SENTRY_DSN: 'https://x@y/1',
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv)!;
  }

  it('drops 404 events (noisy client errors)', () => {
    const { beforeSend } = make();
    const event = { contexts: { response: { status_code: 404 } } };
    expect(beforeSend!(event as any, {} as any)).toBeNull();
  });

  it('drops 400 and 422 events', () => {
    const { beforeSend } = make();
    expect(
      beforeSend!({ contexts: { response: { status_code: 400 } } } as any, {} as any),
    ).toBeNull();
    expect(
      beforeSend!({ contexts: { response: { status_code: 422 } } } as any, {} as any),
    ).toBeNull();
  });

  it('keeps 401/403/429 — these often indicate real attacks', () => {
    const { beforeSend } = make();
    for (const code of [401, 403, 429]) {
      const event = { contexts: { response: { status_code: code } } };
      expect(beforeSend!(event as any, {} as any)).toBe(event);
    }
  });

  it('keeps all 5xx events', () => {
    const { beforeSend } = make();
    const event = { contexts: { response: { status_code: 500 } } };
    expect(beforeSend!(event as any, {} as any)).toBe(event);
  });

  it('falls back to originalException.status if no response context', () => {
    const { beforeSend } = make();
    const event = {};
    expect(
      beforeSend!(event as any, { originalException: { status: 404 } } as any),
    ).toBeNull();
  });

  it('keeps event when no status is available (unknown errors)', () => {
    const { beforeSend } = make();
    const event = {};
    expect(beforeSend!(event as any, {} as any)).toBe(event);
  });
});

describe('initSentry', () => {
  it('skips init when DSN missing', () => {
    const initFn = jest.fn();
    const ok = initSentry({ env: {} as NodeJS.ProcessEnv, initFn });
    expect(ok).toBe(false);
    expect(initFn).not.toHaveBeenCalled();
  });

  it('calls init with built options when DSN present', () => {
    const initFn = jest.fn();
    const ok = initSentry({
      env: {
        SENTRY_DSN: 'https://x@y/1',
        NODE_ENV: 'production',
      } as NodeJS.ProcessEnv,
      initFn,
    });
    expect(ok).toBe(true);
    expect(initFn).toHaveBeenCalledWith(expect.objectContaining({ dsn: 'https://x@y/1' }));
  });
});
