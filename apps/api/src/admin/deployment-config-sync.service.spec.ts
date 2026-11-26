import { DeploymentConfigSyncService } from './deployment-config-sync.service';
import { getAdminRequestContext } from '../common/request/admin-context';

const snapshot = {
  version: '7',
  region: 'domestic' as const,
  provider: 'authing' as const,
  currency: 'cny',
  defaultLanguage: 'zh' as const,
  oauth: {},
};

function buildService() {
  const repo = {
    findSystemConfig: jest.fn(),
    upsertDeploymentConfigSyncStatus: jest.fn().mockResolvedValue(undefined),
  };
  const user = { syncDeploymentConfig: jest.fn().mockResolvedValue(snapshot) };
  const billing = { syncDeploymentConfig: jest.fn().mockResolvedValue(snapshot) };
  const config = { get: jest.fn() };
  return {
    service: new DeploymentConfigSyncService(
      repo as any,
      user as any,
      billing as any,
      config as any,
    ),
    repo,
    user,
    billing,
  };
}

describe('DeploymentConfigSyncService', () => {
  it('retries transient target failures and records a synced version', async () => {
    const { service, repo, user } = buildService();
    user.syncDeploymentConfig
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce(snapshot);

    await expect(service.syncNow(snapshot)).resolves.toMatchObject({
      version: '7',
      status: 'synced',
      user: { ok: true },
      billing: { ok: true },
    });
    expect(user.syncDeploymentConfig).toHaveBeenCalledTimes(2);
    expect(repo.upsertDeploymentConfigSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('"status":"synced"'),
      7n,
    );
  });

  it('records degraded status so the periodic reconciler can retry later', async () => {
    const { service, repo, billing } = buildService();
    billing.syncDeploymentConfig.mockRejectedValue(new Error('billing unavailable'));

    await expect(service.syncNow(snapshot)).resolves.toMatchObject({
      status: 'degraded',
      user: { ok: true },
      billing: { ok: false, error: 'billing unavailable' },
    });
    expect(billing.syncDeploymentConfig).toHaveBeenCalledTimes(3);
    expect(repo.upsertDeploymentConfigSyncStatus).toHaveBeenCalledWith(
      expect.stringContaining('"status":"degraded"'),
      7n,
    );
  });

  it('does not report success when a target acknowledges another version', async () => {
    const { service, user } = buildService();
    user.syncDeploymentConfig.mockResolvedValue({ ...snapshot, version: '8' });

    await expect(service.syncNow(snapshot)).resolves.toMatchObject({
      status: 'degraded',
      user: { ok: false, error: '目标服务确认版本 8，期望 7' },
      billing: { ok: true },
    });
    expect(user.syncDeploymentConfig).toHaveBeenCalledTimes(3);
  });

  it('replays the latest persisted version during reconciliation', async () => {
    const { service, repo, user, billing } = buildService();
    repo.findSystemConfig.mockResolvedValue({
      key: 'deploymentConfig',
      version: 7n,
      value: JSON.stringify({
        region: 'domestic',
        currency: 'cny',
        defaultLanguage: 'zh',
        oauth: {},
      }),
    });

    await service.reconcileLatest();
    expect(user.syncDeploymentConfig).toHaveBeenCalledWith(snapshot);
    expect(billing.syncDeploymentConfig).toHaveBeenCalledWith(snapshot);
  });

  it('forwards the exact system-config permission during background reconciliation', async () => {
    const { service, repo, user } = buildService();
    repo.findSystemConfig.mockResolvedValue({
      key: 'deploymentConfig',
      version: 7n,
      value: JSON.stringify({
        region: 'domestic',
        currency: 'cny',
        defaultLanguage: 'zh',
        oauth: {},
      }),
    });
    user.syncDeploymentConfig.mockImplementation(async () => {
      expect(getAdminRequestContext()).toMatchObject({
        adminId: 'system:deployment-config-reconciler',
        presetRole: 'system',
        permissions: expect.arrayContaining([
          'admin.system.manage',
          'admin.page.system_config.manage',
        ]),
      });
      return snapshot;
    });

    await service.reconcileLatest();

    expect(user.syncDeploymentConfig).toHaveBeenCalledWith(snapshot);
  });
});
