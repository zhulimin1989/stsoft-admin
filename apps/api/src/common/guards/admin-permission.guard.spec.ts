import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminPermissionGuard } from './admin-permission.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  ADMIN_NO_PERMISSION_REQUIRED_KEY,
  ADMIN_PERMISSION_KEY,
} from '../decorators/admin-permission.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { scopedRedisKey } from '../utils/redis-key';

describe('AdminPermissionGuard', () => {
  let guard: AdminPermissionGuard;
  let reflector: Reflector;
  let prisma: { adminMember: { findUnique: jest.Mock } };
  let redis: { get: jest.Mock; set: jest.Mock };

  beforeEach(() => {
    reflector = new Reflector();
    prisma = { adminMember: { findUnique: jest.fn() } };
    redis = { get: jest.fn(), set: jest.fn() };
    guard = new AdminPermissionGuard(
      reflector,
      prisma as unknown as PrismaService,
      redis as unknown as RedisService,
    );
  });

  function createMockContext(user?: { id: string; adminPermissions?: string[] }): ExecutionContext {
    const request = { user };
    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  function mockMetadata(input: {
    isPublic?: boolean;
    requiredPermissions?: string[];
    noPermissionRequired?: boolean;
  }) {
    jest.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: string) => {
      if (key === IS_PUBLIC_KEY) return input.isPublic as never;
      if (key === ADMIN_PERMISSION_KEY) return input.requiredPermissions as never;
      if (key === ADMIN_NO_PERMISSION_REQUIRED_KEY) return input.noPermissionRequired as never;
      return undefined as never;
    });
  }

  it('should deny admin routes without explicit permission metadata', async () => {
    mockMetadata({});
    const ctx = createMockContext();
    await expect(guard.canActivate(ctx)).rejects.toThrow('后台接口缺少权限配置');
  });

  it('should allow public routes without admin permission metadata', async () => {
    mockMetadata({ isPublic: true });
    const ctx = createMockContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(redis.get).not.toHaveBeenCalled();
    expect(prisma.adminMember.findUnique).not.toHaveBeenCalled();
  });

  it('should allow authenticated routes explicitly marked as no-permission-required', async () => {
    mockMetadata({ noPermissionRequired: true });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'viewer',
        permissions: null,
        isActive: true,
        roleId: null,
        role: null,
      },
    );
    redis.set.mockResolvedValue('OK');

    const ctx = createMockContext({ id: 'admin-profile' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const request = ctx.switchToHttp().getRequest() as { user?: { adminPermissions?: string[] } };
    expect(request.user?.adminPermissions).toContain('admin.dashboard');
  });

  it('should deny access when user has no admin permissions', async () => {
    mockMetadata({ requiredPermissions: ['admin.users.manage'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'viewer',
        permissions: null,
        isActive: true,
        roleId: null,
        role: null,
      },
    );
    redis.set.mockResolvedValue('OK');

    const ctx = createMockContext({ id: 'admin-1' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should allow access when admin has required permission', async () => {
    mockMetadata({ requiredPermissions: ['admin.dashboard'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'viewer',
        permissions: null,
        isActive: true,
        roleId: null,
        role: null,
      },
    );
    redis.set.mockResolvedValue('OK');

    const ctx = createMockContext({ id: 'admin-2' });
    expect(await guard.canActivate(ctx)).toBe(true);
    const request = ctx.switchToHttp().getRequest() as { user?: { adminPermissions?: string[] } };
    expect(request.user?.adminPermissions).toContain('admin.dashboard');
  });

  it('should grant super admin all code-defined permissions despite stale role permissions and false overrides', async () => {
    mockMetadata({ requiredPermissions: ['admin.enterprise_accounts.review'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'super_admin',
        permissions: '{"admin.enterprise_accounts.review":false}',
        isActive: true,
        roleId: 'stale-super-admin-role',
        role: {
          permissions: '["admin.dashboard"]',
          isActive: true,
        },
      },
    );
    redis.set.mockResolvedValue('OK');

    const ctx = createMockContext({ id: 'root-admin' });
    expect(await guard.canActivate(ctx)).toBe(true);

    const request = ctx.switchToHttp().getRequest() as { user?: { adminPermissions?: string[] } };
    expect(request.user?.adminPermissions).toContain('admin.enterprise_accounts.review');
    expect(request.user?.adminPermissions).toContain('admin.members.manage');
  });

  it('should deny access when admin is inactive', async () => {
    mockMetadata({ requiredPermissions: ['admin.dashboard'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'admin',
        permissions: null,
        isActive: false,
        roleId: null,
        role: null,
      },
    );

    const ctx = createMockContext({ id: 'admin-3' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should use Redis cache on subsequent calls', async () => {
    mockMetadata({ requiredPermissions: ['admin.dashboard'] });
    redis.get.mockResolvedValue(
      JSON.stringify(['admin.dashboard', 'admin.users.view']),
    );

    const ctx = createMockContext({ id: 'admin-4' });
    expect(await guard.canActivate(ctx)).toBe(true);
    expect(prisma.adminMember.findUnique).not.toHaveBeenCalled();
  });

  it('expands legacy permissions read from Redis for page-level checks', async () => {
    mockMetadata({ requiredPermissions: ['admin.page.finance_reports.view'] });
    redis.get.mockResolvedValue(JSON.stringify(['admin.revenue.view']));

    const ctx = createMockContext({ id: 'legacy-finance-admin' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    const request = ctx.switchToHttp().getRequest() as { user?: { adminPermissions?: string[] } };
    expect(request.user?.adminPermissions).toContain('admin.page.finance_reports.export');
    expect(prisma.adminMember.findUnique).not.toHaveBeenCalled();
  });

  it('keeps leaf page grants isolated from sibling pages', async () => {
    mockMetadata({ requiredPermissions: ['admin.page.subscription_booster_packs.view'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue({
      presetRole: 'custom',
      permissions: null,
      isActive: true,
      roleId: 'role-plans-only',
      role: {
        permissions: '["admin.page.subscription_plans.view"]',
        isActive: true,
      },
    });
    redis.set.mockResolvedValue('OK');

    const ctx = createMockContext({ id: 'plans-only-admin' });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it('should deny access when admin not found in database', async () => {
    mockMetadata({ requiredPermissions: ['admin.dashboard'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(null);
    const context = createMockContext({ id: 'nonexistent-admin' });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('encodes admin id before using it in Redis cache keys', async () => {
    mockMetadata({ requiredPermissions: ['admin.dashboard'] });
    redis.get.mockResolvedValue(null);
    prisma.adminMember.findUnique.mockResolvedValue(
      {
        presetRole: 'viewer',
        permissions: null,
        isActive: true,
        roleId: null,
        role: null,
      },
    );
    redis.set.mockResolvedValue('OK');

    const adminId = 'admin-1\r\nSET injected 1';
    const context = createMockContext({ id: adminId });
    expect(await guard.canActivate(context)).toBe(true);

    const expectedKey = scopedRedisKey('admin:perms', adminId);
    expect(redis.get).toHaveBeenCalledWith(expectedKey);
    expect(redis.set).toHaveBeenCalledWith(
      expectedKey,
      expect.any(String),
      'EX',
      expect.any(Number),
    );
    expect(expectedKey).not.toContain('\r');
    expect(expectedKey).not.toContain('\n');
  });
});
