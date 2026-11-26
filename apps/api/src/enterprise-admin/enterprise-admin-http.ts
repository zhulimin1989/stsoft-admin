import { HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnterpriseAdminError as E, ErrorCode } from '@ruidong/shared';
export { ADMIN_CREATIONS_PREFIX, isEnterpriseAdminUrl, enterpriseAdminTelemetryPath, enterpriseAdminOperationId } from '../common/telemetry/enterprise-admin-telemetry';
export function enterpriseAdminMaxBytes(config: ConfigService) {
  const bytes = Number(config.get('ENTERPRISE_VERIFY_MAX_FILE_BYTES'));
  return Number.isInteger(bytes) && bytes >= 1 ? bytes : 10 * 1024 * 1024;
}
export function enterpriseAdminFailure(code: string, status = 503): never {
  const messages: Record<string, string> = {
    [E.INVALID_INPUT]: '请求字段或格式不正确', [E.DISABLED]: '代办能力暂不可用', [E.BILLING_UNAVAILABLE]: '依赖暂不可用，原操作结果请查询确认',
    [E.NOT_FOUND]: '未找到代办记录或文件', [E.IDEMPOTENCY_CONFLICT]: '原幂等键内容不一致', [E.USCC_CONFLICT]: '企业代码已占用，请核实原记录',
    [E.PHONE_CHANGED]: '手机号归属已变化，请重新核对', [E.PHONE_AMBIGUOUS]: '手机号映射不唯一，请重新核对', [E.USER_INACTIVE]: '客户账号已停用或注销',
    [E.USER_NOT_FOUND]: '未找到已注册客户', [E.OWNER_CONFLICT]: '客户已关联企业主体', [E.APPLICATION_CONFLICT]: '客户已有企业申请或未完成任务',
    [E.UPLOAD_INVALID]: '执照文件或上传格式不正确', [E.UPLOAD_EXPIRED]: '上传会话已过期', [E.UPLOAD_USED]: '文件已使用或不可消费',
    [E.UPLOAD_UNAVAILABLE]: '文件服务暂不可用', [E.AUDIT_UNAVAILABLE]: '审计暂不可用，请查询原操作结果', [E.NOT_RETRYABLE]: '原记录当前不可重试或恢复',
    [E.RESOURCE_INCOMPLETE]: '原企业资源不完整，请核实原记录', [E.STATE_CONFLICT]: '原记录状态发生变化，请查询确认',
    [ErrorCode.AUTH_UNAUTHORIZED]: '身份验证失败', [ErrorCode.AUTH_FORBIDDEN]: '权限不足', [ErrorCode.VALIDATION_ERROR]: '请求格式不正确',
  };
  throw new HttpException({ code, message: messages[code] ?? '代办服务暂不可用，请查询原操作结果', data: null }, status);
}
interface MultipartRegistrar {
  addHook(name: 'onRoute', hook: (route: { url: string; bodyLimit?: number }) => void): void;
  addContentTypeParser(type: string, options: { parseAs: 'buffer'; bodyLimit: number }, parser: (req: { url: string }, body: Buffer, done: (error: Error | null, parsed?: Buffer) => void) => void): void;
}
export function registerEnterpriseAdminMultipart(fastify: MultipartRegistrar, config: ConfigService) {
  const limit = enterpriseAdminMaxBytes(config) + 1024 * 1024;
  const upload = (url: string) => /^\/api\/admin\/v2\/enterprise-accounts\/admin-creations\/upload-sessions\/[^/]+\/license$/.test(url.split('?')[0]);
  fastify.addHook('onRoute', r => { if (upload(r.url)) r.bodyLimit = limit; });
  fastify.addContentTypeParser('multipart/form-data', { parseAs: 'buffer', bodyLimit: limit }, (req, body, done) => {
    if (!upload(req.url)) return done(new HttpException('不支持此文件上传入口', 415));
    done(null, body);
  });
}
