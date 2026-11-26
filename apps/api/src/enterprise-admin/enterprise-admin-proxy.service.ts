import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnterpriseAdminCapabilities, EnterpriseAdminError as E } from '@ruidong/shared';
import { UserInternalClient } from '../user/user-internal.client';
import { AdminActivityLogService } from '../admin/admin-activity-log.service';
import { getAdminRequestContext } from '../common/request/admin-context';
import { enterpriseAdminFailure, enterpriseAdminMaxBytes } from './enterprise-admin-http';
@Injectable()
export class EnterpriseAdminProxyService {
  constructor(private readonly user: UserInternalClient, private readonly activity: AdminActivityLogService, private readonly config: ConfigService) {}
  async call(method: 'GET' | 'POST', suffix: string, query?: Record<string, string | number | boolean | undefined | null>, body?: unknown, resourceId?: string) {
    return this.track(method + ':' + suffix.replace(/[0-9a-f-]{36}/gi, ':id'), resourceId, () => this.user.enterpriseAdminRequest(method, suffix, query, body));
  }
  async upload(sessionId: string, body: unknown, mime: string) {
    if (!Buffer.isBuffer(body) || !/^multipart\/form-data\s*;\s*boundary=(?:"[^"\r\n]{1,70}"|[^;\s]{1,70})\s*$/i.test(mime)) enterpriseAdminFailure(E.UPLOAD_INVALID, 400);
    const caps = await this.user.enterpriseAdminRequest<EnterpriseAdminCapabilities>('GET', '/capabilities');
    const max = this.max(caps);
    if (body.length > max + 1024 * 1024) enterpriseAdminFailure(E.UPLOAD_INVALID, 413);
    return this.track('UPLOAD_LICENSE', sessionId, () => this.user.enterpriseAdminUpload(sessionId, body, mime));
  }
  async file(sessionId: string, uploadId: string, signal?: AbortSignal) {
    const max = this.max(await this.user.enterpriseAdminRequest<EnterpriseAdminCapabilities>('GET', '/capabilities'));
    return this.track('READ_LICENSE', sessionId, () => this.user.enterpriseAdminFile(`/upload-sessions/${sessionId}/license/${uploadId}/file`, max, undefined, signal));
  }
  async recordFile(requestId: string, signal?: AbortSignal) {
    const max = this.max(await this.user.enterpriseAdminRequest<EnterpriseAdminCapabilities>('GET', '/capabilities'));
    return this.track('READ_ACCEPTED_LICENSE', requestId, () => this.user.enterpriseAdminFile(`/${requestId}/license-file`, max, undefined, signal));
  }
  private max(caps: EnterpriseAdminCapabilities) {
    if (!Number.isInteger(caps?.licenseMaxBytes) || caps.licenseMaxBytes < 1) enterpriseAdminFailure(E.UPLOAD_UNAVAILABLE);
    return Math.min(caps.licenseMaxBytes, enterpriseAdminMaxBytes(this.config));
  }
  private async track<T>(action: string, resourceId: string | undefined, work: () => Promise<T>): Promise<T> {
    const ctx = getAdminRequestContext(); if (!ctx?.adminId || !ctx.requestId) enterpriseAdminFailure(E.STATE_CONFLICT);
    try {
      const result = await work(); const data = result as { requestId?: string; verificationId?: string; record?: { requestId?: string; verificationId?: string } };
      void this.activity.logEnterpriseAdmin({ adminId: ctx.adminId, operationId: ctx.requestId, action, resourceId,
        requestId: data?.requestId ?? data?.record?.requestId, verificationId: data?.verificationId ?? data?.record?.verificationId });
      return result;
    } catch (error) {
      const code = (error as { getResponse?: () => { code?: string } }).getResponse?.()?.code;
      void this.activity.logEnterpriseAdmin({ adminId: ctx.adminId, operationId: ctx.requestId, action, resourceId, errorCode: code });
      throw error;
    }
  }
}
