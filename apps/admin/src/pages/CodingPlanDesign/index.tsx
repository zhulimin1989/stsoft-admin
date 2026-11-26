import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Alert, App, Button, Popconfirm, Select, Space, Tooltip } from 'antd';
import {
  ApiOutlined,
  DatabaseOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  DataTable,
  EmptyPlaceholder,
  PageHeader,
  StatCard,
  StatCardGroup,
  Tag,
  type TagVariant,
} from '../../components/common';
import {
  codingPlanAdminApi,
  type CodingPlanResaleRoute,
  type CodingPlanWorkspace,
  type CodingPlanWorkspacePlan,
  type CodingPlanWorkspaceProduct,
} from '../../api/admin';
import { usePermission } from '../../hooks/usePermission';
import {
  codingPlanDataSourceIssues,
  formatCodingPlanDataSourceIssues,
} from '../CodingPlan/data-source-guards';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatCurrencyCents } from '../../utils/price';
import '../CodingPlan/CodingPlan.css';
import './CodingPlanDesign.css';

type DesignFilter =
  | 'all'
  | 'sellable'
  | 'missing_models'
  | 'missing_quota'
  | 'missing_channel'
  | 'missing_upstream';

type CodingPlanDesignMode = 'self_managed' | 'third_party';

const QUOTA_TEMPLATE_ROUTE = '/coding-plan/quota-templates';
const SELF_MANAGED_ROUTE = '/coding-plan/self-managed-plans';
const THIRD_PARTY_ROUTE = '/coding-plan/third-party-plans';

function resolveDesignMode(pathname: string): CodingPlanDesignMode {
  return pathname.startsWith(THIRD_PARTY_ROUTE) ? 'third_party' : 'self_managed';
}

function formatCents(cents: number | null | undefined, currency: string): string {
  return formatCurrencyCents(cents, currency, { zeroAsEmpty: true });
}

function planPeriodPrice(plan: CodingPlanWorkspacePlan, period: 'monthly' | 'quarterly' | 'yearly'): number {
  if (period === 'quarterly') return plan.quarterlyPrice || 0;
  if (period === 'yearly') return plan.yearlyPrice || 0;
  return plan.monthlyPrice || 0;
}

/** 上架售价口径：按 plan 配置的 billingPeriod 对应周期价（缺省/非法回退 monthly），与 billing setPlanActive 同口径。 */
function planBillingPeriod(plan: CodingPlanWorkspacePlan): 'monthly' | 'quarterly' | 'yearly' {
  return typeof plan.billingPeriod === 'string'
    && ['monthly', 'quarterly', 'yearly'].includes(plan.billingPeriod)
    ? plan.billingPeriod as 'monthly' | 'quarterly' | 'yearly'
    : 'monthly';
}

function resolvePlanPriceLabel(plan: CodingPlanWorkspacePlan, currency: string): { primary: string; secondary: string } {
  const preferred = typeof plan.billingPeriod === 'string'
    && ['monthly', 'quarterly', 'yearly'].includes(plan.billingPeriod)
    ? plan.billingPeriod as 'monthly' | 'quarterly' | 'yearly'
    : 'monthly';
  const periods = [
    preferred,
    ...(['monthly', 'quarterly', 'yearly'] as const).filter((period) => period !== preferred),
  ];
  const period = periods.find((item) => planPeriodPrice(plan, item) > 0) ?? preferred;
  const monthlyEquivalent = planPeriodPrice(plan, period);
  if (monthlyEquivalent <= 0) {
    return { primary: '未定价', secondary: '未配置可售价格' };
  }
  if (period === 'quarterly') {
    return {
      primary: `季付月均 ${formatCents(monthlyEquivalent, currency)}`,
      secondary: `每季 ${formatCents(monthlyEquivalent * 3, currency)}`,
    };
  }
  if (period === 'yearly') {
    return {
      primary: `年付月均 ${formatCents(monthlyEquivalent, currency)}`,
      secondary: `每年 ${formatCents(monthlyEquivalent * 12, currency)}`,
    };
  }
  return { primary: `月付 ${formatCents(monthlyEquivalent, currency)}`, secondary: '每月支付' };
}

function resolveErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  return typeof data?.message === 'string' && data.message ? data.message : fallback;
}

