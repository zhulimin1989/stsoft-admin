import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Select, Space, message, Popconfirm } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  EmptyPlaceholder,
  type TagVariant,
} from '../../components/common';
import { planApi, productApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { formatCurrencyCents } from '../../utils/price';
import { warnNonCritical } from '../../utils/logging';

interface ProductInfo {
  id: string;
  name: string;
  billingMode?: string | null;
}

interface Plan {
  id: string;
  productId: string | null;
  name: string;
  planType: string;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
  monthlyCredits: number;
  memberLimit: number;
  rateLimitRpm: number;
  badge: string | null;
  trialDays: number;
  isActive: boolean;
  isLegacy: boolean;
  usageMultiplier: number;
  features?: string[] | string | null;
  activeSubscriptions?: number;
  monthlyRevenue?: number;
}

const PLAN_TYPE_LABEL: Record<string, string> = {
  individual: '个人',
  team: '团队',
  enterprise: '企业',
};

const PLAN_TYPE_OPTIONS = [
  { value: 'all', label: '全部计费类型' },
  { value: 'individual', label: '个人' },
  { value: 'team', label: '团队' },
  { value: 'enterprise', label: '企业' },
];

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '活跃' },
  { value: 'legacy', label: '旧版' },
  { value: 'inactive', label: '已停用' },
];

function resolveErrorMessage(error: unknown, fallback: string): string {
  const data = (error as { response?: { data?: { message?: unknown } } })?.response?.data;
  return typeof data?.message === 'string' && data.message ? data.message : fallback;
}

