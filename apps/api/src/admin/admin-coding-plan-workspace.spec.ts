import { AdminService } from './admin.service';

describe('AdminService - CodingPlan workspace', () => {
  let service: AdminService;
  let repo: {
    findSystemConfigs: jest.Mock;
    upsertSystemConfig: jest.Mock;
  };
  let billingClient: {
    listProducts: jest.Mock;
    listPlans: jest.Mock;
    getPlanById: jest.Mock;
    createOrUpdatePlan: jest.Mock;
    setPlanActive: jest.Mock;
    createCodingPlanResalePlan: jest.Mock;
    updateCodingPlanResalePlan: jest.Mock;
    deletePlan: jest.Mock;
    listModelAccess: jest.Mock;
    listModelRoutePolicies: jest.Mock;
    batchUpdateModelAccess: jest.Mock;
    batchUpdateModelRoutePolicies: jest.Mock;
    listQuotaTemplates: jest.Mock;
    getQuotaTemplate: jest.Mock;
    replacePlanQuotaRules: jest.Mock;
    getProductIntegration: jest.Mock;
    listSubscriptions: jest.Mock;
    listCodingPlanProviderEntitlements: jest.Mock;
    retryCodingPlanProviderEntitlement: jest.Mock;
    listCodingPlanProviderProducts: jest.Mock;
    listCodingPlanResaleRoutes: jest.Mock;
  };

  beforeEach(() => {
    billingClient = {
      listProducts: jest.fn(),
      listPlans: jest.fn(),
      getPlanById: jest.fn(),
      createOrUpdatePlan: jest.fn(),
      setPlanActive: jest.fn().mockResolvedValue({ data: {} }),
      createCodingPlanResalePlan: jest.fn(),
      updateCodingPlanResalePlan: jest.fn(),
      deletePlan: jest.fn(),
      listModelAccess: jest.fn(),
      listModelRoutePolicies: jest.fn(),
      batchUpdateModelAccess: jest.fn(),
      batchUpdateModelRoutePolicies: jest.fn(),
      listQuotaTemplates: jest.fn(),
      // 上架校验 hasActiveQuotaTemplate 默认返回启用模板，避免无关用例被新校验拦截
      getQuotaTemplate: jest.fn().mockResolvedValue({ id: 'quota-basic', isActive: true }),
      replacePlanQuotaRules: jest.fn(),
      getProductIntegration: jest.fn(),
      listSubscriptions: jest.fn(),
      listCodingPlanProviderEntitlements: jest.fn(),
      retryCodingPlanProviderEntitlement: jest.fn(),
      listCodingPlanProviderProducts: jest.fn().mockResolvedValue({ items: [] }),
      listCodingPlanResaleRoutes: jest.fn().mockResolvedValue({ items: [] }),
    };
    repo = {
      findSystemConfigs: jest.fn().mockResolvedValue([]),
      upsertSystemConfig: jest.fn(),
    };

    const configValues: Record<string, string> = {
      JWT_SECRET: 'secret',
    };

    service = new AdminService(
      repo as any,
      {} as any,
      { get: jest.fn(), set: jest.fn(), del: jest.fn(), keys: jest.fn() } as any,
      { sign: jest.fn().mockReturnValue('token'), verify: jest.fn() } as any,
      {
        get: jest.fn((key: string) => configValues[key]),
        getOrThrow: jest.fn((key: string) => configValues[key] ?? 'secret'),
      } as any,
      { log: jest.fn(), listByMember: jest.fn() } as any,
      {} as any,
      billingClient as any,
      { syncNow: jest.fn() } as any,
    );
  });

  it('builds a CodingPlan workspace from product, plan and subscription snapshots', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-resale',
          name: 'CodingPlan Resale',
          slug: 'coding-plan-resale',
          billingMode: 'CODING_PLAN',
          codingPlanFulfillmentMode: 'provider_resale',
          isActive: true,
          defaultPlanId: 'plan-cp-pro',
        },
        {
          id: 'product-self',
          name: 'CodingPlan Self',
          slug: 'coding-plan-self',
          billingMode: 'CODING_PLAN',
          codingPlanFulfillmentMode: 'platform_model_package',
          isActive: true,
          defaultPlanId: 'plan-cp-self',
        },
        {
          id: 'product-payg',
          name: 'PAYG',
          slug: 'payg',
          billingMode: 'PAY_AS_YOU_GO',
          isActive: true,
        },
      ],
    });
    billingClient.listPlans.mockResolvedValue({
      items: [
        {
          id: 'plan-cp-pro',
          productId: 'product-resale',
          name: 'CodingPlan Pro',
          planType: 'coding_plan',
          monthlyCredits: 1000,
          features: [],
          isActive: true,
          isLegacy: false,
        },
        {
          id: 'plan-cp-self',
          productId: 'product-self',
          name: 'stsoft Model Pack',
          planType: 'coding_plan',
          monthlyCredits: 500,
          isActive: true,
          isLegacy: false,
        },
      ],
    });
    billingClient.getProductIntegration.mockResolvedValue({
      credentials: {
        hasIntegrationToken: true,
        integrationTokenPrefix: 'rpi_CP',
        hasWebhookSecret: true,
        webhookSecretPrefix: 'rwh_CP',
      },
      requirements: {
        apiKeyDefaultBinding: true,
      },
      checklist: {
        integrationToken: true,
      },
    });
    billingClient.listSubscriptions.mockImplementation((query: { productId?: string }) => Promise.resolve({
      items: [],
      total: query.productId === 'product-resale' ? 3 : 0,
    }));
    billingClient.listModelAccess.mockResolvedValue({
      items: [
        {
          planId: 'plan-cp-pro',
          modelName: 'glm-4.5',
          isActive: true,
          creditMultiplier: 1,
        },
        {
          planId: 'plan-cp-self',
          modelName: 'glm-4.5',
          isActive: true,
          creditMultiplier: 1,
        },
        {
          planId: 'plan-cp-pro',
          modelName: 'glm-4.5-air',
          isActive: false,
          creditMultiplier: 0.5,
        },
      ],
    });
    billingClient.listQuotaTemplates.mockResolvedValue({
      items: [
        {
          id: 'quota-basic',
          name: 'CodingPlan Basic Limits',
          description: 'Default request limits',
          rules: [{ metric: 'REQUESTS', windowType: 'ROLLING', durationLabel: '每分钟', durationSec: 60, limitValue: 60 }],
          referencedPlanIds: ['plan-cp-pro', 'plan-cp-self'],
          isActive: true,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-02T00:00:00.000Z'),
        },
      ],
      total: 1,
    });
    billingClient.listCodingPlanResaleRoutes.mockResolvedValue({
      items: [
        {
          id: 'route-cp-pro',
          planId: 'plan-cp-pro',
          providerLineId: 'line-provider',
          upstreamProductId: 'provider-product-pro',
          enabled: true,
          priority: 100,
        },
      ],
    });
    billingClient.listCodingPlanProviderProducts.mockResolvedValue({
      items: [
        {
          id: 'provider-product-1',
          providerLineId: 'line-provider',
          upstreamProductId: 'provider-product-pro',
          productName: 'Provider Coding Plan Pro',
          salePrice: 19900,
          productCycle: 'MONTH',
          productType: '订阅产品',
          dailySalesLimit: 100,
          monthlySalesLimit: 1000,
          yearlySalesLimit: 10000,
          maxSalesLimit: 10000,
          lastSyncedAt: '2026-01-03T00:00:00.000Z',
          providerLine: {
            id: 'line-provider',
            code: 'provider-overseas-primary',
            name: 'Provider Overseas Primary',
          },
        },
      ],
    });

    const workspace = await service.getCodingPlanWorkspace();

    expect(workspace.contract).toMatchObject({
      partnerUserIdSource: 'stsoft_user_id',
      partnerUserIdRuntimeField: 'user.id',
      purchasedPlans: 0,
      provider: 'provider_line',
    });
    expect(workspace.policy).toMatchObject({
      providerEntitlementCardinality: 'one_subscription_one_provider_coding_plan',
      stsoftApiKeyFanOut: 'multiple_stsoft_api_keys_per_subscription',
      upstreamKeyExposure: 'never_exposed_to_user',
    });
    expect(workspace.products).toHaveLength(2);
    expect(workspace.upstreamProducts).toHaveLength(1);
    expect(workspace.upstreamProducts[0]).toMatchObject({
      providerLineId: 'line-provider',
      providerLineCode: 'provider-overseas-primary',
      upstreamProductId: 'provider-product-pro',
      productId: 'provider-product-pro',
      productName: 'Provider Coding Plan Pro',
      productCycle: 'MONTH',
      source: 'synced',
      fetchedAt: '2026-01-03T00:00:00.000Z',
    });
    expect(workspace.products[0]).toMatchObject({
      id: 'product-resale',
      readiness: 'ready',
      defaultPlanName: 'CodingPlan Pro',
      activeSubscriptions: 3,
      fulfillmentMode: 'provider_resale',
    });
    expect(workspace.plans).toHaveLength(2);
    const resalePlan = workspace.plans.find((plan: { id: string }) => plan.id === 'plan-cp-pro');
    const selfManagedPlan = workspace.plans.find((plan: { id: string }) => plan.id === 'plan-cp-self');
    expect(resalePlan).toBeDefined();
    expect(selfManagedPlan).toBeDefined();
    expect(resalePlan).toMatchObject({
      id: 'plan-cp-pro',
      productName: 'CodingPlan Resale',
      fulfillmentMode: 'provider_resale',
      providerLineId: 'line-provider',
      providerLineCode: null,
      upstreamProductId: 'provider-product-pro',
      enabledModelCount: 0,
      enabledModels: [],
      quotaTemplateCount: 0,
    });
    expect(resalePlan!.quotaTemplates).toEqual([]);
    expect(selfManagedPlan).toMatchObject({
      id: 'plan-cp-self',
      fulfillmentMode: 'platform_model_package',
      providerLineId: null,
      providerLineCode: null,
      upstreamProductId: null,
      enabledModelCount: 1,
      quotaTemplateCount: 1,
    });
    expect(workspace.quotaTemplates[0]).toMatchObject({
      id: 'quota-basic',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(workspace.stats).toMatchObject({
      contractedPlans: 0,
      productCount: 2,
      activeProductCount: 2,
      sellablePlanCount: 2,
      activeSubscriptionCount: 3,
      platformModelPlanCount: 1,
      providerResalePlanCount: 1,
      providerProductBoundPlanCount: 1,
      upstreamAvailableCount: 1,
      modelConfiguredPlanCount: 1,
      quotaConfiguredPlanCount: 1,
      quotaTemplateCount: 1,
      activeQuotaTemplateCount: 1,
    });
    expect(billingClient.listQuotaTemplates).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
    expect(workspace.dataSources.upstreamProducts.status).toBe('ready');
    expect(workspace.dataSources.upstreamOrders.status).toBe('pending');
  });

  it('loads CodingPlan quota templates across billing pages', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-self',
          name: 'CodingPlan Self',
          billingMode: 'CODING_PLAN',
          codingPlanFulfillmentMode: 'platform_model_package',
          isActive: true,
          defaultPlanId: 'plan-cp-self',
        },
      ],
    });
    billingClient.listPlans.mockResolvedValue({
      items: [
        {
          id: 'plan-cp-self',
          productId: 'product-self',
          name: 'CodingPlan Self Plan',
          planType: 'coding_plan',
          isActive: true,
          isLegacy: false,
        },
      ],
    });
    billingClient.listModelAccess.mockResolvedValue({ items: [] });
    billingClient.getProductIntegration.mockResolvedValue({});
    billingClient.listSubscriptions.mockResolvedValue({ items: [], total: 0 });

    const firstPageTemplates = Array.from({ length: 100 }, (_, index) => ({
      id: `quota-${index + 1}`,
      name: `Quota ${index + 1}`,
      rules: [],
      referencedPlanIds: ['plan-cp-self'],
      isActive: true,
    }));
    billingClient.listQuotaTemplates
      .mockResolvedValueOnce({ items: firstPageTemplates, total: 101 })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'quota-101',
            name: 'Quota 101',
            rules: [],
            referencedPlanIds: ['plan-cp-self'],
            isActive: true,
          },
        ],
        total: 101,
      });

    const workspace = await service.getCodingPlanWorkspace();

    expect(billingClient.listQuotaTemplates).toHaveBeenNthCalledWith(1, { page: 1, pageSize: 100 });
    expect(billingClient.listQuotaTemplates).toHaveBeenNthCalledWith(2, { page: 2, pageSize: 100 });
    expect(workspace.quotaTemplates).toHaveLength(101);
    expect(workspace.stats.quotaTemplateCount).toBe(101);
    expect(workspace.plans[0].quotaTemplateCount).toBe(101);
  });

  it('forwards provider resale CodingPlan plan saves to the resale command', async () => {
    billingClient.createCodingPlanResalePlan.mockResolvedValue({
      id: 'plan-provider-pro',
      productId: 'product-resale',
      fulfillmentMode: 'provider_resale',
    });

    const input = {
      productId: 'product-resale',
      name: 'Provider Pro',
      currency: 'usd',
      providerLineId: 'line-provider',
      upstreamProductId: 'upstream-pro',
      isActive: true,
    };
    const result = await service.createCodingPlanResalePlan(input);

    expect(result).toMatchObject({
      id: 'plan-provider-pro',
      productId: 'product-resale',
      fulfillmentMode: 'provider_resale',
    });
    expect(billingClient.createCodingPlanResalePlan).toHaveBeenCalledWith(input);
    expect(billingClient.createOrUpdatePlan).not.toHaveBeenCalled();
    expect(billingClient.batchUpdateModelAccess).not.toHaveBeenCalled();
  });

  it('rejects provider resale saves through the self-managed CodingPlan plan endpoint', async () => {
    await expect(service.createCodingPlanPlan({
      productId: 'product-resale',
      name: 'Provider Pro',
      fulfillmentMode: 'provider_resale',
      isActive: true,
    })).rejects.toThrow('供应商转售套餐必须通过 resale plan 命令保存');
    expect(billingClient.createOrUpdatePlan).not.toHaveBeenCalled();
  });

  it('creates a self-managed CodingPlan plan with model access and quota templates', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-cp',
          name: 'CodingPlan',
          slug: 'coding-plan',
          billingMode: 'CODING_PLAN',
          isActive: true,
        },
      ],
    });
    billingClient.createOrUpdatePlan.mockResolvedValue({
      data: { id: 'plan-self-pro', productId: 'product-cp', name: 'stsoft Pro' },
    });

    const result = await service.createCodingPlanPlan({
      productId: 'product-cp',
      name: 'stsoft Pro',
      fulfillmentMode: 'platform_model_package',
      isActive: true,
      monthlyCredits: 1000,
      platformPackage: {
        modelAccess: [
          { modelName: 'gpt-4o', isActive: true, creditMultiplier: 1 },
          { modelName: 'glm-4.5-air', isActive: false, creditMultiplier: 0.5 },
        ],
        routePolicies: [
          {
            routeKey: 'general',
            primaryModel: 'gpt-4o',
            fallbackModels: ['glm-4.5-air'],
            isActive: true,
          },
        ],
        quotaTemplateIds: ['quota-basic'],
      },
    });

    expect(result).toMatchObject({
      id: 'plan-self-pro',
      productId: 'product-cp',
      fulfillmentMode: 'platform_model_package',
    });
    expect(billingClient.createOrUpdatePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        productId: 'product-cp',
        name: 'stsoft Pro',
        planType: 'coding_plan',
        monthlyCredits: 1000,
        features: [],
        // 自营散字段弃用：任何一次保存都归 0，配额来自配额模板（展示走 quotaRules）
        rateLimitRpm: 0,
        rateLimitTpm: 0,
        maxContextWindow: 0,
      }),
    );
    expect(billingClient.batchUpdateModelAccess).toHaveBeenCalledWith([
      { planId: 'plan-self-pro', modelName: 'gpt-4o', isActive: true, creditMultiplier: 1 },
      { planId: 'plan-self-pro', modelName: 'glm-4.5-air', isActive: false, creditMultiplier: 0.5 },
    ]);
    expect(billingClient.batchUpdateModelRoutePolicies).toHaveBeenCalledWith([
      {
        planId: 'plan-self-pro',
        routeKey: 'general',
        primaryModel: 'gpt-4o',
        fallbackModels: ['glm-4.5-air'],
        isActive: true,
      },
    ]);
    expect(billingClient.replacePlanQuotaRules).toHaveBeenCalledWith(
      'plan-self-pro',
      { templateIds: ['quota-basic'] },
    );
  });

  // finding #13：保存与上架解耦——保存一律存草稿(isActive=false)，激活校验移至 publish 动作(billing 原子校验)。
  it('自营套餐保存一律存草稿(isActive=false)，即使入参 isActive=true', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-cp',
          name: 'CodingPlan',
          slug: 'coding-plan',
          billingMode: 'CODING_PLAN',
          isActive: true,
        },
      ],
    });
    billingClient.createOrUpdatePlan.mockResolvedValue({
      data: { id: 'plan-self-pro', productId: 'product-cp', name: 'stsoft Pro' },
    });

    await service.createCodingPlanPlan({
      productId: 'product-cp',
      name: 'stsoft Pro',
      fulfillmentMode: 'platform_model_package',
      isActive: true,
      platformPackage: {
        modelAccess: [{ modelName: 'gpt-4o', isActive: true, creditMultiplier: 1 }],
        routePolicies: [],
        quotaTemplateIds: ['quota-disabled'],
      },
    });

    expect(billingClient.createOrUpdatePlan).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
    );
  });

  it('已上架自营套餐编辑被拒(编辑锁)，须先下架', async () => {
    billingClient.getPlanById.mockResolvedValue({
      id: 'plan-self-pro',
      productId: 'product-cp',
      name: 'stsoft Pro',
      isActive: true,
    });
    billingClient.listProducts.mockResolvedValue({
      items: [{ id: 'product-cp', name: 'CodingPlan', slug: 'coding-plan', billingMode: 'CODING_PLAN', isActive: true }],
    });

    await expect(service.updateCodingPlanPlan('plan-self-pro', {
      productId: 'product-cp',
      name: 'stsoft Pro',
      fulfillmentMode: 'platform_model_package',
      platformPackage: { modelAccess: [], routePolicies: [], quotaTemplateIds: [] },
    })).rejects.toThrow('已上架的自营套餐不可编辑');
    expect(billingClient.createOrUpdatePlan).not.toHaveBeenCalled();
  });

  it('publish/unpublish 委托 billing setPlanActive(自营)', async () => {
    billingClient.getPlanById.mockResolvedValue({ id: 'plan-self-pro', productId: 'product-cp', name: 'stsoft Pro' });
    billingClient.listProducts.mockResolvedValue({
      items: [{ id: 'product-cp', name: 'CodingPlan', slug: 'coding-plan', billingMode: 'CODING_PLAN', isActive: true }],
    });

    await service.publishCodingPlanPlan('plan-self-pro');
    expect(billingClient.setPlanActive).toHaveBeenCalledWith('plan-self-pro', true);

    await service.unpublishCodingPlanPlan('plan-self-pro');
    expect(billingClient.setPlanActive).toHaveBeenCalledWith('plan-self-pro', false);
  });

  it('已上架自营套餐删除被拒(delete-active 守卫)，须先下架', async () => {
    billingClient.getPlanById.mockResolvedValue({
      id: 'plan-self-pro',
      productId: 'product-cp',
      name: 'stsoft Pro',
      planType: 'coding_plan',
      isActive: true,
    });
    billingClient.listProducts.mockResolvedValue({
      items: [{ id: 'product-cp', name: 'CodingPlan', slug: 'coding-plan', billingMode: 'CODING_PLAN', isActive: true }],
    });

    await expect(service.deleteCodingPlanPlan('plan-self-pro')).rejects.toThrow('已上架的自营套餐不可删除');
    expect(billingClient.deletePlan).not.toHaveBeenCalled();
  });

  it('rejects CodingPlan plan saves while critical billing snapshots are unavailable', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-cp',
          name: 'CodingPlan',
          slug: 'coding-plan',
          billingMode: 'CODING_PLAN',
          isActive: true,
        },
      ],
    });
    billingClient.listModelAccess.mockRejectedValue(new Error('billing model access down'));

    await expect(service.createCodingPlanPlan({
      productId: 'product-cp',
      name: 'stsoft Pro',
      fulfillmentMode: 'platform_model_package',
      isActive: false,
      platformPackage: {
        modelAccess: [{ modelName: 'gpt-4o', isActive: true, creditMultiplier: 1 }],
        routePolicies: [],
        quotaTemplateIds: ['quota-basic'],
      },
    })).rejects.toThrow('CodingPlan 关键数据源暂不可用（模型授权），请刷新确认后再保存套餐');

    expect(billingClient.createOrUpdatePlan).not.toHaveBeenCalled();
  });

  it('treats deleted/unreachable quota templates as invalid for activation', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-cp',
          name: 'CodingPlan',
          slug: 'coding-plan',
          billingMode: 'CODING_PLAN',
          isActive: true,
        },
      ],
    });
    billingClient.getQuotaTemplate
      .mockRejectedValueOnce(new Error('template not found'))
      .mockResolvedValueOnce({ id: 'quota-basic', isActive: true });
    billingClient.createOrUpdatePlan.mockResolvedValue({
      data: { id: 'plan-self-pro', productId: 'product-cp', name: 'stsoft Pro' },
    });

    // 第一个模板已删除（抛错按无效处理），第二个启用中 → 放行
    await expect(service.createCodingPlanPlan({
      productId: 'product-cp',
      name: 'stsoft Pro',
      fulfillmentMode: 'platform_model_package',
      isActive: true,
      platformPackage: {
        modelAccess: [{ modelName: 'gpt-4o', isActive: true, creditMultiplier: 1 }],
        routePolicies: [],
        quotaTemplateIds: ['quota-deleted', 'quota-basic'],
      },
    })).resolves.toMatchObject({ id: 'plan-self-pro' });
  });

  it('rejects CodingPlan plans bound to non-CodingPlan products', async () => {
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-payg',
          name: 'PAYG',
          slug: 'payg',
          billingMode: 'PAY_AS_YOU_GO',
          isActive: true,
        },
      ],
    });

    await expect(service.createCodingPlanPlan({
      productId: 'product-payg',
      name: 'Wrong Product',
      fulfillmentMode: 'platform_model_package',
      isActive: false,
    })).rejects.toThrow('CodingPlan 套餐只能绑定 billingMode=CODING_PLAN 的产品');
  });

  it('deletes only plans bound to CodingPlan products', async () => {
    billingClient.getPlanById.mockResolvedValue({
      id: 'plan-cp-pro',
      productId: 'product-cp',
      name: 'CodingPlan Pro',
      planType: 'coding_plan',
    });
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-cp',
          name: 'CodingPlan',
          slug: 'coding-plan',
          billingMode: 'CODING_PLAN',
          isActive: true,
        },
      ],
    });
    billingClient.deletePlan.mockResolvedValue({ deleted: true, id: 'plan-cp-pro' });

    const result = await service.deleteCodingPlanPlan('plan-cp-pro');

    expect(result).toEqual({ deleted: true, id: 'plan-cp-pro' });
    expect(billingClient.getPlanById).toHaveBeenCalledWith('plan-cp-pro');
    expect(billingClient.deletePlan).toHaveBeenCalledWith('plan-cp-pro');
  });

  it('rejects delete when plan is not bound to a CodingPlan product', async () => {
    billingClient.getPlanById.mockResolvedValue({
      id: 'plan-sub-pro',
      productId: 'product-sub',
      name: 'Subscription Pro',
    });
    billingClient.listProducts.mockResolvedValue({
      items: [
        {
          id: 'product-sub',
          name: 'Subscription',
          slug: 'subscription',
          billingMode: 'SUBSCRIPTION',
          isActive: true,
        },
      ],
    });

    await expect(service.deleteCodingPlanPlan('plan-sub-pro'))
      .rejects.toThrow('CodingPlan 套餐只能绑定 billingMode=CODING_PLAN 的产品');
    expect(billingClient.deletePlan).not.toHaveBeenCalled();
  });

  it('proxies provider entitlement list and retry operations to billing', async () => {
    billingClient.listCodingPlanProviderEntitlements.mockResolvedValue([
      { id: 'provider-ent-1', status: 'FAILED' },
    ]);
    billingClient.retryCodingPlanProviderEntitlement.mockResolvedValue({
      status: 'activated',
      providerEntitlementId: 'provider-ent-1',
    });

    await expect(service.listCodingPlanProviderEntitlements({
      providerLineCode: 'provider-overseas',
      status: 'FAILED',
      take: 20,
    })).resolves.toEqual([{ id: 'provider-ent-1', status: 'FAILED' }]);
    await expect(service.retryCodingPlanProviderEntitlement('provider-ent-1'))
      .resolves.toEqual({ status: 'activated', providerEntitlementId: 'provider-ent-1' });

    expect(billingClient.listCodingPlanProviderEntitlements).toHaveBeenCalledWith({
      providerLineCode: 'provider-overseas',
      status: 'FAILED',
      take: 20,
    });
    expect(billingClient.retryCodingPlanProviderEntitlement).toHaveBeenCalledWith('provider-ent-1');
  });
});
