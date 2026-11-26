import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';
import { runWithAdminRequestContext } from '../request/admin-context';
import { isEnterpriseAdminUrl, enterpriseAdminOperationId, enterpriseAdminFailure } from '../../enterprise-admin/enterprise-admin-http';
import { EnterpriseAdminError } from '@ruidong/shared';

type AdminContextRequest = FastifyRequest & {
  id?: string;
  user?: {
    id?: string;
    presetRole?: string;
    adminPermissions?: string[];
  };
};

@Injectable()
export class AdminRequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AdminContextRequest>();
    const adminId = request.user?.id;
    if (!adminId) {
      return next.handle();
    }
    const headerRequestId = request.headers['x-request-id'];
    let requestId = Array.isArray(headerRequestId)
      ? headerRequestId[0]
      : headerRequestId || request.id;
    if (isEnterpriseAdminUrl(request.url ?? '/')) {
      const supplied = Array.isArray(headerRequestId) ? null : headerRequestId;
      if (supplied && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplied)) enterpriseAdminFailure(EnterpriseAdminError.INVALID_INPUT, 400);
      if (request.method === 'POST' && /\/(retry|recover)$/.test(request.url.split('?')[0]) && !supplied) enterpriseAdminFailure(EnterpriseAdminError.INVALID_INPUT, 400);
      requestId = enterpriseAdminOperationId(supplied ?? request.id);
      context.switchToHttp().getResponse().header('X-Request-Id', requestId);
    }

    return new Observable<unknown>((subscriber) =>
      runWithAdminRequestContext(
        {
          adminId,
          presetRole: request.user?.presetRole,
          permissions: request.user?.adminPermissions,
          requestId,
        },
        () => {
          const subscription = next.handle().subscribe(subscriber);
          return () => subscription.unsubscribe();
        },
      ),
    );
  }
}
