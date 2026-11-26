import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  authProviderForRegion,
  type DeploymentConfigSnapshot,
  type DeploymentLanguage,
  type DeploymentOAuthPublicConfig,
  type DeploymentRegion,
} from '@ruidong/shared';
import { BillingInternalClient } from '../billing/billing-internal.client';
import {
  getAdminRequestContext,
  runWithAdminRequestContext,
} from '../common/request/admin-context';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminRepository } from './admin.repository';

export type DeploymentConfigSyncStatus = {
  version: string;
  status: 'synced' | 'degraded';
  lastAttemptAt: string;
  user: { ok: boolean; error?: string };
  billing: { ok: boolean; error?: string };
};

const SYSTEM_SYNC_CONTEXT = {
  adminId: 'system:deployment-config-reconciler',
  presetRole: 'system',
  permissions: [
    'admin.system.manage',
    'admin.page.system_config.manage',
  ],
};

@Injectable()
export class DeploymentConfigSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeploymentConfigSyncService.name);
  private timer?: NodeJS.Timeout;
  private reconciling = false;

  constructor(
    private readonly repo: AdminRepository,
    private readonly userClient: UserInternalClient,
    private readonly billingClient: BillingInternalClient,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const configured = Number(this.config.get<string>('DEPLOYMENT_CONFIG_RECONCILE_MS'));
    const intervalMs = Number.isFinite(configured) && configured >= 5_000 ? configured : 30_000;
    this.timer = setInterval(() => void this.reconcileLatest(), intervalMs);
    this.timer.unref();
    void this.reconcileLatest();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async syncNow(snapshot: DeploymentConfigSnapshot): Promise<DeploymentConfigSyncStatus> {
    return this.withSystemContextIfNeeded(async () => {
      const [user, billing] = await Promise.all([
        this.syncTarget(
          () => this.userClient.syncDeploymentConfig(snapshot),
          snapshot.version,
        ),
        this.syncTarget(
          () => this.billingClient.syncDeploymentConfig(snapshot),
          snapshot.version,
        ),
      ]);
      const status: DeploymentConfigSyncStatus = {
        version: snapshot.version,
        status: user.ok && billing.ok ? 'synced' : 'degraded',
        lastAttemptAt: new Date().toISOString(),
        user,
        billing,
      };
      await this.repo.upsertDeploymentConfigSyncStatus(
        JSON.stringify(status),
        BigInt(snapshot.version),
      );
      if (status.status === 'degraded') {
        this.logger.warn(
          `部署配置 v${snapshot.version} 尚未全部下发，后台将自动重试: ${JSON.stringify(status)}`,
        );
      }
      return status;
    });
  }

  async reconcileLatest(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const row = await this.repo.findSystemConfig('deploymentConfig');
      if (!row) return;
      await this.syncNow(snapshotFromRow(row));
    } catch (error) {
      this.logger.error(`部署配置自动对账失败: ${errorMessage(error)}`);
    } finally {
      this.reconciling = false;
    }
  }

  private async syncTarget(
    call: () => Promise<unknown>,
    expectedVersion: string,
  ): Promise<{ ok: boolean; error?: string }> {
    let lastError = '';
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const acknowledgement = asRecord(await call());
        if (String(acknowledgement.version ?? '') !== expectedVersion) {
          throw new Error(
            `目标服务确认版本 ${String(acknowledgement.version ?? '<missing>')}，期望 ${expectedVersion}`,
          );
        }
        return { ok: true };
      } catch (error) {
        lastError = errorMessage(error);
        if (attempt < 2) await delay(100 * (attempt + 1));
      }
    }
    return { ok: false, error: lastError || 'unknown error' };
  }

  private withSystemContextIfNeeded<T>(callback: () => Promise<T>): Promise<T> {
    if (getAdminRequestContext()?.adminId) return callback();
    return runWithAdminRequestContext(SYSTEM_SYNC_CONTEXT, callback);
  }
}

export function snapshotFromRow(row: { value: string; version: bigint }): DeploymentConfigSnapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(row.value);
  } catch {
    throw new Error('deploymentConfig 存储值不是合法 JSON');
  }
  const source = asRecord(parsed);
  const region = normalizeRegion(source.region);
  if (!region) throw new Error('deploymentConfig.region 非法');
  const currency = normalizeCurrency(source.currency);
  if (!currency) throw new Error('deploymentConfig.currency 非法');
  const defaultLanguage = normalizeLanguage(source.defaultLanguage);
  return {
    version: row.version.toString(),
    region,
    provider: authProviderForRegion(region),
    currency,
    ...(defaultLanguage ? { defaultLanguage } : {}),
    oauth: normalizeOAuth(source.oauth),
  };
}

function normalizeOAuth(value: unknown): DeploymentOAuthPublicConfig {
  const source = asRecord(value);
  const output: DeploymentOAuthPublicConfig = {};
  for (const key of [
    'auth0Domain',
    'auth0ClientId',
    'auth0DbConnection',
    'authingAppHost',
    'authingAppId',
    'authingWechatConnection',
  ] as const) {
    const raw = source[key];
    if (typeof raw === 'string' && raw.trim()) output[key] = raw.trim();
  }
  return output;
}

function normalizeRegion(value: unknown): DeploymentRegion | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'domestic' || normalized === 'cn' || normalized === 'china') return 'domestic';
  if (
    normalized === 'overseas' ||
    normalized === 'global' ||
    normalized === 'intl' ||
    normalized === 'international'
  ) return 'overseas';
  return undefined;
}

function normalizeLanguage(value: unknown): DeploymentLanguage | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'zh' || normalized === 'zh-cn') return 'zh';
  if (normalized === 'en' || normalized === 'en-us') return 'en';
  return undefined;
}

function normalizeCurrency(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  return /^[a-z]{3}$/.test(normalized) ? normalized : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
