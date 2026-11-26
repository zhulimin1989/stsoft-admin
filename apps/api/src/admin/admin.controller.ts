import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AdminService } from './admin.service';
import { Public } from '../common/decorators/public.decorator';
import {
  NoAdminPermissionRequired,
  RequireAdminPermission,
} from '../common/decorators/admin-permission.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { ApiResponse, createBundleSkuSchema, paginationSchema, updateBundleSkuSchema } from '@ruidong/shared';
import {
  parseHistoricalPlatformLossApproval,
  parseHistoricalPlatformLossCreate,
  parseHistoricalPlatformLossPreview,
} from './historical-platform-loss.dto';

type AdminRequest = FastifyRequest & {
  cookies?: {
    admin_refresh_token?: string;
  };
  user?: {
    id?: string;
  };
};

function getAdminCookieOptions() {
  const isProduction =
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production';
  return {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict' as const,
    path: '/',
  };
}

function getAdminRefreshToken(req: FastifyRequest): string | undefined {
  return (req as AdminRequest).cookies?.admin_refresh_token;
}

function getRequestAdminId(req: FastifyRequest): string | undefined {
  return (req as AdminRequest).user?.id;
}

function parseOptionalBooleanQuery(value: unknown): boolean | undefined {
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  return undefined;
}

function parseOptionalTake(value: unknown): number | undefined {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.min(parsed, 200);
}

type GatewayBillingEventActionBody = {
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
};

type GatewayBillingEventSettlementBody = GatewayBillingEventActionBody & {
  evidenceId: string;
};

type GatewayBillingEventAbsorbBody = GatewayBillingEventActionBody & (
  | {
      protocol?: undefined;
      currencyRepairRunId?: undefined;
      currencyRepairItemId?: undefined;
      manifestHash?: undefined;
    }
  | {
      protocol: 'gateway-unanchored-absorb-v1';
      currencyRepairRunId: string;
      currencyRepairItemId: string;
      manifestHash: string;
    }
);

function parseGatewayBillingEventActionBody(body: unknown): GatewayBillingEventActionBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new BadRequestException('操作参数不能为空');
  }
  const candidate = body as Record<string, unknown>;
  if (
    typeof candidate.expectedRevision !== 'number'
    || !Number.isSafeInteger(candidate.expectedRevision)
    || candidate.expectedRevision < 0
  ) {
    throw new BadRequestException('expectedRevision 必须是非负整数');
  }
  const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
  if (!reason || reason.length > 500) {
    throw new BadRequestException('reason 必须为 1 到 500 个字符');
  }
  const idempotencyKey = typeof candidate.idempotencyKey === 'string'
    ? candidate.idempotencyKey.trim()
    : '';
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new BadRequestException('idempotencyKey 必须为 1 到 200 个字符');
  }
  return { expectedRevision: candidate.expectedRevision, reason, idempotencyKey };
}

function parseGatewayBillingEventSettlementBody(
  body: unknown,
): GatewayBillingEventSettlementBody {
  const action = parseGatewayBillingEventActionBody(body);
  const candidate = body as Record<string, unknown>;
  const evidenceId = typeof candidate.evidenceId === 'string'
    ? candidate.evidenceId.trim()
    : '';
  if (!evidenceId || evidenceId.length > 200) {
    throw new BadRequestException('evidenceId 必须为 1 到 200 个字符');
  }
  return { evidenceId, ...action };
}

function parseGatewayBillingEventAbsorbBody(
  body: unknown,
): GatewayBillingEventAbsorbBody {
  const action = parseGatewayBillingEventActionBody(body);
  const candidate = body as Record<string, unknown>;
  const protocol = typeof candidate.protocol === 'string'
    ? candidate.protocol.trim()
    : undefined;
  const repairFieldsPresent = [
    candidate.currencyRepairRunId,
    candidate.currencyRepairItemId,
    candidate.manifestHash,
  ].some((value) => value !== undefined);
  if (protocol === undefined) {
    if (repairFieldsPresent) {
      throw new BadRequestException('currency repair proof 必须绑定显式 absorb protocol');
    }
    return action;
  }
  if (protocol !== 'gateway-unanchored-absorb-v1') {
    throw new BadRequestException('不支持的 Gateway absorb protocol');
  }
  const currencyRepairRunId = typeof candidate.currencyRepairRunId === 'string'
    ? candidate.currencyRepairRunId.trim()
    : '';
  const currencyRepairItemId = typeof candidate.currencyRepairItemId === 'string'
    ? candidate.currencyRepairItemId.trim()
    : '';
  const manifestHash = typeof candidate.manifestHash === 'string'
    ? candidate.manifestHash.trim()
    : '';
  if (
    !currencyRepairRunId
    || currencyRepairRunId.length > 200
    || !currencyRepairItemId
    || currencyRepairItemId.length > 200
    || !/^[0-9a-f]{64}$/.test(manifestHash)
  ) {
    throw new BadRequestException('无锚币种吸收必须提供完整有效的 currency repair proof');
  }
  return {
    ...action,
    protocol,
    currencyRepairRunId,
    currencyRepairItemId,
    manifestHash,
  };
}

