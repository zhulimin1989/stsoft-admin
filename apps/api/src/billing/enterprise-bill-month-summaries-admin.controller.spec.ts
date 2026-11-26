import { EnterpriseBillMonthSummariesAdminController } from './enterprise-bill-month-summaries-admin.controller';
import { clearAdminRequestContext, runWithAdminRequestContext } from '../common/request/admin-context';

describe('EnterpriseBillMonthSummariesAdminController', () => {
  afterEach(() => {
    clearAdminRequestContext();
  });

  it('refresh 无参转发 billing，不读 request', async () => {
    const bills = {
      refreshEnterpriseBillMonthSummaries: jest.fn().mockResolvedValue({
        yearMonth: '2026-09',
        processed: 3,
        fundingProcessed: 3,
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseBillMonthSummariesAdminController(
      bills as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.refresh());

    expect(bills.refreshEnterpriseBillMonthSummaries).toHaveBeenCalledWith();
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { yearMonth: '2026-09', processed: 3, fundingProcessed: 3 },
    });
    expect(activityLog.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'enterprise_bill_month_summaries.refresh',
      resourceId: 'refresh',
    }));
  });

  it('close 转发 billing，可带 billingAccountId', async () => {
    const bills = {
      closeEnterpriseBillMonthSummaries: jest.fn().mockResolvedValue({
        skipped: false,
        yearMonth: '2026-08',
        processed: 1,
        hasMore: false,
        billingAccountId: 'ba-1',
      }),
    };
    const activityLog = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new EnterpriseBillMonthSummariesAdminController(
      bills as never,
      activityLog as never,
    );

    const result = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    }, () => controller.close({ billingAccountId: 'ba-1' }));

    expect(bills.closeEnterpriseBillMonthSummaries).toHaveBeenCalledWith('ba-1');
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: {
        skipped: false,
        yearMonth: '2026-08',
        processed: 1,
        hasMore: false,
        billingAccountId: 'ba-1',
      },
    });
  });
});
