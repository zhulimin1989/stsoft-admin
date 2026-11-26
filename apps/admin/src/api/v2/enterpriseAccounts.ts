import api from '../axios';

// 前端文件放在 api/v2/ 只是代码组织目录；实际后端请求路径为 /admin/enterprise-accounts
// （非 /admin/v2/...，见方案 §10.2.6）。

/** billing 企业账户业务状态（快照，字段以 billing 端为准，前端做容错渲染）。 */
export type EnterpriseAccountStatus = string;

/** 企业账户开通业务展示态（user 侧 EnterpriseAccountProvisioning.status，§10.1.4）。 */
export type ProvisioningStatus =
  | 'PENDING'
  | 'VERIFYING'
  | 'PROVISIONING'
  | 'ACTIVE'
  // 议题二批一：作废两阶段。VOIDING = 回收中（可「继续作废」），VOIDED = 已作废（终态）。
  | 'VOIDING'
  | 'VOIDED'
  | 'FAILED_RETRYABLE'
  | 'FAILED_FINAL';

export type VerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type VerificationBadgeStatus = 'VERIFYING' | 'VERIFIED';

/** billing 侧企业账户账务快照。 */
export interface EnterpriseAccount {
  id: string;
  type?: string;
  name?: string | null;
  ownerUserId?: string | null;
  status?: EnterpriseAccountStatus | null;
  currency?: string | null;
  enterpriseName?: string | null;
  uscc?: string | null;
  verificationId?: string | null;
  verifiedAt?: string | null;
  balanceUsd?: number | string | null;
  balanceAmount?: string | null;
  credit?: EnterpriseAccountCredit | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface EnterpriseAccountCredit {
  billingAccountId: string;
  status: string;
  limitCents: number;
  limitUsd?: number;
  limitAmount?: string;
  activeLimitCents?: number;
  usedCents: number;
  remainingCents: number;
  accountBalanceCents: number | null;
  accountAvailableBalanceCents: number;
  /** 授信策略的单调版本；0 表示尚未建立可验证的策略时间边界。 */
  policyRevision: number;
  /** 当前策略完成提交后确认的生效边界。 */
  policyEffectiveBoundaryAt: string | null;
  /** false 时策略仍处于 decision → confirmed 间隙，不可作为新请求的授信证据。 */
  policyBoundaryComplete: boolean;
  termsDays?: number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  updatedBy?: string | null;
  note?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface EnterpriseAccountCreditEvent {
  id: string;
  billingAccountId: string;
  oldLimitCents: number | null;
  newLimitCents: number;
  oldStatus: string | null;
  newStatus: string;
  oldTermsDays: number | null;
  newTermsDays: number | null;
  oldExpiresAt?: string | null;
  newExpiresAt?: string | null;
  policyRevision: number | null;
  policyDecisionAt: string | null;
  policyEffectiveBoundaryAt: string | null;
  policyBoundaryComplete: boolean;
  policyFanoutEnqueuedAt?: string | null;
  actorId?: string | null;
  reason?: string | null;
  note?: string | null;
  createdAt?: string | null;
}

export interface EnterpriseAccountCreditEventsResult {
  items: EnterpriseAccountCreditEvent[];
  nextCursor?: string | null;
}

export interface EnterpriseAccountListResult {
  items: EnterpriseAccount[];
  total: number;
  page: number;
  pageSize: number;
  totalPages?: number;
}

export interface EnterpriseAccountListParams {
  page?: number;
  pageSize?: number;
  status?: string;
  ownerUserId?: string;
  uscc?: string;
  search?: string;
}

export interface EnterpriseAccountOwnerMember {
  billingAccountId?: string;
  userId: string;
  role?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

export interface EnterpriseAccountTenant {
  tenantId: string;
  name?: string | null;
  type?: string | null;
  status?: string | null;
  billingAccountId?: string | null;
}

/** user 侧企业实名快照（认证视角）。 */
export interface EnterpriseVerificationSnapshot {
  creationSource?: string | null;
  verificationMethod?: string | null;
  paymentMode?: string | null;
  id?: string;
  type?: string;
  status?: VerificationStatus | string;
  enterpriseName?: string | null;
  uscc?: string | null;
  verifiedAt?: string | null;
  provisioningStatus?: ProvisioningStatus | string | null;
  verificationBadgeStatus?: VerificationBadgeStatus | string | null;
  reviewStatus?: ReviewStatus | string | null;
  provisioningLastError?: string | null;
  tenantId?: string | null;
  billingAccountId?: string | null;
}

/** 详情双视角：billing 账务态 + user 认证态。 */
export interface EnterpriseAccountDetail {
  account: EnterpriseAccount & {
    ownerMembers?: EnterpriseAccountOwnerMember[];
    tenants?: EnterpriseAccountTenant[];
  };
  ownerVerification: EnterpriseVerificationSnapshot | null;
}

export interface CreateEnterpriseAccountBody {
  userId: string;
  /** 可选；不传时后端以该 user 的企业实名快照定位 tenant。 */
  tenantId?: string | null;
  /** 可选；不传时后端取该 user 已通过的企业实名记录。 */
  verificationId?: string;
}

export interface UpdateEnterpriseCreditBody {
  limitCents: number;
  status: 'ACTIVE' | 'DISABLED' | 'SUSPENDED';
  termsDays?: number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  reason: string;
  note?: string | null;
}

export interface RechargeEnterpriseAccountBody {
  amountCents: number;
  productId: string;
  description: string;
  idempotencyKey: string;
}

export type BalanceAdjustmentReasonCode =
  | 'DISCOUNT_CORRECTION'
  | 'BILLING_CORRECTION'
  | 'SERVICE_COMPENSATION'
  | 'OTHER';

export interface EnterpriseBalanceAdjustmentBody {
  amountCents: number;
  reasonCode: BalanceAdjustmentReasonCode;
  description: string;
  idempotencyKey: string;
}

export interface EnterpriseModelDiscountRow {
  modelName: string;
  provider?: string | null;
  modelActive?: boolean;
  availability?: {
    status?: string | null;
    apiEnabled?: boolean | null;
    visible?: boolean | null;
    displayOrder?: number | null;
    active?: boolean | null;
  };
  base: {
    input: number;
    cached: number | null;
    cacheWrite: number | null;
    output: number;
  };
  effective: {
    input: number;
    cached: number | null;
    cacheWrite: number | null;
    output: number;
  };
  tiers?: Array<{
    tierKey: string;
    displayName?: string | null;
    minInputTokens: number;
    maxInputTokensExclusive?: number | null;
    base: {
      input: number;
      cached: number | null;
      cacheWrite: number | null;
      output: number;
    };
    effective: {
      input: number;
      cached: number | null;
      cacheWrite: number | null;
      output: number;
    };
  }>;
  fallbackPricing?: {
    default: {
      base: {
        input: number;
        cached: number | null;
        cacheWrite: number | null;
        output: number;
      };
      effective: {
        input: number;
        cached: number | null;
        cacheWrite: number | null;
        output: number;
      };
    };
    longContext: null | {
      minInputTokens: number;
      base: {
        input: number;
        cached: number | null;
        cacheWrite: number | null;
        output: number;
      };
      effective: {
        input: number;
        cached: number | null;
        cacheWrite: number | null;
        output: number;
      };
    };
  };
  configured: boolean;
  priceMultiplier: string;
  discount?: {
    id: string;
    priceMultiplier: string;
    isActive: boolean;
    note?: string | null;
    updatedBy?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
  } | null;
}

export interface EnterpriseModelDiscountMatrix {
  account: EnterpriseAccount;
  product: {
    id: string;
    name: string;
    slug?: string | null;
    billingMode?: string | null;
    isActive?: boolean | null;
  };
  items: EnterpriseModelDiscountRow[];
}

export interface UpdateEnterpriseModelDiscountsBody {
  productId: string;
  items: Array<{
    modelName: string;
    priceMultiplier: number;
    isActive?: boolean;
    note?: string | null;
  }>;
}

export interface LicenseUrlResult {
  url: string;
  expiresAt?: string | null;
}

/** 审核状态（user 侧 EnterpriseOnboardingApplication.reviewStatus，§3.1）。 */
export type ReviewStatus =
  | 'AWAITING_PAYMENT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED';

/** 审核申请列表行（user application list 最小字段，§4.2）。 */
export interface ReviewApplication {
  applicationId: string;
  applicationNo?: string | null;
  verificationId: string;
  userId?: string | null;
  enterpriseName?: string | null;
  uscc?: string | null;
  reviewStatus?: ReviewStatus | string | null;
  provisioningStatus?: ProvisioningStatus | string | null;
  paymentAmount?: number | string | null;
  paymentSubmittedAt?: string | null;
  reviewedAt?: string | null;
  lastError?: string | null;
  hasPaymentProof?: boolean | null;
}

/** 审核申请详情（列表字段 + 详情补充字段）。 */
export interface ReviewApplicationDetail extends ReviewApplication {
  paymentReference?: string | null;
  verifyOutcome?: string | null;
  verifiedAt?: string | null;
  rejectCategory?: string | null;
  rejectReason?: string | null;
  reviewNote?: string | null;
  reviewedBy?: string | null;
  tenantId?: string | null;
  billingAccountId?: string | null;
}

export interface ReviewApplicationListResult {
  items: ReviewApplication[];
  total?: number;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  cursor?: string | null;
}

export interface ReviewApplicationListParams {
  reviewStatus?: string;
  provisioningStatus?: string;
  search?: string;
  userId?: string;
  page?: number;
  pageSize?: number;
  cursor?: string;
}

export type ReviewAction = 'approve' | 'reject' | 'void';

export interface ReviewVerificationBody {
  action: ReviewAction;
  /** reject 必填。 */
  rejectCategory?: 'payment_proof' | 'enterprise_info';
  rejectReason?: string;
  note?: string;
}

export const enterpriseAccountApi = {
  list: (params: EnterpriseAccountListParams = {}): Promise<EnterpriseAccountListResult> =>
    api.get('/admin/enterprise-accounts', { params }).then((r) => r.data.data),

  getDetail: (id: string): Promise<EnterpriseAccountDetail> =>
    api.get(`/admin/enterprise-accounts/${id}`).then((r) => r.data.data),

  getCredit: (id: string): Promise<EnterpriseAccountCredit> =>
    api.get(`/admin/enterprise-accounts/${id}/credit`).then((r) => r.data.data),

  updateCredit: (id: string, body: UpdateEnterpriseCreditBody): Promise<EnterpriseAccountCredit> =>
    api.put(`/admin/enterprise-accounts/${id}/credit`, body).then((r) => r.data.data),

  listCreditEvents: (id: string): Promise<EnterpriseAccountCreditEventsResult> =>
    api.get(`/admin/enterprise-accounts/${id}/credit-events`).then((r) => r.data.data),

  recharge: (id: string, body: RechargeEnterpriseAccountBody): Promise<unknown> =>
    api.post(`/admin/enterprise-accounts/${id}/recharge`, body).then((r) => r.data.data),

  adjustBalance: (id: string, body: EnterpriseBalanceAdjustmentBody): Promise<unknown> =>
    api.post(`/admin/enterprise-accounts/${id}/balance-adjustment`, body).then((r) => r.data.data),

  listModelDiscounts: (
    id: string,
    productId: string,
  ): Promise<EnterpriseModelDiscountMatrix> =>
    api
      .get(`/admin/enterprise-accounts/${id}/model-discounts`, { params: { productId } })
      .then((r) => r.data.data),

  updateModelDiscounts: (
    id: string,
    body: UpdateEnterpriseModelDiscountsBody,
  ): Promise<EnterpriseModelDiscountMatrix> =>
    api
      .put(`/admin/enterprise-accounts/${id}/model-discounts`, body)
      .then((r) => r.data.data),

  /** 创建/补救：后端先查 user 企业实名，拒绝非企业实名后再建。 */
  create: (body: CreateEnterpriseAccountBody): Promise<EnterpriseAccount> =>
    api.post('/admin/enterprise-accounts', body).then((r) => r.data.data),

  /** 挂载 tenant 到企业账户。 */
  attachTenant: (id: string, tenantId: string): Promise<unknown> =>
    api
      .post(`/admin/enterprise-accounts/${id}/attach-tenant`, { tenantId })
      .then((r) => r.data.data),

  /** 解绑 tenant（高危，需 admin.system.manage + reason）。 */
  detachTenant: (id: string, tenantId: string, reason: string): Promise<unknown> =>
    api
      .post(`/admin/enterprise-accounts/${id}/detach-tenant`, { tenantId, reason })
      .then((r) => r.data.data),

  /** 开通失败重试：走独立 provisioning/ 段（避免与 /:id 歧义），带 userId 归属。 */
  retryProvisioning: (verificationId: string, userId: string): Promise<unknown> =>
    api
      .post(`/admin/enterprise-accounts/provisioning/${verificationId}/retry`, { userId })
      .then((r) => r.data.data),

  /** 营业执照短时效 signed URL（admin 不存 object key；权限已收紧到 review 级）。 */
  getLicenseUrl: (verificationId: string): Promise<LicenseUrlResult> =>
    api
      .get(`/admin/enterprise-accounts/${verificationId}/license-url`)
      .then((r) => r.data.data),

  /** 营业执照文件代理 URL（同域 admin-api 返回二进制，不直连对象存储）。 */
  licenseFileUrl: (verificationId: string): string =>
    `/api/admin/enterprise-accounts/${encodeURIComponent(verificationId)}/license-file`,

  /**
   * 审核队列列表：数据源为 user application list（approve 前无 billing account，§4.2/§8.0c）。
   * 静态路由，后端声明在 /:id 之前。
   */
  listReviewApplications: (
    params: ReviewApplicationListParams = {},
  ): Promise<ReviewApplicationListResult> =>
    api
      .get('/admin/enterprise-accounts/review-applications', { params })
      .then((r) => r.data.data),

  /** 审核申请详情。 */
  getReviewApplication: (id: string): Promise<ReviewApplicationDetail> =>
    api
      .get(`/admin/enterprise-accounts/review-applications/${id}`)
      .then((r) => r.data.data),

  /** 审核动作：approve / reject / void（operator 身份由后端从上下文注入）。 */
  review: (verificationId: string, body: ReviewVerificationBody): Promise<unknown> =>
    api
      .post(`/admin/enterprise-accounts/${verificationId}/review`, body)
      .then((r) => r.data.data),

  /**
   * 回收危害候选集（只读）。
   *
   * 页面只用它的一个字段：`stalledFanout` —— 已耗尽重试停在 ALERTED 的回收作业。
   * 那些作业的唯一出口是**再点一次「继续作废」**（会原子复位），而运营看不到 fanout 表，
   * 所以必须在界面上显式提示，不能靠口口相传。
   */
  listRecoveryHazards: (params: { cursor?: string; limit?: number } = {}): Promise<{
    items: Array<{
      accountId: string;
      verificationId: string | null;
      stalledFanout: Array<{ kind: string; count: number }>;
    }>;
    nextCursor: string | null;
  }> =>
    api.get('/admin/enterprise-accounts/recovery-hazards', { params }).then((r) => r.data.data),

  /** 转账凭证短时效 signed URL（review 级权限）。 */
  getPaymentProofUrl: (verificationId: string): Promise<LicenseUrlResult> =>
    api
      .get(`/admin/enterprise-accounts/${verificationId}/payment-proof-url`)
      .then((r) => r.data.data),
};
