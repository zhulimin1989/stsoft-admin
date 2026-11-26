import { AdminRepository } from './admin.repository';
import { PrismaService } from '../prisma/prisma.service';

interface PrismaMock {
  auditLog: {
    findMany: jest.Mock;
    count: jest.Mock;
  };
  adminMember: {
    create: jest.Mock;
    delete: jest.Mock;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  $queryRawUnsafe: jest.Mock;
  $queryRaw: jest.Mock;
}

describe('AdminRepository.updateAdminMember (regression after raw SQL removal)', () => {
  let prisma: PrismaMock;
  let repo: AdminRepository;

  beforeEach(() => {
    prisma = {
      auditLog: {
        findMany: jest.fn(),
        count: jest.fn(),
      },
      adminMember: {
        create: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      $queryRawUnsafe: jest.fn(), // guard against accidental reintroduction
      $queryRaw: jest.fn(),
    };
    repo = new AdminRepository(prisma as unknown as PrismaService);
  });

  function row(overrides: Record<string, unknown> = {}) {
    return {
      id: 'a1',
      email: 'admin@test',
      password: '',
      nickname: 'n',
      preset_role: 'ADMIN',
      permissions: '{}',
      is_active: true,
      role_id: null,
      name: '',
      phone: null,
      department: null,
      invited_by: null,
      created_at: new Date(),
      updated_at: new Date(),
      last_login_at: null,
      password_changed_at: null,
      must_change_password: false,
      ...overrides,
    };
  }

  it('uses prisma.adminMember.update, NOT $queryRawUnsafe', async () => {
    prisma.adminMember.update.mockResolvedValue(row({ name: 'Alice' }));
    await repo.updateAdminMember('a1', { name: 'Alice' });
    expect(prisma.adminMember.update).toHaveBeenCalledTimes(1);
    expect(prisma.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('applies audit log search to both page data and total count', async () => {
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);

    await repo.findAuditLogs(0, 50, {
      action: 'update',
      resource: 'user',
      search: 'user-1',
    });
    await repo.countAuditLogs({
      action: 'update',
      resource: 'user',
      search: 'user-1',
    });

    const expectedWhere = {
      action: 'update',
      resource: 'user',
      OR: [
        { userId: { contains: 'user-1', mode: 'insensitive' } },
        { targetUserId: { contains: 'user-1', mode: 'insensitive' } },
        { resourceId: { contains: 'user-1', mode: 'insensitive' } },
      ],
    };
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: expectedWhere,
      orderBy: { createdAt: 'desc' },
      skip: 0,
      take: 50,
    });
    expect(prisma.auditLog.count).toHaveBeenCalledWith({ where: expectedWhere });
  });

  it('uses prisma.adminMember.findUnique for admin auth lookup', async () => {
    prisma.adminMember.findUnique.mockResolvedValue(row({ email: 'root@test' }));
    const out = await repo.findAdminMemberForAuth('root@test');
    expect(prisma.adminMember.findUnique).toHaveBeenCalledWith({
      where: { email: 'root@test' },
    });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
    expect(out?.email).toBe('root@test');
  });

  it('uses prisma.adminMember.findMany for member role listing', async () => {
    prisma.adminMember.findMany.mockResolvedValue([
      { ...row({ id: 'a1' }), role: { name: '运营' } },
    ]);
    const out = await repo.findAdminMembers();
    expect(prisma.adminMember.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      include: { role: { select: { name: true } } },
    });
    expect(out[0].roleName).toBe('运营');
  });

  it('uses prisma.adminMember.create for member creation', async () => {
    prisma.adminMember.create.mockResolvedValue(row({ id: 'created' }));
    const out = await repo.createAdminMember({
      email: 'new@test',
      password: 'hash',
      nickname: 'new',
      presetRole: 'viewer',
      invitedBy: 'inviter',
      roleId: 'role-1',
      mustChangePassword: true,
    });
    expect(prisma.adminMember.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'new@test',
          roleId: 'role-1',
          mustChangePassword: true,
        }),
      }),
    );
    expect(out.id).toBe('created');
  });

  it('uses prisma.adminMember.update for password resets', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    const passwordChangedAt = new Date('2026-01-01T00:00:00Z');
    await repo.updateAdminMemberPassword('a1', {
      password: 'new-hash',
      mustChangePassword: true,
      passwordChangedAt,
    });
    expect(prisma.adminMember.update).toHaveBeenCalledWith({
      where: { id: 'a1' },
      data: {
        password: 'new-hash',
        mustChangePassword: true,
        passwordChangedAt,
      },
    });
  });

  it('accepts partial update with single scalar field', async () => {
    prisma.adminMember.update.mockResolvedValue(row({ preset_role: 'SUPER_ADMIN' }));
    await repo.updateAdminMember('a1', { presetRole: 'SUPER_ADMIN' });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'a1' });
    expect(call.data).toEqual({ presetRole: 'SUPER_ADMIN' });
  });

  it('accepts full update across all fields', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    await repo.updateAdminMember('a1', {
      presetRole: 'ADMIN',
      permissions: '{"x":1}',
      isActive: false,
      roleId: 'r1',
      name: 'Bob',
      phone: '+8613800000000',
      department: 'Eng',
    });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data).toMatchObject({
      presetRole: 'ADMIN',
      permissions: '{"x":1}',
      isActive: false,
      name: 'Bob',
      phone: '+8613800000000',
      department: 'Eng',
    });
    // roleId uses relation connect
    expect(call.data.role).toEqual({ connect: { id: 'r1' } });
  });

  it('null roleId triggers disconnect (clears the relation)', async () => {
    prisma.adminMember.update.mockResolvedValue(row({ role_id: null }));
    await repo.updateAdminMember('a1', { roleId: null });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data.role).toEqual({ disconnect: true });
  });

  it('null phone clears phone', async () => {
    prisma.adminMember.update.mockResolvedValue(row({ phone: null }));
    await repo.updateAdminMember('a1', { phone: null });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data.phone).toBeNull();
  });

  it('null department clears department', async () => {
    prisma.adminMember.update.mockResolvedValue(row({ department: null }));
    await repo.updateAdminMember('a1', { department: null });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data.department).toBeNull();
  });

  it('undefined fields are NOT included in update data (preserves partial semantics)', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    await repo.updateAdminMember('a1', { presetRole: 'ADMIN' });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('permissions');
    expect(call.data).not.toHaveProperty('isActive');
    expect(call.data).not.toHaveProperty('roleId');
    expect(call.data).not.toHaveProperty('role');
    expect(call.data).not.toHaveProperty('name');
    expect(call.data).not.toHaveProperty('phone');
    expect(call.data).not.toHaveProperty('department');
  });

  it('does NOT attempt to write updated_at — Prisma @updatedAt handles it', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    await repo.updateAdminMember('a1', { name: 'C' });
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data).not.toHaveProperty('updatedAt');
    expect(call.data).not.toHaveProperty('updated_at');
  });

  it('empty update input produces empty data (caller decides whether this is valid)', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    await repo.updateAdminMember('a1', {});
    const call = prisma.adminMember.update.mock.calls[0][0];
    expect(call.data).toEqual({});
    expect(call.where).toEqual({ id: 'a1' });
  });

  it('does not accept arbitrary field names (type-level, verified by TS)', async () => {
    prisma.adminMember.update.mockResolvedValue(row());
    // @ts-expect-error — "is_active" (snake_case) is rejected at compile time
    await repo.updateAdminMember('a1', { is_active: true });
    // Runtime: the raw key flows through; but since TS would reject it, the
    // key-name-injection attack surface in admin APIs is closed at the boundary.
  });

  it('propagates Prisma errors (e.g., record not found)', async () => {
    const err = Object.assign(new Error('Record not found'), { code: 'P2025' });
    prisma.adminMember.update.mockRejectedValue(err);
    await expect(repo.updateAdminMember('missing', { name: 'X' })).rejects.toThrow(/Record not found/);
  });

  it('passes the row through normalizeAdminMember (camelCase output)', async () => {
    prisma.adminMember.update.mockResolvedValue(row({
      id: 'a1',
      preset_role: 'ADMIN',
      is_active: true,
      role_id: 'r9',
      must_change_password: true,
    }));
    const out = await repo.updateAdminMember('a1', { presetRole: 'ADMIN' });
    expect(out).toMatchObject({
      id: 'a1',
      presetRole: 'ADMIN',
      isActive: true,
      roleId: 'r9',
      mustChangePassword: true,
    });
  });

  it('connect + explicit empty string roleId — current behavior: connects with empty id', async () => {
    // Edge case: empty-string roleId is truthy-checked (=== falsy path for null/undefined only).
    // Actually '' is falsy → should go disconnect. Document current behavior.
    prisma.adminMember.update.mockResolvedValue(row());
    await repo.updateAdminMember('a1', { roleId: '' });
    const call = prisma.adminMember.update.mock.calls[0][0];
    // Empty string is falsy, so we should disconnect
    expect(call.data.role).toEqual({ disconnect: true });
  });
});

