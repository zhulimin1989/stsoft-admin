import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Tabs, Spin, Button, message } from 'antd';
import { PageHeader } from '../../components/common';
import { planApi, productApi, modelAccessApi, modelRoutePolicyApi } from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';
import { OverviewTab } from './tabs/Overview';
import { PriceTab } from './tabs/Price';
import { ModelsTab } from './tabs/Models';
import { TeamTab } from './tabs/Team';
import { AdvancedTab } from './tabs/Advanced';
import type { ProductInfo, ModelAccessItem, ModelRoutePolicyItem, PlanDetailState } from './types';
import { warnNonCritical } from '../../utils/logging';
import { normalizePlanFeatures } from './codingPlanFulfillment';

async function listProductsForPlanDetail(): Promise<ProductInfo[]> {
  try {
    const res = await productApi.list() as ProductInfo[] | { items?: ProductInfo[] };
    const products = Array.isArray(res) ? res : res.items || [];
    return products.filter((product) => (
      (product.billingMode ?? 'SUBSCRIPTION') === 'SUBSCRIPTION'
    ));
  } catch (error: unknown) {
    warnNonCritical('PlanDetail product preload', error);
    return [];
  }
}

function parseRouteFallbackModels(value: ModelRoutePolicyItem['fallbackModels']): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function buildPlanWritePayload(plan: PlanDetailState, options?: { includeId?: boolean }) {
  const {
    modelAccessMap: _modelAccessMap,
    modelRoutePoliciesMap: _modelRoutePoliciesMap,
    modelAccess: _modelAccess,
    modelRoutePolicies: _modelRoutePolicies,
    product: _product,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    fulfillmentMode: _fulfillmentMode,
    providerLineId: _providerLineId,
    providerLineCode: _providerLineCode,
    upstreamProductId: _upstreamProductId,
    resaleRouteId: _resaleRouteId,
    resaleRoutePriority: _resaleRoutePriority,
    resaleRouteEnabled: _resaleRouteEnabled,
    quotaTemplateIds: _quotaTemplateIds,
    ...rest
  } = plan;
  void _modelAccessMap;
  void _modelRoutePoliciesMap;
  void _modelAccess;
  void _modelRoutePolicies;
  void _product;
  void _createdAt;
  void _updatedAt;
  void _fulfillmentMode;
  void _providerLineId;
  void _providerLineCode;
  void _upstreamProductId;
  void _resaleRouteId;
  void _resaleRoutePriority;
  void _resaleRouteEnabled;
  void _quotaTemplateIds;

  const payload = {
    ...rest,
    features: normalizePlanFeatures(rest.features),
    badge: rest.badge || null,
  };
  if (options?.includeId === false) {
    const { id: _id, ...payloadWithoutId } = payload;
    void _id;
    return payloadWithoutId;
  }
  return payload;
}

