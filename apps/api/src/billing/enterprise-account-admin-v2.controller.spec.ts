import { BadRequestException } from '@nestjs/common';
import { clearAdminRequestContext, runWithAdminRequestContext } from '../common/request/admin-context';
import { EnterpriseAccountAdminV2Controller } from './enterprise-account-admin-v2.controller';

describe('EnterpriseAccountAdminV2Controller', () => {
  it('binds the certification snapshot to the account verification ID across released histories and preserves assisted metadata',async()=>{
    const billing={getEnterpriseAccount:jest.fn().mockResolvedValue({id:'account-a',ownerUserId:'owner-a',verificationId:'current-ver'})};
    const user={getUser:jest.fn().mockResolvedValue({id:'owner-a'}),getUserVerifications:jest.fn().mockResolvedValue([
      {id:'released-ver',type:'ENTERPRISE',status:'VERIFIED',releasedAt:'2026-10-01',creationSource:'SELF_SERVICE'},
      {id:'current-ver',type:'ENTERPRISE',status:'VERIFIED',creationSource:'ADMIN_ASSISTED',verificationMethod:'ADMIN_OFFLINE',paymentMode:'ADMIN_WAIVED'},
    ])};
    const bills={summarizeEnterpriseBills:jest.fn().mockResolvedValue({items:[]})};const controller=new EnterpriseAccountAdminV2Controller(billing as never,bills as never,user as never,{log:jest.fn()} as never);
    const result=await controller.detail('account-a');expect((result.data as any).ownerVerification).toMatchObject({id:'current-ver',creationSource:'ADMIN_ASSISTED',paymentMode:'ADMIN_WAIVED'});
    user.getUserVerifications.mockResolvedValue([{id:'released-ver',type:'ENTERPRISE',status:'VERIFIED'}] as never);
    expect(((await controller.detail('account-a')).data as any).ownerVerification).toBeNull();
  });
  afterEach(() => {
    clearAdminRequestContext();
  });

  it('enriches the list with earliest due date, due warning and plaintext phone', async () => {
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({
        items: [{
          id: 'ba-1',
          ownerUserId: 'u-1',
          enterpriseName: '示例公司',
          credit: {
            limitCents: 10_000,
            usedCents: 100,
            remainingCents: 9_900,
            activeLimitCents: 10_000,
            accountBalanceCents: 1_000,
            // Stale: balance + full limit (billing outstanding used = 0)
            accountAvailableBalanceCents: 11_000,
          },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn().mockResolvedValue({
        items: [{
          billingAccountId: 'ba-1',
          earliestDueAt: '2026-09-12T15:59:59.000Z',
          dueWarning: true,
          usedCents: 780,
          prepaid: false,
        }],
      }),
    };
    const user = {
      getUser: jest.fn(),
      getUserContactsByIds: jest.fn().mockResolvedValue({
        items: [{ id: 'u-1', phone: '13800138000', email: 'owner@example.com' }],
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '20' }));

    expect(user.getUserContactsByIds).toHaveBeenCalledWith(['u-1']);
    expect(user.getUser).not.toHaveBeenCalled();
    expect(bills.summarizeEnterpriseBills).toHaveBeenCalledWith(['ba-1']);
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: expect.objectContaining({
        items: [expect.objectContaining({
          id: 'ba-1',
          phone: '13800138000',
          email: 'owner@example.com',
          earliestDueAt: '2026-09-12T15:59:59.000Z',
          earliestDueProjected: false,
          dueWarning: true,
          credit: expect.objectContaining({
            usedCents: 100,
            remainingCents: 9_900,
            accountAvailableBalanceCents: 11_000,
          }),
        })],
      }),
    });
  });

  it('list 余额列用最新一条余额流水的变动后余额覆盖钱包快照', async () => {
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({
        items: [{
          id: 'ba-1',
          ownerUserId: 'u-1',
          ledgerBalanceAfterCents: -14,
          credit: {
            usedCents: 100,
            remainingCents: 9_900,
            accountBalanceCents: 1_000,
            accountAvailableBalanceCents: 11_000,
          },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn().mockResolvedValue({ items: [] }),
    };
    const user = {
      getUserContactsByIds: jest.fn().mockResolvedValue({
        items: [{ id: 'u-1', phone: '13800138000', email: 'owner@example.com' }],
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '20' }));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: expect.objectContaining({
        items: [expect.objectContaining({
          credit: expect.objectContaining({
            accountBalanceCents: -14,
            accountAvailableBalanceCents: 11_000,
          }),
        })],
      }),
    });
  });

  it('list 无余额流水时余额列为空，不回退钱包快照', async () => {
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({
        items: [{
          id: 'ba-1',
          ownerUserId: 'u-1',
          ledgerBalanceAfterCents: null,
          credit: {
            accountBalanceCents: 1_000,
            accountAvailableBalanceCents: 11_000,
          },
        }],
        total: 1,
        page: 1,
        pageSize: 20,
      }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn().mockResolvedValue({ items: [] }),
    };
    const user = {
      getUserContactsByIds: jest.fn().mockResolvedValue({
        items: [{ id: 'u-1', phone: null, email: null }],
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '20' }));

    const items = (result.data as { items: Array<{ credit?: { accountBalanceCents?: number | null } }> }).items;
    expect(items[0]?.credit?.accountBalanceCents).toBeNull();
  });

  it('keeps V1 funding occupancy on detail when bill summary usedCents differs', async () => {
    const billing = {
      getEnterpriseAccount: jest.fn().mockResolvedValue({
        id: 'ba-1',
        ownerUserId: 'u-1',
        enterpriseName: '示例公司',
        credit: {
          limitCents: 1_000,
          usedCents: 52,
          usedUsd: 0.52,
          remainingCents: 948,
          activeLimitCents: 1_000,
          accountBalanceCents: 0,
          accountAvailableBalanceCents: 948,
        },
      }),
      listEnterpriseAccountOwnerMembers: jest.fn().mockResolvedValue({ items: [] }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn().mockResolvedValue({
        items: [{
          billingAccountId: 'ba-1',
          earliestDueAt: '2026-09-12T15:59:59.000Z',
          dueWarning: true,
          usedCents: 1_549,
          prepaid: false,
        }],
      }),
    };
    const user = {
      getUser: jest.fn().mockResolvedValue({ phone: '13800138000', email: 'owner@example.com' }),
      getUserVerifications: jest.fn().mockResolvedValue([]),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.detail('ba-1'));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: expect.objectContaining({
        account: expect.objectContaining({
          earliestDueAt: '2026-09-12T15:59:59.000Z',
          dueWarning: true,
          credit: expect.objectContaining({
            usedCents: 52,
            usedUsd: 0.52,
            remainingCents: 948,
            accountAvailableBalanceCents: 948,
          }),
        }),
      }),
    });
  });

  it('enriches detail with owner members and contact without blocking on member failure', async () => {
    const billing = {
      getEnterpriseAccount: jest.fn().mockResolvedValue({
        id: 'ba-1',
        ownerUserId: 'u-1',
        enterpriseName: '示例公司',
        credit: {
          limitCents: 10_000,
          usedCents: 100,
          remainingCents: 9_900,
          status: 'ACTIVE',
          accountBalanceCents: 1_013_00,
          accountAvailableBalanceCents: 1_013_00 + 10_000,
        },
      }),
      listEnterpriseAccountOwnerMembers: jest.fn().mockResolvedValue({
        items: [{ userId: 'u-1', role: 'owner', status: 'active' }],
      }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn().mockResolvedValue({
        items: [{
          billingAccountId: 'ba-1',
          earliestDueAt: null,
          dueWarning: false,
          usedCents: 100,
          prepaid: false,
        }],
      }),
    };
    const user = {
      getUser: jest.fn().mockResolvedValue({ phone: '13800138000', email: 'owner@example.com' }),
      getUserVerifications: jest.fn().mockResolvedValue([]),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.detail('ba-1'));

    expect(billing.listEnterpriseAccountOwnerMembers).toHaveBeenCalledWith('ba-1');
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: expect.objectContaining({
        account: expect.objectContaining({
          id: 'ba-1',
          phone: '13800138000',
          email: 'owner@example.com',
          ownerMembers: [{ userId: 'u-1', role: 'owner', status: 'active' }],
        }),
      }),
    });
  });

  it('list 在拿到账户页后并行补齐月汇总和 owner 联系人', async () => {
    let releaseSummarize!: () => void;
    let releaseContacts!: () => void;
    const summarizeGate = new Promise<void>((resolve) => {
      releaseSummarize = resolve;
    });
    const contactsGate = new Promise<void>((resolve) => {
      releaseContacts = resolve;
    });
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({
        items: [{ id: 'ba-1', ownerUserId: 'u-1' }],
        total: 1,
        page: 1,
        pageSize: 10,
      }),
    };
    const bills = {
      summarizeEnterpriseBills: jest.fn(async () => {
        await summarizeGate;
        return { items: [] };
      }),
    };
    const user = {
      getUser: jest.fn(),
      getUserContactsByIds: jest.fn(async () => {
        await contactsGate;
        return { items: [] };
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      bills as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const pending = runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '10' }));
    await Promise.resolve();
    await Promise.resolve();
    expect(bills.summarizeEnterpriseBills).toHaveBeenCalledWith(['ba-1']);
    expect(user.getUserContactsByIds).toHaveBeenCalledWith(['u-1']);
    releaseSummarize();
    releaseContacts();
    await pending;
  });

  it('list 一次批量补齐多个 owner 的联系人，失败不阻断列表', async () => {
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({
        items: [
          { id: 'ba-1', ownerUserId: 'u-1' },
          { id: 'ba-2', ownerUserId: 'u-2' },
          { id: 'ba-3', ownerUserId: 'u-1' },
        ],
        total: 3,
        page: 1,
        pageSize: 10,
      }),
    };
    const user = {
      getUser: jest.fn(),
      getUserContactsByIds: jest.fn().mockResolvedValue({
        items: [
          { id: 'u-1', phone: '13800138000', email: 'a@example.com' },
          { id: 'u-2', phone: '13900139000', email: 'b@example.com' },
        ],
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      { summarizeEnterpriseBills: jest.fn().mockResolvedValue({ items: [] }) } as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const ok = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '10' }));
    expect(user.getUserContactsByIds).toHaveBeenCalledWith(['u-1', 'u-2']);
    expect(user.getUser).not.toHaveBeenCalled();
    expect((ok.data as { items: Array<{ phone?: string | null }> }).items.map((row) => row.phone))
      .toEqual(['13800138000', '13900139000', '13800138000']);

    user.getUserContactsByIds.mockRejectedValueOnce(new Error('user down'));
    const degraded = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '10' }));
    expect((degraded.data as { items: unknown[] }).items).toHaveLength(3);
    expect((degraded.data as { items: Array<{ phone?: string | null }> }).items[0]?.phone).toBeNull();
  });

  it('returns an empty list when a phone-like search matches no user', async () => {
    const billing = {
      listEnterpriseAccounts: jest.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 }),
    };
    const user = {
      searchUsers: jest.fn().mockResolvedValue({ items: [{ id: 'u-9', phone: '13900139000' }] }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      billing as never,
      { summarizeEnterpriseBills: jest.fn() } as never,
      user as never,
      { log: jest.fn() } as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.list({ page: '1', pageSize: '20', search: '13800138000' }));

    // 无匹配用户时按 ownerUserId = '__no_match__' 过滤，必须拿到空列表。
    expect(billing.listEnterpriseAccounts).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: '__no_match__',
    }));
    expect((result.data as { items: unknown[] }).items).toEqual([]);
  });

  it('proxies a closed-month write-off to billing bills', async () => {
    const bills = {
      writeOffEnterpriseBill: jest.fn().mockResolvedValue({ yearMonth: '2026-08', status: '已核销' }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.writeOff('ba-1', '2026-08', {
      amountCents: 200,
      note: '回款差异',
      idempotencyKey: 'idem-wo-1',
    }));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { yearMonth: '2026-08', status: '已核销' },
    });
    expect(bills.writeOffEnterpriseBill).toHaveBeenCalledWith('ba-1', '2026-08', {
      amountCents: 200,
      note: '回款差异',
      idempotencyKey: 'idem-wo-1',
      canManage: true,
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enterprise_account.bill.write_off',
      resourceId: 'ba-1',
    }));
  });

  it('requires a non-empty adjust reason before proxying to billing', async () => {
    const bills = { adjustEnterpriseBill: jest.fn() };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    await expect(runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.adjust('ba-1', '2026-08', {
      direction: 'increase',
      amountCents: 100,
      note: '   ',
    }))).rejects.toThrow(new BadRequestException('调整原因必填'));

    expect(bills.adjustEnterpriseBill).not.toHaveBeenCalled();
  });

  it('proxies a closed-month adjust with note to billing bills', async () => {
    const bills = {
      adjustEnterpriseBill: jest.fn().mockResolvedValue({ yearMonth: '2026-08', pendingCents: 400 }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.adjust('ba-1', '2026-08', {
      direction: 'decrease',
      amountCents: 200,
      note: '  对账差异  ',
      idempotencyKey: 'idem-adj-1',
    }));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { yearMonth: '2026-08', pendingCents: 400 },
    });
    expect(bills.adjustEnterpriseBill).toHaveBeenCalledWith('ba-1', '2026-08', {
      direction: 'decrease',
      amountCents: 200,
      note: '对账差异',
      idempotencyKey: 'idem-adj-1',
      canManage: true,
    });
  });

  it('proxies compensate-voucher to billing bills', async () => {
    const bills = {
      compensateVoucherEnterpriseBill: jest.fn().mockResolvedValue({
        yearMonth: '2026-08',
        issuedVoucherCents: 500,
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.compensateVoucher('ba-1', '2026-08', {
      amountCents: 500,
      note: '  多扣补偿  ',
      productId: 'prod-1',
      tenantId: 'tenant-1',
      idempotencyKey: 'idem-1',
    }));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { yearMonth: '2026-08', issuedVoucherCents: 500 },
    });
    expect(bills.compensateVoucherEnterpriseBill).toHaveBeenCalledWith('ba-1', '2026-08', {
      amountCents: 500,
      note: '多扣补偿',
      productId: 'prod-1',
      tenantId: 'tenant-1',
      idempotencyKey: 'idem-1',
      canManage: true,
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enterprise_account.bill.compensate_voucher',
      resourceId: 'ba-1',
    }));
  });

  it('requires an idempotency key before proxying extend', async () => {
    const bills = { extendEnterpriseBill: jest.fn() };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    await expect(runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.extend('ba-1', '2026-08', {
      dueAt: '2026-11-15T15:59:59.000Z',
    }))).rejects.toBeInstanceOf(BadRequestException);
    expect(bills.extendEnterpriseBill).not.toHaveBeenCalled();
  });

  it('proxies extend to billing bills and audits the first write', async () => {
    const bills = {
      extendEnterpriseBill: jest.fn().mockResolvedValue({
        yearMonth: '2026-08',
        dueAt: '2026-11-15T15:59:59.000Z',
        replayed: false,
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.extend('ba-1', '2026-08', {
      dueAt: '2026-11-15T15:59:59.000Z',
      idempotencyKey: 'idem-ext-1',
    }));

    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: {
        yearMonth: '2026-08',
        dueAt: '2026-11-15T15:59:59.000Z',
        replayed: false,
      },
    });
    expect(bills.extendEnterpriseBill).toHaveBeenCalledWith('ba-1', '2026-08', {
      dueAt: '2026-11-15T15:59:59.000Z',
      idempotencyKey: 'idem-ext-1',
      canManage: true,
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enterprise_account.bill.extend',
      resourceId: 'ba-1',
    }));
  });

  it('does not audit extend when billing reports an idempotent replay', async () => {
    const bills = {
      extendEnterpriseBill: jest.fn().mockResolvedValue({
        yearMonth: '2026-08',
        dueAt: '2026-11-15T15:59:59.000Z',
        replayed: true,
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      activityLog as never,
    );

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.extend('ba-1', '2026-08', {
      dueAt: '2026-11-15T15:59:59.000Z',
      idempotencyKey: 'idem-ext-1',
    }));

    expect(activityLog.log).not.toHaveBeenCalled();
  });

  it('streams a downloaded bill as an xlsx attachment', async () => {
    const bills = {
      pipeEnterpriseBillDownload: jest.fn(async (
        _id: string,
        _yearMonth: string,
        reply: { header: (name: string, value: string) => unknown; send: (body: unknown) => Promise<void> },
      ) => {
        reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        await reply.send(Buffer.from('PK'));
      }),
    };
    const controller = new EnterpriseAccountAdminV2Controller(
      {} as never,
      bills as never,
      {} as never,
      { log: jest.fn() } as never,
    );
    let reply: {
      header: jest.Mock;
      send: jest.Mock;
    };
    reply = {
      header: jest.fn(() => reply),
      send: jest.fn(async () => undefined),
    };

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.view'],
    }, () => controller.download('ba-1', '2026-09', reply as never));

    expect(bills.pipeEnterpriseBillDownload).toHaveBeenCalledWith('ba-1', '2026-09', reply);
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('PK'));
  });
});