describe('AdminRepository deployment config version guards', () => {
  it('updates only the expected source version and increments it once', async () => {
    const row = { key: 'deploymentConfig', value: '{"region":"domestic"}', version: 8n };
    const systemConfig = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn(),
    };
    const repo = new AdminRepository({ systemConfig } as unknown as PrismaService);

    await expect(repo.upsertDeploymentConfig(row.value, 7n)).resolves.toEqual(row);
    expect(systemConfig.updateMany).toHaveBeenCalledWith({
      where: { key: 'deploymentConfig', version: 7n },
      data: { value: row.value, version: 8n },
    });
    expect(systemConfig.create).not.toHaveBeenCalled();
  });

  it('does not let an older reconciliation overwrite newer sync status', async () => {
    const systemConfig = {
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({
        key: 'deploymentConfigSyncStatus',
        version: 9n,
      }),
      create: jest.fn(),
    };
    const repo = new AdminRepository({ systemConfig } as unknown as PrismaService);

    await repo.upsertDeploymentConfigSyncStatus('{"version":"8"}', 8n);

    expect(systemConfig.updateMany).toHaveBeenCalledWith({
      where: { key: 'deploymentConfigSyncStatus', version: { lte: 8n } },
      data: { value: '{"version":"8"}', version: 8n },
    });
    expect(systemConfig.create).not.toHaveBeenCalled();
  });
});
