import type {
  CodingPlanFulfillmentMode,
  CodingPlanResaleRoute,
  CodingPlanUpstreamProduct,
  CodingPlanWorkspacePlan,
  CodingPlanWorkspaceProduct,
} from '../../api/admin';

export interface ExistingCodingPlanSource {
  workspacePlan: CodingPlanWorkspacePlan;
  product: CodingPlanWorkspaceProduct;
  productId: string;
  fulfillmentMode: CodingPlanFulfillmentMode;
  providerLineId: string | null;
  providerLineCode: string | null;
  upstreamProductId: string | null;
  resaleRouteId: string | null;
  resaleRoutePriority: number | null;
  resaleRouteEnabled: boolean;
}

export function selectableProductsForMode(
  products: CodingPlanWorkspaceProduct[],
  mode: CodingPlanFulfillmentMode,
): CodingPlanWorkspaceProduct[] {
  return mode === 'platform_model_package'
    ? products.filter((product) => product.fulfillmentMode !== 'provider_resale')
    : products.filter((product) => product.fulfillmentMode === 'provider_resale');
}

export function pickDefaultProductIdForMode(
  products: CodingPlanWorkspaceProduct[],
  mode: CodingPlanFulfillmentMode,
): string | null {
  const modeProducts = selectableProductsForMode(products, mode);
  return modeProducts.find((product) => product.isActive)?.id ?? modeProducts[0]?.id ?? null;
}

function pickPrimaryResaleRoute(routes: CodingPlanResaleRoute[]): CodingPlanResaleRoute | null {
  return routes.find((route) => route.enabled !== false) ?? routes[0] ?? null;
}

function findUpstreamProduct(
  upstreamProducts: CodingPlanUpstreamProduct[],
  providerLineId?: string | null,
  upstreamProductId?: string | null,
): CodingPlanUpstreamProduct | null {
  if (!providerLineId || !upstreamProductId) return null;
  return upstreamProducts.find((product) => (
    Boolean(product.providerLineId)
    && product.providerLineId === providerLineId
    && product.upstreamProductId === upstreamProductId
  )) ?? null;
}

function findUpstreamProductByProductId(
  upstreamProducts: CodingPlanUpstreamProduct[],
  upstreamProductId?: string | null,
): CodingPlanUpstreamProduct | null {
  if (!upstreamProductId) return null;
  return upstreamProducts.find((product) => (
    Boolean(product.providerLineId)
    && product.upstreamProductId === upstreamProductId
  )) ?? null;
}

export function resolveExistingCodingPlanSource(params: {
  planId: string;
  workspacePlans: CodingPlanWorkspacePlan[];
  products: CodingPlanWorkspaceProduct[];
  resaleRoutes: CodingPlanResaleRoute[];
  upstreamProducts: CodingPlanUpstreamProduct[];
}): ExistingCodingPlanSource {
  const workspacePlan = params.workspacePlans.find((item) => item.id === params.planId) ?? null;
  if (!workspacePlan) {
    throw new Error(`CodingPlan workspace 缺少套餐 ${params.planId}`);
  }
  if (!workspacePlan.productId) {
    throw new Error(`CodingPlan 套餐 ${params.planId} 未绑定产品`);
  }

  const product = params.products.find((item) => item.id === workspacePlan.productId) ?? null;
  if (!product) {
    throw new Error(`CodingPlan 套餐 ${params.planId} 绑定的产品 ${workspacePlan.productId} 不在 workspace 产品快照中`);
  }
  if (workspacePlan.fulfillmentMode !== product.fulfillmentMode) {
    throw new Error(`CodingPlan 套餐 ${params.planId} 的履约模式与产品 ${product.id} 不一致`);
  }

  const fulfillmentMode = product.fulfillmentMode;
  if (fulfillmentMode !== 'provider_resale') {
    return {
      workspacePlan,
      product,
      productId: product.id,
      fulfillmentMode,
      providerLineId: null,
      providerLineCode: null,
      upstreamProductId: null,
      resaleRouteId: null,
      resaleRoutePriority: null,
      resaleRouteEnabled: true,
    };
  }

  const resaleRoute = pickPrimaryResaleRoute(params.resaleRoutes);
  const routeProviderLineId = resaleRoute?.providerLineId ?? null;
  const routeUpstreamProductId = resaleRoute?.upstreamProductId ?? null;
  const upstreamProductId = routeUpstreamProductId ?? workspacePlan.upstreamProductId ?? null;
  const matchedProduct = findUpstreamProduct(params.upstreamProducts, routeProviderLineId, upstreamProductId)
    ?? findUpstreamProductByProductId(params.upstreamProducts, upstreamProductId);

  return {
    workspacePlan,
    product,
    productId: product.id,
    fulfillmentMode,
    providerLineId: routeProviderLineId
      ?? workspacePlan.providerLineId
      ?? matchedProduct?.providerLineId
      ?? null,
    providerLineCode: resaleRoute?.providerLine?.code
      ?? workspacePlan.providerLineCode
      ?? matchedProduct?.providerLineCode
      ?? null,
    upstreamProductId,
    resaleRouteId: resaleRoute?.id ?? null,
    resaleRoutePriority: resaleRoute?.priority ?? 100,
    resaleRouteEnabled: resaleRoute?.enabled !== false,
  };
}
