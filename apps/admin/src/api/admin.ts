import type {
  CreateChannelInput,
  UpdateChannelInput,
  CreateProductInput,
  UpdateProductInput,
  CreateBoosterPackInput,
  UpdateBoosterPackInput,
  BundleSku,
  CreateBundleSkuInput,
  UpdateBundleSkuInput,
  CreatePlanInput,
  UpdatePlanInput,
  CreateAlertInput,
  UpdateAlertInput,
  CreateAnnouncementInput,
  UpdateAnnouncementInput,
  UpsertFeatureFlagInput,
  UpsertSystemPromptInput,
  ModelAccessItemInput,
  ModelRoutePolicyItemInput,
  CreateAdminRoleInput,
  UpdateAdminRoleInput,
  InviteAdminMemberInput,
  UpdateAdminMemberInput,
  UpdateUserInput,
} from '@ruidong/shared';
import type { AxiosRequestConfig } from 'axios';
import api from './axios';

function normalizeList<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  for (const key of ['items', 'rows', 'products', 'data']) {
    const nested = record[key];
    if (Array.isArray(nested)) return nested as T[];
  }
  return [];
}

const API_PAGE_SIZE_MAX = 100;

function normalizeTotal(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const total = (value as Record<string, unknown>).total;
  return typeof total === 'number' && Number.isFinite(total) ? total : null;
}

async function listAllPages<T>(
  loader: (page: number, pageSize: number) => Promise<unknown>,
): Promise<T[]> {
  const all: T[] = [];
  let page = 1;

  while (true) {
    const response = await loader(page, API_PAGE_SIZE_MAX);
    const items = normalizeList<T>(response);
    all.push(...items);

    const total = normalizeTotal(response);
    if (items.length < API_PAGE_SIZE_MAX) break;
    if (total != null && all.length >= total) break;
    page += 1;
  }

  return all;
}

export const dashboardApi = {
  overview: (): Promise<AdminDashboardOverview> =>
    api.get('/admin/dashboard/overview').then((r) => r.data.data),
  stats: () => api.get('/admin/stats').then((r) => r.data.data),
  revenue: () => api.get('/admin/revenue').then((r) => r.data.data),
};

export type AdminDashboardPeriod = 'sevenDays' | 'month' | 'year';

export interface AdminDashboardTrendPoint extends Record<string, string | number> {
  date: string;
  value: number;
}

export interface AdminDashboardProductRevenue {
  productId: string;
  productName: string;
  productSlug: string | null;
  billingMode: string | null;
  isActive: boolean | null;
  totalRevenueCents: number;
  todayRevenueCents: number;
}

export interface AdminDashboardOverview {
  users: {
    available?: boolean;
    totalUsers: number;
    todayNewUsers: number;
    trends: Record<AdminDashboardPeriod, AdminDashboardTrendPoint[]>;
    generatedAt: string | null;
  };
  payments: {
    available: boolean;
    todayRevenueCents: number;
    totalRevenueCents: number;
    trends: Record<AdminDashboardPeriod, AdminDashboardTrendPoint[]>;
    productBreakdown: AdminDashboardProductRevenue[];
  };
  generatedAt: string;
}

export const userApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get('/admin/users', { params }).then((r) => r.data.data),
  get: (id: string) => api.get(`/admin/users/${id}`).then((r) => r.data.data),
  adjustBalance: (
    id: string,
    amountCents: number,
    reasonCode: BalanceAdjustmentReasonCode,
    description: string,
    idempotencyKey: string,
  ) =>
    api.post(`/admin/users/${id}/adjust-balance`, {
      amountCents,
      reasonCode,
      description,
      idempotencyKey,
    }).then((r) => r.data.data),
  toggleStatus: (id: string) =>
    api.post(`/admin/users/${id}/toggle-status`).then((r) => r.data.data),
};

export type BalanceAdjustmentReasonCode =
  | 'DISCOUNT_CORRECTION'
  | 'BILLING_CORRECTION'
  | 'SERVICE_COMPENSATION'
  | 'OTHER';

export interface ChannelProtocolTemplateOption {
  value: string;
  label: string;
  provider: string;
  sdkType: string;
  providerProfile: string;
  baseUrlPlaceholder: string;
  clientCompatibility?: string[];
  servedInboundProtocols?: string[];
  protocolPaths?: ProtocolPath[];
  tokenCountStrategy?: string;
}

export interface ChannelRuntimeProfileCapabilities {
  clientCompatibilities: string[];
  servedInboundProtocols: string[];
  tokenCountStrategies: string[];
  defaultClientCompatibility: string[];
  defaultServedInboundProtocols: string[];
  defaultTokenCountStrategy?: string;
}

export interface ChannelProtocolTemplatesResponse {
  contractVersion: string;
  defaultTemplate: string;
  customTemplate: string;
  contract: {
    providerProfiles: string[];
    clientCompatibilities: string[];
    inboundProtocols: string[];
    dedicatedProtocolChannels?: string[];
    tokenCountStrategies: string[];
    profileCapabilities?: Record<string, ChannelRuntimeProfileCapabilities>;
  };
  items: ChannelProtocolTemplateOption[];
}

export interface ProviderAccountIdentity {
  id: string;
  ref: string;
  providerCode: string;
  displayName: string;
  status: 'active' | 'inactive';
  createdAt?: string;
  updatedAt?: string;
}

export interface CreateProviderAccountIdentityInput {
  providerCode: string;
  displayName: string;
}

export const providerAccountIdentityApi = {
  list: (): Promise<ProviderAccountIdentity[]> =>
    api.get('/admin/provider-account-identities')
      .then((r) => normalizeList<ProviderAccountIdentity>(r.data.data)),
  create: (data: CreateProviderAccountIdentityInput): Promise<ProviderAccountIdentity> =>
    api.post('/admin/provider-account-identities', data).then((r) => r.data.data),
  deactivate: (id: string): Promise<ProviderAccountIdentity> =>
    api.post(`/admin/provider-account-identities/${encodeURIComponent(id)}/deactivate`)
      .then((r) => r.data.data),
};

