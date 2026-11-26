import {
  BadGatewayException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeploymentConfigSnapshot, EnterpriseAdminError as E, ErrorCode } from '@ruidong/shared';
import { enterpriseAdminFailure } from '../enterprise-admin/enterprise-admin-http';
import { enterpriseAdminUuid } from '../common/telemetry/enterprise-admin-telemetry';
import { signedAdminContextHeaders } from '../common/internal-auth/signed-admin-context';
import { getAdminRequestContext } from '../common/request/admin-context';

type QueryValue = string | number | boolean | undefined | null;
type QueryParams = Record<string, QueryValue>;

export interface UserInternalBinaryFile {
  buffer: Buffer;
  contentType: string | null;
  contentLength: number | null;
  filename: string | null;
}

const DEFAULT_INTERNAL_API_VERSION = '2026-05-16';
const INTERNAL_API_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS = 10_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveInternalApiVersion(value: string | undefined): string {
  const version = value?.trim() || DEFAULT_INTERNAL_API_VERSION;
  if (!INTERNAL_API_VERSION_PATTERN.test(version)) {
    throw new Error('BILLING_INTERNAL_API_VERSION must use YYYY-MM-DD format');
  }
  return version;
}

function resolveInternalRequestTimeoutMs(value: string | undefined): number {
  const timeout = Number.parseInt(value || '', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS;
}

@Injectable()
export class UserInternalClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly adminContextSecret: string | undefined;
  private readonly apiVersion: string;
  private readonly requestTimeoutMs: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = trimTrailingSlash(
      this.config.get<string>('USER_SERVICE_URL') ||
        'http://localhost:3000/api/internal/user/admin',
    );
    this.token = this.config.get<string>('ADMIN_TO_USER_TOKEN')?.trim();
    this.adminContextSecret = this.config.get<string>('ADMIN_TO_USER_CONTEXT_SECRET')?.trim();
    this.apiVersion = resolveInternalApiVersion(
      this.config.get<string>('BILLING_INTERNAL_API_VERSION'),
    );
    this.requestTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('INTERNAL_SERVICE_TIMEOUT_MS'),
    );
  }
  // Dedicated assisted transport: legacy methods retain their existing error contract.
  async enterpriseAdminRequest<T = unknown>(method: 'GET' | 'POST', suffix: string, query?: QueryParams, body?: unknown): Promise<T> {
    return this.enterpriseAdminTransport(method, `/enterprise-admin-creations${suffix}`, query, body) as Promise<T>;
  }
  async enterpriseAdminUpload(sessionId: string, buffer: Buffer, contentType: string) {
    return this.enterpriseAdminTransport('POST', `/enterprise-admin-creations/upload-sessions/${encodeURIComponent(sessionId)}/license`, undefined, buffer, contentType);
  }
  async enterpriseAdminFile(suffix: string, maxBytes: number, verificationId?: string, signal?: AbortSignal): Promise<UserInternalBinaryFile> {
    const path = verificationId ? `/enterprise-verifications/${encodeURIComponent(verificationId)}/license-file` : `/enterprise-admin-creations${suffix}`;
    const response = await this.enterpriseAdminFetch('GET', path, undefined, undefined, undefined, signal);
    if (!response.ok) await this.enterpriseAdminError(response);
    const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
    if (!type || !['image/jpeg', 'image/png', 'application/pdf'].includes(type)) { await response.body?.cancel(); enterpriseAdminFailure(E.UPLOAD_UNAVAILABLE); }
    const bytes = await this.enterpriseAdminRead(response, maxBytes);
    const declared = response.headers.get('content-length');
    if (!bytes.length || (declared !== null && Number(declared) !== bytes.length)) enterpriseAdminFailure(E.UPLOAD_UNAVAILABLE);
    return { buffer: bytes, contentType: type, contentLength: bytes.length,
      filename: filenameFromContentDisposition(response.headers.get('content-disposition'))?.replace(/[^\w.\-一-龥]/g, '_').slice(0, 128) ?? 'license' };
  }
  private async enterpriseAdminTransport(method: string, path: string, query?: QueryParams, body?: unknown, mime?: string) {
    const response = await this.enterpriseAdminFetch(method, path, query, body, mime);
    if (!response.ok) await this.enterpriseAdminError(response);
    let payload: { code?: unknown; data?: unknown };
    try { payload = JSON.parse((await this.enterpriseAdminRead(response, 2 * 1024 * 1024)).toString('utf8')); }
    catch { enterpriseAdminFailure(E.BILLING_UNAVAILABLE); }
    if (!payload || payload.code !== 0 || !('data' in payload)) enterpriseAdminFailure(E.BILLING_UNAVAILABLE);
    return payload.data;
  }
  private async enterpriseAdminFetch(method: string, path: string, query?: QueryParams, body?: unknown, mime?: string, external?: AbortSignal): Promise<Response> {
    const context = getAdminRequestContext();
    if (!context?.adminId || !enterpriseAdminUuid(context.requestId)) enterpriseAdminFailure(E.STATE_CONFLICT, 503);
    try {
      const headers = this.internalHeaders({ json: !mime });
      if (mime) headers['content-type'] = mime;
      const timeout = AbortSignal.timeout(this.requestTimeoutMs);
      return await fetch(this.buildUrl(path, query), { method, headers, redirect: 'error', signal: external ? AbortSignal.any([timeout, external]) : timeout,
        ...(body === undefined ? {} : { body: mime ? new Uint8Array(body as Buffer) : JSON.stringify(body) }) });
    } catch { enterpriseAdminFailure(E.BILLING_UNAVAILABLE); }
  }
  private async enterpriseAdminRead(response: Response, max: number) {
    const reader = response.body?.getReader(); if (!reader) enterpriseAdminFailure(E.BILLING_UNAVAILABLE);
    const chunks: Buffer[] = []; let size = 0;
    try {
      for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
        if (size > max) { await reader.cancel(); enterpriseAdminFailure(E.UPLOAD_UNAVAILABLE); } chunks.push(Buffer.from(part.value)); }
    } catch (error) { if (error instanceof HttpException) throw error; enterpriseAdminFailure(E.BILLING_UNAVAILABLE); }
    return Buffer.concat(chunks, size);
  }
  private async enterpriseAdminError(response: Response): Promise<never> {
    let code: unknown;
    try { const value = JSON.parse((await this.enterpriseAdminRead(response, 128 * 1024)).toString('utf8')); code = value?.code; } catch { enterpriseAdminFailure(E.BILLING_UNAVAILABLE); }
    const known: string[] = [...Object.values(E), ErrorCode.AUTH_UNAUTHORIZED, ErrorCode.AUTH_FORBIDDEN, ErrorCode.VALIDATION_ERROR];
    if (typeof code === 'string' && known.includes(code)) enterpriseAdminFailure(code, response.status);
    enterpriseAdminFailure(E.BILLING_UNAVAILABLE);
  }

  listUsers(page: number, pageSize: number) {
    return this.request('GET', '/users', { page, pageSize });
  }

  getUserStats() {
    return this.request('GET', '/users/stats');
  }

  searchUsers(params: {
    search?: string;
    status?: string;
    role?: string;
    provider?: string;
    page: number;
    pageSize: number;
  }) {
    return this.request('GET', '/users/search', params);
  }

  getUser(id: string) {
    return this.request('GET', `/users/${encodeURIComponent(id)}`);
  }

  /**
   * 按 id 批量取联系方式(email / phone / nickname)。
   *
   * 为什么要有它:billing 的用户镜像表里约 4 成用户 email/phone 都是空的
   * (nprod 实测 91 个用户里 37 个),而 user 域是权威源。邀请裂变等列表拿到
   * billing 数据后来这里补齐。用 POST 是因为 id 列表可能到 200 个,放 query 会撑爆 URL。
   * 逐个 getUser 会形成 N+1(一页 20 条邀请记录涉及最多 40 个用户)。
   */
  getUserContactsByIds(ids: string[]) {
    return this.request('POST', '/users/contacts-by-ids', undefined, { ids });
  }

  getUserOverview(id: string) {
    return this.request('GET', `/users/${encodeURIComponent(id)}/overview`);
  }

  getUserSubscriptions(id: string) {
    return this.request('GET', `/users/${encodeURIComponent(id)}/subscriptions`);
  }

  getUserApiKeys(id: string) {
    return this.request('GET', `/users/${encodeURIComponent(id)}/api-keys`);
  }

  getUserAuditLogs(id: string, page: number, pageSize: number) {
    return this.request('GET', `/users/${encodeURIComponent(id)}/audit-logs`, { page, pageSize });
  }

  // ============================
  // 企业实名 / 企业账户开通（§10.2.2）
  // ============================

  /**
   * 用户实名记录（含企业）。最新 user internal 已补 id / provisioningStatus /
   * verificationBadgeStatus / reviewStatus / provisioningLastError / tenantId / billingAccountId 字段。
   */
  getUserVerifications(userId: string) {
    return this.request('GET', `/users/${encodeURIComponent(userId)}/verifications`);
  }

  /**
   * 企业营业执照短时效 signed URL。admin 侧不持有对象存储密钥，只转发 user 生成的临时 URL。
   */
  getEnterpriseLicenseUrl(verificationId: string) {
    return this.request(
      'GET',
      `/enterprise-verifications/${encodeURIComponent(verificationId)}/license-url`,
    );
  }

  /**
   * 企业营业执照二进制代理。admin-api 透传给浏览器，不再外发对象存储 signed URL。
   */
  getEnterpriseLicenseFile(verificationId: string): Promise<UserInternalBinaryFile> {
    return this.requestBinary(
      'GET',
      `/enterprise-verifications/${encodeURIComponent(verificationId)}/license-file`,
    );
  }

  /**
   * 企业账户开通补救：调 user internal retry。仅 `FAILED_RETRYABLE` 可调，幂等键取 verificationId。
   * 路径独立于 `/users/:id` 段，避免 admin proxy 侧 `/:id` 路由歧义（见 §10.7-③）。
   */
  retryEnterpriseProvisioning(userId: string, verificationId: string) {
    return this.request(
      'POST',
      `/enterprise-verifications/${encodeURIComponent(verificationId)}/provision/retry`,
      undefined,
      { userId, idempotencyKey: verificationId },
    );
  }

  // ============================
  // 企业认证人工审核（§4.3.2）
  // ============================

  /**
   * 审核队列列表：user 侧 EnterpriseOnboardingApplication。approve 前尚无 billing account，
   * 待审单只能从这里拉（§4.2/§8.0c）。forwarded permission = admin.users.view（非敏感字段）。
   */
  listEnterpriseOnboardingApplications(params: {
    reviewStatus?: string;
    provisioningStatus?: string;
    search?: string;
    userId?: string;
    page?: number;
    pageSize?: number;
    cursor?: string;
  }) {
    return this.request('GET', '/enterprise-onboarding-applications', params);
  }

  /** 审核详情：单条 application 聚合。forwarded permission = admin.users.view（非敏感字段）。 */
  getEnterpriseOnboardingApplication(id: string) {
    return this.request(
      'GET',
      `/enterprise-onboarding-applications/${encodeURIComponent(id)}`,
    );
  }

  /**
   * 审核动作：approve（触发开通，幂等）/ reject（带分类+原因）/ void（仅翻审核态，不碰 billing）。
   * operatorId 由 admin proxy 从请求上下文注入。forwarded permission = admin.enterprise_accounts.review。
   */
  reviewEnterpriseVerification(
    verificationId: string,
    body: {
      action: 'approve' | 'reject' | 'void';
      operatorId: string;
      rejectCategory?: string;
      rejectReason?: string;
      note?: string;
    },
  ) {
    return this.request(
      'POST',
      `/enterprise-verifications/${encodeURIComponent(verificationId)}/review`,
      undefined,
      body,
    );
  }

  /**
   * 转账凭证短时效 signed URL。admin 侧不持有对象存储密钥，只转发 user 生成的临时 URL。
   * forwarded permission = admin.enterprise_accounts.review（敏感财务凭证）。
   */
  getPaymentProofUrl(verificationId: string) {
    return this.request(
      'GET',
      `/enterprise-verifications/${encodeURIComponent(verificationId)}/payment-proof-url`,
    );
  }

  adjustBalance(
    userId: string,
    amountCents: number,
    description: string,
    _performedBy: string,
    idempotencyKey?: string,
  ) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(userId)}/adjust-balance`,
      undefined,
      { amountCents, description, idempotencyKey },
    );
  }

  toggleUserStatus(id: string, _performedBy: string) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(id)}/toggle-status`,
      undefined,
      {},
    );
  }

  createUser(
    data: { email: string; nickname?: string; phone?: string; role?: string },
    _performedBy: string,
  ) {
    return this.request('POST', '/users', undefined, data);
  }

  updateUser(
    id: string,
    data: { email?: string; nickname?: string; phone?: string; role?: string; isActive?: boolean },
    _performedBy: string,
  ) {
    return this.request('PUT', `/users/${encodeURIComponent(id)}`, undefined, data);
  }

  resetUserPassword(userId: string, _performedBy: string) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(userId)}/reset-password`,
      undefined,
      {},
    );
  }

  banUser(userId: string, reason: string, _performedBy: string) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(userId)}/ban`,
      undefined,
      { reason },
    );
  }

  unbanUser(userId: string, _performedBy: string) {
    return this.request(
      'POST',
      `/users/${encodeURIComponent(userId)}/unban`,
      undefined,
      {},
    );
  }

  backfillUsers(users: Array<{ email: string; externalId: string; nickname?: string }>) {
    return this.request('POST', '/backfill-users', undefined, { users });
  }

  listApiKeys(params: {
    page: number;
    pageSize: number;
    search?: string;
    email?: string;
    status?: string;
  }) {
    return this.request('GET', '/api-keys', params);
  }

  updateApiKeyStatus(id: string, isActive: boolean) {
    return this.request('PATCH', `/api-keys/${encodeURIComponent(id)}/status`, undefined, {
      isActive,
    });
  }

  revokeApiKey(id: string) {
    return this.request('DELETE', `/api-keys/${encodeURIComponent(id)}`);
  }

  getSessionStats() {
    return this.request('GET', '/sessions/stats');
  }

  listSessions(page: number, pageSize: number) {
    return this.request('GET', '/sessions', { page, pageSize });
  }

  listRiskUsers(params: {
    page: number;
    pageSize: number;
    search?: string;
    ruleType?: string;
    severity?: string;
    status?: string;
    userId?: string;
    triggeredFrom?: string;
    triggeredTo?: string;
  }) {
    return this.request('GET', '/risk-users', params);
  }

  getRiskUser(id: string) {
    return this.request('GET', `/risk-users/${encodeURIComponent(id)}`);
  }

  getRiskUserRelated(id: string) {
    return this.request('GET', `/risk-users/${encodeURIComponent(id)}/related`);
  }

  getRiskUserHistory(id: string) {
    return this.request('GET', `/risk-users/${encodeURIComponent(id)}/history`);
  }

  getRiskUserAuditLogs(id: string) {
    return this.request('GET', `/risk-users/${encodeURIComponent(id)}/audit-logs`);
  }

  releaseRiskUser(id: string, adminId: string, note: string) {
    return this.request('POST', `/risk-users/${encodeURIComponent(id)}/release`, undefined, {
      adminId,
      note,
    });
  }

  banRiskUser(id: string, adminId: string, reason: string) {
    return this.request('POST', `/risk-users/${encodeURIComponent(id)}/ban`, undefined, {
      adminId,
      reason,
    });
  }

  listRiskListEntries(params: {
    page: number;
    pageSize: number;
    listType?: string;
    search?: string;
  }) {
    return this.request('GET', '/risk-rules/list-entries', params);
  }

  addRiskListEntry(body: Record<string, unknown>) {
    return this.request('POST', '/risk-rules/list-entries', undefined, body);
  }

  removeRiskListEntry(id: string) {
    return this.request('DELETE', `/risk-rules/list-entries/${encodeURIComponent(id)}`);
  }

  listRiskRules(params: {
    page: number;
    pageSize: number;
    search?: string;
    ruleType?: string;
    isActive?: boolean;
  }) {
    return this.request('GET', '/risk-rules', params);
  }

  createRiskRule(body: Record<string, unknown>) {
    return this.request('POST', '/risk-rules', undefined, body);
  }

  getRiskRule(id: string) {
    return this.request('GET', `/risk-rules/${encodeURIComponent(id)}`);
  }

  updateRiskRule(id: string, body: Record<string, unknown>) {
    return this.request('PUT', `/risk-rules/${encodeURIComponent(id)}`, undefined, body);
  }

  deleteRiskRule(id: string) {
    return this.request('DELETE', `/risk-rules/${encodeURIComponent(id)}`);
  }

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

  listTickets(params: {
    page: number;
    pageSize: number;
    search?: string;
    category?: string;
    priority?: string;
    status?: string;
    assigneeId?: string;
    userId?: string;
    createdFrom?: string;
    createdTo?: string;
  }) {
    return this.request('GET', '/tickets', params);
  }

  createTicket(body: Record<string, unknown>) {
    return this.request('POST', '/tickets', undefined, body);
  }

  getTicket(id: string) {
    return this.request('GET', `/tickets/${encodeURIComponent(id)}`);
  }

  addTicketMessage(id: string, body: Record<string, unknown>) {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/messages`, undefined, body);
  }

  changeTicketStatus(id: string, body: Record<string, unknown>) {
    return this.request('PATCH', `/tickets/${encodeURIComponent(id)}/status`, undefined, body);
  }

  assignTicket(id: string, body: Record<string, unknown>) {
    return this.request('PATCH', `/tickets/${encodeURIComponent(id)}/assign`, undefined, body);
  }

  changeTicketCategory(id: string, body: Record<string, unknown>) {
    return this.request('PATCH', `/tickets/${encodeURIComponent(id)}/category`, undefined, body);
  }

  changeTicketPriority(id: string, body: Record<string, unknown>) {
    return this.request('PATCH', `/tickets/${encodeURIComponent(id)}/priority`, undefined, body);
  }

  closeTicket(id: string, adminId: string) {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/close`, undefined, { adminId });
  }

  mergeTicket(id: string, body: Record<string, unknown>) {
    return this.request('POST', `/tickets/${encodeURIComponent(id)}/merge`, undefined, body);
  }

  syncDeploymentConfig(snapshot: DeploymentConfigSnapshot) {
    return this.request('PUT', '/deployment-config', undefined, snapshot);
  }

  private async request(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
  ): Promise<unknown> {
    const url = this.buildUrl(path, query);
    const headers = this.internalHeaders({ json: true });
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `user service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }

    const payload = await this.parseJson(response);
    if (!response.ok) {
      const message = this.extractMessage(payload) ?? `user service returned ${response.status}`;
      throw new HttpException(message, response.status);
    }

    if (payload && typeof payload === 'object' && 'code' in payload) {
      const envelope = payload as { code?: number; message?: string; data?: unknown };
      if (envelope.code !== 0) {
        throw new BadGatewayException(envelope.message || 'user service returned an error');
      }
      return envelope.data;
    }

    return payload;
  }

  private async requestBinary(
    method: string,
    path: string,
    query?: QueryParams,
  ): Promise<UserInternalBinaryFile> {
    const url = this.buildUrl(path, query);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.internalHeaders(),
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `user service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }

    if (!response.ok) {
      const payload = await this.parseJson(response);
      const message = this.extractMessage(payload) ?? `user service returned ${response.status}`;
      throw new HttpException(message, response.status);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
    return {
      buffer,
      contentType: response.headers.get('content-type'),
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      filename: filenameFromContentDisposition(response.headers.get('content-disposition')),
    };
  }

  private internalHeaders(opts: { json?: boolean } = {}): Record<string, string> {
    if (!this.token) {
      throw new InternalServerErrorException('ADMIN_TO_USER_TOKEN is required');
    }
    const headers: Record<string, string> = {
      'x-internal-caller': 'admin-api',
      'x-internal-token': this.token,
      'x-billing-api-version': this.apiVersion,
    };
    if (opts.json) {
      headers['content-type'] = 'application/json';
    }
    const adminContext = getAdminRequestContext();
    if (!adminContext?.adminId) {
      throw new InternalServerErrorException('admin request context is required for user internal API');
    }
    if (!this.adminContextSecret) {
      throw new InternalServerErrorException('ADMIN_TO_USER_CONTEXT_SECRET is required');
    }
    Object.assign(headers, signedAdminContextHeaders(adminContext, this.adminContextSecret));
    if (adminContext.requestId) {
      headers['x-request-id'] = adminContext.requestId;
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
}

function filenameFromContentDisposition(value: string | null): string | null {
  if (!value) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return decodeURIComponent(encoded);
    } catch {
      return encoded;
    }
  }
  const quoted = /filename="([^"]+)"/i.exec(value)?.[1];
  if (quoted) return quoted;
  return /filename=([^;]+)/i.exec(value)?.[1]?.trim() || null;
}
