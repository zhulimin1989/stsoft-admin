import { AdminService } from './admin.service';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('AdminService - User Management Proxy', () => {
  let service: AdminService;
  let repo: {
    findAdminMemberForAuth: jest.Mock;
  };
  let prisma: {
    adminMember: {
      update: jest.Mock;
    };
  };
  let jwt: {
    sign: jest.Mock;
    verify: jest.Mock;
  };
  let activityLog: {
    log: jest.Mock;
    listByMember: jest.Mock;
  };
  let userClient: {
    createUser: jest.Mock;
    resetUserPassword: jest.Mock;
    listUsers: jest.Mock;
    searchUsers: jest.Mock;
    getUser: jest.Mock;
  };
  let billingClient: {
    applyClassifiedBalanceAdjustment: jest.Mock;
  };

  beforeEach(() => {
    repo = {
      findAdminMemberForAuth: jest.fn(),
    };
    prisma = {
      adminMember: {
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    jwt = {
      sign: jest.fn((_: unknown, options?: { secret?: string }) =>
        options?.secret ? 'refresh-token' : 'access-token',
      ),
      verify: jest.fn(),
    };
    activityLog = {
      log: jest.fn(),
      listByMember: jest.fn(),
    };
    userClient = {
      createUser: jest.fn(),
      resetUserPassword: jest.fn(),
      listUsers: jest.fn(),
      searchUsers: jest.fn(),
      getUser: jest.fn(),
    };
    billingClient = {
      applyClassifiedBalanceAdjustment: jest.fn(),
    };

    service = new AdminService(
      repo as any,
      prisma as any,
      { get: jest.fn(), set: jest.fn(), del: jest.fn(), keys: jest.fn() } as any,
      jwt as any,
      { getOrThrow: jest.fn().mockReturnValue('secret') } as any,
      activityLog as any,
      userClient as any,
      billingClient as any,
      { syncNow: jest.fn() } as any,
    );
  });

  it('delegates createUser to user-api internal client', async () => {
    const created = { id: '1', email: 'test@t.com', nickname: 'T' };
    userClient.createUser.mockResolvedValue(created);

    const result = await service.createUser({ email: 'test@t.com', nickname: 'T' }, 'admin-1');

    expect(result).toBe(created);
    expect(userClient.createUser).toHaveBeenCalledWith(
      { email: 'test@t.com', nickname: 'T' },
      'admin-1',
    );
  });

  it('delegates listUsers and searchUsers to user-api internal client', async () => {
    userClient.listUsers.mockResolvedValue({ items: [], total: 0 });
    userClient.searchUsers.mockResolvedValue({ items: [{ id: '1' }], total: 1 });

    await expect(service.listUsers(1, 20)).resolves.toEqual({ items: [], total: 0 });
    await expect(
      service.searchUsers({ search: 'a', page: 1, pageSize: 20 }),
    ).resolves.toEqual({ items: [{ id: '1' }], total: 1 });

    expect(userClient.listUsers).toHaveBeenCalledWith(1, 20);
    expect(userClient.searchUsers).toHaveBeenCalledWith({ search: 'a', page: 1, pageSize: 20 });
  });

  it('delegates resetUserPassword to user-api internal client', async () => {
    userClient.resetUserPassword.mockResolvedValue({ temporaryPassword: 'tmp' });

    await expect(service.resetUserPassword('user-1', 'admin-1')).resolves.toEqual({
      temporaryPassword: 'tmp',
    });

    expect(userClient.resetUserPassword).toHaveBeenCalledWith('user-1', 'admin-1');
  });

  it('routes classified balance adjustments directly to billing with a user snapshot', async () => {
    userClient.getUser.mockResolvedValue({
      id: 'user-1',
      email: 'user@example.com',
      nickname: 'Example',
      isActive: true,
    });
    billingClient.applyClassifiedBalanceAdjustment.mockResolvedValue({
      direction: 'CREDIT',
      reasonCode: 'DISCOUNT_CORRECTION',
      amountCents: 1000,
      balanceAfterCents: 3000,
      transaction: { id: 'tx-adjust-1' },
    });

    await expect(service.adjustBalance(
      'user-1',
      1000,
      'DISCOUNT_CORRECTION',
      'August correction',
      'admin-1',
      'adjustment-key-1',
    )).resolves.toMatchObject({ transaction: { id: 'tx-adjust-1' } });

    expect(billingClient.applyClassifiedBalanceAdjustment).toHaveBeenCalledWith('user-1', {
      amountCents: 1000,
      reasonCode: 'DISCOUNT_CORRECTION',
      description: 'August correction',
      performedBy: 'admin-1',
      idempotencyKey: 'adjustment-key-1',
      user: {
        id: 'user-1',
        email: 'user@example.com',
        phone: null,
        nickname: 'Example',
        isActive: true,
      },
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'user.balance.billing_adjustment',
      resourceId: 'user-1',
      detail: expect.objectContaining({ transactionId: 'tx-adjust-1' }),
    }));
  });

  it('signs admin access tokens with an explicit 15 minute expiry', async () => {
    repo.findAdminMemberForAuth.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      password: 'hash',
      nickname: 'Admin',
      presetRole: 'operator',
      roleId: null,
      permissions: '{}',
      isActive: true,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    await expect(service.adminLogin('admin@example.com', 'secret')).resolves.toEqual(
      expect.objectContaining({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      }),
    );

    expect(jwt.sign).toHaveBeenNthCalledWith(
      1,
      {
        sub: 'admin-1',
        adminId: 'admin-1',
        presetRole: 'operator',
      },
      { expiresIn: '15m' },
    );
    expect(jwt.sign).toHaveBeenNthCalledWith(
      2,
      {
        sub: 'admin-1',
        adminId: 'admin-1',
        jti: expect.any(String),
      },
      { secret: 'secret_admin_refresh', expiresIn: '7d' },
    );
  });

  it('returns all code-defined permissions for super admin even when role permissions are stale', async () => {
    repo.findAdminMemberForAuth.mockResolvedValue({
      id: 'root-admin',
      email: 'root@example.com',
      password: 'hash',
      nickname: 'Root',
      presetRole: 'super_admin',
      roleId: 'stale-super-admin-role',
      permissions: '{"admin.enterprise_accounts.review":false}',
      isActive: true,
    });
    (bcrypt.compare as jest.Mock).mockResolvedValue(true);

    const result = await service.adminLogin('root@example.com', 'secret');

    expect(result.user.resolvedPermissions).toContain('admin.enterprise_accounts.review');
    expect(result.user.resolvedPermissions).toContain('admin.members.manage');
  });
});
