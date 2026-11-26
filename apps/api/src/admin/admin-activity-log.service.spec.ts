import { Test } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { AdminActivityLogService } from './admin-activity-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { clearAdminRequestContext, setAdminRequestContext } from '../common/request/admin-context';

function makeLogEntry(overrides: Partial<{
  id: string;
  adminMemberId: string;
  action: string;
  operatorAdminId: string | null;
  resource: string | null;
  resourceId: string | null;
  requestId: string | null;
  beforeState: string | null;
  afterState: string | null;
  ip: string | null;
  userAgent: string | null;
  detail: string;
  createdAt: Date;
}> = {}) {
  return {
    id: 'log-1',
    adminMemberId: 'admin-1',
    action: 'USER_BAN',
    operatorAdminId: null,
    resource: null,
    resourceId: null,
    requestId: null,
    beforeState: null,
    afterState: null,
    ip: '127.0.0.1',
    userAgent: 'Mozilla/5.0',
    detail: '{}',
    createdAt: new Date('2025-01-01'),
    ...overrides,
  };
}

function makePrisma() {
  return {
    adminActivityLog: {
      create: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
  };
}

async function buildService(prismaOverrides = {}) {
  const prisma = { ...makePrisma(), ...prismaOverrides };
  const m = await Test.createTestingModule({
    providers: [
      AdminActivityLogService,
      { provide: PrismaService, useValue: prisma },
    ],
  }).compile();
  return { service: m.get(AdminActivityLogService) as AdminActivityLogService, prisma };
}

// ============================================================
// AdminActivityLogService.log
// ============================================================
describe('AdminActivityLogService.log', () => {
  afterEach(() => {
    clearAdminRequestContext();
  });

  it('creates a log entry with all provided fields', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());

    await service.log({
      adminMemberId: 'admin-1',
      action: 'USER_BAN',
      operatorAdminId: 'op-1',
      resource: 'AdminMember',
      resourceId: 'admin-target-1',
      requestId: 'req-explicit',
      before: { isActive: true },
      after: { isActive: false },
      ip: '192.168.1.1',
      userAgent: 'Chrome/100',
      detail: { targetUserId: 'user-abc' },
    });

    expect(prisma.adminActivityLog.create).toHaveBeenCalledWith({
      data: {
        adminMemberId: 'admin-1',
        action: 'USER_BAN',
        operatorAdminId: 'op-1',
        resource: 'AdminMember',
        resourceId: 'admin-target-1',
        requestId: 'req-explicit',
        beforeState: JSON.stringify({ isActive: true }),
        afterState: JSON.stringify({ isActive: false }),
        ip: '192.168.1.1',
        userAgent: 'Chrome/100',
        detail: JSON.stringify({ targetUserId: 'user-abc' }),
      },
    });
  });

  it('creates log with null for missing optional fields', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());

    await service.log({
      adminMemberId: 'admin-1',
      action: 'LOGIN',
    });

    expect(prisma.adminActivityLog.create).toHaveBeenCalledWith({
      data: {
        adminMemberId: 'admin-1',
        action: 'LOGIN',
        operatorAdminId: null,
        resource: null,
        resourceId: null,
        requestId: null,
        beforeState: null,
        afterState: null,
        ip: null,
        userAgent: null,
        detail: '{}',
      },
    });
  });

  it('stringifies detail object as JSON', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());

    await service.log({
      adminMemberId: 'admin-1',
      action: 'PLAN_CHANGE',
      detail: { from: 'free', to: 'pro', amount: 999 },
    });

    const createArg = prisma.adminActivityLog.create.mock.calls[0][0].data;
    expect(createArg.detail).toBe('{"from":"free","to":"pro","amount":999}');
  });

  it('uses current admin request id when no explicit request id is provided', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());
    setAdminRequestContext({ adminId: 'admin-1', requestId: 'req-from-context' });

    await service.log({ adminMemberId: 'admin-1', action: 'PLAN_CHANGE' });

    const createArg = prisma.adminActivityLog.create.mock.calls[0][0].data;
    expect(createArg.requestId).toBe('req-from-context');
  });

  it('stores empty object JSON when no detail provided', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());

    await service.log({ adminMemberId: 'admin-1', action: 'LOGOUT' });

    const createArg = prisma.adminActivityLog.create.mock.calls[0][0].data;
    expect(createArg.detail).toBe('{}');
  });

  it('does not throw when create fails (fire-and-forget)', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockRejectedValue(new Error('DB error'));

    // Should not throw — business flow must not be blocked by audit failures
    await expect(
      service.log({ adminMemberId: 'admin-1', action: 'ACTION' }),
    ).resolves.toBeUndefined();
  });

  it('emits logger.warn when create fails (not silent)', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockRejectedValue(new Error('DB exploded'));
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await service.log({ adminMemberId: 'admin-7', action: 'RECHARGE' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const msg = warnSpy.mock.calls[0][0] as string;
    expect(msg).toContain('audit log persist failed');
    expect(msg).toContain('action=RECHARGE');
    expect(msg).toContain('adminMemberId=admin-7');
    expect(msg).toContain('DB exploded');

    warnSpy.mockRestore();
  });

  it('logger.warn handles non-Error rejections gracefully', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockRejectedValue('raw string failure');
    const warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});

    await service.log({ adminMemberId: 'admin-1', action: 'X' });

    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain('raw string failure');
    warnSpy.mockRestore();
  });

  it('returns void (undefined) after logging', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.create.mockResolvedValue(makeLogEntry());

    const result = await service.log({ adminMemberId: 'admin-1', action: 'PING' });
    expect(result).toBeUndefined();
  });
});