export const channelApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get('/admin/channels', { params }).then((r) => r.data.data),
  listAll: <T = unknown>(): Promise<T[]> =>
    listAllPages<T>((page, pageSize) => channelApi.list({ page, pageSize })),
  protocolTemplates: (): Promise<ChannelProtocolTemplatesResponse> =>
    api.get('/admin/channels/protocol-templates').then((r) => r.data.data),
  get: (id: string) => api.get(`/admin/channels/${id}`).then((r) => r.data.data),
  create: (data: CreateChannelInput) =>
    api.post('/admin/channels', data).then((r) => r.data.data),
  update: (id: string, data: UpdateChannelInput) =>
    api.put(`/admin/channels/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => api.delete(`/admin/channels/${id}`, { data: {} }).then((r) => r.data.data),
  test: (id: string) => api.post(`/admin/channels/${id}/test`).then((r) => r.data.data),
  resetStats: (id: string) => api.post(`/admin/channels/${id}/reset-stats`).then((r) => r.data.data),
  discoverModels: (id: string): Promise<{ success: boolean; models: string[]; error?: string }> =>
    api.post(`/admin/channels/${id}/discover-models`).then((r) => r.data.data),
  publisherCompilePreview: (data: Partial<CreateChannelInput>) =>
    api.post('/admin/channels/publisher-compile-preview', data).then((r) => r.data.data),
};

export const orderApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get('/admin/orders', { params }).then((r) => r.data.data),
};

export type ProductCredentialSource = 'keypool' | 'dedicated_upstream';
export type ProductModelScopeMode = 'plan_configured' | 'product_allowlist' | 'upstream_inherited';
export type ProductFallbackPolicy = 'none' | 'within_product' | 'within_provider' | 'platform_default';
export type ProductRuntimeBillingMode =
  | 'payg_balance'
  | 'subscription_credits'
  | 'token_plan_quota'
  | 'included_upstream';
export type ProductRuntimeProviderStrategy = 'priority' | 'weight' | 'latency' | 'least_busy';
export type ProductRuntimePolicyStatus = 'active' | 'disabled';

export interface ProductRuntimePolicyPayload {
  credentialSource: ProductCredentialSource;
  allowedProviderIds: string[];
  allowedChannelIds: string[];
  modelScopeMode: ProductModelScopeMode;
  allowedModels: string[];
  fallbackPolicy: ProductFallbackPolicy;
  runtimeBillingMode: ProductRuntimeBillingMode;
  routeStrategy: ProductRuntimeProviderStrategy | null;
  allowHighLossBridgeWhenNoNative: boolean;
  allowBridgeOnNativeFailure: boolean;
  highLossBridgeReason: string | null;
  highLossBridgeOwner: string | null;
  highLossBridgeExpiresAt: string | null;
  highLossBridgeApproval: string | null;
  status: ProductRuntimePolicyStatus;
}

export interface ProductRuntimePolicySnapshot extends ProductRuntimePolicyPayload {
  id: string | null;
  productId: string;
  revision: number;
  effectiveAllowHighLossBridgeWhenNoNative?: boolean;
  highLossBridgeExpired?: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProductRuntimePolicyChannel {
  id: string;
  name: string;
  provider: string;
  providerProfile?: string | null;
  runtimeProviderId: string;
  baseUrl: string;
  sdkType: string;
  models: string[];
  status: string;
  isActive: boolean;
  priority: number;
  weight: number;
}

export interface ProductRuntimePolicyResponse {
  product: { id: string; name: string; slug: string; billingMode: string };
  explicit: boolean;
  policy: ProductRuntimePolicySnapshot;
  channels: ProductRuntimePolicyChannel[];
  publisherSync?: PublisherSyncMessage | null;
}

export type ProductChannelRouteStatus = 'active' | 'disabled' | 'testing';
export type ProductChannelGroupRouteStatus = 'active' | 'disabled';
export type ProductChannelGroupStrategy =
  | 'weighted_failover'
  | 'priority_failover'
  | 'round_robin'
  | 'cost_first'
  | 'latency_first';
export type ProductChannelGroupMemberRole = 'primary' | 'fallback' | 'shadow';
export type ProductRouteAssignmentSubjectType = 'USER' | 'USER_SEGMENT';
export type ProductRouteAssignmentTargetType = 'GROUP' | 'PRODUCT_CHANNEL';
export type ProductRouteAssignmentMode = 'ONLY' | 'PREFER';
export type DeliverySettingAudienceScope = 'ALL' | ProductRouteAssignmentSubjectType;

export interface ProductChannelRouteInput {
  channelId?: string;
  displayName?: string | null;
  status?: ProductChannelRouteStatus;
  isDefault?: boolean;
  allowedModels?: string[] | null;
  deniedModels?: string[] | null;
  priority?: number;
  weight?: number;
  maxRpm?: number | null;
  maxTpm?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface ProductChannelGroupInput {
  code?: string;
  name?: string;
  description?: string | null;
  strategy?: ProductChannelGroupStrategy;
  isDefault?: boolean;
  status?: ProductChannelGroupRouteStatus;
  metadata?: Record<string, unknown> | null;
}

export interface ProductChannelGroupMemberInput {
  productChannelId?: string;
  priority?: number;
  weight?: number;
  role?: ProductChannelGroupMemberRole;
  maxRpm?: number | null;
  maxTpm?: number | null;
}

export interface ProductRouteAssignmentInput {
  subjectType?: ProductRouteAssignmentSubjectType;
  subjectId?: string;
  modelPattern?: string | null;
  clientCompatibility?: string | null;
  targetType?: ProductRouteAssignmentTargetType;
  targetId?: string;
  mode?: ProductRouteAssignmentMode;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DeliverySettingChannelInput extends ProductChannelRouteInput {
  groupMember?: Omit<ProductChannelGroupMemberInput, 'productChannelId'>;
}

export interface DeliverySettingInput {
  group?: ProductChannelGroupInput;
  channels?: DeliverySettingChannelInput[];
  audience?: Omit<ProductRouteAssignmentInput, 'subjectType' | 'targetType' | 'targetId'> & {
    scope?: DeliverySettingAudienceScope;
  };
}

export interface ProductRouteAssignmentFilters {
  subjectType?: ProductRouteAssignmentSubjectType;
  subjectId?: string;
  targetType?: ProductRouteAssignmentTargetType;
  isActive?: boolean;
}

export type ProtocolPath = {
  inbound_protocol: string;
  channel: string;
};

export type ProductChannelRouteRow = Record<string, unknown> & { id: string };
export type ProductChannelGroupRow = Record<string, unknown> & { id: string };
export type ProductRouteAssignmentRow = Record<string, unknown> & { id: string };
export type ProductRouteGraphPreview = Record<string, unknown>;
export type PublisherSyncMessage =
  | { ok: true; warnings?: unknown[] }
  | { ok: false; error?: string; status?: string; warnings?: unknown[] };

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function publisherWarningText(warning: unknown): string {
  if (typeof warning === 'string') return warning;
  if (!isPlainRecord(warning)) return String(warning);

  const code = typeof warning.code === 'string' ? warning.code : '';
  if (code === 'shared_credential_group') {
    const providerCount = Array.isArray(warning.providers) ? warning.providers.length : 0;
    const providerText = providerCount > 0 ? `${providerCount} 个上游 Provider` : '多个上游 Provider';
    return `共享凭证被 ${providerText} 复用，Publisher 无法按单个 Provider 强制聚合 Key 限额；请确认共用凭证符合预期`;
  }

  const message = typeof warning.message === 'string' ? warning.message.trim() : '';
  if (message) return code ? `${code}: ${message}` : message;
  if (code) return code;

  return 'Publisher 返回了未识别的警告';
}

export function publisherWarningsText(warnings?: unknown[], limit = 2): string {
  if (!warnings?.length) return '';
  const rendered = warnings
    .slice(0, limit)
    .map((warning) => publisherWarningText(warning))
    .filter(Boolean)
    .join('；');
  const suffix = warnings.length > limit ? `；另有 ${warnings.length - limit} 条` : '';
  return rendered ? `${rendered}${suffix}` : `${warnings.length} 条 Publisher 警告`;
}

export function publisherSyncMessage(result: unknown): PublisherSyncMessage | null {
  if (!result || typeof result !== 'object') return null;
  const sync = (result as { publisherSync?: unknown }).publisherSync;
  if (!sync || typeof sync !== 'object') return null;
  const data = sync as { ok?: unknown; error?: unknown; status?: unknown; warnings?: unknown };
  const warnings = Array.isArray(data.warnings) ? data.warnings : undefined;
  if (data.ok === true) return { ok: true, ...(warnings?.length ? { warnings } : {}) };
  if (data.ok === false) {
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
      ...(warnings?.length ? { warnings } : {}),
    };
  }
  return null;
}

export const productApi = {
  list: () => api.get('/admin/products').then((r) => r.data.data),
  create: (data: CreateProductInput) => api.post('/admin/products', data).then((r) => r.data.data),
  update: (id: string, data: UpdateProductInput) => api.put(`/admin/products/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => api.delete(`/admin/products/${id}`).then((r) => r.data.data),
  integration: (id: string) => api.get(`/admin/products/${id}/integration`).then((r) => r.data.data),
  runtimePolicy: (id: string): Promise<ProductRuntimePolicyResponse> =>
    api.get(`/admin/products/${id}/runtime-policy`).then((r) => r.data.data),
  updateRuntimePolicy: (id: string, data: ProductRuntimePolicyPayload): Promise<ProductRuntimePolicyResponse> =>
    api.put(`/admin/products/${id}/runtime-policy`, data).then((r) => r.data.data),
  productChannels: (id: string): Promise<ProductChannelRouteRow[]> =>
    api.get(`/admin/products/${id}/channels`).then((r) => r.data.data),
  createProductChannel: (id: string, data: ProductChannelRouteInput): Promise<ProductChannelRouteRow> =>
    api.post(`/admin/products/${id}/channels`, data).then((r) => r.data.data),
  createDeliverySetting: (id: string, data: DeliverySettingInput): Promise<Record<string, unknown>> =>
    api.post(`/admin/products/${id}/delivery-settings`, data).then((r) => r.data.data),
  updateProductChannel: (
    id: string,
    productChannelId: string,
    data: Omit<ProductChannelRouteInput, 'channelId'>,
  ): Promise<ProductChannelRouteRow> =>
    api.put(`/admin/products/${id}/channels/${productChannelId}`, data).then((r) => r.data.data),
  deleteProductChannel: (id: string, productChannelId: string) =>
    api.delete(`/admin/products/${id}/channels/${productChannelId}`).then((r) => r.data.data),
  productChannelGroups: (id: string): Promise<ProductChannelGroupRow[]> =>
    api.get(`/admin/products/${id}/channel-groups`).then((r) => r.data.data),
  createProductChannelGroup: (id: string, data: ProductChannelGroupInput): Promise<ProductChannelGroupRow> =>
    api.post(`/admin/products/${id}/channel-groups`, data).then((r) => r.data.data),
  updateProductChannelGroup: (
    id: string,
    groupId: string,
    data: ProductChannelGroupInput,
  ): Promise<ProductChannelGroupRow> =>
    api.put(`/admin/products/${id}/channel-groups/${groupId}`, data).then((r) => r.data.data),
  deleteProductChannelGroup: (id: string, groupId: string) =>
    api.delete(`/admin/products/${id}/channel-groups/${groupId}`).then((r) => r.data.data),
  addProductChannelGroupMember: (
    id: string,
    groupId: string,
    data: ProductChannelGroupMemberInput,
  ): Promise<ProductChannelGroupRow> =>
    api.post(`/admin/products/${id}/channel-groups/${groupId}/members`, data).then((r) => r.data.data),
  updateProductChannelGroupMember: (
    id: string,
    groupId: string,
    memberId: string,
    data: Omit<ProductChannelGroupMemberInput, 'productChannelId'>,
  ): Promise<ProductChannelGroupRow> =>
    api.put(`/admin/products/${id}/channel-groups/${groupId}/members/${memberId}`, data).then((r) => r.data.data),
  deleteProductChannelGroupMember: (id: string, groupId: string, memberId: string) =>
    api.delete(`/admin/products/${id}/channel-groups/${groupId}/members/${memberId}`).then((r) => r.data.data),
  productRouteAssignments: (
    id: string,
    params?: ProductRouteAssignmentFilters,
  ): Promise<ProductRouteAssignmentRow[]> =>
    api.get(`/admin/products/${id}/route-assignments`, { params }).then((r) => r.data.data),
  createProductRouteAssignment: (
    id: string,
    data: ProductRouteAssignmentInput,
  ): Promise<ProductRouteAssignmentRow> =>
    api.post(`/admin/products/${id}/route-assignments`, data).then((r) => r.data.data),
  updateProductRouteAssignment: (
    id: string,
    assignmentId: string,
    data: ProductRouteAssignmentInput,
  ): Promise<ProductRouteAssignmentRow> =>
    api.put(`/admin/products/${id}/route-assignments/${assignmentId}`, data).then((r) => r.data.data),
  deleteProductRouteAssignment: (id: string, assignmentId: string) =>
    api.delete(`/admin/products/${id}/route-assignments/${assignmentId}`).then((r) => r.data.data),
  previewProductRouteGraph: (id: string): Promise<ProductRouteGraphPreview> =>
    api.get(`/admin/products/${id}/route-graph/preview`).then((r) => r.data.data),
  rebuildProductRouteGraph: (id: string): Promise<ProductRouteGraphPreview> =>
    api.post(`/admin/products/${id}/route-graph/rebuild`).then((r) => r.data.data),
  rotateIntegrationToken: (id: string) =>
    api.post(`/admin/products/${id}/integration-token/rotate`).then((r) => r.data.data),
  rotateWebhookSecret: (id: string) =>
    api.post(`/admin/products/${id}/webhook-secret/rotate`).then((r) => r.data.data),
};

export const boosterPackApi = {
  list: () => api.get('/admin/booster-packs').then((r) => r.data.data),
  create: (data: CreateBoosterPackInput) => api.post('/admin/booster-packs', data).then((r) => r.data.data),
  update: (id: string, data: UpdateBoosterPackInput) => api.put(`/admin/booster-packs/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => api.delete(`/admin/booster-packs/${id}`).then((r) => r.data.data),
};

export const bundleApi = {
  list: (params?: { isActive?: boolean }): Promise<BundleSku[]> =>
    api.get('/admin/bundles', { params }).then((r) => r.data.data),
  getById: (id: string): Promise<BundleSku> =>
    api.get(`/admin/bundles/${id}`).then((r) => r.data.data),
  create: (data: CreateBundleSkuInput): Promise<BundleSku> =>
    api.post('/admin/bundles', data).then((r) => r.data.data),
  update: (id: string, data: UpdateBundleSkuInput): Promise<BundleSku> =>
    api.put(`/admin/bundles/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<{ deleted: boolean; disabled: boolean }> =>
    api.delete(`/admin/bundles/${id}`).then((r) => r.data.data),
};

export const orderAdminApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    userId?: string;
    orderType?: string;
    channel?: string;
    search?: string;
  }) => api.get('/admin/orders', { params }).then((r) => r.data.data),
  getDetail: (id: string) => api.get(`/admin/orders/${id}`).then((r) => r.data.data),
  refund: (id: string, reason: string) => api.post(`/admin/orders/${id}/refund`, { reason }).then((r) => r.data.data),
  cancel: (id: string, reason?: string) => api.post(`/admin/orders/${id}/cancel`, { reason }).then((r) => r.data.data),
  retry: (id: string) => api.post(`/admin/orders/${id}/retry`).then((r) => r.data.data),
};

