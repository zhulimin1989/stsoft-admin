import { CallHandler, ExecutionContext } from '@nestjs/common';
import { defer, lastValueFrom, of } from 'rxjs';
import { AdminRequestContextInterceptor } from './admin-request-context.interceptor';
import { clearAdminRequestContext, getAdminRequestContext } from '../request/admin-context';

function createContext(
  user?: { id?: string; presetRole?: string; adminPermissions?: string[] },
  requestMeta: { id?: string; headers?: Record<string, string> } = {},
): ExecutionContext {
  const request = { user, id: requestMeta.id, headers: requestMeta.headers ?? {} };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

describe('AdminRequestContextInterceptor', () => {
  const interceptor = new AdminRequestContextInterceptor();

  afterEach(() => {
    clearAdminRequestContext();
  });

  it('exposes admin request context throughout the subscribed handler chain', async () => {
    const handler: CallHandler = {
      handle: () => defer(() => of(getAdminRequestContext())),
    };

    const result = await lastValueFrom(
      interceptor.intercept(
        createContext({
          id: 'admin-1',
          presetRole: 'operator',
          adminPermissions: ['admin.plans.manage'],
        }, { headers: { 'x-request-id': 'req-1' } }),
        handler,
      ),
    );

    expect(result).toEqual({
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.plans.manage'],
      requestId: 'req-1',
    });
  });

  it('falls back to the fastify request id when x-request-id is absent', async () => {
    const handler: CallHandler = {
      handle: () => defer(() => of(getAdminRequestContext())),
    };

    const result = await lastValueFrom(
      interceptor.intercept(
        createContext({ id: 'admin-1' }, { id: 'fastify-req-1' }),
        handler,
      ),
    );

    expect(result).toMatchObject({ requestId: 'fastify-req-1' });
  });

  it('does not create context for unauthenticated requests', async () => {
    const handler: CallHandler = {
      handle: () => of(getAdminRequestContext()),
    };

    const result = await lastValueFrom(interceptor.intercept(createContext(), handler));

    expect(result).toBeUndefined();
  });
});
