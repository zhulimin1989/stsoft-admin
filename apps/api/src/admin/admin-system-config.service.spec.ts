import { BadRequestException } from '@nestjs/common';
import { AdminService } from './admin.service';

function buildService() {
  const repo = {
    upsertSystemConfig: jest.fn().mockResolvedValue(undefined),
    findSystemConfigs: jest.fn().mockResolvedValue([]),
    findSystemConfig: jest.fn().mockResolvedValue(null),
    upsertDeploymentConfig: jest.fn().mockImplementation(async (value: string, expectedVersion: bigint) => ({
      key: 'deploymentConfig',
      value,
      version: expectedVersion + 1n,
    })),
  };
  const userClient = {
    syncDeploymentConfig: jest.fn().mockResolvedValue(undefined),
  };
  const billingClient = {
    syncDeploymentConfig: jest.fn().mockResolvedValue(undefined),
    syncStorageConfig: jest.fn().mockResolvedValue(undefined),
  };
  const deploymentSync = {
    syncNow: jest.fn().mockImplementation(async (snapshot) => ({
      version: snapshot.version,
      status: 'synced',
      lastAttemptAt: '2026-07-10T00:00:00.000Z',
      user: { ok: true },
      billing: { ok: true },
    })),
  };
  const config = {
    get: jest.fn().mockReturnValue(undefined),
    getOrThrow: jest.fn().mockReturnValue('secret'),
  };
  const service = new AdminService(
    repo as any,
    {} as any,
    { get: jest.fn(), set: jest.fn(), del: jest.fn(), keys: jest.fn() } as any,
    { sign: jest.fn(), verify: jest.fn() } as any,
    config as any,
    { log: jest.fn() } as any,
    userClient as any,
    billingClient as any,
    deploymentSync as any,
  );
  return { service, repo, userClient, billingClient, deploymentSync };
}