// 主页面: 装载 plan -> Tab 编辑 -> 保存
// 现有 planApi.create() 同时承担 create 和 update (服务端按 id 判断)
export default function PlanDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canManage = usePermission('admin.page.subscription_plans.manage');
  const isNew = id === 'new';

  const [plan, setPlan] = useState<PlanDetailState>(() => defaultPlan());
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const subscriptionProducts = await listProductsForPlanDetail();
      setProducts(subscriptionProducts);

      if (!isNew && id) {
        const p = await planApi.getById(id) as Partial<PlanDetailState> & {
          id?: string;
          features?: string | string[];
          modelAccess?: ModelAccessItem[];
          modelRoutePolicies?: ModelRoutePolicyItem[];
        };
        const selectedProduct = subscriptionProducts.find((product) => product.id === p.productId);
        if (p.planType === 'coding_plan') {
          navigate(`/coding-plan/plans/${id}`, { replace: true });
          return;
        }
        if (p.productId && !selectedProduct) {
          message.warning('该套餐不属于订阅计费产品，已返回订阅套餐列表');
          navigate('/plans', { replace: true });
          return;
        }
        // features 可能是 string | string[]
        let feats: string[] = [];
        feats = normalizePlanFeatures(p.features);
        if (typeof p.features === 'string' && p.features.trim() && feats.length === 0) {
          warnNonCritical(`PlanDetail invalid features plan=${p.id ?? id}`, new Error('Invalid features JSON'));
        }

        // modelAccess 数组转 map (供 Models tab 编辑)
        const accessMap: PlanDetailState['modelAccessMap'] = {};
        if (p.modelAccess) {
          for (const a of p.modelAccess) {
            accessMap[a.modelName] = {
              isActive: a.isActive,
              creditMultiplier: a.creditMultiplier ?? 1.0,
            };
          }
        }
        const routePolicyMap: PlanDetailState['modelRoutePoliciesMap'] = {};
        if (p.modelRoutePolicies) {
          for (const policy of p.modelRoutePolicies) {
            routePolicyMap[policy.routeKey] = {
              primaryModel: policy.primaryModel || null,
              fallbackModels: parseRouteFallbackModels(policy.fallbackModels),
              isActive: policy.isActive,
            };
          }
        }

        setPlan({
          ...defaultPlan(),
          ...p,
          features: feats,
          modelAccessMap: accessMap,
          modelRoutePoliciesMap: routePolicyMap,
        });
      } else {
        setPlan({
          ...defaultPlan(),
          productId: subscriptionProducts[0]?.id ?? null,
        });
      }
    } catch {
      message.error('加载数据失败');
    } finally {
      setLoading(false);
    }
  }, [id, isNew, navigate]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  if (!plan) return null;

  const handleSave = async () => {
    if (!plan.name?.trim()) {
      message.error('套餐名称不能为空');
      return;
    }
    if (!plan.productId) {
      message.error('请选择订阅计费产品');
      return;
    }
    setSaving(true);
    try {
      const { modelAccessMap, modelRoutePoliciesMap } = plan;
      const payload = buildPlanWritePayload(plan, { includeId: !isNew || Boolean(plan.id) });
      const result = await planApi.create(payload);
      const savedPlanId = result?.id || result?.data?.id || plan.id;
      if (!savedPlanId) throw new Error('保存结果缺少套餐 ID');

      const accessItems = Object.entries(modelAccessMap || {}).map(
        ([modelName, v]) => ({
          planId: savedPlanId,
          modelName,
          isActive: v.isActive,
          creditMultiplier: v.creditMultiplier,
        }),
      );
      if (accessItems.length > 0) {
        await modelAccessApi.batchUpdate(accessItems);
      }
      const routePolicyItems = Object.entries(modelRoutePoliciesMap || {}).map(
        ([routeKey, v]) => ({
          planId: savedPlanId,
          routeKey,
          primaryModel: v.primaryModel || null,
          fallbackModels: v.fallbackModels,
          isActive: v.isActive,
        }),
      );
      if (routePolicyItems.length > 0) {
        await modelRoutePolicyApi.batchUpdate(routePolicyItems);
      }

      message.success(isNew ? '创建成功' : '保存成功');
      if (isNew) {
        navigate('/plans');
      }
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleClone = async () => {
    setSaving(true);
    try {
      const {
        id: _id,
      } = plan;
      void _id;
      const result = await planApi.create({
        ...buildPlanWritePayload(plan, { includeId: false }),
        name: `${plan.name || '未命名套餐'} 副本`,
        isActive: false,
        isLegacy: false,
      });
      const clonedPlanId = result?.id || result?.data?.id;
      if (!clonedPlanId) throw new Error('复制结果缺少套餐 ID');

      const accessItems = Object.entries(plan.modelAccessMap || {}).map(
        ([modelName, v]) => ({
          planId: clonedPlanId,
          modelName,
          isActive: v.isActive,
          creditMultiplier: v.creditMultiplier,
        }),
      );
      if (accessItems.length > 0) {
        await modelAccessApi.batchUpdate(accessItems);
      }
      const routePolicyItems = Object.entries(plan.modelRoutePoliciesMap || {}).map(
        ([routeKey, v]) => ({
          planId: clonedPlanId,
          routeKey,
          primaryModel: v.primaryModel || null,
          fallbackModels: v.fallbackModels,
          isActive: v.isActive,
        }),
      );
      if (routePolicyItems.length > 0) {
        await modelRoutePolicyApi.batchUpdate(routePolicyItems);
      }

      message.success('已复制为未上架草稿');
      navigate(`/plans/${clonedPlanId}`);
    } catch (err) {
      message.error(err instanceof Error ? err.message : '复制失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async () => {
    try {
      const next = !plan.isActive;
      await planApi.create(buildPlanWritePayload({ ...plan, isActive: next }));
      setPlan({ ...plan, isActive: next });
      message.success(next ? '套餐已上架' : '套餐已下架');
    } catch {
      message.error('操作失败');
    }
  };

  return (
    <div>
      <PageHeader
        title={isNew ? '新建套餐' : plan.name || '编辑套餐'}
        breadcrumb={[
          { label: '套餐管理', to: '/plans' },
          isNew ? '新建套餐' : plan.name || '编辑套餐',
        ]}
        actions={
          isNew
            ? []
            : [
                <Button key="clone" onClick={handleClone} disabled={!canManage || saving}>
                  复制为草稿
                </Button>,
                <Button key="toggle" onClick={handleToggleActive} disabled={!canManage}>
                  {plan.isActive ? '下架' : '上架'}
                </Button>,
              ]
        }
      />
      <Tabs
        defaultActiveKey="overview"
        items={[
          {
            key: 'overview',
            label: '概览',
            children: (
              <OverviewTab plan={plan} onChange={setPlan} products={products} isNew={isNew} canManage={canManage} />
            ),
          },
          {
            key: 'price',
            label: '价格',
            children: <PriceTab plan={plan} onChange={setPlan} canManage={canManage} />,
          },
          {
            key: 'models',
            label: '模型',
            children: <ModelsTab plan={plan} onChange={setPlan} canManage={canManage} />,
          },
          {
            key: 'team',
            label: '团队',
            children: <TeamTab plan={plan} onChange={setPlan} canManage={canManage} />,
          },
          {
            key: 'advanced',
            label: '高级',
            children: <AdvancedTab plan={plan} onChange={setPlan} canManage={canManage} />,
          },
        ]}
      />
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--bg-body)',
          padding: '12px 0',
          borderTop: '1px solid var(--border-soft)',
          display: 'flex',
          gap: 8,
          justifyContent: 'flex-end',
          marginTop: 16,
        }}
      >
        <Button onClick={() => navigate('/plans')}>取消</Button>
        <Button type="primary" loading={saving} onClick={handleSave} disabled={!canManage}>
          {isNew ? '创建套餐' : '保存更改'}
        </Button>
      </div>
    </div>
  );
}