// ============================================================
// AdminActivityLogService.listByMember
// ============================================================
describe('AdminActivityLogService.listByMember', () => {
  it('returns paginated result with items, total, page, pageSize', async () => {
    const { service, prisma } = await buildService();
    const items = [makeLogEntry(), makeLogEntry({ id: 'log-2', action: 'USER_UNBAN' })];
    prisma.adminActivityLog.findMany.mockResolvedValue(items);
    prisma.adminActivityLog.count.mockResolvedValue(25);

    const result = await service.listByMember('admin-1', 2, 10);

    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(25);
    expect(result.page).toBe(2);
    expect(result.pageSize).toBe(10);
  });

  it('queries with correct where clause for adminMemberId', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.findMany.mockResolvedValue([]);
    prisma.adminActivityLog.count.mockResolvedValue(0);

    await service.listByMember('admin-42', 1, 20);

    expect(prisma.adminActivityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { adminMemberId: 'admin-42' } }),
    );
    expect(prisma.adminActivityLog.count).toHaveBeenCalledWith({
      where: { adminMemberId: 'admin-42' },
    });
  });

  it('orders by createdAt desc', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.findMany.mockResolvedValue([]);
    prisma.adminActivityLog.count.mockResolvedValue(0);

    await service.listByMember('admin-1', 1, 10);

    expect(prisma.adminActivityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: 'desc' } }),
    );
  });

  it('calculates correct skip for page 1', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.findMany.mockResolvedValue([]);
    prisma.adminActivityLog.count.mockResolvedValue(0);

    await service.listByMember('admin-1', 1, 10);

    expect(prisma.adminActivityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 10 }),
    );
  });

  it('calculates correct skip for page 3 with pageSize 5', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.findMany.mockResolvedValue([]);
    prisma.adminActivityLog.count.mockResolvedValue(0);

    await service.listByMember('admin-1', 3, 5);

    expect(prisma.adminActivityLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it('runs findMany and count in parallel via Promise.all', async () => {
    const { service, prisma } = await buildService();
    let findResolved = false;
    let countResolved = false;

    prisma.adminActivityLog.findMany.mockImplementation(async () => {
      findResolved = true;
      return [];
    });
    prisma.adminActivityLog.count.mockImplementation(async () => {
      countResolved = true;
      return 0;
    });

    await service.listByMember('admin-1', 1, 10);

    expect(findResolved).toBe(true);
    expect(countResolved).toBe(true);
  });

  it('returns empty items array and total=0 when no logs', async () => {
    const { service, prisma } = await buildService();
    prisma.adminActivityLog.findMany.mockResolvedValue([]);
    prisma.adminActivityLog.count.mockResolvedValue(0);

    const result = await service.listByMember('admin-1', 1, 10);

    expect(result.items).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns log entries with expected fields', async () => {
    const { service, prisma } = await buildService();
    const entry = makeLogEntry({
      id: 'log-3',
      action: 'RECHARGE',
      operatorAdminId: 'op-5',
      ip: '10.0.0.1',
    });
    prisma.adminActivityLog.findMany.mockResolvedValue([entry]);
    prisma.adminActivityLog.count.mockResolvedValue(1);

    const result = await service.listByMember('admin-1', 1, 10);

    expect(result.items[0].id).toBe('log-3');
    expect(result.items[0].action).toBe('RECHARGE');
    expect(result.items[0].operatorAdminId).toBe('op-5');
  });
});
