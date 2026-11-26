import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import { ArrowLeftOutlined, DeleteOutlined, SaveOutlined } from '@ant-design/icons';
import { PageHeader, StableNumberInput, Tag } from '../../components/common';
import {
  codingPlanAdminApi,
  planApi,
  type CodingPlanFulfillmentMode,
  type CodingPlanPlanWriteInput,
  type CodingPlanResalePlanWriteInput,
  type CodingPlanResaleRoute,
  type CodingPlanWorkspace,
  type CodingPlanWorkspaceProduct,
} from '../../api/admin';
import { quotaTemplateApi } from '../../api/v2/quotaTemplates';
import { usePermission } from '../../hooks/usePermission';
import { warnNonCritical } from '../../utils/logging';
import {
  codingPlanDataSourceIssues,
  formatCodingPlanDataSourceIssues,
} from '../CodingPlan/data-source-guards';
import {
  normalizePlanFeatures,
} from '../PlanDetail/codingPlanFulfillment';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { PriceTab } from '../PlanDetail/tabs/Price';
import { ModelsTab } from '../PlanDetail/tabs/Models';
import { QuotaTab } from '../PlanDetail/tabs/Quota';
import { UpstreamEntitlementTab } from '../PlanDetail/tabs/UpstreamEntitlement';
import { TeamTab } from '../PlanDetail/tabs/Team';
import { AdvancedTab } from '../PlanDetail/tabs/Advanced';
import type {
  ModelAccessItem,
  ModelRoutePolicyItem,
  PlanDetailState,
} from '../PlanDetail/types';
import {
  pickDefaultProductIdForMode,
  resolveExistingCodingPlanSource,
  selectableProductsForMode,
} from './planSource';
import '../CodingPlan/CodingPlan.css';
import './CodingPlanPlanDetail.css';

function resolveMode(value: string | null | undefined): CodingPlanFulfillmentMode {
  return value === 'provider_resale' ? 'provider_resale' : 'platform_model_package';
}