export const transactionApi = {
  list: (params?: { page?: number; pageSize?: number; userId?: string }) =>
    api.get('/admin/transactions', { params }).then((r) => r.data.data),
  listAll: <T = unknown>(params?: { userId?: string }): Promise<T[]> =>
    listAllPages<T>((page, pageSize) => transactionApi.list({ page, pageSize, ...params })),
};

export interface GatewayUsageEvidenceRow {
  id: string;
  gatewayBillingEventId?: string;
  requestId?: string;
  source?: string | null;
  tokenSource?: string | null;
  upstreamRequestId?: string | null;
  upstreamResponseId?: string | null;
  providerCredentialRef?: string | null;
  providerUsageHash?: string | null;
  providerAccountRef?: string | null;
  producerBuildSha?: string | null;
  streamEndReason?: string | null;
  usageEvidenceSource?: string | null;
  usageEvidenceStatus?: string | null;
  usageEvidenceProtocol?: string | null;
  terminalFrameSeen?: boolean | null;
  providerReconciliationRequired?: boolean | null;
  evidenceHash?: string | null;
  evidenceRevision?: number | null;
  rawEvidence?: unknown;
  observedAt?: string | null;
  createdAt?: string | null;
}

export type GatewayFundingMoneyValue = string | number | null;

/**
 * Read-only debt-settlement evidence returned by Billing. All properties stay
 * optional so Admin can read events written before this detail contract was
 * introduced without treating missing historical fields as zero.
 */
export interface GatewayFundingSettlementRow {
  [key: string]: unknown;
  id?: string;
  billingAccountId?: string;
  allocationId?: string;
  repaymentTransactionId?: string | null;
  balanceGrantId?: string | null;
  debtSource?: string | null;
  repairRunId?: string | null;
  operationKey?: string | null;
  trigger?: string | null;
  amount?: GatewayFundingMoneyValue;
  amountUsd?: GatewayFundingMoneyValue;
  paidAmount?: GatewayFundingMoneyValue;
  paidUsd?: GatewayFundingMoneyValue;
  bonusAmount?: GatewayFundingMoneyValue;
  bonusUsd?: GatewayFundingMoneyValue;
  occurredAt?: string | null;
  createdAt?: string | null;
}

export interface GatewayFundingAllocationRow {
  [key: string]: unknown;
  id?: string;
  userId?: string;
  tenantId?: string;
  billingAccountId?: string | null;
  productId?: string | null;
  balanceTransactionId?: string;
  tokenUsageId?: string | null;
  balanceGrantId?: string | null;
  source?: string | null;
  amount?: GatewayFundingMoneyValue;
  amountUsd?: GatewayFundingMoneyValue;
  approvedCreditAmount?: GatewayFundingMoneyValue;
  approvedCreditUsd?: GatewayFundingMoneyValue;
  unapprovedDebtAmount?: GatewayFundingMoneyValue;
  unapprovedDebtUsd?: GatewayFundingMoneyValue;
  settledAmount?: GatewayFundingMoneyValue;
  settledUsd?: GatewayFundingMoneyValue;
  fundingClassificationComplete?: boolean | null;
  settledAt?: string | null;
  creditPolicyAt?: string | null;
  creditTermsDays?: number | null;
  creditDueAt?: string | null;
  creditPolicySnapshotComplete?: boolean | null;
  ledgerSequence?: string | number | null;
  createdAt?: string | null;
  settlements?: GatewayFundingSettlementRow[] | null;
}

export interface GatewayTokenUsageFundingRow {
  [key: string]: unknown;
  id?: string;
  requestId?: string | null;
  model?: string;
  customerChargePolicy?: string | null;
  customerChargeAmount?: GatewayFundingMoneyValue;
  customerChargeUsd?: GatewayFundingMoneyValue;
  customerCollectedAmount?: GatewayFundingMoneyValue;
  customerCollectedUsd?: GatewayFundingMoneyValue;
  customerApprovedReceivableAmount?: GatewayFundingMoneyValue;
  customerApprovedReceivableUsd?: GatewayFundingMoneyValue;
  customerUnapprovedDebtAmount?: GatewayFundingMoneyValue;
  customerUnapprovedDebtUsd?: GatewayFundingMoneyValue;
  customerFundingClassificationComplete?: boolean | null;
  consumptionAllocations?: GatewayFundingAllocationRow[] | null;
}

export interface GatewayFundingReservationRow {
  [key: string]: unknown;
  id?: string;
  requestId?: string;
  billingAccountId?: string;
  tenantId?: string;
  userId?: string;
  apiKeyId?: string;
  billingUnit?: string;
  occurredAt?: string | null;
  firstReceivedAt?: string | null;
  reservationSequence?: string | number | null;
  reservedAmountUsd?: GatewayFundingMoneyValue;
  reservedAmount?: GatewayFundingMoneyValue;
  collectedUsd?: GatewayFundingMoneyValue;
  collectedAmount?: GatewayFundingMoneyValue;
  approvedCreditUsd?: GatewayFundingMoneyValue;
  approvedCreditAmount?: GatewayFundingMoneyValue;
  unapprovedDebtUsd?: GatewayFundingMoneyValue;
  unapprovedDebtAmount?: GatewayFundingMoneyValue;
  creditPolicyAt?: string | null;
  policyAt?: string | null;
  creditPolicyRevision?: number | null;
  revision?: number | null;
  creditPolicySource?: string | null;
  source?: string | null;
  creditPolicyReconstructible?: boolean | null;
  reconstructible?: boolean | null;
  creditLimitUsd?: GatewayFundingMoneyValue;
  limit?: GatewayFundingMoneyValue;
  creditTermsDays?: number | null;
  terms?: number | null;
  approvedCreditDueAt?: string | null;
  creditDueAt?: string | null;
  due?: string | null;
  creditStatus?: string | null;
  creditEffectiveAt?: string | null;
  effective?: string | null;
  creditExpiresAt?: string | null;
  expires?: string | null;
  anchorHash?: string | null;
  reservationHash?: string | null;
  canonicalPayload?: Record<string, unknown> | null;
  status?: string | null;
  reviewReason?: string | null;
  authoritativeAmountUsd?: GatewayFundingMoneyValue;
  authoritativeAmount?: GatewayFundingMoneyValue;
  consumedAt?: string | null;
  releasedAt?: string | null;
  releaseReason?: string | null;
  createdAt?: string | null;
}

/**
 * Permanent management-accounting fact for an already-settled request whose
 * authoritative provider usage proved a customer undercharge. Billing sends
 * every Decimal as a string; accepting numbers here would silently lose the
 * 12-decimal audit precision in the Admin UI.
 */
export interface GatewayUsagePlatformLossRow {
  id: string;
  gatewayBillingEventId: string;
  requestId: string;
  reconciliationActionId: string;
  correctionEvidenceId: string;
  correctionEvidenceHash: string;
  originalSettlementReceiptId: string;
  absorptionSettlementReceiptId: string;
  billingUnit: string;
  customerChargeBeforeUsd: string;
  customerChargeCorrectedUsd: string;
  absorbedCustomerChargeUsd: string;
  customerDeductionUsd: string;
  providerCostBeforeUsd: string;
  providerCostCorrectedUsd: string;
  providerCostDeltaUsd: string;
  platformLossUsd: string;
  valuationPolicyVersion: string;
  reason: string;
  actorId: string;
  idempotencyKey: string;
  createdAt: string;
}

