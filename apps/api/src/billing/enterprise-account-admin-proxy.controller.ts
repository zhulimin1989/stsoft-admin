import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { ApiResponse } from '@ruidong/shared';
import type { FastifyReply } from 'fastify';
import { RequireAdminPermission } from '../common/decorators/admin-permission.decorator';
import { AdminJwtAuthGuard } from '../common/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../common/guards/admin-permission.guard';
import { BillingInternalClient } from './billing-internal.client';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { getAdminRequestContext } from '../common/request/admin-context';

/**
 * 用户运营「企业账户」：聚合 user 侧企业实名态 + billing 侧企业账户账务态，并提供补救入口。
 * 对齐 InvoiceAdminProxyController：内部 client 调 billing / user internal，统一返回
 * ApiResponse={code,message,data}。
 *
 * 鉴权：admin 权限点校验统一放在本 proxy 层（AdminJwtAuthGuard + AdminPermissionGuard），
 * billing 内部 controller 只做 BillingInternalGuard + service 层归属校验（见 §10.2.4）。
 *
 * 权限点（§10.8-②）：企业账户归入用户运营，复用 users 权限；抽成常量便于将来替换为独立
 * 使用企业账户页面权限；detach 是高危动作，单独要求 detach 操作权限。
 *
 * 人工审核改造（§4.3.3 / §8.12）：新增独立运营审核点 `admin.enterprise_accounts.review`，
 * 覆盖审核动作（approve/reject/void）与敏感凭证签名 URL（营业执照 + 转账凭证）。营业执照 URL
 * 敏感审核接口要求 review；审核队列 list/detail 非敏感字段使用企业账户页面查看权限。
 */
export const ENTERPRISE_ACCOUNTS_VIEW = 'admin.page.enterprise_accounts.view';
export const ENTERPRISE_ACCOUNTS_MANAGE = 'admin.page.enterprise_accounts.manage';
export const ENTERPRISE_ACCOUNTS_DETACH = 'admin.page.enterprise_accounts.detach';
export const ENTERPRISE_ACCOUNTS_REVIEW = 'admin.page.enterprise_accounts.review';
export const ENTERPRISE_ACCOUNTS_CREDIT_MANAGE = ENTERPRISE_ACCOUNTS_MANAGE;
const MAX_ENTERPRISE_RECHARGE_CENTS = 25_000 * 100;
const BALANCE_ADJUSTMENT_REASON_CODES = [
  'DISCOUNT_CORRECTION',
  'BILLING_CORRECTION',
  'SERVICE_COMPENSATION',
  'OTHER',
] as const;

const REVIEW_ACTIONS = ['approve', 'reject', 'void'] as const;
type ReviewAction = (typeof REVIEW_ACTIONS)[number];

/** user 实名记录（子集），只取本 controller 聚合/校验需要的字段。 */
type UserVerification = {
  id?: string;
  type?: string;
  status?: string;
  enterpriseName?: string | null;
  uscc?: string | null;
  verifiedAt?: string | null;
  provisioningStatus?: string | null;
  verificationBadgeStatus?: string | null;
  reviewStatus?: string | null;
  provisioningLastError?: string | null;
  tenantId?: string | null;
  billingAccountId?: string | null;
};

const VERIFICATION_TYPE_ENTERPRISE = 'ENTERPRISE';
const VERIFICATION_STATUS_VERIFIED = 'VERIFIED';

@Controller('admin/enterprise-accounts')
@UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
export class EnterpriseAccountAdminProxyController {
  constructor(
    private readonly billing: BillingInternalClient,
    private readonly user: UserInternalClient,
    private readonly activityLog: AdminActivityLogService,
  ) {}