function planStatus(plan: CodingPlanWorkspacePlan): { label: string; variant: TagVariant } {
  if (!plan.isActive) return { label: '已停用', variant: 'muted' };
  if (plan.isLegacy) return { label: '旧版', variant: 'warn' };
  return { label: '可售', variant: 'success' };
}

/** 有效配额来源 = 启用中的绑定模板；停用模板的规则不下发也不展示（与上架校验同口径）。 */
function activeQuotaTemplateCount(plan: CodingPlanWorkspacePlan): number {
  return plan.quotaTemplates.filter((template) => template.isActive).length;
}

function designStatus(plan: CodingPlanWorkspacePlan): { label: string; variant: TagVariant; hint: string } {
  if (plan.fulfillmentMode === 'provider_resale') {
    if (!plan.providerLineId) {
      return { label: '缺线路', variant: 'warn', hint: '该套餐标记为供应商转售，但没有绑定供应商线路。' };
    }
    if (!plan.upstreamProductId) {
      return { label: '缺上游产品', variant: 'warn', hint: '供应商转售套餐必须绑定上游产品/权益 ID，才能在用户付款后创建供应商订单。' };
    }
    return { label: '上游已绑定', variant: 'proc', hint: '该套餐继承供应商产品权益，订阅后进入对应供应商激活队列。' };
  }
  if (plan.enabledModelCount <= 0) {
    return { label: '缺模型', variant: 'warn', hint: '套餐还没有启用任何模型，用户订阅后无法形成可用范围。' };
  }
  if (activeQuotaTemplateCount(plan) <= 0) {
    return {
      label: '待配额',
      variant: 'warn',
      hint: plan.quotaTemplateCount > 0
        ? '绑定的配额模板已全部停用（规则不下发也不展示），去配额 Tab 重新绑定启用中的模板。'
        : '套餐还没有绑定配额模板，去 CodingPlan 编辑器的配额 Tab 选择模板。',
    };
  }
  return { label: '已设计', variant: 'success', hint: '套餐已配置模型范围和配额模板引用。' };
}

function fulfillmentLabel(plan: CodingPlanWorkspacePlan): { label: string; variant: TagVariant; detail: string } {
  if (plan.fulfillmentMode === 'provider_resale') {
    const providerLine = plan.providerLineCode ?? plan.providerLineId;
    return {
      label: '供应商转售',
      variant: 'proc',
      detail: `${providerLine || '未绑定线路'} · ${plan.upstreamProductId || '未绑定上游产品'}`,
    };
  }
  return {
    label: '自营模型调用',
    variant: 'success',
    detail: '按平台 ModelAccess + 用量计费履约',
  };
}

