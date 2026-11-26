import { Params } from 'nestjs-pino';
import { randomUUID } from 'crypto';
import { isProductionEnv } from '../runtime/is-production';
import { isEnterpriseAdminUrl, enterpriseAdminOperationId, enterpriseAdminTelemetryPath } from '../../enterprise-admin/enterprise-admin-http';

export function createLoggerConfig(): Params {
  const isProduction = isProductionEnv();

  return {
    pinoHttp: {
      genReqId: (req) => {
        if (isEnterpriseAdminUrl(req.url ?? '/')) return enterpriseAdminOperationId(req.headers['x-request-id']);
        return (req.headers['x-request-id'] as string) || randomUUID();
      },
      autoLogging: true,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: isEnterpriseAdminUrl(req.url ?? '/') ? enterpriseAdminTelemetryPath(req.url!) : req.url,
          };
        },
        res(res) {
          return { statusCode: res.statusCode };
        },
      },
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-internal-token"]', 'req.headers["x-admin-context"]', 'req.headers["x-admin-context-signature"]',
          'req.body.phone', 'req.body.ownerPhone', 'req.body.password', 'req.body.oldPassword', 'req.body.newPassword'],
        censor: '[REDACTED]',
      },
      level: isProduction ? 'info' : 'debug',
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { colorize: true, singleLine: true } },
    },
  };
}
