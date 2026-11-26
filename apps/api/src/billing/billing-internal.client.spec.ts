import { ConfigService } from '@nestjs/config';
import { GatewayTimeoutException, InternalServerErrorException } from '@nestjs/common';
import { BillingInternalClient } from './billing-internal.client';
import { clearAdminRequestContext, setAdminRequestContext } from '../common/request/admin-context';

type ConfigMap = Record<string, string | undefined>;

function createClient(values: ConfigMap = {}): BillingInternalClient {
  const config = {
    get: jest.fn((key: string) => ({
      BILLING_SERVICE_URL: 'http://billing.test/api/internal/billing/admin',
      ADMIN_TO_BILLING_TOKEN: 'admin-billing-token',
      ADMIN_TO_BILLING_CONTEXT_SECRET: 'admin-billing-context-secret',
      ...values,
    })[key]),
  } as unknown as ConfigService;
  return new BillingInternalClient(config);
}

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ code: 0, message: 'ok', data }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('BillingInternalClient', () => {
  const paymentCallbackPolicies: Array<[string, string[] | null]> = [
    ['global fallback', null],
    ['deny all', []],
    ['product allowlist', ['https://app.example.com']],
  ];
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

  it('sends the internal token and default API version on every billing internal method', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.plans.manage', 'admin.plans.view'],
      requestId: 'req-admin-1',
    });
    const user = { id: 'user-1', email: 'user@example.com', isActive: true };
    const invocations: Array<() => Promise<unknown>> = [
      () => client.listOrders(1, 20, { status: 'PAID', search: 'order' }),
      () => client.getOrderDetail('order-1'),
      () => client.adminCancelOrder('order-1', 'admin-1', 'duplicate'),
      () => client.retryFailedOrder('order-1', 'admin-1'),
      () => client.refundOrder('order-1', 'customer request'),
      () => client.getStats(),
	      () => client.getRevenue(),
	      () => client.getRevenueOverview(7),
	      () => client.getFinanceReports('2026-05'),
	      () => client.getFinanceReportOverview('2026-05'),
	      () => client.getFinanceReportDetail({
	        month: '2026-05',
	        tab: 'apiUsage',
	        pageSize: 100,
	        cursor: 'cursor-1',
	      }),
	      () => client.listTransactions(1, 20, { userId: 'user-1' }),
      () => client.listSubscriptions({
        page: 1,
        pageSize: 20,
        status: 'ACTIVE',
        expiringDays: 7,
        productId: 'product-1',
        userId: 'user-1',
      }),
      () => client.grantSubscriptionCredits('sub-1', { amount: 100, reason: 'manual grant' }),
      () => client.listPaygAccounts({ page: 1, pageSize: 20, email: 'user@example.com' }),
      () => client.issuePaygVoucher('tenant-1', {
        userId: 'user-1',
        productId: 'product-1',
        amountCents: 1000,
        reason: 'support voucher',
        expiresAt: '2030-01-01T00:00:00.000Z',
        performedBy: 'admin-1',
      }),
      () => client.listPlans(),
      () => client.getPlanById('plan-1'),
      () => client.createOrUpdatePlan({ id: 'plan-1', name: 'Plan 1' }),
      () => client.updatePlan('plan-1', { name: 'Plan 1' }),
      () => client.listPlanPrices('plan-1'),
      () => client.upsertPlanPrice('plan-1', {
        currency: 'USD',
        monthlyPrice: 10,
        quarterlyPrice: 27,
        yearlyPrice: 100,
      }),
      () => client.deletePlanPrice('plan-1', 'USD'),
      () => client.listBundleSkus({ isActive: true }),
      () => client.getBundleSkuById('bundle-1'),
      () => client.createBundleSku({ id: 'bundle-1', name: 'Bundle 1' }),
      () => client.updateBundleSku('bundle-1', { name: 'Bundle 1' }),
      () => client.deleteBundleSku('bundle-1'),
      () => client.listProducts(),
      () => client.createProduct({ id: 'product-1', name: 'Product 1', slug: 'product-1' }),
      () => client.updateProduct('product-1', { name: 'Product 1' }),
      () => client.deleteProduct('product-1'),
      () => client.listRechargeTierProducts(),
      () => client.listRechargeTiers({ page: 1, pageSize: 20, productId: 'product-1', isActive: true }),
      () => client.getRechargeTier('tier-1'),
      () => client.createRechargeTier({
        productId: 'product-1',
        amountCents: 1000,
        bonusType: 'FIXED',
        bonusValue: 100,
      }),
      () => client.updateRechargeTier('tier-1', { isActive: false }),
      () => client.deleteRechargeTier('tier-1'),
      () => client.cloneRechargeTier('tier-1'),
      () => client.getProductIntegration('product-1'),
      () => client.getProductRuntimePolicy('product-1'),
      () => client.updateProductRuntimePolicy('product-1', { status: 'active' }),
      () => client.listProductChannels('product-1'),
      () => client.createProductChannel('product-1', { channelId: 'channel-1' }),
      () => client.updateProductChannel('product-1', 'product-channel-1', { weight: 2 }),
      () => client.deleteProductChannel('product-1', 'product-channel-1'),
      () => client.listProductChannelGroups('product-1'),
      () => client.createProductChannelGroup('product-1', { code: 'default', name: 'Default' }),
      () => client.updateProductChannelGroup('product-1', 'group-1', { name: 'Default' }),
      () => client.deleteProductChannelGroup('product-1', 'group-1'),
      () => client.addProductChannelGroupMember('product-1', 'group-1', { productChannelId: 'product-channel-1' }),
      () => client.updateProductChannelGroupMember('product-1', 'group-1', 'member-1', { weight: 2 }),
      () => client.deleteProductChannelGroupMember('product-1', 'group-1', 'member-1'),
      () => client.listProductRouteAssignments('product-1', { subjectType: 'USER', isActive: true }),
      () => client.createProductRouteAssignment('product-1', {
        subjectType: 'USER',
        subjectId: 'user-1',
        targetType: 'GROUP',
        targetId: 'group-1',
      }),
      () => client.updateProductRouteAssignment('product-1', 'assignment-1', { priority: 200 }),
      () => client.deleteProductRouteAssignment('product-1', 'assignment-1'),
      () => client.previewProductRouteGraph('product-1'),
      () => client.rebuildProductRouteGraph('product-1'),
      () => client.rotateProductIntegrationToken('product-1'),
      () => client.rotateProductWebhookSecret('product-1'),
      () => client.listBoosterPacks(),
      () => client.createBoosterPack({ id: 'pack-1', name: 'Pack 1' }),
      () => client.updateBoosterPack('pack-1', { name: 'Pack 1' }),
      () => client.deleteBoosterPack('pack-1'),
      () => client.getUserBalance('user-1'),
      () => client.getUserCreditOverview('user-1'),
      () => client.adjustBalance('user-1', { amountCents: 1000, description: 'manual', user }),
      () => client.applyClassifiedBalanceAdjustment('user-1', {
        amountCents: 1000,
        reasonCode: 'DISCOUNT_CORRECTION',
        description: 'discount correction',
        performedBy: 'admin-1',
        idempotencyKey: 'adjustment-key-1',
        user,
      }),
      () => client.applyEnterpriseBalanceAdjustment('account-1', {
        amountCents: -500,
        reasonCode: 'BILLING_CORRECTION',
        description: 'billing correction',
        performedBy: 'admin-1',
        idempotencyKey: 'adjustment-key-2',
      }),
      () => client.ensureDefaultFreePlan('user-1', 'register_free', user),
      () => client.listPaymentInstances(),
      () => client.createPaymentInstance({ name: 'stripe' }),
      () => client.updatePaymentInstance('payment-1', { name: 'stripe' }),
      () => client.deletePaymentInstance('payment-1'),
      () => client.listPaygModelPricing('product-1'),
      () => client.createPaygModelPricingVersion({ productId: 'product-1', modelName: 'gpt-4o' }),
      () => client.deactivatePaygModelPricingPolicy('policy-1'),
      () => client.listProviderCostPolicies({ providerCode: 'openai' }),
      () => client.createProviderCostPolicy({ providerCode: 'openai', modelName: 'gpt-4o' }),
      () => client.deactivateProviderCostPolicy('provider-cost-1'),
      () => client.deleteProviderCostPolicy('provider-cost-1'),
      () => client.listProviderAccountIdentities(),
      () => client.createProviderAccountIdentity({ providerCode: 'kimi', displayName: 'Kimi 主账户' }),
      () => client.deactivateProviderAccountIdentity('provider-account-1'),
      () => client.backfillProviderCostTokenUsage({ month: '2026-05' }),
      () => client.quoteUsage({ userId: 'user-1', modelName: 'gpt-4o' }),
      () => client.authorizeUsage({ userId: 'user-1', modelName: 'gpt-4o' }),
      () => client.deductUsage({
        userId: 'user-1',
        modelName: 'gpt-4o',
        source: 'test',
        idempotencyKey: 'idem-1',
      }),
      () => client.listGatewayEvents({ page: 1, pageSize: 20, status: 'FAILED' }),
      () => client.getGatewayEvent('request-1'),
      () => client.retryGatewayEvent('request-1', {
        expectedRevision: 2,
        reason: 'transient failure',
        idempotencyKey: 'gateway-retry-1',
      }),
      () => client.markGatewayEventManualReview('request-1', {
        expectedRevision: 2,
        reason: 'evidence requires review',
        idempotencyKey: 'gateway-review-1',
      }),
      () => client.absorbGatewayEvent('request-1', {
        expectedRevision: 3,
        reason: 'approved platform absorption',
        idempotencyKey: 'gateway-absorb-1',
      }),
      () => client.absorbGatewayEventDelta('request-1', {
        evidenceId: 'evidence-correction-1',
        expectedRevision: 4,
        reason: 'approved historical undercount absorption',
        idempotencyKey: 'gateway-absorb-delta-1',
      }),
      () => client.syncDeploymentConfig({
        version: '2',
        region: 'domestic',
        provider: 'authing',
        currency: 'cny',
        defaultLanguage: 'zh',
        oauth: {},
      }),
      () => client.listUsagePolicies('product-1'),
      () => client.createUsagePolicy({ productId: 'product-1', name: 'Policy 1' }),
      () => client.updateUsagePolicy('policy-1', { name: 'Policy 1' }),
      () => client.deleteUsagePolicy('policy-1'),
      () => client.downloadInvoicesZip(['invoice-1']),
      () => client.approveInvoice('invoice-1', 'ok'),
      () => client.retryPsaInvoice('invoice-1'),
      () => client.downloadPsaInvoiceAttachment('invoice-1'),
    ];

    for (const invoke of invocations) {
      await invoke();
    }

    expect(fetchMock).toHaveBeenCalledTimes(invocations.length);
    for (const [, init] of fetchMock.mock.calls) {
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-internal-caller']).toBe('admin-api');
      expect(headers['x-internal-token']).toBe('admin-billing-token');
      expect(headers['x-billing-api-version']).toBe('2026-05-16');
      expect(headers['x-admin-context']).toBeTruthy();
      expect(headers['x-admin-context-signature']).toMatch(/^[0-9a-f]{64}$/);
      expect(headers['x-billing-internal-token']).toBeUndefined();
      expect(headers['x-admin-id']).toBeUndefined();
    }
  });

  it('uses a longer timeout for invoice approve and PSA retry', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.invoices.manage'],
    });

    await client.approveInvoice('invoice-1', 'ok');
    await client.retryPsaInvoice('invoice-1');
    await client.downloadPsaInvoiceAttachment('invoice-1');
    await client.getInvoiceDetail('invoice-1');

    expect(timeoutSpy.mock.calls.map((call) => call[0])).toEqual([60_000, 60_000, 60_000, 10_000]);
  });

  it('uses the finance-specific timeout without changing the global internal timeout', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    const client = createClient({ FINANCE_REPORT_REQUEST_TIMEOUT_MS: '31000' });
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.data.finance_reports.view'],
    });

    await client.getFinanceReportOverview('2026-09');
    await client.getFinanceReportDetail({ month: '2026-09', tab: 'balance', pageSize: 20 });
    await client.getInvoiceDetail('invoice-1');

    expect(timeoutSpy.mock.calls.map((call) => call[0])).toEqual([31_000, 31_000, 10_000]);
  });

  it('maps an internal finance timeout to 504', async () => {
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('timed out'), { name: 'TimeoutError' }));
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.data.finance_reports.view'],
    });

    await expect(client.getFinanceReportOverview('2026-09'))
      .rejects.toBeInstanceOf(GatewayTimeoutException);
  });

  it('uses an explicitly configured billing internal API version', async () => {
    const client = createClient({ BILLING_INTERNAL_API_VERSION: ' 2026-06-01 ' });
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.plans.view'],
    });

    await client.listProducts();

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-billing-api-version']).toBe('2026-06-01');
  });

  it('forwards finance report filters to the billing details endpoint', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.data.finance_reports.view'],
    });

    await client.getFinanceReportDetail({
      month: '2026-08',
      tab: 'balance',
      billingMode: 'PAY_AS_YOU_GO',
      pageSize: 50,
      cursor: 'cursor-token',
      filterField: 'transactionId',
      filterValue: 'tx-adjustment-1',
    });

    const [rawUrl] = fetchMock.mock.calls[0];
    const url = new URL(String(rawUrl));
    expect(url.pathname).toBe('/api/internal/billing/admin/finance-reports/details');
    expect(Object.fromEntries(url.searchParams.entries())).toEqual({
      month: '2026-08',
      tab: 'balance',
      billingMode: 'PAY_AS_YOU_GO',
      pageSize: '50',
      cursor: 'cursor-token',
      filterField: 'transactionId',
      filterValue: 'tx-adjustment-1',
    });
  });

  it('uses the provider account identity control-plane contract', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.catalog.channels.view', 'admin.data.channels.manage'],
    });
    const body = { providerCode: 'kimi', displayName: 'Kimi 主账户' };

    await client.listProviderAccountIdentities();
    await client.createProviderAccountIdentity(body);
    await client.deactivateProviderAccountIdentity('account/1');

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [
        'http://billing.test/api/internal/billing/admin/provider-account-identities',
        'GET',
        undefined,
      ],
      [
        'http://billing.test/api/internal/billing/admin/provider-account-identities',
        'POST',
        JSON.stringify(body),
      ],
      [
        'http://billing.test/api/internal/billing/admin/provider-account-identities/account%2F1/deactivate',
        'POST',
        undefined,
      ],
    ]);
  });

  it.each(paymentCallbackPolicies)(
    'preserves the %s payment callback policy when updating a product',
    async (_label, policy) => {
      const client = createClient();
      setAdminRequestContext({
        adminId: 'admin-1',
        permissions: ['admin.page.products.manage'],
      });

      await client.updateProduct('product-1', { allowedPaymentCallbackOrigins: policy });

      expect(fetchMock).toHaveBeenCalledWith(
        'http://billing.test/api/internal/billing/admin/products/product-1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ allowedPaymentCallbackOrigins: policy }),
        }),
      );
    },
  );

  it('passes productId to revenue endpoints', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.revenue.view'],
    });

    await client.getRevenue('product-1');
    await client.getRevenueOverview(30, 'product-1');

    expect(fetchMock.mock.calls[0][0]).toBe('http://billing.test/api/internal/billing/admin/revenue?productId=product-1');
    expect(fetchMock.mock.calls[1][0]).toBe('http://billing.test/api/internal/billing/admin/revenue/overview?days=30&productId=product-1');
  });

  it('forwards an account-level enterprise balance adjustment without product binding', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      permissions: ['admin.page.enterprise_accounts.manage'],
    });
    const body = {
      amountCents: -500,
      reasonCode: 'BILLING_CORRECTION' as const,
      description: 'billing correction',
      performedBy: 'admin-1',
      idempotencyKey: 'adjustment-key-2',
    };

    await client.applyEnterpriseBalanceAdjustment('account/1', body);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://billing.test/api/internal/billing/admin/enterprise-accounts/account%2F1/balance-adjustment',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(body),
      }),
    );
  });

  it('sends the CAS contract to each gateway evidence action endpoint', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'finance-1',
      permissions: ['admin.page.gateway_billing_events.settle'],
    });
    const body = {
      expectedRevision: 5,
      reason: 'incident FIN-42',
      idempotencyKey: 'gateway-action-5',
    };

    await client.retryGatewayEvent('request/1', body);
    await client.markGatewayEventManualReview('request/1', body);
    await client.reconcileAndSettleGatewayEvent('request/1', {
      evidenceId: 'evidence-1',
      ...body,
    });
    await client.absorbGatewayEvent('request/1', body);
    await client.absorbGatewayEventDelta('request/1', {
      evidenceId: 'evidence-2',
      ...body,
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [
        'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/retry',
        'POST',
        JSON.stringify(body),
      ],
      [
        'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/manual-review',
        'POST',
        JSON.stringify(body),
      ],
      [
        'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/reconcile-settle',
        'POST',
        JSON.stringify({ evidenceId: 'evidence-1', ...body }),
      ],
      [
        'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/absorb',
        'POST',
        JSON.stringify(body),
      ],
      [
        'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/absorb-delta',
        'POST',
        JSON.stringify({ evidenceId: 'evidence-2', ...body }),
      ],
    ]);
  });

  it('forwards the versioned unanchored currency repair proof without rewriting it', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'finance-1',
      permissions: ['admin.page.gateway_billing_events.absorb'],
    });
    const body = {
      expectedRevision: 1,
      reason: 'approved audited legacy currency closure',
      idempotencyKey: 'absorb-currency-1',
      protocol: 'gateway-unanchored-absorb-v1' as const,
      currencyRepairRunId: 'repair-run-1',
      currencyRepairItemId: 'repair-item-1',
      manifestHash: 'a'.repeat(64),
    };

    await client.absorbGatewayEvent('request/1', body);

    expect(fetchMock).toHaveBeenLastCalledWith(
      'http://billing.test/api/internal/billing/admin/gateway-events/request%2F1/absorb',
      expect.objectContaining({ body: JSON.stringify(body) }),
    );
  });

  it('proxies the complete historical platform loss batch contract', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'finance-1',
      presetRole: 'finance',
      permissions: [
        'admin.page.historical_platform_losses.view',
        'admin.page.historical_platform_losses.prepare',
        'admin.page.historical_platform_losses.approve_post',
      ],
    });
    const draft = {
      provider: 'zhipu',
      providerAccountRef: 'account-1',
      region: 'domestic',
      periodStart: '2026-07-01',
      periodEnd: '2026-08-01',
      currency: 'CNY',
      sourceFileRef: 'oss://finance/source.xlsx?versionId=1',
      sourceFileSha256: 'a'.repeat(64),
      calculationMethod: 'TOKEN_RATE_PER_MILLION_V1' as const,
      roundingPolicy: 'HALF_UP_12' as const,
      exchangeRate: '7.2',
      exchangeRateSource: 'PBOC',
      exchangeRateSourceCurrency: 'USD',
      exchangeRateAsOf: '2026-07-31T00:00:00.000Z',
      reason: 'FIN-42',
      lines: [{
        lineType: 'PROVIDER_AGGREGATE' as const,
        sourceRowRef: '2',
        sourceEvidence: { row: 2 },
        serviceDate: '2026-07-01',
        model: 'glm-5.2',
        meter: 'INPUT',
        platformUsage: '100',
        providerUsage: '110',
        providerAggregateRef: '2026-07-01|glm-5.2|INPUT',
        valuationBasis: {
          version: 'glm-2026-07-v1',
          rateUnit: 'TOKENS_PER_MILLION' as const,
          pricingCurrency: 'CNY',
          customerRatePerMillion: '4',
          providerCostRatePerMillion: '2',
          pricingSourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
          pricingDocumentSha256: 'c'.repeat(64),
          pricingEvidenceHash: 'd'.repeat(64),
          pricingEffectiveFrom: '2026-07-01',
          pricingEffectiveTo: '2026-08-01',
          pricingApprovedBy: 'finance-pricing-committee',
          pricingApprovedAt: '2026-06-30T08:00:00.000Z',
          pricingEvidence: {
            sourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
            documentSha256: 'c'.repeat(64),
          },
        },
      }],
    };
    const create = {
      ...draft,
      expectedFingerprint: 'b'.repeat(64),
      idempotencyKey: 'prepare-1',
    };
    const approval = {
      expectedRevision: 0,
      expectedFingerprint: 'b'.repeat(64),
      reason: 'approved FIN-42',
      idempotencyKey: 'approve-1',
    };

    await client.previewHistoricalPlatformLossBatch(draft);
    await client.createHistoricalPlatformLossBatch(create);
    await client.listHistoricalPlatformLossBatches({ page: 2, pageSize: 20, status: 'PREPARED' });
    await client.getHistoricalPlatformLossBatch('batch/1');
    await client.approveAndPostHistoricalPlatformLossBatch('batch/1', approval);
    await client.exportHistoricalPlatformLossBatch('batch/1');

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method, init?.body])).toEqual([
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches/preview',
        'POST',
        JSON.stringify(draft),
      ],
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches',
        'POST',
        JSON.stringify(create),
      ],
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches?page=2&pageSize=20&status=PREPARED',
        'GET',
        undefined,
      ],
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches/batch%2F1',
        'GET',
        undefined,
      ],
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches/batch%2F1/approve-and-post',
        'POST',
        JSON.stringify(approval),
      ],
      [
        'http://billing.test/api/internal/billing/admin/historical-platform-loss-batches/batch%2F1/export',
        'GET',
        undefined,
      ],
    ]);
  });

  it('streams a finance export without buffering the complete CSV', async () => {
    const csv = '\uFEFF账期,流水ID\n2026-09,tx-1';
    fetchMock.mockResolvedValueOnce(new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-length': String(Buffer.byteLength(csv)),
        'content-disposition': "attachment; filename*=UTF-8''finance-%E8%B4%A2%E5%8A%A1.csv",
      },
    }));
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'finance',
      permissions: ['admin.page.finance_export_jobs.download'],
      requestId: 'req-export-1',
    });

    const result = await client.downloadFinanceReportExportJob('job/1');
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(Buffer.from(chunk));

    expect(fetchMock).toHaveBeenCalledWith(
      'http://billing.test/api/internal/billing/admin/finance-reports/export-jobs/job%2F1/download',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result.contentType).toBe('text/csv; charset=utf-8');
    expect(result.contentLength).toBe(Buffer.byteLength(csv));
    expect(result.filename).toBe('finance-财务.csv');
    expect(Buffer.concat(chunks).toString('utf8')).toBe(csv);
  });

  it('sends a signed admin context when called inside an admin request', async () => {
    const client = createClient();
    setAdminRequestContext({
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.plans.manage', 'admin.plans.view'],
      requestId: 'req-admin-1',
    });

    await client.listOrders(1, 20);

    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['x-admin-id']).toBeUndefined();
    expect(headers['x-admin-preset-role']).toBeUndefined();
    expect(headers['x-admin-permissions']).toBeUndefined();
    expect(headers['x-admin-context-signature']).toMatch(/^[0-9a-f]{64}$/);
    const payload = JSON.parse(Buffer.from(headers['x-admin-context'], 'base64url').toString('utf8'));
    expect(payload).toMatchObject({
      version: 1,
      adminId: 'admin-1',
      presetRole: 'operator',
      permissions: ['admin.plans.manage', 'admin.plans.view'],
      requestId: 'req-admin-1',
    });
    expect(headers['x-request-id']).toBe('req-admin-1');
  });

  it('does not fall back to old shared internal tokens', async () => {
    const client = createClient({
      ADMIN_TO_BILLING_TOKEN: undefined,
      BILLING_INTERNAL_TOKEN: 'legacy-token',
      SYNC_TOKEN: 'sync-token',
    });

    await expect(client.listProducts()).rejects.toThrow(InternalServerErrorException);
  });

  it('rejects invalid billing internal API version formats', () => {
    expect(() => createClient({ BILLING_INTERNAL_API_VERSION: 'next' })).toThrow(
      'BILLING_INTERNAL_API_VERSION must use YYYY-MM-DD format',
    );
  });
});
