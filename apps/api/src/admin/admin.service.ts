import { Injectable, BadRequestException, ConflictException, ForbiddenException, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { AdminRepository } from './admin.repository';
import { AdminActivityLogService } from './admin-activity-log.service';
import {
  BillingInternalClient,
  type BalanceAdjustmentReasonCode,
  type CodingPlanProviderEntitlementFilters,
  type PaygProductModelRequest,
  type PaygProductModelUpdateRequest,
  type ProviderCostPolicyRequest,
  type ProductRouteAssignmentFilters,
  type GatewayBillingEventActionRequest,
  type GatewayBillingEventAbsorbRequest,
  type GatewayBillingEventSettlementRequest,
  type HistoricalPlatformLossPreviewRequest,
  type HistoricalPlatformLossCreateRequest,
  type HistoricalPlatformLossApproveRequest,
} from '../billing/billing-internal.client';
import { UserInternalClient } from '../user/user-internal.client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { scopedRedisKey } from '../common/utils/redis-key';
import {
  authProviderForRegion,
  expandAdminPermissions,
  resolveAdminPermissions,
  BCRYPT_SALT_ROUNDS,
  REFRESH_TOKEN_EXPIRY,
  type DeploymentConfigSnapshot,
  type DeploymentLanguage,
  type DeploymentOAuthPublicConfig,
  type DeploymentRegion,
} from '@ruidong/shared';
import type { AdminPresetRole, AdminPermissionAtom } from '@ruidong/shared';
import {
  DeploymentConfigSyncService,
  snapshotFromRow,
  type DeploymentConfigSyncStatus,
} from './deployment-config-sync.service';

type PublisherReplayScope =
  | 'all'
  | 'api_keys'
  | 'key_balances'
  | 'admin'
  | 'platform';

function compactRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed) result[key] = trimmed;
      continue;
    }
    if (raw !== undefined && raw !== null) result[key] = raw;
  }
  return result;
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function regionForProvider(value: unknown): DeploymentRegion | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'authing') return 'domestic';
  if (normalized === 'auth0') return 'overseas';
  return undefined;
}

function normalizeStorageProvider(value: unknown): 's3' | 'aliyun_oss' | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 's3' || normalized === 'aws_s3' || normalized === 'aws-s3') return 's3';
  if (normalized === 'aliyun_oss' || normalized === 'aliyun-oss' || normalized === 'oss') {
    return 'aliyun_oss';
  }
  throw new BadRequestException('对象存储 provider 必须是 s3 或 aliyun_oss');
}

function inferStorageProvider(config: Record<string, unknown>): 'aliyun_oss' | undefined {
  return firstConfigString(config, ['ossEndpoint', 'invoiceOssEndpoint']) ? 'aliyun_oss' : undefined;
}

