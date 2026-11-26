import { describe, expect, it } from 'vitest';
import type {
  CodingPlanResaleRoute,
  CodingPlanUpstreamProduct,
  CodingPlanWorkspacePlan,
  CodingPlanWorkspaceProduct,
} from '../../../api/admin';
import {
  pickDefaultProductIdForMode,
  resolveExistingCodingPlanSource,
  selectableProductsForMode,
} from '../planSource';

function product(overrides: Partial<CodingPlanWorkspaceProduct>): CodingPlanWorkspaceProduct {
  return {
    id: 'product-self',
    name: 'Self product',
    slug: 'self-product',
    description: null,
    billingMode: 'CODING_PLAN',
    fulfillmentMode: 'platform_model_package',
    isActive: true,
    defaultPlanId: null,
    defaultPlanName: null,
    hasIntegrationToken: false,
    integrationTokenPrefix: null,
    hasWebhookSecret: false,
    webhookSecretPrefix: null,
    apiKeyDefaultBinding: true,
    virtualKey: null,
    checklist: {},
    activeSubscriptions: 0,
    readiness: 'ready',
    ...overrides,
  };
}

function plan(overrides: Partial<CodingPlanWorkspacePlan>): CodingPlanWorkspacePlan {
  return {
    id: 'plan-1',
    productId: 'product-self',
    productName: 'Self product',
    name: 'Plan 1',
    description: null,
    planType: 'coding_plan',
    billingPeriod: 'monthly',
    monthlyPrice: 0,
    quarterlyPrice: 0,
    yearlyPrice: 0,
    monthlyCredits: 0,
    validityDays: 30,
    rateLimitRpm: null,
    rateLimitTpm: null,
    maxContextWindow: null,
    memberLimit: null,
    maxSellableQuantity: null,
    usageMultiplier: null,
    badge: null,
    trialDays: 0,
    isActive: true,
    isLegacy: false,
    sortOrder: 0,
    fulfillmentMode: 'platform_model_package',
    providerLineId: null,
    providerLineCode: null,
    upstreamProductId: null,
    enabledModelCount: 0,
    enabledModels: [],
    quotaTemplateCount: 0,
    quotaTemplates: [],
    ...overrides,
  };
}

function route(overrides: Partial<CodingPlanResaleRoute> = {}): CodingPlanResaleRoute {
  return {
    id: 'route-1',
    planId: 'plan-1',
    providerLineId: 'line-1',
    upstreamProductId: 'upstream-1',
    fulfillmentMethod: 'order_activation',
    enabled: true,
    priority: 100,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    providerLine: {
      id: 'line-1',
      code: 'line-code-1',
      name: 'Provider line',
      providerCode: 'provider',
    },
    ...overrides,
  };
}

function upstreamProduct(overrides: Partial<CodingPlanUpstreamProduct> = {}): CodingPlanUpstreamProduct {
  return {
    providerLineId: 'line-1',
    providerLineCode: 'line-code-1',
    upstreamProductId: 'upstream-1',
    productId: 'provider-product-1',
    productName: 'Provider plan',
    productCycle: null,
    productType: null,
    salePrice: null,
    productBigTitle: null,
    productSmallTitle: null,
    description: null,
    productIntroduction: null,
    salesVolume: null,
    dailySalesLimit: null,
    monthlySalesLimit: null,
    yearlySalesLimit: null,
    maxSalesLimit: null,
    source: 'synced',
    fetchedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CodingPlan plan source resolution', () => {
  it('filters default products by product fulfillment mode', () => {
    const products = [
      product({ id: 'inactive-self', isActive: false }),
      product({ id: 'active-self', isActive: true }),
      product({ id: 'resale', fulfillmentMode: 'provider_resale', isActive: true }),
    ];

    expect(selectableProductsForMode(products, 'platform_model_package').map((item) => item.id))
      .toEqual(['inactive-self', 'active-self']);
    expect(selectableProductsForMode(products, 'provider_resale').map((item) => item.id))
      .toEqual(['resale']);
    expect(pickDefaultProductIdForMode(products, 'platform_model_package')).toBe('active-self');
    expect(pickDefaultProductIdForMode(products, 'provider_resale')).toBe('resale');
  });

  it('uses the bound product as the only mode source for existing platform plans', () => {
    const source = resolveExistingCodingPlanSource({
      planId: 'plan-1',
      workspacePlans: [plan({ productId: 'product-self', fulfillmentMode: 'platform_model_package' })],
      products: [product({ id: 'product-self', fulfillmentMode: 'platform_model_package' })],
      resaleRoutes: [route()],
      upstreamProducts: [upstreamProduct()],
    });

    expect(source.fulfillmentMode).toBe('platform_model_package');
    expect(source.productId).toBe('product-self');
    expect(source.providerLineId).toBeNull();
    expect(source.upstreamProductId).toBeNull();
    expect(source.resaleRouteId).toBeNull();
  });

  it('resolves resale route details only after the bound product declares provider resale', () => {
    const source = resolveExistingCodingPlanSource({
      planId: 'plan-1',
      workspacePlans: [
        plan({
          productId: 'product-resale',
          fulfillmentMode: 'provider_resale',
          providerLineId: 'line-from-workspace',
          providerLineCode: 'line-workspace',
          upstreamProductId: 'upstream-from-workspace',
        }),
      ],
      products: [product({ id: 'product-resale', fulfillmentMode: 'provider_resale' })],
      resaleRoutes: [route({ id: 'route-active', providerLineId: 'line-1', upstreamProductId: 'upstream-1' })],
      upstreamProducts: [upstreamProduct()],
    });

    expect(source.fulfillmentMode).toBe('provider_resale');
    expect(source.productId).toBe('product-resale');
    expect(source.resaleRouteId).toBe('route-active');
    expect(source.providerLineId).toBe('line-1');
    expect(source.providerLineCode).toBe('line-code-1');
    expect(source.upstreamProductId).toBe('upstream-1');
  });

  it('fails when the existing plan is missing from the workspace snapshot', () => {
    expect(() => resolveExistingCodingPlanSource({
      planId: 'missing-plan',
      workspacePlans: [],
      products: [product({ id: 'product-self' })],
      resaleRoutes: [],
      upstreamProducts: [],
    })).toThrow('CodingPlan workspace 缺少套餐 missing-plan');
  });

  it('fails when the existing plan product is missing from the workspace snapshot', () => {
    expect(() => resolveExistingCodingPlanSource({
      planId: 'plan-1',
      workspacePlans: [plan({ productId: 'product-missing' })],
      products: [product({ id: 'product-self' })],
      resaleRoutes: [],
      upstreamProducts: [],
    })).toThrow('绑定的产品 product-missing 不在 workspace 产品快照中');
  });

  it('fails when the workspace plan snapshot disagrees with the product mode', () => {
    expect(() => resolveExistingCodingPlanSource({
      planId: 'plan-1',
      workspacePlans: [plan({ productId: 'product-resale', fulfillmentMode: 'platform_model_package' })],
      products: [product({ id: 'product-resale', fulfillmentMode: 'provider_resale' })],
      resaleRoutes: [],
      upstreamProducts: [],
    })).toThrow('履约模式与产品 product-resale 不一致');
  });
});