function queryValue(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function listRouteForMode(mode: CodingPlanFulfillmentMode): string {
  return mode === 'provider_resale'
    ? '/coding-plan/third-party-plans'
    : '/coding-plan/self-managed-plans';
}

function listLabelForMode(mode: CodingPlanFulfillmentMode): string {
  return mode === 'provider_resale' ? '三方套餐' : '自营套餐';
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

function defaultCodingPlan(mode: CodingPlanFulfillmentMode): PlanDetailState {
  return {
    id: '',
    name: '',
    description: '',
    productId: null,
    planType: 'coding_plan',
    badge: '',
    sortOrder: 0,
    isActive: false,
    isLegacy: false,
    salesLimit: 0,
    monthlyPrice: 0,
    quarterlyPrice: 0,
    yearlyPrice: 0,
    billingPeriod: 'monthly',
    trialDays: 0,
    validityDays: 30,
    monthlyCredits: 0,
    creditsRollover: false,
    rolloverMaxMonths: 0,
    usageMultiplier: 1.0,
    overageEnabled: false,
    // 自营套餐三散字段已弃用（配额一律来自配额模板，保存归 0）；
    // 转售套餐编辑器没有配额 Tab，payload 兜底见 buildCodingPlanPayload
    rateLimitRpm: 0,
    rateLimitTpm: 0,
    maxContextWindow: 0,
    memberLimit: 1,
    minimumSeats: 1,
    maxSellableQuantity: null,
    features: [],
    fulfillmentMode: mode,
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

function selectedProductName(
  products: CodingPlanWorkspaceProduct[],
  productId: string | null,
): string {
  return products.find((product) => product.id === productId)?.name ?? '未绑定产品';
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  const candidate = error as { response?: { data?: { message?: unknown } }; message?: unknown };
  const apiMessage = candidate.response?.data?.message;
  if (typeof apiMessage === 'string' && apiMessage.trim()) return apiMessage;
  if (error instanceof Error && error.message.trim()) return error.message;
  return fallback;
}

function activeModelCount(plan: PlanDetailState): number {
  return Object.values(plan.modelAccessMap || {}).filter((item) => item.isActive).length;
}

function buildCodingPlanPayload(plan: PlanDetailState, isNew: boolean): CodingPlanPlanWriteInput {
  const modelAccess = Object.entries(plan.modelAccessMap || {}).map(([modelName, item]) => ({
    modelName,
    isActive: item.isActive,
    creditMultiplier: item.creditMultiplier,
  }));
  const routePolicies = Object.entries(plan.modelRoutePoliciesMap || {}).map(([routeKey, item]) => ({
    routeKey,
    primaryModel: item.primaryModel,
    fallbackModels: item.fallbackModels,
    isActive: item.isActive,
  }));

  return {
    ...(isNew && plan.id.trim() ? { id: plan.id.trim() } : {}),
    productId: plan.productId || '',
    name: plan.name.trim(),
    description: plan.description?.trim() || '',
    monthlyPrice: plan.monthlyPrice || 0,
    quarterlyPrice: plan.quarterlyPrice || 0,
    yearlyPrice: plan.yearlyPrice || 0,
    billingPeriod: plan.billingPeriod || 'monthly',
    monthlyCredits: plan.monthlyCredits || 0,
    creditsRollover: Boolean(plan.creditsRollover),
    rolloverMaxMonths: plan.rolloverMaxMonths || 0,
    // 自营套餐散字段已弃用，配额统一来自 quota template。
    rateLimitRpm: plan.rateLimitRpm || 0,
    rateLimitTpm: plan.rateLimitTpm || 0,
    maxContextWindow: plan.maxContextWindow || 0,
    overageEnabled: Boolean(plan.overageEnabled),
    usageMultiplier: plan.usageMultiplier || 1,
    memberLimit: plan.memberLimit || 1,
    minimumSeats: plan.minimumSeats || 1,
    // 限量售卖：原样传（空=null 不限量；非法值交由 billing 拒绝，不在前端静默清空，codex P2）。
    maxSellableQuantity: plan.maxSellableQuantity ?? null,
    dataTraining: plan.dataTraining || 'opt_out',
    supportTier: plan.supportTier || 'community',
    ssoEnabled: Boolean(plan.ssoEnabled),
    priorityAccess: Boolean(plan.priorityAccess),
    badge: plan.badge || null,
    trialDays: plan.trialDays || 0,
    validityDays: plan.validityDays || 30,
    features: normalizePlanFeatures(plan.features),
    isActive: Boolean(plan.isActive),
    isLegacy: Boolean(plan.isLegacy),
    salesLimit: plan.fulfillmentMode === 'provider_resale' ? plan.salesLimit || 0 : 0,
    sortOrder: plan.sortOrder || 0,
    fulfillmentMode: 'platform_model_package',
    platformPackage: {
      modelAccess,
      routePolicies,
      quotaTemplateIds: plan.quotaTemplateIds || [],
    },
  };
}

function buildCodingPlanResalePayload(
  plan: PlanDetailState,
  currency: string,
  isNew: boolean,
): CodingPlanResalePlanWriteInput {
  return {
    ...(isNew && plan.id.trim() ? { id: plan.id.trim() } : {}),
    routeId: plan.resaleRouteId ?? null,
    productId: plan.productId || '',
    name: plan.name.trim(),
    description: plan.description?.trim() || '',
    monthlyPrice: plan.monthlyPrice || 0,
    quarterlyPrice: plan.quarterlyPrice || 0,
    yearlyPrice: plan.yearlyPrice || 0,
    billingPeriod: plan.billingPeriod || 'monthly',
    memberLimit: plan.memberLimit || 1,
    badge: plan.badge || null,
    trialDays: plan.trialDays || 0,
    validityDays: plan.validityDays || 30,
    isActive: Boolean(plan.isActive),
    isLegacy: Boolean(plan.isLegacy),
    salesLimit: plan.salesLimit || 0,
    sortOrder: plan.sortOrder || 0,
    currency,
    providerLineId: plan.providerLineId || '',
    upstreamProductId: plan.upstreamProductId || '',
    routeEnabled: plan.resaleRouteEnabled ?? true,
    routePriority: plan.resaleRoutePriority ?? 100,
  };
}

function modeDescription(mode: CodingPlanFulfillmentMode): string {
  if (mode === 'provider_resale') {
    return '绑定供应商通道和已同步上游产品，用户购买后进入供应商激活队列；本地不配置模型和配额。';
  }
  return '使用 Raytone 平台用户端可展示模型，配置模型倍率、路由策略和配额模板；上游按 API 调用计费。';
}

interface OverviewPanelProps {
  plan: PlanDetailState;
  products: CodingPlanWorkspaceProduct[];
  isNew: boolean;
  writeBlocked: boolean;
  canManage: boolean;
  occupiedQuantity: number | null;
  onChange: (plan: PlanDetailState) => void;
}

function OverviewPanel({ plan, products, isNew, writeBlocked, canManage, occupiedQuantity, onChange }: OverviewPanelProps) {
  const [form] = Form.useForm<PlanDetailState>();
  const providerResale = plan.fulfillmentMode === 'provider_resale';
  // 自营编辑器只列自营产品（转售模式不过滤，保持现状）。
  const selectableProducts = selectableProductsForMode(products, plan.fulfillmentMode);

  useEffect(() => {
    const {
      product: _product,
      modelAccess: _modelAccess,
      modelRoutePolicies: _modelRoutePolicies,
      createdAt: _createdAt,
      updatedAt: _updatedAt,
      ...formValues
    } = plan;
    void _product;
    void _modelAccess;
    void _modelRoutePolicies;
    void _createdAt;
    void _updatedAt;
    form.setFieldsValue(formValues);
  }, [form, plan]);

  return (
    <div className="cp-plan-overview">
      <div className="cp-plan-mode-panel">
        <div>
          <div className="cp-kicker">履约方式</div>
          <Tag variant={providerResale ? 'proc' : 'success'}>
            {providerResale ? '供应商转售套餐' : '自营模型套餐'}
          </Tag>
        </div>
        <div className="cp-plan-mode-copy">
          <strong>{providerResale ? '供应商权益继承' : '自营模型与配额'}</strong>
          <p>{modeDescription(plan.fulfillmentMode)}</p>
        </div>
      </div>

      {selectableProducts.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message={providerResale ? '还没有 CodingPlan 产品' : '还没有自营 CodingPlan 产品'}
          description={providerResale
            ? '请先在产品管理创建 billingMode=CODING_PLAN 的产品，再创建套餐。'
            : '请先在产品管理创建履约模式为「自营」的 CodingPlan 产品，再创建套餐。'}
        />
      )}

      <Form
        form={form}
        layout="vertical"
        initialValues={plan}
        disabled={!canManage}
        onValuesChange={(_, values) => onChange({ ...plan, ...values })}
      >
        <section className="cp-plan-form-section">
          <div className="cp-section-head">
            <div>
              <h2>基础信息</h2>
              <p>CodingPlan 套餐必须绑定一个 CodingPlan 产品，后续 API Key 和订阅权益都以产品为边界。计费在「多币种」Tab、限额与积分在「配额」Tab 配置。</p>
            </div>
          </div>
          <div className="cp-plan-form-grid cp-plan-form-grid-4">
            {isNew && (
              <Form.Item label="套餐 ID" name="id" tooltip="留空则由 billing 自动生成 UUID">
                <Input placeholder="可选，如 coding-pro-monthly" />
              </Form.Item>
            )}
            <Form.Item label="所属产品" name="productId" rules={[{ required: true }]}>
              <Select
                placeholder="选择 CodingPlan 产品"
                options={selectableProducts.map((product) => ({
                  value: product.id,
                  label: `${product.name} (${product.slug ?? product.id})`,
                }))}
              />
            </Form.Item>
            <Form.Item label="套餐名称" name="name" rules={[{ required: true }]}>
              <Input placeholder="如 CodingPlan Pro" />
            </Form.Item>
            <Form.Item label="徽章" name="badge">
              <Input placeholder="如 Hot / Team" />
            </Form.Item>
            <Form.Item label="有效天数" name="validityDays" tooltip="订阅有效期；留空默认 30 天">
              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            {providerResale && (
              <Form.Item
                label="上架数量"
                name="salesLimit"
                tooltip="0 表示不限量；大于 0 时达到数量后用户侧显示售罄并禁止下单。"
              >
                <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
              </Form.Item>
            )}
            <Form.Item label="排序" name="sortOrder">
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            {!providerResale && (
              <Form.Item
                label="最大可售份数"
                name="maxSellableQuantity"
                tooltip="留空=不限量；达到后新客户无法购买，同套餐续订不占用。用户端仅显示「售罄」，不展示份数。"
                extra={occupiedQuantity != null ? `当前已占 ${occupiedQuantity} 份` : undefined}
              >
                <StableNumberInput min={1} precision={0} placeholder="留空 = 不限量" style={{ width: '100%' }} />
              </Form.Item>
            )}
            {/* finding #13：自营套餐「上架」从编辑器字段解耦为列表页独立按钮（billing 原子校验绑定）。
                转售套餐维持原上架开关，零改。 */}
            {providerResale && (
              <Form.Item label="上架" name="isActive" valuePropName="checked">
                <Switch disabled={!canManage || writeBlocked} />
              </Form.Item>
            )}
            <Form.Item label="旧版标记" name="isLegacy" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="套餐在用户侧展示的简短说明" />
          </Form.Item>
        </section>
      </Form>
    </div>
  );
}

export default function CodingPlanPlanDetailPage() {
  // antd v5：从 App context 取 message，静态 import 在本仓不渲染（见 app.tsx <AntdApp>），否则保存/校验错误静默。
  const { message } = App.useApp();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const platformCurrency = usePlatformCurrency();
  const canManage = usePermission('admin.page.coding_self_managed_plans.manage');
  const isNew = !id || id === 'new';
  const modeFromQuery = resolveMode(searchParams.get('mode'));
  const upstreamProductIdFromQuery = queryValue(searchParams.get('upstreamProductId'));
  const providerLineIdFromQuery = queryValue(searchParams.get('providerLineId'));

  const [workspace, setWorkspace] = useState<CodingPlanWorkspace | null>(null);
  const [plan, setPlan] = useState<PlanDetailState>(() => defaultCodingPlan(modeFromQuery));
  const [occupiedQuantity, setOccupiedQuantity] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const products = useMemo(() => workspace?.products ?? [], [workspace]);
  const upstreamProductKeys = useMemo(() => new Set(
    (workspace?.upstreamProducts ?? [])
      .filter((product) => product.providerLineId && product.upstreamProductId)
      .map((product) => `${product.providerLineId}:${product.upstreamProductId}`),
  ), [workspace]);
  const dataSourceIssues = useMemo(
    () => codingPlanDataSourceIssues(workspace, plan.fulfillmentMode),
    [plan.fulfillmentMode, workspace],
  );
  const writeBlocked = dataSourceIssues.length > 0;
  const writeDisabled = !workspace || writeBlocked;
  const writeBlockDescription = formatCodingPlanDataSourceIssues(dataSourceIssues);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const nextWorkspace = await codingPlanAdminApi.workspace();
      setWorkspace(nextWorkspace);
      const pickDefaultProductId = (mode: CodingPlanFulfillmentMode): string | null => {
        return pickDefaultProductIdForMode(nextWorkspace.products, mode);
      };
      const findUpstreamProduct = (
        providerLineId?: string | null,
        upstreamProductId?: string | null,
      ) => nextWorkspace.upstreamProducts.find((product) => (
        Boolean(product.providerLineId)
        && product.providerLineId === providerLineId
        && product.upstreamProductId === upstreamProductId
      )) ?? null;
      const findUpstreamProductByProductId = (upstreamProductId?: string | null) => (
        nextWorkspace.upstreamProducts.find((product) => (
          Boolean(product.providerLineId)
          && product.upstreamProductId === upstreamProductId
        )) ?? null
      );
      const pickDefaultUpstreamProduct = () => (
        nextWorkspace.upstreamProducts.find((product) => (
          Boolean(product.providerLineId) && Boolean(product.upstreamProductId)
        )) ?? null
      );

      if (!isNew && id) {
        const [loaded, resaleRoutes] = await Promise.all([
          planApi.getById(id) as Promise<Partial<PlanDetailState> & {
            id?: string;
            features?: string | string[];
            modelAccess?: ModelAccessItem[];
            modelRoutePolicies?: ModelRoutePolicyItem[];
          }>,
          codingPlanAdminApi.resaleRoutes({ planId: id }).catch((error: unknown): CodingPlanResaleRoute[] => {
            warnNonCritical(`CodingPlanPlanDetail resale route preload plan=${id}`, error);
            return [];
          }),
        ]);
        const source = resolveExistingCodingPlanSource({
          planId: id,
          workspacePlans: nextWorkspace.plans,
          products: nextWorkspace.products,
          resaleRoutes,
          upstreamProducts: nextWorkspace.upstreamProducts,
        });
        const features = normalizePlanFeatures(loaded.features);
        const fulfillment = {
          fulfillmentMode: source.fulfillmentMode,
          providerLineId: source.providerLineId,
          providerLineCode: source.providerLineCode,
          upstreamProductId: source.upstreamProductId,
          resaleRouteId: source.resaleRouteId,
          resaleRoutePriority: source.resaleRoutePriority,
          resaleRouteEnabled: source.resaleRouteEnabled,
        };
        const accessMap: PlanDetailState['modelAccessMap'] = {};
        for (const item of loaded.modelAccess || []) {
          accessMap[item.modelName] = {
            isActive: item.isActive,
            creditMultiplier: item.creditMultiplier ?? 1,
          };
        }
        const routePolicyMap: PlanDetailState['modelRoutePoliciesMap'] = {};
        for (const item of loaded.modelRoutePolicies || []) {
          routePolicyMap[item.routeKey] = {
            primaryModel: item.primaryModel || null,
            fallbackModels: parseRouteFallbackModels(item.fallbackModels),
            isActive: item.isActive,
          };
        }
        let quotaTemplateIds: string[] = [];
        if (fulfillment.fulfillmentMode === 'platform_model_package') {
          try {
            const rules = await quotaTemplateApi.listPlanRules(id);
            quotaTemplateIds = rules.map((rule) => rule.templateId);
          } catch (error: unknown) {
            warnNonCritical(`CodingPlanPlanDetail quota preload plan=${id}`, error);
          }
        }
        setPlan({
          ...defaultCodingPlan(fulfillment.fulfillmentMode),
          ...loaded,
          planType: 'coding_plan',
          features,
          ...fulfillment,
          productId: source.productId,
          validityDays: loaded.validityDays ?? source.workspacePlan.validityDays ?? 30,
          salesLimit: loaded.salesLimit ?? source.workspacePlan.salesLimit ?? 0,
          modelAccessMap: accessMap,
          modelRoutePoliciesMap: routePolicyMap,
          quotaTemplateIds,
        });
        setOccupiedQuantity(
          (loaded as { occupiedQuantity?: number | null }).occupiedQuantity ?? null,
        );
      } else {
        const defaultUpstreamProduct = modeFromQuery === 'provider_resale'
          ? findUpstreamProduct(providerLineIdFromQuery, upstreamProductIdFromQuery)
            ?? findUpstreamProductByProductId(upstreamProductIdFromQuery)
            ?? pickDefaultUpstreamProduct()
          : null;
        setPlan({
          ...defaultCodingPlan(modeFromQuery),
          productId: pickDefaultProductId(modeFromQuery),
          providerLineId: defaultUpstreamProduct?.providerLineId ?? providerLineIdFromQuery,
          providerLineCode: defaultUpstreamProduct?.providerLineCode ?? null,
          upstreamProductId: defaultUpstreamProduct?.upstreamProductId ?? upstreamProductIdFromQuery,
        });
      }
    } catch (error: unknown) {
      warnNonCritical('CodingPlanPlanDetail load', error);
      message.error(resolveErrorMessage(error, '加载 CodingPlan 套餐失败'));
    } finally {
      setLoading(false);
    }
  }, [
    id,
    isNew,
    message,
    modeFromQuery,
    providerLineIdFromQuery,
    upstreamProductIdFromQuery,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const validateBeforeSave = (): boolean => {
    if (writeDisabled) {
      message.error('关键数据源暂不可用，请刷新确认后再保存');
      return false;
    }
    if (!plan.productId) {
      message.error('请选择 CodingPlan 产品');
      return false;
    }
    const selectedProduct = products.find((product) => product.id === plan.productId);
    if (!selectedProduct) {
      message.error('请选择 CodingPlan 产品');
      return false;
    }
    if (selectedProduct.isActive === false) {
      message.error('所属产品已停用，请先在产品管理启用后再创建/上架套餐');
      return false;
    }
    if (selectedProduct.fulfillmentMode !== plan.fulfillmentMode) {
      message.error(plan.fulfillmentMode === 'provider_resale'
        ? '三方套餐必须绑定履约模式为供应商转售的 CodingPlan 产品'
        : '自营套餐必须绑定履约模式为自营的 CodingPlan 产品');
      return false;
    }
    if (!plan.name?.trim()) {
      message.error('套餐名称不能为空');
      return false;
    }
    if (plan.fulfillmentMode === 'provider_resale') {
      if (!plan.providerLineId) {
        message.error('请选择供应商线路');
        return false;
      }
      if (!plan.upstreamProductId?.trim()) {
        message.error('请选择上游产品');
        return false;
      }
      if (!upstreamProductKeys.has(`${plan.providerLineId}:${plan.upstreamProductId}`)) {
        message.error('上游套餐必须来自所选供应商线路的同步目录');
        return false;
      }
      return true;
    }
    // finding #13：自营套餐激活改由列表页「上架」按钮驱动（billing 侧原子校验绑定），保存只存草稿，
    // 编辑器不再做上架校验。已上架自营套餐若经直链进入编辑器 → 锁定，须先下架。
    if (plan.isActive && !isNew) {
      message.error('已上架的自营套餐不可编辑，请先在列表下架后再修改');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validateBeforeSave()) return;
    setSaving(true);
    try {
      const result = plan.fulfillmentMode === 'provider_resale'
        ? isNew
          ? await codingPlanAdminApi.createResalePlan(
            buildCodingPlanResalePayload(plan, platformCurrency, isNew),
          )
          : await codingPlanAdminApi.updateResalePlan(
            plan.id || id || '',
            buildCodingPlanResalePayload(plan, platformCurrency, isNew),
          )
        : isNew
          ? await codingPlanAdminApi.createPlan(buildCodingPlanPayload(plan, isNew))
          : await codingPlanAdminApi.updatePlan(plan.id || id || '', buildCodingPlanPayload(plan, isNew));
      message.success(isNew ? 'CodingPlan 套餐已创建' : 'CodingPlan 套餐已保存');
      if (isNew) {
        navigate(`/coding-plan/plans/${result.id}`, { replace: true });
      } else {
        setPlan((current) => ({ ...current, id: result.id }));
        await fetchData();
      }
    } catch (error: unknown) {
      message.error(resolveErrorMessage(error, '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const planId = plan.id || id;
    if (isNew || !planId) return;
    setDeleting(true);
    try {
      await codingPlanAdminApi.deletePlan(planId);
      message.success('CodingPlan 套餐已删除');
      navigate(listRouteForMode(plan.fulfillmentMode), { replace: true });
    } catch (error: unknown) {
      message.error(resolveErrorMessage(error, '删除失败'));
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const providerResale = plan.fulfillmentMode === 'provider_resale';
  const title = isNew
    ? providerResale ? '新建三方套餐' : '新建自营套餐'
    : plan.name || '编辑 CodingPlan 套餐';
  const listRoute = listRouteForMode(plan.fulfillmentMode);
  const listLabel = listLabelForMode(plan.fulfillmentMode);

  const tabs = [
    {
      key: 'overview',
      label: '概览',
      children: (
        <OverviewPanel
          plan={plan}
          products={products}
          isNew={isNew}
          writeBlocked={writeDisabled}
          canManage={canManage}
          occupiedQuantity={occupiedQuantity}
          onChange={setPlan}
        />
      ),
    },
    {
      key: 'prices',
      label: '计费与多币种',
      children: <PriceTab plan={plan} onChange={setPlan} canManage={canManage} showBillingFields />,
    },
    ...(providerResale
      ? [
          {
            key: 'upstream',
            label: '上游权益',
            children: (
              <UpstreamEntitlementTab
                plan={plan}
                onChange={setPlan}
                canManage={canManage}
                upstreamProducts={workspace?.upstreamProducts ?? []}
                loadingProducts={loading}
                onRefresh={fetchData}
              />
            ),
          },
        ]
      : [
          {
            key: 'models',
            label: '模型',
            children: <ModelsTab plan={plan} onChange={setPlan} showRoutePolicies={false} canManage={canManage} />,
          },
          {
            key: 'quota',
            label: '配额',
            children: <QuotaTab plan={plan} onChange={setPlan} showCreditsAllowance hideRateLimitFields canManage={canManage} />,
          },
        ]),
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
  ];

  return (
    <div className="cp-page cp-plan-detail-page">
      <PageHeader
        title={title}
        subtitle="CodingPlan 专用套餐编辑器会按履约方式收口字段：自营套餐配置本地模型和配额，供应商转售只绑定上游权益。"
        breadcrumb={[
          { label: 'CodingPlan', to: listRoute },
          { label: listLabel, to: listRoute },
          isNew ? '新建套餐' : plan.name || '编辑套餐',
        ]}
        actions={[
          <Button key="back" icon={<ArrowLeftOutlined />} onClick={() => navigate(listRoute)}>
            返回
          </Button>,
          !isNew && (
            <Popconfirm
              key="delete"
              title={(
                <div>
                  <div>确认删除此套餐？</div>
                  <div style={{ marginTop: 4, maxWidth: 280, color: 'var(--text-muted)', fontWeight: 400 }}>
                    仅无订单、订阅、组合套餐等引用的错误套餐可删除。
                  </div>
                </div>
              )}
              onConfirm={handleDelete}
            >
              <Button
                danger
                icon={<DeleteOutlined />}
                loading={deleting}
                disabled={!canManage || saving}
              >
                删除套餐
              </Button>
            </Popconfirm>
          ),
          <Button
            key="save"
            type="primary"
            icon={<SaveOutlined />}
            loading={saving}
            disabled={!canManage || products.length === 0 || deleting || writeDisabled}
            onClick={handleSave}
          >
            {isNew ? '创建套餐' : '保存更改'}
          </Button>,
        ]}
      />

      <div className="cp-plan-summary">
        <div>
          <span>产品</span>
          <strong>{selectedProductName(products, plan.productId)}</strong>
        </div>
        <div>
          <span>履约</span>
          <strong>{providerResale ? '供应商转售' : '自营模型套餐'}</strong>
        </div>
        <div>
          <span>状态</span>
          <strong>{plan.isActive ? '可售' : '草稿/停用'}</strong>
        </div>
        <div>
          <span>权益检查</span>
          <strong>
            {providerResale
              ? `${plan.providerLineCode ?? plan.providerLineId ?? '未绑定线路'} / ${plan.upstreamProductId || '未绑定上游产品'}`
              : `${activeModelCount(plan)} 模型 / ${plan.quotaTemplateIds.length} 模板`}
          </strong>
        </div>
      </div>

      {writeBlocked && (
        <Alert
          className="cp-alert"
          type="warning"
          showIcon
          message="关键数据源暂不可用，已暂停保存和上架"
          description={writeBlockDescription}
        />
      )}

      <Alert
        className="cp-alert"
        type={providerResale ? 'info' : 'success'}
        showIcon
        message={providerResale ? '供应商转售套餐继承上游权益' : '自营模型套餐由 Raytone 本地定义权益'}
        description={modeDescription(plan.fulfillmentMode)}
      />

      <section className="cp-section cp-plan-tabs">
        <div className="cp-plan-tab-head">
          <Space size={8} wrap>
            <Tag variant={providerResale ? 'proc' : 'success'}>
              {providerResale ? '供应商转售' : '自营模型'}
            </Tag>
            <Tag variant={plan.isActive ? 'success' : 'muted'}>
              {plan.isActive ? '可售' : '草稿'}
            </Tag>
          </Space>
          <Typography.Text type="secondary">
            {providerResale ? '不配置本地模型/配额' : '模型、倍率和配额模板一起保存'}
          </Typography.Text>
        </div>
        <Tabs items={tabs} defaultActiveKey="overview" />
      </section>

      <div className="cp-plan-savebar">
        <Button onClick={() => navigate(listRoute)}>取消</Button>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          disabled={!canManage || products.length === 0 || deleting || writeDisabled}
          onClick={handleSave}
        >
          {isNew ? '创建套餐' : '保存更改'}
        </Button>
      </div>
    </div>
  );
}
