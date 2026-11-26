import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Typography,
  message,
} from 'antd';
import { DeleteOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type {
  BillingPeriod,
  BundleSku,
  CreateBundleSkuInput,
  UpdateBundleSkuInput,
} from '@ruidong/shared';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  EmptyPlaceholder,
  StableNumberInput,
  type TagVariant,
} from '../../components/common';
import { boosterPackApi, bundleApi, planApi, productApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';
import { warnNonCritical } from '../../utils/logging';

interface ProductOption {
  id: string;
  name: string;
  slug: string;
}

interface PlanOption {
  id: string;
  productId: string | null;
  name: string;
  monthlyCredits: number;
  validityDays: number;
  isActive: boolean;
  product?: { id: string; name: string; slug: string } | null;
}

interface BoosterPackOption {
  id: string;
  productId: string | null;
  name: string;
  creditsAmount: number;
  isActive: boolean;
  product?: { id: string; name: string; slug: string } | null;
}

type TargetType = 'PLAN' | 'BOOSTER_PACK';

interface BundleFormItem {
  productId?: string;
  targetType?: TargetType;
  planId?: string;
  boosterPackId?: string;
  billingType?: 'SUBSCRIPTION' | 'ONE_TIME';
  name?: string;
  unitAmountCents?: number;
  originalUnitAmountCents?: number;
  quantity?: number;
  recurringInterval?: 'month' | 'year' | null;
  validityDays?: number | null;
}

interface BundleFormValues {
  code: string;
  name: string;
  description?: string;
  currency: string;
  billingPeriod: BillingPeriod;
  range?: [Dayjs, Dayjs];
  maxUsesPerUser: number;
  maxUsesTotal: number;
  isActive: boolean;
  sortOrder: number;
  items: BundleFormItem[];
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'live', label: '生效中' },
  { value: 'scheduled', label: '未开始' },
  { value: 'ended', label: '已结束' },
  { value: 'inactive', label: '已停用' },
];

const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'usd' },
  { label: 'SGD', value: 'sgd' },
  { label: 'CNY', value: 'cny' },
];

function formatCents(cents: number | null | undefined, currency = 'usd') {
  return formatCurrencyCents(cents, currency, { emptyText: '—' });
}

function bundleStatus(bundle: BundleSku): { key: string; label: string; variant: TagVariant } {
  const now = dayjs();
  if (!bundle.isActive) return { key: 'inactive', label: '已停用', variant: 'muted' };
  if (bundle.startAt && dayjs(bundle.startAt).isAfter(now)) {
    return { key: 'scheduled', label: '未开始', variant: 'warn' };
  }
  if (bundle.endAt && dayjs(bundle.endAt).isBefore(now)) {
    return { key: 'ended', label: '已结束', variant: 'muted' };
  }
  return { key: 'live', label: '生效中', variant: 'success' };
}

function itemLabel(item: BundleSku['items'][number]) {
  return item.name || item.plan?.name || item.boosterPack?.name || item.product?.name || '未命名明细';
}

function itemSummary(items: BundleFormItem[] | undefined) {
  const rows = items ?? [];
  let amount = 0;
  let original = 0;
  for (const item of rows) {
    const quantity = item.quantity ?? 1;
    const unit = item.unitAmountCents ?? 0;
    const originalUnit = item.originalUnitAmountCents ?? unit;
    amount += unit * quantity;
    original += originalUnit * quantity;
  }
  return { amount, original };
}

