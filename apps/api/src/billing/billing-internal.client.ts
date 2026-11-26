import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DeploymentConfigSnapshot } from '@ruidong/shared';
import { Readable } from 'stream';
import { signedAdminContextHeaders } from '../common/internal-auth/signed-admin-context';
import { getAdminRequestContext } from '../common/request/admin-context';

type QueryValue = string | number | boolean | undefined | null;
type QueryParams = Record<string, QueryValue>;
const DEFAULT_BILLING_INTERNAL_API_VERSION = '2026-05-16';
const BILLING_INTERNAL_API_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_FINANCE_REPORT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_FINANCE_EXPORT_DOWNLOAD_TIMEOUT_MS = 30 * 60_000;

/**
 * 资金类端点（企业充值 / 余额调整）的单独超时预算。
 *
 * 这些请求会在 billing 侧触发欠款逐笔核销，耗时随该账户的未结清行数线性增长。
 * 国内 prod 实测:47,653 行约 10 秒、132,325 行约 28 秒(批量写入 + keyset 游标之后)。
 * 全局的 10 秒会在事务仍在进行时就断开连接 —— 而 Fastify 的超时是 cooperative 的,
 * billing 侧会继续跑完并提交,于是操作者看到 502、实际已生效。
 *
 * 取 45 秒:盖住实测区间,同时**仍低于 admin-web nginx 的默认 proxy_read_timeout(60 秒)**,
 * 因此不需要改 nginx configmap、不需要 rollout restart、也不涉及入口层。
 * 快查询继续用 10 秒,不会因为失败而长时间占住连接。
 */
const DEFAULT_FUNDING_REQUEST_TIMEOUT_MS = 45_000;
/** approve / PSA retry wait on billing's outbound token + apply calls (15s each, with one 401 retry). */
const PSA_INVOICE_PROXY_TIMEOUT_MS = 60_000;

/** 单次内部请求的覆盖项。目前只有超时;默认沿用全局 requestTimeoutMs。 */
type InternalRequestOptions = { timeoutMs?: number };

export type BillingUserSnapshot = {
  id?: string;
  email?: string | null;
  phone?: string | null;
  nickname?: string | null;
  isActive?: boolean | null;
};

export type BalanceAdjustmentReasonCode =
  | 'DISCOUNT_CORRECTION'
  | 'BILLING_CORRECTION'
  | 'SERVICE_COMPENSATION'
  | 'OTHER';

export type ClassifiedBalanceAdjustmentRequest = {
  amountCents: number;
  reasonCode: BalanceAdjustmentReasonCode;
  description: string;
  performedBy?: string | null;
  idempotencyKey: string;
  user?: BillingUserSnapshot;
  tenantId?: string | null;
  billingAccountId?: string | null;
  productId?: string | null;
};

export type EnterpriseBalanceAdjustmentRequest = Omit<
  ClassifiedBalanceAdjustmentRequest,
  'user' | 'tenantId' | 'billingAccountId' | 'productId'
>;

export type ClassifiedBalanceAdjustmentResult = {
  direction: 'CREDIT' | 'DEBIT';
  reasonCode: BalanceAdjustmentReasonCode;
  amountCents: number;
  balanceAfterCents: number;
  transaction: { id: string } & Record<string, unknown>;
};

export type IssuePaygVoucherRequest = {
  userId: string;
  productId?: string | null;
  amountCents: number;
  reason: string;
  expiresAt?: string | null;
  performedBy?: string | null;
  idempotencyKey?: string;
};

export type UsageBillingUnit = 'AUTO' | 'BALANCE' | 'CREDITS';

export type GatewayBillingEventActionRequest = {
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
};