function firstConfigString(config: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = config[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function stripInactiveStorageProviderFields(config: Record<string, unknown>) {
  const provider = firstConfigString(config, ['provider']);
  if (provider === 'aliyun_oss') {
    delete config.s3Endpoint;
    delete config.invoiceS3Endpoint;
    delete config.s3ForcePathStyle;
    delete config.invoiceS3ForcePathStyle;
    delete config.forcePathStyle;
    return;
  }
  if (provider === 's3') {
    delete config.ossEndpoint;
    delete config.invoiceOssEndpoint;
  }
}

function stripDeploymentStorageFields(config: Record<string, unknown>) {
  delete config.bucket;
  delete config.s3Bucket;
  delete config.invoiceS3Bucket;
  delete config.region;
  delete config.s3Region;
  delete config.invoiceS3Region;
}

interface CodingPlanProductSnapshot {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  billingMode?: string | null;
  codingPlanFulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
  fulfillmentMode?: 'platform_model_package' | 'provider_resale' | null;
  isActive?: boolean;
  defaultPlanId?: string | null;
  integrationTokenPrefix?: string | null;
  webhookSecretPrefix?: string | null;
  sortOrder?: number | null;
  createdAt?: string | Date | null;
}

interface CodingPlanPlanSnapshot {
  id: string;
  productId?: string | null;
  name: string;
  description?: string | null;
  planType?: string | null;
  billingPeriod?: string | null;
  monthlyPrice?: number | null;
  quarterlyPrice?: number | null;
  yearlyPrice?: number | null;
  monthlyCredits?: number | null;
  validityDays?: number | null;
  rateLimitRpm?: number | null;
  rateLimitTpm?: number | null;
  maxContextWindow?: number | null;
  memberLimit?: number | null;
  maxSellableQuantity?: number | null;
  usageMultiplier?: number | null;
  badge?: string | null;
  trialDays?: number | null;
  features?: string[] | string | null;
  isActive?: boolean;
  isLegacy?: boolean;
  salesLimit?: number | null;
  reservedSalesCount?: number | null;
  remainingSales?: number | null;
  soldOut?: boolean | null;
  sortOrder?: number | null;
}

interface CodingPlanResaleRouteSnapshot {
  id: string;
  planId: string;
  providerLineId: string;
  upstreamProductId: string;
  enabled?: boolean;
  priority?: number | null;
  providerLine?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
  } | null;
}

interface CodingPlanModelAccessWriteInput {
  modelName?: string;
  model?: string;
  isActive?: boolean;
  creditMultiplier?: number;
}

interface CodingPlanModelRoutePolicyWriteInput {
  routeKey?: string;
  primaryModel?: string | null;
  fallbackModels?: string[];
  isActive?: boolean;
}

interface CodingPlanPlanWriteInput {
  id?: string;
  productId?: string | null;
  name?: string;
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
  fulfillmentMode?: CodingPlanFulfillmentMode;
  platformPackage?: {
    modelAccess?: CodingPlanModelAccessWriteInput[];
    routePolicies?: CodingPlanModelRoutePolicyWriteInput[];
    quotaTemplateIds?: string[];
  } | null;
}

interface CodingPlanModelRoutePolicySnapshot {
  planId?: string | null;
  routeKey?: string | null;
  primaryModel?: string | null;
  fallbackModels?: string[] | string | null;
  isActive?: boolean;
}

interface CodingPlanIntegrationSnapshot {
  credentials?: {
    hasIntegrationToken?: boolean;
    integrationTokenPrefix?: string | null;
    hasWebhookSecret?: boolean;
    webhookSecretPrefix?: string | null;
  };
  requirements?: {
    requiresDefaultPlan?: boolean;
    requiresWebhookUrl?: boolean;
    apiKeyDefaultBinding?: boolean;
  };
  virtualKey?: {
    name?: string;
    activeCount?: number;
    totalCount?: number;
  };
  checklist?: Record<string, boolean>;
}

interface CodingPlanModelAccessSnapshot {
  planId?: string | null;
  modelName?: string | null;
  model?: string | null;
  isActive?: boolean;
  creditMultiplier?: number | null;
}

interface CodingPlanQuotaRuleSnapshot {
  windowType?: string;
  durationLabel?: string;
  durationSec?: number;
  metric?: string;
  limitValue?: number;
  modelGroupId?: string | null;
}

interface CodingPlanQuotaTemplateSnapshot {
  id: string;
  name: string;
  description?: string | null;
  rules?: CodingPlanQuotaRuleSnapshot[];
  referencedPlanIds?: string[];
  isActive?: boolean;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
}

type CodingPlanFulfillmentMode = 'platform_model_package' | 'provider_resale';

const CODING_PLAN_PROVIDER_CREDENTIAL_CONFIG_KEY = 'codingPlanProviderCredentials';
const CODING_PLAN_WRITE_SNAPSHOT_LABELS = {
  modelAccess: '模型授权',
  modelRoutePolicies: '模型路由策略',
  quotaTemplates: '配额模板',
} as const;
const BILLING_PAGE_SIZE_MAX = 100;

type DashboardTrendPeriod = 'sevenDays' | 'month' | 'year';

interface DashboardTrendPoint {
  date: string;
  value: number;
}

interface DashboardUserStats {
  totalUsers?: number;
  todayNewUsers?: number;
  trends?: Partial<Record<DashboardTrendPeriod, DashboardTrendPoint[]>>;
  generatedAt?: string;
}

interface DashboardRevenueSummary {
  totalRechargeCents?: number;
  totalRevenueCents?: number;
  todayRechargeCents?: number;
}

interface DashboardRevenueDailyRow {
  date?: string | Date;
  recharge?: number;
  rechargeCents?: number;
  value?: number;
}

interface DashboardRevenueOverview {
  daily?: DashboardRevenueDailyRow[];
  totalRechargeCents?: number;
}

interface DashboardProductSnapshot {
  id?: string;
  name?: string | null;
  slug?: string | null;
  billingMode?: string | null;
  isActive?: boolean | null;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function startOfDay(value: Date): Date {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(value: Date): Date {
  return new Date(value.getFullYear(), value.getMonth(), 1);
}

function startOfYear(value: Date): Date {
  return new Date(value.getFullYear(), 0, 1);
}

function addDays(value: Date, days: number): Date {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(value: Date, months: number): Date {
  return new Date(value.getFullYear(), value.getMonth() + months, 1);
}

function dayKey(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function dayLabel(value: Date): string {
  return `${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

function monthLabel(value: Date): string {
  return `${pad2(value.getMonth() + 1)}月`;
}

function normalizeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function inclusiveDayCount(start: Date, end: Date): number {
  const startDay = startOfDay(start).getTime();
  const endDay = startOfDay(end).getTime();
  return Math.max(1, Math.floor((endDay - startDay) / 86_400_000) + 1);
}

// 可下发给用户门户前端的 OAuth 公开参数白名单（与 codesphere-user 的 oauth-public-keys 保持一致）。
// 仅公开参数；Secret 不在此（留各服务 env，不下发）。
const OAUTH_PUBLIC_KEYS = [
  'auth0Domain',
  'auth0ClientId',
  'auth0DbConnection',
  'authingAppHost',
  'authingAppId',
  'authingWechatConnection',
] as const;

type PlatformConfig = {
  region: DeploymentRegion;
  currency: string;
  defaultLanguage?: DeploymentLanguage;
};

interface CodingPlanFulfillmentSnapshot {
  fulfillmentMode: CodingPlanFulfillmentMode;
  providerLineId: string | null;
  providerLineCode: string | null;
  upstreamProductId: string | null;
}

interface CodingPlanUpstreamProduct {
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

interface CodingPlanProviderProductSnapshot {
  id?: string;
  providerLineId?: string | null;
  upstreamProductId?: string | null;
  productId?: string | null;
  productName?: string | null;
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
  lastSyncedAt?: string | Date | null;
  createdAt?: string | Date | null;
  updatedAt?: string | Date | null;
  providerLine?: {
    id?: string | null;
    code?: string | null;
    name?: string | null;
  } | null;
}

type CodingPlanReadiness =
  | 'ready'
  | 'disabled'
  | 'credential_missing'
  | 'plan_missing'
  | 'no_sellable_plan';

/** 用户详情页「可用金额」卡片（个人账户 + 每个企业账户）。 */
export interface UserAvailableAmountItem {
  billingAccountId: string;
  accountType: string;
  accountName: string;
  currency: string;
  balanceCents: number;
  creditRemainingCents: number;
  availableAmountCents: number;
}

const adminPermissionCacheKey = (adminId: string): string =>
  scopedRedisKey('admin:perms', adminId);
const adminRefreshBlacklistKey = (jti: string): string =>
  scopedRedisKey('bl:admin', jti);
const adminForceLogoutKey = (adminId: string): string =>
  scopedRedisKey('admin:force_logout', adminId);
const ADMIN_ACCESS_TOKEN_EXPIRY = '15m';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);
  private readonly refreshSecret: string;
  private readonly refreshExpiresSeconds: number;

  constructor(
    private readonly repo: AdminRepository,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly activityLog: AdminActivityLogService,
    private readonly userClient: UserInternalClient,
    private readonly billingClient: BillingInternalClient,
    private readonly deploymentSync: DeploymentConfigSyncService,
  ) {
    this.refreshSecret =
      config.getOrThrow<string>('JWT_SECRET') + '_admin_refresh';
    const match = REFRESH_TOKEN_EXPIRY.match(/^(\d+)([smhd])$/);
    const num = match ? parseInt(match[1]) : 7;
    const unit = match ? match[2] : 'd';
    const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
    this.refreshExpiresSeconds = num * (multipliers[unit] || 86400);
  }

  // ============================
  // 管理端认证
  // ============================

  async adminLogin(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('邮箱和密码为必填');
    }

    const member = await this.repo.findAdminMemberForAuth(email);
    if (!member) {
      throw new UnauthorizedException('账号或密码错误');
    }

    if (!member.isActive) {
      throw new UnauthorizedException('账号已被禁用');
    }

    const passwordValid = await bcrypt.compare(password, member.password);
    if (!passwordValid) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const presetRole = member.presetRole;
    const resolvedPermissions = await this.resolvePermissionsForMember(member);
    const tokens = this.generateAdminTokens({ id: member.id, presetRole });

    // 更新 lastLoginAt + 记录活动日志
    this.prisma.adminMember.update({
      where: { id: member.id },
      data: { lastLoginAt: new Date() },
    }).catch((err) => {
      this.logger.warn(
        `admin last_login_at update failed member=${member.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });
    this.activityLog.log({
      adminMemberId: member.id,
      action: 'login.success',
      resource: 'AdminSession',
      resourceId: member.id,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: member.id,
        email: member.email,
        nickname: member.nickname,
        presetRole,
        resolvedPermissions,
      },
    };
  }

  async adminRefresh(refreshToken: string) {
    let payload: { sub: string; adminId: string; jti: string };
    try {
      payload = this.jwtService.verify(refreshToken, {
        secret: this.refreshSecret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token 无效或已过期');
    }

    if (!payload.adminId || !payload.jti) {
      throw new UnauthorizedException('无效的管理端 token');
    }

    // 检查黑名单
    const isBlacklisted = await this.redis.get(adminRefreshBlacklistKey(payload.jti));
    if (isBlacklisted) {
      throw new UnauthorizedException('Refresh token 已失效');
    }

    // 检查是否被强制登出
    const forceLogoutAt = await this.redis.get(adminForceLogoutKey(payload.adminId));
    if (forceLogoutAt) {
      throw new UnauthorizedException('已被强制下线，请重新登录');
    }

    // 将旧 refresh token 加入黑名单（一次性使用）
    await this.redis.set(
      adminRefreshBlacklistKey(payload.jti),
      '1',
      'EX',
      this.refreshExpiresSeconds,
    );

    const member = await this.repo.findAdminMemberById(payload.adminId);
    if (!member || !member.isActive) {
      throw new UnauthorizedException('管理员不存在或已禁用');
    }

    const memberPresetRole = member.presetRole;
    const resolvedPermissions = await this.resolvePermissionsForMember(member);
    const tokens = this.generateAdminTokens({
      id: member.id,
      presetRole: memberPresetRole,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: {
        id: member.id,
        email: member.email,
        nickname: member.nickname,
        presetRole: memberPresetRole,
        resolvedPermissions,
      },
    };
  }

  async getAdminProfile(adminId: string) {
    const member = await this.repo.findAdminMemberById(adminId);
    if (!member) throw new UnauthorizedException('管理员不存在');

    const presetRole = member.presetRole;
    const isActive = member.isActive;
    let overrides: Partial<Record<AdminPermissionAtom, boolean>> = {};
    try { overrides = JSON.parse(member.permissions || '{}'); } catch { /* ignore */ }
    const resolved = await this.resolvePermissionsForMember(member);

    return {
      id: member.id,
      email: member.email,
      nickname: member.nickname,
      presetRole,
      permissions: overrides,
      resolvedPermissions: resolved,
      isActive,
    };
  }

  verifyAdminToken(token: string): { sub: string; adminId: string; presetRole: string } {
    return this.jwtService.verify(token);
  }

  private generateAdminTokens(admin: { id: string; presetRole: string }) {
    const jti = crypto.randomUUID();

    const accessToken = this.jwtService.sign(
      {
        sub: admin.id,
        adminId: admin.id,
        presetRole: admin.presetRole,
      },
      { expiresIn: ADMIN_ACCESS_TOKEN_EXPIRY },
    );

    const refreshToken = this.jwtService.sign(
      { sub: admin.id, adminId: admin.id, jti },
      {
        secret: this.refreshSecret,
        expiresIn: REFRESH_TOKEN_EXPIRY,
      },
    );

    return { accessToken, refreshToken };
  }

  /**
   * 解析管理员成员的最终权限列表。
   * - super_admin 始终使用当前代码定义的全部权限；
   * - 如果成员关联了自定义角色（roleId），从 admin_roles 表读取权限；
   * - 否则 fallback 到 presetRole 预设权限；
   * - 最后叠加成员级 permissions JSON 覆盖。
   */
  private async resolvePermissionsForMember(
    member: { presetRole: string; roleId: string | null; permissions: string },
  ): Promise<string[]> {
    if (member.presetRole === 'super_admin') {
      return resolveAdminPermissions('super_admin');
    }

    let overrides: Partial<Record<AdminPermissionAtom, boolean>> = {};
    try { overrides = JSON.parse(member.permissions || '{}'); } catch { /* ignore */ }

    // 自定义角色：从 admin_roles 表读取权限
    if (member.roleId) {
      const role = await this.prisma.adminRole.findUnique({
        where: { id: member.roleId },
      });
      if (role && role.isActive) {
        let rolePermissions: string[] = [];
        try { rolePermissions = JSON.parse(role.permissions || '[]'); } catch { /* ignore */ }
        return expandAdminPermissions(rolePermissions, overrides);
      }
      // 角色不存在或已禁用，fallback 到 presetRole
    }

    return resolveAdminPermissions(member.presetRole as AdminPresetRole, overrides);
  }

  // ============================
  // 用户管理 — 委派给 user-api 内部接口
  // ============================

  async listUsers(page: number, pageSize: number) {
    return this.userClient.listUsers(page, pageSize);
  }

  async getUser(id: string) {
    return this.userClient.getUser(id);
  }

  async getUserOverview(id: string) {
    // user-api 只提供身份/订阅侧数据；钱包与企业信用在 billing，故此处合并「可用金额」。
    const [overview, availableAmounts] = await Promise.all([
      this.userClient.getUserOverview(id),
      this.billingClient.getOwnerAvailableAmounts(id).catch(() => null),
    ]);
    const items: UserAvailableAmountItem[] = Array.isArray(
      (availableAmounts as { items?: unknown } | null)?.items,
    )
      ? (availableAmounts as { items: UserAvailableAmountItem[] }).items
      : [];
    const personal = items.find((item) => item.accountType !== 'enterprise');
    return {
      ...(overview as Record<string, unknown>),
      // balanceCents 仍表示「钱包余额」：产品账号卡与余额调整弹窗共用该字段，
      // 因此取个人账户钱包余额（不含信用），负数原样保留。
      ...(personal ? { balanceCents: personal.balanceCents } : {}),
      availableAmounts: items,
    };
  }

  async getUserSubscriptions(id: string) {
    return this.userClient.getUserSubscriptions(id);
  }

  async getUserApiKeys(id: string) {
    return this.userClient.getUserApiKeys(id);
  }

  async getUserAuditLogs(id: string, page: number, pageSize: number) {
    return this.userClient.getUserAuditLogs(id, page, pageSize);
  }

  async adjustBalance(
    userId: string,
    amountCents: number,
    reasonCode: BalanceAdjustmentReasonCode,
    description: string,
    performedBy: string,
    idempotencyKey: string,
  ) {
    const user = await this.userClient.getUser(userId) as {
      id?: string;
      email?: string | null;
      phone?: string | null;
      nickname?: string | null;
      isActive?: boolean | null;
    };
    const result = await this.billingClient.applyClassifiedBalanceAdjustment(userId, {
      amountCents,
      reasonCode,
      description,
      performedBy,
      idempotencyKey,
      user: {
        id: user.id ?? userId,
        email: user.email ?? null,
        phone: user.phone ?? null,
        nickname: user.nickname ?? null,
        isActive: user.isActive ?? null,
      },
    });
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'user.balance.billing_adjustment',
      resource: 'User',
      resourceId: userId,
      after: result,
      detail: {
        amountCents,
        reasonCode,
        description,
        transactionId: result.transaction.id,
      },
    });
    return result;
  }

  async toggleUserStatus(id: string, performedBy: string) {
    return this.userClient.toggleUserStatus(id, performedBy);
  }

  // ============================
  // 订单 — 通过 BillingInternalClient 调独立 billing service
  // ============================

  async listOrders(
    page: number,
    pageSize: number,
    filters?: {
      status?: string;
      userId?: string;
      orderType?: string;
      channel?: string;
      search?: string;
    },
  ) {
    return this.billingClient.listOrders(page, pageSize, filters);
  }

  async getOrderDetail(id: string) {
    return this.billingClient.getOrderDetail(id);
  }

  async adminCancelOrder(orderId: string, adminId: string, reason?: string) {
    return this.billingClient.adminCancelOrder(orderId, adminId, reason);
  }

  async retryFailedOrder(orderId: string, adminId: string) {
    return this.billingClient.retryFailedOrder(orderId, adminId);
  }

  async refundOrder(orderId: string, reason: string) {
    return this.billingClient.refundOrder(orderId, reason);
  }

  // ============================
  // 统计 & 收入 — 通过 BillingInternalClient 调独立 billing service
  // ============================

  async getDashboardOverview() {
    const [users, payments] = await Promise.all([
      this.getDashboardUserOverview(),
      this.getDashboardPaymentOverview(),
    ]);

    return {
      users,
      payments,
      generatedAt: new Date().toISOString(),
    };
  }

  async getStats() {
    return this.billingClient.getStats();
  }

  async getRevenue(productId?: string) {
    return this.billingClient.getRevenue(productId);
  }

  async getRevenueOverview(days: number, productId?: string) {
    return this.billingClient.getRevenueOverview(days, productId);
  }

  private async getDashboardUserOverview() {
    try {
      const stats = await this.userClient.getUserStats() as DashboardUserStats;
      return {
        available: true,
        totalUsers: normalizeNumber(stats.totalUsers),
        todayNewUsers: normalizeNumber(stats.todayNewUsers),
        trends: {
          sevenDays: this.normalizeDashboardTrend(stats.trends?.sevenDays),
          month: this.normalizeDashboardTrend(stats.trends?.month),
          year: this.normalizeDashboardTrend(stats.trends?.year),
        },
        generatedAt: stats.generatedAt ?? null,
      };
    } catch (error) {
      this.logger.warn(`Dashboard user overview unavailable: ${(error as Error)?.message ?? error}`);
      return this.getDashboardUserOverviewFallback();
    }
  }

  private async getDashboardUserOverviewFallback() {
    let totalUsers = 0;

    try {
      totalUsers = this.listPayloadTotal(await this.userClient.listUsers(1, 1));
    } catch (error) {
      this.logger.warn(`Dashboard user total fallback unavailable: ${(error as Error)?.message ?? error}`);
    }

    return {
      available: false,
      totalUsers,
      todayNewUsers: 0,
      trends: {
        sevenDays: [],
        month: [],
        year: [],
      },
      generatedAt: null,
    };
  }

  private async getDashboardPaymentOverview() {
    try {
      const now = new Date();
      const today = startOfDay(now);
      const summary = await this.billingClient.getRevenue() as DashboardRevenueSummary;
      const [sevenDays, month, year, productBreakdown] = await Promise.all([
        this.getDashboardRevenueTrend(7, addDays(today, -6), today, 'day'),
        this.getDashboardRevenueTrend(inclusiveDayCount(startOfMonth(now), now), startOfMonth(now), today, 'day'),
        this.getDashboardRevenueTrend(inclusiveDayCount(startOfYear(now), now), startOfYear(now), startOfMonth(now), 'month'),
        this.getDashboardProductRevenueBreakdown(),
      ]);

      return {
        available: true,
        todayRevenueCents: normalizeNumber(summary.todayRechargeCents),
        totalRevenueCents: normalizeNumber(summary.totalRechargeCents ?? summary.totalRevenueCents),
        trends: {
          sevenDays,
          month,
          year,
        },
        productBreakdown,
      };
    } catch (error) {
      this.logger.warn(`Dashboard payment overview unavailable: ${(error as Error)?.message ?? error}`);
      return {
        available: false,
        todayRevenueCents: 0,
        totalRevenueCents: 0,
        trends: {
          sevenDays: [] as DashboardTrendPoint[],
          month: [] as DashboardTrendPoint[],
          year: [] as DashboardTrendPoint[],
        },
        productBreakdown: [] as Array<{
          productId: string;
          productName: string;
          productSlug: string | null;
          billingMode: string | null;
          totalRevenueCents: number;
          todayRevenueCents: number;
        }>,
      };
    }
  }

  private async getDashboardRevenueTrend(
    days: number,
    start: Date,
    endInclusive: Date,
    unit: 'day' | 'month',
  ): Promise<DashboardTrendPoint[]> {
    const overview = await this.billingClient.getRevenueOverview(days) as DashboardRevenueOverview;
    const daily = overview.daily ?? [];
    const valueByDay = new Map<string, number>();

    for (const row of daily) {
      if (!row.date) continue;
      const date = new Date(row.date);
      if (!Number.isFinite(date.getTime())) continue;
      valueByDay.set(
        dayKey(date),
        normalizeNumber(row.rechargeCents ?? row.recharge ?? row.value),
      );
    }

    if (unit === 'month') {
      const valueByMonth = new Map<string, number>();
      for (const [date, value] of valueByDay.entries()) {
        const key = date.slice(0, 7);
        valueByMonth.set(key, (valueByMonth.get(key) ?? 0) + value);
      }
      const points: DashboardTrendPoint[] = [];
      for (let cursor = new Date(start); cursor <= endInclusive; cursor = addMonths(cursor, 1)) {
        const key = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}`;
        points.push({ date: monthLabel(cursor), value: valueByMonth.get(key) ?? 0 });
      }
      return points;
    }

    const points: DashboardTrendPoint[] = [];
    for (let cursor = new Date(start); cursor <= endInclusive; cursor = addDays(cursor, 1)) {
      points.push({ date: dayLabel(cursor), value: valueByDay.get(dayKey(cursor)) ?? 0 });
    }
    return points;
  }

  private async getDashboardProductRevenueBreakdown() {
    const products = this.listPayloadItems<DashboardProductSnapshot>(
      await this.billingClient.listProducts(),
    ).filter((product): product is DashboardProductSnapshot & { id: string } => Boolean(product.id));

    const rows = await Promise.all(
      products.map(async (product) => {
        const revenue = await this.billingClient.getRevenue(product.id) as DashboardRevenueSummary;
        return {
          productId: product.id,
          productName: product.name || product.slug || product.id,
          productSlug: product.slug ?? null,
          billingMode: product.billingMode ?? null,
          isActive: product.isActive ?? null,
          totalRevenueCents: normalizeNumber(revenue.totalRechargeCents ?? revenue.totalRevenueCents),
          todayRevenueCents: normalizeNumber(revenue.todayRechargeCents),
        };
      }),
    );

    return rows
      .sort((left, right) => right.totalRevenueCents - left.totalRevenueCents)
      .slice(0, 8);
  }

  private normalizeDashboardTrend(value: DashboardTrendPoint[] | undefined): DashboardTrendPoint[] {
    if (!Array.isArray(value)) return [];
    return value.map((point) => ({
      date: typeof point.date === 'string' ? point.date : String(point.date ?? ''),
      value: normalizeNumber(point.value),
    }));
  }

  async getFinanceReports(month?: string) {
    return this.billingClient.getFinanceReports(month);
  }

  async getFinanceDashboard(month?: string) {
    return this.billingClient.getFinanceDashboard(month);
  }

  async getFinanceReportOverview(month?: string, billingMode?: string, refresh?: boolean) {
    return this.billingClient.getFinanceReportOverview(month, billingMode, refresh);
  }

  async getFinanceReportDetail(params: {
    month?: string;
    tab?: string;
    billingMode?: string;
    pageSize?: number;
    cursor?: string;
    filterField?: string;
    filterValue?: string;
  }) {
    return this.billingClient.getFinanceReportDetail(params);
  }

  async createFinanceReportExportJob(params: {
    month?: string;
    tab?: string;
    billingMode?: string;
    requestedByAdminId?: string | null;
  }) {
    return this.billingClient.createFinanceReportExportJob(params);
  }

  async listFinanceReportExportJobs(take?: number) {
    return this.billingClient.listFinanceReportExportJobs(take);
  }

  async getFinanceReportExportJob(id: string) {
    return this.billingClient.getFinanceReportExportJob(id);
  }

  async downloadFinanceReportExportJob(id: string) {
    return this.billingClient.downloadFinanceReportExportJob(id);
  }

  // ============================
  // 交易流水 — 通过 BillingInternalClient 调独立 billing service
  // ============================

  async listTransactions(page: number, pageSize: number, filters?: { userId?: string }) {
    return this.billingClient.listTransactions(page, pageSize, filters);
  }

  async listGatewayBillingEvents(
    page: number,
    pageSize: number,
    filters?: {
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
  ) {
    return this.billingClient.listGatewayEvents({ page, pageSize, ...filters });
  }

  async getGatewayBillingEvent(requestId: string) {
    return this.billingClient.getGatewayEvent(requestId);
  }

  async retryGatewayBillingEvent(
    requestId: string,
    body: GatewayBillingEventActionRequest,
    performedBy: string,
  ) {
    return this.applyGatewayBillingEventAction('retry', requestId, body, performedBy);
  }

  async markGatewayBillingEventManualReview(
    requestId: string,
    body: GatewayBillingEventActionRequest,
    performedBy: string,
  ) {
    return this.applyGatewayBillingEventAction('manual_review', requestId, body, performedBy);
  }

  async absorbGatewayBillingEvent(
    requestId: string,
    body: GatewayBillingEventAbsorbRequest,
    performedBy: string,
  ) {
    return this.applyGatewayBillingEventAction('absorb', requestId, body, performedBy);
  }

  async reconcileAndSettleGatewayBillingEvent(
    requestId: string,
    body: GatewayBillingEventSettlementRequest,
    performedBy: string,
  ) {
    const result = await this.billingClient.reconcileAndSettleGatewayEvent(requestId, body);
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'gateway_billing_event.reconcile_settle',
      resource: 'GatewayBillingEvent',
      resourceId: requestId,
      after: result,
      detail: {
        evidenceId: body.evidenceId,
        expectedRevision: body.expectedRevision,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        financialImpact: true,
      },
    });
    return result;
  }

  async absorbGatewayBillingEventDelta(
    requestId: string,
    body: GatewayBillingEventSettlementRequest,
    performedBy: string,
  ) {
    const result = await this.billingClient.absorbGatewayEventDelta(requestId, body);
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'gateway_billing_event.absorb_delta',
      resource: 'GatewayBillingEvent',
      resourceId: requestId,
      after: result,
      detail: {
        evidenceId: body.evidenceId,
        expectedRevision: body.expectedRevision,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        financialImpact: true,
        customerDeduction: false,
      },
    });
    return result;
  }

  async previewHistoricalPlatformLossBatch(body: HistoricalPlatformLossPreviewRequest) {
    return this.billingClient.previewHistoricalPlatformLossBatch(body);
  }

  async createHistoricalPlatformLossBatch(
    body: HistoricalPlatformLossCreateRequest,
    performedBy: string,
  ) {
    const result = await this.billingClient.createHistoricalPlatformLossBatch(body);
    const record = compactRecord(result);
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'historical_platform_loss.prepare',
      resource: 'HistoricalPlatformLossBatch',
      resourceId: String(record?.id ?? body.expectedFingerprint),
      after: result,
      detail: {
        provider: body.provider,
        providerAccountRef: body.providerAccountRef,
        region: body.region,
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        currency: body.currency,
        sourceFileRef: body.sourceFileRef,
        sourceFileSha256: body.sourceFileSha256,
        expectedFingerprint: body.expectedFingerprint,
        itemCount: body.lines.length,
        idempotencyKey: body.idempotencyKey,
        financialImpact: false,
      },
    });
    return result;
  }

  async listHistoricalPlatformLossBatches(query: {
    page?: number;
    pageSize?: number;
    status?: string;
    provider?: string;
    providerAccountRef?: string;
    region?: string;
    periodStart?: string;
    periodEnd?: string;
  }) {
    return this.billingClient.listHistoricalPlatformLossBatches(query);
  }

  async getHistoricalPlatformLossBatch(id: string) {
    return this.billingClient.getHistoricalPlatformLossBatch(id);
  }

  async approveAndPostHistoricalPlatformLossBatch(
    id: string,
    body: HistoricalPlatformLossApproveRequest,
    performedBy: string,
  ) {
    const result = await this.billingClient.approveAndPostHistoricalPlatformLossBatch(id, body);
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'historical_platform_loss.approve_post',
      resource: 'HistoricalPlatformLossBatch',
      resourceId: id,
      after: result,
      detail: {
        expectedRevision: body.expectedRevision,
        expectedFingerprint: body.expectedFingerprint,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        financialImpact: true,
        customerDeduction: false,
        issuedInvoicesChanged: false,
        customerBalanceChanged: false,
      },
    });
    return result;
  }

  async exportHistoricalPlatformLossBatch(id: string, performedBy: string) {
    const result = await this.billingClient.exportHistoricalPlatformLossBatch(id);
    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: 'historical_platform_loss.export',
      resource: 'HistoricalPlatformLossBatch',
      resourceId: id,
      detail: { financialImpact: false },
    });
    return result;
  }

  private async applyGatewayBillingEventAction(
    action: 'retry' | 'manual_review' | 'absorb',
    requestId: string,
    body: GatewayBillingEventActionRequest | GatewayBillingEventAbsorbRequest,
    performedBy: string,
  ) {
    const absorbBody = action === 'absorb'
      ? body as GatewayBillingEventAbsorbRequest
      : undefined;
    const result = action === 'retry'
      ? await this.billingClient.retryGatewayEvent(requestId, body)
      : action === 'manual_review'
        ? await this.billingClient.markGatewayEventManualReview(requestId, body)
        : await this.billingClient.absorbGatewayEvent(requestId, body);

    await this.activityLog.log({
      adminMemberId: performedBy,
      operatorAdminId: performedBy,
      action: `gateway_billing_event.${action}`,
      resource: 'GatewayBillingEvent',
      resourceId: requestId,
      after: result,
      detail: {
        expectedRevision: body.expectedRevision,
        reason: body.reason,
        idempotencyKey: body.idempotencyKey,
        ...(action === 'absorb' ? {
          financialImpact: true,
          customerDeduction: false,
          protocol: absorbBody?.protocol ?? 'gateway-absorb-v2',
          currencyRepairRunId: absorbBody?.currencyRepairRunId,
          currencyRepairItemId: absorbBody?.currencyRepairItemId,
          manifestHash: absorbBody?.manifestHash,
        } : {}),
      },
    });
    return result;
  }

  async listPublisherSyncJobs(
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
    return this.billingClient.listPublisherSyncJobs(page, pageSize, filters);
  }

  async getPublisherSyncJob(id: string) {
    return this.billingClient.getPublisherSyncJob(id);
  }

  async retryPublisherSyncJob(id: string) {
    return this.billingClient.retryPublisherSyncJob(id);
  }

  async replayPublisherSync(scope: PublisherReplayScope = 'all') {
    return this.billingClient.replayPublisherSync(scope);
  }

  // ============================
  // 审计日志
  // ============================

  async listAuditLogs(page: number, pageSize: number, filters?: { action?: string; resource?: string; search?: string }) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.repo.findAuditLogs(skip, pageSize, filters),
      this.repo.countAuditLogs(filters),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  // ============================
  // 套餐管理 — 通过 BillingInternalClient 调独立 billing service
  // ============================

  async listPlans() {
    return this.billingClient.listPlans();
  }

  async getPlanById(id: string) {
    return this.billingClient.getPlanById(id);
  }

  async createOrUpdatePlan(body: {
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
    salesLimit?: number;
    sortOrder?: number;
    maxSellableQuantity?: number | null;
  }) {
    return this.billingClient.createOrUpdatePlan(body);
  }

  async updatePlan(id: string, body: Record<string, unknown>) {
    return this.billingClient.updatePlan(id, body);
  }

  async deletePlan(id: string) {
    return this.billingClient.deletePlan(id);
  }

  async createCodingPlanPlan(body: Record<string, unknown>) {
    if ((body as CodingPlanPlanWriteInput).fulfillmentMode === 'provider_resale') {
      throw new BadRequestException('供应商转售套餐必须通过 resale plan 命令保存');
    }
    return this.saveCodingPlanPlan(null, body as CodingPlanPlanWriteInput);
  }

  async updateCodingPlanPlan(id: string, body: Record<string, unknown>) {
    if ((body as CodingPlanPlanWriteInput).fulfillmentMode === 'provider_resale') {
      throw new BadRequestException('供应商转售套餐必须通过 resale plan 命令保存');
    }
    return this.saveCodingPlanPlan(id, body as CodingPlanPlanWriteInput);
  }

  async createCodingPlanResalePlan(body: Record<string, unknown>) {
    return this.billingClient.createCodingPlanResalePlan(body);
  }

  async updateCodingPlanResalePlan(id: string, body: Record<string, unknown>) {
    return this.billingClient.updateCodingPlanResalePlan(id, body);
  }

  async deleteCodingPlanPlan(id: string) {
    const plan = await this.billingClient.getPlanById(id) as CodingPlanPlanSnapshot;
    const productId = this.normalizeConfigText(plan.productId);
    if (!productId) {
      throw new BadRequestException('CodingPlan 套餐必须绑定 CodingPlan 产品');
    }
    await this.assertCodingPlanProduct(productId);
    // finding #13：已上架自营套餐不可直接删除，须先下架（与编辑锁一致，避免绕过状态机、
    // 影响商城同步与历史订单引用）。
    if ((plan as { isActive?: boolean }).isActive) {
      throw new ConflictException('已上架的自营套餐不可删除，请先下架');
    }
    return this.billingClient.deletePlan(id);
  }

  // finding #13：上架/下架独立动作。最终「active⇒有绑定」不变量由 billing setPlanActive 原子校验
  // （绑定齐备才翻 active，per-plan 锁）；前端按 workspace 的启用模型/配额模板计数置灰做早失败。
  async publishCodingPlanPlan(id: string) {
    await this.assertSelfOpCodingPlanForToggle(id);
    return this.billingClient.setPlanActive(id, true);
  }

  async unpublishCodingPlanPlan(id: string) {
    await this.assertSelfOpCodingPlanForToggle(id);
    return this.billingClient.setPlanActive(id, false);
  }

  private async assertSelfOpCodingPlanForToggle(id: string) {
    const plan = await this.billingClient.getPlanById(id) as CodingPlanPlanSnapshot;
    const productId = this.normalizeConfigText(plan.productId);
    if (!productId) {
      throw new BadRequestException('CodingPlan 套餐必须绑定 CodingPlan 产品');
    }
    const product = await this.assertCodingPlanProduct(productId);
    if (
      product.codingPlanFulfillmentMode === 'provider_resale' ||
      product.fulfillmentMode === 'provider_resale'
    ) {
      throw new BadRequestException('转售套餐不适用自营上架/下架动作');
    }
  }

  private async saveCodingPlanPlan(
    planId: string | null,
    body: CodingPlanPlanWriteInput,
  ) {
    const existing = planId
      ? await this.billingClient.getPlanById(planId) as CodingPlanPlanSnapshot
      : null;
    if (body.fulfillmentMode === 'provider_resale') {
      throw new BadRequestException('供应商转售套餐必须通过 resale plan 命令保存');
    }
    const fulfillmentMode: CodingPlanFulfillmentMode = 'platform_model_package';

    const productId = this.normalizeConfigText(body.productId)
      ?? this.normalizeConfigText(existing?.productId);
    if (!productId) {
      throw new BadRequestException('CodingPlan 套餐必须绑定 CodingPlan 产品');
    }
    const product = await this.assertCodingPlanProduct(productId);
    if (product.codingPlanFulfillmentMode === 'provider_resale' || product.fulfillmentMode === 'provider_resale') {
      throw new BadRequestException('供应商转售产品下的套餐必须通过 resale plan 命令保存');
    }

    const id = planId ?? this.normalizeConfigText(body.id) ?? undefined;
    const name = this.normalizeConfigText(body.name) ?? this.normalizeConfigText(existing?.name);
    if (!name) {
      throw new BadRequestException('套餐名称不能为空');
    }

    const platformPackage = this.resolveCodingPlanPlatformPackageInput(body);
    const existingRecord = existing as Record<string, unknown> | null;

    // finding #13：已上架自营套餐不可编辑——改绑定=改存量在用用户权益、且整包保存易产生
    // 「active 却半绑定」的非原子中间态。须先下架（unpublishCodingPlanPlan）再修改。
    if (existing?.isActive) {
      throw new ConflictException('已上架的自营套餐不可编辑，请先下架后再修改');
    }
    // 「上架」从随保存的字段解耦为独立受控动作（publishCodingPlanPlan → billing.setPlanActive）。
    // 保存一律存**草稿(inactive)**：模型/配额绑定在草稿态完成（多步写中途失败也安全、可重试自愈），
    // 激活时由 billing 原子校验绑定。故上架三道校验从保存路径移除，改由 publish 动作 + 前端置灰承担。
    const targetIsActive = false;

    await this.assertCodingPlanWriteSnapshotsReady(fulfillmentMode);

    const planPayload = {
      id,
      productId: product.id,
      name,
      description: this.stringValue(body.description, this.stringValue(existing?.description, '')),
      planType: 'coding_plan',
      monthlyPrice: this.integerValue(body.monthlyPrice, existing?.monthlyPrice ?? 0),
      quarterlyPrice: this.integerValue(body.quarterlyPrice, existing?.quarterlyPrice ?? 0),
      yearlyPrice: this.integerValue(body.yearlyPrice, existing?.yearlyPrice ?? 0),
      billingPeriod: this.stringValue(body.billingPeriod, existing?.billingPeriod ?? 'monthly'),
      monthlyCredits: this.integerValue(body.monthlyCredits, existing?.monthlyCredits ?? 0),
      creditsRollover: this.booleanValue(
        body.creditsRollover,
        this.booleanValue(existingRecord?.creditsRollover, false),
      ),
      rolloverMaxMonths: this.integerValue(
        body.rolloverMaxMonths,
        this.integerValue(existingRecord?.rolloverMaxMonths, 0),
      ),
      // 自营（platform_model_package）：三散字段弃用，保存一律归 0（配额来自配额模板，
      // 展示走 quotaRules；存量套餐随下次保存自然清洗）。转售保持原兜底，零影响。
      // 设计：me/plan-quota-display-from-template.md §4.1
      rateLimitRpm: platformPackage
        ? 0
        : this.integerValue(body.rateLimitRpm, existing?.rateLimitRpm ?? 60),
      rateLimitTpm: platformPackage
        ? 0
        : this.integerValue(body.rateLimitTpm, existing?.rateLimitTpm ?? 100000),
      maxContextWindow: platformPackage
        ? 0
        : this.integerValue(body.maxContextWindow, existing?.maxContextWindow ?? 200000),
      overageEnabled: this.booleanValue(
        body.overageEnabled,
        this.booleanValue(existingRecord?.overageEnabled, false),
      ),
      usageMultiplier: this.numberValue(body.usageMultiplier, existing?.usageMultiplier ?? 1),
      memberLimit: this.integerValue(body.memberLimit, existing?.memberLimit ?? 1),
      minimumSeats: this.integerValue(
        body.minimumSeats,
        this.integerValue(existingRecord?.minimumSeats, 1),
      ),
      // 限量售卖：null=不限量。显式携带时以入参为准（含清空为 null）；未携带回退 existing；billing 再做正整数校验。
      maxSellableQuantity:
        'maxSellableQuantity' in body
          ? (body.maxSellableQuantity ?? null)
          : (existing?.maxSellableQuantity ?? null),
      dataTraining: this.stringValue(body.dataTraining, this.stringValue(existingRecord?.dataTraining, 'opt_out')),
      supportTier: this.stringValue(body.supportTier, this.stringValue(existingRecord?.supportTier, 'community')),
      ssoEnabled: this.booleanValue(body.ssoEnabled, this.booleanValue(existingRecord?.ssoEnabled, false)),
      priorityAccess: this.booleanValue(
        body.priorityAccess,
        this.booleanValue(existingRecord?.priorityAccess, false),
      ),
      badge: this.normalizeConfigText(body.badge) ?? existing?.badge ?? null,
      trialDays: this.integerValue(body.trialDays, existing?.trialDays ?? 0),
      validityDays: Math.max(1, this.integerValue(body.validityDays, existing?.validityDays ?? 30)),
      features: [...new Set(this.planFeatureList(body.features ?? existing?.features))],
      isActive: targetIsActive,
      isLegacy: this.booleanValue(body.isLegacy, existing?.isLegacy ?? false),
      sortOrder: this.integerValue(body.sortOrder, existing?.sortOrder ?? 0),
    };

    const result = await this.billingClient.createOrUpdatePlan(planPayload);
    const savedPlan = this.extractPlanWriteData(result);
    const savedPlanId = this.normalizeConfigText((savedPlan as { id?: unknown } | null)?.id)
      ?? planPayload.id;
    if (!savedPlanId) {
      throw new BadRequestException('CodingPlan 套餐保存失败: 缺少套餐 ID');
    }

    await this.applyCodingPlanPlatformEntitlements(savedPlanId, platformPackage);

    return {
      id: savedPlanId,
      plan: savedPlan,
      fulfillmentMode,
      productId: product.id,
    };
  }

  private async assertCodingPlanWriteSnapshotsReady(
    fulfillmentMode: CodingPlanFulfillmentMode,
  ): Promise<void> {
    if (fulfillmentMode === 'provider_resale') return;

    const checks: Array<{
      key: keyof typeof CODING_PLAN_WRITE_SNAPSHOT_LABELS;
      loader: () => Promise<unknown> | unknown;
    }> = [
      { key: 'modelAccess', loader: () => this.billingClient.listModelAccess() },
    ];

    checks.push({
      key: 'quotaTemplates',
      loader: () => this.billingClient.listQuotaTemplates({ page: 1, pageSize: 1 }),
    });

    const failures: string[] = [];
    await Promise.all(checks.map(async (check) => {
      try {
        await check.loader();
      } catch (error) {
        this.logger.warn(
          `coding plan write snapshot preflight failed source=${check.key}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        failures.push(CODING_PLAN_WRITE_SNAPSHOT_LABELS[check.key]);
      }
    }));

    if (failures.length > 0) {
      throw new BadRequestException(
        `CodingPlan 关键数据源暂不可用（${failures.join('、')}），请刷新确认后再保存套餐`,
      );
    }
  }

  /** 绑定的配额模板里是否至少有一个启用中（已删/不可达的模板按无效处理）。 */
  private async hasActiveQuotaTemplate(templateIds: string[]): Promise<boolean> {
    for (const templateId of templateIds) {
      try {
        const result = await this.billingClient.getQuotaTemplate(templateId) as
          | { isActive?: boolean }
          | { data?: { isActive?: boolean } }
          | null;
        const template = (result && typeof result === 'object' && 'data' in result)
          ? (result as { data?: { isActive?: boolean } }).data
          : result as { isActive?: boolean } | null;
        if (template?.isActive) return true;
      } catch {
        // 模板已删除或 billing 暂不可达：该模板按无效处理，继续检查其余绑定
      }
    }
    return false;
  }

  async listPlanPrices(planId: string) {
    return this.billingClient.listPlanPrices(planId);
  }

  async upsertPlanPrice(planId: string, body: {
    currency: string;
    monthlyPrice: number;
    quarterlyPrice: number;
    yearlyPrice: number;
    isActive?: boolean;
  }) {
    return this.billingClient.upsertPlanPrice(planId, body);
  }

  async deletePlanPrice(planId: string, currency: string) {
    return this.billingClient.deletePlanPrice(planId, currency);
  }

  async listBundleSkus(filters?: { isActive?: boolean }) {
    return this.billingClient.listBundleSkus(filters);
  }

  async getBundleSkuById(id: string) {
    return this.billingClient.getBundleSkuById(id);
  }

  async createBundleSku(body: Record<string, unknown>) {
    return this.billingClient.createBundleSku(body);
  }

  async updateBundleSku(id: string, body: Record<string, unknown>) {
    return this.billingClient.updateBundleSku(id, body);
  }

  async deleteBundleSku(id: string) {
    return this.billingClient.deleteBundleSku(id);
  }

  // ============================
  // API Key 管理
  // ============================

  async listApiKeys(params: {
    page: number;
    pageSize: number;
    search?: string;
    email?: string;
    status?: string;
  }) {
    return this.userClient.listApiKeys(params);
  }

  async updateApiKeyStatus(id: string, isActive: boolean) {
    return this.userClient.updateApiKeyStatus(id, isActive);
  }

  async revokeApiKey(id: string) {
    return this.userClient.revokeApiKey(id);
  }

  async listSubscriptions(params: {
    page: number;
    pageSize: number;
    status?: string;
    expiringDays?: number;
    productId?: string;
    userId?: string;
  }) {
    return this.billingClient.listSubscriptions(params);
  }

  async listCodingPlanProviderEntitlements(params: CodingPlanProviderEntitlementFilters) {
    return this.billingClient.listCodingPlanProviderEntitlements(params);
  }

  async retryCodingPlanProviderEntitlement(id: string) {
    return this.billingClient.retryCodingPlanProviderEntitlement(id);
  }

  async listCodingPlanProviderLines() {
    return this.billingClient.listCodingPlanProviderLines();
  }

  async createCodingPlanProviderLine(body: Record<string, unknown>) {
    return this.billingClient.createCodingPlanProviderLine(body);
  }

  async updateCodingPlanProviderLine(id: string, body: Record<string, unknown>) {
    return this.billingClient.updateCodingPlanProviderLine(id, body);
  }

  async deleteCodingPlanProviderLine(id: string) {
    return this.billingClient.deleteCodingPlanProviderLine(id);
  }

  async testCodingPlanProviderLine(id: string) {
    return this.billingClient.testCodingPlanProviderLine(id);
  }

  async syncCodingPlanProviderProducts(id: string) {
    return this.billingClient.syncCodingPlanProviderProducts(id);
  }

  async listCodingPlanProviderProducts(providerLineId?: string | null) {
    return this.billingClient.listCodingPlanProviderProducts(providerLineId);
  }

  async listCodingPlanResaleRoutes(params: {
    planId?: string;
    providerLineId?: string;
  }) {
    return this.billingClient.listCodingPlanResaleRoutes(params);
  }

  async getCodingPlanWorkspace() {
    let modelAccessReady = true;
    let quotaTemplateReady = true;
    let providerProductReady = true;
    const [
      productPayload,
      planPayload,
      routePayload,
      providerProductPayload,
      modelAccessPayload,
      quotaTemplatePayload,
    ] = await Promise.all([
      this.billingClient.listProducts(),
      this.billingClient.listPlans(),
      this.billingClient.listCodingPlanResaleRoutes(),
      this.optionalBillingSnapshot(
        'coding plan provider products',
        () => this.billingClient.listCodingPlanProviderProducts(),
        { items: [] },
        () => { providerProductReady = false; },
      ),
      this.optionalBillingSnapshot(
        'coding plan model access',
        () => this.billingClient.listModelAccess(),
        [],
        () => { modelAccessReady = false; },
      ),
      this.optionalBillingSnapshot(
        'coding plan quota templates',
        () => this.listAllCodingPlanQuotaTemplates(),
        [],
        () => { quotaTemplateReady = false; },
      ),
    ]);

    const products = this.listPayloadItems<CodingPlanProductSnapshot>(productPayload);
    const plans = this.listPayloadItems<CodingPlanPlanSnapshot>(planPayload);
    const resaleRoutes = this.listPayloadItems<CodingPlanResaleRouteSnapshot>(routePayload);
    const providerProducts = this.listPayloadItems<CodingPlanProviderProductSnapshot>(providerProductPayload);
    const upstreamProducts = providerProducts
      .map((product) => this.providerProductToWorkspaceUpstreamProduct(product))
      .filter((product) => product.productId);
    const modelAccess = this.listPayloadItems<CodingPlanModelAccessSnapshot>(modelAccessPayload);
    const quotaTemplates = this.listPayloadItems<CodingPlanQuotaTemplateSnapshot>(quotaTemplatePayload)
      .map((template) => ({
        id: template.id,
        name: template.name,
        description: template.description ?? null,
        rules: Array.isArray(template.rules) ? template.rules : [],
        referencedPlanIds: Array.isArray(template.referencedPlanIds)
          ? template.referencedPlanIds
          : [],
        isActive: template.isActive !== false,
        createdAt: this.toIsoStringOrNull(template.createdAt),
        updatedAt: this.toIsoStringOrNull(template.updatedAt),
      }));
    const codingProducts = products
      .filter((product) => product.billingMode === 'CODING_PLAN')
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const codingProductIds = new Set(codingProducts.map((product) => product.id));
    const codingProductById = new Map(codingProducts.map((product) => [product.id, product]));
    const productNameById = new Map(codingProducts.map((product) => [product.id, product.name]));
    const codingPlans = plans
      .filter((plan) => (
        plan.planType === 'coding_plan' ||
        (plan.productId ? codingProductIds.has(plan.productId) : false)
      ))
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const routesByPlanId = new Map<string, CodingPlanResaleRouteSnapshot[]>();
    for (const route of resaleRoutes) {
      const bucket = routesByPlanId.get(route.planId) ?? [];
      bucket.push(route);
      routesByPlanId.set(route.planId, bucket);
    }
    const planFulfillmentById = this.resolveCodingPlanFulfillments(codingPlans, codingProductById, routesByPlanId);
    const codingPlanIds = new Set(codingPlans.map((plan) => plan.id));
    const activeModelNamesByPlanId = new Map<string, Set<string>>();
    for (const access of modelAccess) {
      const planId = access.planId ?? '';
      const modelName = access.modelName ?? access.model ?? '';
      if (!planId || !modelName || !codingPlanIds.has(planId) || access.isActive === false) {
        continue;
      }
      const bucket = activeModelNamesByPlanId.get(planId) ?? new Set<string>();
      bucket.add(modelName);
      activeModelNamesByPlanId.set(planId, bucket);
    }

    const quotaTemplatesByPlanId = new Map<string, typeof quotaTemplates>();
    for (const template of quotaTemplates) {
      for (const planId of template.referencedPlanIds) {
        if (!codingPlanIds.has(planId)) continue;
        const bucket = quotaTemplatesByPlanId.get(planId) ?? [];
        bucket.push(template);
        quotaTemplatesByPlanId.set(planId, bucket);
      }
    }

    const [integrationPairs, activeSubscriptionPairs] = await Promise.all([
      Promise.all(codingProducts.map(async (product) => {
        try {
          const integration = await this.billingClient.getProductIntegration(product.id);
          return [product.id, integration as CodingPlanIntegrationSnapshot] as const;
        } catch (error) {
          this.logger.warn(
            `coding plan integration snapshot failed product=${product.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [product.id, null] as const;
        }
      })),
      Promise.all(codingProducts.map(async (product) => {
        try {
          const payload = await this.billingClient.listSubscriptions({
            page: 1,
            pageSize: 1,
            status: 'ACTIVE',
            productId: product.id,
          });
          return [product.id, this.listPayloadTotal(payload)] as const;
        } catch (error) {
          this.logger.warn(
            `coding plan subscription snapshot failed product=${product.id}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [product.id, 0] as const;
        }
      })),
    ]);

    const integrationByProductId = new Map(integrationPairs);
    const activeSubscriptionsByProductId = new Map(activeSubscriptionPairs);
    const plansByProductId = new Map<string, CodingPlanPlanSnapshot[]>();
    for (const plan of codingPlans) {
      if (!plan.productId) continue;
      const bucket = plansByProductId.get(plan.productId) ?? [];
      bucket.push(plan);
      plansByProductId.set(plan.productId, bucket);
    }

    const productRows = codingProducts.map((product) => {
      const integration = integrationByProductId.get(product.id) ?? null;
      const productPlans = plansByProductId.get(product.id) ?? [];
      const credentials = integration?.credentials;
      return {
        id: product.id,
        name: product.name,
        slug: product.slug ?? null,
        description: product.description ?? null,
        billingMode: 'CODING_PLAN',
        // 自营套餐编辑器据此过滤「所属产品」下拉（只列自营产品）。null/缺省按自营兜底。
        fulfillmentMode: product.codingPlanFulfillmentMode ?? product.fulfillmentMode ?? 'platform_model_package',
        isActive: product.isActive !== false,
        defaultPlanId: product.defaultPlanId ?? null,
        defaultPlanName: product.defaultPlanId
          ? codingPlans.find((plan) => plan.id === product.defaultPlanId)?.name ?? null
          : null,
        hasIntegrationToken: Boolean(
          credentials?.hasIntegrationToken || product.integrationTokenPrefix,
        ),
        integrationTokenPrefix: credentials?.integrationTokenPrefix ?? product.integrationTokenPrefix ?? null,
        hasWebhookSecret: Boolean(
          credentials?.hasWebhookSecret || product.webhookSecretPrefix,
        ),
        webhookSecretPrefix: credentials?.webhookSecretPrefix ?? product.webhookSecretPrefix ?? null,
        apiKeyDefaultBinding: integration?.requirements?.apiKeyDefaultBinding ?? true,
        virtualKey: integration?.virtualKey ?? null,
        checklist: integration?.checklist ?? {},
        activeSubscriptions: activeSubscriptionsByProductId.get(product.id) ?? 0,
        readiness: this.resolveCodingPlanReadiness(product, integration, productPlans),
      };
    });

    const sellablePlans = codingPlans.filter((plan) => plan.isActive !== false && !plan.isLegacy);
    const activeSubscriptionCount = [...activeSubscriptionsByProductId.values()]
      .reduce((sum, count) => sum + count, 0);
    return {
      generatedAt: new Date().toISOString(),
      contract: {
        partnerUserIdSource: 'raytone_user_id',
        partnerUserIdRuntimeField: 'user.id',
        purchasedPlans: 0,
        provider: 'provider_line',
        upstreamKeyPolicy: 'per_order_key_internal_only',
        userKeyPolicy: 'raytone_api_keys_only',
      },
      policy: {
        providerEntitlementCardinality: 'one_subscription_one_provider_coding_plan',
        raytoneApiKeyFanOut: 'multiple_raytone_api_keys_per_subscription',
        upstreamKeyExposure: 'never_exposed_to_user',
      },
      dataSources: {
        products: { status: 'ready', owner: 'codesphere-billing' },
        plans: { status: 'ready', owner: 'codesphere-billing' },
        modelAccess: {
          status: modelAccessReady ? 'ready' : 'pending',
          owner: 'codesphere-billing',
          message: modelAccessReady
            ? '套餐可用模型来自 ModelAccess。'
            : 'ModelAccess 快照暂不可用，请检查 billing 内部接口。',
        },
        quotaTemplates: {
          status: quotaTemplateReady ? 'ready' : 'pending',
          owner: 'codesphere-billing',
          message: quotaTemplateReady
            ? '配额模板只绑定自营模型套餐；供应商转售套餐继承上游产品权益。'
            : '配额模板快照暂不可用，请检查 billing 内部接口。',
        },
        subscriptions: { status: 'ready', owner: 'codesphere-billing' },
        upstreamProducts: {
          status: providerProductReady ? 'ready' : 'pending',
          owner: 'codesphere-billing',
          message: providerProductReady
            ? `上游产品来自供应商线路同步目录，当前 ${upstreamProducts.length.toLocaleString('zh-CN')} 个。`
            : '供应商产品目录暂不可用，请检查 billing 内部接口。',
        },
        upstreamOrders: {
          status: 'pending',
          owner: 'coding-plan-provider',
          message: '供应商履约订单由 providerLineId + upstreamProductId 跟踪。',
        },
        activations: {
          status: 'pending',
          owner: 'coding-plan-provider',
          message: '激活任务、重试和回滚流水按 providerLineId 分流。',
        },
        anomalies: {
          status: 'pending',
          owner: 'coding-plan-provider',
          message: '异常队列按 providerLineId 接入。',
        },
      },
      stats: {
        contractedPlans: 0,
        productCount: codingProducts.length,
        activeProductCount: productRows.filter((product) => product.isActive).length,
        sellablePlanCount: sellablePlans.length,
        activeSubscriptionCount,
        platformModelPlanCount: [...planFulfillmentById.values()]
          .filter((entry) => entry.fulfillmentMode === 'platform_model_package')
          .length,
        providerResalePlanCount: [...planFulfillmentById.values()]
          .filter((entry) => entry.fulfillmentMode === 'provider_resale')
          .length,
        providerProductBoundPlanCount: [...planFulfillmentById.values()]
          .filter((entry) => entry.fulfillmentMode === 'provider_resale' && entry.upstreamProductId)
          .length,
        modelConfiguredPlanCount: codingPlans
          .filter((plan) => (
            planFulfillmentById.get(plan.id)?.fulfillmentMode === 'platform_model_package'
            && (activeModelNamesByPlanId.get(plan.id)?.size ?? 0) > 0
          ))
          .length,
        quotaConfiguredPlanCount: codingPlans
          .filter((plan) => (
            planFulfillmentById.get(plan.id)?.fulfillmentMode === 'platform_model_package'
            && (quotaTemplatesByPlanId.get(plan.id)?.length ?? 0) > 0
          ))
          .length,
        quotaTemplateCount: quotaTemplates.length,
        activeQuotaTemplateCount: quotaTemplates.filter((template) => template.isActive).length,
        upstreamAvailableCount: upstreamProducts.length,
        upstreamAllocatedCount: null,
        activationFailedCount: null,
      },
      upstreamProducts,
      products: productRows,
      plans: codingPlans.map((plan) => {
        const fulfillment = planFulfillmentById.get(plan.id) ?? {
          fulfillmentMode: 'platform_model_package',
          providerLineId: null,
          providerLineCode: null,
          upstreamProductId: null,
        };
        const isProviderResale = fulfillment.fulfillmentMode === 'provider_resale';
        const enabledModelNames = isProviderResale
          ? new Set<string>()
          : activeModelNamesByPlanId.get(plan.id) ?? new Set<string>();
        const boundQuotaTemplates = isProviderResale
          ? []
          : quotaTemplatesByPlanId.get(plan.id) ?? [];

        return {
          id: plan.id,
          productId: plan.productId ?? null,
          productName: plan.productId ? productNameById.get(plan.productId) ?? null : null,
          name: plan.name,
          description: plan.description ?? null,
          planType: plan.planType ?? null,
          billingPeriod: plan.billingPeriod ?? null,
          monthlyPrice: plan.monthlyPrice ?? 0,
          quarterlyPrice: plan.quarterlyPrice ?? 0,
          yearlyPrice: plan.yearlyPrice ?? 0,
          monthlyCredits: plan.monthlyCredits ?? 0,
          validityDays: plan.validityDays ?? null,
          rateLimitRpm: plan.rateLimitRpm ?? null,
          rateLimitTpm: plan.rateLimitTpm ?? null,
          maxContextWindow: plan.maxContextWindow ?? null,
          memberLimit: plan.memberLimit ?? null,
          maxSellableQuantity: plan.maxSellableQuantity ?? null,
          usageMultiplier: plan.usageMultiplier ?? null,
          badge: plan.badge ?? null,
          trialDays: plan.trialDays ?? 0,
          isActive: plan.isActive !== false,
          isLegacy: Boolean(plan.isLegacy),
          salesLimit: plan.salesLimit ?? 0,
          reservedSalesCount: plan.reservedSalesCount ?? 0,
          remainingSales: plan.remainingSales ?? null,
          soldOut: plan.soldOut === true,
          sortOrder: plan.sortOrder ?? 0,
          fulfillmentMode: fulfillment.fulfillmentMode,
          providerLineId: fulfillment.providerLineId,
          providerLineCode: fulfillment.providerLineCode,
          upstreamProductId: fulfillment.upstreamProductId,
          enabledModelCount: enabledModelNames.size,
          enabledModels: [...enabledModelNames].sort().slice(0, 8),
          quotaTemplateCount: boundQuotaTemplates.length,
          quotaTemplates: boundQuotaTemplates.map((template) => ({
            id: template.id,
            name: template.name,
            ruleCount: template.rules.length,
            isActive: template.isActive,
          })),
        };
      }),
      quotaTemplates,
      upstreamOrders: [],
      activations: [],
      anomalies: [],
    };
  }

  private async assertCodingPlanProduct(productId: string): Promise<CodingPlanProductSnapshot> {
    const productPayload = await this.billingClient.listProducts();
    const product = this.listPayloadItems<CodingPlanProductSnapshot>(productPayload)
      .find((item) => item.id === productId);
    if (!product) {
      throw new BadRequestException('CodingPlan 产品不存在');
    }
    if (product.billingMode !== 'CODING_PLAN') {
      throw new BadRequestException('CodingPlan 套餐只能绑定 billingMode=CODING_PLAN 的产品');
    }
    if (product.isActive === false) {
      throw new BadRequestException('CodingPlan 产品已停用，请先在产品管理启用该产品后再创建或上架套餐');
    }
    return product;
  }

  private resolveCodingPlanPlatformPackageInput(body: CodingPlanPlanWriteInput) {
    const platformPackage = body.platformPackage ?? {};
    const modelAccess = Array.isArray(platformPackage.modelAccess)
      ? platformPackage.modelAccess
        .map((item) => {
          const modelName = this.normalizeConfigText(item.modelName ?? item.model);
          if (!modelName) return null;
          return {
            modelName,
            isActive: item.isActive !== false,
            creditMultiplier: this.numberValue(item.creditMultiplier, 1),
          };
        })
        .filter((item): item is {
          modelName: string;
          isActive: boolean;
          creditMultiplier: number;
        } => Boolean(item))
      : [];

    const routePolicies = Array.isArray(platformPackage.routePolicies)
      ? platformPackage.routePolicies
        .map((item) => {
          const routeKey = this.normalizeConfigText(item.routeKey);
          if (!routeKey) return null;
          return {
            routeKey,
            primaryModel: this.normalizeConfigText(item.primaryModel) ?? null,
            fallbackModels: Array.isArray(item.fallbackModels)
              ? item.fallbackModels
                .map((model) => this.normalizeConfigText(model))
                .filter((model): model is string => Boolean(model))
              : [],
            isActive: item.isActive !== false,
          };
        })
        .filter((item): item is {
          routeKey: string;
          primaryModel: string | null;
          fallbackModels: string[];
          isActive: boolean;
        } => Boolean(item))
      : [];

    const quotaTemplateIds = Array.isArray(platformPackage.quotaTemplateIds)
      ? [...new Set(
        platformPackage.quotaTemplateIds
          .map((id) => this.normalizeConfigText(id))
          .filter((id): id is string => Boolean(id)),
      )]
      : [];

    return { modelAccess, routePolicies, quotaTemplateIds };
  }

  private async applyCodingPlanPlatformEntitlements(
    planId: string,
    platformPackage: {
      modelAccess: Array<{ modelName: string; isActive: boolean; creditMultiplier: number }>;
      routePolicies: Array<{
        routeKey: string;
        primaryModel: string | null;
        fallbackModels: string[];
        isActive: boolean;
      }>;
      quotaTemplateIds: string[];
    },
  ): Promise<void> {
    if (platformPackage.modelAccess.length > 0) {
      await this.billingClient.batchUpdateModelAccess(
        platformPackage.modelAccess.map((item) => ({
          planId,
          modelName: item.modelName,
          isActive: item.isActive,
          creditMultiplier: item.creditMultiplier,
        })),
      );
    }
    if (platformPackage.routePolicies.length > 0) {
      await this.billingClient.batchUpdateModelRoutePolicies(
        platformPackage.routePolicies.map((item) => ({
          planId,
          routeKey: item.routeKey,
          primaryModel: item.primaryModel,
          fallbackModels: item.fallbackModels,
          isActive: item.isActive,
        })),
      );
    }
    await this.billingClient.replacePlanQuotaRules(planId, {
      templateIds: platformPackage.quotaTemplateIds,
    });
  }

  private extractPlanWriteData(result: unknown): unknown {
    if (result && typeof result === 'object' && 'data' in result) {
      return (result as { data?: unknown }).data ?? null;
    }
    return result ?? null;
  }

  private planFeatureList(value: unknown): string[] {
    const raw = Array.isArray(value)
      ? value
      : typeof value === 'string'
        ? this.safeJsonArray(value)
        : [];
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private resolveCodingPlanFulfillments(
    plans: CodingPlanPlanSnapshot[],
    productsById: Map<string, CodingPlanProductSnapshot>,
    routesByPlanId: Map<string, CodingPlanResaleRouteSnapshot[]>,
  ): Map<string, CodingPlanFulfillmentSnapshot> {
    const result = new Map<string, CodingPlanFulfillmentSnapshot>();

    for (const plan of plans) {
      const productMode = plan.productId
        ? productsById.get(plan.productId)?.codingPlanFulfillmentMode
          ?? productsById.get(plan.productId)?.fulfillmentMode
          ?? null
        : null;
      const route = this.pickPrimaryCodingPlanResaleRoute(routesByPlanId.get(plan.id) ?? []);
      const isProviderResale = productMode === 'provider_resale';
      result.set(plan.id, {
        fulfillmentMode: isProviderResale ? 'provider_resale' : 'platform_model_package',
        providerLineId: isProviderResale ? route?.providerLineId ?? null : null,
        providerLineCode: isProviderResale
          ? this.normalizeConfigText(route?.providerLine?.code)
          : null,
        upstreamProductId: isProviderResale ? route?.upstreamProductId ?? null : null,
      });
    }

    return result;
  }

  private pickPrimaryCodingPlanResaleRoute(
    routes: CodingPlanResaleRouteSnapshot[],
  ): CodingPlanResaleRouteSnapshot | null {
    return [...routes].sort((a, b) => {
      const enabledDelta = Number(b.enabled !== false) - Number(a.enabled !== false);
      if (enabledDelta !== 0) return enabledDelta;
      return (b.priority ?? 0) - (a.priority ?? 0);
    })[0] ?? null;
  }

  private providerProductToWorkspaceUpstreamProduct(
    product: CodingPlanProviderProductSnapshot,
  ): CodingPlanUpstreamProduct {
    const upstreamProductId = this.normalizeConfigText(product.upstreamProductId ?? product.productId) ?? '';
    return {
      providerLineId: this.normalizeConfigText(product.providerLineId ?? product.providerLine?.id),
      providerLineCode: this.normalizeConfigText(product.providerLine?.code),
      upstreamProductId,
      productId: upstreamProductId,
      productName: this.normalizeConfigText(product.productName) ?? upstreamProductId,
      productCycle: this.normalizeConfigText(product.productCycle),
      productType: this.normalizeConfigText(product.productType),
      salePrice: product.salePrice ?? null,
      productBigTitle: this.normalizeConfigText(product.productBigTitle),
      productSmallTitle: this.normalizeConfigText(product.productSmallTitle),
      description: this.normalizeConfigText(product.description),
      productIntroduction: this.normalizeConfigText(product.productIntroduction),
      salesVolume: this.nullableNumberValue(product.salesVolume),
      dailySalesLimit: this.nullableNumberValue(product.dailySalesLimit),
      monthlySalesLimit: this.nullableNumberValue(product.monthlySalesLimit),
      yearlySalesLimit: this.nullableNumberValue(product.yearlySalesLimit),
      maxSalesLimit: this.nullableNumberValue(product.maxSalesLimit),
      source: 'synced',
      fetchedAt: this.toIsoStringOrNull(product.lastSyncedAt ?? product.updatedAt ?? product.createdAt)
        ?? new Date().toISOString(),
    };
  }

  private listPayloadItems<T>(payload: unknown): T[] {
    if (Array.isArray(payload)) return payload as T[];
    if (!payload || typeof payload !== 'object') return [];
    const items = (payload as { items?: T[] }).items;
    return Array.isArray(items) ? items : [];
  }

  private async optionalBillingSnapshot<T>(
    label: string,
    loader: () => Promise<T> | T,
    fallback: T,
    onError?: () => void,
  ): Promise<T> {
    try {
      return await loader();
    } catch (error) {
      onError?.();
      this.logger.warn(
        `${label} snapshot failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return fallback;
    }
  }

  private async listAllCodingPlanQuotaTemplates(): Promise<CodingPlanQuotaTemplateSnapshot[]> {
    const all: CodingPlanQuotaTemplateSnapshot[] = [];
    let page = 1;

    while (true) {
      const payload = await this.billingClient.listQuotaTemplates({
        page,
        pageSize: BILLING_PAGE_SIZE_MAX,
      });
      const pageItems = this.listPayloadItems<CodingPlanQuotaTemplateSnapshot>(payload);
      all.push(...pageItems);

      const declaredTotal = this.listPayloadDeclaredTotal(payload);
      if (pageItems.length < BILLING_PAGE_SIZE_MAX) break;
      if (declaredTotal != null && all.length >= declaredTotal) break;
      page += 1;
    }

    return all;
  }

  private listPayloadDeclaredTotal(payload: unknown): number | null {
    if (!payload || typeof payload !== 'object') return null;
    const total = (payload as { total?: unknown }).total;
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  }

  private toIsoStringOrNull(value?: string | Date | null): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    return value;
  }

  private listPayloadTotal(payload: unknown): number {
    if (Array.isArray(payload)) return payload.length;
    if (!payload || typeof payload !== 'object') return 0;
    const total = (payload as { total?: unknown }).total;
    if (typeof total === 'number' && Number.isFinite(total)) return total;
    return this.listPayloadItems<unknown>(payload).length;
  }

  private configText(key: string, fallback: string): string {
    const value = this.config.get<string>(key)?.trim();
    return value || fallback;
  }

  private normalizeConfigText(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text || null;
  }

  private stringValue(value: unknown, fallback: string): string {
    const text = this.normalizeConfigText(value);
    return text ?? fallback;
  }

  private integerValue(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : fallback;
  }

  private numberValue(value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === '') return fallback;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  private nullableNumberValue(value: unknown): number | null {
    if (value === undefined || value === null || value === '') return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
  }

  private booleanValue(value: unknown, fallback: boolean): boolean {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      if (value.toLowerCase() === 'true') return true;
      if (value.toLowerCase() === 'false') return false;
    }
    return fallback;
  }

  private safeJsonArray(value: string): unknown[] {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private resolveCodingPlanReadiness(
    product: CodingPlanProductSnapshot,
    integration: CodingPlanIntegrationSnapshot | null,
    plans: CodingPlanPlanSnapshot[],
  ): CodingPlanReadiness {
    if (product.isActive === false) return 'disabled';
    const hasIntegrationToken = Boolean(
      integration?.credentials?.hasIntegrationToken || product.integrationTokenPrefix,
    );
    if (!hasIntegrationToken) return 'credential_missing';
    if (plans.length === 0) return 'plan_missing';
    if (!plans.some((plan) => plan.isActive !== false && !plan.isLegacy)) {
      return 'no_sellable_plan';
    }
    return 'ready';
  }

  async grantSubscriptionCredits(
    subscriptionId: string,
    amount: number,
    reason: string,
    idempotencyKey?: string,
  ) {
    return this.billingClient.grantSubscriptionCredits(subscriptionId, {
      amount,
      reason,
      idempotencyKey,
    });
  }

  async listPaygAccounts(params: {
    page: number;
    pageSize: number;
    search?: string;
    email?: string;
    status?: string;
    productId?: string;
  }) {
    return this.billingClient.listPaygAccounts(params);
  }

  async issuePaygVoucher(tenantId: string, body: {
    userId: string;
    productId?: string | null;
    amountCents: number;
    reason: string;
    expiresAt?: string | null;
    idempotencyKey?: string;
  }, performedBy: string) {
    return this.billingClient.issuePaygVoucher(tenantId, {
      ...body,
      performedBy,
    });
  }

  // ============================
  // 会话
  // ============================

  async getSessionStats() {
    return this.userClient.getSessionStats();
  }

  async listSessions(page: number, pageSize: number) {
    return this.userClient.listSessions(page, pageSize);
  }

  // ============================
  // 监控
  // ============================

  async getChannelHealth() {
    return this.billingClient.getChannelHealth();
  }

  async listChannels(page: number, pageSize: number) {
    return this.billingClient.listChannels(page, pageSize);
  }

  async listProviderAccountIdentities() {
    return this.billingClient.listProviderAccountIdentities();
  }

  async createProviderAccountIdentity(body: Record<string, unknown>) {
    return this.billingClient.createProviderAccountIdentity(body);
  }

  async deactivateProviderAccountIdentity(id: string) {
    return this.billingClient.deactivateProviderAccountIdentity(id);
  }

  async getChannelProtocolTemplates() {
    return this.billingClient.getChannelProtocolTemplates();
  }

  async getChannel(id: string) {
    return this.billingClient.getChannel(id);
  }

  async createChannel(body: Record<string, unknown>) {
    return this.billingClient.createChannel(body);
  }

  async previewChannelPublisherCompile(body: Record<string, unknown>) {
    return this.billingClient.previewChannelPublisherCompile(body);
  }

  async updateChannel(id: string, body: Record<string, unknown>) {
    return this.billingClient.updateChannel(id, body);
  }

  async deleteChannel(id: string) {
    return this.billingClient.deleteChannel(id);
  }

  async testChannel(id: string) {
    return this.billingClient.testChannel(id);
  }

  async resetChannelStats(id: string) {
    return this.billingClient.resetChannelStats(id);
  }

  async discoverChannelModels(id: string) {
    return this.billingClient.discoverChannelModels(id);
  }

  async getAgentObservability(params: { days?: number; recentLimit?: number }) {
    const baseUrl = (
      this.config.get<string>('CODESPHERE_SAAS_BASE_URL') ||
      this.config.get<string>('SAAS_BASE_URL') ||
      ''
    ).trim();
    const syncToken = (
      this.config.get<string>('CODESPHERE_SAAS_SYNC_TOKEN') ||
      this.config.get<string>('SYNC_TOKEN') ||
      ''
    ).trim();

    if (!baseUrl || !syncToken) {
      return this.emptyAgentObservability(
        'not_configured',
        '未配置 CODESPHERE_SAAS_BASE_URL 或 SYNC_TOKEN，无法读取 SaaS Agent 指标。',
      );
    }

    let url: URL;
    try {
      url = new URL('/api/mgmt/agent-observability/summary', baseUrl);
    } catch {
      return this.emptyAgentObservability(
        'invalid_base_url',
        'CODESPHERE_SAAS_BASE_URL 不是有效 URL。',
      );
    }

    url.searchParams.set('days', String(Math.min(Math.max(params.days || 7, 1), 30)));
    url.searchParams.set('recent_limit', String(Math.min(Math.max(params.recentLimit || 20, 1), 100)));

    try {
      const res = await fetch(url, {
        headers: { 'X-Sync-Token': syncToken },
        signal: AbortSignal.timeout(10_000),
      });
      const text = await res.text();
      if (!res.ok) {
        return this.emptyAgentObservability(
          `saas_${res.status}`,
          text || `SaaS Agent 指标接口返回 ${res.status}`,
        );
      }
      return JSON.parse(text) as unknown;
    } catch (err) {
      return this.emptyAgentObservability(
        'request_failed',
        err instanceof Error ? err.message : '读取 SaaS Agent 指标失败。',
      );
    }
  }

  async listAlerts() {
    return this.repo.findAlerts();
  }

  async createAlert(body: {
    name: string;
    metric?: string;
    condition: string;
    threshold?: number;
    windowMinutes?: number;
  }) {
    if (!body.name || !body.condition) throw new BadRequestException('name, condition 为必填');
    return this.repo.createAlert({
      name: body.name,
      metric: body.metric ?? '',
      condition: body.condition,
      threshold: body.threshold ?? 0,
      windowMinutes: body.windowMinutes ?? 5,
    });
  }

  async updateAlert(id: string, body: Record<string, unknown>) {
    const allowedFields = ['name', 'metric', 'condition', 'threshold', 'windowMinutes', 'isActive'];
    const updateData: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (body[key] !== undefined) updateData[key] = body[key];
    }
    return this.repo.updateAlert(id, updateData as never);
  }

  async deleteAlert(id: string) {
    await this.repo.deleteAlert(id);
  }

  // ============================
  // 公告
  // ============================

  async listAnnouncements(page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.repo.findAnnouncements(skip, pageSize),
      this.repo.countAnnouncements(),
    ]);
    return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }

  async createAnnouncement(body: {
    title: string;
    content: string;
    type?: string;
    targetAudience?: string;
  }) {
    if (!body.title || !body.content) throw new BadRequestException('title, content 为必填');
    return this.repo.createAnnouncement({
      title: body.title,
      content: body.content,
      type: body.type ?? 'info',
      targetAudience: body.targetAudience ?? 'all',
    });
  }

  async updateAnnouncement(id: string, body: { title?: string; content?: string; type?: string; targetAudience?: string }) {
    const item = await this.repo.findAnnouncementById(id);
    if (!item) throw new BadRequestException('公告不存在');
    return this.repo.updateAnnouncement(id, body);
  }

  async toggleAnnouncement(id: string) {
    const item = await this.repo.findAnnouncementById(id);
    if (!item) throw new BadRequestException('公告不存在');
    const updated = await this.repo.updateAnnouncement(id, { isActive: !item.isActive });
    return { message: updated.isActive ? '已发布' : '已下线', data: updated };
  }

  async deleteAnnouncement(id: string) {
    const item = await this.repo.findAnnouncementById(id);
    if (!item) throw new BadRequestException('公告不存在');
    await this.repo.deleteAnnouncement(id);
  }

  // ============================
  // 功能开关
  // ============================

  async listFeatureFlags() {
    return this.repo.findFeatureFlags();
  }

  async upsertFeatureFlag(body: {
    key: string;
    value: boolean;
    description?: string;
    scope?: string;
    scopeValue?: string | null;
  }) {
    if (!body.key) throw new BadRequestException('key 为必填');
    return this.repo.upsertFeatureFlag(body.key, {
      value: body.value,
      description: body.description ?? '',
      scope: body.scope ?? 'global',
      scopeValue: body.scopeValue ?? null,
    });
  }

  // ============================
  // 系统提示
  // ============================

  async listSystemPrompts() {
    return this.repo.findSystemPrompts();
  }

  async upsertSystemPrompt(body: {
    id?: string;
    name?: string;
    key?: string;
    content: string;
    description?: string;
  }) {
    const promptKey = body.name || body.key;
    if (!promptKey || !body.content) throw new BadRequestException('name/key, content 为必填');

    const existing = body.id
      ? await this.repo.findSystemPromptById(body.id)
      : await this.repo.findSystemPromptByKey(promptKey);

    const newVersion = existing ? existing.version + 1 : 1;

    return this.repo.upsertSystemPrompt(
      existing?.key ?? promptKey,
      { content: body.content, description: body.description ?? '', name: promptKey, version: newVersion },
      { key: promptKey, name: promptKey, content: body.content, description: body.description ?? '', version: 1 },
    );
  }

  // ============================
  // 系统配置
  // ============================

  async getPublicPlatformConfig() {
    const snapshot = await this.getCurrentDeploymentConfig();
    return {
      platformConfig: {
        region: snapshot.region,
        currency: snapshot.currency,
        ...(snapshot.defaultLanguage ? { defaultLanguage: snapshot.defaultLanguage } : {}),
      },
    };
  }

  async getSystemConfig() {
    const configs = await this.repo.findSystemConfigs();
    const result: Record<string, unknown> = {};
    for (const c of configs) {
      try {
        const parsed = JSON.parse(c.value);
        result[c.key] = c.key === CODING_PLAN_PROVIDER_CREDENTIAL_CONFIG_KEY
          ? this.redactCodingPlanProviderCredentialStore(parsed)
          : parsed;
      } catch {
        result[c.key] = c.value;
      }
    }
    const deploymentRow = configs.find((config) => config.key === 'deploymentConfig');
    const snapshot = deploymentRow
      ? snapshotFromRow(deploymentRow)
      : await this.getCurrentDeploymentConfig();
    result.deploymentConfig = snapshot;
    result.platformConfig = {
      region: snapshot.region,
      currency: snapshot.currency,
      ...(snapshot.defaultLanguage ? { defaultLanguage: snapshot.defaultLanguage } : {}),
    };
    result.authConfig = { provider: snapshot.provider, derivedFrom: 'region' };
    result.oauthConfig = snapshot.oauth;
    return result;
  }

  async updateSystemConfig(body: Record<string, unknown>) {
    const normalizedBody = { ...body };
    if (normalizedBody['authConfig'] !== undefined) {
      throw new BadRequestException('登录身份源由部署区域自动派生，不能单独修改');
    }
    if (
      normalizedBody['deploymentConfig'] !== undefined ||
      normalizedBody['deploymentConfigSyncStatus'] !== undefined
    ) {
      throw new BadRequestException('deploymentConfig 是系统保留快照，请通过平台运行时或 OAuth 配置修改');
    }

    const platformConfig = normalizedBody['platformConfig'] === undefined
      ? undefined
      : this.normalizePlatformConfig(normalizedBody['platformConfig']);
    const oauthConfig = normalizedBody['oauthConfig'] === undefined
      ? undefined
      : this.normalizeOAuthConfig(normalizedBody['oauthConfig']);

    let deploymentConfig: DeploymentConfigSnapshot | undefined;
    let deploymentConfigSyncStatus: DeploymentConfigSyncStatus | undefined;
    if (platformConfig || oauthConfig !== undefined) {
      deploymentConfig = await this.persistDeploymentConfig(platformConfig, oauthConfig);
      deploymentConfigSyncStatus = await this.deploymentSync.syncNow(deploymentConfig);
      delete normalizedBody['platformConfig'];
      delete normalizedBody['oauthConfig'];
    }

    const storageConfig = compactRecord(normalizedBody['storageConfig']);
    if (normalizedBody['storageConfig'] !== undefined) {
      const normalizedStorageConfig = storageConfig ?? {};
      const provider =
        normalizeStorageProvider(
          normalizedStorageConfig.provider ??
            normalizedStorageConfig.storageProvider ??
            normalizedStorageConfig.objectStoreProvider,
        ) ?? inferStorageProvider(normalizedStorageConfig);
      if (provider) normalizedStorageConfig.provider = provider;
      stripInactiveStorageProviderFields(normalizedStorageConfig);
      stripDeploymentStorageFields(normalizedStorageConfig);
      normalizedBody['storageConfig'] = normalizedStorageConfig;
    }

    for (const [key, value] of Object.entries(normalizedBody)) {
      if (key === CODING_PLAN_PROVIDER_CREDENTIAL_CONFIG_KEY) {
        continue;
      }
      const strValue = typeof value === 'string' ? value : JSON.stringify(value);
      await this.repo.upsertSystemConfig(key, strValue);
    }

    const normalizedStorageConfig = normalizedBody['storageConfig'];
    if (
      normalizedStorageConfig &&
      typeof normalizedStorageConfig === 'object' &&
      !Array.isArray(normalizedStorageConfig) &&
      Object.keys(normalizedStorageConfig).length > 0
    ) {
      try {
        await this.billingClient.syncStorageConfig(normalizedStorageConfig as Record<string, unknown>);
      } catch (err) {
        this.logger.warn(
          `下发对象存储配置到 billing 失败: ${(err as Error)?.message ?? err}`,
        );
      }
    }

    return {
      ...(deploymentConfig ? { deploymentConfig } : {}),
      ...(deploymentConfigSyncStatus ? { deploymentConfigSyncStatus } : {}),
    };
  }

  private async persistDeploymentConfig(
    platformConfig: PlatformConfig | undefined,
    oauthConfig: DeploymentOAuthPublicConfig | undefined,
  ): Promise<DeploymentConfigSnapshot> {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const current = await this.getCurrentDeploymentConfig();
      const nextRegion = platformConfig?.region ?? current.region;
      const stored = {
        region: nextRegion,
        currency: platformConfig?.currency ?? current.currency,
        defaultLanguage:
          platformConfig?.defaultLanguage ??
          current.defaultLanguage ??
          (nextRegion === 'domestic' ? 'zh' : 'en'),
        oauth: oauthConfig ?? current.oauth,
      };
      const row = await this.repo.upsertDeploymentConfig(
        JSON.stringify(stored),
        BigInt(current.version),
      );
      if (row) return snapshotFromRow(row);
    }
    throw new ConflictException('部署配置正在被并发修改，请重试');
  }

  private async getCurrentDeploymentConfig(): Promise<DeploymentConfigSnapshot> {
    const deploymentRow = await this.repo.findSystemConfig('deploymentConfig');
    if (deploymentRow) return snapshotFromRow(deploymentRow);

    const rows = await this.repo.findSystemConfigs();
    const legacy = new Map(rows.map((row) => [row.key, parseJsonObject(row.value)]));
    const platform = legacy.get('platformConfig') ?? {};
    const auth = legacy.get('authConfig') ?? {};
    const region =
      this.normalizePlatformRegionOptional(platform.region) ??
      this.normalizePlatformRegionOptional(this.config.get<string>('PLATFORM_REGION')) ??
      regionForProvider(auth.provider) ??
      regionForProvider(this.config.get<string>('AUTH_PROVIDER')) ??
      'overseas';
    const currency = /^[a-z]{3}$/i.test(String(platform.currency ?? '').trim())
      ? String(platform.currency).trim().toLowerCase()
      : region === 'domestic' ? 'cny' : 'usd';
    const defaultLanguage = this.normalizePlatformLanguageOptional(platform.defaultLanguage) ??
      (region === 'domestic' ? 'zh' : 'en');

    return {
      version: '0',
      region,
      provider: authProviderForRegion(region),
      currency,
      defaultLanguage,
      oauth: this.normalizeOAuthConfig(legacy.get('oauthConfig') ?? {}),
    };
  }

  private normalizeOAuthConfig(value: unknown): DeploymentOAuthPublicConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('OAuth 公开配置必须是对象');
    }
    const source = value as Record<string, unknown>;
    const output: DeploymentOAuthPublicConfig = {};
    for (const key of OAUTH_PUBLIC_KEYS) {
      const raw = source[key];
      if (typeof raw === 'string' && raw.trim()) output[key] = raw.trim();
    }
    return output;
  }

  private normalizePlatformConfig(value: unknown): PlatformConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('平台运行时配置必须是对象');
    }
    const src = value as Record<string, unknown>;
    const region = this.normalizePlatformRegion(src.region);
    return {
      region,
      currency: this.normalizePlatformCurrency(src.currency),
      defaultLanguage:
        this.normalizePlatformLanguageOptional(src.defaultLanguage) ??
        (region === 'domestic' ? 'zh' : 'en'),
    };
  }

  private normalizePlatformCurrency(value: unknown): string {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (!/^[a-z]{3}$/.test(normalized)) {
      throw new BadRequestException('平台币种必须是 3 位币种代码');
    }
    return normalized;
  }

  private normalizePlatformLanguageOptional(value: unknown): DeploymentLanguage | undefined {
    if (value == null || value === '') return undefined;
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'zh' || normalized === 'zh-cn') return 'zh';
    if (normalized === 'en' || normalized === 'en-us') return 'en';
    throw new BadRequestException('默认语言必须是 zh 或 en');
  }

  private normalizePlatformRegion(value: unknown): DeploymentRegion {
    const region = this.normalizePlatformRegionOptional(value);
    if (region) return region;
    throw new BadRequestException('部署区域必须是 domestic 或 overseas');
  }

  private normalizePlatformRegionOptional(value: unknown): DeploymentRegion | undefined {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === 'domestic' || normalized === 'cn' || normalized === 'china') return 'domestic';
    if (normalized === 'overseas' || normalized === 'global' || normalized === 'intl') return 'overseas';
    return undefined;
  }

  private redactCodingPlanProviderCredentialStore(value: unknown): unknown {
    if (!value || typeof value !== 'object') return value;
    const redacted: Record<string, unknown> = {};
    for (const [profileId, rawProfile] of Object.entries(value as Record<string, unknown>)) {
      if (!rawProfile || typeof rawProfile !== 'object') {
        redacted[profileId] = rawProfile;
        continue;
      }
      const profile = { ...(rawProfile as Record<string, unknown>) };
      const partnerSecretConfigured = Boolean(profile.partnerSecretKey);
      delete profile.partnerSecretKey;
      delete profile.partnerUserId;
      redacted[profileId] = {
        ...profile,
        partnerSecretConfigured,
      };
    }
    return redacted;
  }

  // ============================
  // 支付实例管理
  // ============================

  async listPaymentInstances() {
    return this.billingClient.listPaymentInstances();
  }

  async createPaymentInstance(body: Record<string, unknown>) {
    return this.billingClient.createPaymentInstance(body);
  }

  async updatePaymentInstance(id: string, body: Record<string, unknown>) {
    return this.billingClient.updatePaymentInstance(id, body);
  }

  async deletePaymentInstance(id: string) {
    return this.billingClient.deletePaymentInstance(id);
  }

  // ============================
  // 滚动配额 gate 运行时开关（CodingPlan 自营套餐配额执行）— 委派 billing
  // ============================

  async getRollingQuotaGate() {
    return this.billingClient.getRollingQuotaGate();
  }

  async setRollingQuotaGate(enabled: boolean | null, operatorAdminId?: string) {
    const before = await this.billingClient.getRollingQuotaGate().catch(() => undefined);
    const after = await this.billingClient.setRollingQuotaGate(enabled);
    if (operatorAdminId) {
      this.activityLog.log({
        adminMemberId: operatorAdminId,
        operatorAdminId,
        action: 'rolling_quota_gate.update',
        resource: 'SystemConfig',
        resourceId: 'rolling_quota_gate_enabled',
        before,
        after,
        detail: { enabled },
      });
    }
    return after;
  }

  // R3b 月度补发 / R6 终态负额结算 运行时开关 — 委派 billing（开关依赖守卫在 billing 侧强制）
  async getCodingPlanMonthlyRefresh() {
    return this.billingClient.getCodingPlanMonthlyRefresh();
  }

  async setCodingPlanMonthlyRefresh(enabled: boolean | null, operatorAdminId?: string) {
    const before = await this.billingClient.getCodingPlanMonthlyRefresh().catch(() => undefined);
    const after = await this.billingClient.setCodingPlanMonthlyRefresh(enabled);
    if (operatorAdminId) {
      this.activityLog.log({
        adminMemberId: operatorAdminId,
        operatorAdminId,
        action: 'coding_plan_monthly_refresh.update',
        resource: 'SystemConfig',
        resourceId: 'coding_plan_monthly_refresh_enabled',
        before,
        after,
        detail: { enabled },
      });
    }
    return after;
  }

  async debugGetBalance(entitlementId: string) {
    return this.billingClient.debugGetBalance(entitlementId);
  }

  async debugSetEntitlementDates(
    entitlementId: string,
    startedAt: string | undefined,
    expiresAt: string | undefined,
    operatorAdminId?: string,
  ) {
    const after = await this.billingClient.debugSetEntitlementDates(entitlementId, startedAt, expiresAt);
    if (operatorAdminId) {
      this.activityLog.log({
        adminMemberId: operatorAdminId,
        operatorAdminId,
        action: 'coding_plan_monthly_refresh.debug_set_dates',
        resource: 'CodingPlanEntitlement',
        resourceId: entitlementId,
        detail: { startedAt, expiresAt },
      });
    }
    return after;
  }

  async debugResetMonthlyRefresh(entitlementId: string, operatorAdminId?: string, tag?: string) {
    const after = await this.billingClient.debugResetMonthlyRefresh(entitlementId, tag);
    if (operatorAdminId) {
      this.activityLog.log({
        adminMemberId: operatorAdminId,
        operatorAdminId,
        action: 'coding_plan_monthly_refresh.debug_reset',
        resource: 'CodingPlanEntitlement',
        resourceId: entitlementId,
        detail: { entitlementId },
      });
    }
    return after;
  }

  async getSelfopNegativeDeduct() {
    return this.billingClient.getSelfopNegativeDeduct();
  }

  async setSelfopNegativeDeduct(enabled: boolean | null, operatorAdminId?: string) {
    const before = await this.billingClient.getSelfopNegativeDeduct().catch(() => undefined);
    const after = await this.billingClient.setSelfopNegativeDeduct(enabled);
    if (operatorAdminId) {
      this.activityLog.log({
        adminMemberId: operatorAdminId,
        operatorAdminId,
        action: 'selfop_negative_deduct.update',
        resource: 'SystemConfig',
        resourceId: 'selfop_negative_deduct_enabled',
        before,
        after,
        detail: { enabled },
      });
    }
    return after;
  }

  // ============================
  // 模型定价 — 委派给 billing-api 内部接口
  // ============================

  async listModelPricing() {
    return this.billingClient.listModelPricing();
  }

  async upsertModelPricing(data: {
    modelName: string;
    inputPricePerMToken: number;
    outputPricePerMToken: number;
    isActive?: boolean;
    // v2 catalog fields (PR4) — passed through to billing validation.
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
  }) {
    return this.billingClient.upsertModelPricing(data);
  }

  async syncModelPricingFromProxy() {
    return this.billingClient.syncModelPricingFromProxy();
  }

  async deactivateOrphanModelPricing(confirm: boolean) {
    return this.billingClient.deactivateOrphanModelPricing(confirm);
  }

  async publishAllActiveModelPricing() {
    return this.billingClient.publishAllActiveModelPricing();
  }

  async deleteModelPricing(modelName: string) {
    return this.billingClient.deleteModelPricing(modelName);
  }

  // ============================
  // 按量产品模型定价
  // ============================

  async listPaygModelPricing(productId: string) {
    return this.billingClient.listPaygModelPricing(productId);
  }

  async listPaygProductModelCandidates(productId: string) {
    return this.billingClient.listPaygProductModelCandidates(productId);
  }

  async addPaygProductModels(data: PaygProductModelRequest) {
    return this.billingClient.addPaygProductModels(data);
  }

  async updatePaygProductModel(id: string, data: PaygProductModelUpdateRequest) {
    return this.billingClient.updatePaygProductModel(id, data);
  }

  async retirePaygProductModel(id: string) {
    return this.billingClient.retirePaygProductModel(id);
  }

  async createPaygModelPricingVersion(data: {
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
  }) {
    // 按量定价只支持倍率：这里构造**倍率白名单 DTO**，四个已废除的绝对覆盖价字段
    // 一律不向 billing 转发（即便入参带 null/空白也删掉）。
    // 否则在"admin 已发布、billing 未滚完"的窗口内，旧 billing 会把 '   ' 当 0 落库成零覆盖价。
    return this.billingClient.createPaygModelPricingVersion({
      productId: data.productId,
      modelName: data.modelName,
      priceMultiplier: data.priceMultiplier,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      isActive: data.isActive,
      description: data.description,
    });
  }

  async deactivatePaygModelPricingPolicy(id: string) {
    return this.billingClient.deactivatePaygModelPricingPolicy(id);
  }

  async listProviderCostPolicies(query: Record<string, unknown>) {
    return this.billingClient.listProviderCostPolicies({
      productId: typeof query.productId === 'string' ? query.productId : undefined,
      providerCode: typeof query.providerCode === 'string' ? query.providerCode : undefined,
      providerLineId: typeof query.providerLineId === 'string' ? query.providerLineId : undefined,
      modelName: typeof query.modelName === 'string' ? query.modelName : undefined,
      effectiveAt: typeof query.effectiveAt === 'string' ? query.effectiveAt : undefined,
      activeOnly: typeof query.activeOnly === 'string' ? query.activeOnly : undefined,
    });
  }

  async createProviderCostPolicy(body: Record<string, unknown>) {
    return this.billingClient.createProviderCostPolicy(body as ProviderCostPolicyRequest);
  }

  async deactivateProviderCostPolicy(id: string) {
    return this.billingClient.deactivateProviderCostPolicy(id);
  }

  async deleteProviderCostPolicy(id: string) {
    return this.billingClient.deleteProviderCostPolicy(id);
  }

  async backfillProviderCostTokenUsage(body: Record<string, unknown>) {
    return this.billingClient.backfillProviderCostTokenUsage(body);
  }

  async listUsagePricingPolicies(productId?: string) {
    return this.billingClient.listUsagePolicies(productId);
  }

  async createUsagePricingPolicy(body: Record<string, unknown>) {
    return this.billingClient.createUsagePolicy(body);
  }

  async updateUsagePricingPolicy(id: string, body: Record<string, unknown>) {
    return this.billingClient.updateUsagePolicy(id, body);
  }

  async deleteUsagePricingPolicy(id: string) {
    return this.billingClient.deleteUsagePolicy(id);
  }

  // ============================
  // 模型访问矩阵 — 委派给 billing-api 内部接口
  // ============================

  async listModelAccess() {
    return this.billingClient.listModelAccess();
  }

  async batchUpdateModelAccess(items: {
    tierId?: string;
    planId?: string;
    modelName?: string;
    model?: string;
    isActive?: boolean;
    isAllowed?: boolean;
    creditMultiplier?: number;
  }[]) {
    return this.billingClient.batchUpdateModelAccess(items);
  }

  async listModelRoutePolicies() {
    return this.billingClient.listModelRoutePolicies();
  }

  async batchUpdateModelRoutePolicies(items: {
    planId?: string;
    routeKey?: string;
    primaryModel?: string | null;
    fallbackModels?: string[];
    isActive?: boolean;
  }[]) {
    return this.billingClient.batchUpdateModelRoutePolicies(items);
  }

  // ============================
  // 管理端角色管理
  // ============================

  async listRoles() {
    const roles = await this.repo.findRoles();
    return roles.map((r) => ({
      ...r,
      memberCount: r._count.members,
      _count: undefined,
    }));
  }

  async getRoleById(id: string) {
    const role = await this.repo.findRoleById(id);
    if (!role) throw new BadRequestException('角色不存在');
    return {
      ...role,
      memberCount: role._count.members,
      _count: undefined,
    };
  }

  async createRole(
    body: { name: string; description?: string; permissions?: string; key?: string; sortOrder?: number },
    operatorAdminId?: string,
  ) {
    if (!body.name || !body.name.trim()) {
      throw new BadRequestException('角色名称不能为空');
    }
    const role = await this.repo.createRole(body);
    this.logRbacActivity(operatorAdminId, 'role.created', {
      resource: 'AdminRole',
      resourceId: role.id,
      after: {
        name: role.name,
        key: role.key,
        permissions: role.permissions,
        isActive: role.isActive,
        sortOrder: role.sortOrder,
      },
      detail: {
        roleId: role.id,
        name: role.name,
        key: role.key,
        permissions: role.permissions,
      },
    });
    return role;
  }

  async updateRole(
    roleId: string,
    body: { name?: string; description?: string; permissions?: string; key?: string; isActive?: boolean; sortOrder?: number },
    operatorAdminId?: string,
  ) {
    const existing = await this.repo.findRoleById(roleId);
    if (!existing) throw new BadRequestException('角色不存在');

    // 系统角色不可修改 key
    if (existing.isSystem && body.key !== undefined && body.key !== existing.key) {
      throw new ForbiddenException('系统角色不可修改 key');
    }

    const result = await this.repo.updateRole(roleId, body);
    const before = {
      name: existing.name,
      key: existing.key,
      permissions: existing.permissions,
      isActive: existing.isActive,
      sortOrder: existing.sortOrder,
    };
    const after = {
      name: result.name,
      key: result.key,
      permissions: result.permissions,
      isActive: result.isActive,
      sortOrder: result.sortOrder,
    };
    this.logRbacActivity(operatorAdminId, 'role.updated', {
      resource: 'AdminRole',
      resourceId: roleId,
      before,
      after,
      detail: {
        roleId,
        changedFields: Object.keys(body),
      },
    });

    // T-198: 权限或状态变更时，清除该角色所有成员的 Redis 权限缓存
    if (body.permissions !== undefined || body.isActive !== undefined) {
      const memberIds = await this.repo.findMemberIdsByRoleId(roleId);
      await Promise.all(
        memberIds.map((mid) => this.redis.del(adminPermissionCacheKey(mid))),
      );
    }

    return result;
  }

  async deleteRole(roleId: string, operatorAdminId?: string) {
    const existing = await this.repo.findRoleById(roleId);
    if (!existing) throw new BadRequestException('角色不存在');
    if (existing.isSystem) throw new ForbiddenException('系统角色不可删除');
    if (existing._count.members > 0) {
      throw new BadRequestException('该角色下还有成员，无法删除');
    }
    await this.repo.deleteRole(roleId);
    this.logRbacActivity(operatorAdminId, 'role.deleted', {
      resource: 'AdminRole',
      resourceId: roleId,
      before: {
        name: existing.name,
        key: existing.key,
        permissions: existing.permissions,
        isActive: existing.isActive,
        sortOrder: existing.sortOrder,
      },
      detail: {
        roleId,
        name: existing.name,
        key: existing.key,
        permissions: existing.permissions,
      },
    });
  }

  // ============================
  // 管理员成员管理（独立账号体系）
  // ============================

  async listAdminMembers() {
    const members = await this.repo.findAdminMembers();
    return Promise.all(members.map(async (m) => {
      const presetRole = m.presetRole;
      const isActive = m.isActive;
      const invitedBy = m.invitedBy;
      const createdAt = m.createdAt;
      const updatedAt = m.updatedAt;
      let overrides: Partial<Record<AdminPermissionAtom, boolean>> = {};
      try { overrides = JSON.parse(m.permissions || '{}'); } catch { /* ignore */ }
      return {
        id: m.id,
        email: m.email,
        nickname: m.nickname,
        name: m.name,
        phone: m.phone,
        department: m.department,
        presetRole,
        roleId: m.roleId,
        roleName: m.roleName ?? null,
        permissions: overrides,
        resolvedPermissions: await this.resolvePermissionsForMember(m),
        isActive,
        invitedBy,
        lastLoginAt: m.lastLoginAt ? new Date(m.lastLoginAt).toISOString() : null,
        createdAt: createdAt ? new Date(createdAt).toISOString() : null,
        updatedAt: updatedAt ? new Date(updatedAt).toISOString() : null,
      };
    }));
  }

  async inviteAdminMember(
    email: string,
    roleId: string,
    invitedById: string,
    options?: { name?: string; phone?: string; department?: string },
  ) {
    // 检查是否已存在该 email 的管理员
    const existing = await this.repo.findAdminMemberByEmail(email);
    if (existing) throw new BadRequestException('该邮箱已是管理员');

    // 验证 roleId 对应角色存在且 active
    let presetRole = 'viewer'; // default fallback
    if (roleId) {
      const role = await this.repo.findRoleById(roleId);
      if (!role) throw new BadRequestException('指定角色不存在');
      if (!role.isActive) throw new BadRequestException('指定角色已停用');
      presetRole = role.key ?? 'custom';
    }

    // 生成随机密码（12位字母数字）
    const plainPassword = crypto.randomBytes(6).toString('hex'); // 12 chars hex
    const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

    // 直接在 admin_members 表创建记录
    const member = await this.repo.createAdminMember({
      email,
      password: hashedPassword,
      nickname: options?.name || email.split('@')[0],
      presetRole,
      invitedBy: invitedById,
      roleId: roleId || null,
      name: options?.name || '',
      phone: options?.phone || null,
      department: options?.department || null,
      mustChangePassword: true,
    });

    // 记录活动日志
    this.activityLog.log({
      adminMemberId: member.id,
      action: 'member.invited',
      operatorAdminId: invitedById,
      resource: 'AdminMember',
      resourceId: member.id,
      after: {
        email: member.email,
        roleId: member.roleId,
        presetRole: member.presetRole,
        isActive: member.isActive,
      },
      detail: { email, roleId },
    });

    // 返回明文密码（只显示一次）
    return { ...member, temporaryPassword: plainPassword };
  }

  async updateAdminMember(
    id: string,
    data: {
      presetRole?: string;
      permissions?: Partial<Record<AdminPermissionAtom, boolean>>;
      isActive?: boolean;
      roleId?: string;
      name?: string;
      phone?: string;
      department?: string;
    },
    operatorAdminId?: string,
  ) {
    const existing = await this.repo.findAdminMemberById(id);
    if (!existing) throw new BadRequestException('管理员不存在');
    if (existing.presetRole === 'super_admin') throw new ForbiddenException('根管理员不可编辑');
    if (data.presetRole === 'super_admin') throw new ForbiddenException('不允许将成员提升为 Super Admin');

    const updateData: {
      presetRole?: string;
      permissions?: string;
      isActive?: boolean;
      roleId?: string | null;
      name?: string;
      phone?: string | null;
      department?: string | null;
    } = {};
    if (data.presetRole !== undefined) updateData.presetRole = data.presetRole;
    if (data.permissions !== undefined) updateData.permissions = JSON.stringify(data.permissions);
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.name !== undefined) updateData.name = data.name;
    if (data.phone !== undefined) updateData.phone = data.phone || null;
    if (data.department !== undefined) updateData.department = data.department || null;

    // 如果 roleId 变更，验证新角色存在且 active
    if (data.roleId !== undefined) {
      if (data.roleId) {
        const role = await this.repo.findRoleById(data.roleId);
        if (!role) throw new BadRequestException('指定角色不存在');
        if (!role.isActive) throw new BadRequestException('指定角色已停用');
        updateData.roleId = data.roleId;
        // 同时更新 presetRole 保持向后兼容
        updateData.presetRole = role.key ?? 'custom';
      } else {
        updateData.roleId = null;
      }
    }

    const updated = await this.repo.updateAdminMember(id, updateData);

    // 清除 Redis 权限缓存
    await this.redis.del(adminPermissionCacheKey(existing.id));

    const rbacFields = ['presetRole', 'permissions', 'isActive', 'roleId'].filter(
      (field) => data[field as keyof typeof data] !== undefined,
    );
    if (rbacFields.length > 0) {
      this.activityLog.log({
        adminMemberId: id,
        operatorAdminId,
        action: 'member.rbac.updated',
        resource: 'AdminMember',
        resourceId: id,
        before: {
          presetRole: existing.presetRole,
          permissions: existing.permissions,
          isActive: existing.isActive,
          roleId: existing.roleId,
        },
        after: {
          presetRole: updated.presetRole,
          permissions: updated.permissions,
          isActive: updated.isActive,
          roleId: updated.roleId,
        },
        detail: {
          changedFields: rbacFields,
        },
      });
    }

    return updated;
  }

  async removeAdminMember(id: string) {
    const existing = await this.repo.findAdminMemberById(id);
    if (!existing) throw new BadRequestException('管理员不存在');
    if (existing.presetRole === 'super_admin') throw new ForbiddenException('根管理员不可移除');

    // 记录活动日志（在删除前记录）
    this.activityLog.log({
      adminMemberId: id,
      action: 'member.removed',
      resource: 'AdminMember',
      resourceId: id,
      before: { email: existing.email, roleId: existing.roleId, presetRole: existing.presetRole },
      detail: { email: existing.email },
    });

    // 删除 AdminMember 记录
    await this.repo.deleteAdminMember(id);

    // 清除 Redis 缓存（权限 + refresh token 黑名单由 TTL 自动过期）
    await this.redis.del(adminPermissionCacheKey(existing.id));
  }

  async forceLogout(adminMemberId: string): Promise<void> {
    const existing = await this.repo.findAdminMemberById(adminMemberId);
    if (!existing) throw new BadRequestException('管理员不存在');

    // 记录活动日志
    this.activityLog.log({
      adminMemberId,
      action: 'force.logout',
      resource: 'AdminMember',
      resourceId: adminMemberId,
    });

    // 清除权限缓存，使下次请求必须重新鉴权
    await this.redis.del(adminPermissionCacheKey(adminMemberId));

    // 设置强制登出标记，TTL = refresh token 有效期
    // adminRefresh 时检查此 key，存在则拒绝刷新，迫使用户重新登录
    await this.redis.set(
      adminForceLogoutKey(adminMemberId),
      Date.now().toString(),
      'EX',
      this.refreshExpiresSeconds,
    );
  }

  async resetAdminPassword(adminMemberId: string): Promise<{ tempPassword: string }> {
    const existing = await this.repo.findAdminMemberById(adminMemberId);
    if (!existing) throw new BadRequestException('管理员不存在');
    if (existing.presetRole === 'super_admin') throw new ForbiddenException('根管理员密码不可通过此接口重置');

    // 生成 12 位随机密码
    const plainPassword = crypto.randomBytes(6).toString('hex'); // 12 chars hex
    const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

    // 更新密码 + mustChangePassword + passwordChangedAt
    await this.repo.updateAdminMemberPassword(adminMemberId, {
      password: hashedPassword,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
    });

    // 记录活动日志
    this.activityLog.log({
      adminMemberId,
      action: 'password.reset',
      resource: 'AdminMember',
      resourceId: adminMemberId,
    });

    // 清除权限缓存（等同强制下线效果）
    await this.redis.del(adminPermissionCacheKey(adminMemberId));

    return { tempPassword: plainPassword };
  }

  private logRbacActivity(
    operatorAdminId: string | undefined,
    action: string,
    audit: {
      resource: string;
      resourceId: string;
      before?: unknown;
      after?: unknown;
      detail?: Record<string, unknown>;
    },
  ): void {
    if (!operatorAdminId) return;
    this.activityLog.log({
      adminMemberId: operatorAdminId,
      operatorAdminId,
      action,
      resource: audit.resource,
      resourceId: audit.resourceId,
      before: audit.before,
      after: audit.after,
      detail: audit.detail,
    });
  }

  // ============================
  // 产品管理
  // ============================

  async listProducts() {
    return this.billingClient.listProducts();
  }

  async createProduct(data: {
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
  }) {
    if (!data.name || !data.slug) throw new BadRequestException('name, slug 为必填');
    if (data.billingMode && !['SUBSCRIPTION', 'PAY_AS_YOU_GO', 'CODING_PLAN'].includes(data.billingMode)) {
      throw new BadRequestException('billingMode 必须是 SUBSCRIPTION / PAY_AS_YOU_GO / CODING_PLAN 之一');
    }
    const requestedFulfillmentMode = data.codingPlanFulfillmentMode ?? data.fulfillmentMode;
    if (requestedFulfillmentMode && !['platform_model_package', 'provider_resale'].includes(requestedFulfillmentMode)) {
      throw new BadRequestException('codingPlanFulfillmentMode 必须是 platform_model_package / provider_resale 之一');
    }
    return this.billingClient.createProduct(data);
  }

  async updateProduct(
    id: string,
    data: {
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
    },
  ) {
    if (data.billingMode && !['SUBSCRIPTION', 'PAY_AS_YOU_GO', 'CODING_PLAN'].includes(data.billingMode)) {
      throw new BadRequestException('billingMode 必须是 SUBSCRIPTION / PAY_AS_YOU_GO / CODING_PLAN 之一');
    }
    const requestedFulfillmentMode = data.codingPlanFulfillmentMode ?? data.fulfillmentMode;
    if (requestedFulfillmentMode && !['platform_model_package', 'provider_resale'].includes(requestedFulfillmentMode)) {
      throw new BadRequestException('codingPlanFulfillmentMode 必须是 platform_model_package / provider_resale 之一');
    }
    return this.billingClient.updateProduct(id, data);
  }

  async deleteProduct(id: string) {
    return this.billingClient.deleteProduct(id);
  }

  async getProductIntegration(id: string) {
    return this.billingClient.getProductIntegration(id);
  }

  async getProductRuntimePolicy(id: string) {
    return this.billingClient.getProductRuntimePolicy(id);
  }

  async updateProductRuntimePolicy(id: string, data: Record<string, unknown>) {
    return this.billingClient.updateProductRuntimePolicy(id, data);
  }

  async listProductChannels(productId: string) {
    return this.billingClient.listProductChannels(productId);
  }

  async createProductChannel(productId: string, data: Record<string, unknown>) {
    return this.billingClient.createProductChannel(productId, data);
  }

  async createDeliverySetting(productId: string, data: Record<string, unknown>) {
    return this.billingClient.createDeliverySetting(productId, data);
  }

  async updateProductChannel(productId: string, productChannelId: string, data: Record<string, unknown>) {
    return this.billingClient.updateProductChannel(productId, productChannelId, data);
  }

  async deleteProductChannel(productId: string, productChannelId: string) {
    return this.billingClient.deleteProductChannel(productId, productChannelId);
  }

  async listProductChannelGroups(productId: string) {
    return this.billingClient.listProductChannelGroups(productId);
  }

  async createProductChannelGroup(productId: string, data: Record<string, unknown>) {
    return this.billingClient.createProductChannelGroup(productId, data);
  }

  async updateProductChannelGroup(productId: string, groupId: string, data: Record<string, unknown>) {
    return this.billingClient.updateProductChannelGroup(productId, groupId, data);
  }

  async deleteProductChannelGroup(productId: string, groupId: string) {
    return this.billingClient.deleteProductChannelGroup(productId, groupId);
  }

  async addProductChannelGroupMember(productId: string, groupId: string, data: Record<string, unknown>) {
    return this.billingClient.addProductChannelGroupMember(productId, groupId, data);
  }

  async updateProductChannelGroupMember(
    productId: string,
    groupId: string,
    memberId: string,
    data: Record<string, unknown>,
  ) {
    return this.billingClient.updateProductChannelGroupMember(productId, groupId, memberId, data);
  }

  async deleteProductChannelGroupMember(productId: string, groupId: string, memberId: string) {
    return this.billingClient.deleteProductChannelGroupMember(productId, groupId, memberId);
  }

  async listProductRouteAssignments(productId: string, filters: ProductRouteAssignmentFilters) {
    return this.billingClient.listProductRouteAssignments(productId, filters);
  }

  async createProductRouteAssignment(productId: string, data: Record<string, unknown>) {
    return this.billingClient.createProductRouteAssignment(productId, data);
  }

  async updateProductRouteAssignment(productId: string, assignmentId: string, data: Record<string, unknown>) {
    return this.billingClient.updateProductRouteAssignment(productId, assignmentId, data);
  }

  async deleteProductRouteAssignment(productId: string, assignmentId: string) {
    return this.billingClient.deleteProductRouteAssignment(productId, assignmentId);
  }

  async previewProductRouteGraph(productId: string) {
    return this.billingClient.previewProductRouteGraph(productId);
  }

  async rebuildProductRouteGraph(productId: string) {
    return this.billingClient.rebuildProductRouteGraph(productId);
  }

  async rotateProductIntegrationToken(id: string) {
    return this.billingClient.rotateProductIntegrationToken(id);
  }

  async rotateProductWebhookSecret(id: string) {
    return this.billingClient.rotateProductWebhookSecret(id);
  }

  // ============================
  // 加量包管理
  // ============================

  async listBoosterPacks() {
    return this.billingClient.listBoosterPacks();
  }

  async createBoosterPack(data: {
    productId?: string;
    name: string;
    description?: string;
    creditsAmount: number;
    priceCents: number;
    isActive?: boolean;
    sortOrder?: number;
  }) {
    if (!data.name) throw new BadRequestException('name 为必填');
    return this.billingClient.createBoosterPack(data);
  }

  async updateBoosterPack(
    id: string,
    data: {
      name?: string;
      description?: string;
      creditsAmount?: number;
      priceCents?: number;
      isActive?: boolean;
      sortOrder?: number;
    },
  ) {
    return this.billingClient.updateBoosterPack(id, data);
  }

  async deleteBoosterPack(id: string) {
    return this.billingClient.deleteBoosterPack(id);
  }

  // ============================
  // 用户管理增强 — 委派给 user-api 内部接口
  // ============================

  async createUser(
    data: { email: string; nickname?: string; phone?: string; role?: string },
    performedBy: string,
  ) {
    return this.userClient.createUser(data, performedBy);
  }

  async updateUser(
    id: string,
    data: { email?: string; nickname?: string; phone?: string; role?: string; isActive?: boolean },
    performedBy: string,
  ) {
    return this.userClient.updateUser(id, data, performedBy);
  }

  async resetUserPassword(userId: string, performedBy: string) {
    return this.userClient.resetUserPassword(userId, performedBy);
  }

  async banUser(userId: string, reason: string, performedBy: string) {
    return this.userClient.banUser(userId, reason, performedBy);
  }

  async unbanUser(userId: string, performedBy: string) {
    return this.userClient.unbanUser(userId, performedBy);
  }

  async searchUsers(params: { search?: string; status?: string; role?: string; provider?: string; page: number; pageSize: number }) {
    return this.userClient.searchUsers(params);
  }

  // ============================
  // 用户批量导入（Python backfill） — 委派给 user-api 内部接口
  // ============================

  async backfillUsers(users: Array<{ email: string; externalId: string; nickname?: string }>) {
    return this.userClient.backfillUsers(users);
  }

  private emptyAgentObservability(reason: string, message: string) {
    return {
      unavailable: true,
      reason,
      message,
      window: { days: 0, from: null, to: null, sampleLimit: 0 },
      kpis: {
        totalRuns: 0,
        failedRuns: 0,
        needsAttentionRuns: 0,
        failedOrNeedsAttentionRuns: 0,
        noProgressRuns: 0,
        timeoutRuns: 0,
        iabRelatedRuns: 0,
        subagentTasks: 0,
        subagentFailedTasks: 0,
        toolErrors: 0,
        toolErrorsFromRuns: 0,
        toolUsageErrors: 0,
        retryableToolErrors: 0,
        timeoutToolErrors: 0,
        iabToolErrors: 0,
        continuationJobs: 0,
        continuationDeadLetters: 0,
        continuationRunningJobs: 0,
      },
      rates: {
        failureRate: 0,
        noProgressRate: 0,
        timeoutRate: 0,
        iabRelatedRate: 0,
        subagentFailureRate: 0,
      },
      breakdowns: {
        statuses: [],
        stopReasons: [],
        agentKinds: [],
        harnessVariants: [],
        toolErrorCodes: [],
        toolErrorCategories: [],
        toolErrorBlame: [],
        toolErrorTools: [],
        failureReasons: [],
        failureCategories: [],
        failureBlame: [],
        subagentStatuses: [],
        subagentProfiles: [],
        subagentErrorCodes: [],
        continuationStatuses: [],
        continuationErrorCodes: [],
      },
      recentFailures: [],
      subagents: { total: 0, failed: 0, running: 0, pending: 0 },
      continuations: { total: 0, deadLetter: 0, running: 0, queued: 0 },
    };
  }
}