describe('AdminService.updateSystemConfig — unified deployment config', () => {
  afterEach(() => jest.clearAllMocks());

  it('rejects every direct authConfig write', async () => {
    const { service, repo, deploymentSync } = buildService();
    await expect(
      service.updateSystemConfig({ authConfig: { provider: 'authing' } }),
    ).rejects.toThrow('登录身份源由部署区域自动派生');
    expect(repo.upsertDeploymentConfig).not.toHaveBeenCalled();
    expect(deploymentSync.syncNow).not.toHaveBeenCalled();
  });

  it('rejects direct writes to reserved deployment snapshot keys', async () => {
    const { service, repo, deploymentSync } = buildService();
    await expect(
      service.updateSystemConfig({
        deploymentConfig: { version: '999', region: 'overseas' },
      }),
    ).rejects.toThrow('deploymentConfig 是系统保留快照');
    await expect(
      service.updateSystemConfig({ deploymentConfigSyncStatus: { status: 'synced' } }),
    ).rejects.toThrow('deploymentConfig 是系统保留快照');
    expect(repo.upsertSystemConfig).not.toHaveBeenCalled();
    expect(deploymentSync.syncNow).not.toHaveBeenCalled();
  });

  it('derives the read model from PLATFORM_REGION when no authoritative row exists yet', async () => {
    const { service, repo } = buildService();
    repo.findSystemConfigs.mockResolvedValue([]);
    (service as any).config.get.mockImplementation((key: string) =>
      key === 'PLATFORM_REGION' ? 'domestic' : undefined,
    );

    await expect(service.getSystemConfig()).resolves.toMatchObject({
      deploymentConfig: {
        version: '0',
        region: 'domestic',
        provider: 'authing',
        currency: 'cny',
        defaultLanguage: 'zh',
      },
      platformConfig: {
        region: 'domestic',
        currency: 'cny',
        defaultLanguage: 'zh',
      },
      authConfig: { provider: 'authing', derivedFrom: 'region' },
    });
  });

  it('persists one versioned snapshot and derives Authing from domestic region', async () => {
    const { service, repo, deploymentSync } = buildService();

    const result = await service.updateSystemConfig({
      platformConfig: { region: 'CN', currency: 'CNY', defaultLanguage: 'zh-CN' },
    });

    expect(repo.upsertDeploymentConfig).toHaveBeenCalledWith(
      JSON.stringify({
        region: 'domestic',
        currency: 'cny',
        defaultLanguage: 'zh',
        oauth: {},
      }),
      0n,
    );
    expect(deploymentSync.syncNow).toHaveBeenCalledWith(expect.objectContaining({
      version: '1',
      region: 'domestic',
      provider: 'authing',
    }));
    expect(result.deploymentConfig).toEqual(expect.objectContaining({ provider: 'authing' }));
  });

  it('platformConfig 非法币种 → 400，且不持久化、不下发', async () => {
    const { service, repo, deploymentSync } = buildService();

    await expect(
      service.updateSystemConfig({ platformConfig: { currency: 'rmb-yuan' } }),
    ).rejects.toThrow(BadRequestException);
    expect(repo.upsertDeploymentConfig).not.toHaveBeenCalled();
    expect(deploymentSync.syncNow).not.toHaveBeenCalled();
  });

  it('merges an OAuth update into the current atomic snapshot', async () => {
    const { service, repo, deploymentSync } = buildService();
    repo.findSystemConfig.mockResolvedValue({
      key: 'deploymentConfig',
      version: 8n,
      value: JSON.stringify({
        region: 'overseas',
        currency: 'usd',
        defaultLanguage: 'en',
        oauth: { auth0Domain: 'old.example.com' },
      }),
    });

    await service.updateSystemConfig({
      oauthConfig: {
        auth0Domain: ' tenant.auth0.com ',
        auth0ClientId: ' client-id ',
        ignoredSecret: 'must-not-sync',
      },
    });

    expect(repo.upsertDeploymentConfig).toHaveBeenCalledWith(
      JSON.stringify({
        region: 'overseas',
        currency: 'usd',
        defaultLanguage: 'en',
        oauth: { auth0Domain: 'tenant.auth0.com', auth0ClientId: 'client-id' },
      }),
      8n,
    );
    expect(deploymentSync.syncNow).toHaveBeenCalled();
  });

  it('re-reads and merges after a concurrent deployment config update wins the CAS', async () => {
    const { service, repo, deploymentSync } = buildService();
    repo.findSystemConfig
      .mockResolvedValueOnce({
        key: 'deploymentConfig',
        version: 4n,
        value: JSON.stringify({
          region: 'overseas',
          currency: 'usd',
          defaultLanguage: 'en',
          oauth: {},
        }),
      })
      .mockResolvedValueOnce({
        key: 'deploymentConfig',
        version: 5n,
        value: JSON.stringify({
          region: 'domestic',
          currency: 'cny',
          defaultLanguage: 'zh',
          oauth: {},
        }),
      });
    repo.upsertDeploymentConfig
      .mockResolvedValueOnce(null)
      .mockImplementationOnce(async (value: string) => ({
        key: 'deploymentConfig',
        value,
        version: 6n,
      }));

    await service.updateSystemConfig({
      oauthConfig: { authingAppHost: 'https://tenant.authing.cn' },
    });

    expect(repo.upsertDeploymentConfig).toHaveBeenNthCalledWith(
      2,
      JSON.stringify({
        region: 'domestic',
        currency: 'cny',
        defaultLanguage: 'zh',
        oauth: { authingAppHost: 'https://tenant.authing.cn' },
      }),
      5n,
    );
    expect(deploymentSync.syncNow).toHaveBeenCalledWith(expect.objectContaining({
      version: '6',
      region: 'domestic',
      provider: 'authing',
    }));
  });

  it('storageConfig → 持久化并下发 billing，部署级 bucket/region 不同步', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        provider: ' s3 ',
        bucket: ' invoices ',
        s3Region: ' ap-east-1 ',
        s3Endpoint: '',
        s3Prefix: ' billing-test ',
        s3AccessKeyId: '',
      },
    });

    expect(repo.upsertSystemConfig).toHaveBeenCalledWith(
      'storageConfig',
      JSON.stringify({
        provider: 's3',
        s3Prefix: 'billing-test',
      }),
    );
    expect(billingClient.syncStorageConfig).toHaveBeenCalledWith({
      provider: 's3',
      s3Prefix: 'billing-test',
    });
  });

  it('storageConfig provider=oss → 归一化为 aliyun_oss 并剔除 S3 专属字段', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        provider: 'oss',
        bucket: 'invoices',
        s3Region: 'cn-hangzhou',
        s3Endpoint: 'https://s3.should-not-persist.test',
        s3ForcePathStyle: true,
        ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        s3AccessKeyId: 'ak',
        s3SecretAccessKey: 'sk',
      },
    });

    const persisted = (repo.upsertSystemConfig as jest.Mock).mock.calls[0];
    expect(persisted[0]).toBe('storageConfig');
    expect(JSON.parse(persisted[1])).toEqual(
      expect.objectContaining({ provider: 'aliyun_oss' }),
    );
    expect(billingClient.syncStorageConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'aliyun_oss',
        ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        s3AccessKeyId: 'ak',
        s3SecretAccessKey: 'sk',
      }),
    );
    expect(JSON.parse(persisted[1])).not.toHaveProperty('s3Endpoint');
    expect(JSON.parse(persisted[1])).not.toHaveProperty('s3ForcePathStyle');
    expect(JSON.parse(persisted[1])).not.toHaveProperty('bucket');
    expect(JSON.parse(persisted[1])).not.toHaveProperty('s3Region');
  });

  it('storageConfig storageProvider 别名 → 归一化为 provider 后持久化并下发', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        storageProvider: 'aliyun-oss',
        bucket: 'invoices',
        s3Region: 'cn-hangzhou',
        ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
        s3AccessKeyId: 'ak',
        s3SecretAccessKey: 'sk',
      },
    });

    const persisted = JSON.parse((repo.upsertSystemConfig as jest.Mock).mock.calls[0][1]);
    expect(persisted).toEqual(
      expect.objectContaining({ provider: 'aliyun_oss' }),
    );
    expect(billingClient.syncStorageConfig).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'aliyun_oss' }),
    );
  });

  it('storageConfig provider=aliyun_oss 缺少 AK/SK → 允许保存部分配置', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        provider: 'aliyun_oss',
        bucket: 'invoices',
        s3Region: 'cn-hangzhou',
      },
    });

    expect(repo.upsertSystemConfig).toHaveBeenCalledWith(
      'storageConfig',
      JSON.stringify({ provider: 'aliyun_oss' }),
    );
    expect(billingClient.syncStorageConfig).toHaveBeenCalledWith({ provider: 'aliyun_oss' });
  });

  it('storageConfig 未传 provider 但有 ossEndpoint → 推断为 aliyun_oss 并保存部分配置', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        bucket: 'invoices',
        s3Region: 'cn-hangzhou',
        ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      },
    });

    const expected = {
      provider: 'aliyun_oss',
      ossEndpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
    };
    const persisted = (repo.upsertSystemConfig as jest.Mock).mock.calls[0];
    expect(persisted[0]).toBe('storageConfig');
    expect(JSON.parse(persisted[1])).toEqual(expected);
    expect(billingClient.syncStorageConfig).toHaveBeenCalledWith(expected);
  });

  it('storageConfig 只传部署级 bucket/region → 剔除后仅保存空配置，不下发 billing', async () => {
    const { service, repo, billingClient } = buildService();

    await service.updateSystemConfig({
      storageConfig: {
        bucket: 'invoices',
        s3Region: '',
      },
    });

    expect(repo.upsertSystemConfig).toHaveBeenCalledWith('storageConfig', JSON.stringify({}));
    expect(billingClient.syncStorageConfig).not.toHaveBeenCalled();
  });
});