@ApiTags('Admin')
@Controller('admin')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  // ============================
  // 管理端认证（独立于用户端）
  // ============================

  @Public()
  @Post('auth/login')
  async adminLogin(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.adminLogin(body.email, body.password);

    const cookieOpts = getAdminCookieOptions();

    res.setCookie('admin_access_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 });
    res.setCookie('admin_refresh_token', result.refreshToken, { ...cookieOpts, path: '/api/admin/auth', maxAge: 7 * 24 * 3600 });

    return { code: 0, message: '登录成功', data: { user: result.user } };
  }

  @Public()
  @Post('auth/refresh')
  async adminRefresh(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<ApiResponse<unknown>> {
    const refreshToken = getAdminRefreshToken(req);
    if (!refreshToken) throw new UnauthorizedException('Refresh token 缺失');

    const result = await this.adminService.adminRefresh(refreshToken);

    const cookieOpts = getAdminCookieOptions();

    res.setCookie('admin_access_token', result.accessToken, { ...cookieOpts, maxAge: 15 * 60 });
    res.setCookie('admin_refresh_token', result.refreshToken, { ...cookieOpts, path: '/api/admin/auth', maxAge: 7 * 24 * 3600 });

    return { code: 0, message: 'ok', data: { user: result.user } };
  }

  @Public()
  @Post('auth/logout')
  async adminLogout(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ): Promise<ApiResponse<unknown>> {
    const refreshToken = getAdminRefreshToken(req);
    if (refreshToken) {
      try { await this.adminService.adminRefresh(refreshToken); } catch { /* already invalid */ }
    }
    res.clearCookie('admin_access_token', { path: '/' });
    res.clearCookie('admin_refresh_token', { path: '/api/admin/auth' });
    return { code: 0, message: '已登出', data: null };
  }

  @Get('auth/profile')
  @NoAdminPermissionRequired()
  async adminProfile(@Req() req: FastifyRequest): Promise<ApiResponse<unknown>> {
    const adminId = getRequestAdminId(req);
    if (!adminId) throw new UnauthorizedException('未登录');
    const profile = await this.adminService.getAdminProfile(adminId);
    return { code: 0, message: 'ok', data: profile };
  }

  // ============================
  // 用户管理
  // ============================

  @RequireAdminPermission('admin.page.users.view')
  @Get('users')
  async listUsers(@Query() query: unknown): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return { code: 0, message: 'ok', data: await this.adminService.listUsers(parsed.data.page, parsed.data.pageSize) };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/search')
  async searchUsers(@Query() query: {
    search?: string; status?: string; role?: string; provider?: string; page?: string; pageSize?: string;
  }): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.searchUsers({
      search: query.search, status: query.status, role: query.role, provider: query.provider,
      page: parseInt(query.page || '1', 10), pageSize: parseInt(query.pageSize || '20', 10),
    });
    return { code: 0, message: 'ok', data: result };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/:id')
  async getUser(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getUser(id) };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/:id/overview')
  async getUserOverview(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getUserOverview(id) };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/:id/subscriptions')
  async getUserSubscriptions(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getUserSubscriptions(id) };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/:id/api-keys')
  async getUserApiKeys(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getUserApiKeys(id) };
  }

  @RequireAdminPermission('admin.page.users.view')
  @Get('users/:id/audit-logs')
  async getUserAuditLogs(
    @Param('id') id: string,
    @Query() query: { page?: string; pageSize?: string },
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.getUserAuditLogs(
      id,
      parseInt(query.page || '1', 10),
      parseInt(query.pageSize || '20', 10),
    );
    return { code: 0, message: 'ok', data: result };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users/:id/adjust-balance')
  async adjustBalance(
    @Param('id') userId: string,
    @Body() body: {
      amountCents: number;
      reasonCode: 'DISCOUNT_CORRECTION' | 'BILLING_CORRECTION' | 'SERVICE_COMPENSATION' | 'OTHER';
      description: string;
      idempotencyKey: string;
    },
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const tx = await this.adminService.adjustBalance(
      userId,
      body.amountCents,
      body.reasonCode,
      body.description,
      adminId,
      body.idempotencyKey,
    );
    return { code: 0, message: '调额成功', data: tx };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users/:id/toggle-status')
  async toggleUserStatus(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.toggleUserStatus(id, adminId) as {
      message: string;
      data: unknown;
    };
    return { code: 0, message: result.message, data: result.data };
  }

  // ============================
  // 订单管理
  // ============================

  @RequireAdminPermission('admin.page.orders.view')
  @Get('orders')
  async listOrders(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      userId?: string;
      orderType?: string;
      channel?: string;
      search?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '20', 10);
    const filters = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.orderType ? { orderType: query.orderType } : {}),
      ...(query.channel ? { channel: query.channel } : {}),
      ...(query.search ? { search: query.search } : {}),
    };
    return { code: 0, message: 'ok', data: await this.adminService.listOrders(page, pageSize, filters) };
  }

  @RequireAdminPermission('admin.page.orders.view')
  @Get('orders/:id')
  async getOrder(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getOrderDetail(id) };
  }

  @RequireAdminPermission('admin.page.orders.manage')
  @Post('orders/:id/cancel')
  async cancelOrder(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
    @Body() body: { reason?: string },
  ): Promise<ApiResponse<null>> {
    await this.adminService.adminCancelOrder(id, adminId, body.reason);
    return { code: 0, message: '订单已取消', data: null };
  }

  @RequireAdminPermission('admin.page.orders.manage')
  @Post('orders/:id/retry')
  async retryOrder(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<null>> {
    await this.adminService.retryFailedOrder(id, adminId);
    return { code: 0, message: '重试已触发', data: null };
  }

  @RequireAdminPermission('admin.page.orders.manage')
  @Post('orders/:id/refund')
  async refundOrder(
    @Param('id') orderId: string,
    @Body() body: { reason: string },
  ): Promise<ApiResponse<unknown>> {
    if (!body.reason) throw new BadRequestException('退款原因为必填');
    const order = await this.adminService.refundOrder(orderId, body.reason);
    return { code: 0, message: '退款成功', data: order };
  }

  // ============================
  // 统计 & 收入
  // ============================

  @RequireAdminPermission('admin.page.dashboard.view')
  @Get('dashboard/overview')
  async getDashboardOverview(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getDashboardOverview() };
  }

  @RequireAdminPermission('admin.page.dashboard.view')
  @Get('stats')
  async getStats(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getStats() };
  }

  @RequireAdminPermission('admin.data.revenue.view')
  @Get('revenue')
  async getRevenue(@Query('productId') productId?: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getRevenue(productId) };
  }

  @RequireAdminPermission('admin.data.revenue.view')
  @Get('revenue/overview')
  async getRevenueOverview(
    @Query('days') daysParam?: string,
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    const days = parseInt(daysParam || '7') || 7;
    return { code: 0, message: 'ok', data: await this.adminService.getRevenueOverview(days, productId) };
  }

  @RequireAdminPermission('admin.data.finance_reports.view')
  @Get('finance-reports/dashboard')
  async getFinanceDashboard(@Query('month') month?: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getFinanceDashboard(month) };
  }

  @RequireAdminPermission('admin.data.finance_reports.view')
  @Get('finance-reports/overview')
  async getFinanceReportOverview(
    @Query('month') month?: string,
    @Query('billingMode') billingMode?: string,
    @Query('refresh') refreshParam?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.getFinanceReportOverview(
        month,
        billingMode,
        refreshParam === 'true',
      ),
    };
  }

  @RequireAdminPermission('admin.data.finance_reports.view')
  @Get('finance-reports/details')
  async getFinanceReportDetail(
    @Query('month') month?: string,
    @Query('tab') tab?: string,
    @Query('billingMode') billingMode?: string,
    @Query('pageSize') pageSizeParam?: string,
    @Query('cursor') cursor?: string,
    @Query('filterField') filterField?: string,
    @Query('filterValue') filterValue?: string,
  ): Promise<ApiResponse<unknown>> {
    const pageSize = pageSizeParam === undefined ? undefined : Number(pageSizeParam);
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.getFinanceReportDetail({
        month,
        tab,
        billingMode,
        pageSize,
        cursor,
        filterField,
        filterValue,
      }),
    };
  }

  @RequireAdminPermission('admin.data.finance_reports.export')
  @Post('finance-reports/export-jobs')
  async createFinanceReportExportJob(
    @Body() body: { month?: string; tab?: string; billingMode?: string },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.createFinanceReportExportJob({
        ...(body ?? {}),
        requestedByAdminId: getRequestAdminId(req) ?? null,
      }),
    };
  }

  @RequireAdminPermission('admin.page.finance_export_jobs.view')
  @Get('finance-reports/export-jobs')
  async listFinanceReportExportJobs(@Query('take') takeParam?: string): Promise<ApiResponse<unknown>> {
    const take = takeParam === undefined ? undefined : Number(takeParam);
    return { code: 0, message: 'ok', data: await this.adminService.listFinanceReportExportJobs(take) };
  }

  @RequireAdminPermission('admin.page.finance_export_jobs.view')
  @Get('finance-reports/export-jobs/:id')
  async getFinanceReportExportJob(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getFinanceReportExportJob(id) };
  }

  @RequireAdminPermission(
    'admin.page.finance_export_jobs.view',
    'admin.page.finance_export_jobs.download',
  )
  @Get('finance-reports/export-jobs/:id/download')
  async downloadFinanceReportExportJob(
    @Param('id') id: string,
    @Res() res: FastifyReply,
  ) {
    const file = await this.adminService.downloadFinanceReportExportJob(id) as {
      filename: string | null;
      contentType: string;
      contentLength: number | null;
      stream: NodeJS.ReadableStream;
    };
    res.header('content-type', file.contentType);
    res.header(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(file.filename ?? `finance-export-${id}.csv`)}`,
    );
    if (file.contentLength != null) res.header('content-length', String(file.contentLength));
    return res.send(file.stream);
  }

  @RequireAdminPermission('admin.data.finance_reports.view')
  @Get('finance-reports')
  async getFinanceReports(@Query('month') month?: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getFinanceReports(month) };
  }

  // ============================
  // 交易流水
  // ============================

  @RequireAdminPermission('admin.page.usage.view')
  @Get('transactions')
  async listTransactions(@Query() query: unknown): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const userId = typeof query === 'object' && query && 'userId' in query
      ? String((query as { userId?: string }).userId || '').trim()
      : '';
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listTransactions(
        parsed.data.page,
        parsed.data.pageSize,
        userId ? { userId } : undefined,
      ),
    };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.view')
  @Get('gateway-billing-events')
  async listGatewayBillingEvents(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      requestId?: string;
      apiKeyId?: string;
      tenantId?: string;
      userId?: string;
      productId?: string;
      modelName?: string;
      evidenceVerdict?: string;
      reconciliationStatus?: string;
      fundingOutcome?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const filters = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.requestId ? { requestId: query.requestId } : {}),
      ...(query.apiKeyId ? { apiKeyId: query.apiKeyId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.productId ? { productId: query.productId } : {}),
      ...(query.modelName ? { modelName: query.modelName } : {}),
      ...(query.evidenceVerdict ? { evidenceVerdict: query.evidenceVerdict } : {}),
      ...(query.reconciliationStatus ? { reconciliationStatus: query.reconciliationStatus } : {}),
      ...(query.fundingOutcome ? { fundingOutcome: query.fundingOutcome } : {}),
    };
    const data = await this.adminService.listGatewayBillingEvents(
      parsed.data.page,
      parsed.data.pageSize,
      filters,
    );
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.view')
  @Get('gateway-billing-events/:requestId')
  async getGatewayBillingEvent(
    @Param('requestId') requestId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.getGatewayBillingEvent(requestId);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.retry')
  @Post('gateway-billing-events/:requestId/retry')
  async retryGatewayBillingEvent(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.retryGatewayBillingEvent(
      requestId,
      parseGatewayBillingEventActionBody(body),
      adminId,
    );
    return { code: 0, message: '重试已完成', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.review')
  @Post('gateway-billing-events/:requestId/manual-review')
  async markGatewayBillingEventManualReview(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.markGatewayBillingEventManualReview(
      requestId,
      parseGatewayBillingEventActionBody(body),
      adminId,
    );
    return { code: 0, message: '已进入人工复核', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.settle')
  @Post('gateway-billing-events/:requestId/reconcile-settle')
  async reconcileAndSettleGatewayBillingEvent(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.reconcileAndSettleGatewayBillingEvent(
      requestId,
      parseGatewayBillingEventSettlementBody(body),
      adminId,
    );
    return { code: 0, message: '权威证据已结算', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.absorb')
  @Post('gateway-billing-events/:requestId/absorb')
  async absorbGatewayBillingEvent(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.absorbGatewayBillingEvent(
      requestId,
      parseGatewayBillingEventAbsorbBody(body),
      adminId,
    );
    return { code: 0, message: '平台吸收已记录', data };
  }

  @RequireAdminPermission('admin.page.gateway_billing_events.absorb')
  @Post('gateway-billing-events/:requestId/absorb-delta')
  async absorbGatewayBillingEventDelta(
    @Param('requestId') requestId: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.absorbGatewayBillingEventDelta(
      requestId,
      parseGatewayBillingEventSettlementBody(body),
      adminId,
    );
    return { code: 0, message: '已结算请求的少计差额已由平台吸收', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.prepare')
  @Post('historical-platform-loss-batches/preview')
  async previewHistoricalPlatformLossBatch(
    @Body() body: unknown,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.previewHistoricalPlatformLossBatch(
      parseHistoricalPlatformLossPreview(body),
    );
    return { code: 0, message: '历史平台损失批次预检完成', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.prepare')
  @Post('historical-platform-loss-batches')
  async createHistoricalPlatformLossBatch(
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.createHistoricalPlatformLossBatch(
      parseHistoricalPlatformLossCreate(body),
      adminId,
    );
    return { code: 0, message: '历史平台损失批次已准备，等待独立审批人入账', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.view')
  @Get('historical-platform-loss-batches')
  async listHistoricalPlatformLossBatches(
    @Query() query: {
      page?: string;
      pageSize?: string;
      status?: string;
      provider?: string;
      providerAccountRef?: string;
      region?: string;
      periodStart?: string;
      periodEnd?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const data = await this.adminService.listHistoricalPlatformLossBatches({
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      status: query.status?.trim() || undefined,
      provider: query.provider?.trim() || undefined,
      providerAccountRef: query.providerAccountRef?.trim() || undefined,
      region: query.region?.trim() || undefined,
      periodStart: query.periodStart?.trim() || undefined,
      periodEnd: query.periodEnd?.trim() || undefined,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.view')
  @Get('historical-platform-loss-batches/:id')
  async getHistoricalPlatformLossBatch(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.getHistoricalPlatformLossBatch(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.approve_post')
  @Post('historical-platform-loss-batches/:id/approve-and-post')
  async approveAndPostHistoricalPlatformLossBatch(
    @Param('id') id: string,
    @Body() body: unknown,
    @CurrentUser('id') adminId: string,
    @CurrentUser('presetRole') presetRole?: string,
  ): Promise<ApiResponse<unknown>> {
    if (!['finance', 'super_admin'].includes(String(presetRole ?? '').toLowerCase())) {
      throw new ForbiddenException('只有 Finance 或 Super Admin 可以审批并入账历史平台损失');
    }
    const data = await this.adminService.approveAndPostHistoricalPlatformLossBatch(
      id,
      parseHistoricalPlatformLossApproval(body),
      adminId,
    );
    return { code: 0, message: '历史平台损失已审批并入账，客户账单及余额未改变', data };
  }

  @RequireAdminPermission('admin.page.historical_platform_losses.export')
  @Get('historical-platform-loss-batches/:id/export')
  async exportHistoricalPlatformLossBatch(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.exportHistoricalPlatformLossBatch(id, adminId);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.publisher_sync_jobs.view')
  @Get('publisher-sync-jobs')
  async listPublisherSyncJobs(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      namespace?: string;
      method?: string;
      path?: string;
      resourceType?: string;
      resourceId?: string;
      idempotencyKey?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const filters = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.namespace ? { namespace: query.namespace } : {}),
      ...(query.method ? { method: query.method } : {}),
      ...(query.path ? { path: query.path } : {}),
      ...(query.resourceType ? { resourceType: query.resourceType } : {}),
      ...(query.resourceId ? { resourceId: query.resourceId } : {}),
      ...(query.idempotencyKey ? { idempotencyKey: query.idempotencyKey } : {}),
    };
    const data = await this.adminService.listPublisherSyncJobs(
      parsed.data.page,
      parsed.data.pageSize,
      filters,
    );
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.publisher_sync_jobs.view')
  @Get('publisher-sync-jobs/:id')
  async getPublisherSyncJob(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.getPublisherSyncJob(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.publisher_sync_jobs.manage')
  @Post('publisher-sync-jobs/:id/retry')
  async retryPublisherSyncJob(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.retryPublisherSyncJob(id);
    return { code: 0, message: '重试已完成', data };
  }

  @RequireAdminPermission('admin.page.publisher_sync_jobs.manage')
  @Post('publisher-sync-jobs/replay')
  async replayPublisherSync(
    @Body() body: { scope?: string },
  ): Promise<ApiResponse<unknown>> {
    const scope = body.scope === 'ops' ? 'admin' : body.scope || 'all';
    if (!['all', 'api_keys', 'key_balances', 'admin', 'platform'].includes(scope)) {
      throw new BadRequestException('scope 必须是 all/api_keys/key_balances/admin/platform');
    }
    const data = await this.adminService.replayPublisherSync(
      scope as 'all' | 'api_keys' | 'key_balances' | 'admin' | 'platform',
    );
    return { code: 0, message: '重推已触发', data };
  }

  // ============================
  // 审计日志
  // ============================

  @RequireAdminPermission('admin.page.audit_logs.view')
  @Get('audit-logs')
  async listAuditLogs(@Query() query: { page?: string; pageSize?: string; action?: string; resource?: string; search?: string }): Promise<ApiResponse<unknown>> {
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '50', 10);
    const filters: { action?: string; resource?: string; search?: string } = {};
    if (query.action) filters.action = query.action;
    if (query.resource) filters.resource = query.resource;
    if (query.search?.trim()) filters.search = query.search.trim();
    return { code: 0, message: 'ok', data: await this.adminService.listAuditLogs(page, pageSize, Object.keys(filters).length ? filters : undefined) };
  }

  // ============================
  // 套餐管理
  // ============================

  @RequireAdminPermission('admin.catalog.plans.view')
  @Get('plans')
  async listPlans(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listPlans() };
  }

  @RequireAdminPermission('admin.data.coding_plan.view')
  @Get('coding-plan/workspace')
  async getCodingPlanWorkspace(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getCodingPlanWorkspace() };
  }

  // 滚动配额 gate 运行时开关（自营套餐配额执行）。委派 billing，透传 {effectiveEnabled,envForced,adminEnabled}。
  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get('rolling-quota-gate')
  async getRollingQuotaGate(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getRollingQuotaGate() };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Put('rolling-quota-gate')
  async setRollingQuotaGate(
    @Body() body: { enabled?: unknown },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    // 严格只收 true/false/null（null=置空继承 env）；缺失/非法一律 400，避免误关 gate。
    const raw = body?.enabled;
    if (raw !== true && raw !== false && raw !== null) {
      throw new BadRequestException('enabled 必须为 boolean 或 null（置空=继承环境变量）');
    }
    const data = await this.adminService.setRollingQuotaGate(raw, getRequestAdminId(req));
    return { code: 0, message: '保存成功', data };
  }

  // R3b 月度补发 运行时开关（自营套餐按月补发/清欠）。委派 billing。
  // 权限与同页的 rolling-quota-gate / billing 侧保持一致：本开关就渲染在「CodingPlan›配额模板」页。
  // 早期误用 admin.plans.view，而隐含关系是单向的（admin.plans.view ⇒ coding_quota_templates.view，反向不成立），
  // 导致只勾细粒度页面权限的账号能进页面、Gate 卡正常，本卡却 403。
  // 同域的 debug-only 端点见本组开关之后。
  // debug-only：跳过 k 检查，直接对指定 entitlement 调 resetQuota(net)（R3b 清欠测试）。委派 billing。
  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get('coding-plan-monthly-refresh/debug-balance')
  async debugGetBalance(@Query('entitlementId') entitlementId?: string): Promise<ApiResponse<unknown>> {
    if (!entitlementId?.trim()) {
      throw new BadRequestException('entitlementId 必填');
    }
    return { code: 0, message: 'ok', data: await this.adminService.debugGetBalance(entitlementId.trim()) };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Post('coding-plan-monthly-refresh/debug-set-dates')
  async debugSetEntitlementDates(
    @Body() body: { entitlementId?: string; startedAt?: string; expiresAt?: string },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    if (typeof body?.entitlementId !== 'string' || !body.entitlementId.trim()) {
      throw new BadRequestException('entitlementId 必填且为字符串');
    }
    if (body.startedAt !== undefined && typeof body.startedAt !== 'string') {
      throw new BadRequestException('startedAt 必须为字符串');
    }
    if (body.expiresAt !== undefined && typeof body.expiresAt !== 'string') {
      throw new BadRequestException('expiresAt 必须为字符串');
    }
    const data = await this.adminService.debugSetEntitlementDates(
      body.entitlementId.trim(),
      body.startedAt,
      body.expiresAt,
      getRequestAdminId(req),
    );
    return { code: 0, message: '时间轴已更新', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Post('coding-plan-monthly-refresh/debug-reset')
  async debugResetMonthlyRefresh(
    @Body() body: { entitlementId?: string; tag?: string },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    if (!body?.entitlementId?.trim()) {
      throw new BadRequestException('entitlementId 必填');
    }
    const data = await this.adminService.debugResetMonthlyRefresh(body.entitlementId.trim(), getRequestAdminId(req), body.tag);
    return { code: 0, message: 'debug resetQuota 已执行', data };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get('coding-plan-monthly-refresh')
  async getCodingPlanMonthlyRefresh(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getCodingPlanMonthlyRefresh() };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Put('coding-plan-monthly-refresh')
  async setCodingPlanMonthlyRefresh(
    @Body() body: { enabled?: unknown },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    const raw = body?.enabled;
    if (raw !== true && raw !== false && raw !== null) {
      throw new BadRequestException('enabled 必须为 boolean 或 null（置空=继承环境变量）');
    }
    const data = await this.adminService.setCodingPlanMonthlyRefresh(raw, getRequestAdminId(req));
    return { code: 0, message: '保存成功', data };
  }

  // R6 自营积分终态负额结算 运行时开关（billing 侧硬门禁：月度补发未生效时拒绝开启）。委派 billing。
  // 权限口径同上（与 rolling-quota-gate / billing 侧一致）。
  @RequireAdminPermission('admin.page.coding_quota_templates.view')
  @Get('selfop-negative-deduct')
  async getSelfopNegativeDeduct(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getSelfopNegativeDeduct() };
  }

  @RequireAdminPermission('admin.page.coding_quota_templates.manage')
  @Put('selfop-negative-deduct')
  async setSelfopNegativeDeduct(
    @Body() body: { enabled?: unknown },
    @Req() req: FastifyRequest,
  ): Promise<ApiResponse<unknown>> {
    const raw = body?.enabled;
    if (raw !== true && raw !== false && raw !== null) {
      throw new BadRequestException('enabled 必须为 boolean 或 null（置空=继承环境变量）');
    }
    const data = await this.adminService.setSelfopNegativeDeduct(raw, getRequestAdminId(req));
    return { code: 0, message: '保存成功', data };
  }

  @RequireAdminPermission('admin.page.coding_self_managed_plans.manage')
  @Post('coding-plan/plans')
  async createCodingPlanPlan(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'CodingPlan 套餐已创建',
      data: await this.adminService.createCodingPlanPlan(body),
    };
  }

  @RequireAdminPermission('admin.page.coding_self_managed_plans.manage')
  @Put('coding-plan/plans/:id')
  async updateCodingPlanPlan(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'CodingPlan 套餐已保存',
      data: await this.adminService.updateCodingPlanPlan(id, body),
    };
  }

  @RequireAdminPermission('admin.page.coding_third_party_plans.manage')
  @Post('coding-plan/resale-plans')
  async createCodingPlanResalePlan(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '三方转售套餐已创建',
      data: await this.adminService.createCodingPlanResalePlan(body),
    };
  }

  @RequireAdminPermission('admin.page.coding_third_party_plans.manage')
  @Put('coding-plan/resale-plans/:id')
  async updateCodingPlanResalePlan(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '三方转售套餐已保存',
      data: await this.adminService.updateCodingPlanResalePlan(id, body),
    };
  }

  @RequireAdminPermission('admin.data.coding_plan.manage')
  @Delete('coding-plan/plans/:id')
  async deleteCodingPlanPlan(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'CodingPlan 套餐已删除',
      data: await this.adminService.deleteCodingPlanPlan(id),
    };
  }

  // finding #13：上架/下架独立动作（isActive 从随保存字段解耦）。billing 侧对自营原子校验绑定后翻 active。
  @RequireAdminPermission('admin.page.coding_self_managed_plans.manage')
  @Post('coding-plan/plans/:id/publish')
  async publishCodingPlanPlan(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'CodingPlan 套餐已上架',
      data: await this.adminService.publishCodingPlanPlan(id),
    };
  }

  @RequireAdminPermission('admin.page.coding_self_managed_plans.manage')
  @Post('coding-plan/plans/:id/unpublish')
  async unpublishCodingPlanPlan(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'CodingPlan 套餐已下架',
      data: await this.adminService.unpublishCodingPlanPlan(id),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_report.view')
  @Get('coding-plan/provider-entitlements')
  async listCodingPlanProviderEntitlements(
    @Query() query: {
      status?: string;
      providerLineId?: string;
      providerLineCode?: string;
      userId?: string;
      tenantId?: string;
      orderId?: string;
      take?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listCodingPlanProviderEntitlements({
        ...(query.status ? { status: query.status } : {}),
        ...(query.providerLineId ? { providerLineId: query.providerLineId } : {}),
        ...(query.providerLineCode ? { providerLineCode: query.providerLineCode } : {}),
        ...(query.userId ? { userId: query.userId } : {}),
        ...(query.tenantId ? { tenantId: query.tenantId } : {}),
        ...(query.orderId ? { orderId: query.orderId } : {}),
        take: parseOptionalTake(query.take),
      }),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_report.manage')
  @Post('coding-plan/provider-entitlements/:id/retry')
  async retryCodingPlanProviderEntitlement(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商履约已重试',
      data: await this.adminService.retryCodingPlanProviderEntitlement(id),
    };
  }

  @RequireAdminPermission('admin.data.coding_plan.view')
  @Get('coding-plan/provider-lines')
  async listCodingPlanProviderLines(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listCodingPlanProviderLines() };
  }

  @RequireAdminPermission('admin.page.coding_resale_config.manage')
  @Post('coding-plan/provider-lines')
  async createCodingPlanProviderLine(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商线路已创建',
      data: await this.adminService.createCodingPlanProviderLine(body),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_config.manage')
  @Put('coding-plan/provider-lines/:id')
  async updateCodingPlanProviderLine(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商线路已保存',
      data: await this.adminService.updateCodingPlanProviderLine(id, body),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_config.manage')
  @Delete('coding-plan/provider-lines/:id')
  async deleteCodingPlanProviderLine(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商线路已删除',
      data: await this.adminService.deleteCodingPlanProviderLine(id),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_config.manage')
  @Post('coding-plan/provider-lines/:id/test')
  async testCodingPlanProviderLine(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商线路连接成功',
      data: await this.adminService.testCodingPlanProviderLine(id),
    };
  }

  @RequireAdminPermission('admin.page.coding_resale_config.manage')
  @Post('coding-plan/provider-lines/:id/sync-products')
  async syncCodingPlanProviderProducts(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '供应商套餐已同步',
      data: await this.adminService.syncCodingPlanProviderProducts(id),
    };
  }

  @RequireAdminPermission('admin.data.coding_plan.view')
  @Get('coding-plan/provider-products')
  async listCodingPlanProviderProducts(
    @Query('providerLineId') providerLineId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listCodingPlanProviderProducts(providerLineId),
    };
  }

  @RequireAdminPermission('admin.data.coding_plan.view')
  @Get('coding-plan/resale-routes')
  async listCodingPlanResaleRoutes(
    @Query('planId') planId?: string,
    @Query('providerLineId') providerLineId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listCodingPlanResaleRoutes({
        ...(planId ? { planId } : {}),
        ...(providerLineId ? { providerLineId } : {}),
      }),
    };
  }

  @RequireAdminPermission('admin.page.subscription_plans.manage')
  @Delete('plans/:id')
  async deletePlan(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deletePlan(id);
    return { code: 0, message: '删除成功', data };
  }

  @RequireAdminPermission('admin.catalog.plans.view')
  @Get('plans/:id')
  async getPlanById(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getPlanById(id) };
  }

  @RequireAdminPermission('admin.page.subscription_plans.manage')
  @Post('plans')
  async createPlan(@Body() body: {
    id?: string;
    productId?: string | null;
    name: string;
    description?: string;
    planType?: string;
    monthlyPrice?: number;
    quarterlyPrice?: number;
    yearlyPrice?: number;
    billingPeriod?: string;
    monthlyCredits?: number;
    creditsRollover?: boolean;
    rolloverMaxMonths?: number;
    rateLimitRpm?: number;
    rateLimitTpm?: number;
    maxContextWindow?: number;
    overageEnabled?: boolean;
    usageMultiplier?: number;
    memberLimit?: number;
    minimumSeats?: number;
    dataTraining?: string;
    supportTier?: string;
    ssoEnabled?: boolean;
    priorityAccess?: boolean;
    badge?: string | null;
    trialDays?: number;
    validityDays?: number;
    features?: unknown;
    isActive?: boolean;
    isLegacy?: boolean;
    sortOrder?: number;
  }): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.createOrUpdatePlan(body);
    return { code: 0, message: result.message, data: result.data };
  }

  @RequireAdminPermission('admin.page.subscription_plans.manage')
  @Post('plans/:id')
  async updatePlan(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const plan = await this.adminService.updatePlan(id, body);
    return { code: 0, message: '更新成功', data: plan };
  }

  // ============================
  // 组合套餐管理
  // ============================

  @RequireAdminPermission('admin.page.bundles.view')
  @Get('bundles')
  async listBundles(@Query('isActive') isActive?: string): Promise<ApiResponse<unknown>> {
    const filters = isActive === undefined ? undefined : { isActive: isActive === 'true' };
    return { code: 0, message: 'ok', data: await this.adminService.listBundleSkus(filters) };
  }

  @RequireAdminPermission('admin.page.bundles.view')
  @Get('bundles/:id')
  async getBundle(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getBundleSkuById(id) };
  }

  @RequireAdminPermission('admin.page.bundles.manage')
  @Post('bundles')
  async createBundle(@Body() body: unknown): Promise<ApiResponse<unknown>> {
    const parsed = createBundleSkuSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const data = await this.adminService.createBundleSku(parsed.data);
    return { code: 0, message: '创建成功', data };
  }

  @RequireAdminPermission('admin.page.bundles.manage')
  @Put('bundles/:id')
  async updateBundle(@Param('id') id: string, @Body() body: unknown): Promise<ApiResponse<unknown>> {
    const parsed = updateBundleSkuSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    const data = await this.adminService.updateBundleSku(id, parsed.data);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.page.bundles.manage')
  @Delete('bundles/:id')
  async deleteBundle(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deleteBundleSku(id);
    return { code: 0, message: data.disabled ? '组合套餐已停用' : '删除成功', data };
  }

  // ============================
  // API Key 管理
  // ============================

  @RequireAdminPermission('admin.page.api_keys.view')
  @Get('api-keys')
  async listApiKeys(@Query() query: {
    page?: string;
    pageSize?: string;
    search?: string;
    email?: string;
    status?: string;
  }): Promise<ApiResponse<unknown>> {
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '20', 10);
    const data = await this.adminService.listApiKeys({
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
      search: query.search,
      email: query.email,
      status: query.status,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.api_keys.manage')
  @Patch('api-keys/:id/status')
  async updateApiKeyStatus(
    @Param('id') id: string,
    @Body() body: { isActive?: boolean },
  ): Promise<ApiResponse<unknown>> {
    if (typeof body.isActive !== 'boolean') {
      throw new BadRequestException('isActive 必须是 boolean');
    }
    const data = await this.adminService.updateApiKeyStatus(id, body.isActive);
    return { code: 0, message: body.isActive ? '已启用' : '已停用', data };
  }

  @RequireAdminPermission('admin.page.api_keys.manage')
  @Delete('api-keys/:id')
  async revokeApiKey(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.adminService.revokeApiKey(id);
    return { code: 0, message: '已吊销', data: null };
  }

  @RequireAdminPermission('admin.page.subscription_accounts.view')
  @Get('subscriptions')
  async listSubscriptions(@Query() query: {
    page?: string;
    pageSize?: string;
    status?: string;
    expiringDays?: string;
    productId?: string;
    userId?: string;
  }): Promise<ApiResponse<unknown>> {
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '20', 10);
    const expiringDays = query.expiringDays ? parseInt(query.expiringDays, 10) : undefined;
    const data = await this.adminService.listSubscriptions({
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
      status: query.status,
      expiringDays: Number.isFinite(expiringDays) ? expiringDays : undefined,
      productId: query.productId,
      userId: query.userId,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.subscription_accounts.manage')
  @Post('subscriptions/:id/grant-credits')
  async grantSubscriptionCredits(
    @Param('id') subscriptionId: string,
    @Body() body: { amount: number; reason: string; idempotencyKey?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.grantSubscriptionCredits(
      subscriptionId,
      body.amount,
      body.reason,
      body.idempotencyKey,
    );
    return { code: 0, message: '积分赠送成功', data };
  }

  @RequireAdminPermission('admin.page.payg_accounts.view')
  @Get('payg-accounts')
  async listPaygAccounts(@Query() query: {
    page?: string;
    pageSize?: string;
    search?: string;
    email?: string;
    status?: string;
    productId?: string;
  }): Promise<ApiResponse<unknown>> {
    const page = parseInt(query.page || '1', 10);
    const pageSize = parseInt(query.pageSize || '20', 10);
    const data = await this.adminService.listPaygAccounts({
      page: Number.isFinite(page) && page > 0 ? page : 1,
      pageSize: Number.isFinite(pageSize) && pageSize > 0 ? pageSize : 20,
      search: query.search,
      email: query.email,
      status: query.status,
      productId: query.productId,
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.payg_accounts.manage')
  @Post('payg-accounts/:tenantId/issue-voucher')
  async issuePaygVoucher(
    @Param('tenantId') tenantId: string,
    @Body() body: {
      userId: string;
      productId?: string | null;
      amountCents: number;
      reason: string;
      expiresAt?: string | null;
      idempotencyKey?: string;
    },
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.issuePaygVoucher(tenantId, body, adminId);
    return { code: 0, message: '代金券发放成功', data };
  }

  // ============================
  // 产品管理
  // ============================

  // ============================
  // 套餐多币种价格管理
  // ============================

  @RequireAdminPermission('admin.page.subscription_plans.view')
  @Get('plans/:id/prices')
  async listPlanPrices(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listPlanPrices(id) };
  }

  @RequireAdminPermission('admin.page.subscription_plans.manage')
  @Put('plans/:id/prices/:currency')
  async upsertPlanPrice(
    @Param('id') id: string,
    @Param('currency') currency: string,
    @Body() body: { monthlyPrice: number; quarterlyPrice: number; yearlyPrice: number; isActive?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.upsertPlanPrice(id, { ...body, currency });
    return { code: 0, message: '保存成功', data };
  }

  @RequireAdminPermission('admin.page.subscription_plans.manage')
  @Delete('plans/:id/prices/:currency')
  async deletePlanPrice(
    @Param('id') id: string,
    @Param('currency') currency: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deletePlanPrice(id, currency);
    return { code: 0, message: '删除成功', data };
  }

  @RequireAdminPermission('admin.catalog.products.view')
  @Get('products')
  async listProducts(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listProducts() };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Post('products')
  async createProduct(@Body() body: {
    name: string;
    slug: string;
    description?: string;
    icon?: string;
    webhookUrl?: string | null;
    allowedPaymentCallbackOrigins?: string[] | null;
    defaultPlanId?: string | null;
    billingMode?: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
    codingPlanFulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
    fulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<ApiResponse<unknown>> {
    const product = await this.adminService.createProduct(body);
    return { code: 0, message: '创建成功', data: product };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Put('products/:id')
  async updateProduct(@Param('id') id: string, @Body() body: {
    name?: string;
    description?: string;
    icon?: string;
    webhookUrl?: string | null;
    allowedPaymentCallbackOrigins?: string[] | null;
    defaultPlanId?: string | null;
    billingMode?: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
    codingPlanFulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
    fulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<ApiResponse<unknown>> {
    const product = await this.adminService.updateProduct(id, body);
    return { code: 0, message: '更新成功', data: product };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Get('products/:id/integration')
  async getProductIntegration(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getProductIntegration(id) };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('products/:id/runtime-policy')
  async getProductRuntimePolicy(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getProductRuntimePolicy(id) };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Put('products/:id/runtime-policy')
  async updateProductRuntimePolicy(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '产品运行策略已保存', data: await this.adminService.updateProductRuntimePolicy(id, body) };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('products/:id/channels')
  async listProductChannels(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listProductChannels(id) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Post('products/:id/channels')
  async createProductChannel(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '创建成功', data: await this.adminService.createProductChannel(id, body) };
  }

  @RequireAdminPermission('admin.page.delivery_settings.manage')
  @Post('products/:id/delivery-settings')
  async createDeliverySetting(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '投放设置已保存', data: await this.adminService.createDeliverySetting(id, body) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Put('products/:id/channels/:productChannelId')
  async updateProductChannel(
    @Param('id') id: string,
    @Param('productChannelId') productChannelId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateProductChannel(id, productChannelId, body);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Delete('products/:id/channels/:productChannelId')
  async deleteProductChannel(
    @Param('id') id: string,
    @Param('productChannelId') productChannelId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deleteProductChannel(id, productChannelId);
    return { code: 0, message: '删除成功', data };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('products/:id/channel-groups')
  async listProductChannelGroups(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listProductChannelGroups(id) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Post('products/:id/channel-groups')
  async createProductChannelGroup(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '创建成功', data: await this.adminService.createProductChannelGroup(id, body) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Put('products/:id/channel-groups/:groupId')
  async updateProductChannelGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateProductChannelGroup(id, groupId, body);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Delete('products/:id/channel-groups/:groupId')
  async deleteProductChannelGroup(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deleteProductChannelGroup(id, groupId);
    return { code: 0, message: '删除成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Post('products/:id/channel-groups/:groupId/members')
  async addProductChannelGroupMember(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.addProductChannelGroupMember(id, groupId, body);
    return { code: 0, message: '添加成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Put('products/:id/channel-groups/:groupId/members/:memberId')
  async updateProductChannelGroupMember(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateProductChannelGroupMember(id, groupId, memberId, body);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Delete('products/:id/channel-groups/:groupId/members/:memberId')
  async deleteProductChannelGroupMember(
    @Param('id') id: string,
    @Param('groupId') groupId: string,
    @Param('memberId') memberId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deleteProductChannelGroupMember(id, groupId, memberId);
    return { code: 0, message: '删除成功', data };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('products/:id/route-assignments')
  async listProductRouteAssignments(
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.listProductRouteAssignments(id, {
      subjectType: typeof query.subjectType === 'string' ? query.subjectType : undefined,
      subjectId: typeof query.subjectId === 'string' ? query.subjectId : undefined,
      targetType: typeof query.targetType === 'string' ? query.targetType : undefined,
      isActive: parseOptionalBooleanQuery(query.isActive),
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Post('products/:id/route-assignments')
  async createProductRouteAssignment(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '创建成功', data: await this.adminService.createProductRouteAssignment(id, body) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Put('products/:id/route-assignments/:assignmentId')
  async updateProductRouteAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateProductRouteAssignment(id, assignmentId, body);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Delete('products/:id/route-assignments/:assignmentId')
  async deleteProductRouteAssignment(
    @Param('id') id: string,
    @Param('assignmentId') assignmentId: string,
  ): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteProductRouteAssignment(id, assignmentId);
    return { code: 0, message: '删除成功', data: null };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('products/:id/route-graph/preview')
  async previewProductRouteGraph(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.previewProductRouteGraph(id) };
  }

  @RequireAdminPermission('admin.data.delivery_routes.manage')
  @Post('products/:id/route-graph/rebuild')
  async rebuildProductRouteGraph(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '已重推', data: await this.adminService.rebuildProductRouteGraph(id) };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Post('products/:id/integration-token/rotate')
  async rotateProductIntegrationToken(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '产品接入令牌已生成', data: await this.adminService.rotateProductIntegrationToken(id) };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Post('products/:id/webhook-secret/rotate')
  async rotateProductWebhookSecret(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '产品 Webhook Secret 已生成', data: await this.adminService.rotateProductWebhookSecret(id) };
  }

  @RequireAdminPermission('admin.page.products.manage')
  @Delete('products/:id')
  async deleteProduct(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteProduct(id);
    return { code: 0, message: '删除成功', data: null };
  }

  @RequireAdminPermission('admin.page.payg_pricing.view')
  @Get('payg-model-pricing')
  async listPaygModelPricing(
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listPaygModelPricing(productId ?? ''),
    };
  }

  @RequireAdminPermission('admin.page.payg_pricing.view')
  @Get('payg-product-model-candidates')
  async listPaygProductModelCandidates(
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listPaygProductModelCandidates(productId ?? ''),
    };
  }

  @RequireAdminPermission('admin.page.payg_pricing.manage')
  @Post('payg-product-models')
  async addPaygProductModels(@Body() body: {
    productId: string;
    modelNames?: string[];
    modelName?: string;
    status?: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
    apiEnabled?: boolean;
    visible?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    displayOrder?: number | null;
    reason?: string | null;
  }): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.addPaygProductModels(body);
    return { code: 0, message: '已新增模型', data };
  }

  @RequireAdminPermission('admin.page.payg_pricing.manage')
  @Put('payg-product-models/:id')
  async updatePaygProductModel(
    @Param('id') id: string,
    @Body() body: {
      status?: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
      apiEnabled?: boolean;
      visible?: boolean;
      startsAt?: string | null;
      endsAt?: string | null;
      displayOrder?: number | null;
      reason?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updatePaygProductModel(id, body);
    return { code: 0, message: '已更新', data };
  }

  @RequireAdminPermission('admin.page.payg_pricing.manage')
  @Delete('payg-product-models/:id')
  async retirePaygProductModel(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.retirePaygProductModel(id);
    return { code: 0, message: '已移出产品', data };
  }

  @RequireAdminPermission('admin.page.payg_pricing.manage')
  @Post('payg-model-pricing')
  async createPaygModelPricingVersion(@Body() body: {
    productId: string;
    modelName: string;
    priceMultiplier?: string | number | null;
    inputPricePerMToken?: string | number | null;
    cachedInputPrice?: string | number | null;
    cacheWritePrice?: string | number | null;
    outputPricePerMToken?: string | number | null;
    startsAt?: string | null;
    endsAt?: string | null;
    isActive?: boolean;
    description?: string | null;
  }): Promise<ApiResponse<unknown>> {
    // 按量定价只支持倍率：代理入口同步拒绝已废除的绝对覆盖价，
    // 避免 admin 先发、billing 尚未滚完的窗口内仍能写入覆盖价。
    const legacyOverrides = (
      ['inputPricePerMToken', 'cachedInputPrice', 'cacheWritePrice', 'outputPricePerMToken'] as const
    ).filter((field) => {
      const value = body[field];
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.trim() === '') return false;
      return true;
    });
    if (legacyOverrides.length > 0) {
      throw new BadRequestException(
        `按量定价已改为仅支持倍率，不再接受绝对覆盖价：${legacyOverrides.join(', ')}`,
      );
    }
    // 白名单：四个已废除字段在**最外层入口**就剥离，保证它们不会继续往内层传递
    const policy = await this.adminService.createPaygModelPricingVersion({
      productId: body.productId,
      modelName: body.modelName,
      priceMultiplier: body.priceMultiplier,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      isActive: body.isActive,
      description: body.description,
    });
    return { code: 0, message: '保存成功', data: policy };
  }

  @RequireAdminPermission('admin.page.payg_pricing.manage')
  @Delete('payg-model-pricing/:id')
  async deactivatePaygModelPricing(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.deactivatePaygModelPricingPolicy(id);
    return { code: 0, message: '已停用', data: result };
  }

  @RequireAdminPermission('admin.page.provider_cost_policies.view')
  @Get('provider-cost-policies')
  async listProviderCostPolicies(
    @Query() query: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.listProviderCostPolicies(query);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.provider_cost_policies.manage')
  @Post('provider-cost-policies')
  async createProviderCostPolicy(
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.createProviderCostPolicy(body);
    return { code: 0, message: '保存成功', data };
  }

  @RequireAdminPermission('admin.page.provider_cost_policies.manage')
  @Post('provider-cost-policies/backfill-token-usage')
  async backfillProviderCostTokenUsage(
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.backfillProviderCostTokenUsage(body);
    return { code: 0, message: '回填完成', data };
  }

  @RequireAdminPermission('admin.page.provider_cost_policies.manage')
  @Delete('provider-cost-policies/:id')
  async deactivateProviderCostPolicy(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deactivateProviderCostPolicy(id);
    return { code: 0, message: '已停用', data };
  }

  @RequireAdminPermission('admin.page.provider_cost_policies.manage')
  @Delete('provider-cost-policies/:id/hard')
  async deleteProviderCostPolicy(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.deleteProviderCostPolicy(id);
    return { code: 0, message: '已删除', data };
  }

  @RequireAdminPermission('admin.page.usage_pricing_policies.view')
  @Get('usage-pricing-policies')
  async listUsagePricingPolicies(
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.listUsagePricingPolicies(productId);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission('admin.page.usage_pricing_policies.manage')
  @Post('usage-pricing-policies')
  async createUsagePricingPolicy(
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.createUsagePricingPolicy(body);
    return { code: 0, message: '创建成功', data };
  }

  @RequireAdminPermission('admin.page.usage_pricing_policies.manage')
  @Put('usage-pricing-policies/:id')
  async updateUsagePricingPolicy(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateUsagePricingPolicy(id, body);
    return { code: 0, message: '更新成功', data };
  }

  @RequireAdminPermission('admin.page.usage_pricing_policies.manage')
  @Delete('usage-pricing-policies/:id')
  async deleteUsagePricingPolicy(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteUsagePricingPolicy(id);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 加量包管理
  // ============================

  @RequireAdminPermission('admin.catalog.booster_packs.view')
  @Get('booster-packs')
  async listBoosterPacks(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listBoosterPacks() };
  }

  @RequireAdminPermission('admin.page.subscription_booster_packs.manage')
  @Post('booster-packs')
  async createBoosterPack(@Body() body: {
    productId?: string;
    name: string;
    description?: string;
    creditsAmount: number;
    priceCents: number;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<ApiResponse<unknown>> {
    const pack = await this.adminService.createBoosterPack(body);
    return { code: 0, message: '创建成功', data: pack };
  }

  @RequireAdminPermission('admin.page.subscription_booster_packs.manage')
  @Put('booster-packs/:id')
  async updateBoosterPack(@Param('id') id: string, @Body() body: {
    name?: string;
    description?: string;
    creditsAmount?: number;
    priceCents?: number;
    isActive?: boolean;
    sortOrder?: number;
  }): Promise<ApiResponse<unknown>> {
    const pack = await this.adminService.updateBoosterPack(id, body);
    return { code: 0, message: '更新成功', data: pack };
  }

  @RequireAdminPermission('admin.page.subscription_booster_packs.manage')
  @Delete('booster-packs/:id')
  async deleteBoosterPack(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteBoosterPack(id);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 会话管理
  // ============================

  @RequireAdminPermission('admin.page.sessions.view')
  @Get('sessions/stats')
  async getSessionStats(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getSessionStats() };
  }

  @RequireAdminPermission('admin.page.sessions.view')
  @Get('sessions')
  async listSessions(@Query() query: unknown): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return { code: 0, message: 'ok', data: await this.adminService.listSessions(parsed.data.page, parsed.data.pageSize) };
  }

  // ============================
  // 渠道管理
  // ============================

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('channels')
  async listChannels(@Query() query: unknown): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return { code: 0, message: 'ok', data: await this.adminService.listChannels(parsed.data.page, parsed.data.pageSize) };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('provider-account-identities')
  async listProviderAccountIdentities(): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.listProviderAccountIdentities(),
    };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('provider-account-identities')
  async createProviderAccountIdentity(
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '创建成功',
      data: await this.adminService.createProviderAccountIdentity(body),
    };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('provider-account-identities/:id/deactivate')
  async deactivateProviderAccountIdentity(
    @Param('id') id: string,
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: '已停用',
      data: await this.adminService.deactivateProviderAccountIdentity(id),
    };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('channels/protocol-templates')
  async getChannelProtocolTemplates(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getChannelProtocolTemplates() };
  }

  @RequireAdminPermission('admin.catalog.channels.view')
  @Get('channels/:id')
  async getChannel(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getChannel(id) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('channels')
  async createChannel(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '创建成功', data: await this.adminService.createChannel(body) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('channels/publisher-compile-preview')
  async previewChannelPublisherCompile(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.previewChannelPublisherCompile(body) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Put('channels/:id')
  async updateChannel(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '更新成功', data: await this.adminService.updateChannel(id, body) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Delete('channels/:id')
  async deleteChannel(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteChannel(id);
    return { code: 0, message: '删除成功', data: null };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('channels/:id/test')
  async testChannel(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.testChannel(id) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('channels/:id/reset-stats')
  async resetChannelStats(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: '统计已重置', data: await this.adminService.resetChannelStats(id) };
  }

  @RequireAdminPermission('admin.data.channels.manage')
  @Post('channels/:id/discover-models')
  async discoverChannelModels(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.discoverChannelModels(id) };
  }

  // ============================
  // 监控
  // ============================

  @RequireAdminPermission('admin.page.monitoring.view')
  @Get('monitoring/channel-health')
  async getChannelHealth(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getChannelHealth() };
  }

  @RequireAdminPermission('admin.page.agent_observability.view')
  @Get('agent-observability')
  async getAgentObservability(
    @Query('days') daysParam?: string,
    @Query('recentLimit') recentLimitParam?: string,
  ): Promise<ApiResponse<unknown>> {
    const days = parseInt(daysParam || '7', 10) || 7;
    const recentLimit = parseInt(recentLimitParam || '20', 10) || 20;
    return {
      code: 0,
      message: 'ok',
      data: await this.adminService.getAgentObservability({ days, recentLimit }),
    };
  }

  @RequireAdminPermission('admin.page.monitoring.view')
  @Get('monitoring/alerts')
  async listAlerts(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listAlerts() };
  }

  @RequireAdminPermission('admin.page.monitoring.manage')
  @Post('monitoring/alerts')
  async createAlert(@Body() body: {
    name: string;
    metric?: string;
    condition: string;
    threshold?: number;
    windowMinutes?: number;
  }): Promise<ApiResponse<unknown>> {
    const alert = await this.adminService.createAlert(body);
    return { code: 0, message: '创建成功', data: alert };
  }

  @RequireAdminPermission('admin.page.monitoring.manage')
  @Put('monitoring/alerts/:id')
  async updateAlert(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const alert = await this.adminService.updateAlert(id, body);
    return { code: 0, message: '更新成功', data: alert };
  }

  @RequireAdminPermission('admin.page.monitoring.manage')
  @Delete('monitoring/alerts/:id')
  async deleteAlert(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteAlert(id);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 公告管理
  // ============================

  @RequireAdminPermission('admin.page.announcements.view')
  @Get('announcements')
  async listAnnouncements(@Query() query: unknown): Promise<ApiResponse<unknown>> {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException(parsed.error.issues[0].message);
    return { code: 0, message: 'ok', data: await this.adminService.listAnnouncements(parsed.data.page, parsed.data.pageSize) };
  }

  @RequireAdminPermission('admin.page.announcements.manage')
  @Post('announcements')
  async createAnnouncement(@Body() body: {
    title: string;
    content: string;
    type?: string;
    targetAudience?: string;
  }): Promise<ApiResponse<unknown>> {
    const announcement = await this.adminService.createAnnouncement(body);
    return { code: 0, message: '创建成功', data: announcement };
  }

  @RequireAdminPermission('admin.page.announcements.manage')
  @Put('announcements/:id')
  async updateAnnouncement(
    @Param('id') id: string,
    @Body() body: { title?: string; content?: string; type?: string; targetAudience?: string },
  ): Promise<ApiResponse<unknown>> {
    const announcement = await this.adminService.updateAnnouncement(id, body);
    return { code: 0, message: '更新成功', data: announcement };
  }

  @RequireAdminPermission('admin.page.announcements.manage')
  @Put('announcements/:id/toggle')
  async toggleAnnouncement(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.toggleAnnouncement(id);
    return { code: 0, message: result.message, data: result.data };
  }

  @RequireAdminPermission('admin.page.announcements.manage')
  @Delete('announcements/:id')
  async deleteAnnouncement(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteAnnouncement(id);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 功能开关
  // ============================

  @RequireAdminPermission('admin.page.feature_flags.view')
  @Get('feature-flags')
  async listFeatureFlags(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listFeatureFlags() };
  }

  @RequireAdminPermission('admin.page.feature_flags.manage')
  @Post('feature-flags')
  async upsertFeatureFlag(@Body() body: {
    key: string;
    value: boolean;
    description?: string;
    scope?: string;
    scopeValue?: string | null;
  }): Promise<ApiResponse<unknown>> {
    const flag = await this.adminService.upsertFeatureFlag(body);
    return { code: 0, message: '保存成功', data: flag };
  }

  // ============================
  // 系统提示模板
  // ============================

  @RequireAdminPermission('admin.page.system_prompts.view')
  @Get('system-prompts')
  async listSystemPrompts(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listSystemPrompts() };
  }

  @RequireAdminPermission('admin.page.system_prompts.manage')
  @Post('system-prompts')
  async upsertSystemPrompt(@Body() body: {
    id?: string;
    name?: string;
    key?: string;
    content: string;
    description?: string;
  }): Promise<ApiResponse<unknown>> {
    const prompt = await this.adminService.upsertSystemPrompt(body);
    return { code: 0, message: '保存成功', data: prompt };
  }

  // ============================
  // 系统配置
  // ============================

  @NoAdminPermissionRequired()
  @Get('platform-config')
  async getPublicPlatformConfig(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getPublicPlatformConfig() };
  }

  @RequireAdminPermission('admin.page.system_config.view')
  @Get('system-config')
  async getSystemConfig(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getSystemConfig() };
  }

  @RequireAdminPermission('admin.page.system_config.manage')
  @Put('system-config')
  async updateSystemConfig(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const data = await this.adminService.updateSystemConfig(body);
    const status = data.deploymentConfigSyncStatus?.status;
    return {
      code: 0,
      message: status === 'degraded'
        ? '配置已保存，部分服务尚未生效，后台正在自动重试'
        : '保存成功',
      data,
    };
  }

  // ============================
  // 支付实例管理
  // ============================

  @RequireAdminPermission('admin.page.payment_config.view')
  @Get('payment-instances')
  async listPaymentInstances(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listPaymentInstances() };
  }

  @RequireAdminPermission('admin.page.payment_config.manage')
  @Post('payment-instances')
  async createPaymentInstance(@Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const instance = await this.adminService.createPaymentInstance(body);
    return { code: 0, message: '创建成功', data: instance };
  }

  @RequireAdminPermission('admin.page.payment_config.manage')
  @Put('payment-instances/:id')
  async updatePaymentInstance(@Param('id') id: string, @Body() body: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const instance = await this.adminService.updatePaymentInstance(id, body);
    return { code: 0, message: '更新成功', data: instance };
  }

  @RequireAdminPermission('admin.page.payment_config.manage')
  @Delete('payment-instances/:id')
  async deletePaymentInstance(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.deletePaymentInstance(id);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 模型定价
  // ============================

  @RequireAdminPermission('admin.catalog.models.view')
  @Get('model-pricing')
  async listModelPricing(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listModelPricing() };
  }

  @RequireAdminPermission('admin.page.models.manage')
  @Post('model-pricing')
  async upsertModelPricing(@Body() body: {
    modelName: string;
    inputPricePerMToken: number;
    outputPricePerMToken: number;
    isActive?: boolean;
    // v2 catalog fields (PR4) — all optional, validated by ChannelAdminService
    provider?: string | null;
    modelId?: string | null;
    description?: string | null;
    inputModalities?: string[] | null;
    outputModalities?: string[] | null;
    contextLength?: number | null;
    maxOutputTokens?: number | null;
    providerLogo?: string | null;
    isPublished?: boolean;
    displayOrder?: number;
    releaseAt?: string | null;
    tags?: string[] | null;
    supportedFeatures?: string[] | null;
    modelType?: string | null;
    pricingUnit?: string | null;
    unitPriceUsd?: number | null;
    pricingMetadata?: Record<string, unknown> | null;
    cachedInputPrice?: number | null;
    cacheWrite5minPrice?: number | null;
    cacheWrite1hPrice?: number | null;
    batchDiscount?: number | null;
    priceTiers?: Array<{
      tierKey: string;
      displayName?: string | null;
      minInputTokens?: number | null;
      maxInputTokensExclusive?: number | null;
      inputPricePerMToken: number;
      outputPricePerMToken: number;
      cachedInputPrice?: number | null;
      cacheWritePrice?: number | null;
      bandSchedule?: Array<{ days: number[]; start: string; end: string }> | null;
      currency?: string | null;
      rawCondition?: string | null;
      source?: string | null;
      priority?: number | null;
      isActive?: boolean;
    }> | null;
    // v4 调用默认值
    defaultThinkingMode?: string | null;
    defaultThinkingBudget?: number | null;
  }): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.upsertModelPricing(body);
    return { code: 0, message: '保存成功', data: result };
  }

  @RequireAdminPermission('admin.page.models.manage')
  @Post('model-pricing/sync')
  async syncModelPricing(): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.syncModelPricingFromProxy() as {
      added: number;
    } & Record<string, unknown>;
    return { code: 0, message: `同步完成，新增 ${result.added} 个模型`, data: result };
  }

  /**
   * 物理删除模型库条目。区别于 deactivate-orphans（软下线），这个会真的从 model_pricing
   * 表删行 — 用于运营清理之前导入或录入的干扰模型。
   *
   * 安全策略：
   *   - 删除前检查 ModelAccess（套餐配置）是否仍引用该 modelName，引用了就拒绝并返回引用列表
   *   - UsageEvent (历史计费日志) 不阻塞删除：modelName 是 String 不是 FK，历史日志保留 modelName
   *     字符串本身已能审计，不需要 ModelPricing 行存在
   *   - Channel.models JSON 数组里残留也不阻塞（同上：日志/历史性质，不主动反查）
   */
  @RequireAdminPermission('admin.page.models.manage')
  @Delete('model-pricing/:modelName')
  async deleteModelPricing(
    @Param('modelName') modelName: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.deleteModelPricing(decodeURIComponent(modelName));
    return { code: 0, message: '已删除', data: result };
  }

  @RequireAdminPermission('admin.page.models.manage')
  @Post('model-pricing/deactivate-orphans')
  async deactivateOrphanModelPricing(
    @Body() body: { confirm?: boolean },
  ): Promise<ApiResponse<unknown>> {
    const confirm = body?.confirm === true;
    const result = await this.adminService.deactivateOrphanModelPricing(confirm) as {
      dryRun: boolean;
      orphans: unknown[];
      deactivated: number;
    } & Record<string, unknown>;
    const msg = result.dryRun
      ? `预览：找到 ${result.orphans.length} 个孤儿定价`
      : `已禁用 ${result.deactivated} 个孤儿定价`;
    return { code: 0, message: msg, data: result };
  }

  /**
   * 一键将所有 isActive=true 的模型设为 isPublished=true。
   * 历史数据初始化用(早期录入未勾上架)。
   */
  @RequireAdminPermission('admin.page.models.manage')
  @Post('model-pricing/publish-all-active')
  async publishAllActiveModelPricing(): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.publishAllActiveModelPricing();
    return { code: 0, message: '已上架', data: result };
  }

  // ============================
  // 模型访问矩阵
  // ============================

  @RequireAdminPermission('admin.catalog.models.view')
  @Get('model-access')
  async listModelAccess(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listModelAccess() };
  }

  @RequireAdminPermission('admin.data.model_access.manage')
  @Post('model-access/batch')
  async batchUpdateModelAccess(@Body() body: {
    items: {
      tierId?: string;
      planId?: string;
      modelName?: string;
      model?: string;
      isActive?: boolean;
      isAllowed?: boolean;
      dailyLimit?: number;
      creditMultiplier?: number;
    }[];
  }): Promise<ApiResponse<unknown>> {
    await this.adminService.batchUpdateModelAccess(body.items);
    return { code: 0, message: '更新成功', data: null };
  }

  @RequireAdminPermission('admin.catalog.models.view')
  @Get('model-route-policies')
  async listModelRoutePolicies(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listModelRoutePolicies() };
  }

  @RequireAdminPermission('admin.data.model_access.manage')
  @Post('model-route-policies/batch')
  async batchUpdateModelRoutePolicies(@Body() body: {
    items: {
      planId?: string;
      routeKey?: string;
      primaryModel?: string | null;
      fallbackModels?: string[];
      isActive?: boolean;
    }[];
  }): Promise<ApiResponse<unknown>> {
    await this.adminService.batchUpdateModelRoutePolicies(body.items);
    return { code: 0, message: '更新成功', data: null };
  }

  // ============================
  // 角色管理
  // ============================

  @RequireAdminPermission('admin.catalog.roles.view')
  @Get('roles')
  async listRoles(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listRoles() };
  }

  @RequireAdminPermission('admin.page.roles.view')
  @Get('roles/:id')
  async getRoleById(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.getRoleById(id) };
  }

  @RequireAdminPermission('admin.page.roles.manage')
  @Post('roles')
  async createRole(
    @Body() body: {
      name: string;
      description?: string;
      permissions?: string;
      key?: string;
      sortOrder?: number;
    },
    @CurrentUser('id') operatorAdminId: string,
  ): Promise<ApiResponse<unknown>> {
    const role = await this.adminService.createRole(body, operatorAdminId);
    return { code: 0, message: '创建成功', data: role };
  }

  @RequireAdminPermission('admin.page.roles.manage')
  @Put('roles/:id')
  async updateRole(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      description?: string;
      permissions?: string;
      key?: string;
      isActive?: boolean;
      sortOrder?: number;
    },
    @CurrentUser('id') operatorAdminId: string,
  ): Promise<ApiResponse<unknown>> {
    const role = await this.adminService.updateRole(id, body, operatorAdminId);
    return { code: 0, message: '更新成功', data: role };
  }

  @RequireAdminPermission('admin.page.roles.manage')
  @Delete('roles/:id')
  async deleteRole(
    @Param('id') id: string,
    @CurrentUser('id') operatorAdminId: string,
  ): Promise<ApiResponse<unknown>> {
    await this.adminService.deleteRole(id, operatorAdminId);
    return { code: 0, message: '删除成功', data: null };
  }

  // ============================
  // 管理员成员管理
  // ============================

  @RequireAdminPermission('admin.page.members.view')
  @Get('members')
  async listMembers(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.adminService.listAdminMembers() };
  }

  @RequireAdminPermission('admin.page.members.manage')
  @Post('members/invite')
  async inviteMember(
    @Body() body: { email: string; roleId: string; name?: string; phone?: string; department?: string },
    @CurrentUser() user: { id: string },
  ): Promise<ApiResponse<unknown>> {
    if (!body.email) throw new BadRequestException('邮箱为必填');
    if (!body.roleId) throw new BadRequestException('角色为必填');
    const result = await this.adminService.inviteAdminMember(
      body.email,
      body.roleId,
      user.id,
      { name: body.name, phone: body.phone, department: body.department },
    );
    return { code: 0, message: '邀请成功', data: result };
  }

  @RequireAdminPermission('admin.page.members.manage')
  @Put('members/:id')
  async updateMember(
    @Param('id') id: string,
    @Body() body: {
      presetRole?: string;
      permissions?: Record<string, boolean>;
      isActive?: boolean;
      roleId?: string;
      name?: string;
      phone?: string;
      department?: string;
    },
    @CurrentUser('id') operatorAdminId: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.updateAdminMember(id, body, operatorAdminId);
    return { code: 0, message: '更新成功', data: result };
  }

  @RequireAdminPermission('admin.page.members.manage')
  @Delete('members/:id')
  async removeMember(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    await this.adminService.removeAdminMember(id);
    return { code: 0, message: '已移除', data: null };
  }

  @RequireAdminPermission('admin.page.members.manage')
  @Post('members/:id/force-logout')
  async forceLogout(@Param('id') id: string): Promise<ApiResponse<null>> {
    await this.adminService.forceLogout(id);
    return { code: 0, message: '已强制下线', data: null };
  }

  @RequireAdminPermission('admin.page.members.manage')
  @Post('members/:id/reset-password')
  async resetMemberPassword(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.resetAdminPassword(id);
    return { code: 0, message: '密码已重置', data: result };
  }

  // ============================
  // 用户管理增强
  // ============================

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users')
  async createUser(
    @Body() body: {
      email: string; nickname?: string; phone?: string; role?: string;
    },
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const user = await this.adminService.createUser(body, adminId);
    return { code: 0, message: '邀请已发送', data: user };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Put('users/:id')
  async updateUser(
    @Param('id') id: string,
    @Body() body: { email?: string; nickname?: string; phone?: string; role?: string; isActive?: boolean },
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const user = await this.adminService.updateUser(id, body, adminId);
    return { code: 0, message: '用户已更新', data: user };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users/:id/reset-password')
  async resetUserPassword(
    @Param('id') id: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.resetUserPassword(id, adminId);
    return { code: 0, message: '密码已重置', data: result };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users/:id/ban')
  async banUser(
    @Param('id') userId: string,
    @Body() body: { reason: string },
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.banUser(userId, body.reason, adminId);
    return { code: 0, message: '用户已封禁', data: result };
  }

  @RequireAdminPermission('admin.page.users.manage')
  @Post('users/:id/unban')
  async unbanUser(
    @Param('id') userId: string,
    @CurrentUser('id') adminId: string,
  ): Promise<ApiResponse<unknown>> {
    const result = await this.adminService.unbanUser(userId, adminId);
    return { code: 0, message: '用户已解封', data: result };
  }

  // ============================
  // 用户批量导入（Python backfill）
  // ============================

  @RequireAdminPermission('admin.page.system_config.manage')
  @Post('backfill-users')
  async backfillUsers(
    @Body() body: { users: Array<{ email: string; externalId: string; nickname?: string }> },
  ): Promise<ApiResponse<unknown>> {
    if (!Array.isArray(body.users) || body.users.length === 0) {
      throw new BadRequestException('users 数组不能为空');
    }
    if (body.users.length > 500) {
      throw new BadRequestException('单次最多导入 500 个用户');
    }
    const results = await this.adminService.backfillUsers(body.users);
    return { code: 0, message: 'ok', data: results };
  }
}
