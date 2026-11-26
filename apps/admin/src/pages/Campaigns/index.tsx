import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Modal,
  Form,
  Input,
  Select,
  Space,
  Switch,
  DatePicker,
  Popconfirm,
  Typography,
  message,
} from 'antd';
import { PlusOutlined, DeleteOutlined, EditOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  StableNumberInput,
  Tag,
} from '../../components/common';
import { campaignApi, planApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, currencySymbol, normalizeCurrency } from '../../utils/price';
import { warnNonCritical } from '../../utils/logging';

const SCOPE_LABEL: Record<string, string> = {
  all: '所有用户',
  new_users: '仅新用户',
  old_users: '仅老用户',
};

const BILLING_PERIOD_LABEL: Record<string, string> = {
  monthly: '月付',
  quarterly: '季付',
  yearly: '年付',
  both: '月付 + 年付',
  all: '月付 + 季付 + 年付',
};

/**
 * 某计费周期需要哪些价格项——required 规则、字段 disabled、提交归零、列表展示四处共用，避免口径漂移。
 * 月付价：monthly/both/all；季付价：quarterly/all；年付价：yearly/both/all。
 * period 未定或未知值 → 三项都要（保旧行为，避免异常值导致列表/表单展示残缺）。
 */
const KNOWN_BILLING_PERIODS = ['monthly', 'quarterly', 'yearly', 'both', 'all'];
function periodPriceNeeds(period: string | null | undefined): {
  monthly: boolean;
  quarterly: boolean;
  yearly: boolean;
} {
  if (period == null || !KNOWN_BILLING_PERIODS.includes(period)) {
    return { monthly: true, quarterly: true, yearly: true };
  }
  return {
    monthly: ['monthly', 'both', 'all'].includes(period),
    quarterly: ['quarterly', 'all'].includes(period),
    yearly: ['yearly', 'both', 'all'].includes(period),
  };
}

const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'usd' },
  { label: 'SGD', value: 'sgd' },
  { label: 'CNY', value: 'cny' },
];

/**
 * 活动价/省额按币种最小单位（分）存储。展示用「自然小数」（最多 2 位、去尾零）：
 * 990→¥9.9、1000→¥10、3900→¥39——避免按整数四舍五入把 ¥9.90 误显成 ¥10。
 */
function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return '—';
  const amount = cents / 100;
  const formatted = amount.toLocaleString('zh-CN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${currencySymbol(normalizeCurrency(currency))}${formatted}`;
}

interface Campaign {
  id: string;
  name: string;
  description: string;
  scope: string;
  firstTimeOnly: boolean;
  billingPeriod: string;
  startAt: string;
  endAt: string;
  maxUsesPerUser: number;
  maxUsesTotal: number;
  priority: number;
  isActive: boolean;
  planId: string | null;
  prices?: Array<{ currency: string; monthlyPrice: number; quarterlyPrice?: number; yearlyPrice: number }>;
}

interface PriceRow {
  currency: string;
  monthlyPrice: number;
  quarterlyPrice: number;
  yearlyPrice: number;
}

interface FormValues {
  name: string;
  description?: string;
  planId: string;
  scope: string;
  firstTimeOnly: boolean;
  billingPeriod: string;
  range: [Dayjs, Dayjs];
  maxUsesPerUser: number;
  maxUsesTotal: number;
  priority: number;
  prices: PriceRow[];
}