export interface GatewayBillingEventRow {
  id: string;
  requestId: string;
  eventId?: string | null;
  status: 'RECEIVED' | 'DEDUCTED' | 'SKIPPED' | 'FAILED' | string;
  reason?: string | null;
  apiKeyId?: string | null;
  tenantId?: string | null;
  userId?: string | null;
  productId?: string | null;
  productSlug?: string | null;
  modelName?: string | null;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  totalTokens: number;
  source?: string | null;
  idempotencyKey?: string | null;
  billingUnit?: string | null;
  rawEvent?: unknown;
  billingResult?: unknown;
  evidenceHash?: string | null;
  evidenceVerdict?: string | null;
  reconciliationStatus?: string | null;
  fundingOutcome?: string | null;
  revision?: number | null;
  evidence?: GatewayUsageEvidenceRow[];
  usageEvidences?: GatewayUsageEvidenceRow[];
  settlementAnchor?: unknown;
  settlementReceipts?: unknown[];
  reconciliationActions?: unknown[];
  platformLossEntries?: GatewayUsagePlatformLossRow[];
  accessRestrictions?: unknown[];
  fundingReservation?: GatewayFundingReservationRow | null;
  tokenUsage?: GatewayTokenUsageFundingRow | null;
  settlementSnapshot?: unknown;
  pricingSnapshot?: unknown;
  entitlementSnapshot?: unknown;
  subjectSnapshot?: unknown;
  billingAccountId?: string | null;
  upstreamRequestId?: string | null;
  tokenSource?: string | null;
  pendingExposureAmount?: number | string | null;
  pendingHoldAmount?: number | string | null;
  pendingExposureUsd?: number | string | null;
  pendingHoldUsd?: number | string | null;
  errorMessage?: string | null;
  occurredAt?: string | null;
  receivedAt?: string;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface GatewayBillingEventActionInput {
  expectedRevision: number;
  reason: string;
  idempotencyKey: string;
}

export type GatewayBillingEventAbsorbInput = GatewayBillingEventActionInput & (
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

export interface GatewayBillingEventSettlementInput extends GatewayBillingEventActionInput {
  evidenceId: string;
}

export const gatewayBillingEventApi = {
  list: (params?: {
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
  }): Promise<{ items: GatewayBillingEventRow[]; total: number; page: number; pageSize: number }> =>
    api.get('/admin/gateway-billing-events', { params }).then((r) => r.data.data),
  get: (requestId: string): Promise<GatewayBillingEventRow> =>
    api.get(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}`).then((r) => r.data.data),
  retry: (requestId: string, data: GatewayBillingEventActionInput) =>
    api.post(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}/retry`, data).then((r) => r.data.data),
  manualReview: (requestId: string, data: GatewayBillingEventActionInput) =>
    api.post(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}/manual-review`, data).then((r) => r.data.data),
  reconcileSettle: (requestId: string, data: GatewayBillingEventSettlementInput) =>
    api.post(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}/reconcile-settle`, data).then((r) => r.data.data),
  absorb: (requestId: string, data: GatewayBillingEventAbsorbInput) =>
    api.post(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}/absorb`, data).then((r) => r.data.data),
  absorbDelta: (requestId: string, data: GatewayBillingEventSettlementInput) =>
    api.post(`/admin/gateway-billing-events/${encodeURIComponent(requestId)}/absorb-delta`, data).then((r) => r.data.data),
};

export type HistoricalPlatformLossLineType =
  | 'MISSING_ANCHOR_REQUEST'
  | 'PROVIDER_AGGREGATE';

export interface HistoricalPlatformLossValuationBasis {
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
}

export interface HistoricalPlatformLossLineInput {
  lineType: HistoricalPlatformLossLineType;
  sourceRowRef: string;
  sourceEvidence: Record<string, unknown>;
  serviceDate: string;
  model: string;
  meter: string;
  platformUsage: string;
  providerUsage: string;
  valuationBasis: HistoricalPlatformLossValuationBasis;
  requestId?: string;
  upstreamRequestId?: string;
  providerAggregateRef?: string;
}

export interface HistoricalPlatformLossLineRow {
  id?: string;
  lineNumber: number;
  lineType: HistoricalPlatformLossLineType;
  gatewayBillingEventId: string | null;
  requestId: string | null;
  upstreamRequestId: string | null;
  providerAggregateRef: string | null;
  serviceDate: string;
  model: string;
  meter: string;
  platformUsage: string;
  providerUsage: string;
  usageDelta: string;
  valuationBasis: HistoricalPlatformLossValuationBasis;
  sourceRowRef: string;
  sourceEvidence: Record<string, unknown>;
  sourceRowHash: string;
  recognitionKeys: Array<{ type: string; key: string }>;
  platformAmountBefore: string;
  platformAmountCorrected: string;
  customerAbsorbedDelta: string;
  customerDeduction: string;
  providerCostBefore: string;
  providerCostCorrected: string;
  providerCostDelta: string;
  lineHash: string;
  createdAt?: string;
}

export interface HistoricalPlatformLossIssue {
  lineNumber?: number;
  code: string;
  message: string;
  action?: string;
  requestId?: string;
}

export interface HistoricalPlatformLossTotals {
  platformAmountBefore: string;
  platformAmountCorrected: string;
  customerAbsorbedDelta: string;
  customerDeduction: string;
  providerCostBefore: string;
  providerCostCorrected: string;
  providerCostDelta: string;
}

export interface HistoricalPlatformLossBatchInput {
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
  reason: string;
  lines: HistoricalPlatformLossLineInput[];
}

export type HistoricalPlatformLossExchangeRateDirection =
  | 'BATCH_CURRENCY_PER_SOURCE_CURRENCY';

export interface HistoricalPlatformLossResponseHeader {
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
  exchangeRate: string | null;
  exchangeRateSource: string | null;
  exchangeRateSourceCurrency: string | null;
  exchangeRateDirection: HistoricalPlatformLossExchangeRateDirection | null;
  exchangeRateAsOf: string | null;
  reason: string;
}

export interface HistoricalPlatformLossPreview extends HistoricalPlatformLossResponseHeader {
  status: 'READY' | 'BLOCKED';
  fingerprint: string | null;
  itemCount: number;
  totals: HistoricalPlatformLossTotals | null;
  lines: HistoricalPlatformLossLineRow[];
  issues: HistoricalPlatformLossIssue[];
}

export interface HistoricalPlatformLossActionRow {
  id: string;
  action: 'PREPARE' | 'APPROVE_AND_POST' | string;
  expectedRevision: number;
  resultingRevision: number;
  actorId: string;
  reason?: string | null;
  idempotencyKey: string;
  metadata?: unknown;
  createdAt: string;
}

export interface HistoricalPlatformLossBatchRow extends HistoricalPlatformLossResponseHeader {
  id: string;
  status: 'PREPARED' | 'POSTED' | string;
  revision: number;
  fingerprint: string;
  itemCount: number;
  totals: HistoricalPlatformLossTotals;
  lines?: HistoricalPlatformLossLineRow[];
  actions?: HistoricalPlatformLossActionRow[];
  makerActorId: string;
  checkerActorId: string | null;
  postedByActorId: string | null;
  createIdempotencyKey: string;
  postIdempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  postedAt: string | null;
}

export interface HistoricalPlatformLossCreateInput extends HistoricalPlatformLossBatchInput {
  expectedFingerprint: string;
  idempotencyKey: string;
}

export interface HistoricalPlatformLossApproveInput {
  expectedRevision: number;
  expectedFingerprint: string;
  reason: string;
  idempotencyKey: string;
}

export interface HistoricalPlatformLossExport {
  schemaVersion: 'historical-platform-loss-export.v1' | string;
  generatedAt: string;
  batch: HistoricalPlatformLossBatchRow;
  lines: HistoricalPlatformLossLineRow[];
  actions: HistoricalPlatformLossActionRow[];
  totals: HistoricalPlatformLossTotals;
  fingerprint: string;
}

export const historicalPlatformLossApi = {
  preview: (data: HistoricalPlatformLossBatchInput): Promise<HistoricalPlatformLossPreview> =>
    api.post('/admin/historical-platform-loss-batches/preview', data).then((r) => r.data.data),
  create: (data: HistoricalPlatformLossCreateInput): Promise<HistoricalPlatformLossBatchRow> =>
    api.post('/admin/historical-platform-loss-batches', data).then((r) => r.data.data),
  list: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    provider?: string;
    providerAccountRef?: string;
    region?: string;
    periodStart?: string;
    periodEnd?: string;
  }): Promise<{ items: HistoricalPlatformLossBatchRow[]; total: number; page: number; pageSize: number }> =>
    api.get('/admin/historical-platform-loss-batches', { params }).then((r) => r.data.data),
  get: (id: string): Promise<HistoricalPlatformLossBatchRow> =>
    api.get(`/admin/historical-platform-loss-batches/${encodeURIComponent(id)}`).then((r) => r.data.data),
  approveAndPost: (
    id: string,
    data: HistoricalPlatformLossApproveInput,
  ): Promise<HistoricalPlatformLossBatchRow> =>
    api.post(
      `/admin/historical-platform-loss-batches/${encodeURIComponent(id)}/approve-and-post`,
      data,
    ).then((r) => r.data.data),
  export: (id: string): Promise<HistoricalPlatformLossExport> =>
    api.get(`/admin/historical-platform-loss-batches/${encodeURIComponent(id)}/export`)
      .then((r) => r.data.data),
};

export interface PublisherSyncJobRow {
  id: string;
  namespace: 'user' | 'billing' | 'admin' | 'sre' | string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | string;
  path: string;
  body?: unknown;
  status: 'PENDING' | 'PROCESSING' | 'SUCCEEDED' | 'FAILED' | string;
  attempts: number;
  maxAttempts: number;
  idempotencyKey: string;
  requestId?: string | null;
  source?: string | null;
  resourceType?: string | null;
  resourceId?: string | null;
  lastError?: string | null;
  response?: unknown;
  nextRunAt: string;
  lockedAt?: string | null;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const publisherSyncJobApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    namespace?: string;
    method?: string;
    path?: string;
    resourceType?: string;
    resourceId?: string;
    idempotencyKey?: string;
  }): Promise<{ items: PublisherSyncJobRow[]; total: number; page: number; pageSize: number }> =>
    api.get('/admin/publisher-sync-jobs', { params }).then((r) => r.data.data),
  get: (id: string): Promise<PublisherSyncJobRow> =>
    api.get(`/admin/publisher-sync-jobs/${encodeURIComponent(id)}`).then((r) => r.data.data),
  retry: (id: string): Promise<PublisherSyncJobRow> =>
    api.post(`/admin/publisher-sync-jobs/${encodeURIComponent(id)}/retry`).then((r) => r.data.data),
  replay: (scope: 'all' | 'api_keys' | 'key_balances' | 'admin' | 'platform') =>
    api.post('/admin/publisher-sync-jobs/replay', { scope }).then((r) => r.data.data),
};

export interface AdminApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  fullPrefix: string;
  userId: string;
  userEmail: string;
  userNickname?: string | null;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantType?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  productName: string;
  allowedModels: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
  monthlyCalls: number;
  monthlyCost: number;
  isActive: boolean;
}

export interface AdminPaygAccountKeyRow {
  id: string;
  name: string;
  prefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  monthlyCalls: number;
  monthlyCost: number;
}

export interface AdminPaygAccountRow {
  id: string;
  tenantId: string;
  tenantName?: string | null;
  tenantType?: string | null;
  tenantStatus?: string | null;
  accountId: string;
  accountName?: string | null;
  productId?: string | null;
  productName: string;
  productSlug?: string | null;
  userId: string;
  userEmail: string;
  userNickname?: string | null;
  keyCount: number;
  activeKeyCount: number;
  monthlyCalls: number;
  monthlyCost: number;
  walletBalanceCents: number;
  createdAt: string;
  lastUsedAt: string | null;
  keys: AdminPaygAccountKeyRow[];
}

export interface IssuePaygVoucherInput {
  userId: string;
  productId?: string | null;
  amountCents: number;
  reason: string;
  expiresAt?: string | null;
  idempotencyKey: string;
}

export const apiKeyAdminApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    email?: string;
    status?: string;
  }): Promise<{
    items: AdminApiKeyRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> => api.get('/admin/api-keys', { params }).then((r) => r.data.data),
  listAll: (params?: {
    search?: string;
    email?: string;
    status?: string;
  }): Promise<AdminApiKeyRow[]> =>
    listAllPages<AdminApiKeyRow>((page, pageSize) => apiKeyAdminApi.list({ page, pageSize, ...params })),
  toggle: (id: string, isActive: boolean) =>
    api.patch(`/admin/api-keys/${id}/status`, { isActive }).then((r) => r.data.data),
  revoke: (id: string) =>
    api.delete(`/admin/api-keys/${id}`).then((r) => r.data.data),
};

export const paygAccountAdminApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    email?: string;
    status?: string;
    productId?: string;
  }): Promise<{
    items: AdminPaygAccountRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: {
      active: number;
      activeKeys: number;
      monthlyCalls: number;
      monthlyCost: number;
    };
  }> => api.get('/admin/payg-accounts', { params }).then((r) => r.data.data),
  issueVoucher: (tenantId: string, body: IssuePaygVoucherInput): Promise<unknown> =>
    api.post(`/admin/payg-accounts/${encodeURIComponent(tenantId)}/issue-voucher`, body)
      .then((r) => r.data.data),
};

export interface AdminSubscriptionRow {
  id: string;
  tenantId?: string | null;
  tenantName?: string | null;
  tenantType?: string | null;
  tenantStatus?: string | null;
  accountId?: string | null;
  accountName?: string | null;
  userId: string;
  userEmail: string;
  userNickname?: string | null;
  productName: string;
  productSlug: string;
  planId: string;
  planName: string;
  status: 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  startedAt: string;
  expiresAt: string | null;
  updatedAt: string;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  monthlyCredits: number;
}

export const adminSubscriptionApi = {
  list: (params?: {
    page?: number;
    pageSize?: number;
    status?: string;
    expiringDays?: number;
    productId?: string;
    userId?: string;
  }): Promise<{
    items: AdminSubscriptionRow[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    stats: {
      active: number;
      expiringSoon: number;
      cancelled: number;
      expired: number;
    };
  }> => api.get('/admin/subscriptions', { params }).then((r) => r.data.data),
  grantCredits: (subscriptionId: string, amount: number, reason: string, idempotencyKey: string) =>
    api
      .post(`/admin/subscriptions/${encodeURIComponent(subscriptionId)}/grant-credits`, {
        amount,
        reason,
        idempotencyKey,
      })
      .then((r) => r.data.data),
};

export type CodingPlanReadiness =
  | 'ready'
  | 'disabled'
  | 'credential_missing'
  | 'plan_missing'
  | 'no_sellable_plan';

export interface CodingPlanDataSourceState {
  status: 'ready' | 'pending' | 'failed' | 'partial' | string;
  owner: string;
  message?: string;
}

export interface CodingPlanWorkspaceProduct {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  billingMode: 'CODING_PLAN';
  /** 产品履约模式（自营/转售）：自营套餐编辑器据此只列自营产品。 */
  fulfillmentMode: 'platform_model_package' | 'provider_resale';
  isActive: boolean;
  defaultPlanId: string | null;
  defaultPlanName: string | null;
  hasIntegrationToken: boolean;
  integrationTokenPrefix: string | null;
  hasWebhookSecret: boolean;
  webhookSecretPrefix: string | null;
  apiKeyDefaultBinding: boolean;
  virtualKey: {
    name?: string;
    activeCount?: number;
    totalCount?: number;
  } | null;
  checklist: Record<string, boolean>;
  activeSubscriptions: number;
  readiness: CodingPlanReadiness;
}

export interface CodingPlanWorkspacePlan {
  id: string;
  productId: string | null;
  productName: string | null;
  name: string;
  description: string | null;
  planType: string | null;
  billingPeriod: string | null;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  monthlyCredits: number;
  validityDays: number | null;
  rateLimitRpm: number | null;
  rateLimitTpm: number | null;
  maxContextWindow: number | null;
  memberLimit: number | null;
  maxSellableQuantity: number | null;
  usageMultiplier: number | null;
  badge: string | null;
  trialDays: number;
  isActive: boolean;
  isLegacy: boolean;
  salesLimit?: number;
  reservedSalesCount?: number;
  remainingSales?: number | null;
  soldOut?: boolean;
  sortOrder: number;
  fulfillmentMode: 'platform_model_package' | 'provider_resale';
  providerLineId: string | null;
  providerLineCode: string | null;
  upstreamProductId: string | null;
  enabledModelCount: number;
  enabledModels: string[];
  quotaTemplateCount: number;
  quotaTemplates: Array<{
    id: string;
    name: string;
    ruleCount: number;
    isActive: boolean;
  }>;
}

export interface CodingPlanWorkspaceQuotaRule {
  windowType?: string;
  durationLabel?: string;
  durationSec?: number;
  metric?: string;
  limitValue?: number;
  modelGroupId?: string | null;
}

export interface CodingPlanWorkspaceQuotaTemplate {
  id: string;
  name: string;
  description: string | null;
  rules: CodingPlanWorkspaceQuotaRule[];
  referencedPlanIds: string[];
  isActive: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export type CodingPlanFulfillmentMode = 'platform_model_package' | 'provider_resale';

export interface CodingPlanUpstreamProduct {
  providerLineId: string | null;
  providerLineCode: string | null;
  upstreamProductId: string;
  productId: string;
  productName: string;
  productCycle: string | null;
  productType: string | null;
  salePrice: number | string | null;
  productBigTitle: string | null;
  productSmallTitle: string | null;
  description: string | null;
  productIntroduction: string | null;
  salesVolume: number | null;
  dailySalesLimit: number | null;
  monthlySalesLimit: number | null;
  yearlySalesLimit: number | null;
  maxSalesLimit: number | null;
  source: 'synced';
  fetchedAt: string;
}

export interface CodingPlanUpstreamOrder {
  id: string;
  providerLineId?: string | null;
  upstreamOrderId?: string | null;
  upstreamKeyPrefix?: string | null;
  status: string;
  allocatedToSubscriptionId?: string | null;
  activatedAt?: string | null;
  createdAt?: string | null;
}

export interface CodingPlanActivationRecord {
  id: string;
  providerLineId?: string | null;
  userId?: string | null;
  userEmail?: string | null;
  subscriptionId?: string | null;
  planName?: string | null;
  upstreamOrderId?: string | null;
  status: string;
  attempts?: number | null;
  lastError?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface CodingPlanAnomalyRecord {
  id: string;
  providerLineId?: string | null;
  type: string;
  severity: string;
  objectId?: string | null;
  message?: string | null;
  createdAt?: string | null;
}

export interface CodingPlanProviderEntitlement {
  id: string;
  orderId: string;
  subscriptionId?: string | null;
  userId: string;
  tenantId: string;
  productId: string;
  planId: string;
  provider?: string | null;
  providerLineId?: string | null;
  providerLineCode?: string | null;
  providerCode?: string | null;
  upstreamProductId: string;
  partnerUserId?: string | null;
  partnerOrderNo?: string | null;
  upstreamOrderId?: string | null;
  upstreamApiKeyPrefix?: string | null;
  upstreamSecretKeyPrefix?: string | null;
  credentialFormat?: string | null;
  productStartTime?: string | null;
  productEndTime?: string | null;
  status: 'ACTIVE' | 'PENDING' | 'FAILED' | 'EXPIRED' | 'REVOKED' | string;
  lastError?: string | null;
  activatedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  providerLine?: {
    id: string;
    code: string;
    name: string;
    runtimeEnabled: boolean;
  } | null;
  customerEntitlement?: {
    id: string;
    status: string;
    expiresAt?: string | null;
  } | null;
}

export interface CodingPlanProviderLine {
  id: string;
  code: string;
  name: string;
  providerCode: string;
  providerAccountIdentityId?: string | null;
  providerName?: string | null;
  adapterType: string;
  environment: string;
  apiBaseUrl: string;
  authType: string;
  partnerCodeConfigured: boolean;
  partnerCodePrefix?: string | null;
  partnerSecretConfigured: boolean;
  partnerSecretPrefix?: string | null;
  salesEnabled: boolean;
  fulfillmentEnabled: boolean;
  runtimeEnabled: boolean;
  syncEnabled: boolean;
  capabilities?: Record<string, unknown> | null;
  qpsConfig?: Record<string, unknown> | null;
  dedicatedEndpoints?: CodingPlanProviderLineDedicatedEndpoint[] | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface CodingPlanProviderLineDedicatedEndpoint {
  client_protocol: 'anthropic' | 'openai' | 'responses' | string;
  provider_id: string;
  protocol_strategy?: 'passthrough' | 'responses_to_chat' | 'anthropic_to_chat' | string;
  base_url?: string;
  provider_profile?: string;
  name?: string;
  code?: string;
  owned_by?: string;
  status?: string;
  client_compatibility?: string[];
  served_inbound_protocols?: Array<'anthropic' | 'gemini' | 'openai' | 'responses' | string>;
  paths?: ProtocolPath[];
  capabilities?: string[];
  token_count_strategy?: string;
  priority?: number;
  weight?: number;
}

export interface CodingPlanProviderProduct {
  id: string;
  providerLineId: string;
  upstreamProductId: string;
  productName: string;
  salePrice?: number | string | null;
  currency?: string | null;
  productCycle?: string | null;
  productType?: string | null;
  productBigTitle?: string | null;
  productSmallTitle?: string | null;
  description?: string | null;
  productIntroduction?: string | null;
  salesVolume?: number | null;
  dailySalesLimit?: number | null;
  monthlySalesLimit?: number | null;
  yearlySalesLimit?: number | null;
  maxSalesLimit?: number | null;
  status?: string | null;
  lastSyncedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
  providerLine?: {
    id: string;
    code: string;
    name: string;
  } | null;
}

export interface CodingPlanResaleRoute {
  id: string;
  planId: string;
  providerLineId: string;
  upstreamProductId: string;
  fulfillmentMethod: string;
  enabled: boolean;
  priority: number;
  market?: string | null;
  currency?: string | null;
  salesChannel?: string | null;
  userSegmentId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  plan?: {
    id: string;
    name: string;
    productId: string | null;
  } | null;
  providerLine?: {
    id: string;
    code: string;
    name: string;
    providerCode: string;
  } | null;
}

export interface CodingPlanResalePlanRouteWriteInput {
  routeId?: string | null;
  providerLineId: string;
  upstreamProductId: string;
  routeEnabled?: boolean;
  routePriority?: number;
  routeMarket?: string | null;
  routeCurrency?: string | null;
  routeSalesChannel?: string | null;
  routeUserSegmentId?: string | null;
  routeStartAt?: string | null;
  routeEndAt?: string | null;
}

export interface CodingPlanWorkspace {
  generatedAt: string;
  contract: {
    partnerUserIdSource: 'stsoft_user_id';
    partnerUserIdRuntimeField: string;
    purchasedPlans: number;
    provider: string;
    upstreamKeyPolicy: string;
    userKeyPolicy: string;
  };
  policy: {
    providerEntitlementCardinality: string;
    stsoftApiKeyFanOut: string;
    upstreamKeyExposure: string;
  };
  dataSources: Record<string, CodingPlanDataSourceState>;
  stats: {
    contractedPlans: number;
    productCount: number;
    activeProductCount: number;
    sellablePlanCount: number;
    activeSubscriptionCount: number;
    platformModelPlanCount: number;
    providerResalePlanCount: number;
    providerProductBoundPlanCount: number;
    modelConfiguredPlanCount: number;
    quotaConfiguredPlanCount: number;
    quotaTemplateCount: number;
    activeQuotaTemplateCount: number;
    upstreamAvailableCount: number | null;
    upstreamAllocatedCount: number | null;
    activationFailedCount: number | null;
  };
  upstreamProducts: CodingPlanUpstreamProduct[];
  products: CodingPlanWorkspaceProduct[];
  plans: CodingPlanWorkspacePlan[];
  quotaTemplates: CodingPlanWorkspaceQuotaTemplate[];
  upstreamOrders: CodingPlanUpstreamOrder[];
  activations: CodingPlanActivationRecord[];
  anomalies: CodingPlanAnomalyRecord[];
}

export interface CodingPlanPlanWriteInput {
  id?: string;
  productId: string;
  name: string;
  description?: string | null;
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
  maxSellableQuantity?: number | null;
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
  salesLimit?: number;
  sortOrder?: number;
  fulfillmentMode: CodingPlanFulfillmentMode;
  platformPackage?: {
    modelAccess?: Array<{
      modelName: string;
      isActive: boolean;
      creditMultiplier: number;
    }>;
    routePolicies?: Array<{
      routeKey: string;
      primaryModel?: string | null;
      fallbackModels?: string[];
      isActive: boolean;
    }>;
    quotaTemplateIds?: string[];
  } | null;
}

export interface CodingPlanResalePlanWriteInput {
  id?: string | null;
  routeId?: string | null;
  productId: string;
  name: string;
  description?: string | null;
  monthlyPrice?: number;
  quarterlyPrice?: number;
  yearlyPrice?: number;
  billingPeriod?: string;
  memberLimit?: number;
  badge?: string | null;
  trialDays?: number;
  validityDays?: number;
  salesLimit?: number;
  isActive?: boolean;
  isLegacy?: boolean;
  sortOrder?: number;
  currency: string;
  providerLineId: string;
  upstreamProductId: string;
  routes?: CodingPlanResalePlanRouteWriteInput[];
  routeEnabled?: boolean;
  routePriority?: number;
  routeMarket?: string | null;
  routeCurrency?: string | null;
  routeSalesChannel?: string | null;
  routeUserSegmentId?: string | null;
  routeStartAt?: string | null;
  routeEndAt?: string | null;
}

export interface CodingPlanPlanWriteResult {
  id: string;
  productId: string;
  fulfillmentMode: CodingPlanFulfillmentMode;
  plan: unknown;
  route?: CodingPlanResaleRoute;
  routes?: CodingPlanResaleRoute[];
}

export interface CodingPlanPlanDeleteResult {
  deleted: boolean;
  id: string;
}

export const codingPlanAdminApi = {
  workspace: (): Promise<CodingPlanWorkspace> =>
    api.get('/admin/coding-plan/workspace').then((r) => r.data.data),
  createPlan: (data: CodingPlanPlanWriteInput): Promise<CodingPlanPlanWriteResult> =>
    api.post('/admin/coding-plan/plans', data).then((r) => r.data.data),
  updatePlan: (id: string, data: CodingPlanPlanWriteInput): Promise<CodingPlanPlanWriteResult> =>
    api.put(`/admin/coding-plan/plans/${id}`, data).then((r) => r.data.data),
  deletePlan: (id: string): Promise<CodingPlanPlanDeleteResult> =>
    api.delete(`/admin/coding-plan/plans/${id}`).then((r) => r.data.data),
  // finding #13：上架/下架独立动作（isActive 从随保存字段解耦）。
  publishPlan: (id: string): Promise<unknown> =>
    api.post(`/admin/coding-plan/plans/${id}/publish`).then((r) => r.data.data),
  unpublishPlan: (id: string): Promise<unknown> =>
    api.post(`/admin/coding-plan/plans/${id}/unpublish`).then((r) => r.data.data),
  createResalePlan: (data: CodingPlanResalePlanWriteInput): Promise<CodingPlanPlanWriteResult> =>
    api.post('/admin/coding-plan/resale-plans', data).then((r) => r.data.data),
  updateResalePlan: (id: string, data: CodingPlanResalePlanWriteInput): Promise<CodingPlanPlanWriteResult> =>
    api.put(`/admin/coding-plan/resale-plans/${encodeURIComponent(id)}`, data).then((r) => r.data.data),
  providerEntitlements: (params?: {
    status?: string;
    providerLineId?: string;
    providerLineCode?: string;
    userId?: string;
    tenantId?: string;
    orderId?: string;
    take?: number;
  }): Promise<CodingPlanProviderEntitlement[]> =>
    api.get('/admin/coding-plan/provider-entitlements', { params }).then((r) => r.data.data),
  retryProviderEntitlement: (id: string): Promise<unknown> =>
    api.post(`/admin/coding-plan/provider-entitlements/${encodeURIComponent(id)}/retry`).then((r) => r.data.data),
  providerLines: (): Promise<CodingPlanProviderLine[]> =>
    api.get('/admin/coding-plan/provider-lines').then((r) => r.data.data),
  createProviderLine: (data: Record<string, unknown>): Promise<CodingPlanProviderLine> =>
    api.post('/admin/coding-plan/provider-lines', data).then((r) => r.data.data),
  updateProviderLine: (id: string, data: Record<string, unknown>): Promise<CodingPlanProviderLine> =>
    api.put(`/admin/coding-plan/provider-lines/${encodeURIComponent(id)}`, data).then((r) => r.data.data),
  deleteProviderLine: (id: string): Promise<{ deleted: boolean; id: string }> =>
    api.delete(`/admin/coding-plan/provider-lines/${encodeURIComponent(id)}`).then((r) => r.data.data),
  testProviderLine: (id: string): Promise<Record<string, unknown>> =>
    api.post(`/admin/coding-plan/provider-lines/${encodeURIComponent(id)}/test`).then((r) => r.data.data),
  syncProviderProducts: (id: string): Promise<Record<string, unknown>> =>
    api.post(`/admin/coding-plan/provider-lines/${encodeURIComponent(id)}/sync-products`).then((r) => r.data.data),
  providerProducts: (params?: { providerLineId?: string }): Promise<CodingPlanProviderProduct[]> =>
    api.get('/admin/coding-plan/provider-products', { params }).then((r) => normalizeList<CodingPlanProviderProduct>(r.data.data)),
  resaleRoutes: (params?: { planId?: string; providerLineId?: string }): Promise<CodingPlanResaleRoute[]> =>
    api.get('/admin/coding-plan/resale-routes', { params }).then((r) => normalizeList<CodingPlanResaleRoute>(r.data.data)),
};

export const planApi = {
  list: () => api.get('/admin/plans').then((r) => r.data.data),
  getById: (id: string) => api.get(`/admin/plans/${id}`).then((r) => r.data.data),
  create: (data: CreatePlanInput) =>
    api.post('/admin/plans', data).then((r) => r.data.data),
  update: (id: string, data: UpdatePlanInput) =>
    api.post(`/admin/plans/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<{ deleted: boolean; id: string }> =>
    api.delete(`/admin/plans/${id}`).then((r) => r.data.data),