export type GatewayBillingEventAbsorbRequest = GatewayBillingEventActionRequest & (
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

export type GatewayBillingEventSettlementRequest = GatewayBillingEventActionRequest & {
  evidenceId: string;
};

export type HistoricalPlatformLossLineRequest = {
  lineType: 'MISSING_ANCHOR_REQUEST' | 'PROVIDER_AGGREGATE';
  sourceRowRef: string;
  sourceEvidence: Record<string, unknown>;
  serviceDate: string;
  model: string;
  meter: string;
  platformUsage: string;
  providerUsage: string;
  valuationBasis: {
    version: string;
    rateUnit: 'TOKENS_PER_MILLION';
    pricingCurrency: string;
    customerRatePerMillion: string;
    providerCostRatePerMillion: string;
    pricingSourceRef: string;
    pricingDocumentSha256: string;
    pricingEvidenceHash: string;
    pricingEffectiveFrom: string;
    pricingEffectiveTo: string;
    pricingApprovedBy: string;
    pricingApprovedAt: string;
    pricingEvidence: Record<string, unknown>;
  };
  requestId?: string;
  upstreamRequestId?: string;
  providerAggregateRef?: string;
};

export type HistoricalPlatformLossPreviewRequest = {
  provider: string;
  providerAccountRef: string;
  region: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  sourceFileRef: string;
  sourceFileSha256: string;
  calculationMethod: 'TOKEN_RATE_PER_MILLION_V1';
  roundingPolicy: 'HALF_UP_12';
  exchangeRate?: string;
  exchangeRateSource?: string;
  exchangeRateSourceCurrency?: string;
  exchangeRateAsOf?: string;
  reason?: string;
  lines: HistoricalPlatformLossLineRequest[];
};

export type HistoricalPlatformLossCreateRequest = HistoricalPlatformLossPreviewRequest & {
  expectedFingerprint: string;
  idempotencyKey: string;
};

export type HistoricalPlatformLossApproveRequest = {
  expectedRevision: number;
  expectedFingerprint: string;
  reason: string;
  idempotencyKey: string;
};

export type UsageQuoteRequest = {
  userId?: string;
  email?: string;
  productId?: string;
  productSlug?: string;
  modelName: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  billingUnit?: UsageBillingUnit;
};

export type UsageDeductRequest = UsageQuoteRequest & {
  source: string;
  idempotencyKey: string;
  requestId?: string;
};

export type PaygModelPricingVersionRequest = {
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
};

export type PaygProductModelRequest = {
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
};

export type PaygProductModelUpdateRequest = Omit<Partial<PaygProductModelRequest>, 'productId' | 'modelNames' | 'modelName'>;

export type ProviderCostPolicyRequest = {
  productId?: string | null;
  providerCode: string;
  providerLineId?: string | null;
  modelName: string;
  priceMultiplier?: string | number | null;
  inputCostUsdPerM?: string | number | null;
  cachedInputCostUsdPerM?: string | number | null;
  cacheWriteCostUsdPerM?: string | number | null;
  outputCostUsdPerM?: string | number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: string | number | null;
  isActive?: boolean;
  description?: string | null;
};

export type ModelPricingUpsertRequest = {
  modelName: string;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  isActive?: boolean;
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
  releaseAt?: string | Date | null;
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
  priceTiers?: ModelPricingTierUpsertRequest[] | null;
  defaultThinkingMode?: string | null;
  defaultThinkingBudget?: number | null;
};

export type ModelPricingTierUpsertRequest = {
  tierKey: string;
  displayName?: string | null;
  minInputTokens?: number | null;
  maxInputTokensExclusive?: number | null;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPrice?: number | null;
  cacheWritePrice?: number | null;
  /** OFF_PEAK 时段档的高峰窗口 [{days,start,end}]（其余时间=空闲） */
  bandSchedule?: Array<{ days: number[]; start: string; end: string }> | null;
  currency?: string | null;
  rawCondition?: string | null;
  source?: string | null;
  priority?: number | null;
  isActive?: boolean;
};

export type RechargeTierWriteRequest = {
  productId?: string;
  amountCents?: number;
  bonusType?: 'FIXED' | 'PERCENT';
  bonusValue?: number;
  badge?: string | null;
  sortOrder?: number;
  isActive?: boolean;
  startAt?: string | Date | null;
  endAt?: string | Date | null;
};

export type RechargeTierResult = {
  id: string;
  productId: string;
  amountCents: number;
  bonusType: 'FIXED' | 'PERCENT';
  bonusValue: number;
  badge: string | null;
  sortOrder: number;
  isActive: boolean;
  startAt: string | Date | null;
  endAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  overlapWarning?: string;
};

export type RechargeTierListResult = {
  items: RechargeTierResult[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type RechargeTierProductListResult = {
  items: Array<{
    id: string;
    name: string;
    slug: string;
    billingMode: string;
    isActive: boolean;
  }>;
};

export type FinanceReportDetailParams = {
  month?: string;
  tab?: string;
  billingMode?: string;
  pageSize?: number;
  cursor?: string;
  filterField?: string;
  filterValue?: string;
};

export type FinanceReportExportJobRequest = {
  month?: string;
  tab?: string;
  billingMode?: string;
  requestedByAdminId?: string | null;
};

export type ProductRouteAssignmentFilters = {
  subjectType?: string;
  subjectId?: string;
  targetType?: string;
  isActive?: boolean;
};

export type CodingPlanProviderEntitlementFilters = {
  status?: string;
  providerLineId?: string;
  providerLineCode?: string;
  userId?: string;
  tenantId?: string;
  orderId?: string;
  take?: number;
};

export type CodingPlanResaleRouteFilters = {
  planId?: string;
  providerLineId?: string;
};

export type UploadedInvoiceFileRequest = {
  filename: string;
  contentType?: string | null;
  base64: string;
};

export type IssueUploadedInvoiceRequest = {
  invoiceNumber: string;
  issuingEntity: string;
  issueDate: string;
  taxAmountCents?: number | null;
  itemId?: string | null;
  pdfFile: UploadedInvoiceFileRequest;
  ofdFile?: UploadedInvoiceFileRequest | null;
};

export type RepairInternationalRechargeInvoicesRequest = {
  applicationIds: string[];
  dryRun?: boolean;
};

export type EnterpriseAccountListFilters = {
  page?: number;
  pageSize?: number;
  status?: string;
  ownerUserId?: string;
  uscc?: string;
  search?: string;
};

export type CreateEnterpriseAccountRequest = {
  userId: string;
  tenantId?: string | null;
  verificationId: string;
  enterpriseName: string;
  uscc: string;
  verifiedAt?: string | null;
  /** 幂等键，透传 billing（对齐 e1ff63f 幂等键传播约定）；默认 `ent-acct:<verificationId>`。 */
  idempotencyKey?: string;
};

export type UpdateEnterpriseAccountRequest = {
  enterpriseName?: string | null;
  uscc?: string | null;
  verificationId?: string | null;
  verifiedAt?: string | null;
  status?: string | null;
  reason?: string | null;
};

export type UpsertEnterpriseAccountOwnerMemberRequest = {
  userId: string;
  role?: string;
  status?: string;
  idempotencyKey?: string;
};

export type AttachEnterpriseTenantRequest = {
  tenantId: string;
  idempotencyKey?: string;
};

export type DetachEnterpriseTenantRequest = {
  tenantId: string;
  reason: string;
  idempotencyKey?: string;
};

export type UpdateEnterpriseCreditRequest = {
  limitCents?: number | null;
  status?: string | null;
  termsDays?: number | null;
  effectiveAt?: string | null;
  expiresAt?: string | null;
  updatedBy?: string | null;
  reason?: string | null;
  note?: string | null;
  idempotencyKey?: string;
};

export type RechargeEnterpriseAccountRequest = {
  amountCents: number;
  productId: string;
  description: string;
  idempotencyKey: string;
};

type BalanceAdjustmentResult = {
  id: string;
} & Record<string, unknown>;

type PlanWriteResult = {
  message: string;
  data: unknown;
};

type BundleDeleteResult = {
  deleted: boolean;
  disabled: boolean;
};

type GrantCreditsResult = {
  userId: string;
  subscriptionId: string;
  amount: number;
  reason: string;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveBillingInternalApiVersion(value: string | undefined): string {
  const version = value?.trim() || DEFAULT_BILLING_INTERNAL_API_VERSION;
  if (!BILLING_INTERNAL_API_VERSION_PATTERN.test(version)) {
    throw new Error('BILLING_INTERNAL_API_VERSION must use YYYY-MM-DD format');
  }
  return version;
}

function resolveInternalRequestTimeoutMs(value: string | undefined): number {
  const timeout = Number.parseInt(value || '', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS;
}

function resolveFundingRequestTimeoutMs(value: string | undefined): number {
  const timeout = Number.parseInt(value || '', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_FUNDING_REQUEST_TIMEOUT_MS;
}

function resolveFinanceReportRequestTimeoutMs(value: string | undefined): number {
  const timeout = Number.parseInt(value || '', 10);
  return Number.isFinite(timeout) && timeout > 0
    ? timeout
    : DEFAULT_FINANCE_REPORT_REQUEST_TIMEOUT_MS;
}

function parseDownloadFilename(disposition: string | null): string | null {
  if (!disposition) return null;
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded.trim());
    } catch {
      return encoded.trim();
    }
  }
  return disposition.match(/filename="?([^";]+)"?/iu)?.[1]?.trim() ?? null;
}

@Injectable()
export class BillingInternalClient {
  private readonly logger = new Logger(BillingInternalClient.name);
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly adminContextSecret: string | undefined;
  private readonly apiVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly financeReportRequestTimeoutMs: number;
  private readonly fundingRequestTimeoutMs: number;
  private readonly financeExportDownloadTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = trimTrailingSlash(
      this.config.get<string>('BILLING_SERVICE_URL') ||
        'http://localhost:3010/api/internal/billing/admin',
    );
    this.token = this.config.get<string>('ADMIN_TO_BILLING_TOKEN')?.trim();
    this.adminContextSecret = this.config.get<string>('ADMIN_TO_BILLING_CONTEXT_SECRET')?.trim();
    this.apiVersion = resolveBillingInternalApiVersion(
      this.config.get<string>('BILLING_INTERNAL_API_VERSION'),
    );
    this.requestTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('INTERNAL_SERVICE_TIMEOUT_MS'),
    );
    this.financeReportRequestTimeoutMs = resolveFinanceReportRequestTimeoutMs(
      this.config.get<string>('FINANCE_REPORT_REQUEST_TIMEOUT_MS'),
    );
    this.fundingRequestTimeoutMs = resolveFundingRequestTimeoutMs(
      this.config.get<string>('INTERNAL_SERVICE_FUNDING_TIMEOUT_MS'),
    );
    this.financeExportDownloadTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('FINANCE_EXPORT_DOWNLOAD_TIMEOUT_MS')
        || String(DEFAULT_FINANCE_EXPORT_DOWNLOAD_TIMEOUT_MS),
    );
  }

  listOrders(page: number, pageSize: number, filters?: {
    status?: string;
    userId?: string;
    orderType?: string;
    channel?: string;
    search?: string;
  }) {
    return this.request('GET', '/orders', { page, pageSize, ...filters });
  }

  getOrderDetail(id: string) {
    return this.request('GET', `/orders/${encodeURIComponent(id)}`);
  }

  adminCancelOrder(orderId: string, adminId: string, reason?: string) {
    return this.request('POST', `/orders/${encodeURIComponent(orderId)}/cancel`, undefined, {
      adminId,
      reason,
    });
  }

  retryFailedOrder(orderId: string, adminId: string) {
    return this.request('POST', `/orders/${encodeURIComponent(orderId)}/retry`, undefined, {
      adminId,
    });
  }

  refundOrder(orderId: string, reason: string) {
    return this.request('POST', `/orders/${encodeURIComponent(orderId)}/refund`, undefined, {
      reason,
    });
  }

  getStats() {
    return this.request('GET', '/stats');
  }

  getRevenue(productId?: string) {
    return this.request('GET', '/revenue', { productId });
  }

  getRevenueOverview(days: number, productId?: string) {
    return this.request('GET', '/revenue/overview', { days, productId });
  }

  getFinanceReports(month?: string) {
    return this.request('GET', '/finance-reports', { month });
  }

  getFinanceDashboard(month?: string) {
    return this.request('GET', '/finance-reports/dashboard', { month });
  }

  getFinanceReportOverview(month?: string, billingMode?: string, refresh?: boolean) {
    return this.request(
      'GET',
      '/finance-reports/overview',
      { month, billingMode, refresh: refresh || undefined },
      undefined,
      { timeoutMs: this.financeReportRequestTimeoutMs },
    );
  }

  getFinanceReportDetail(params: FinanceReportDetailParams) {
    return this.request(
      'GET',
      '/finance-reports/details',
      params,
      undefined,
      { timeoutMs: this.financeReportRequestTimeoutMs },
    );
  }

  createFinanceReportExportJob(body: FinanceReportExportJobRequest) {
    return this.request('POST', '/finance-reports/export-jobs', undefined, body);
  }

  listFinanceReportExportJobs(take?: number) {
    return this.request('GET', '/finance-reports/export-jobs', { take });
  }

  getFinanceReportExportJob(id: string) {
    return this.request('GET', `/finance-reports/export-jobs/${encodeURIComponent(id)}`);
  }

  downloadFinanceReportExportJob(id: string) {
    return this.requestStream(
      'GET',
      `/finance-reports/export-jobs/${encodeURIComponent(id)}/download`,
      undefined,
      { timeoutMs: this.financeExportDownloadTimeoutMs },
    );
  }

  listTransactions(page: number, pageSize: number, filters?: { userId?: string }) {
    return this.request('GET', '/transactions', { page, pageSize, ...filters });
  }

  listSubscriptions(params: {
    page: number;
    pageSize: number;
    status?: string;
    expiringDays?: number;
    productId?: string;
    userId?: string;
  }) {
    return this.request('GET', '/subscriptions', params);
  }

  grantSubscriptionCredits(subscriptionId: string, body: {
    amount: number;
    reason: string;
    idempotencyKey?: string;
  }): Promise<GrantCreditsResult> {
    return this.request<GrantCreditsResult>(
      'POST',
      `/subscriptions/${encodeURIComponent(subscriptionId)}/grant-credits`,
      undefined,
      body,
    );
  }

  listPaygAccounts(params: {
    page: number;
    pageSize: number;
    search?: string;
    email?: string;
    status?: string;
    productId?: string;
  }) {
    return this.request('GET', '/payg-accounts', params);
  }

  issuePaygVoucher(tenantId: string, body: IssuePaygVoucherRequest) {
    return this.request(
      'POST',
      `/payg-accounts/${encodeURIComponent(tenantId)}/issue-voucher`,
      undefined,
      body,
    );
  }

  listPlans() {
    return this.request('GET', '/plans');
  }

  listCodingPlanProviderEntitlements(filters?: CodingPlanProviderEntitlementFilters) {
    return this.request('GET', '/coding-plan/provider-entitlements', filters);
  }

  retryCodingPlanProviderEntitlement(id: string) {
    return this.request(
      'POST',
      `/coding-plan/provider-entitlements/${encodeURIComponent(id)}/retry`,
    );
  }

  listCodingPlanProviderLines() {
    return this.request('GET', '/coding-plan/provider-lines');
  }

  createCodingPlanProviderLine(body: Record<string, unknown>) {
    return this.request('POST', '/coding-plan/provider-lines', undefined, body);
  }

  updateCodingPlanProviderLine(id: string, body: Record<string, unknown>) {
    return this.request(
      'PUT',
      `/coding-plan/provider-lines/${encodeURIComponent(id)}`,
      undefined,
      body,
    );
  }

  deleteCodingPlanProviderLine(id: string) {
    return this.request(
      'DELETE',
      `/coding-plan/provider-lines/${encodeURIComponent(id)}`,
    );
  }

  testCodingPlanProviderLine(id: string) {
    return this.request(
      'POST',
      `/coding-plan/provider-lines/${encodeURIComponent(id)}/test`,
    );
  }

  syncCodingPlanProviderProducts(id: string) {
    return this.request(
      'POST',
      `/coding-plan/provider-lines/${encodeURIComponent(id)}/sync-products`,
    );
  }

  listCodingPlanProviderProducts(providerLineId?: string | null) {
    return this.request('GET', '/coding-plan/provider-products', {
      ...(providerLineId ? { providerLineId } : {}),
    });
  }

  listCodingPlanResaleRoutes(filters?: CodingPlanResaleRouteFilters) {
    return this.request('GET', '/coding-plan/resale-routes', filters);
  }

  createCodingPlanResalePlan(body: Record<string, unknown>) {
    return this.request('POST', '/coding-plan/resale-plans', undefined, body);
  }

  updateCodingPlanResalePlan(id: string, body: Record<string, unknown>) {
    return this.request(
      'PUT',
      `/coding-plan/resale-plans/${encodeURIComponent(id)}`,
      undefined,
      body,
    );
  }

  syncDeploymentConfig(snapshot: DeploymentConfigSnapshot) {
    return this.request('PUT', '/deployment-config', undefined, snapshot);
  }

  syncStorageConfig(storageConfig: Record<string, unknown>) {
    return this.request('PUT', '/storage-config', undefined, storageConfig);
  }

  // 滚动配额 gate 运行时开关（CodingPlan 自营套餐配额执行）。透传 billing 的 {effectiveEnabled,envForced,adminEnabled}。
  getRollingQuotaGate() {
    return this.request('GET', '/rolling-quota-gate');
  }

  setRollingQuotaGate(enabled: boolean | null) {
    return this.request('PUT', '/rolling-quota-gate', undefined, { enabled });
  }

