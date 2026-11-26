import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { clearAdminRequestContext, runWithAdminRequestContext } from '../common/request/admin-context';
import { UserInternalClient } from './user-internal.client';

type ConfigMap = Record<string, string | undefined>;

function createClient(values: ConfigMap = {}): UserInternalClient {
  const config = {
    get: jest.fn((key: string) => ({
      USER_SERVICE_URL: 'http://user.test/api/internal/user/admin',
      ADMIN_TO_USER_TOKEN: 'admin-user-token',
      ADMIN_TO_USER_CONTEXT_SECRET: 'admin-user-context-secret',
      ...values,
    })[key]),
  } as unknown as ConfigService;
  return new UserInternalClient(config);
}

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('UserInternalClient', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn(async () => okResponse()) as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAdminRequestContext();
    jest.restoreAllMocks();
  });

  it('sends caller token and signed admin context to user-api', async () => {
    const client = createClient();

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.users.manage'],
      requestId: 'req-admin-1',
    }, () => client.listUsers(1, 20));

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-internal-caller']).toBe('admin-api');
    expect(headers['x-internal-token']).toBe('admin-user-token');
    expect(headers['x-billing-api-version']).toBe('2026-05-16');
    expect(headers['x-admin-context-signature']).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.parse(Buffer.from(headers['x-admin-context'], 'base64url').toString('utf8'));
    expect(payload).toMatchObject({
      version: 1,
      adminId: 'admin-1',
      permissions: ['admin.users.manage'],
      requestId: 'req-admin-1',
    });
  });

  it('does not send performedBy in user mutation bodies', async () => {
    const client = createClient();

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.users.manage'],
    }, () => client.createUser({ email: 'u@example.com' }, 'spoofed-admin'));

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toEqual({ email: 'u@example.com' });
  });

  it('forwards balance adjustment idempotency keys', async () => {
    const client = createClient();

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.users.manage'],
    }, () => client.adjustBalance('user-1', 1000, 'manual', 'admin-1', 'adjust-key-1'));

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init?.body as string)).toEqual({
      amountCents: 1000,
      description: 'manual',
      idempotencyKey: 'adjust-key-1',
    });
  });

  it('calls the user stats internal endpoint', async () => {
    const client = createClient();

    await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.users.view'],
    }, () => client.getUserStats());

    expect(fetchMock.mock.calls[0][0]).toBe('http://user.test/api/internal/user/admin/users/stats');
  });

  it('fetches enterprise license files as binary with signed admin context', async () => {
    fetchMock.mockResolvedValueOnce(new Response(Buffer.from('license'), {
      status: 200,
      headers: {
        'content-type': 'image/png',
        'content-length': '7',
        'content-disposition': "inline; filename=\"license.png\"; filename*=UTF-8''%E8%90%A5%E4%B8%9A.png",
      },
    }));
    const client = createClient();

    const file = await runWithAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.enterprise_accounts.review'],
      requestId: 'req-admin-1',
    }, () => client.getEnterpriseLicenseFile('verification-1'));

    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://user.test/api/internal/user/admin/enterprise-verifications/verification-1/license-file',
    );
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-internal-token']).toBe('admin-user-token');
    expect(headers['x-admin-context-signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['content-type']).toBeUndefined();
    expect(file).toEqual({
      buffer: Buffer.from('license'),
      contentType: 'image/png',
      contentLength: 7,
      filename: '营业.png',
    });
  });

  it('does not fall back to old shared internal tokens', async () => {
    clearAdminRequestContext();
    const client = createClient({
      ADMIN_TO_USER_TOKEN: undefined,
      BILLING_INTERNAL_TOKEN: 'legacy-token',
      SYNC_TOKEN: 'sync-token',
    });

    await expect(client.listUsers(1, 20)).rejects.toThrow(InternalServerErrorException);
  });
});
