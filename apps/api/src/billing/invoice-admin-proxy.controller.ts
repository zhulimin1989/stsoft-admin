import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { ApiResponse } from '@ruidong/shared';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import {
  BillingInternalClient,
  type IssueUploadedInvoiceRequest,
} from './billing-internal.client';

/**
 * 财务中心「发票管理」：代理到 billing 内部 admin 发票端点。
 * 列表/详情走 JSON；批量下载返回 zip 二进制（@Res 直透）。
 */
@Controller('admin/invoices')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class InvoiceAdminProxyController {
  constructor(private readonly billing: BillingInternalClient) {}

  @RequireAdminPermission('admin.page.invoices.view')
  @Get()
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      email?: string;
      username?: string;
      orderId?: string;
      productName?: string;
      applicationNo?: string;
      invoiceNumber?: string;
      issuedFrom?: string;
      issuedTo?: string;
      userId?: string;
      tenantId?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const params: Record<string, string | number | undefined> = {
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 20,
      ...(query.status ? { status: query.status } : {}),
      ...(query.email ? { email: query.email } : {}),
      ...(query.username ? { username: query.username } : {}),
      ...(query.orderId ? { orderId: query.orderId } : {}),
      ...(query.productName ? { productName: query.productName } : {}),
      ...(query.applicationNo ? { applicationNo: query.applicationNo } : {}),
      ...(query.invoiceNumber ? { invoiceNumber: query.invoiceNumber } : {}),
      ...(query.issuedFrom ? { issuedFrom: query.issuedFrom } : {}),
      ...(query.issuedTo ? { issuedTo: query.issuedTo } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.tenantId ? { tenantId: query.tenantId } : {}),
    };
    return { code: 0, message: 'ok', data: await this.billing.listInvoices(params) };
  }

  @RequireAdminPermission('admin.page.invoices.view')
  @Get('deployment')
  async deployment(): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.billing.getInvoiceDeployment() };
  }

  @RequireAdminPermission('admin.page.invoices.view')
  @Get(':id/psa-attachment')
  async downloadPsaAttachment(
    @Param('id') id: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const { buffer, contentType, filename } = await this.billing.downloadPsaInvoiceAttachment(id);
    reply
      .header('Content-Type', contentType || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header(
        'Content-Disposition',
        `attachment; filename="${filename ?? 'invoice.xlsx'}"`,
      );
    await reply.send(buffer);
  }

  @RequireAdminPermission('admin.page.invoices.view')
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.billing.getInvoiceDetail(id) };
  }

  @RequireAdminPermission('admin.page.invoices.view')
  @Post('download')
  async download(
    @Body() body: { ids?: string[] },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const ids = Array.isArray(body?.ids) ? body.ids : [];
    const { buffer, contentType, filename } = await this.billing.downloadInvoicesZip(ids);
    reply
      .header('Content-Type', contentType || 'application/zip')
      .header(
        'Content-Disposition',
        `attachment; filename="${filename ?? 'invoices.zip'}"`,
      );
    await reply.send(buffer);
  }

  // ============================
  // 失败补救 / 流转（写操作，需发票页面管理权限）
  // ============================

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/approve')
  async approve(
    @Param('id') id: string,
    @Body() body: { remark?: string | null },
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.billing.approveInvoice(id, body?.remark ?? null),
    };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/psa-retry')
  async retryPsa(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    return { code: 0, message: 'ok', data: await this.billing.retryPsaInvoice(id) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/reject')
  async reject(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<ApiResponse<unknown>> {
    const reason = requireReason(body?.reason);
    return { code: 0, message: 'ok', data: await this.billing.rejectInvoice(id, reason) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/items/:itemId/issue-upload')
  async issueItemUpload(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() body: IssueUploadedInvoiceRequest,
  ): Promise<ApiResponse<unknown>> {
    return this.issueUpload(id, { ...body, itemId });
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/issue-upload')
  async issueUpload(
    @Param('id') id: string,
    @Body() body: IssueUploadedInvoiceRequest,
  ): Promise<ApiResponse<unknown>> {
    if (!body?.invoiceNumber?.trim()) throw new BadRequestException('invoiceNumber 不能为空');
    if (!body?.issuingEntity?.trim()) throw new BadRequestException('issuingEntity 不能为空');
    if (!body?.issueDate?.trim()) throw new BadRequestException('issueDate 不能为空');
    if (!body?.pdfFile?.base64) throw new BadRequestException('pdfFile 不能为空');
    return { code: 0, message: 'ok', data: await this.billing.issueUploadedInvoice(id, body) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/void')
  async void(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<ApiResponse<unknown>> {
    const reason = requireReason(body?.reason);
    return { code: 0, message: 'ok', data: await this.billing.voidInvoice(id, reason) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/red-offset')
  async redOffset(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<ApiResponse<unknown>> {
    const reason = requireReason(body?.reason);
    return { code: 0, message: 'ok', data: await this.billing.redOffsetInvoice(id, reason) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/fail')
  async fail(
    @Param('id') id: string,
    @Body() body: { reason?: string },
  ): Promise<ApiResponse<unknown>> {
    const reason = requireReason(body?.reason);
    return { code: 0, message: 'ok', data: await this.billing.failInvoice(id, reason) };
  }

  @RequireAdminPermission('admin.page.invoices.manage')
  @Post(':id/reissue')
  async reissue(
    @Param('id') id: string,
    @Body() body: { dryRun?: boolean },
  ): Promise<ApiResponse<unknown>> {
    return {
      code: 0,
      message: 'ok',
      data: await this.billing.repairInternationalRechargeInvoiceAmounts({
        applicationIds: [id],
        dryRun: body?.dryRun ?? false,
      }),
    };
  }
}

function requireReason(reason: string | undefined): string {
  const trimmed = reason?.trim();
  if (!trimmed) throw new BadRequestException('reason 不能为空');
  return trimmed;
}