export default function CampaignsPage() {
  const canManage = usePermission('admin.page.campaigns.manage');
  const platformCurrency = usePlatformCurrency();
  const defaultCurrency = platformCurrency.toLowerCase();
  const [list, setList] = useState<Campaign[]>([]);
  const [plans, setPlans] = useState<
    Array<{
      id: string;
      name: string;
      product?: { id: string; name: string; slug: string } | null;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [form] = Form.useForm<FormValues>();
  const watchedPrices = Form.useWatch('prices', form) as PriceRow[] | undefined;
  // 各价格项是否「按所选周期」必填/可填——避免「仅月付」活动被季/年价必填卡住保存。
  const watchedPeriod = Form.useWatch('billingPeriod', form) as string | undefined;
  const priceNeeds = periodPriceNeeds(watchedPeriod);
  const [stats, setStats] = useState<
    Record<string, { uses: number; amountSavedCents: number }>
  >({});
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<boolean | undefined>();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [items, planList] = await Promise.all([
        campaignApi.list(),
        planApi.list().catch((error: unknown) => {
          warnNonCritical('Campaigns plan preload', error);
          return [];
        }),
      ]);
      setList(items || []);
      setPlans(planList || []);
      const statsResults = await Promise.all(
        (items || []).map(async (c: Campaign) => {
          try {
            const s = await campaignApi.stats(c.id);
            return [c.id, s] as const;
          } catch (error: unknown) {
            warnNonCritical(`Campaigns stats preload campaign=${c.id}`, error);
            return [c.id, { uses: 0, amountSavedCents: 0 }] as const;
          }
        }),
      );
      setStats(Object.fromEntries(statsResults));
    } catch {
      message.error('加载活动列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filteredList = useMemo(() => {
    return list.filter((c) => {
      if (
        search &&
        !(
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.description?.toLowerCase().includes(search.toLowerCase())
        )
      )
        return false;
      if (statusFilter !== undefined && c.isActive !== statusFilter) return false;
      if (range) {
        const start = dayjs(c.startAt);
        const end = dayjs(c.endAt);
        if (end.isBefore(range[0]) || start.isAfter(range[1])) return false;
      }
      return true;
    });
  }, [list, search, statusFilter, range]);

  const aggStats = useMemo(() => {
    const totalCampaigns = list.length;
    const active = list.filter((c) => {
      const now = dayjs();
      return (
        c.isActive &&
        dayjs(c.startAt).isBefore(now) &&
        dayjs(c.endAt).isAfter(now)
      );
    }).length;
    let totalUses = 0;
    let totalSaved = 0;
    for (const c of list) {
      const s = stats[c.id];
      if (s) {
        totalUses += s.uses;
        totalSaved += s.amountSavedCents;
      }
    }
    return {
      totalCampaigns,
      active,
      totalUses,
      totalSaved,
    };
  }, [list, stats]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      scope: 'all',
      firstTimeOnly: false,
      billingPeriod: 'both',
      maxUsesPerUser: 1,
      maxUsesTotal: 0,
      priority: 0,
      prices: [{ currency: defaultCurrency, monthlyPrice: 0, quarterlyPrice: 0, yearlyPrice: 0 }],
    });
    setModalOpen(true);
  };

  const openEdit = (row: Campaign) => {
    setEditing(row);
    form.setFieldsValue({
      name: row.name,
      description: row.description,
      planId: row.planId || '',
      scope: row.scope,
      firstTimeOnly: row.firstTimeOnly,
      billingPeriod: row.billingPeriod,
      range: [dayjs(row.startAt), dayjs(row.endAt)],
      maxUsesPerUser: row.maxUsesPerUser,
      maxUsesTotal: row.maxUsesTotal,
      priority: row.priority,
      prices: (row.prices ?? []).map((p) => ({
        currency: p.currency,
        monthlyPrice: p.monthlyPrice,
        quarterlyPrice: p.quarterlyPrice ?? p.monthlyPrice,
        yearlyPrice: p.yearlyPrice,
      })),
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const [startAt, endAt] = values.range;
      const body = {
        name: values.name,
        description: values.description || '',
        planId: values.planId,
        scope: values.scope,
        firstTimeOnly: values.firstTimeOnly,
        billingPeriod: values.billingPeriod,
        startAt: startAt.toISOString(),
        endAt: endAt.toISOString(),
        maxUsesPerUser: values.maxUsesPerUser,
        maxUsesTotal: values.maxUsesTotal,
        priority: values.priority,
        // 按周期显式归零非适用价格项（不依赖 disabled/空值兜底），避免「仅月付」活动仍存季/年旧价。
        prices: (values.prices || []).map((p) => {
          const needs = periodPriceNeeds(values.billingPeriod);
          return {
            currency: p.currency.toLowerCase(),
            monthlyPrice: needs.monthly ? Math.round(p.monthlyPrice ?? 0) : 0,
            quarterlyPrice: needs.quarterly ? Math.round(p.quarterlyPrice ?? 0) : 0,
            yearlyPrice: needs.yearly ? Math.round(p.yearlyPrice ?? 0) : 0,
          };
        }),
      };
      if (editing) {
        await campaignApi.update(editing.id, body);
        message.success('活动已更新（Stripe Coupon 已同步）');
      } else {
        await campaignApi.create(body);
        message.success('活动已创建（Stripe Coupon 已自动生成）');
      }
      setModalOpen(false);
      fetchAll();
    } catch (err: unknown) {
      const e = err as {
        errorFields?: Array<{ name: (string | number)[] }>;
        response?: { data?: { message?: string } };
        message?: string;
      };
      // 校验失败：以前在此静默 return → 用户「点保存无响应」。改为给出提示并定位首个错误项。
      if (e?.errorFields?.length) {
        message.warning('请检查表单：有必填项未填写或不合法');
        form.scrollToField(e.errorFields[0].name, { behavior: 'smooth', block: 'center' });
        return;
      }
      message.error(e?.response?.data?.message || e?.message || '保存失败');
    }
  };

  const handleDisable = async (row: Campaign) => {
    try {
      await campaignApi.disable(row.id);
      message.success('活动已禁用，对应 Stripe Coupon 已清理');
      fetchAll();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      message.error(e?.response?.data?.message || '禁用失败');
    }
  };

  const planLabel = (id: string | null) => {
    const p = plans.find((x) => x.id === id);
    if (!p) return '—';
    const prodName = p.product?.name;
    return prodName ? `${prodName} / ${p.name}` : p.name;
  };

  const columns = [
    {
      title: '活动名',
      dataIndex: 'name',
      key: 'name',
      render: (v: string) => <span style={{ fontWeight: 500 }}>{v}</span>,
    },
    {
      title: '适用 plan',
      dataIndex: 'planId',
      key: 'planId',
      render: (id: string | null) => planLabel(id),
    },
    {
      title: '折扣详情',
      key: 'discount',
      render: (_: unknown, r: Campaign) => {
        if (!r.prices || r.prices.length === 0) return '—';
        // 只展示该活动「周期」覆盖的价格段，避免未选周期显示 ¥0 误导（与编辑表单同口径）。
        const needs = periodPriceNeeds(r.billingPeriod);
        return (
          <span style={{ fontSize: 12 }}>
            {r.prices
              .map((p) => {
                const segs: string[] = [];
                if (needs.monthly) segs.push(`月 ${formatMoney(p.monthlyPrice, p.currency)}`);
                if (needs.quarterly) segs.push(`季均 ${formatMoney(p.quarterlyPrice ?? p.monthlyPrice, p.currency)}`);
                if (needs.yearly) segs.push(`年均 ${formatMoney(p.yearlyPrice, p.currency)}`);
                return `${p.currency.toUpperCase()} ${segs.join(' / ')}`;
              })
              .join(' · ')}
          </span>
        );
      },
    },
    {
      title: '时间区间',
      key: 'time',
      width: 200,
      render: (_: unknown, r: Campaign) => (
        <span style={{ fontSize: 12 }}>
          {dayjs(r.startAt).format('MM-DD HH:mm')} ~{' '}
          {dayjs(r.endAt).format('MM-DD HH:mm')}
        </span>
      ),
    },
    {
      title: '兑换数',
      key: 'uses',
      width: 140,
      render: (_: unknown, r: Campaign) => {
        const s = stats[r.id];
        if (!s) return '—';
        return (
          <span>
            {s.uses} 次 · 省 {formatMoney(s.amountSavedCents, defaultCurrency)}
          </span>
        );
      },
    },
    {
      title: '范围',
      dataIndex: 'scope',
      key: 'scope',
      width: 100,
      render: (s: string) => <Tag>{SCOPE_LABEL[s] ?? s}</Tag>,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (v: boolean) =>
        v ? (
          <Tag variant="success">生效中</Tag>
        ) : (
          <Tag variant="muted">已禁用</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, r: Campaign) => (
        <Space size={4}>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
            disabled={!canManage}
            type="link"
          >
            编辑
          </Button>
          {r.isActive && (
            <Popconfirm
              title="禁用后 Stripe Coupon 会被清理，已下的订单不受影响。确认禁用？"
              onConfirm={() => handleDisable(r)}
            >
              <Button
                size="small"
                danger
                icon={<DeleteOutlined />}
                disabled={!canManage}
                type="link"
              >
                禁用
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="限时活动"
        subtitle="运营配置的限时一口价活动；每个币种 + 周期组合自动创建 Stripe Coupon (duration=once)，多活动命中时取最便宜。"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!canManage}
          >
            新建活动
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="活动数" value={aggStats.totalCampaigns} />
        <StatCard label="进行中" value={aggStats.active} />
        <StatCard label="累计兑换" value={aggStats.totalUses} />
        <StatCard
          label="总让利金额"
          value={formatMoney(aggStats.totalSaved, defaultCurrency)}
        />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索活动名 / 说明',
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="status"
            placeholder="状态"
            allowClear
            style={{ minWidth: 120 }}
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { label: '生效中', value: true },
              { label: '已禁用', value: false },
            ]}
          />,
          <DatePicker.RangePicker
            key="range"
            value={range}
            onChange={(v) => setRange(v as [Dayjs, Dayjs] | null)}
            style={{ minWidth: 240 }}
          />,
        ]}
      />

      <DataTable<Campaign>
        rowKey="id"
        columns={columns}
        dataSource={filteredList}
        loading={loading}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1100 }}
      />

      <Modal
        open={modalOpen}
        title={editing ? '编辑活动' : '新建活动'}
        width={720}
        destroyOnClose
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText="保存（将同步 Stripe Coupon）"
        okButtonProps={{ disabled: !canManage }}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            label="活动名"
            name="name"
            rules={[{ required: true, message: '必填' }]}
          >
            <Input placeholder="黑五限时 50% OFF" />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item
            label="绑定套餐"
            name="planId"
            rules={[{ required: true }]}
          >
            <Select
              placeholder="选择套餐"
              showSearch
              optionFilterProp="label"
              options={(() => {
                const groups = new Map<
                  string,
                  {
                    productName: string;
                    options: Array<{ label: string; value: string }>;
                  }
                >();
                for (const p of plans) {
                  const key = p.product?.id ?? '__none__';
                  const productName = p.product?.name ?? '未归属产品';
                  if (!groups.has(key))
                    groups.set(key, { productName, options: [] });
                  groups.get(key)!.options.push({
                    label: `${productName} / ${p.name}`,
                    value: p.id,
                  });
                }
                return Array.from(groups.values()).map((g) => ({
                  label: g.productName,
                  title: g.productName,
                  options: g.options,
                }));
              })()}
            />
          </Form.Item>
          <Space style={{ width: '100%' }} size="large">
            <Form.Item
              label="适用范围"
              name="scope"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 160 }}
                options={Object.entries(SCOPE_LABEL).map(([v, l]) => ({
                  value: v,
                  label: l,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="周期"
              name="billingPeriod"
              rules={[{ required: true }]}
            >
              <Select
                style={{ width: 160 }}
                options={Object.entries(BILLING_PERIOD_LABEL).map(([v, l]) => ({
                  value: v,
                  label: l,
                }))}
              />
            </Form.Item>
            <Form.Item
              label="仅首次购买"
              name="firstTimeOnly"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item
            label="活动时间"
            name="range"
            rules={[{ required: true, message: '必选' }]}
          >
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
          <Space size="large">
            <Form.Item label="每人限次 (0=无限)" name="maxUsesPerUser">
              <StableNumberInput min={0} precision={0} />
            </Form.Item>
            <Form.Item label="全局限次 (0=无限)" name="maxUsesTotal">
              <StableNumberInput min={0} precision={0} />
            </Form.Item>
            <Form.Item label="优先级" name="priority">
              <StableNumberInput min={0} precision={0} />
            </Form.Item>
          </Space>

          <Typography.Title level={5}>活动价（按币种最小单位）</Typography.Title>
          <Form.List name="prices">
            {(fields, { add, remove }) => (
              <>
                {fields.map((field) => {
                  const rowCurrency = watchedPrices?.[field.name]?.currency ?? defaultCurrency;
                  const rowMinorUnitLabel = currencyMinorUnitLabel(rowCurrency);
                  return (
                    <Space
                      key={field.key}
                      align="baseline"
                      style={{ display: 'flex', marginBottom: 8 }}
                    >
                      <Form.Item
                        {...field}
                        name={[field.name, 'currency']}
                        rules={[{ required: true }]}
                      >
                        <Select
                          style={{ width: 120 }}
                          options={CURRENCY_OPTIONS}
                          placeholder="币种"
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'monthlyPrice']}
                        rules={[{ required: priceNeeds.monthly, message: '必填' }]}
                      >
                        <StableNumberInput
                          min={0}
                          precision={0}
                          disabled={!priceNeeds.monthly}
                          placeholder={`月付价（${rowMinorUnitLabel}）`}
                          style={{ width: 180 }}
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'quarterlyPrice']}
                        rules={[{ required: priceNeeds.quarterly, message: '必填' }]}
                      >
                        <StableNumberInput
                          min={0}
                          precision={0}
                          disabled={!priceNeeds.quarterly}
                          placeholder={`季付月均（${rowMinorUnitLabel}）`}
                          style={{ width: 180 }}
                        />
                      </Form.Item>
                      <Form.Item
                        {...field}
                        name={[field.name, 'yearlyPrice']}
                        rules={[{ required: priceNeeds.yearly, message: '必填' }]}
                      >
                        <StableNumberInput
                          min={0}
                          precision={0}
                          disabled={!priceNeeds.yearly}
                          placeholder={`年付月均（${rowMinorUnitLabel}）`}
                          style={{ width: 180 }}
                        />
                      </Form.Item>
                      <Button
                        danger
                        type="link"
                        onClick={() => remove(field.name)}
                      >
                        删除
                      </Button>
                    </Space>
                  );
                })}
                <Button
                  type="dashed"
                  onClick={() =>
                    add({ currency: defaultCurrency, monthlyPrice: 0, quarterlyPrice: 0, yearlyPrice: 0 })
                  }
                  icon={<PlusOutlined />}
                  block
                >
                  添加币种
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      </Modal>
    </div>
  );
}
