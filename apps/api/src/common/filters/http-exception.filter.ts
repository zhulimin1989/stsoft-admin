import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { ErrorCode, EnterpriseAdminError } from '@ruidong/shared';
import { isEnterpriseAdminUrl } from '../../enterprise-admin/enterprise-admin-http';

const HTTP_TO_ERROR_CODE: Record<number, ErrorCode> = {
  400: ErrorCode.VALIDATION_ERROR,
  401: ErrorCode.AUTH_UNAUTHORIZED,
  403: ErrorCode.AUTH_FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  429: ErrorCode.RATE_LIMIT_EXCEEDED,
};

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const enterprise = isEnterpriseAdminUrl(ctx.getRequest?.()?.url ?? '/');
    const transport = exception as { code?: string; statusCode?: number };
    if (enterprise && ((transport?.code === 'FST_ERR_CTP_BODY_TOO_LARGE' && transport.statusCode === 413) || (transport?.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' && transport.statusCode === 415))) {
      reply.header('Connection', 'close').code(transport.statusCode).send({ code: EnterpriseAdminError.UPLOAD_INVALID, message: '文件或上传格式超出允许范围', data: null }); return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      if (enterprise && [413, 415].includes(status)) { reply.header('Connection', 'close').code(status).send({ code: EnterpriseAdminError.UPLOAD_INVALID, message: '文件或上传格式超出允许范围', data: null }); return; }

      // 支持自定义 code：throw new HttpException({ code: 'BILLING_...', message }, 4xx)
      let code: string = HTTP_TO_ERROR_CODE[status] ?? ErrorCode.INTERNAL_ERROR;
      let message: string = exception.message;

      if (typeof response === 'object' && response !== null) {
        const res = response as Record<string, unknown>;
        if (typeof res.code === 'string') code = res.code;
        if (typeof res.message === 'string') message = res.message;

        // 429 限流：设置 Retry-After header
        if (status === 429 && typeof res.retryAfter === 'number') {
          reply.header('Retry-After', String(res.retryAfter));
        }
      }

      reply.code(status).send({ code, message, data: null });
      return;
    }

    // 未知异常。公共 filter 不写 stack，避免把内部路径/实现细节打进
    // 统一 HTTP 日志；需要堆栈的业务路径应在本地 catch 中单独记录。
    const detail = exception instanceof Error
      ? `${exception.name}: ${exception.message}`
      : String(exception);
    this.logger.error(enterprise ? 'enterprise_admin_proxy_http_failure' : `Unhandled exception: ${detail}`);
    reply.code(500).send({
      code: ErrorCode.INTERNAL_ERROR,
      message: '服务器内部错误',
      data: null,
    });
  }
}
