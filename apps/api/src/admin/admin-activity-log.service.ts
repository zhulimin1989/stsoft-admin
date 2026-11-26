import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getAdminRequestContext } from '../common/request/admin-context';
import { EnterpriseAdminError, ErrorCode } from '@ruidong/shared';

function stringifyAuditValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

@Injectable()
export class AdminActivityLogService {
  private readonly logger = new Logger(AdminActivityLogService.name);

  constructor(private readonly prisma: PrismaService) {}
  async logEnterpriseAdmin(data: { adminId: string; operationId: string; action: string; resourceId?: string; requestId?: string; verificationId?: string; errorCode?: string }) {
    const uuid = (value?: string) => value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) ? value : null;
    const known: string[] = [...Object.values(EnterpriseAdminError), ErrorCode.AUTH_UNAUTHORIZED, ErrorCode.AUTH_FORBIDDEN, ErrorCode.VALIDATION_ERROR];
    try { await this.prisma.adminActivityLog.create({ data: { adminMemberId: data.adminId, operatorAdminId: data.adminId,
      action: 'ENTERPRISE_ADMIN_PROXY', resource: 'enterprise_admin_creation', resourceId: uuid(data.requestId) ?? uuid(data.resourceId), requestId: uuid(data.operationId),
      detail: JSON.stringify({ phase: data.action.replace(/[^a-z0-9_:/-]/gi, '_').slice(0, 128), businessRequestId: uuid(data.requestId),
        verificationId: uuid(data.verificationId), errorCode: data.errorCode && known.includes(data.errorCode) ? data.errorCode : null }) } }); }
    catch { this.logger.warn('enterprise_admin_activity_log_unavailable'); }
  }

  async log(data: {
    adminMemberId: string;
    action: string;
    operatorAdminId?: string;
    resource?: string;
    resourceId?: string;
    requestId?: string;
    before?: unknown;
    after?: unknown;
    ip?: string;
    userAgent?: string;
    detail?: Record<string, unknown>;
  }): Promise<void> {
    // fire-and-forget: audit failures must not block business flow,
    // but silent swallow hides DB/permission issues — warn so ops can catch them.
    try {
      await this.prisma.adminActivityLog.create({
        data: {
          adminMemberId: data.adminMemberId,
          action: data.action,
          operatorAdminId: data.operatorAdminId ?? null,
          resource: data.resource ?? null,
          resourceId: data.resourceId ?? null,
          requestId: data.requestId ?? getAdminRequestContext()?.requestId ?? null,
          beforeState: stringifyAuditValue(data.before),
          afterState: stringifyAuditValue(data.after),
          ip: data.ip ?? null,
          userAgent: data.userAgent ?? null,
          detail: JSON.stringify(data.detail ?? {}),
        },
      });
    } catch (err) {
      this.logger.warn(
        `audit log persist failed action=${data.action} adminMemberId=${data.adminMemberId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  async listByMember(adminMemberId: string, page: number, pageSize: number) {
    const [items, total] = await Promise.all([
      this.prisma.adminActivityLog.findMany({
        where: { adminMemberId },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.adminActivityLog.count({ where: { adminMemberId } }),
    ]);
    return { items, total, page, pageSize };
  }
}
