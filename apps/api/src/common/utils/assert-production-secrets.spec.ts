import {
  assertProductionSecrets,
  checkProductionSecrets,
  PRODUCTION_SECRETS,
} from './assert-production-secrets';
import * as fs from 'fs';
import * as path from 'path';

function validProdEnv(): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    RUIDONG_SERVICE: 'admin-api',
    JWT_SECRET: 'a'.repeat(64),
    ADMIN_TO_BILLING_TOKEN: 'c'.repeat(64),
    ADMIN_TO_BILLING_CONTEXT_SECRET: 'd'.repeat(64),
    ADMIN_TO_USER_TOKEN: 'e'.repeat(64),
    ADMIN_TO_USER_CONTEXT_SECRET: 'f'.repeat(64),
    ADMIN_DATABASE_URL: 'postgresql://u:p@host:5432/admin?schema=public',
    REDIS_HOST: 'prod-redis.internal',
    METRICS_USER: 'prometheus',
    METRICS_PASSWORD: 'metrics-secret-32-chars-long',
  };
}

function productionEnvExampleKeys(): Set<string> {
  const repoRoot = path.resolve(__dirname, '../../../../..');
  const text = fs.readFileSync(path.join(repoRoot, '.env.production.example'), 'utf8');
  const keys = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split('=', 1)[0]?.trim())
    .filter((key): key is string => Boolean(key));
  return new Set(keys);
}

describe('checkProductionSecrets', () => {
  it('accepts a well-formed production env', () => {
    expect(checkProductionSecrets(validProdEnv()).errors).toEqual([]);
  });

  it.each([
    ['JWT_SECRET', 'replace_with_64_hex_chars'],
    ['ADMIN_TO_BILLING_TOKEN', 'replace_with_64_hex_chars'],
    ['ADMIN_TO_BILLING_CONTEXT_SECRET', 'replace_with_64_hex_chars'],
    ['ADMIN_TO_USER_TOKEN', 'replace_with_64_hex_chars'],
    ['ADMIN_TO_USER_CONTEXT_SECRET', 'replace_with_64_hex_chars'],
    ['JWT_SECRET', 'test_jwt_secret_for_ci_only'],
  ])('flags %s when it still contains placeholder "%s"', (key, value) => {
    const env = { ...validProdEnv(), [key]: value } as NodeJS.ProcessEnv;
    const { errors } = checkProductionSecrets(env);
    expect(errors.some((e) => e.includes(key) && e.includes('placeholder'))).toBe(true);
  });

  it('flags missing required fields', () => {
    const env = { ...validProdEnv() };
    delete env.JWT_SECRET;
    const { errors } = checkProductionSecrets(env);
    expect(errors).toContain('JWT_SECRET is required but not set');
  });

  it('does not flag optional fields when absent', () => {
    const env = validProdEnv();
    delete env.SENTRY_DSN;
    expect(checkProductionSecrets(env).errors).toEqual([]);
  });

  it('flags optional fields when set with bad value', () => {
    const env = { ...validProdEnv(), SENTRY_DSN: 'changeme' };
    const { errors } = checkProductionSecrets(env);
    expect(errors.some((e) => e.includes('SENTRY_DSN'))).toBe(true);
  });

  it('requires metrics credentials in production', () => {
    const env = { ...validProdEnv() };
    delete env.METRICS_PASSWORD;
    expect(checkProductionSecrets(env).errors).toContain(
      'METRICS_PASSWORD is required but not set',
    );

    const weak = { ...validProdEnv(), METRICS_PASSWORD: 'short' };
    expect(checkProductionSecrets(weak).errors).toContain(
      'METRICS_PASSWORD length 5 is below minimum 16',
    );
  });

  it('enforces JWT_SECRET min length', () => {
    const env = { ...validProdEnv(), JWT_SECRET: 'short' };
    const { errors } = checkProductionSecrets(env);
    expect(errors.some((e) => e.includes('JWT_SECRET') && e.includes('below minimum'))).toBe(true);
  });

  it('ignores surrounding whitespace', () => {
    const env = { ...validProdEnv(), JWT_SECRET: `   ${'a'.repeat(64)}   ` };
    expect(checkProductionSecrets(env).errors).toEqual([]);
  });

  it('exposes only admin-api checks', () => {
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'JWT_SECRET' && c.required)).toBe(true);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'ADMIN_TO_BILLING_TOKEN' && c.required)).toBe(true);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'ADMIN_TO_USER_TOKEN' && c.required)).toBe(true);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'BILLING_INTERNAL_TOKEN')).toBe(false);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'ADMIN_DATABASE_URL' && c.required)).toBe(true);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'DATABASE_URL')).toBe(false);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'BILLING_DATABASE_URL')).toBe(false);
    expect(PRODUCTION_SECRETS.some((c) => c.name === 'API_KEY_HASH_SECRET')).toBe(false);
  });

  it('keeps the production env example aligned with required production checks', () => {
    const keys = productionEnvExampleKeys();
    const missing = PRODUCTION_SECRETS
      .filter((check) => check.required)
      .map((check) => check.name)
      .filter((name) => !keys.has(name));

    expect(missing).toEqual([]);
    expect(keys.has('BILLING_INTERNAL_TOKEN')).toBe(false);
  });
});

describe('assertProductionSecrets', () => {
  it('returns silently when env is clean', () => {
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(validProdEnv(), logger, exit);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('calls exit(1) in production when placeholders found', () => {
    const env = { ...validProdEnv(), JWT_SECRET: 'replace_with_secret' };
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(env, logger, exit);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalled();
    const msg = (logger.error.mock.calls[0] as [string])[0];
    expect(msg).toContain('JWT_SECRET');
  });

  it('treats APP_ENV=production as production', () => {
    const env = {
      ...validProdEnv(),
      NODE_ENV: 'development',
      APP_ENV: 'production',
      JWT_SECRET: 'replace_with_secret',
    };
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(env, logger, exit);
    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.log).not.toHaveBeenCalled();
  });

  it('warns but does not exit in non-production', () => {
    const env = { ...validProdEnv(), NODE_ENV: 'development', JWT_SECRET: 'changeme' };
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(env, logger, exit);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalled();
    const msg = (logger.log.mock.calls[0] as [string])[0];
    expect(msg).toContain('WARNING');
    expect(msg).toContain('non-production');
  });

  it('warns in test env when fields missing', () => {
    const env = { NODE_ENV: 'test' } as NodeJS.ProcessEnv;
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(env, logger, exit);
    expect(exit).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalled();
  });

  it('aggregates all errors in the message, not just the first one', () => {
    const env = {
      NODE_ENV: 'production',
      JWT_SECRET: 'short',
    } as NodeJS.ProcessEnv;
    const logger = { log: jest.fn(), error: jest.fn() };
    const exit = jest.fn();
    assertProductionSecrets(env, logger, exit);

    const msg = (logger.error.mock.calls[0] as [string])[0];
    expect(msg).toContain('JWT_SECRET');
    expect(msg).toContain('ADMIN_TO_BILLING_TOKEN');
    expect(msg).toContain('ADMIN_TO_USER_TOKEN');
    expect(msg).toContain('ADMIN_DATABASE_URL');
    expect(msg).not.toMatch(/\n\s+- DATABASE_URL is required but not set/);
    expect(msg).not.toContain('BILLING_DATABASE_URL');
    expect(msg).not.toContain('SENTRY_DSN');
  });
});
