import { resolveCorsOrigins } from './cors-origins';

describe('resolveCorsOrigins', () => {
  const base = {
    names: ['USER_CORS_ORIGINS', 'CORS_ORIGINS'],
    devDefaults: ['http://localhost:5173'],
    label: 'user API',
  };

  it('uses dev defaults outside production', () => {
    expect(resolveCorsOrigins({ ...base, env: { NODE_ENV: 'development' } })).toEqual([
      'http://localhost:5173',
    ]);
  });

  it('requires explicit origins in production', () => {
    expect(() =>
      resolveCorsOrigins({ ...base, env: { NODE_ENV: 'production' } }),
    ).toThrow(/explicitly configured/);
  });

  it('prefers the first configured env var', () => {
    expect(
      resolveCorsOrigins({
        ...base,
        env: {
          NODE_ENV: 'production',
          USER_CORS_ORIGINS: 'https://app.example.com',
          CORS_ORIGINS: 'https://fallback.example.com',
        },
      }),
    ).toEqual(['https://app.example.com']);
  });

  it('rejects wildcard origins because credentials are enabled', () => {
    expect(() =>
      resolveCorsOrigins({
        ...base,
        env: { NODE_ENV: 'production', USER_CORS_ORIGINS: '*' },
      }),
    ).toThrow(/not allowed/);
  });

  it('rejects localhost origins in production', () => {
    expect(() =>
      resolveCorsOrigins({
        ...base,
        env: { NODE_ENV: 'production', USER_CORS_ORIGINS: 'http://localhost:5173' },
      }),
    ).toThrow(/localhost/);
  });

  it('rejects origins with paths', () => {
    expect(() =>
      resolveCorsOrigins({
        ...base,
        env: { NODE_ENV: 'production', USER_CORS_ORIGINS: 'https://app.example.com/admin' },
      }),
    ).toThrow(/path/);
  });
});
