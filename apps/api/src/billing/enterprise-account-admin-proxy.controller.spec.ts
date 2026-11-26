import { clearAdminRequestContext, runWithAdminRequestContext } from '../common/request/admin-context';
import { EnterpriseAccountAdminProxyController } from './enterprise-account-admin-proxy.controller';

type MockReply = {
  header: jest.MockedFunction<(name: string, value: string) => MockReply>;
  send: jest.MockedFunction<(body: Buffer) => Promise<void>>;
};

describe('EnterpriseAccountAdminProxyController', () => {
  afterEach(() => {
    clearAdminRequestContext();
  });

  it('proxies enterprise license files through admin-api', async () => {
    const billing = {};
    const user = {
      getEnterpriseLicenseFile: jest.fn().mockResolvedValue({
        buffer: Buffer.from('license'),
        contentType: 'image/png',
        contentLength: 7,
        filename: '营业执照.png',
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminProxyController(
      billing as never,
      user as never,
      activityLog as never,
    );
    let reply: MockReply;
    reply = {
      header: jest.fn((_name: string, _value: string) => reply),
      send: jest.fn(async (_body: Buffer) => undefined),
    };

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.enterprise_accounts.review'],
    }, () => controller.licenseFile('verification-1', reply as never));

    expect(user.getEnterpriseLicenseFile).toHaveBeenCalledWith('verification-1');
    expect(reply.header).toHaveBeenCalledWith('Content-Type', 'image/png');
    expect(reply.header).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', '7');
    expect(reply.header).toHaveBeenCalledWith(
      'Content-Disposition',
      expect.stringContaining("filename*=UTF-8''%E8%90%A5%E4%B8%9A%E6%89%A7%E7%85%A7.png"),
    );
    expect(reply.send).toHaveBeenCalledWith(Buffer.from('license'));
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'admin-1',
      action: 'enterprise_account.license_file.view',
      resource: 'enterprise_account',
      resourceId: 'verification-1',
    }));
  });

  it('recharges enterprise account through billing and writes activity log', async () => {
    const billing = {
      rechargeEnterpriseAccount: jest.fn().mockResolvedValue({ id: 'tx-1' }),
    };
    const user = {};
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminProxyController(
      billing as never,
      user as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.users.manage'],
    }, () => controller.recharge('ba-ent-1', {
      amountCents: 12345,
      productId: 'prod-payg-1',
      description: '线下转账入账',
      idempotencyKey: 'key-1',
    }));

    expect(result).toEqual({ code: 0, message: '充值成功', data: { id: 'tx-1' } });
    expect(billing.rechargeEnterpriseAccount).toHaveBeenCalledWith('ba-ent-1', {
      amountCents: 12345,
      productId: 'prod-payg-1',
      description: '线下转账入账',
      idempotencyKey: 'key-1',
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'admin-1',
      action: 'enterprise_account.balance.recharge',
      resource: 'enterprise_account',
      resourceId: 'ba-ent-1',
      detail: {
        amountCents: 12345,
        productId: 'prod-payg-1',
        description: '线下转账入账',
      },
    }));
  });

  it('rejects non-positive enterprise account recharge amounts', async () => {
    const controller = new EnterpriseAccountAdminProxyController(
      { rechargeEnterpriseAccount: jest.fn() } as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    await expect(controller.recharge('ba-ent-1', {
      amountCents: 0,
      productId: 'prod-payg-1',
      description: 'invalid',
      idempotencyKey: 'key-1',
    })).rejects.toThrow('充值金额必须大于 0');
  });

  it('rejects enterprise account recharge without product id', async () => {
    const controller = new EnterpriseAccountAdminProxyController(
      { rechargeEnterpriseAccount: jest.fn() } as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    await expect(controller.recharge('ba-ent-1', {
      amountCents: 100,
      description: 'invalid',
      idempotencyKey: 'key-1',
    })).rejects.toThrow('productId 不能为空');
  });

  it('applies a classified enterprise adjustment and writes an audit log', async () => {
    const billing = {
      applyEnterpriseBalanceAdjustment: jest.fn().mockResolvedValue({
        direction: 'CREDIT',
        amountCents: 800,
        transaction: { id: 'tx-adjust-1' },
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminProxyController(
      billing as never,
      {} as never,
      activityLog as never,
    );
    const legacyBody = {
      amountCents: 800,
      reasonCode: 'DISCOUNT_CORRECTION',
      description: 'August discount correction',
      idempotencyKey: 'adjustment-key-1',
      productId: 'legacy-product-must-be-ignored',
    };

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.applyBalanceAdjustment('ba-ent-1', legacyBody));

    expect(result.data).toMatchObject({ direction: 'CREDIT', amountCents: 800 });
    expect(billing.applyEnterpriseBalanceAdjustment).toHaveBeenCalledWith('ba-ent-1', {
      amountCents: 800,
      reasonCode: 'DISCOUNT_CORRECTION',
      description: 'August discount correction',
      performedBy: 'admin-1',
      idempotencyKey: 'adjustment-key-1',
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'admin-1',
      action: 'enterprise_account.balance.billing_adjustment',
      resourceId: 'ba-ent-1',
      detail: {
        amountCents: 800,
        reasonCode: 'DISCOUNT_CORRECTION',
        description: 'August discount correction',
        transactionId: 'tx-adjust-1',
      },
    }));
  });

  it('lists enterprise model discounts through billing', async () => {
    const billing = {
      listEnterpriseModelDiscounts: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new EnterpriseAccountAdminProxyController(
      billing as never,
      {} as never,
      { log: jest.fn() } as never,
    );

    const result = await controller.listModelDiscounts('ba-ent-1', 'prod-payg-1');

    expect(result).toEqual({ code: 0, message: 'ok', data: { items: [] } });
    expect(billing.listEnterpriseModelDiscounts).toHaveBeenCalledWith('ba-ent-1', 'prod-payg-1');
  });

  it('updates enterprise model discounts and writes activity log', async () => {
    const billing = {
      updateEnterpriseModelDiscounts: jest.fn().mockResolvedValue({ items: [{ modelName: 'gpt-test' }] }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseAccountAdminProxyController(
      billing as never,
      {} as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.users.manage'],
    }, () => controller.updateModelDiscounts('ba-ent-1', {
      productId: 'prod-payg-1',
      items: [{ modelName: 'gpt-test', priceMultiplier: 0.8 }],
    }));

    expect(result).toEqual({
      code: 0,
      message: '保存成功',
      data: { items: [{ modelName: 'gpt-test' }] },
    });
    expect(billing.updateEnterpriseModelDiscounts).toHaveBeenCalledWith('ba-ent-1', {
      productId: 'prod-payg-1',
      items: [{ modelName: 'gpt-test', priceMultiplier: 0.8 }],
      updatedBy: 'admin-1',
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      adminMemberId: 'admin-1',
      action: 'enterprise_account.model_discount.update',
      resource: 'enterprise_account',
      resourceId: 'ba-ent-1',
      detail: {
        productId: 'prod-payg-1',
        itemCount: 1,
      },
    }));
  });
});
