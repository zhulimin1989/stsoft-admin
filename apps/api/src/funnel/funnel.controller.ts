/**
 * FunnelController — admin v2 业务漏斗 HTTP 入口。
 *
 * 路由前缀 /admin/v2/funnel(前端 stub apps/admin/src/api/v2/funnel.ts 已固定):
 *   - GET /                 总漏斗(query: days, segmentId)
 *   - GET /subscription     订阅漏斗(query: days)
 *   - GET /payg             按量漏斗(query: days)
 *
 * 页面级权限：admin.page.funnel.view。
 */
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiResponse } from '@ruidong/shared';
import { BillingInternalClient } from '../billing/billing-internal.client';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';

@ApiTags('AdminV2 / Funnel')
@Controller('admin/v2/funnel')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class FunnelController {
  constructor(private readonly billing: BillingInternalClient) {}

  @RequireAdminPermission('admin.page.funnel.view')
  @Get()
  async overall(
    @Query() query: { days?: string; segmentId?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getOverallFunnel({
      days: parseDays(query.days),
      segmentId: query.segmentId?.trim() || undefined,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.funnel.view')
  @Get('subscription')
  async subscription(
    @Query() query: { days?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getSubscriptionFunnel(parseDays(query.days));
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.funnel.view')
  @Get('payg')
  async payg(
    @Query() query: { days?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getPaygFunnel(parseDays(query.days));
    return { code: 0, message: 'ok', data };
  }
}

/**
 * 仅做"是否为合法整数"的 parse;严格的 7/30/90 校验在 service 内 normalizeDays 做。
 * 这里 NaN 也直接传下去,service 会 fallback 到 30。
 */
function parseDays(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 30;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : 30;
}
