import { resolvePrismaDatasourceUrl } from './prisma.service';

function makeConfig(values: Record<string, string | undefined>) {
  return {
    get: jest.fn((key: string) => values[key]),
  };
}

describe('resolvePrismaDatasourceUrl', () => {
  it('uses DATABASE_URL for the main api runtime', () => {
    const url = resolvePrismaDatasourceUrl({
      RUIDONG_SERVICE: 'api',
      DATABASE_URL: 'postgresql://admin-db',
      BILLING_DATABASE_URL: 'postgresql://billing-db',
    } as NodeJS.ProcessEnv);

    expect(url).toBe('postgresql://admin-db');
  });

  it('requires ADMIN_DATABASE_URL for production admin runtime', () => {
    expect(() =>
      resolvePrismaDatasourceUrl({
        NODE_ENV: 'production',
        RUIDONG_SERVICE: 'admin-api',
        DATABASE_URL: 'postgresql://fallback-db',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ADMIN_DATABASE_URL is required/);
  });

  it('treats APP_ENV=production as production for admin DB isolation', () => {
    expect(() =>
      resolvePrismaDatasourceUrl({
        APP_ENV: 'production',
        RUIDONG_SERVICE: 'admin-api',
        DATABASE_URL: 'postgresql://fallback-db',
      } as NodeJS.ProcessEnv),
    ).toThrow(/ADMIN_DATABASE_URL is required/);
  });

  it('uses ADMIN_DATABASE_URL when it is configured', () => {
    const url = resolvePrismaDatasourceUrl({
      RUIDONG_SERVICE: 'admin-api',
      ADMIN_DATABASE_URL: 'postgresql://admin-split-db',
      DATABASE_URL: 'postgresql://fallback-db',
    } as NodeJS.ProcessEnv);

    expect(url).toBe('postgresql://admin-split-db');
  });

  it('lets ConfigService values override process env', () => {
    const url = resolvePrismaDatasourceUrl(
      {
        RUIDONG_SERVICE: 'api',
        DATABASE_URL: 'postgresql://env-admin-db',
      } as NodeJS.ProcessEnv,
      makeConfig({
        DATABASE_URL: 'postgresql://config-fallback-db',
        ADMIN_DATABASE_URL: 'postgresql://config-admin-db',
      }),
    );

    expect(url).toBe('postgresql://config-admin-db');
  });
});
