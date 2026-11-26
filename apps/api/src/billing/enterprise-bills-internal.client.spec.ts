import { ConfigService } from '@nestjs/config';
import { EnterpriseBillsInternalClient } from './enterprise-bills-internal.client';
import { clearAdminRequestContext, setAdminRequestContext } from '../common/request/admin-context';

function createClient(): EnterpriseBillsInternalClient {
  // Jest hooks and test bodies have separate async resources; install context in the actual request scope.
  setAdminRequestContext({adminId:'admin-1',presetRole:'super_admin',permissions:['admin.page.enterprise_accounts.manage'],requestId:'req-1'});
  const config = {
    get: jest.fn((key: string) => ({
      BILLING_SERVICE_URL: 'http://billing.test/api/internal/billing/admin',
      ADMIN_TO_BILLING_TOKEN: 'admin-billing-token',
      ADMIN_TO_BILLING_CONTEXT_SECRET: 'admin-billing-context-secret',
    })[key]),
  } as unknown as ConfigService;
  return new EnterpriseBillsInternalClient(config);
}

describe('EnterpriseBillsInternalClient month-summary jobs', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'ok', data: { processed: 0 } }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
    setAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'super_admin',
      permissions: ['admin.page.enterprise_accounts.manage'],
      requestId: 'req-1',
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAdminRequestContext();
  });

  it('still rejects a request without actual admin context before contacting Billing', async () => {
    const client = createClient();
    clearAdminRequestContext();
    await expect(client.refreshEnterpriseBillMonthSummaries()).rejects.toThrow('admin request context is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh posts without body or content-type', async () => {
    const client = createClient();
    await client.refreshEnterpriseBillMonthSummaries();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://billing.test/api/internal/billing/admin/v2/enterprise-bill-month-summaries/refresh');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)['content-type']).toBeUndefined();
    expect((init?.headers as Record<string, string>)['x-internal-caller']).toBe('admin-api');
    expect((init?.headers as Record<string, string>)['x-admin-context-signature']).toMatch(/^[a-f0-9]{64}$/);
  });

  it('close posts without body or content-type', async () => {
    const client = createClient();
    await client.closeEnterpriseBillMonthSummaries();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('http://billing.test/api/internal/billing/admin/v2/enterprise-bill-month-summaries/close');
    expect(init?.method).toBe('POST');
    expect(init?.body).toBeUndefined();
    expect((init?.headers as Record<string, string>)['content-type']).toBeUndefined();
  });

  it('forwards billing 409 idempotency code to the caller', async () => {
    fetchMock = jest.fn(async () => new Response(
      JSON.stringify({
        code: 'enterprise_bill_idempotency_conflict',
        message: '幂等键对应的账单参数不一致',
        data: null,
      }),
      { status: 409, headers: { 'content-type': 'application/json' } },
    )) as unknown as jest.MockedFunction<typeof fetch>;
    globalThis.fetch = fetchMock;
    const client = createClient();
    await expect(client.writeOffEnterpriseBill('ba-1', '2026-08', {
      amountCents: 200,
      note: '另一金额',
      idempotencyKey: 'idem-1',
      canManage: true,
    })).rejects.toMatchObject({
      response: {
        code: 'enterprise_bill_idempotency_conflict',
        message: '幂等键对应的账单参数不一致',
      },
    });
  });

  it('lists bills with a 60s timeout instead of the 10s internal default', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const client = createClient();
    await client.listEnterpriseBills('ba-1', true, false);
    expect(timeoutSpy).toHaveBeenCalledWith(60_000);
    timeoutSpy.mockRestore();
  });

  it('posts extend with an idempotency key', async () => {
    const client = createClient();
    await client.extendEnterpriseBill('ba-1', '2026-08', {
      dueAt: '2026-11-15T15:59:59.000Z',
      idempotencyKey: 'idem-ext-1',
      canManage: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'http://billing.test/api/internal/billing/admin/v2/enterprise-accounts/ba-1/bills/2026-08/extend',
    );
    expect(init?.method).toBe('POST');
    expect(JSON.parse(String(init?.body))).toEqual({
      dueAt: '2026-11-15T15:59:59.000Z',
      idempotencyKey: 'idem-ext-1',
      canManage: true,
    });
  });
});

describe('EnterpriseBillsInternalClient bill download', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearAdminRequestContext();
  });

  it('flushes the attachment headers right after send so the browser creates the download entry early', async () => {
    const client = createClient();
    let releaseBody!: () => void;
    let closeBody!: () => void;
    const bodyGate = new Promise<void>((resolve) => {
      releaseBody = resolve;
    });
    const bodyClosed = new Promise<void>((resolve) => {
      closeBody = resolve;
    });
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        // 账单 xlsx 的首字节要等聚合，这里模拟这段空窗期
        await bodyGate;
        controller.enqueue(new Uint8Array([0x50, 0x4b]));
        controller.close();
        closeBody();
      },
    });
    globalThis.fetch = jest.fn(async () => new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="bill.xlsx"',
      },
    })) as unknown as jest.MockedFunction<typeof fetch>;

    const order: string[] = [];
    const headers = new Map<string, string>();
    const raw = {
      headersSent: false,
      flushHeaders: jest.fn(() => {
        order.push('flush');
        raw.headersSent = true;
      }),
    };
    const reply = {
      header: jest.fn(),
      send: jest.fn(),
      raw,
    } as {
      header: jest.Mock<unknown, [string, string]>;
      send: jest.Mock<unknown, []>;
      raw: typeof raw;
    };
    reply.header.mockImplementation((name: string, value: string) => {
      headers.set(name, value);
      return reply;
    });
    reply.send.mockImplementation(() => {
      order.push('send');
      return reply;
    });

    await client.pipeEnterpriseBillDownload('ba-1', '2026-09', reply as never);

    // send 之后立刻 flush：Node 默认要等第一个 body 字节才发响应头。
    expect(order).toEqual(['send', 'flush']);
    expect(headers.get('Content-Disposition')).toBe('attachment; filename="bill.xlsx"');
    expect(headers.get('Cache-Control')).toBe('no-store');

    releaseBody();
    await bodyClosed;
  });
});