// R3b 月度补发 运行时开关（自营套餐按月 resetQuota 补发/清欠）。
  getCodingPlanMonthlyRefresh() {
    return this.request('GET', '/coding-plan-monthly-refresh');
  }

  setCodingPlanMonthlyRefresh(enabled: boolean | null) {
    return this.request('PUT', '/coding-plan-monthly-refresh', undefined, { enabled });
  }

  debugResetMonthlyRefresh(entitlementId: string, tag?: string) {
    return this.request('POST', '/coding-plan-monthly-refresh/debug-reset', undefined, { entitlementId, tag });
  }

  debugGetBalance(entitlementId: string) {
    return this.request('GET', '/coding-plan-monthly-refresh/debug-balance', { entitlementId });
  }

  debugSetEntitlementDates(entitlementId: string, startedAt?: string, expiresAt?: string) {
    return this.request('POST', '/coding-plan-monthly-refresh/debug-set-dates', undefined, { entitlementId, startedAt, expiresAt });
  }

  // R6 自营积分终态负额结算 运行时开关（billing 侧带硬门禁：月度补发未生效时拒绝开启）。
  getSelfopNegativeDeduct() {
    return this.request('GET', '/selfop-negative-deduct');
  }

  setSelfopNegativeDeduct(enabled: boolean | null) {
    return this.request('PUT', '/selfop-negative-deduct', undefined, { enabled });
  }
  getPlanById(id: string) {
    return this.request('GET', `/plans/${encodeURIComponent(id)}`);
  }

  createOrUpdatePlan(body: Record<string, unknown>): Promise<PlanWriteResult> {
    return this.request<PlanWriteResult>('POST', '/plans', undefined, body);
  }

  updatePlan(id: string, body: Record<string, unknown>) {
    return this.request('POST', `/plans/${encodeURIComponent(id)}`, undefined, body);
  }

  // finding #13：套餐上架/下架窄写激活。billing 侧对自营 platform_model_package 做原子绑定校验 +
  // per-plan 锁，不满足拒绝翻 active（返回 4xx）。只改 isActive，不整包 upsert。
  setPlanActive(id: string, isActive: boolean): Promise<PlanWriteResult> {
    return this.request<PlanWriteResult>('PATCH', `/plans/${encodeURIComponent(id)}/active`, undefined, { isActive });
  }

  deletePlan(id: string) {
    return this.request('DELETE', `/plans/${encodeURIComponent(id)}`);
  }

  listPlanPrices(planId: string) {
    return this.request('GET', `/plans/${encodeURIComponent(planId)}/prices`);
  }

  upsertPlanPrice(planId: string, body: {
    currency: string;
    monthlyPrice: number;
    quarterlyPrice: number;
    yearlyPrice: number;
    isActive?: boolean;
  }) {
    return this.request(
      'PUT',
      `/plans/${encodeURIComponent(planId)}/prices/${encodeURIComponent(body.currency)}`,
      undefined,
      body,
    );
  }

  deletePlanPrice(planId: string, currency: string) {
    return this.request(
      'DELETE',
      `/plans/${encodeURIComponent(planId)}/prices/${encodeURIComponent(currency)}`,
    );
  }

  listBundleSkus(filters?: { isActive?: boolean }) {
    return this.request('GET', '/bundles', filters);
  }

  getBundleSkuById(id: string) {
    return this.request('GET', `/bundles/${encodeURIComponent(id)}`);
  }

  createBundleSku(body: Record<string, unknown>) {
    return this.request('POST', '/bundles', undefined, body);
  }

  updateBundleSku(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/bundles/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteBundleSku(id: string): Promise<BundleDeleteResult> {
    return this.request<BundleDeleteResult>('DELETE', `/bundles/${encodeURIComponent(id)}`);
  }

  listCampaigns(filters?: {
    planId?: string;
    productId?: string;
    isActive?: boolean;
  }) {
    return this.request('GET', '/campaigns', filters);
  }

  getCampaign(id: string) {
    return this.request('GET', `/campaigns/${encodeURIComponent(id)}`);
  }

  getCampaignStats(id: string) {
    return this.request('GET', `/campaigns/${encodeURIComponent(id)}/stats`);
  }

  createCampaign(body: Record<string, unknown>) {
    return this.request('POST', '/campaigns', undefined, body);
  }

  updateCampaign(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/campaigns/${encodeURIComponent(id)}`, undefined, body);
  }

  disableCampaign(id: string) {
    return this.request('DELETE', `/campaigns/${encodeURIComponent(id)}`);
  }

  listDiscountCodes(filters?: { isActive?: boolean }) {
    return this.request('GET', '/discount-codes', filters);
  }

  getDiscountCode(id: string) {
    return this.request('GET', `/discount-codes/${encodeURIComponent(id)}`);
  }

  getDiscountCodeStats(id: string) {
    return this.request('GET', `/discount-codes/${encodeURIComponent(id)}/stats`);
  }

  createDiscountCode(body: Record<string, unknown>) {
    return this.request('POST', '/discount-codes', undefined, body);
  }

  updateDiscountCode(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/discount-codes/${encodeURIComponent(id)}`, undefined, body);
  }

  disableDiscountCode(id: string) {
    return this.request('DELETE', `/discount-codes/${encodeURIComponent(id)}`);
  }

  listReferralPrograms() {
    return this.request('GET', '/referrals/programs');
  }

  createReferralProgram(body: Record<string, unknown>) {
    return this.request('POST', '/referrals/programs', undefined, body);
  }

  updateReferralProgram(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/referrals/programs/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteReferralProgram(id: string) {
    return this.request('DELETE', `/referrals/programs/${encodeURIComponent(id)}`);
  }

  generateReferralCode(programId: string, body: { inviterUser: string }) {
    return this.request(
      'POST',
      `/referrals/programs/${encodeURIComponent(programId)}/codes`,
      undefined,
      body,
    );
  }

  listReferralRedemptions(params?: {
    programId?: string;
    inviterUserId?: string;
    triggered?: boolean;
    page?: number;
    pageSize?: number;
  }) {
    return this.request('GET', '/referrals/redemptions', params);
  }

  referralLeaderboard(params?: { programId?: string; days?: number }) {
    return this.request('GET', '/referrals/leaderboard', params);
  }

  referralSummary(params?: { programId?: string }) {
    return this.request('GET', '/referrals/summary', params);
  }

  referralClickSources(params: { programId: string }) {
    return this.request('GET', '/referrals/click-sources', params);
  }

  referralCodes(params: { programId: string }) {
    return this.request('GET', '/referrals/codes', params);
  }

  listQuotaTemplates(params: {
    page: number;
    pageSize: number;
    search?: string;
    isActive?: boolean;
  }) {
    return this.request('GET', '/quota-templates', params);
  }

  getQuotaTemplate(id: string) {
    return this.request('GET', `/quota-templates/${encodeURIComponent(id)}`);
  }

  createQuotaTemplate(body: Record<string, unknown>) {
    return this.request('POST', '/quota-templates', undefined, body);
  }

  listPlanQuotaRules(planId: string) {
    return this.request('GET', `/quota-templates/plan/${encodeURIComponent(planId)}/rules`);
  }

  replacePlanQuotaRules(planId: string, body: { templateIds: string[] }) {
    return this.request(
      'PUT',
      `/quota-templates/plan/${encodeURIComponent(planId)}/rules`,
      undefined,
      body,
    );
  }

  updateQuotaTemplate(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/quota-templates/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteQuotaTemplate(id: string) {
    return this.request('DELETE', `/quota-templates/${encodeURIComponent(id)}`);
  }

  cloneQuotaTemplate(id: string) {
    return this.request('POST', `/quota-templates/${encodeURIComponent(id)}/clone`);
  }

  getQuotaTemplateReferences(id: string) {
    return this.request('GET', `/quota-templates/${encodeURIComponent(id)}/references`);
  }

  listGrantRules(params: {
    page: number;
    pageSize: number;
    search?: string;
    triggerType?: string;
    isActive?: boolean;
    segmentId?: string;
  }) {
    return this.request('GET', '/grant-rules', params);
  }

  getGrantRule(id: string) {
    return this.request('GET', `/grant-rules/${encodeURIComponent(id)}`);
  }

  createGrantRule(body: Record<string, unknown>) {
    return this.request('POST', '/grant-rules', undefined, body);
  }

  updateGrantRule(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/grant-rules/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteGrantRule(id: string) {
    return this.request('DELETE', `/grant-rules/${encodeURIComponent(id)}`);
  }

  previewGrantRule(id: string) {
    return this.request('POST', `/grant-rules/${encodeURIComponent(id)}/preview`);
  }

  triggerGrantRule(id: string) {
    return this.request('POST', `/grant-rules/${encodeURIComponent(id)}/manual-trigger`);
  }

  listGrantRedemptions(id: string, page: number, pageSize: number) {
    return this.request('GET', `/grant-rules/${encodeURIComponent(id)}/redemptions`, {
      page,
      pageSize,
    });
  }

  getCreditPolicyGlobal(productId: string) {
    return this.request('GET', '/credit-policy/global', { productId });
  }

  upsertCreditPolicyGlobal(body: Record<string, unknown>) {
    return this.request('PUT', '/credit-policy/global', undefined, body);
  }

  listCreditPolicySegments(productId: string) {
    return this.request('GET', '/credit-policy/segments', { productId });
  }

  upsertCreditPolicySegment(body: Record<string, unknown>) {
    return this.request('POST', '/credit-policy/segments', undefined, body);
  }

  listCreditPolicyOverdueUsers(params: {
    productId?: string;
    page: number;
    pageSize: number;
  }) {
    return this.request('GET', '/credit-policy/overdue-users', params);
  }

  // 用户分群:数据与逻辑都在 billing,admin-api 经此 internal 入口转发。
  listUserSegments(params: {
    page: number;
    pageSize: number;
    search?: string;
    ruleType?: string;
    isActive?: boolean;
  }) {
    return this.request('GET', '/user-segments', params);
  }

  previewUserSegment(ruleExpr: string) {
    return this.request('POST', '/user-segments/preview', undefined, { ruleExpr });
  }

  createUserSegment(body: Record<string, unknown>) {
    return this.request('POST', '/user-segments', undefined, body);
  }

  getUserSegment(id: string) {
    return this.request('GET', `/user-segments/${encodeURIComponent(id)}`);
  }

  updateUserSegment(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/user-segments/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteUserSegment(id: string) {
    return this.request('DELETE', `/user-segments/${encodeURIComponent(id)}`);
  }

  refreshUserSegment(id: string) {
    return this.request('POST', `/user-segments/${encodeURIComponent(id)}/refresh`);
  }

  listUserSegmentMembers(id: string, page: number, pageSize: number) {
    return this.request('GET', `/user-segments/${encodeURIComponent(id)}/members`, { page, pageSize });
  }

  addUserSegmentMembers(id: string, userIds: string[]) {
    return this.request('POST', `/user-segments/${encodeURIComponent(id)}/members`, undefined, {
      userIds,
    });
  }

  removeUserSegmentMember(id: string, userId: string) {
    return this.request(
      'DELETE',
      `/user-segments/${encodeURIComponent(id)}/members/${encodeURIComponent(userId)}`,
    );
  }

  getUserSegmentReferences(id: string) {
    return this.request('GET', `/user-segments/${encodeURIComponent(id)}/references`);
  }

  getOverallFunnel(params: { days: number; segmentId?: string }) {
    return this.request('GET', '/funnel', params);
  }

  getSubscriptionFunnel(days: number) {
    return this.request('GET', '/funnel/subscription', { days });
  }

  getPaygFunnel(days: number) {
    return this.request('GET', '/funnel/payg', { days });
  }

  listProducts() {
    return this.request('GET', '/products');
  }

  createProduct(body: Record<string, unknown>) {
    return this.request('POST', '/products', undefined, body);
  }

  updateProduct(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/products/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteProduct(id: string) {
    return this.request('DELETE', `/products/${encodeURIComponent(id)}`);
  }

  listRechargeTierProducts(): Promise<RechargeTierProductListResult> {
    return this.request<RechargeTierProductListResult>('GET', '/recharge-tiers/products');
  }

  listRechargeTiers(params: {
    page: number;
    pageSize: number;
    productId?: string;
    isActive?: boolean;
  }): Promise<RechargeTierListResult> {
    return this.request<RechargeTierListResult>('GET', '/recharge-tiers', params);
  }

  getRechargeTier(id: string): Promise<RechargeTierResult> {
    return this.request<RechargeTierResult>(
      'GET',
      `/recharge-tiers/${encodeURIComponent(id)}`,
    );
  }

  createRechargeTier(body: RechargeTierWriteRequest): Promise<RechargeTierResult> {
    return this.request<RechargeTierResult>('POST', '/recharge-tiers', undefined, body);
  }

  updateRechargeTier(
    id: string,
    body: RechargeTierWriteRequest,
  ): Promise<RechargeTierResult> {
    return this.request<RechargeTierResult>(
      'PUT',
      `/recharge-tiers/${encodeURIComponent(id)}`,
      undefined,
      body,
    );
  }

  deleteRechargeTier(id: string): Promise<unknown> {
    return this.request('DELETE', `/recharge-tiers/${encodeURIComponent(id)}`);
  }

  cloneRechargeTier(id: string): Promise<RechargeTierResult> {
    return this.request<RechargeTierResult>(
      'POST',
      `/recharge-tiers/${encodeURIComponent(id)}/clone`,
    );
  }

  getProductIntegration(id: string) {
    return this.request('GET', `/products/${encodeURIComponent(id)}/integration`);
  }

  getProductRuntimePolicy(id: string) {
    return this.request('GET', `/products/${encodeURIComponent(id)}/runtime-policy`);
  }

  updateProductRuntimePolicy(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/products/${encodeURIComponent(id)}/runtime-policy`, undefined, body);
  }

  listProductChannels(productId: string) {
    return this.request('GET', `/products/${encodeURIComponent(productId)}/channels`);
  }

  createProductChannel(productId: string, body: Record<string, unknown>) {
    return this.request('POST', `/products/${encodeURIComponent(productId)}/channels`, undefined, body);
  }

  createDeliverySetting(productId: string, body: Record<string, unknown>) {
    return this.request('POST', `/products/${encodeURIComponent(productId)}/delivery-settings`, undefined, body);
  }

  updateProductChannel(productId: string, productChannelId: string, body: Record<string, unknown>) {
    return this.request(
      'PUT',
      `/products/${encodeURIComponent(productId)}/channels/${encodeURIComponent(productChannelId)}`,
      undefined,
      body,
    );
  }

  deleteProductChannel(productId: string, productChannelId: string) {
    return this.request(
      'DELETE',
      `/products/${encodeURIComponent(productId)}/channels/${encodeURIComponent(productChannelId)}`,
    );
  }

  listProductChannelGroups(productId: string) {
    return this.request('GET', `/products/${encodeURIComponent(productId)}/channel-groups`);
  }

  createProductChannelGroup(productId: string, body: Record<string, unknown>) {
    return this.request('POST', `/products/${encodeURIComponent(productId)}/channel-groups`, undefined, body);
  }

  updateProductChannelGroup(productId: string, groupId: string, body: Record<string, unknown>) {
    return this.request(
      'PUT',
      `/products/${encodeURIComponent(productId)}/channel-groups/${encodeURIComponent(groupId)}`,
      undefined,
      body,
    );
  }

  deleteProductChannelGroup(productId: string, groupId: string) {
    return this.request(
      'DELETE',
      `/products/${encodeURIComponent(productId)}/channel-groups/${encodeURIComponent(groupId)}`,
    );
  }

  addProductChannelGroupMember(productId: string, groupId: string, body: Record<string, unknown>) {
    return this.request(
      'POST',
      `/products/${encodeURIComponent(productId)}/channel-groups/${encodeURIComponent(groupId)}/members`,
      undefined,
      body,
    );
  }

  updateProductChannelGroupMember(
    productId: string,
    groupId: string,
    memberId: string,
    body: Record<string, unknown>,
  ) {
    return this.request(
      'PUT',
      `/products/${encodeURIComponent(productId)}/channel-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
      undefined,
      body,
    );
  }

  deleteProductChannelGroupMember(productId: string, groupId: string, memberId: string) {
    return this.request(
      'DELETE',
      `/products/${encodeURIComponent(productId)}/channel-groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberId)}`,
    );
  }

  listProductRouteAssignments(productId: string, filters: ProductRouteAssignmentFilters = {}) {
    return this.request('GET', `/products/${encodeURIComponent(productId)}/route-assignments`, {
      subjectType: filters.subjectType,
      subjectId: filters.subjectId,
      targetType: filters.targetType,
      isActive: filters.isActive,
    });
  }

  createProductRouteAssignment(productId: string, body: Record<string, unknown>) {
    return this.request('POST', `/products/${encodeURIComponent(productId)}/route-assignments`, undefined, body);
  }

  updateProductRouteAssignment(productId: string, assignmentId: string, body: Record<string, unknown>) {
    return this.request(
      'PUT',
      `/products/${encodeURIComponent(productId)}/route-assignments/${encodeURIComponent(assignmentId)}`,
      undefined,
      body,
    );
  }

  deleteProductRouteAssignment(productId: string, assignmentId: string) {
    return this.request(
      'DELETE',
      `/products/${encodeURIComponent(productId)}/route-assignments/${encodeURIComponent(assignmentId)}`,
    );
  }

  previewProductRouteGraph(productId: string) {
    return this.request('GET', `/products/${encodeURIComponent(productId)}/route-graph/preview`);
  }

  rebuildProductRouteGraph(productId: string) {
    return this.request('POST', `/products/${encodeURIComponent(productId)}/route-graph/rebuild`);
  }

  rotateProductIntegrationToken(id: string) {
    return this.request('POST', `/products/${encodeURIComponent(id)}/integration-token/rotate`);
  }

  rotateProductWebhookSecret(id: string) {
    return this.request('POST', `/products/${encodeURIComponent(id)}/webhook-secret/rotate`);
  }

  listBoosterPacks() {
    return this.request('GET', '/booster-packs');
  }

  createBoosterPack(body: Record<string, unknown>) {
    return this.request('POST', '/booster-packs', undefined, body);
  }

  updateBoosterPack(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/booster-packs/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteBoosterPack(id: string) {
    return this.request('DELETE', `/booster-packs/${encodeURIComponent(id)}`);
  }

  getUserBalance(userId: string) {
    return this.request('GET', `/users/${encodeURIComponent(userId)}/balance`);
  }

  getUserCreditOverview(userId: string) {
    return this.request('GET', `/users/${encodeURIComponent(userId)}/credit-overview`);
  }

  adjustBalance(userId: string, body: {
    amountCents: number;
    description: string;
    user?: BillingUserSnapshot;
    idempotencyKey?: string;
  }): Promise<BalanceAdjustmentResult> {
    return this.request<BalanceAdjustmentResult>(
      'POST',
      `/users/${encodeURIComponent(userId)}/adjust-balance`,
      undefined,
      body,
    );
  }

  applyClassifiedBalanceAdjustment(
    userId: string,
    body: ClassifiedBalanceAdjustmentRequest,
  ): Promise<ClassifiedBalanceAdjustmentResult> {
    return this.request<ClassifiedBalanceAdjustmentResult>(
      'POST',
      `/users/${encodeURIComponent(userId)}/billing-adjustment`,
      undefined,
      body,
    );
  }

  ensureDefaultFreePlan(
    userId: string,
    source: 'register_free' | 'auto_free' = 'register_free',
    user?: BillingUserSnapshot,
  ) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(userId)}/ensure-default-free-plan`,
      undefined,
      { source, user },
    );
  }

  listPaymentInstances() {
    return this.request('GET', '/payment-instances');
  }

  createPaymentInstance(body: Record<string, unknown>) {
    return this.request('POST', '/payment-instances', undefined, body);
  }

  updatePaymentInstance(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/payment-instances/${encodeURIComponent(id)}`, undefined, body);
  }

  deletePaymentInstance(id: string) {
    return this.request('DELETE', `/payment-instances/${encodeURIComponent(id)}`);
  }

  getChannelHealth() {
    return this.request('GET', '/channel-health');
  }

  listChannels(page: number, pageSize: number) {
    return this.request('GET', '/channels', { page, pageSize });
  }

  listProviderAccountIdentities() {
    return this.request('GET', '/provider-account-identities');
  }

  createProviderAccountIdentity(body: Record<string, unknown>) {
    return this.request('POST', '/provider-account-identities', undefined, body);
  }

  deactivateProviderAccountIdentity(id: string) {
    return this.request(
      'POST',
      `/provider-account-identities/${encodeURIComponent(id)}/deactivate`,
    );
  }

  getChannelProtocolTemplates() {
    return this.request('GET', '/channels/protocol-templates');
  }

  getChannel(id: string) {
    return this.request('GET', `/channels/${encodeURIComponent(id)}`);
  }

  createChannel(body: Record<string, unknown>) {
    return this.request('POST', '/channels', undefined, body);
  }

  previewChannelPublisherCompile(body: Record<string, unknown>) {
    return this.request('POST', '/channels/publisher-compile-preview', undefined, body);
  }

  updateChannel(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/channels/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteChannel(id: string) {
    return this.request('DELETE', `/channels/${encodeURIComponent(id)}`);
  }

  testChannel(id: string) {
    return this.request('POST', `/channels/${encodeURIComponent(id)}/test`);
  }

  resetChannelStats(id: string) {
    return this.request('POST', `/channels/${encodeURIComponent(id)}/reset-stats`);
  }

  discoverChannelModels(id: string) {
    return this.request('POST', `/channels/${encodeURIComponent(id)}/discover-models`);
  }

  listModelPricing() {
    return this.request('GET', '/model-pricing');
  }

  upsertModelPricing(body: ModelPricingUpsertRequest) {
    return this.request('POST', '/model-pricing', undefined, body);
  }

  syncModelPricingFromProxy() {
    return this.request('POST', '/model-pricing/sync');
  }

  deactivateOrphanModelPricing(confirm: boolean) {
    return this.request('POST', '/model-pricing/deactivate-orphans', undefined, { confirm });
  }

  publishAllActiveModelPricing() {
    return this.request('POST', '/model-pricing/publish-all-active');
  }

  deleteModelPricing(modelName: string) {
    return this.request('DELETE', `/model-pricing/${encodeURIComponent(modelName)}`);
  }

  listModelAccess() {
    return this.request('GET', '/model-access');
  }

  batchUpdateModelAccess(items: {
    tierId?: string;
    planId?: string;
    modelName?: string;
    model?: string;
    isActive?: boolean;
    isAllowed?: boolean;
    creditMultiplier?: number;
  }[]) {
    return this.request('POST', '/model-access/batch', undefined, { items });
  }

  listModelRoutePolicies() {
    return this.request('GET', '/model-route-policies');
  }

  batchUpdateModelRoutePolicies(items: {
    planId?: string;
    routeKey?: string;
    primaryModel?: string | null;
    fallbackModels?: string[];
    isActive?: boolean;
  }[]) {
    return this.request('POST', '/model-route-policies/batch', undefined, { items });
  }

  listPaygModelPricing(productId: string) {
    return this.request('GET', '/payg-model-pricing', { productId });
  }

  listPaygProductModelCandidates(productId: string) {
    return this.request('GET', '/payg-product-model-candidates', { productId });
  }

  addPaygProductModels(body: PaygProductModelRequest) {
    return this.request('POST', '/payg-product-models', undefined, body);
  }

  updatePaygProductModel(id: string, body: PaygProductModelUpdateRequest) {
    return this.request('PUT', `/payg-product-models/${encodeURIComponent(id)}`, undefined, body);
  }

  retirePaygProductModel(id: string) {
    return this.request('DELETE', `/payg-product-models/${encodeURIComponent(id)}`);
  }

  createPaygModelPricingVersion(body: PaygModelPricingVersionRequest) {
    return this.request('POST', '/payg-model-pricing', undefined, body);
  }

  deactivatePaygModelPricingPolicy(id: string) {
    return this.request('DELETE', `/payg-model-pricing/${encodeURIComponent(id)}`);
  }

  listProviderCostPolicies(query: QueryParams = {}) {
    return this.request('GET', '/provider-cost-policies', query);
  }

  createProviderCostPolicy(body: ProviderCostPolicyRequest) {
    return this.request('POST', '/provider-cost-policies', undefined, body);
  }

  deactivateProviderCostPolicy(id: string) {
    return this.request('DELETE', `/provider-cost-policies/${encodeURIComponent(id)}`);
  }

  deleteProviderCostPolicy(id: string) {
    return this.request('DELETE', `/provider-cost-policies/${encodeURIComponent(id)}/hard`);
  }

  backfillProviderCostTokenUsage(body: Record<string, unknown>) {
    return this.request('POST', '/provider-cost-policies/backfill-token-usage', undefined, body);
  }

  quoteUsage(body: UsageQuoteRequest) {
    return this.request('POST', '/usage/quote', undefined, body);
  }

  authorizeUsage(body: UsageQuoteRequest) {
    return this.request('POST', '/usage/authorize', undefined, body);
  }

  deductUsage(body: UsageDeductRequest) {
    return this.request('POST', '/usage/deduct', undefined, body);
  }

  listGatewayEvents(query?: {
    page?: number;
    pageSize?: number;
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
  }) {
    return this.request('GET', '/gateway-events', query);
  }

  getGatewayEvent(requestId: string) {
    return this.request('GET', `/gateway-events/${encodeURIComponent(requestId)}`);
  }

  retryGatewayEvent(requestId: string, body: GatewayBillingEventActionRequest) {
    return this.request(
      'POST',
      `/gateway-events/${encodeURIComponent(requestId)}/retry`,
      undefined,
      body,
    );
  }

  markGatewayEventManualReview(requestId: string, body: GatewayBillingEventActionRequest) {
    return this.request(
      'POST',
      `/gateway-events/${encodeURIComponent(requestId)}/manual-review`,
      undefined,
      body,
    );
  }

  reconcileAndSettleGatewayEvent(
    requestId: string,
    body: GatewayBillingEventSettlementRequest,
  ) {
    return this.request(
      'POST',
      `/gateway-events/${encodeURIComponent(requestId)}/reconcile-settle`,
      undefined,
      body,
    );
  }

  absorbGatewayEvent(requestId: string, body: GatewayBillingEventAbsorbRequest) {
    return this.request(
      'POST',
      `/gateway-events/${encodeURIComponent(requestId)}/absorb`,
      undefined,
      body,
    );
  }

  absorbGatewayEventDelta(
    requestId: string,
    body: GatewayBillingEventSettlementRequest,
  ) {
    return this.request(
      'POST',
      `/gateway-events/${encodeURIComponent(requestId)}/absorb-delta`,
      undefined,
      body,
    );
  }

  previewHistoricalPlatformLossBatch(body: HistoricalPlatformLossPreviewRequest) {
    return this.request(
      'POST',
      '/historical-platform-loss-batches/preview',
      undefined,
      body,
    );
  }

  createHistoricalPlatformLossBatch(body: HistoricalPlatformLossCreateRequest) {
    return this.request('POST', '/historical-platform-loss-batches', undefined, body);
  }

  listHistoricalPlatformLossBatches(query?: {
    page?: number;
    pageSize?: number;
    status?: string;
    provider?: string;
    providerAccountRef?: string;
    region?: string;
    periodStart?: string;
    periodEnd?: string;
  }) {
    return this.request('GET', '/historical-platform-loss-batches', query);
  }

  getHistoricalPlatformLossBatch(id: string) {
    return this.request('GET', `/historical-platform-loss-batches/${encodeURIComponent(id)}`);
  }

  approveAndPostHistoricalPlatformLossBatch(
    id: string,
    body: HistoricalPlatformLossApproveRequest,
  ) {
    return this.request(
      'POST',
      `/historical-platform-loss-batches/${encodeURIComponent(id)}/approve-and-post`,
      undefined,
      body,
    );
  }

  exportHistoricalPlatformLossBatch(id: string) {
    return this.request(
      'GET',
      `/historical-platform-loss-batches/${encodeURIComponent(id)}/export`,
    );
  }

  listPublisherSyncJobs(
    page: number,
    pageSize: number,
    filters?: {
      status?: string;
      namespace?: string;
      method?: string;
      path?: string;
      resourceType?: string;
      resourceId?: string;
      idempotencyKey?: string;
    },
  ) {
    return this.request('GET', '/publisher-sync-jobs', { page, pageSize, ...filters });
  }

  getPublisherSyncJob(id: string) {
    return this.request('GET', `/publisher-sync-jobs/${encodeURIComponent(id)}`);
  }

  retryPublisherSyncJob(id: string) {
    return this.request('POST', `/publisher-sync-jobs/${encodeURIComponent(id)}/retry`);
  }

  replayPublisherSync(scope: string) {
    return this.request('POST', '/publisher-sync-jobs/replay', undefined, { scope });
  }

  listUsagePolicies(productId?: string) {
    return this.request('GET', '/usage-policies', { productId });
  }

  createUsagePolicy(body: Record<string, unknown>) {
    return this.request('POST', '/usage-policies', undefined, body);
  }

  updateUsagePolicy(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/usage-policies/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteUsagePolicy(id: string) {
    return this.request('DELETE', `/usage-policies/${encodeURIComponent(id)}`);
  }

  listEnterpriseModelDiscounts(billingAccountId: string, productId: string) {
    return this.request('GET', '/enterprise-model-discounts', { billingAccountId, productId });
  }

  updateEnterpriseModelDiscounts(
    billingAccountId: string,
    body: Record<string, unknown>,
  ) {
    return this.request('PUT', '/enterprise-model-discounts', undefined, {
      ...body,
      billingAccountId,
    });
  }

  // ============================
  // 发票管理
  // ============================

  listInvoices(query: Record<string, string | number | undefined>) {
    return this.request('GET', '/invoices', query as QueryParams);
  }

  getInvoiceDetail(id: string) {
    return this.request('GET', `/invoices/${encodeURIComponent(id)}`);
  }

  getInvoiceDeployment(): Promise<{ deployment: 'domestic' | 'international' }> {
    return this.request<{ deployment: 'domestic' | 'international' }>('GET', '/invoices/deployment');
  }

  /** 批量下载发票 zip：返回原始二进制（不走 JSON 信封）。 */
  downloadInvoicesZip(ids: string[]) {
    return this.requestBinary('POST', '/invoices/download', { ids });
  }

  approveInvoice(id: string, remark?: string | null) {
    return this.request(
      'POST',
      `/invoices/${encodeURIComponent(id)}/approve`,
      undefined,
      { remark: remark ?? null },
      { timeoutMs: PSA_INVOICE_PROXY_TIMEOUT_MS },
    );
  }

  retryPsaInvoice(id: string) {
    return this.request(
      'POST',
      `/invoices/${encodeURIComponent(id)}/psa-retry`,
      undefined,
      undefined,
      { timeoutMs: PSA_INVOICE_PROXY_TIMEOUT_MS },
    );
  }

  /** 海外 PSA Invoice xlsx：billing 读对象存储后代理字节流，不走 presigned URL。 */
  downloadPsaInvoiceAttachment(id: string) {
    return this.requestBinary(
      'GET',
      `/invoices/${encodeURIComponent(id)}/psa-attachment`,
      undefined,
      { timeoutMs: PSA_INVOICE_PROXY_TIMEOUT_MS },
    );
  }

  rejectInvoice(id: string, reason: string) {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/reject`, undefined, { reason });
  }

  issueUploadedInvoice(id: string, body: IssueUploadedInvoiceRequest) {
    const itemId = body.itemId?.trim();
    if (itemId) {
      return this.request(
        'POST',
        `/invoices/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}/issue-upload`,
        undefined,
        body,
      );
    }
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/issue-upload`, undefined, body);
  }

  voidInvoice(id: string, reason: string) {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/void`, undefined, { reason });
  }

  redOffsetInvoice(id: string, reason: string) {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/red-offset`, undefined, {
      reason,
    });
  }

  failInvoice(id: string, reason: string) {
    return this.request('POST', `/invoices/${encodeURIComponent(id)}/fail`, undefined, { reason });
  }

  /** 国际充值错金额发票补救：已开票会红冲旧票并按实付金额新建待审核申请。 */
  repairInternationalRechargeInvoiceAmounts(
    body: RepairInternationalRechargeInvoicesRequest,
  ) {
    return this.request('POST', '/invoices/repair-international-recharge-amounts', undefined, body);
  }

  // ============================
  // 企业账户（billing enterprise account 内部端点，§10.2.6）
  // admin-api 全量放行 /internal/billing/admin/*，无需改 guard；idempotencyKey 透传对齐 e1ff63f。
  // ============================

  /**
   * 只读危害候选集（议题二批一 R3 巡检口）。
   *
   * ⚠️ 转发它的**唯一理由**是让卡住的 fanout（status=ALERTED）对运营可见：
   * 那些行的唯一出口是「再点一次继续作废」（会原子复位），而运营看不到 fanout 表 ——
   * 不转发就等于要求他们凭直觉知道该再点一次，那实质是一条口口相传的运维手册。
   */
  listEnterpriseProvisioningHazards(filters: { cursor?: string; limit?: number } = {}) {
    return this.request('GET', '/enterprise-accounts/hazards', {
      cursor: filters.cursor,
      limit: filters.limit,
    });
  }

  listEnterpriseAccounts(filters: EnterpriseAccountListFilters = {}) {
    return this.request('GET', '/enterprise-accounts', {
      page: filters.page,
      pageSize: filters.pageSize,
      status: filters.status,
      ownerUserId: filters.ownerUserId,
      uscc: filters.uscc,
      search: filters.search,
    });
  }

  getEnterpriseAccount(id: string) {
    return this.request('GET', `/enterprise-accounts/${encodeURIComponent(id)}`);
  }

  /** 用户详情页「可用金额」：个人账户 + 各企业账户。 */
  getOwnerAvailableAmounts(userId: string) {
    return this.request(
      'GET',
      `/enterprise-accounts/owners/${encodeURIComponent(userId)}/available-amounts`,
    );
  }

  createEnterpriseAccount(body: CreateEnterpriseAccountRequest) {
    return this.request('POST', '/enterprise-accounts', undefined, body);
  }

  updateEnterpriseAccount(id: string, body: UpdateEnterpriseAccountRequest) {
    return this.request('PUT', `/enterprise-accounts/${encodeURIComponent(id)}`, undefined, body);
  }

  getEnterpriseAccountCredit(id: string) {
    return this.request('GET', `/enterprise-accounts/${encodeURIComponent(id)}/credit`);
  }

  updateEnterpriseAccountCredit(id: string, body: UpdateEnterpriseCreditRequest) {
    return this.request('PUT', `/enterprise-accounts/${encodeURIComponent(id)}/credit`, undefined, body);
  }

  listEnterpriseAccountCreditEvents(id: string, params: { limit?: number; cursor?: string } = {}) {
    return this.request('GET', `/enterprise-accounts/${encodeURIComponent(id)}/credit-events`, params);
  }

  rechargeEnterpriseAccount(
    id: string,
    body: RechargeEnterpriseAccountRequest,
  ): Promise<BalanceAdjustmentResult> {
    return this.request<BalanceAdjustmentResult>(
      'POST',
      `/enterprise-accounts/${encodeURIComponent(id)}/recharge`,
      undefined,
      body,
      { timeoutMs: this.fundingRequestTimeoutMs },
    );
  }

  applyEnterpriseBalanceAdjustment(
    id: string,
    body: EnterpriseBalanceAdjustmentRequest,
  ): Promise<ClassifiedBalanceAdjustmentResult> {
    return this.request<ClassifiedBalanceAdjustmentResult>(
      'POST',
      `/enterprise-accounts/${encodeURIComponent(id)}/balance-adjustment`,
      undefined,
      body,
      { timeoutMs: this.fundingRequestTimeoutMs },
    );
  }

  listEnterpriseAccountOwnerMembers(id: string) {
    return this.request('GET', `/enterprise-accounts/${encodeURIComponent(id)}/owner-members`);
  }

  upsertEnterpriseAccountOwnerMember(
    id: string,
    body: UpsertEnterpriseAccountOwnerMemberRequest,
  ) {
    return this.request(
      'POST',
      `/enterprise-accounts/${encodeURIComponent(id)}/owner-members`,
      undefined,
      body,
    );
  }

  attachEnterpriseTenant(id: string, body: AttachEnterpriseTenantRequest) {
    return this.request(
      'POST',
      `/enterprise-accounts/${encodeURIComponent(id)}/attach-tenant`,
      undefined,
      body,
    );
  }

  detachEnterpriseTenant(id: string, body: DetachEnterpriseTenantRequest) {
    return this.request(
      'POST',
      `/enterprise-accounts/${encodeURIComponent(id)}/detach-tenant`,
      undefined,
      body,
    );
  }

  listEnterpriseAccountTenants(id: string) {
    return this.request('GET', `/enterprise-accounts/${encodeURIComponent(id)}/tenants`);
  }

  /**
   * 二进制请求：用于代理 zip/pdf 等非 JSON 响应。复用鉴权头，返回 buffer + content 头。
   */
  private async requestBinary(
    method: string,
    path: string,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<{ buffer: Buffer; contentType: string; filename: string | null }> {
    const url = this.buildUrl(path);
    const headers = this.buildInternalHeaders(body !== undefined);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options?.timeoutMs ?? this.requestTimeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `billing service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new HttpException(text || `billing service returned ${response.status}`, response.status);
    }
    const arrayBuffer = await response.arrayBuffer();
    const disposition = response.headers.get('content-disposition');
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return {
      buffer: Buffer.from(arrayBuffer),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      filename: match?.[1] ?? null,
    };
  }

  /**
   * 大文件下载保持为流，避免 Billing、Admin 两个 Node 进程各自复制完整 CSV。
   */
  private async requestStream(
    method: string,
    path: string,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<{
    stream: Readable;
    contentType: string;
    contentLength: number | null;
    filename: string | null;
  }> {
    const url = this.buildUrl(path);
    const headers = this.buildInternalHeaders(body !== undefined);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options?.timeoutMs ?? this.requestTimeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `billing service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      const responseText = await response.text().catch(() => '');
      throw new HttpException(
        responseText || `billing service returned ${response.status}`,
        response.status,
      );
    }
    if (!response.body) {
      throw new BadGatewayException('billing service returned an empty export stream');
    }

    const contentLengthText = response.headers.get('content-length');
    const contentLength = contentLengthText == null ? null : Number(contentLengthText);
    return {
      stream: Readable.fromWeb(response.body as never),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      contentLength: contentLength !== null
        && Number.isSafeInteger(contentLength)
        && contentLength >= 0
        ? contentLength
        : null,
      filename: parseDownloadFilename(response.headers.get('content-disposition')),
    };
  }

  private async request(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<unknown>;
  private async request<T>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<T>;
  private async request<T = unknown>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
    options?: InternalRequestOptions,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    let response: Response;
    const headers = this.buildInternalHeaders(body !== undefined);

    const timeoutMs = options?.timeoutMs ?? this.requestTimeoutMs;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (this.isTimeoutError(err)) {
        this.logger.warn(
          `billing request timed out method=${method} path=${path} timeoutMs=${timeoutMs}`,
        );
        throw new GatewayTimeoutException(
          `billing service request timed out after ${timeoutMs}ms`,
        );
      }
      throw new BadGatewayException(
        `billing service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }

    const payload = await this.parseJson(response);
    if (!response.ok) {
      const message = this.extractMessage(payload) ?? `billing service returned ${response.status}`;
      throw new HttpException(message, response.status);
    }

    if (payload && typeof payload === 'object' && 'code' in payload) {
      const envelope = payload as { code?: number; message?: string; data?: unknown };
      if (envelope.code !== 0) {
        throw new BadGatewayException(envelope.message || 'billing service returned an error');
      }
      return envelope.data as T;
    }

    return payload as T;
  }

  private buildInternalHeaders(hasBody: boolean): Record<string, string> {
    if (!this.token) {
      throw new InternalServerErrorException('ADMIN_TO_BILLING_TOKEN is required');
    }
    const headers: Record<string, string> = {
      'x-internal-caller': 'admin-api',
      'x-internal-token': this.token,
      'x-billing-api-version': this.apiVersion,
    };
    const adminContext = getAdminRequestContext();
    if (!adminContext?.adminId) {
      throw new InternalServerErrorException('admin request context is required for billing internal API');
    }
    if (!this.adminContextSecret) {
      throw new InternalServerErrorException('ADMIN_TO_BILLING_CONTEXT_SECRET is required');
    }
    Object.assign(headers, signedAdminContextHeaders(adminContext, this.adminContextSecret));
    if (adminContext.requestId) {
      headers['x-request-id'] = adminContext.requestId;
    }
    if (hasBody) {
      headers['content-type'] = 'application/json';
    }
    return headers;
  }

  private buildUrl(path: string, query?: QueryParams): string {
    const url = new URL(`${this.baseUrl}${path}`);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private async parseJson(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return { message: text };
    }
  }

  private extractMessage(payload: unknown): string | null {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const value = (payload as { message?: unknown }).message;
      return typeof value === 'string' ? value : null;
    }
    return null;
  }

  private isTimeoutError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const name = 'name' in error ? String(error.name) : '';
    return name === 'TimeoutError' || name === 'AbortError';
  }
}
