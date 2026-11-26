import { AdminController } from './admin.controller';
import type { AdminService } from './admin.service';

describe('AdminController finance report detail query forwarding', () => {
  it('forwards structured filters together with pagination to the admin service', async () => {
    const adminService = {
      getFinanceReportDetail: jest.fn().mockResolvedValue({ rows: [] }),
    };
    const controller = new AdminController(adminService as unknown as AdminService);

    const result = await controller.getFinanceReportDetail(
      '2026-08',
      'balance',
      'PAY_AS_YOU_GO',
      '50',
      'cursor-token',
      'transactionId',
      'tx-adjustment-1',
    );

    expect(adminService.getFinanceReportDetail).toHaveBeenCalledWith({
      month: '2026-08',
      tab: 'balance',
      billingMode: 'PAY_AS_YOU_GO',
      pageSize: 50,
      cursor: 'cursor-token',
      filterField: 'transactionId',
      filterValue: 'tx-adjustment-1',
    });
    expect(result).toEqual({
      code: 0,
      message: 'ok',
      data: { rows: [] },
    });
  });
});