export default function PlanTemplatesPage() {
  const navigate = useNavigate();
  const canManage = usePermission('admin.page.subscription_plans.manage');
  const platformCurrency = usePlatformCurrency();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [products, setProducts] = useState<ProductInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const [planTypeFilter, setPlanTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [planRes, prodRes] = await Promise.all([
        planApi.list(),
        productApi.list().catch((error: unknown) => {
          warnNonCritical('PlanTemplates product preload', error);
          return [];
        }),
      ]);
      const productItems: ProductInfo[] = Array.isArray(prodRes) ? prodRes : prodRes.items || [];
      const subscriptionProducts = productItems.filter((product) => (
        (product.billingMode ?? 'SUBSCRIPTION') === 'SUBSCRIPTION'
      ));
      const subscriptionProductIds = new Set(subscriptionProducts.map((product) => product.id));
      const planItems: Plan[] = planRes.items || planRes;
      setPlans(planItems.filter((plan) => (
        plan.productId !== null
        && subscriptionProductIds.has(plan.productId)
        && plan.planType !== 'coding_plan'
      )));
      setProducts(subscriptionProducts);
    } catch {
      message.error('加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const productMap = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p.name])),
    [products],
  );

  const filtered = useMemo(() => {
    return plans.filter((p) => {
      if (search) {
        const s = search.toLowerCase();
        if (!p.name.toLowerCase().includes(s) && !p.id.toLowerCase().includes(s)) {
          return false;
        }
      }
      if (productFilter !== 'all' && p.productId !== productFilter) return false;
      if (planTypeFilter !== 'all' && p.planType !== planTypeFilter) return false;
      if (statusFilter === 'active' && (!p.isActive || p.isLegacy)) return false;
      if (statusFilter === 'legacy' && !p.isLegacy) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      return true;
    });
  }, [plans, search, productFilter, planTypeFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = plans.length;
    const topByActive = [...plans]
      .filter((p) => p.activeSubscriptions != null)
      .sort((a, b) => (b.activeSubscriptions ?? 0) - (a.activeSubscriptions ?? 0))[0];
    const topByRevenue = [...plans]
      .filter((p) => p.monthlyRevenue != null)
      .sort((a, b) => (b.monthlyRevenue ?? 0) - (a.monthlyRevenue ?? 0))[0];
    return {
      total,
      topActive: topByActive?.name ?? '—',
      newSubs30d: '—',
      topRevenue: topByRevenue?.name ?? '—',
    };
  }, [plans]);

  const statusFor = (p: Plan): { label: string; variant: TagVariant } => {
    if (!p.isActive) return { label: '已停用', variant: 'muted' };
    if (p.isLegacy) return { label: '旧版', variant: 'warn' };
    return { label: '活跃', variant: 'success' };
  };

  const formatPlanCents = (cents: number | null | undefined): string =>
    formatCurrencyCents(cents, platformCurrency, { zeroAsEmpty: true });

  const handleClone = async (plan: Plan) => {
    try {
      const result = await planApi.create({
        ...plan,
        id: undefined,
        name: `${plan.name} 副本`,
        isActive: false,
        isLegacy: false,
      } as never);
      const clonedId = result?.id || result?.data?.id;
      message.success('已复制为未上架草稿');
      if (clonedId) {
        navigate(`/plans/${clonedId}`);
      } else {
        fetchData();
      }
    } catch {
      message.error('复制失败');
    }
  };

  const handleDelete = async (plan: Plan) => {
    try {
      await planApi.delete(plan.id);
      message.success('已删除套餐');
      fetchData();
    } catch (error) {
      message.error(resolveErrorMessage(error, '删除失败'));
    }
  };

  const columns = [
    {
      title: '套餐名',
      key: 'name',
      render: (_: unknown, r: Plan) => (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 500 }}>
            <span>{r.name}</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {r.productId ? productMap[r.productId] ?? r.productId : '通用'}
            {' · '}
            {PLAN_TYPE_LABEL[r.planType] ?? r.planType}
          </div>
        </div>
      ),
    },
    {
      title: '月费',
      key: 'monthlyPrice',
      width: 100,
      render: (_: unknown, r: Plan) => formatPlanCents(r.monthlyPrice),
    },
    {
      title: '季均',
      key: 'quarterlyPrice',
      width: 100,
      render: (_: unknown, r: Plan) => formatPlanCents(r.quarterlyPrice),
    },
    {
      title: '年均',
      key: 'yearlyPrice',
      width: 100,
      render: (_: unknown, r: Plan) => formatPlanCents(r.yearlyPrice),
    },
    {
      title: '月度积分',
      key: 'monthlyCredits',
      width: 110,
      render: (_: unknown, r: Plan) => r.monthlyCredits.toLocaleString(),
    },
    {
      title: '活跃订阅',
      key: 'activeSubscriptions',
      width: 100,
      render: (_: unknown, r: Plan) =>
        r.activeSubscriptions != null ? r.activeSubscriptions.toLocaleString() : '—',
    },
    {
      title: '试用天数',
      key: 'trialDays',
      width: 90,
      render: (_: unknown, r: Plan) => (r.trialDays > 0 ? `${r.trialDays} 天` : '—'),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: unknown, r: Plan) => {
        const s = statusFor(r);
        return <Tag variant={s.variant}>{s.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 300,
      align: 'right' as const,
      render: (_: unknown, r: Plan) => (
        <Space size={4} wrap>
          <Button
            type="link"
            size="small"
            onClick={() => navigate(`/plans/${r.id}`)}
          >
            配置
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canManage}
            onClick={() => handleClone(r)}
          >
            复制为草稿
          </Button>
          <Popconfirm
            title={r.isActive ? '确认下架此套餐？' : '确认上架此套餐？'}
            onConfirm={async () => {
              try {
                await planApi.update(r.id, { isActive: !r.isActive } as never);
                message.success('已更新');
                fetchData();
              } catch {
                message.error('操作失败');
              }
            }}
          >
            <Button type="link" size="small" disabled={!canManage}>
              {r.isActive ? '下架' : '上架'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={r.isLegacy ? '确认取消旧版标记？' : '确认标记为旧版？'}
            onConfirm={async () => {
              try {
                await planApi.update(r.id, { isLegacy: !r.isLegacy } as never);
                message.success('已更新');
                fetchData();
              } catch {
                message.error('操作失败');
              }
            }}
          >
            <Button type="link" size="small" disabled={!canManage}>
              {r.isLegacy ? '取消旧版' : '标记旧版'}
            </Button>
          </Popconfirm>
          <Popconfirm
            title={(
              <div>
                <div>确认删除此套餐？</div>
                <div style={{ marginTop: 4, maxWidth: 260, color: 'var(--text-muted)', fontWeight: 400 }}>
                  仅无订单、订阅、组合套餐等引用的错误套餐可删除。
                </div>
              </div>
            )}
            onConfirm={() => handleDelete(r)}
          >
            <Button type="link" size="small" danger disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="套餐管理"
        subtitle="管理订阅计费产品下的套餐：定价、积分、订阅状态"
        actions={[
          <Button
            key="refresh"
            icon={<ReloadOutlined />}
            onClick={fetchData}
          >
            刷新
          </Button>,
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/plans/new')}
            disabled={!canManage}
          >
            新建套餐
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="套餐总数" value={stats.total} />
        <StatCard label="活跃订阅最多" value={stats.topActive} />
        <StatCard label="30 天新订阅" value={stats.newSubs30d} />
        <StatCard label="收入 Top" value={stats.topRevenue} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索套餐名 / ID',
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="product"
            value={productFilter}
            style={{ width: 160 }}
            onChange={setProductFilter}
            options={[
              { value: 'all', label: '全部产品' },
              ...products.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />,
          <Select
            key="planType"
            value={planTypeFilter}
            style={{ width: 160 }}
            onChange={setPlanTypeFilter}
            options={PLAN_TYPE_OPTIONS}
          />,
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 130 }}
            onChange={setStatusFilter}
            options={STATUS_OPTIONS}
          />,
        ]}
      />

      {filtered.length === 0 && !loading ? (
        <EmptyPlaceholder
          title="暂无套餐"
          description={
            plans.length === 0
              ? '尚未创建任何套餐。点击右上角新建。'
              : '当前筛选下没有匹配的订阅套餐。'
          }
        />
      ) : (
        <DataTable<Plan>
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 1180 }}
        />
      )}
    </div>
  );
}