export default function CodingPlanDesignPage() {
  // antd v5：必须从 App context 取 message，静态 import { message } from 'antd' 在本仓不渲染
  // （见 app.tsx 的 <AntdApp> 说明）——否则删除失败等 toast 会静默不显示。
  const { message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const navigate = useNavigate();
  const location = useLocation();
  const canManage = usePermission('admin.page.coding_self_managed_plans.manage');
  const pageMode = resolveDesignMode(location.pathname);
  const isSelfManagedPage = pageMode === 'self_managed';
  const [workspace, setWorkspace] = useState<CodingPlanWorkspace | null>(null);
  const [resaleRoutes, setResaleRoutes] = useState<CodingPlanResaleRoute[]>([]);
  const [loading, setLoading] = useState(false);
  const [productFilter, setProductFilter] = useState('all');
  const [designFilter, setDesignFilter] = useState<DesignFilter>('all');

  const fetchWorkspace = useCallback(async () => {
    setLoading(true);
    try {
      const [nextWorkspace, nextRoutes] = await Promise.all([
        codingPlanAdminApi.workspace(),
        codingPlanAdminApi.resaleRoutes(),
      ]);
      setWorkspace(nextWorkspace);
      setResaleRoutes(nextRoutes);
    } catch {
      message.error('加载 CodingPlan 设计工作台失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    fetchWorkspace();
  }, [fetchWorkspace]);

  useEffect(() => {
    setDesignFilter('all');
  }, [pageMode]);

  const handleDeletePlan = async (plan: CodingPlanWorkspacePlan) => {
    try {
      await codingPlanAdminApi.deletePlan(plan.id);
      message.success('CodingPlan 套餐已删除');
      await fetchWorkspace();
    } catch (error) {
      message.error(resolveErrorMessage(error, '删除失败'));
    }
  };

  // finding #13：上架/下架独立动作。上架条件(≥1 启用模型 & ≥1 启用配额模板)由前端置灰做早失败，
  // billing 侧 setPlanActive 原子校验为最终保证；下架仅停售不停用（存量继续可用）。
  const handleTogglePlanActive = async (plan: CodingPlanWorkspacePlan) => {
    try {
      if (plan.isActive) {
        await codingPlanAdminApi.unpublishPlan(plan.id);
        message.success('套餐已下架（停止新销售，存量订阅不受影响）');
      } else {
        await codingPlanAdminApi.publishPlan(plan.id);
        message.success('套餐已上架');
      }
      await fetchWorkspace();
    } catch (error) {
      message.error(resolveErrorMessage(error, plan.isActive ? '下架失败' : '上架失败'));
    }
  };

  const workspaceProducts = workspace?.products;
  const workspacePlans = workspace?.plans;
  const products = useMemo(() => workspaceProducts ?? [], [workspaceProducts]);
  const plans = useMemo(() => workspacePlans ?? [], [workspacePlans]);
  const resalePlanIds = useMemo(
    () => new Set(resaleRoutes.map((route) => route.planId)),
    [resaleRoutes],
  );

  const productOptions = useMemo(
    () => [
      { value: 'all', label: '全部 CodingPlan 产品' },
      ...products.map((product) => ({ value: product.id, label: product.name })),
    ],
    [products],
  );

  const pagePlans = useMemo(
    () => plans.filter((plan) => (
      isSelfManagedPage
        ? plan.fulfillmentMode === 'platform_model_package' && !resalePlanIds.has(plan.id)
        : plan.fulfillmentMode === 'provider_resale' || resalePlanIds.has(plan.id)
    )),
    [isSelfManagedPage, plans, resalePlanIds],
  );

  const filteredPlans = useMemo(() => {
    return pagePlans.filter((plan) => {
      if (productFilter !== 'all' && plan.productId !== productFilter) return false;
      if (designFilter === 'sellable' && (!plan.isActive || plan.isLegacy)) return false;
      if (
        designFilter === 'missing_models'
        && (plan.fulfillmentMode !== 'platform_model_package' || plan.enabledModelCount > 0)
      ) return false;
      if (
        designFilter === 'missing_quota'
        && (plan.fulfillmentMode !== 'platform_model_package' || activeQuotaTemplateCount(plan) > 0)
      ) return false;
      if (
        designFilter === 'missing_channel'
        && (plan.fulfillmentMode !== 'provider_resale' || Boolean(plan.providerLineId))
      ) return false;
      if (
        designFilter === 'missing_upstream'
        && (plan.fulfillmentMode !== 'provider_resale' || Boolean(plan.upstreamProductId))
      ) return false;
      return true;
    });
  }, [designFilter, pagePlans, productFilter]);


  const sellablePagePlanCount = useMemo(
    () => pagePlans.filter((plan) => plan.isActive && !plan.isLegacy).length,
    [pagePlans],
  );
  const dataSourceIssues = useMemo(
    () => codingPlanDataSourceIssues(
      workspace,
      isSelfManagedPage ? 'platform_model_package' : 'provider_resale',
    ),
    [isSelfManagedPage, workspace],
  );
  const writeBlocked = dataSourceIssues.length > 0;
  const writeDisabled = !workspace || writeBlocked;
  const writeBlockDescription = formatCodingPlanDataSourceIssues(dataSourceIssues);

  const designFilterOptions = isSelfManagedPage
    ? [
        { value: 'all', label: '全部套餐' },
        { value: 'sellable', label: '可售套餐' },
        { value: 'missing_models', label: '缺模型' },
        { value: 'missing_quota', label: '未绑定配额' },
      ]
    : [
        { value: 'all', label: '全部套餐' },
        { value: 'sellable', label: '可售套餐' },
        { value: 'missing_channel', label: '缺供应商线路' },
        { value: 'missing_upstream', label: '缺上游产品' },
      ];

  const productColumns = [
    {
      title: '产品',
      key: 'product',
      render: (_: unknown, row: CodingPlanWorkspaceProduct) => (
        <div className="cp-primary-cell">
          <div className="cp-primary-title">{row.name}</div>
          <div className="cp-muted cp-mono">{row.slug ?? row.id}</div>
        </div>
      ),
    },
    {
      title: '接入令牌',
      key: 'token',
      width: 190,
      render: (_: unknown, row: CodingPlanWorkspaceProduct) => (
        <div className="cp-stack">
          <span>{row.hasIntegrationToken ? '已生成' : '未生成'}</span>
          <span className="cp-muted cp-mono">{row.integrationTokenPrefix ?? '—'}</span>
        </div>
      ),
    },
    {
      title: '默认套餐',
      key: 'defaultPlan',
      width: 220,
      render: (_: unknown, row: CodingPlanWorkspaceProduct) => (
        <div className="cp-stack">
          <span>{row.defaultPlanName ?? '未配置默认套餐'}</span>
          <span className="cp-muted">
            {row.apiKeyDefaultBinding ? 'API Key 默认走订阅权益' : '默认绑定未启用'}
          </span>
        </div>
      ),
    },
    {
      title: '订阅',
      dataIndex: 'activeSubscriptions',
      key: 'activeSubscriptions',
      width: 100,
      align: 'right' as const,
      render: (value: number) => value.toLocaleString('zh-CN'),
    },
  ];

  const planColumns = [
    {
      title: '套餐',
      key: 'plan',
      width: 260,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        const sellState = planStatus(row);
        const designState = designStatus(row);
        return (
          <div className="cp-primary-cell">
            <div className="cp-design-plan-title">
              <span>{row.name}</span>
              <Tag variant={sellState.variant}>{sellState.label}</Tag>
            </div>
            <div className="cp-muted">{row.productName ?? row.productId ?? '未绑定产品'}</div>
            <Tooltip title={designState.hint}>
              <span><Tag variant={designState.variant}>{designState.label}</Tag></span>
            </Tooltip>
          </div>
        );
      },
    },
    {
      title: '价格与额度',
      key: 'price',
      width: 210,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        const price = resolvePlanPriceLabel(row, platformCurrency);
        return (
          <div className="cp-stack">
            <span>{price.primary}</span>
            <span className="cp-muted">{price.secondary}</span>
            <span className="cp-muted">
              {row.fulfillmentMode === 'provider_resale'
                ? 'Raytone 售价；权益继承上游产品'
                : `${row.monthlyCredits.toLocaleString('zh-CN')} 积分/月`}
            </span>
            <span className="cp-muted">
              {row.validityDays ? `${row.validityDays} 天有效` : '有效期未配置'}
            </span>
          </div>
        );
      },
    },
    {
      title: '限量售卖',
      key: 'maxSellable',
      width: 110,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        if (row.fulfillmentMode !== 'platform_model_package') return <span className="cp-muted">-</span>;
        return (
          <span>
            {row.maxSellableQuantity != null
              ? `上限 ${row.maxSellableQuantity.toLocaleString('zh-CN')} 份`
              : <span className="cp-muted">不限量</span>}
          </span>
        );
      },
    },
    {
      title: '履约方式',
      key: 'fulfillment',
      width: 210,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        const meta = fulfillmentLabel(row);
        return (
          <div className="cp-stack">
            <span><Tag variant={meta.variant}>{meta.label}</Tag></span>
            <span className="cp-muted">{meta.detail}</span>
          </div>
        );
      },
    },
    {
      title: '模型范围',
      key: 'models',
      width: 300,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        if (row.fulfillmentMode === 'provider_resale') {
          return (
            <div className="cp-stack">
              <Tag variant="muted">供应商套餐</Tag>
              <span className="cp-muted">模型范围继承上游产品</span>
            </div>
          );
        }
        if (row.enabledModelCount <= 0) {
          return (
            <div className="cp-stack">
              <Tag variant="warn">未配置模型</Tag>
              <Button type="link" size="small" onClick={() => navigate(`/coding-plan/plans/${row.id}`)}>
                配置模型
              </Button>
            </div>
          );
        }
        return (
          <div className="cp-stack">
            <span>{row.enabledModelCount.toLocaleString('zh-CN')} 个模型</span>
            <div className="cp-inline-tags">
              {row.enabledModels.map((model) => (
                <Tag key={model}>{model}</Tag>
              ))}
              {row.enabledModelCount > row.enabledModels.length && (
                <Tag>+{row.enabledModelCount - row.enabledModels.length}</Tag>
              )}
            </div>
          </div>
        );
      },
    },
    {
      title: '配额模板',
      key: 'quotaTemplates',
      width: 240,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        if (row.fulfillmentMode === 'provider_resale') {
          return (
            <div className="cp-stack">
              <Tag variant="muted">供应商侧</Tag>
              <span className="cp-muted">不绑定本地配额模板</span>
            </div>
          );
        }
        if (row.quotaTemplateCount <= 0) {
          return (
            <div className="cp-stack">
              <Tag variant="muted">未绑定</Tag>
              <span className="cp-muted">去 CodingPlan 编辑器的配额 Tab 绑定</span>
            </div>
          );
        }
        return (
          <div className="cp-stack">
            {row.quotaTemplates.map((template) => (
              <span key={template.id}>
                {template.name} <span className="cp-muted">({template.ruleCount} 条)</span>
              </span>
            ))}
          </div>
        );
      },
    },
    {
      title: '配额来源',
      key: 'limits',
      width: 210,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        // 只有启用中的模板才是有效配额来源；停用模板的规则既不下发也不展示
        const activeTemplates = row.quotaTemplates.filter((template) => template.isActive);
        const inactiveCount = row.quotaTemplates.length - activeTemplates.length;
        return (
          <div className="cp-stack">
            {row.fulfillmentMode === 'provider_resale' ? (
              <>
                <span>上游产品限制</span>
                <span className="cp-muted">本地限流不作为业务配额来源</span>
              </>
            ) : activeTemplates.length > 0 ? (
              <>
                <span>配额模板 ×{activeTemplates.length}</span>
                <span className="cp-muted">
                  {activeTemplates.map((template) => template.name).join('、')}
                  {inactiveCount > 0 ? ` · ${inactiveCount} 个已停用不生效` : ''}
                </span>
              </>
            ) : row.quotaTemplateCount > 0 ? (
              <>
                <span>模板已全部停用</span>
                <span className="cp-muted">规则不下发也不展示；请重新绑定启用中的模板</span>
              </>
            ) : (
              <>
                <span>未绑定配额模板</span>
                <span className="cp-muted">上架前必须绑定；详见套餐配额 Tab</span>
              </>
            )}
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 230,
      align: 'right' as const,
      render: (_: unknown, row: CodingPlanWorkspacePlan) => {
        const isSelfOp = row.fulfillmentMode === 'platform_model_package';
        // 上架达标条件与后端/billing setPlanActive 同口径：≥1 启用模型、≥1 启用配额模板、
        // billingPeriod 周期售价>0、月度积分>0（零值套餐禁止上架）。
        const publishPrice = planPeriodPrice(row, planBillingPeriod(row));
        const canPublish = row.enabledModelCount > 0
          && activeQuotaTemplateCount(row) > 0
          && publishPrice > 0
          && row.monthlyCredits > 0;
        return (
          <Space size={4} wrap>
            {/* finding #13：已上架自营套餐不可编辑，须先下架（改绑定=改存量权益+防非原子中间态）。 */}
            <Tooltip title={isSelfOp && row.isActive ? '已上架套餐不可编辑，请先下架' : ''}>
              <Button
                type="link"
                size="small"
                disabled={isSelfOp && row.isActive}
                onClick={() => navigate(`/coding-plan/plans/${row.id}`)}
              >
                编辑套餐
              </Button>
            </Tooltip>
            {isSelfOp && (
              row.isActive ? (
                <Popconfirm
                  title="确认下架此套餐？"
                  description="下架后停止新销售，存量订阅不受影响（可继续使用）。"
                  onConfirm={() => handleTogglePlanActive(row)}
                  disabled={!canManage}
                >
                  <Button type="link" size="small" disabled={!canManage}>下架</Button>
                </Popconfirm>
              ) : (
                <Tooltip title={canPublish ? '' : '上架前需：至少启用 1 个模型、绑定 1 个启用中的配额模板、售价大于 0、月度积分大于 0'}>
                  <Button
                    type="link"
                    size="small"
                    disabled={!canManage || !canPublish}
                    onClick={() => handleTogglePlanActive(row)}
                  >
                    上架
                  </Button>
                </Tooltip>
              )
            )}
            <Popconfirm
              title={(
                <div>
                  <div>确认删除此套餐？</div>
                  <div style={{ marginTop: 4, maxWidth: 270, color: 'var(--text-muted)', fontWeight: 400 }}>
                    仅无订单、订阅、组合套餐等引用的错误套餐可删除。
                  </div>
                </div>
              )}
              onConfirm={() => handleDeletePlan(row)}
              disabled={!canManage || (isSelfOp && row.isActive)}
            >
              <Tooltip title={isSelfOp && row.isActive ? '已上架套餐不可删除，请先下架' : ''}>
                <Button type="link" size="small" danger disabled={!canManage || (isSelfOp && row.isActive)}>
                  删除
                </Button>
              </Tooltip>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  const pagePlanColumns = isSelfManagedPage
    ? planColumns
    : planColumns.filter((column) => column.key !== 'quotaTemplates');

  return (
    <div className="cp-page">
      <PageHeader
        title={isSelfManagedPage ? 'CodingPlan 自营套餐' : 'CodingPlan 三方套餐'}
        subtitle={isSelfManagedPage
          ? '自营套餐由 Raytone 本地定义模型范围、积分和配额模板'
          : '三方套餐绑定供应商通道和上游产品，权益继承供应商目录'}
        actions={[
          <Button key="refresh" icon={<ReloadOutlined />} onClick={fetchWorkspace} loading={loading}>
            刷新
          </Button>,
          ...(!isSelfManagedPage
            ? [
                <Button key="switch" onClick={() => navigate(SELF_MANAGED_ROUTE)}>
                  查看自营套餐
                </Button>,
              ]
            : []),
          <Button key="products" icon={<SettingOutlined />} onClick={() => navigate('/products')}>
            产品配置
          </Button>,
          ...(isSelfManagedPage
            ? [
                <Button key="quota" icon={<DatabaseOutlined />} onClick={() => navigate(QUOTA_TEMPLATE_ROUTE)}>
                  配额模板
                </Button>,
                <Button
                  key="new-self"
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canManage || writeDisabled}
                  onClick={() => navigate('/coding-plan/plans/new?mode=platform_model_package')}
                >
                  新建自营套餐
                </Button>,
              ]
            : [
                <Button key="resale-config" icon={<ApiOutlined />} onClick={() => navigate('/coding-plan/resale-config')}>
                  转售配置
                </Button>,
                <Button
                  key="new-provider"
                  type="primary"
                  icon={<PlusOutlined />}
                  disabled={!canManage || writeDisabled}
                  onClick={() => navigate('/coding-plan/plans/new?mode=provider_resale')}
                >
                  新建三方套餐
                </Button>,
              ]),
        ]}
      />

      <StatCardGroup columns={5}>
        {!isSelfManagedPage ? (
          <StatCard label="CodingPlan 产品" value={workspace?.stats.productCount ?? 0} />
        ) : null}
        <StatCard label={isSelfManagedPage ? '自营套餐' : '三方套餐'} value={pagePlans.length} />
        <StatCard label="可售套餐" value={sellablePagePlanCount} />
        {isSelfManagedPage ? (
          <StatCard label="已配置模型" value={workspace?.stats.modelConfiguredPlanCount ?? 0} />
        ) : (
          <>
            <StatCard label="已绑定上游产品" value={workspace?.stats.providerProductBoundPlanCount ?? 0} />
            <StatCard label="可用上游库存" value={workspace?.stats.upstreamAvailableCount ?? '—'} />
          </>
        )}
      </StatCardGroup>

      {writeBlocked && (
        <Alert
          className="cp-alert"
          type="warning"
          showIcon
          message="关键数据源暂不可用，已暂停新建和保存 CodingPlan 套餐"
          description={writeBlockDescription}
        />
      )}

      <Alert
        className="cp-alert"
        type="info"
        showIcon
        message={isSelfManagedPage
          ? '自营套餐配置平台模型、倍率和配额模板，配额模板是套餐请求、Token 与积分上限的来源。'
          : '三方套餐只绑定供应商通道和上游产品，不配置本地模型或配额模板。'}
      />

      <section className="cp-section cp-design-workflow">
        <div className="cp-section-head">
          <div>
            <h2>设计边界</h2>
            <p>{isSelfManagedPage
              ? '自营套餐负责 Raytone 本地售卖和本地履约，模型范围与配额都在本页闭环。'
              : '三方套餐负责 Raytone 售卖入口和供应商履约映射，实际权益由上游产品定义。'}</p>
          </div>
        </div>
        <div className="cp-design-rule-grid">
          <div>
            <span>1</span>
            <strong>产品</strong>
            <p>在产品管理中创建 billingMode 为 CODING_PLAN 的产品，并生成接入令牌。</p>
          </div>
          <div>
            <span>2</span>
            <strong>套餐</strong>
            <p>在 CodingPlan 编辑器中配置价格、积分、限流、席位和是否上架。</p>
          </div>
          <div>
            <span>3</span>
            <strong>{isSelfManagedPage ? '模型与配额' : '上游权益'}</strong>
            <p>{isSelfManagedPage
              ? '自营套餐配置模型范围和配额模板。'
              : '三方套餐绑定唯一供应商通道和上游产品 ID。'}</p>
          </div>
        </div>
      </section>

      <section className="cp-section">
        <div className="cp-section-head">
          <div>
            <h2>{isSelfManagedPage ? '自营套餐列表' : '三方套餐列表'}</h2>
            <p>{isSelfManagedPage
              ? '检查自营套餐的模型范围、配额模板和上架条件。'
              : '检查三方套餐的供应商通道、上游产品和激活准备状态。'}</p>
          </div>
          <Space wrap>
            <Select
              value={productFilter}
              style={{ width: 210 }}
              onChange={setProductFilter}
              options={productOptions}
            />
            <Select
              value={designFilter}
              style={{ width: 180 }}
              onChange={(value: DesignFilter) => setDesignFilter(value)}
              options={designFilterOptions}
            />
          </Space>
        </div>
        {filteredPlans.length === 0 && !loading ? (
          <EmptyPlaceholder
            icon={<ApiOutlined />}
            title={isSelfManagedPage ? '暂无匹配的自营套餐' : '暂无匹配的三方套餐'}
            description={isSelfManagedPage
              ? '先创建自营套餐，再进入套餐详情配置模型范围和配额模板。'
              : '先创建三方套餐，再进入套餐详情绑定供应商通道和上游产品。'}
            action={
              <Space wrap>
                <Button
                  onClick={() => navigate(
                    isSelfManagedPage
                      ? '/coding-plan/plans/new?mode=platform_model_package'
                      : '/coding-plan/plans/new?mode=provider_resale',
                  )}
                  disabled={!canManage || writeDisabled}
                >
                  {isSelfManagedPage ? '新建自营套餐' : '新建三方套餐'}
                </Button>
              </Space>
            }
          />
        ) : (
          <DataTable<CodingPlanWorkspacePlan>
            columns={pagePlanColumns}
            dataSource={filteredPlans}
            rowKey="id"
            loading={loading}
            searchable
            searchPlaceholder="搜索套餐名称 / Slug"
            pagination={false}
            scroll={{ x: isSelfManagedPage ? 1460 : 1220 }}
          />
        )}
      </section>

      {!isSelfManagedPage && (
        <div className="cp-design-single-col">
          <section className="cp-section">
            <div className="cp-section-head">
              <div>
                <h2>CodingPlan 产品</h2>
                <p>产品是套餐、API Key 默认权益和接入凭证的边界。</p>
              </div>
            </div>
            {products.length === 0 && !loading ? (
              <EmptyPlaceholder
                title="暂无 CodingPlan 产品"
                description="先在产品配置中创建 billingMode 为 CODING_PLAN 的产品。"
                action={<Button onClick={() => navigate('/products')}>产品配置</Button>}
              />
            ) : (
              <DataTable<CodingPlanWorkspaceProduct>
                columns={productColumns}
                dataSource={products}
                rowKey="id"
                loading={loading}
                searchable
                searchPlaceholder="搜索产品名称 / Slug"
                pagination={false}
                scroll={{ x: 820 }}
              />
            )}
          </section>
        </div>
      )}

      {workspace?.generatedAt && (
        <div className="cp-generated">
          设计快照生成于 {dayjs(workspace.generatedAt).format('YYYY-MM-DD HH:mm:ss')}
        </div>
      )}
    </div>
  );
}
