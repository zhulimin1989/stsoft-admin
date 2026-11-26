import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { ApiResponse } from '@ruidong/shared';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { getAdminRequestContext } from '../common/request/admin-context';
import { ENTERPRISE_ACCOUNTS_MANAGE } from './enterprise-account-admin-proxy.controller';
import { EnterpriseBillsInternalClient } from './enterprise-bills-internal.client';

/**
 * 手动调度 billing 闭月汇总同步 / 当月快照。
 * 不挂在 enterprise-accounts/:id 下，避免被当成账户 id。
 */
@Controller('admin/v2/enterprise-bill-month-summaries')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class EnterpriseBillMonthSummariesAdminController {
  constructor(
    private readonly bills: EnterpriseBillsInternalClient,
    private readonly activityLog: AdminActivityLogService,
  ) {}

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post('refresh')
  async refresh(): Promise<ApiResponse<unknown>> {
    const data = await this.bills.refreshEnterpriseBillMonthSummaries();
    await this.audit('enterprise_bill_month_summaries.refresh', data);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post('close')
  async close(
    @Body() body?: { billingAccountId?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.bills.closeEnterpriseBillMonthSummaries(body?.billingAccountId);
    await this.audit('enterprise_bill_month_summaries.close', data);
    return { code: 0, message: 'ok', data };
  }

  private async audit(action: string, after: unknown): Promise<void> {
    const operatorId = getAdminRequestContext()?.adminId;
    if (!operatorId) return;
    await this.activityLog.log({
      adminMemberId: operatorId,
      action,
      resource: 'enterprise_bill_month_summaries',
      resourceId: action.endsWith('refresh') ? 'refresh' : 'close',
      after: after && typeof after === 'object' ? after as Record<string, unknown> : undefined,
    });
  }
}