export default function BundlesPage() {
  const canManage = usePermission('admin.page.bundles.manage');
  const platformCurrency = usePlatformCurrency();
  const defaultCurrency = platformCurrency.toLowerCase();
  const [bundles, setBundles] = useState<BundleSku[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [boosterPacks, setBoosterPacks] = useState<BoosterPackOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<BundleSku | null>(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [productFilter, setProductFilter] = useState('all');
  const [form] = Form.useForm<BundleFormValues>();
  const watchedItems = Form.useWatch('items', form) as BundleFormItem[] | undefined;
  const watchedCurrency = Form.useWatch('currency', form) || defaultCurrency;
  const minorUnitLabel = currencyMinorUnitLabel(watchedCurrency);
  const totals = itemSummary(watchedItems);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [bundleRows, productRows, planRows, packRows] = await Promise.all([
        bundleApi.list(),
        productApi.list().catch((error: unknown) => {
          warnNonCritical('Bundles product preload', error);
          return [];
        }),
        planApi.list().catch((error: unknown) => {
          warnNonCritical('Bundles plan preload', error);
          return [];
        }),
        boosterPackApi.list().catch((error: unknown) => {
          warnNonCritical('Bundles booster pack preload', error);
          return [];
        }),
      ]);
      setBundles(bundleRows || []);
      setProducts((Array.isArray(productRows) ? productRows : productRows.items || []) as ProductOption[]);
      setPlans((Array.isArray(planRows) ? planRows : planRows.items || []) as PlanOption[]);
      setBoosterPacks((Array.isArray(packRows) ? packRows : packRows.items || []) as BoosterPackOption[]);
    } catch {
      message.error('加载组合套餐失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const productMap = useMemo(
    () => new Map(products.map((product) => [product.id, product.name])),
    [products],
  );

  const filtered = useMemo(() => {
    return bundles.filter((bundle) => {
      const q = search.trim().toLowerCase();
      if (q && !`${bundle.name} ${bundle.code} ${bundle.description}`.toLowerCase().includes(q)) {
        return false;
      }
      if (statusFilter !== 'all' && bundleStatus(bundle).key !== statusFilter) return false;
      if (productFilter !== 'all' && !bundle.items.some((item) => item.productId === productFilter)) {
        return false;
      }
      return true;
    });
  }, [bundles, productFilter, search, statusFilter]);

  const stats = useMemo(() => {
    const active = bundles.filter((bundle) => bundleStatus(bundle).key === 'live').length;
    const sold = bundles.reduce((sum, bundle) => sum + (bundle.usedCount ?? 0), 0);
    const revenue = bundles.reduce((sum, bundle) => sum + (bundle.revenueCents ?? 0), 0);
    return {
      total: bundles.length,
      active,
      sold,
      revenue,
    };
  }, [bundles]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      currency: defaultCurrency,
      billingPeriod: 'yearly',
      range: [dayjs(), dayjs().add(14, 'day')],
      maxUsesPerUser: 1,
      maxUsesTotal: 0,
      isActive: true,
      sortOrder: 0,
      items: [
        {
          targetType: 'PLAN',
          billingType: 'SUBSCRIPTION',
          recurringInterval: 'year',
          quantity: 1,
          unitAmountCents: 0,
          originalUnitAmountCents: 0,
        },
        {
          targetType: 'PLAN',
          billingType: 'ONE_TIME',
          quantity: 1,
          unitAmountCents: 0,
          originalUnitAmountCents: 0,
        },
      ],
    });
    setModalOpen(true);
  };

  const openEdit = (bundle: BundleSku) => {
    setEditing(bundle);
    form.resetFields();
    form.setFieldsValue({
      code: bundle.code,
      name: bundle.name,
      description: bundle.description,
      currency: bundle.currency,
      billingPeriod: bundle.billingPeriod,
      range: bundle.startAt && bundle.endAt ? [dayjs(bundle.startAt), dayjs(bundle.endAt)] : undefined,
      maxUsesPerUser: bundle.maxUsesPerUser,
      maxUsesTotal: bundle.maxUsesTotal,
      isActive: bundle.isActive,
      sortOrder: bundle.sortOrder,
      items: bundle.items.map((item) => ({
        productId: item.productId,
        targetType: item.boosterPackId ? 'BOOSTER_PACK' : 'PLAN',
        planId: item.planId ?? undefined,
        boosterPackId: item.boosterPackId ?? undefined,
        billingType: item.billingType,
        name: item.name,
        unitAmountCents: item.unitAmountCents,
        originalUnitAmountCents: item.originalUnitAmountCents ?? item.unitAmountCents,
        quantity: item.quantity,
        recurringInterval: item.recurringInterval,
        validityDays: item.validityDays,
      })),
    });
    setModalOpen(true);
  };

  const buildPayload = (values: BundleFormValues): CreateBundleSkuInput | UpdateBundleSkuInput => {
    const items = values.items.map((item, index) => {
      const billingType = item.billingType || 'ONE_TIME';
      const targetType = billingType === 'SUBSCRIPTION' ? 'PLAN' : item.targetType || 'PLAN';
      return {
        productId: item.productId!,
        planId: targetType === 'PLAN' ? item.planId || null : null,
        boosterPackId: targetType === 'BOOSTER_PACK' ? item.boosterPackId || null : null,
        billingType,
        name: item.name || '',
        unitAmountCents: Math.round(item.unitAmountCents ?? 0),
        originalUnitAmountCents: Math.round(item.originalUnitAmountCents ?? item.unitAmountCents ?? 0),
        quantity: item.quantity ?? 1,
        recurringInterval: billingType === 'SUBSCRIPTION' ? item.recurringInterval || 'year' : null,
        validityDays: item.validityDays ?? null,
        sortOrder: index,
      };
    });
    const summary = itemSummary(values.items);
    return {
      code: values.code.trim(),
      name: values.name.trim(),
      description: values.description || '',
      currency: values.currency.toLowerCase(),
      billingPeriod: values.billingPeriod,
      amountCents: summary.amount,
      originalAmountCents: summary.original > summary.amount ? summary.original : null,
      startAt: values.range?.[0]?.toISOString() ?? null,
      endAt: values.range?.[1]?.toISOString() ?? null,
      maxUsesPerUser: values.maxUsesPerUser ?? 0,
      maxUsesTotal: values.maxUsesTotal ?? 0,
      isActive: values.isActive ?? true,
      sortOrder: values.sortOrder ?? 0,
      items,
    };
  };

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      const payload = buildPayload(values);
      if (editing) {
        await bundleApi.update(editing.id, payload);
        message.success('组合套餐已更新');
      } else {
        await bundleApi.create(payload as CreateBundleSkuInput);
        message.success('组合套餐已创建');
      }
      setModalOpen(false);
      setEditing(null);
      fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      message.error(e?.response?.data?.message || e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (bundle: BundleSku) => {
    try {
      const result = await bundleApi.delete(bundle.id);
      message.success(result.disabled ? '已有订单，已改为停用' : '删除成功');
      fetchData();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      message.error(e?.response?.data?.message || '删除失败');
    }
  };

  const planOptionsFor = (productId?: string) =>
    plans
      .filter((plan) => !productId || !plan.productId || plan.productId === productId)
      .map((plan) => ({
        value: plan.id,
        label: `${plan.product?.name || (plan.productId ? productMap.get(plan.productId) : '通用')} / ${plan.name}`,
      }));

  const packOptionsFor = (productId?: string) =>
    boosterPacks
      .filter((pack) => !productId || !pack.productId || pack.productId === productId)
      .map((pack) => ({
        value: pack.id,
        label: `${pack.product?.name || (pack.productId ? productMap.get(pack.productId) : '通用')} / ${pack.name}`,
      }));

  const columns = [
    {
      title: '组合',
      key: 'bundle',
      render: (_: unknown, bundle: BundleSku) => (
        <div>
          <div style={{ fontWeight: 500 }}>{bundle.name}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>{bundle.code}</div>
        </div>
      ),
    },
    {
      title: '明细',
      key: 'items',
      render: (_: unknown, bundle: BundleSku) => (
        <Space direction="vertical" size={2}>
          {bundle.items.map((item) => (
            <span key={item.id} style={{ fontSize: 12 }}>
              <Tag variant={item.billingType === 'SUBSCRIPTION' ? 'proc' : 'muted'}>
                {item.billingType === 'SUBSCRIPTION' ? '续费' : '一次性'}
              </Tag>{' '}
              {productMap.get(item.productId) || item.product?.name || item.productId} / {itemLabel(item)}
            </span>
          ))}
        </Space>
      ),
    },
    {
      title: '价格',
      key: 'price',
      width: 160,
      render: (_: unknown, bundle: BundleSku) => (
        <div>
          <div>{formatCents(bundle.amountCents, bundle.currency)}</div>
          {bundle.originalAmountCents && bundle.originalAmountCents > bundle.amountCents ? (
            <div style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              原价 {formatCents(bundle.originalAmountCents, bundle.currency)}
            </div>
          ) : null}
        </div>
      ),
    },
    {
      title: '时间',
      key: 'time',
      width: 180,
      render: (_: unknown, bundle: BundleSku) => (
        <span style={{ fontSize: 12 }}>
          {bundle.startAt ? dayjs(bundle.startAt).format('MM-DD HH:mm') : '立即'} ~{' '}
          {bundle.endAt ? dayjs(bundle.endAt).format('MM-DD HH:mm') : '不限'}
        </span>
      ),
    },
    {
      title: '限购 / 已购',
      key: 'limits',
      width: 120,
      render: (_: unknown, bundle: BundleSku) => (
        <span>
          {bundle.maxUsesTotal > 0 ? bundle.maxUsesTotal : '不限'} / {bundle.usedCount ?? 0}
        </span>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 90,
      render: (_: unknown, bundle: BundleSku) => {
        const status = bundleStatus(bundle);
        return <Tag variant={status.variant}>{status.label}</Tag>;
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, bundle: BundleSku) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(bundle)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Popconfirm
            title="确认删除或停用此组合套餐？"
            description="已有订单的组合会保留历史并改为停用。"
            onConfirm={() => handleDelete(bundle)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage}
            >
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
        title="组合套餐"
        subtitle="配置一个 Stripe Checkout 中的订阅项与一次性权益；启用且在时间内的组合会展示在前台价格页。"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!canManage}
          >
            新建组合
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="组合总数" value={stats.total} />
        <StatCard label="生效中" value={stats.active} />
        <StatCard label="累计购买" value={stats.sold} />
        <StatCard label="确认收入" value={stats.revenue > 0 ? formatCents(stats.revenue, defaultCurrency) : '—'} />
      </StatCardGroup>

      <FilterBar
        search={{ placeholder: '搜索组合名 / code / 说明', onSearch: setSearch }}
        filters={[
          <Select
            key="product"
            value={productFilter}
            style={{ width: 160 }}
            onChange={setProductFilter}
            options={[
              { value: 'all', label: '全部产品' },
              ...products.map((product) => ({ value: product.id, label: product.name })),
            ]}
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
          title="暂无组合套餐"
          description={bundles.length === 0 ? '尚未创建任何组合套餐。' : '当前筛选下没有匹配的组合套餐。'}
        />
      ) : (
        <DataTable<BundleSku>
          rowKey="id"
          columns={columns}
          dataSource={filtered}
          loading={loading}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1100 }}
        />
      )}

      <Modal
        open={modalOpen}
        title={editing ? '编辑组合套餐' : '新建组合套餐'}
        width={980}
        destroyOnHidden
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        onOk={submit}
        okText={editing ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} disabled={!canManage}>
          <Space size={16} style={{ width: '100%' }}>
            <Form.Item name="code" label="Code" rules={[{ required: true, message: '请输入 code' }]} style={{ flex: 1 }}>
              <Input placeholder="bundle-blackfriday-2026" disabled={!!editing} />
            </Form.Item>
            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} style={{ flex: 1 }}>
              <Input placeholder="AI 编程 + 设计资源年付组合" />
            </Form.Item>
          </Space>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} placeholder="展示在前台价格页的简短说明" />
          </Form.Item>
          <Space size={16} style={{ width: '100%' }}>
            <Form.Item name="currency" label="币种" rules={[{ required: true }]} style={{ width: 120 }}>
              <Select options={CURRENCY_OPTIONS} />
            </Form.Item>
            <Form.Item name="billingPeriod" label="组合周期" rules={[{ required: true }]} style={{ width: 140 }}>
              <Select
                options={[
                  { value: 'monthly', label: '月付组合' },
                  { value: 'quarterly', label: '季付组合' },
                  { value: 'yearly', label: '年付组合' },
                ]}
              />
            </Form.Item>
            <Form.Item name="range" label="活动时间" style={{ flex: 1 }}>
              <DatePicker.RangePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Space size={16}>
            <Form.Item name="maxUsesPerUser" label="每人限购 (0=不限)">
              <StableNumberInput min={0} precision={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="maxUsesTotal" label="总限量 (0=不限)">
              <StableNumberInput min={0} precision={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="sortOrder" label="排序">
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="isActive" label="状态" valuePropName="checked">
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '8px 0 12px' }}>
            <Typography.Title level={5} style={{ margin: 0 }}>组合明细</Typography.Title>
            <Typography.Text type="secondary">
              活动价合计 {formatCents(totals.amount, watchedCurrency)}
              {totals.original > totals.amount ? ` · 原价 ${formatCents(totals.original, watchedCurrency)}` : ''}
            </Typography.Text>
          </div>

          <Form.List name="items">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => {
                  const rows = (form.getFieldValue('items') || []) as BundleFormItem[];
                  const row = rows[field.name] || {};
                  const billingType = row.billingType || 'ONE_TIME';
                  const targetType = billingType === 'SUBSCRIPTION' ? 'PLAN' : row.targetType || 'PLAN';
                  return (
                    <div
                      key={field.key}
                      style={{
                        border: '1px solid var(--border-soft)',
                        borderRadius: 8,
                        padding: 12,
                        marginBottom: 12,
                        background: 'var(--bg-panel)',
                      }}
                    >
                      <Space size={12} align="baseline" style={{ display: 'flex', flexWrap: 'wrap' }}>
                        <Form.Item
                          name={[field.name, 'productId']}
                          label="产品"
                          rules={[{ required: true, message: '请选择产品' }]}
                          style={{ width: 160 }}
                        >
                          <Select
                            placeholder="选择产品"
                            options={products.map((product) => ({ value: product.id, label: product.name }))}
                            onChange={() => {
                              form.setFieldValue(['items', field.name, 'planId'], undefined);
                              form.setFieldValue(['items', field.name, 'boosterPackId'], undefined);
                            }}
                          />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'billingType']}
                          label="计费类型"
                          rules={[{ required: true }]}
                          style={{ width: 130 }}
                        >
                          <Select
                            options={[
                              { value: 'SUBSCRIPTION', label: '订阅续费' },
                              { value: 'ONE_TIME', label: '一次性' },
                            ]}
                            onChange={(value) => {
                              if (value === 'SUBSCRIPTION') {
                                form.setFieldValue(['items', field.name, 'targetType'], 'PLAN');
                                form.setFieldValue(['items', field.name, 'boosterPackId'], undefined);
                                form.setFieldValue(['items', field.name, 'recurringInterval'], 'year');
                              } else {
                                form.setFieldValue(['items', field.name, 'recurringInterval'], null);
                              }
                            }}
                          />
                        </Form.Item>
                        <Form.Item name={[field.name, 'targetType']} label="权益目标" style={{ width: 130 }}>
                          <Select
                            disabled={billingType === 'SUBSCRIPTION'}
                            options={[
                              { value: 'PLAN', label: '套餐权益' },
                              { value: 'BOOSTER_PACK', label: '加油包' },
                            ]}
                            onChange={() => {
                              form.setFieldValue(['items', field.name, 'planId'], undefined);
                              form.setFieldValue(['items', field.name, 'boosterPackId'], undefined);
                            }}
                          />
                        </Form.Item>
                        {targetType === 'BOOSTER_PACK' ? (
                          <Form.Item
                            name={[field.name, 'boosterPackId']}
                            label="加油包"
                            rules={[{ required: true, message: '请选择加油包' }]}
                            style={{ width: 240 }}
                          >
                            <Select showSearch optionFilterProp="label" options={packOptionsFor(row.productId)} />
                          </Form.Item>
                        ) : (
                          <Form.Item
                            name={[field.name, 'planId']}
                            label="套餐"
                            rules={[{ required: true, message: '请选择套餐' }]}
                            style={{ width: 240 }}
                          >
                            <Select showSearch optionFilterProp="label" options={planOptionsFor(row.productId)} />
                          </Form.Item>
                        )}
                        {billingType === 'SUBSCRIPTION' ? (
                          <Form.Item
                            name={[field.name, 'recurringInterval']}
                            label="续费周期"
                            rules={[{ required: true }]}
                            style={{ width: 120 }}
                          >
                            <Select
                              options={[
                                { value: 'month', label: '按月' },
                                { value: 'year', label: '按年' },
                              ]}
                            />
                          </Form.Item>
                        ) : null}
                      </Space>
                      <Space size={12} align="baseline" style={{ display: 'flex', flexWrap: 'wrap' }}>
                        <Form.Item name={[field.name, 'name']} label="展示名" style={{ width: 220 }}>
                          <Input placeholder="留空则使用套餐/加油包名" />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'unitAmountCents']}
                          label={`活动价（${minorUnitLabel}）`}
                          rules={[{ required: true, type: 'number', min: 1, message: '价格必须大于 0' }]}
                          style={{ width: 150 }}
                        >
                          <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item
                          name={[field.name, 'originalUnitAmountCents']}
                          label={`原价（${minorUnitLabel}）`}
                          rules={[{ type: 'number', min: 0 }]}
                          style={{ width: 150 }}
                        >
                          <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'quantity']} label="数量" style={{ width: 100 }}>
                          <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                        </Form.Item>
                        <Form.Item name={[field.name, 'validityDays']} label="有效期覆盖(天)" style={{ width: 150 }}>
                          <StableNumberInput min={0} precision={0} style={{ width: '100%' }} placeholder="不填用原套餐" />
                        </Form.Item>
                        <Button
                          danger
                          type="link"
                          icon={<DeleteOutlined />}
                          onClick={() => remove(field.name)}
                          disabled={fields.length <= 2}
                        >
                          删除明细
                        </Button>
                      </Space>
                    </div>
                  );
                })}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() =>
                    add({
                      targetType: 'PLAN',
                      billingType: 'ONE_TIME',
                      quantity: 1,
                      unitAmountCents: 0,
                      originalUnitAmountCents: 0,
                    })
                  }
                >
                  添加明细
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