function defaultPlan(): PlanDetailState {
  return {
    id: '',
    name: '',
    description: '',
    productId: null,
    planType: 'individual',
    badge: '',
    sortOrder: 0,
    isActive: true,
    isLegacy: false,
    monthlyPrice: 0,
    quarterlyPrice: 0,
    yearlyPrice: 0,
    billingPeriod: 'monthly',
    trialDays: 0,
    salesLimit: 0,
    monthlyCredits: 0,
    creditsRollover: false,
    rolloverMaxMonths: 0,
    usageMultiplier: 1.0,
    overageEnabled: false,
    rateLimitRpm: 60,
    rateLimitTpm: 100000,
    maxContextWindow: 200000,
    memberLimit: 1,
    minimumSeats: 1,
    maxSellableQuantity: null,
    features: [] as string[],
    fulfillmentMode: 'platform_model_package',
    providerLineId: null,
    providerLineCode: null,
    upstreamProductId: null,
    resaleRouteId: null,
    resaleRoutePriority: null,
    resaleRouteEnabled: true,
    quotaTemplateIds: [],
    dataTraining: 'opt_out',
    supportTier: 'community',
    ssoEnabled: false,
    priorityAccess: false,
    modelAccessMap: {},
    modelRoutePoliciesMap: {},
  };
}
