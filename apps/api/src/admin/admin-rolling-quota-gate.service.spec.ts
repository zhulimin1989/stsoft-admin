import { AdminService } from './admin.service';

/**
 * 滚动配额 Gate 运行时开关：admin.service 委派 billing + 审计日志。
 * 仅自营套餐配额执行域，权限由 controller(admin.page.coding_quota_templates.*) 与 billing 端共同把关，此处只验委派/审计。
 */
function buildService() {
  const billingClient = {
    getRollingQuotaGate: jest.fn().mockResolvedValue({ effectiveEnabled: false, envForced: false, adminEnabled: null }),
    setRollingQuotaGate: jest.fn().mockResolvedValue({ effectiveEnabled: true, envForced: false, adminEnabled: true }),
  };
  const activityLog = { log: jest.fn() };
  const service = new AdminService(
    {} as any,
    {} as any,
    { get: jest.fn(), set: jest.fn(), del: jest.fn(), keys: jest.fn() } as any,
    { sign: jest.fn(), verify: jest.fn() } as any,
    { get: jest.fn(), getOrThrow: jest.fn() } as any,
    activityLog as any,
    {} as any,
    billingClient as any,
    { syncNow: jest.fn() } as any,
  );
  return { service, billingClient, activityLog };
}

describe('AdminService — 滚动配额 Gate 开关', () => {
  afterEach(() => jest.clearAllMocks());

  it('getRollingQuotaGate 透传 billing 状态', async () => {
    const { service, billingClient } = buildService();
    const res = await service.getRollingQuotaGate();
    expect(billingClient.getRollingQuotaGate).toHaveBeenCalled();
    expect(res).toMatchObject({ effectiveEnabled: false, adminEnabled: null });
  });

  it('setRollingQuotaGate(true, operator) → 调 billing + 记审计(before/after)', async () => {
    const { service, billingClient, activityLog } = buildService();
    const res = await service.setRollingQuotaGate(true, 'admin-1');
    expect(billingClient.setRollingQuotaGate).toHaveBeenCalledWith(true);
    expect(res).toMatchObject({ adminEnabled: true });
    expect(activityLog.log).toHaveBeenCalledWith(
      expect.objectContaining({
        adminMemberId: 'admin-1',
        operatorAdminId: 'admin-1',
        action: 'rolling_quota_gate.update',
        resource: 'SystemConfig',
        resourceId: 'rolling_quota_gate_enabled',
        before: expect.objectContaining({ adminEnabled: null }),
        after: expect.objectContaining({ adminEnabled: true }),
        detail: { enabled: true },
      }),
    );
  });

  it('setRollingQuotaGate(null) 置空继承 env', async () => {
    const { service, billingClient } = buildService();
    await service.setRollingQuotaGate(null, 'admin-1');
    expect(billingClient.setRollingQuotaGate).toHaveBeenCalledWith(null);
  });

  it('无 operator 时仍写库但不记审计', async () => {
    const { service, billingClient, activityLog } = buildService();
    await service.setRollingQuotaGate(false, undefined);
    expect(billingClient.setRollingQuotaGate).toHaveBeenCalledWith(false);
    expect(activityLog.log).not.toHaveBeenCalled();
  });
});
