import { AdminService } from './admin.service';
import { scopedRedisKey } from '../common/utils/redis-key';

describe('AdminService permission cache invalidation', () => {
  let service: AdminService;
  let repo: {
    findRoleById: jest.Mock;
    updateRole: jest.Mock;
    findMemberIdsByRoleId: jest.Mock;
    findAdminMemberById: jest.Mock;
    updateAdminMember: jest.Mock;
  };
  let redis: { del: jest.Mock; get: jest.Mock; set: jest.Mock; keys: jest.Mock };
  let activityLog: { log: jest.Mock };

  beforeEach(() => {
    repo = {
      findRoleById: jest.fn(),
      updateRole: jest.fn(),
      findMemberIdsByRoleId: jest.fn(),
      findAdminMemberById: jest.fn(),
      updateAdminMember: jest.fn(),
    };
    redis = {
      del: jest.fn().mockResolvedValue(1),
      get: jest.fn(),
      set: jest.fn(),
      keys: jest.fn(),
    };
    activityLog = { log: jest.fn() };

    service = new AdminService(
      repo as any,
      {} as any,
      redis as any,
      {} as any,
      { getOrThrow: jest.fn().mockReturnValue('secret') } as any,
      activityLog as any,
      {} as any,
      {} as any,
      { syncNow: jest.fn() } as any,
    );
  });

  it('clears every assigned member permission cache when role permissions change', async () => {
    repo.findRoleById.mockResolvedValue({
      id: 'role-1',
      name: 'Operator',
      key: 'operator',
      permissions: '["admin.dashboard"]',
      isActive: true,
      sortOrder: 10,
      isSystem: false,
      _count: { members: 2 },
    });
    repo.updateRole.mockResolvedValue({
      id: 'role-1',
      name: 'Operator',
      key: 'operator',
      permissions: '["admin.dashboard","admin.users.view"]',
      isActive: true,
      sortOrder: 10,
    });
    repo.findMemberIdsByRoleId.mockResolvedValue(['admin-1', 'admin-2']);

    await service.updateRole(
      'role-1',
      { permissions: '["admin.dashboard","admin.users.view"]' },
      'operator-admin',
    );

    expect(repo.findMemberIdsByRoleId).toHaveBeenCalledWith('role-1');
    expect(redis.del).toHaveBeenCalledWith(scopedRedisKey('admin:perms', 'admin-1'));
    expect(redis.del).toHaveBeenCalledWith(scopedRedisKey('admin:perms', 'admin-2'));
  });

  it('does not clear role member caches for metadata-only role edits', async () => {
    repo.findRoleById.mockResolvedValue({
      id: 'role-1',
      name: 'Operator',
      key: 'operator',
      permissions: '["admin.dashboard"]',
      isActive: true,
      sortOrder: 10,
      isSystem: false,
      _count: { members: 1 },
    });
    repo.updateRole.mockResolvedValue({
      id: 'role-1',
      name: 'Operations',
      key: 'operator',
      permissions: '["admin.dashboard"]',
      isActive: true,
      sortOrder: 10,
    });

    await service.updateRole('role-1', { name: 'Operations' }, 'operator-admin');

    expect(repo.findMemberIdsByRoleId).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it('clears the member permission cache when the member role changes', async () => {
    repo.findAdminMemberById.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      nickname: 'Admin',
      presetRole: 'viewer',
      permissions: '{}',
      isActive: true,
      roleId: 'role-old',
    });
    repo.findRoleById.mockResolvedValue({
      id: 'role-new',
      key: 'operator',
      isActive: true,
    });
    repo.updateAdminMember.mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      nickname: 'Admin',
      presetRole: 'operator',
      permissions: '{}',
      isActive: true,
      roleId: 'role-new',
    });

    await service.updateAdminMember(
      'admin-1',
      { roleId: 'role-new' },
      'operator-admin',
    );

    expect(repo.updateAdminMember).toHaveBeenCalledWith('admin-1', {
      roleId: 'role-new',
      presetRole: 'operator',
    });
    expect(redis.del).toHaveBeenCalledWith(scopedRedisKey('admin:perms', 'admin-1'));
  });
});
