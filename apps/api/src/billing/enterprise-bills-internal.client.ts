import {
  BadGatewayException,
  HttpException,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyReply } from 'fastify';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { signedAdminContextHeaders } from '../common/internal-auth/signed-admin-context';
import { getAdminRequestContext } from '../common/request/admin-context';

type QueryValue = string | number | boolean | undefined | null;
type QueryParams = Record<string, QueryValue>;
const DEFAULT_BILLING_INTERNAL_API_VERSION = '2026-05-16';
const BILLING_INTERNAL_API_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS = 10_000;
const DEFAULT_INTERNAL_BILLS_LIST_TIMEOUT_MS = 60_000;
const DEFAULT_INTERNAL_DOWNLOAD_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_INTERNAL_JOB_TIMEOUT_MS = 15 * 60 * 1000;

@Injectable()
export class EnterpriseBillsInternalClient {
  private readonly baseUrl: string;
  private readonly token: string | undefined;
  private readonly adminContextSecret: string | undefined;
  private readonly apiVersion: string;
  private readonly requestTimeoutMs: number;
  private readonly billsListTimeoutMs: number;
  private readonly downloadTimeoutMs: number;
  private readonly jobTimeoutMs: number;

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
    this.billsListTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('INTERNAL_BILLS_LIST_TIMEOUT_MS'),
      DEFAULT_INTERNAL_BILLS_LIST_TIMEOUT_MS,
    );
    this.downloadTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('INTERNAL_DOWNLOAD_TIMEOUT_MS'),
      DEFAULT_INTERNAL_DOWNLOAD_TIMEOUT_MS,
    );
    this.jobTimeoutMs = resolveInternalRequestTimeoutMs(
      this.config.get<string>('INTERNAL_JOB_TIMEOUT_MS'),
      DEFAULT_INTERNAL_JOB_TIMEOUT_MS,
    );
  }

  refreshEnterpriseBillMonthSummaries() {
    return this.request(
      'POST',
      '/v2/enterprise-bill-month-summaries/refresh',
      undefined,
      undefined,
      this.jobTimeoutMs,
    );
  }

  closeEnterpriseBillMonthSummaries(billingAccountId?: string) {
    return this.request(
      'POST',
      '/v2/enterprise-bill-month-summaries/close',
      undefined,
      billingAccountId ? { billingAccountId } : undefined,
      this.jobTimeoutMs,
    );
  }

  summarizeEnterpriseBills(ids: string[]) {
    return this.request<{ items: EnterpriseBillAccountSummary[] }>(
      'GET',
      '/v2/enterprise-accounts',
      { ids: ids.join(',') },
    );
  }

  listEnterpriseBills(id: string, canManage: boolean, buttonVisible = false) {
    return this.request<{ items: unknown[]; buttonVisible: boolean }>(
      'GET',
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills`,
      {
        canManage: String(canManage),
        button_visible: String(buttonVisible),
      },
      undefined,
      this.billsListTimeoutMs,
    );
  }

  writeOffEnterpriseBill(id: string, yearMonth: string, body: {
    amountCents: number;
    note?: string | null;
    idempotencyKey: string;
    canManage: boolean;
  }) {
    return this.request(
      'POST',
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills/${encodeURIComponent(yearMonth)}/write-off`,
      undefined,
      body,
    );
  }

  adjustEnterpriseBill(id: string, yearMonth: string, body: {
    direction: 'increase' | 'decrease';
    amountCents: number;
    note?: string | null;
    idempotencyKey: string;
    canManage: boolean;
  }) {
    return this.request(
      'POST',
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills/${encodeURIComponent(yearMonth)}/adjust`,
      undefined,
      body,
    );
  }

  extendEnterpriseBill(id: string, yearMonth: string, body: {
    dueAt: string;
    idempotencyKey: string;
    canManage: boolean;
  }) {
    return this.request(
      'POST',
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills/${encodeURIComponent(yearMonth)}/extend`,
      undefined,
      body,
    );
  }

  compensateVoucherEnterpriseBill(id: string, yearMonth: string, body: {
    amountCents: number;
    note?: string | null;
    productId: string;
    tenantId?: string | null;
    idempotencyKey: string;
    canManage: boolean;
  }) {
    return this.request(
      'POST',
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills/${encodeURIComponent(yearMonth)}/compensate-voucher`,
      undefined,
      body,
    );
  }

  async pipeEnterpriseBillDownload(
    id: string,
    yearMonth: string,
    reply: FastifyReply,
  ): Promise<void> {
    const url = this.buildUrl(
      `/v2/enterprise-accounts/${encodeURIComponent(id)}/bills/${encodeURIComponent(yearMonth)}/download`,
    );
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: this.buildInternalHeaders(false),
        signal: AbortSignal.timeout(this.downloadTimeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `billing service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }
    if (!response.ok) {
      throw billingHttpException(await parseJson(response), response.status);
    }
    const contentType = response.headers.get('content-type')
      || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    const disposition = response.headers.get('content-disposition');
    reply.header('Content-Type', contentType).header('Cache-Control', 'no-store');
    if (disposition) {
      reply.header('Content-Disposition', disposition);
    }
    if (!response.body) {
      throw new BadGatewayException('billing download had no body');
    }
    // 和 billing 侧同样先 flush：浏览器的下载条目只在拿到 200 + Content-Disposition 时创建，
    // Node 默认会把响应头压到第一个 body 字节之后。
    const sent = reply.send(Readable.fromWeb(response.body as WebReadableStream<Uint8Array>));
    if (!reply.raw.headersSent) {
      reply.raw.flushHeaders();
    }
    await sent;
  }

  private async request<T = unknown>(
    method: string,
    path: string,
    query?: QueryParams,
    body?: unknown,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const url = this.buildUrl(path, query);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.buildInternalHeaders(body !== undefined),
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new BadGatewayException(
        `billing service unavailable: ${(err as Error)?.message ?? err}`,
      );
    }
    const payload = await parseJson(response);
    if (!response.ok) {
      throw billingHttpException(payload, response.status);
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
}

export type EnterpriseBillAccountSummary = {
  billingAccountId: string;
  earliestDueAt: string | null;
  earliestDueProjected?: boolean;
  dueWarning: boolean;
  usedCents: number;
  prepaid: boolean;
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

function resolveInternalRequestTimeoutMs(
  value: string | undefined,
  fallback = DEFAULT_INTERNAL_REQUEST_TIMEOUT_MS,
): number {
  const timeout = Number.parseInt(value || '', 10);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function extractMessage(payload: unknown): string | null {
  if (payload && typeof payload === 'object' && 'message' in payload) {
    const value = (payload as { message?: unknown }).message;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function extractCode(payload: unknown): string | undefined {
  if (payload && typeof payload === 'object' && 'code' in payload) {
    const value = (payload as { code?: unknown }).code;
    return typeof value === 'string' ? value : undefined;
  }
  return undefined;
}

function billingHttpException(payload: unknown, status: number): HttpException {
  const message = extractMessage(payload) ?? `billing service returned ${status}`;
  const code = extractCode(payload);
  return code
    ? new HttpException({ code, message }, status)
    : new HttpException(message, status);
}