  /** 列表：billing 企业账户 + 可选按 owner / uscc / status 过滤。 */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get()
  async list(
    @Query()
    query: {
      page?: string;
      pageSize?: string;
      status?: string;
      ownerUserId?: string;
      uscc?: string;
      search?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseAccounts({
      page: query.page ? parseInt(query.page, 10) : 1,
      pageSize: query.pageSize ? parseInt(query.pageSize, 10) : 20,
      ...(query.status ? { status: query.status } : {}),
      ...(query.ownerUserId ? { ownerUserId: query.ownerUserId } : {}),
      ...(query.uscc ? { uscc: query.uscc } : {}),
      ...(query.search ? { search: query.search } : {}),
    });
    return { code: 0, message: 'ok', data };
  }

  /**
   * 只读：企业开通回收的危害候选集，含 `stalledFanout`（已耗尽重试停在 ALERTED 的作业）。
   *
   * ⚠️ 路由顺序：本静态路由必须声明在动态 `GET /:id` 之前，否则会被详情路由吞掉。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get('recovery-hazards')
  async listRecoveryHazards(
    @Query() query: { cursor?: string; limit?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseProvisioningHazards({
      ...(query.cursor ? { cursor: query.cursor } : {}),
      ...(query.limit ? { limit: parseInt(query.limit, 10) } : {}),
    });
    return { code: 0, message: 'ok', data };
  }

  /**
   * 审核队列列表：数据源是 user 侧 EnterpriseOnboardingApplication（approve 前尚无 billing
   * account，不能从 billing 列表派生，§4.3/§8.0c）。非敏感字段使用企业账户页面查看权限。
   *
   * 路由顺序（§4.3.1/§8.12b）：本静态路由必须声明在动态 `GET /:id` 之前，否则会被详情路由吞掉。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get('review-applications')
  async listReviewApplications(
    @Query()
    query: {
      reviewStatus?: string;
      provisioningStatus?: string;
      search?: string;
      userId?: string;
      page?: string;
      pageSize?: string;
      cursor?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.user.listEnterpriseOnboardingApplications({
      ...(query.reviewStatus ? { reviewStatus: query.reviewStatus } : {}),
      ...(query.provisioningStatus ? { provisioningStatus: query.provisioningStatus } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.userId ? { userId: query.userId } : {}),
      ...(query.page ? { page: parseInt(query.page, 10) } : {}),
      ...(query.pageSize ? { pageSize: parseInt(query.pageSize, 10) } : {}),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return { code: 0, message: 'ok', data };
  }

  /**
   * 审核详情：user 侧 application 聚合（实名 / review / provisioning / 凭证元数据）。
   * 敏感签名 URL 不在详情内直接返回，走独立 review 级端点。静态路由，需先于 `GET /:id`。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get('review-applications/:id')
  async reviewApplicationDetail(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.user.getEnterpriseOnboardingApplication(id);
    if (!data) {
      throw new NotFoundException('审核申请不存在');
    }
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/model-discounts')
  async listModelDiscounts(
    @Param('id') id: string,
    @Query('productId') productId?: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseModelDiscounts(id, productId ?? '');
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Put(':id/model-discounts')
  async updateModelDiscounts(
    @Param('id') id: string,
    @Body()
    body: {
      productId?: string;
      items?: Array<{
        modelName?: string;
        priceMultiplier?: string | number | null;
        isActive?: boolean;
        note?: string | null;
      }>;
    },
  ): Promise<ApiResponse<unknown>> {
    const operatorId = getAdminRequestContext()?.adminId ?? null;
    const productId = requireField(body?.productId, 'productId');
    const items = Array.isArray(body?.items) ? body.items : [];
    const data = await this.billing.updateEnterpriseModelDiscounts(id, {
      productId,
      items,
      updatedBy: operatorId,
    });
    if (operatorId) {
      await this.activityLog.log({
        adminMemberId: operatorId,
        action: 'enterprise_account.model_discount.update',
        resource: 'enterprise_account',
        resourceId: id,
        detail: {
          productId,
          itemCount: items.length,
        },
      });
    }
    return { code: 0, message: '保存成功', data };
  }

  /**
   * 详情双视角：billing 账务态（account + wallet + owner members + tenants）
   * 叠加 owner 用户的 user 侧企业实名快照（认证态）。实名查询失败不阻断账务详情返回。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id')
  async detail(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const account = (await this.billing.getEnterpriseAccount(id)) as
      | (Record<string, unknown> & { ownerUserId?: string | null })
      | null;
    if (!account) {
      throw new NotFoundException('企业账户不存在');
    }

    let ownerVerification: UserVerification | null = null;
    const ownerUserId = typeof account.ownerUserId === 'string' ? account.ownerUserId : null;
    if (ownerUserId) {
      try {
        const verifications = await this.fetchEnterpriseVerifications(ownerUserId);
        ownerVerification = this.pickEnterpriseVerification(verifications);
      } catch {
        // 实名侧查询失败不阻断账务详情：仅缺认证快照。
        ownerVerification = null;
      }
    }

    return {
      code: 0,
      message: 'ok',
      data: { account, ownerVerification },
    };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/credit')
  async getCredit(@Param('id') id: string): Promise<ApiResponse<unknown>> {
    const data = await this.billing.getEnterpriseAccountCredit(id);
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_CREDIT_MANAGE)
  @Put(':id/credit')
  async updateCredit(
    @Param('id') id: string,
    @Body()
    body: {
      limitCents?: number | null;
      status?: string | null;
      termsDays?: number | null;
      effectiveAt?: string | null;
      expiresAt?: string | null;
      reason?: string | null;
      note?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const operatorId = getAdminRequestContext()?.adminId ?? null;
    const reason = requireField(body?.reason, 'reason');
    const data = await this.billing.updateEnterpriseAccountCredit(id, {
      ...(body?.limitCents !== undefined ? { limitCents: body.limitCents } : {}),
      ...(body?.status !== undefined ? { status: body.status } : {}),
      ...(body?.termsDays !== undefined ? { termsDays: body.termsDays } : {}),
      ...(body?.effectiveAt !== undefined ? { effectiveAt: body.effectiveAt } : {}),
      ...(body?.expiresAt !== undefined ? { expiresAt: body.expiresAt } : {}),
      reason,
      ...(body?.note !== undefined ? { note: body.note } : {}),
      updatedBy: operatorId,
    });
    if (operatorId) {
      await this.activityLog.log({
        adminMemberId: operatorId,
        action: 'enterprise_account.credit.update',
        resource: 'enterprise_account',
        resourceId: id,
        detail: {
          limitCents: body?.limitCents ?? null,
          status: body?.status ?? null,
          termsDays: body?.termsDays ?? null,
          effectiveAt: body?.effectiveAt ?? null,
          expiresAt: body?.expiresAt ?? null,
          reason,
          ...(body?.note ? { note: body.note } : {}),
        },
      });
    }
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_VIEW)
  @Get(':id/credit-events')
  async listCreditEvents(
    @Param('id') id: string,
    @Query() query: { limit?: string; cursor?: string },
  ): Promise<ApiResponse<unknown>> {
    const data = await this.billing.listEnterpriseAccountCreditEvents(id, {
      limit: query.limit ? parseInt(query.limit, 10) : 50,
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return { code: 0, message: 'ok', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/recharge')
  async recharge(
    @Param('id') id: string,
    @Body()
    body: {
      amountCents?: number;
      productId?: string | null;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const operatorId = getAdminRequestContext()?.adminId ?? null;
    const amountCents = requirePositiveCents(body?.amountCents, 'amountCents');
    const productId = requireField(body?.productId, 'productId');
    const description = typeof body?.description === 'string' && body.description.trim()
      ? body.description.trim()
      : '企业账户管理员充值';
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.billing.rechargeEnterpriseAccount(id, {
      amountCents,
      productId,
      description,
      idempotencyKey,
    });
    if (operatorId) {
      await this.activityLog.log({
        adminMemberId: operatorId,
        action: 'enterprise_account.balance.recharge',
        resource: 'enterprise_account',
        resourceId: id,
        detail: {
          amountCents,
          productId,
          description,
        },
      });
    }
    return { code: 0, message: '充值成功', data };
  }

  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/balance-adjustment')
  async applyBalanceAdjustment(
    @Param('id') id: string,
    @Body()
    body: {
      amountCents?: number;
      reasonCode?: string | null;
      description?: string | null;
      idempotencyKey?: string | null;
    },
  ): Promise<ApiResponse<unknown>> {
    const operatorId = getAdminRequestContext()?.adminId ?? null;
    if (!operatorId) throw new BadRequestException('缺少管理员身份');
    const amountCents = requireSignedAdjustmentCents(body?.amountCents);
    const reasonCode = requireField(body?.reasonCode, 'reasonCode');
    if (!BALANCE_ADJUSTMENT_REASON_CODES.includes(
      reasonCode as (typeof BALANCE_ADJUSTMENT_REASON_CODES)[number],
    )) {
      throw new BadRequestException('reasonCode 无效');
    }
    const description = requireField(body?.description, 'description');
    const idempotencyKey = requireField(body?.idempotencyKey, 'idempotencyKey');
    const data = await this.billing.applyEnterpriseBalanceAdjustment(id, {
      amountCents,
      reasonCode: reasonCode as (typeof BALANCE_ADJUSTMENT_REASON_CODES)[number],
      description,
      performedBy: operatorId,
      idempotencyKey,
    });
    await this.activityLog.log({
      adminMemberId: operatorId,
      operatorAdminId: operatorId,
      action: 'enterprise_account.balance.billing_adjustment',
      resource: 'enterprise_account',
      resourceId: id,
      after: data,
      detail: {
        amountCents,
        reasonCode,
        description,
        transactionId: data.transaction.id,
      },
    });
    return { code: 0, message: '账单调额成功', data };
  }

  /**
   * 创建企业账户：先查 user 实名，拒绝非企业实名 / 未通过实名，再用实名快照透传 billing。
   * 前端不拼可信字段（企业名 / uscc / verifiedAt），一律以 user 侧实名快照为准。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post()
  async create(
    @Body()
    body: {
      userId?: string;
      tenantId?: string | null;
      verificationId?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const userId = requireField(body?.userId, 'userId');

    const verifications = await this.fetchEnterpriseVerifications(userId);
    const verification = this.pickEnterpriseVerification(
      verifications,
      body?.verificationId?.trim() || undefined,
    );
    if (!verification) {
      // §10.3：补救时 user 无企业实名。
      throw new NotFoundException('该用户没有企业实名记录（enterprise_verification_not_found）');
    }
    if (verification.status !== VERIFICATION_STATUS_VERIFIED) {
      throw new BadRequestException('该用户企业实名未通过，不能创建企业账户');
    }
    if (
      verification.reviewStatus &&
      verification.reviewStatus !== 'APPROVED'
    ) {
      throw new BadRequestException(
        '该用户企业认证仍在对公转账/人工审核流程中，不能创建企业账户',
      );
    }
    const verificationId = verification.id;
    if (!verificationId) {
      throw new BadRequestException('企业实名记录缺少 id，无法创建企业账户');
    }

    // 可信字段必须来自 user 侧实名快照且非空：缺 enterpriseName / uscc 时拒绝，
    // 不透传空串建 billing 企业账户（否则产生脏数据，且可能撞 uscc partial unique）。
    const enterpriseName = verification.enterpriseName?.trim();
    const uscc = verification.uscc?.trim();
    if (!enterpriseName || !uscc) {
      throw new BadRequestException(
        '企业实名快照缺少企业名称或统一社会信用代码，无法创建企业账户（enterprise_verification_incomplete）',
      );
    }

    const data = await this.billing.createEnterpriseAccount({
      userId,
      tenantId: body?.tenantId ?? verification.tenantId ?? null,
      verificationId,
      enterpriseName,
      uscc,
      verifiedAt: verification.verifiedAt ?? null,
      idempotencyKey: `ent-acct:${verificationId}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /** attach tenant：透传 billing（幂等键取 tenantId）。 */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post(':id/attach-tenant')
  async attachTenant(
    @Param('id') id: string,
    @Body() body: { tenantId?: string },
  ): Promise<ApiResponse<unknown>> {
    const tenantId = requireField(body?.tenantId, 'tenantId');
    const data = await this.billing.attachEnterpriseTenant(id, {
      tenantId,
      idempotencyKey: `ent-attach:${id}:${tenantId}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /** detach tenant：高危动作，需企业账户 detach 权限且强制 reason。 */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_DETACH)
  @Post(':id/detach-tenant')
  async detachTenant(
    @Param('id') id: string,
    @Body() body: { tenantId?: string; reason?: string },
  ): Promise<ApiResponse<unknown>> {
    const tenantId = requireField(body?.tenantId, 'tenantId');
    const reason = requireField(body?.reason, 'reason');
    const data = await this.billing.detachEnterpriseTenant(id, {
      tenantId,
      reason,
      idempotencyKey: `ent-detach:${id}:${tenantId}`,
    });
    return { code: 0, message: 'ok', data };
  }

  /**
   * 补救重试：调 user internal retry（独立 `provisioning/` 段避免与 `/:id` 歧义，§10.7-③）。
   * user internal 按 verificationId 定位开通任务；userId 用于归属，从请求体带入。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_MANAGE)
  @Post('provisioning/:verificationId/retry')
  async retryProvisioning(
    @Param('verificationId') verificationId: string,
    @Body() body: { userId?: string },
  ): Promise<ApiResponse<unknown>> {
    const userId = requireField(body?.userId, 'userId');
    const data = await this.user.retryEnterpriseProvisioning(userId, verificationId);
    return { code: 0, message: 'ok', data };
  }

  /**
   * 营业执照短时效查看：转发 user internal signed URL，admin 不持有对象存储密钥。
   * 权限收紧（§4.3.3/§8.12/§8.12c）：要求 review —— 营业执照属敏感凭证，
   * 不再让任意 users.view 者查看。签发签名 URL 落审计（operator/时间/verificationId），URL 本身不入日志。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_REVIEW)
  @Get(':verificationId/license-url')
  async licenseUrl(
    @Param('verificationId') verificationId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.user.getEnterpriseLicenseUrl(verificationId);
    await this.auditCredentialUrl('enterprise_account.license_url.view', verificationId);
    return { code: 0, message: 'ok', data };
  }

  /**
   * 营业执照文件代理查看：admin-api 调 user-api 读取对象存储，再以二进制返回浏览器。
   * 保留 license-url 兼容旧前端；新前端走本接口，避免 S3/OSS signed URL 被浏览器直连策略拒绝。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_REVIEW)
  @Get(':verificationId/license-file')
  async licenseFile(
    @Param('verificationId') verificationId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.user.getEnterpriseLicenseFile(verificationId);
    await this.auditCredentialUrl('enterprise_account.license_file.view', verificationId);
    reply
      .header('Content-Type', file.contentType || 'application/octet-stream')
      .header('Cache-Control', 'no-store')
      .header('Content-Disposition', contentDispositionInline(file.filename || 'license'));
    if (file.contentLength !== null) {
      reply.header('Content-Length', String(file.contentLength));
    }
    await reply.send(file.buffer);
  }

  /**
   * 转账凭证短时效查看：转发 user internal signed URL。review 级权限 + 审计（Sec-3）。
   * 转账截图属敏感财务凭证，签名 URL 短时效访问、不外发 object key、不入持久化日志。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_REVIEW)
  @Get(':verificationId/payment-proof-url')
  async paymentProofUrl(
    @Param('verificationId') verificationId: string,
  ): Promise<ApiResponse<unknown>> {
    const data = await this.user.getPaymentProofUrl(verificationId);
    await this.auditCredentialUrl('enterprise_account.payment_proof.view', verificationId);
    return { code: 0, message: 'ok', data };
  }

  /**
   * 人工审核动作（§4.3.1）：approve（触发开通，幂等）/ reject（带分类+原因）/ void（仅翻审核态）。
   * 代理 user review 端点，operator 身份取自当前 admin 请求上下文（不信任前端传入）。
   * v1 `void` 只翻审核态、不调 billing（billing void 属 v2，§3.3/§4.4）。审核动作落审计。
   */
  @RequireAdminPermission(ENTERPRISE_ACCOUNTS_REVIEW)
  @Post(':verificationId/review')
  async review(
    @Param('verificationId') verificationId: string,
    @Body()
    body: {
      action?: string;
      rejectCategory?: string;
      rejectReason?: string;
      note?: string;
    },
  ): Promise<ApiResponse<unknown>> {
    const action = (body?.action ?? '').trim() as ReviewAction;
    if (!REVIEW_ACTIONS.includes(action)) {
      throw new BadRequestException(
        `action 必须为 ${REVIEW_ACTIONS.join(' / ')} 之一`,
      );
    }
    // reject 必须带分类 + 原因，避免驳回后用户无从判断该重传截图还是重走认证（G2）。
    if (action === 'reject') {
      const rejectCategory = body?.rejectCategory?.trim();
      if (rejectCategory !== 'payment_proof' && rejectCategory !== 'enterprise_info') {
        throw new BadRequestException(
          'reject 时 rejectCategory 必须为 payment_proof / enterprise_info',
        );
      }
      if (!body?.rejectReason?.trim()) {
        throw new BadRequestException('reject 时 rejectReason 不能为空');
      }
    }

    const operatorId = getAdminRequestContext()?.adminId;
    if (!operatorId) {
      throw new BadRequestException('缺少 operator 身份上下文');
    }

    const data = await this.user.reviewEnterpriseVerification(verificationId, {
      action,
      operatorId,
      ...(body?.rejectCategory?.trim() ? { rejectCategory: body.rejectCategory.trim() } : {}),
      ...(body?.rejectReason?.trim() ? { rejectReason: body.rejectReason.trim() } : {}),
      ...(body?.note?.trim() ? { note: body.note.trim() } : {}),
    });

    await this.activityLog.log({
      adminMemberId: operatorId,
      action: `enterprise_account.review.${action}`,
      resource: 'enterprise_account',
      resourceId: verificationId,
      detail: {
        action,
        ...(body?.rejectCategory ? { rejectCategory: body.rejectCategory } : {}),
        ...(body?.rejectReason ? { rejectReason: body.rejectReason } : {}),
        ...(body?.note ? { note: body.note } : {}),
      },
    });

    return { code: 0, message: 'ok', data };
  }

  /** 敏感凭证签名 URL 签发审计：只记 operator/时间/verificationId，不落 URL 本身（Sec-3）。 */
  private async auditCredentialUrl(action: string, verificationId: string): Promise<void> {
    const operatorId = getAdminRequestContext()?.adminId;
    if (!operatorId) return;
    await this.activityLog.log({
      adminMemberId: operatorId,
      action,
      resource: 'enterprise_account',
      resourceId: verificationId,
    });
  }

  private async fetchEnterpriseVerifications(userId: string): Promise<UserVerification[]> {
    const raw = await this.user.getUserVerifications(userId);
    if (Array.isArray(raw)) return raw as UserVerification[];
    // 兼容 { items: [...] } 信封形态。
    const items = (raw as { items?: unknown } | null)?.items;
    return Array.isArray(items) ? (items as UserVerification[]) : [];
  }

  private pickEnterpriseVerification(
    verifications: UserVerification[],
    verificationId?: string,
  ): UserVerification | null {
    const enterprise = verifications.filter(
      (v) => v?.type === VERIFICATION_TYPE_ENTERPRISE,
    );
    if (verificationId) {
      return enterprise.find((v) => v?.id === verificationId) ?? null;
    }
    // 优先已通过的企业实名；否则取第一条企业实名。
    return (
      enterprise.find((v) => v?.status === VERIFICATION_STATUS_VERIFIED) ??
      enterprise[0] ??
      null
    );
  }
}

function requireField(value: string | undefined | null, name: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) throw new BadRequestException(`${name} 不能为空`);
  return trimmed;
}

function requirePositiveCents(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException(`${name} 必须为整数分值`);
  }
  if (value <= 0) {
    throw new BadRequestException('充值金额必须大于 0');
  }
  if (value > MAX_ENTERPRISE_RECHARGE_CENTS) {
    throw new BadRequestException('单次充值不能超过 25,000.00');
  }
  return value;
}

function requireSignedAdjustmentCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new BadRequestException('amountCents 必须为整数分值');
  }
  if (value === 0) {
    throw new BadRequestException('调额金额不能为 0');
  }
  if (Math.abs(value) > MAX_ENTERPRISE_RECHARGE_CENTS) {
    throw new BadRequestException('单次调额不能超过 25,000.00');
  }
  return value;
}

function contentDispositionInline(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_') || 'license';
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