  // 套餐多币种价格（plan_prices）
  listPrices: (planId: string) =>
    api.get(`/admin/plans/${planId}/prices`).then((r) => r.data.data),
  upsertPrice: (
    planId: string,
    currency: string,
    data: { monthlyPrice: number; quarterlyPrice: number; yearlyPrice: number; isActive?: boolean },
  ) =>
    api
      .put(`/admin/plans/${planId}/prices/${currency}`, data)
      .then((r) => r.data.data),
  deletePrice: (planId: string, currency: string) =>
    api.delete(`/admin/plans/${planId}/prices/${currency}`).then((r) => r.data.data),
};

// 新促销活动系统
export const campaignApi = {
  list: (params?: { planId?: string; productId?: string; isActive?: boolean }) =>
    api.get('/admin/campaigns', { params }).then((r) => r.data.data),
  getById: (id: string) => api.get(`/admin/campaigns/${id}`).then((r) => r.data.data),
  stats: (id: string) => api.get(`/admin/campaigns/${id}/stats`).then((r) => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/admin/campaigns', data).then((r) => r.data.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/campaigns/${id}`, data).then((r) => r.data.data),
  disable: (id: string) => api.delete(`/admin/campaigns/${id}`).then((r) => r.data.data),
};

export const discountCodeApi = {
  list: (params?: { isActive?: boolean }) =>
    api.get('/admin/discount-codes', { params }).then((r) => r.data.data),
  getById: (id: string) => api.get(`/admin/discount-codes/${id}`).then((r) => r.data.data),
  stats: (id: string) => api.get(`/admin/discount-codes/${id}/stats`).then((r) => r.data.data),
  create: (data: Record<string, unknown>) => api.post('/admin/discount-codes', data).then((r) => r.data.data),
  update: (id: string, data: Record<string, unknown>) =>
    api.put(`/admin/discount-codes/${id}`, data).then((r) => r.data.data),
  disable: (id: string) => api.delete(`/admin/discount-codes/${id}`).then((r) => r.data.data),
};

export const auditLogApi = {
  list: (params?: { page?: number; pageSize?: number; action?: string; resource?: string; search?: string }) =>
    api.get('/admin/audit-logs', { params }).then((r) => r.data.data),
};

export const sessionApi = {
  stats: () => api.get('/admin/sessions/stats').then((r) => r.data.data),
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get('/admin/sessions', { params }).then((r) => r.data.data),
  listAll: <T = unknown>(): Promise<T[]> =>
    listAllPages<T>((page, pageSize) => sessionApi.list({ page, pageSize })),
};

export const monitoringApi = {
  channelHealth: () =>
    api.get('/admin/monitoring/channel-health').then((r) => r.data.data),
  alertList: () =>
    api.get('/admin/monitoring/alerts').then((r) => r.data.data),
  alertCreate: (data: CreateAlertInput) =>
    api.post('/admin/monitoring/alerts', data).then((r) => r.data.data),
  alertUpdate: (id: string, data: UpdateAlertInput) =>
    api.put(`/admin/monitoring/alerts/${id}`, data).then((r) => r.data.data),
  alertDelete: (id: string) =>
    api.delete(`/admin/monitoring/alerts/${id}`).then((r) => r.data.data),
};

export interface AgentObservabilityBreakdownItem {
  key: string;
  count: number;
  rate: number;
}

export interface AgentObservabilityRecentFailure {
  runId: string;
  projectId: string;
  projectName?: string | null;
  sessionId?: string | null;
  agentKind?: string | null;
  status: string;
  stopReason?: string | null;
  errorMessage?: string | null;
  harnessVariantId?: string | null;
  toolErrorsTotal: number;
  topErrorCode?: string | null;
  failureCode?: string | null;
  failureCategory?: string | null;
  failureBlame?: string | null;
  failureMessage?: string | null;
  createdAt?: string | null;
  completedAt?: string | null;
}

export interface AgentObservabilitySummary {
  unavailable?: boolean;
  reason?: string;
  message?: string;
  window: {
    days: number;
    from: string | null;
    to: string | null;
    sampleLimit: number;
  };
  kpis: {
    totalRuns: number;
    failedRuns: number;
    needsAttentionRuns: number;
    failedOrNeedsAttentionRuns: number;
    noProgressRuns: number;
    timeoutRuns: number;
    iabRelatedRuns: number;
    subagentTasks: number;
    subagentFailedTasks: number;
    toolErrors: number;
    toolErrorsFromRuns: number;
    toolUsageErrors: number;
    retryableToolErrors: number;
    timeoutToolErrors: number;
    iabToolErrors: number;
    continuationJobs?: number;
    continuationDeadLetters?: number;
    continuationRunningJobs?: number;
  };
  rates: {
    failureRate: number;
    noProgressRate: number;
    timeoutRate: number;
    iabRelatedRate: number;
    subagentFailureRate: number;
  };
  breakdowns: {
    statuses: AgentObservabilityBreakdownItem[];
    stopReasons: AgentObservabilityBreakdownItem[];
    agentKinds: AgentObservabilityBreakdownItem[];
    harnessVariants: AgentObservabilityBreakdownItem[];
    toolErrorCodes: AgentObservabilityBreakdownItem[];
    toolErrorCategories: AgentObservabilityBreakdownItem[];
    toolErrorBlame: AgentObservabilityBreakdownItem[];
    toolErrorTools: AgentObservabilityBreakdownItem[];
    failureReasons?: AgentObservabilityBreakdownItem[];
    failureCategories?: AgentObservabilityBreakdownItem[];
    failureBlame?: AgentObservabilityBreakdownItem[];
    subagentStatuses: AgentObservabilityBreakdownItem[];
    subagentProfiles: AgentObservabilityBreakdownItem[];
    subagentErrorCodes?: AgentObservabilityBreakdownItem[];
    continuationStatuses?: AgentObservabilityBreakdownItem[];
    continuationErrorCodes?: AgentObservabilityBreakdownItem[];
  };
  recentFailures: AgentObservabilityRecentFailure[];
  subagents: {
    total: number;
    failed: number;
    running: number;
    pending: number;
  };
  continuations?: {
    total: number;
    deadLetter: number;
    running: number;
    queued: number;
  };
}

export const agentObservabilityApi = {
  summary: (params?: { days?: number; recentLimit?: number }): Promise<AgentObservabilitySummary> =>
    api.get('/admin/agent-observability', { params }).then((r) => r.data.data),
};

export const announcementApi = {
  list: (params?: { page?: number; pageSize?: number }) =>
    api.get('/admin/announcements', { params }).then((r) => r.data.data),
  listAll: <T = unknown>(): Promise<T[]> =>
    listAllPages<T>((page, pageSize) => announcementApi.list({ page, pageSize })),
  create: (data: CreateAnnouncementInput) =>
    api.post('/admin/announcements', data).then((r) => r.data.data),
  update: (id: string, data: UpdateAnnouncementInput) =>
    api.put(`/admin/announcements/${id}`, data).then((r) => r.data.data),
  toggle: (id: string) =>
    api.put(`/admin/announcements/${id}/toggle`).then((r) => r.data.data),
  delete: (id: string) =>
    api.delete(`/admin/announcements/${id}`).then((r) => r.data.data),
};

export const featureFlagApi = {
  list: () => api.get('/admin/feature-flags').then((r) => r.data.data),
  upsert: (data: UpsertFeatureFlagInput) =>
    api.post('/admin/feature-flags', data).then((r) => r.data.data),
};

export const systemPromptApi = {
  list: () => api.get('/admin/system-prompts').then((r) => r.data.data),
  upsert: (data: UpsertSystemPromptInput) =>
    api.post('/admin/system-prompts', data).then((r) => r.data.data),
};

export const systemConfigApi = {
  get: () => api.get('/admin/system-config').then((r) => r.data.data),
  // system-config is an open k/v store; backend accepts Record<string, unknown>
  update: (data: Record<string, unknown>) =>
    api.put('/admin/system-config', data).then((r) => r.data.data),
};

export const platformConfigApi = {
  get: () => api.get('/admin/platform-config').then((r) => r.data.data),
};

// 滚动配额 gate 运行时开关（自营套餐配额执行）。enabled=null 置空继承环境变量。
export interface RollingQuotaGateState {
  effectiveEnabled: boolean;
  envForced: boolean;
  adminEnabled: boolean | null;
}
export const rollingQuotaGateApi = {
  get: (): Promise<RollingQuotaGateState> =>
    api.get('/admin/rolling-quota-gate').then((r) => r.data.data),
  set: (enabled: boolean | null): Promise<RollingQuotaGateState> =>
    api.put('/admin/rolling-quota-gate', { enabled }).then((r) => r.data.data),
};

// R3b 月度补发（自营套餐按月补发/清欠）运行时开关。结构同滚动 gate。
export const codingPlanMonthlyRefreshApi = {
  get: (): Promise<RollingQuotaGateState> =>
    api.get('/admin/coding-plan-monthly-refresh').then((r) => r.data.data),
  set: (enabled: boolean | null): Promise<RollingQuotaGateState> =>
    api.put('/admin/coding-plan-monthly-refresh', { enabled }).then((r) => r.data.data),
};

// R6 自营积分终态负额结算 运行时开关。billing 侧硬门禁：月度补发未生效时拒绝开启。
export interface SelfopNegativeDeductState extends RollingQuotaGateState {
  /** 网关终态结算 env（BILLING_GATEWAY_USAGE_ALLOW_NEGATIVE_BALANCE）——R6 生效的另一前提，仅诊断展示。 */
  gatewayNegativeEnv?: boolean;
}
export const selfopNegativeDeductApi = {
  get: (): Promise<SelfopNegativeDeductState> =>
    api.get('/admin/selfop-negative-deduct').then((r) => r.data.data),
  set: (enabled: boolean | null): Promise<SelfopNegativeDeductState> =>
    api.put('/admin/selfop-negative-deduct', { enabled }).then((r) => r.data.data),
};

export interface ModelPricingUpsertInput {
  modelName: string;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  isActive?: boolean;
  // v2 catalog fields (PR4)
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
  priceTiers?: ModelPricingTierInput[] | null;
  defaultThinkingMode?: string | null;
  defaultThinkingBudget?: number | null;
}

export interface BandScheduleWindow {
  /** 1=周一 … 7=周日 */
  days: number[];
  start: string;
  end: string;
}

export interface ModelPricingTierInput {
  tierKey: string;
  displayName?: string | null;
  minInputTokens?: number | null;
  maxInputTokensExclusive?: number | null;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPrice?: number | null;
  cacheWritePrice?: number | null;
  /** OFF_PEAK 时段档必填：高峰窗口（其余时间=空闲），Asia/Shanghai，左闭右开 */
  bandSchedule?: BandScheduleWindow[] | null;
  currency?: string | null;
  rawCondition?: string | null;
  source?: string | null;
  priority?: number | null;
  isActive?: boolean;
}

export const modelPricingApi = {
  list: () => api.get('/admin/model-pricing').then((r) => r.data.data),
  upsert: (data: ModelPricingUpsertInput) =>
    api.post('/admin/model-pricing', data).then((r) => r.data.data),
  sync: () => api.post('/admin/model-pricing/sync').then((r) => r.data.data),
  deactivateOrphans: (confirm: boolean) =>
    api
      .post('/admin/model-pricing/deactivate-orphans', { confirm })
      .then((r) => r.data.data),
  /** 物理删除：从 model_pricing 表彻底删行，被套餐引用时会拒绝并返回错误 */
  remove: (modelName: string) =>
    api
      .delete(`/admin/model-pricing/${encodeURIComponent(modelName)}`)
      .then((r) => r.data.data),
};

export interface PaygModelPricingItem {
  modelName: string;
  provider?: string | null;
  isPublished?: boolean;
  modelActive?: boolean;
  availability?: {
    id: string;
    status: 'ACTIVE' | 'SUSPENDED' | 'RETIRED' | string;
    apiEnabled: boolean;
    visible: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    displayOrder: number;
    reason?: string | null;
    active: boolean;
    createdAt?: string;
    updatedAt?: string;
  };
  base: {
    input: number;
    cached: number | null;
    cacheWrite: number | null;
    output: number;
  };
  policy: PaygModelPricingPolicySnapshot | null;
  policies?: PaygModelPricingPolicySnapshot[];
  /**
   * 后备档（默认）生效价。历史脏数据（仍带已废除的绝对覆盖价）时后端置 null
   * 并带 pricingReason=LEGACY_OVERRIDE_DETECTED —— 不得按倍率伪造展示价。
   */
  effective: {
    input: number;
    cached: number;
    cacheWrite: number;
    output: number;
  } | null;
  pricingReason?: string | null;
  /**
   * 分档价格。与「企业模型专属折扣」**同一形状**，前端两页共用 ModelTierPrices 渲染。
   * 显式档在前、后备档在后，顺序即定价服务的选档顺序。
   * ⚠️ 脏数据（仍带已废除的绝对覆盖价）时后端置 tiers=[] 且 fallbackPricing=null —— 不得按倍率伪造档价。
   */
  tiers?: Array<{
    tierKey: string;
    displayName?: string | null;
    minInputTokens: number;
    maxInputTokensExclusive?: number | null;
    priority?: number | null;
    base: { input: number; cached: number | null; cacheWrite: number | null; output: number };
    effective: { input: number; cached: number | null; cacheWrite: number | null; output: number };
  }> | null;
  fallbackPricing?: {
    default: {
      base: { input: number; cached: number | null; cacheWrite: number | null; output: number };
      effective: { input: number; cached: number | null; cacheWrite: number | null; output: number };
    };
    longContext: null | {
      minInputTokens: number;
      base: { input: number; cached: number | null; cacheWrite: number | null; output: number };
      effective: { input: number; cached: number | null; cacheWrite: number | null; output: number };
    };
  } | null;
  /** OFF_PEAK 时段档的生效价与窗口（既有字段，供时段角标等使用）。 */
  offPeakEffective?: { input: number; cached: number; cacheWrite: number; output: number } | null;
  offPeakSchedule?: unknown;
}

export interface PaygModelCandidateItem {
  modelName: string;
  provider?: string | null;
  isPublished?: boolean;
  displayOrder?: number;
  previouslyRemoved?: boolean;
  base: {
    input: number;
    cached: number | null;
    cacheWrite: number | null;
    output: number;
  };
}

export interface PaygModelPricingPolicySnapshot {
  id: string;
  priceMultiplier: number;
  input: number | null;
  cached: number | null;
  cacheWrite: number | null;
  output: number | null;
  startsAt: string;
  endsAt?: string | null;
  isActive: boolean;
  description?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface PaygModelPricingVersionInput {
  productId: string;
  modelName: string;
  priceMultiplier: number;
  // 绝对覆盖价（inputPricePerMToken/cachedInputPrice/cacheWritePrice/outputPricePerMToken）
  // 已废除：不再作为写入参数，后端对非 null 值返回 400。
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  description?: string | null;
}

export interface UsagePricingPolicy {
  id: string;
  productId: string;
  scope: 'GLOBAL' | 'SEGMENT' | 'USER';
  userId?: string | null;
  segmentId?: string | null;
  modelName?: string | null;
  priceMultiplier: string;
  creditMultiplier?: string | null;
  priority: number;
  description: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  user?: { id: string; email?: string | null; nickname?: string | null } | null;
  segment?: { id: string; name: string } | null;
}

export interface UsagePricingPolicyInput {
  productId: string;
  scope: 'GLOBAL' | 'SEGMENT' | 'USER';
  userId?: string | null;
  userEmail?: string | null;
  segmentId?: string | null;
  modelName?: string | null;
  priceMultiplier?: number;
  creditMultiplier?: number | null;
  priority?: number;
  description?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
}

export interface ProviderCostPolicy {
  id: string;
  productId?: string | null;
  providerCode: string;
  providerLineId?: string | null;
  modelName: string;
  priceMultiplier: string;
  inputCostUsdPerM?: string | null;
  cachedInputCostUsdPerM?: string | null;
  cacheWriteCostUsdPerM?: string | null;
  outputCostUsdPerM?: string | null;
  startsAt: string;
  endsAt?: string | null;
  priority: number;
  isActive: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
  product?: { id: string; name: string; slug: string } | null;
  providerLine?: { id: string; code: string; name: string; providerCode: string } | null;
}

export interface ProviderCostPolicyInput {
  productId?: string | null;
  providerCode: string;
  providerLineId?: string | null;
  modelName: string;
  priceMultiplier?: number;
  inputCostUsdPerM?: number | null;
  cachedInputCostUsdPerM?: number | null;
  cacheWriteCostUsdPerM?: number | null;
  outputCostUsdPerM?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  isActive?: boolean;
  description?: string | null;
}

export const paygModelPricingApi = {
  list: (productId: string): Promise<{
    product: { id: string; name: string; slug: string; billingMode: string; isActive: boolean };
    items: PaygModelPricingItem[];
  }> => api.get('/admin/payg-model-pricing', { params: { productId } }).then((r) => r.data.data),
  candidates: (productId: string): Promise<{
    product: { id: string; name: string; slug: string; billingMode: string; isActive: boolean };
    items: PaygModelCandidateItem[];
  }> => api
    .get('/admin/payg-product-model-candidates', { params: { productId } })
    .then((r) => r.data.data),
  addModels: (data: {
    productId: string;
    modelNames: string[];
    apiEnabled?: boolean;
    visible?: boolean;
    status?: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
    reason?: string | null;
  }) => api.post('/admin/payg-product-models', data).then((r) => r.data.data),
  updateProductModel: (id: string, data: {
    status?: 'ACTIVE' | 'SUSPENDED' | 'RETIRED';
    apiEnabled?: boolean;
    visible?: boolean;
    startsAt?: string | null;
    endsAt?: string | null;
    displayOrder?: number | null;
    reason?: string | null;
  }) => api.put(`/admin/payg-product-models/${encodeURIComponent(id)}`, data).then((r) => r.data.data),
  retireProductModel: (id: string) =>
    api.delete(`/admin/payg-product-models/${encodeURIComponent(id)}`).then((r) => r.data.data),
  createVersion: (data: PaygModelPricingVersionInput) =>
    api.post('/admin/payg-model-pricing', data).then((r) => r.data.data),
  deactivate: (id: string) =>
    api.delete(`/admin/payg-model-pricing/${encodeURIComponent(id)}`).then((r) => r.data.data),
};

export const usagePricingPolicyApi = {
  list: (productId?: string): Promise<UsagePricingPolicy[]> =>
    api.get('/admin/usage-pricing-policies', { params: { productId } }).then((r) => r.data.data),
  create: (data: UsagePricingPolicyInput): Promise<UsagePricingPolicy> =>
    api.post('/admin/usage-pricing-policies', data).then((r) => r.data.data),
  update: (id: string, data: Partial<UsagePricingPolicyInput>): Promise<UsagePricingPolicy> =>
    api.put(`/admin/usage-pricing-policies/${id}`, data).then((r) => r.data.data),
  delete: (id: string): Promise<null> =>
    api.delete(`/admin/usage-pricing-policies/${id}`).then((r) => r.data.data),
};

export const providerCostPolicyApi = {
  list: (params?: {
    productId?: string;
    providerCode?: string;
    providerLineId?: string;
    modelName?: string;
    effectiveAt?: string;
    activeOnly?: boolean;
  }): Promise<ProviderCostPolicy[]> =>
    api.get('/admin/provider-cost-policies', { params }).then((r) => r.data.data),
  create: (data: ProviderCostPolicyInput): Promise<ProviderCostPolicy> =>
    api.post('/admin/provider-cost-policies', data).then((r) => r.data.data),
  deactivate: (id: string): Promise<ProviderCostPolicy> =>
    api.delete(`/admin/provider-cost-policies/${encodeURIComponent(id)}`).then((r) => r.data.data),
  delete: (id: string): Promise<ProviderCostPolicy> =>
    api.delete(`/admin/provider-cost-policies/${encodeURIComponent(id)}/hard`).then((r) => r.data.data),
};

export const modelAccessApi = {
  list: () => api.get('/admin/model-access').then((r) => r.data.data),
  batchUpdate: (data: ModelAccessItemInput[]) =>
    api.post('/admin/model-access/batch', { items: data }).then((r) => r.data.data),
};

export const modelRoutePolicyApi = {
  list: () => api.get('/admin/model-route-policies').then((r) => r.data.data),
  batchUpdate: (data: ModelRoutePolicyItemInput[]) =>
    api.post('/admin/model-route-policies/batch', { items: data }).then((r) => r.data.data),
};

export const paymentInstanceApi = {
  list: () => api.get('/admin/payment-instances').then((r) => r.data.data),
  // payment-instance config shape varies by provider; backend accepts Record<string, unknown>
  create: (data: Record<string, unknown>) => api.post('/admin/payment-instances', data).then((r) => r.data.data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/admin/payment-instances/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => api.delete(`/admin/payment-instances/${id}`).then((r) => r.data.data),
};

export const revenueApi = {
  overview: (params?: { days?: number }) =>
    api.get('/admin/revenue/overview', { params }).then((r) => r.data.data),
};

export const financeReportsApi = {
  get: (params?: { month?: string }) =>
    api.get('/admin/finance-reports', { params }).then((r) => r.data.data),
  dashboard: (params?: { month?: string }) =>
    api.get('/admin/finance-reports/dashboard', { params }).then((r) => r.data.data),
  overview: (params?: { month?: string; billingMode?: string; refresh?: boolean }) =>
    api.get('/admin/finance-reports/overview', { params }).then((r) => r.data.data),
  detail: (params?: {
    month?: string;
    tab?: string;
    billingMode?: string;
    pageSize?: number;
    cursor?: string;
    filterField?: string;
    filterValue?: string;
  }) =>
    api.get('/admin/finance-reports/details', { params }).then((r) => r.data.data),
  createExportJob: (data: { month: string; tab: string; billingMode?: string }) =>
    api.post('/admin/finance-reports/export-jobs', data).then((r) => r.data.data),
  listExportJobs: (params?: { take?: number }, config?: AxiosRequestConfig) =>
    api.get('/admin/finance-reports/export-jobs', { ...config, params }).then((r) => r.data.data),
  getExportJob: (id: string) =>
    api.get(`/admin/finance-reports/export-jobs/${encodeURIComponent(id)}`).then((r) => r.data.data),
  downloadExportJob: (id: string) =>
    api.get(`/admin/finance-reports/export-jobs/${encodeURIComponent(id)}/download`, { responseType: 'blob' }),
  backfillStripeLedger: (data: { month?: string; limit?: number; dryRun?: boolean }) =>
    api.post('/admin/finance-reports/stripe-ledger/backfill', data).then((r) => r.data.data),
  backfillProviderCosts: (data: { month: string; limit?: number; dryRun?: boolean }) =>
    api.post('/admin/provider-cost-policies/backfill-token-usage', data).then((r) => r.data.data),
};

export const adminRoleApi = {
  list: () => api.get('/admin/roles').then((r) => r.data.data),
  getById: (id: string) => api.get(`/admin/roles/${id}`).then((r) => r.data.data),
  create: (data: CreateAdminRoleInput) => api.post('/admin/roles', data).then((r) => r.data.data),
  update: (id: string, data: UpdateAdminRoleInput) => api.put(`/admin/roles/${id}`, data).then((r) => r.data.data),
  delete: (id: string) => api.delete(`/admin/roles/${id}`).then((r) => r.data.data),
};

export const adminMemberApi = {
  list: () => api.get('/admin/members').then((r) => r.data.data),
  invite: (data: InviteAdminMemberInput) =>
    api.post('/admin/members/invite', data).then((r) => r.data.data),
  update: (id: string, data: UpdateAdminMemberInput) =>
    api.put(`/admin/members/${id}`, data).then((r) => r.data.data),
  remove: (id: string) =>
    api.delete(`/admin/members/${id}`).then((r) => r.data.data),
  forceLogout: (id: string) =>
    api.post(`/admin/members/${id}/force-logout`).then((r) => r.data.data),
  resetPassword: (id: string) =>
    api.post(`/admin/members/${id}/reset-password`).then((r) => r.data.data),
};

export const userManageApi = {
  search: (params?: { search?: string; status?: string; role?: string; provider?: string; page?: number; pageSize?: number }) =>
    api.get('/admin/users/search', { params }).then((r) => r.data.data),
  overview: (id: string) =>
    api.get(`/admin/users/${id}/overview`).then((r) => r.data.data),
  subscriptions: (id: string) =>
    api.get(`/admin/users/${id}/subscriptions`).then((r) => r.data.data),
  apiKeys: (id: string) =>
    api.get(`/admin/users/${id}/api-keys`).then((r) => r.data.data),
  auditLogs: (id: string, params?: { page?: number; pageSize?: number }) =>
    api.get(`/admin/users/${id}/audit-logs`, { params }).then((r) => r.data.data),
  create: (data: { email: string; nickname?: string; role?: string }) =>
    api.post('/admin/users', data).then((r) => r.data.data),
  update: (id: string, data: UpdateUserInput) =>
    api.put(`/admin/users/${id}`, data).then((r) => r.data.data),
  resetPassword: (id: string) =>
    api.post(`/admin/users/${id}/reset-password`).then((r) => r.data.data),
  ban: (id: string, reason: string) =>
    api.post(`/admin/users/${id}/ban`, { reason }).then((r) => r.data.data),
  unban: (id: string) =>
    api.post(`/admin/users/${id}/unban`).then((r) => r.data.data),
};

export const authApi = {
  login: (email: string, password: string) =>
    api.post('/admin/auth/login', { email, password }).then((r) => r.data.data),
  logout: () => api.post('/admin/auth/logout'),
  profile: () => api.get('/admin/auth/profile').then((r) => r.data.data),
};
