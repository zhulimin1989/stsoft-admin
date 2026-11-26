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
import { discountCodeApi, planApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';
import { warnNonCritical } from '../../utils/logging';

const DISCOUNT_TYPES = [
  { label: '百分比 %', value: 'percent_off' },
  { label: '固定金额', value: 'amount_off' },
];
const DURATION_OPTIONS = [
  { label: '仅首期', value: 'once' },
  { label: '持续 N 个月', value: 'repeating' },
  { label: '永久', value: 'forever' },
];
const SCOPE_OPTIONS = [
  { label: '所有用户', value: 'all' },
  { label: '仅新用户', value: 'new_users' },
  { label: '仅老用户', value: 'old_users' },
];
const CURRENCY_OPTIONS = [
  { label: 'USD', value: 'usd' },
  { label: 'SGD', value: 'sgd' },
  { label: 'CNY', value: 'cny' },
];

async function listPlansForDiscountCodes() {
  try {
    return await planApi.list();
  } catch (error: unknown) {
    warnNonCritical('DiscountCodes plan list preload', error);
    return [];
  }
}

function parsePlanIdsJson(planIdsJson: string | undefined, code: string): string[] {
  try {
    const value = JSON.parse(planIdsJson || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch (error: unknown) {
    warnNonCritical(`DiscountCodes invalid planIdsJson code=${code}`, error);
    return [];
  }
}

interface DiscountCode {
  id: string;
  code: string;
  name: string;
  description: string;
  discountType: 'percent_off' | 'amount_off';
  discountValue: number;
  currency: string | null;
  duration: 'once' | 'repeating' | 'forever';
  durationMonths: number | null;
  planIdsJson: string;
  firstTimeOnly: boolean;
  scope: string;
  maxUses: number;
  maxUsesPerUser: number;
  currentUses: number;
  startAt: string | null;
  endAt: string | null;
  stripeCouponId: string | null;
  isActive: boolean;
}

interface FormValues {
  code: string;
  name: string;
  description?: string;
  discountType: 'percent_off' | 'amount_off';
  discountValue: number;
  currency?: string;
  duration: 'once' | 'repeating' | 'forever';
  durationMonths?: number;
  planIds?: string[];
  firstTimeOnly: boolean;
  scope: string;
  maxUses: number;
  maxUsesPerUser: number;
  range?: [Dayjs, Dayjs];
}

export default function DiscountCodesPage() {
  const canManage = usePermission('admin.page.discount_codes.manage');
  const platformCurrency = usePlatformCurrency();
  const defaultCurrency = platformCurrency.toLowerCase();
  const [list, setList] = useState<DiscountCode[]>([]);
  const [plans, setPlans] = useState<
    Array<{
      id: string;
      name: string;
      product?: { id: string; name: string; slug: string } | null;
    }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<DiscountCode | null>(null);
  const [form] = Form.useForm<FormValues>();
  const selectedCurrency = Form.useWatch('currency', form) || defaultCurrency;
  const selectedMinorUnitLabel = currencyMinorUnitLabel(selectedCurrency);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<boolean | undefined>();
  const [endRange, setEndRange] = useState<[Dayjs, Dayjs] | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [items, planList] = await Promise.all([
        discountCodeApi.list(),
        listPlansForDiscountCodes(),
      ]);
      setList(items || []);
      setPlans(planList || []);
    } catch {
      message.error('加载失败');
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
          c.code.toLowerCase().includes(search.toLowerCase()) ||
          c.name.toLowerCase().includes(search.toLowerCase())
        )
      )
        return false;
      if (statusFilter !== undefined && c.isActive !== statusFilter)
        return false;
      if (endRange && c.endAt) {
        const end = dayjs(c.endAt);
        if (end.isBefore(endRange[0]) || end.isAfter(endRange[1])) return false;
      }
      return true;
    });
  }, [list, search, statusFilter, endRange]);

  const stats = useMemo(() => {
    const totalCodes = list.length;
    const totalGranted = list.reduce(
      (acc, c) => acc + (c.maxUses > 0 ? c.maxUses : 0),
      0,
    );
    const totalUsed = list.reduce((acc, c) => acc + c.currentUses, 0);
    const rate = totalGranted > 0 ? (totalUsed / totalGranted) * 100 : 0;
    return {
      totalCodes,
      totalGranted: totalGranted || '—',
      totalUsed,
      rate: totalGranted > 0 ? `${rate.toFixed(1)}%` : '—',
    };
  }, [list]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({
      discountType: 'percent_off',
      discountValue: 20,
      currency: defaultCurrency,
      duration: 'once',
      scope: 'all',
      firstTimeOnly: false,
      maxUses: 0,
      maxUsesPerUser: 1,
    });
    setModalOpen(true);
  };

  const openEdit = (row: DiscountCode) => {
    setEditing(row);
    const planIds = parsePlanIdsJson(row.planIdsJson, row.code);
    form.setFieldsValue({
      code: row.code,
      name: row.name,
      description: row.description,
      discountType: row.discountType,
      discountValue: row.discountValue,
      currency: row.currency ?? undefined,
      duration: row.duration,
      durationMonths: row.durationMonths ?? undefined,
      planIds,
      firstTimeOnly: row.firstTimeOnly,
      scope: row.scope,
      maxUses: row.maxUses,
      maxUsesPerUser: row.maxUsesPerUser,
      range:
        row.startAt && row.endAt ? [dayjs(row.startAt), dayjs(row.endAt)] : undefined,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const body: Record<string, unknown> = {
        code: values.code.toUpperCase(),
        name: values.name,
        description: values.description || '',
        discountType: values.discountType,
        discountValue: Math.round(values.discountValue),
        duration: values.duration,
        planIds: values.planIds ?? [],
        firstTimeOnly: values.firstTimeOnly,
        scope: values.scope,
        maxUses: values.maxUses,
        maxUsesPerUser: values.maxUsesPerUser,
      };
      if (values.discountType === 'amount_off') {
        body.currency = values.currency;
      }
      if (values.duration === 'repeating') {
        body.durationMonths = values.durationMonths;
      }
      if (values.range) {
        body.startAt = values.range[0].toISOString();
        body.endAt = values.range[1].toISOString();
      } else {
        body.startAt = null;
        body.endAt = null;
      }
      if (editing) {
        await discountCodeApi.update(editing.id, body);
        message.success('促销码已更新');
      } else {
        await discountCodeApi.create(body);
        message.success('促销码已创建，Stripe Coupon 已生成');
      }
      setModalOpen(false);
      fetchAll();
    } catch (err: unknown) {
      const e = err as {
        errorFields?: unknown;
        response?: { data?: { message?: string } };
        message?: string;
      };
      if (e?.errorFields) return;
      message.error(e?.response?.data?.message || e?.message || '保存失败');
    }
  };

  const handleDisable = async (row: DiscountCode) => {
    try {
      await discountCodeApi.disable(row.id);
      message.success('已禁用');
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
      title: '券码',
      dataIndex: 'code',
      key: 'code',
      render: (v: string) => (
        <span style={{ fontFamily: 'monospace', fontWeight: 500 }}>{v}</span>
      ),
    },
    {
      title: '适用 plan',
      key: 'plans',
      render: (_: unknown, r: DiscountCode) => {
        const ids = parsePlanIdsJson(r.planIdsJson, r.code);
        if (ids.length === 0)
          return <span style={{ color: 'var(--text-muted)' }}>全部</span>;
        return (
          <span style={{ fontSize: 12 }}>
            {ids.map(planLabel).join(', ')}
          </span>
        );
      },
    },
    {
      title: '折扣',
      key: 'discount',
      width: 140,
      render: (_: unknown, r: DiscountCode) =>
        r.discountType === 'percent_off'
          ? `${r.discountValue}% OFF`
          : `${r.currency?.toUpperCase() ?? platformCurrency} -${formatCurrencyCents(r.discountValue, r.currency ?? platformCurrency)}`,
    },
    {
      title: '兑换次数限制',
      key: 'limits',
      width: 130,
      render: (_: unknown, r: DiscountCode) => (
        <span style={{ fontSize: 12 }}>
          {r.maxUses > 0 ? `总 ${r.maxUses}` : '无限'} ·{' '}
          {r.maxUsesPerUser > 0 ? `${r.maxUsesPerUser}/人` : '人无限'}
        </span>
      ),
    },
    {
      title: '已兑换',
      dataIndex: 'currentUses',
      key: 'used',
      width: 100,
    },
    {
      title: '失效时间',
      dataIndex: 'endAt',
      key: 'endAt',
      width: 130,
      render: (v: string | null) =>
        v ? (
          dayjs(v).format('YYYY-MM-DD')
        ) : (
          <span style={{ color: 'var(--text-muted)' }}>无</span>
        ),
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (v: boolean) =>
        v ? (
          <Tag variant="success">启用</Tag>
        ) : (
          <Tag variant="muted">禁用</Tag>
        ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, r: DiscountCode) => (
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
              title="禁用后 Stripe Coupon 会被清理。确认？"
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
        title="促销码"
        subtitle="用户手动输入的促销码；创建时自动同步 Stripe Coupon。"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!canManage}
          >
            新建促销码
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="券总数" value={stats.totalCodes} />
        <StatCard label="已发放" value={stats.totalGranted} />
        <StatCard label="已兑换" value={stats.totalUsed} />
        <StatCard label="兑换率" value={stats.rate} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索 code / 名称',
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
              { label: '启用', value: true },
              { label: '禁用', value: false },
            ]}
          />,
          <DatePicker.RangePicker
            key="end"
            value={endRange}
            onChange={(v) => setEndRange(v as [Dayjs, Dayjs] | null)}
            style={{ minWidth: 240 }}
            placeholder={['失效时间起', '失效时间止']}
          />,
        ]}
      />

      <DataTable<DiscountCode>
        rowKey="id"
        columns={columns}
        dataSource={filteredList}
        loading={loading}
        pagination={{ pageSize: 20 }}
        scroll={{ x: 1100 }}
      />

      <Modal
        open={modalOpen}
        title={editing ? '编辑促销码' : '新建促销码'}
        destroyOnClose
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        okText="保存"
        okButtonProps={{ disabled: !canManage }}
        width={640}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Form.Item
            label="促销码（大写）"
            name="code"
            rules={[
              { required: true, message: '必填' },
              { pattern: /^[A-Z0-9_-]{3,32}$/i, message: '3-32 位字母数字' },
            ]}
          >
            <Input placeholder="SAVE20" disabled={!!editing} />
          </Form.Item>
          <Form.Item label="显示名" name="name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item label="说明" name="description">
            <Input.TextArea rows={2} />
          </Form.Item>

          <Space>
            <Form.Item
              label="折扣类型"
              name="discountType"
              rules={[{ required: true }]}
            >
              <Select style={{ width: 200 }} options={DISCOUNT_TYPES} />
            </Form.Item>
            <Form.Item
              label="折扣值"
              name="discountValue"
              rules={[{ required: true }]}
              tooltip={`percent_off: 1~99；amount_off: ${selectedMinorUnitLabel}`}
            >
              <StableNumberInput min={1} max={99999999} precision={0} style={{ width: 160 }} />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) =>
                prev.discountType !== cur.discountType
              }
            >
              {({ getFieldValue }) =>
                getFieldValue('discountType') === 'amount_off' ? (
                  <Form.Item
                    label="币种"
                    name="currency"
                    rules={[{ required: true }]}
                  >
                    <Select style={{ width: 120 }} options={CURRENCY_OPTIONS} />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </Space>

          <Space>
            <Form.Item
              label="时长"
              name="duration"
              rules={[{ required: true }]}
            >
              <Select style={{ width: 160 }} options={DURATION_OPTIONS} />
            </Form.Item>
            <Form.Item
              noStyle
              shouldUpdate={(prev, cur) => prev.duration !== cur.duration}
            >
              {({ getFieldValue }) =>
                getFieldValue('duration') === 'repeating' ? (
                  <Form.Item
                    label="月数"
                    name="durationMonths"
                    rules={[{ required: true }]}
                  >
                    <StableNumberInput min={1} max={36} precision={0} />
                  </Form.Item>
                ) : null
              }
            </Form.Item>
          </Space>

          <Form.Item label="适用套餐（空=全部）" name="planIds">
            <Select
              mode="multiple"
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="不选则全部套餐可用"
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
          <Space>
            <Form.Item label="范围" name="scope" rules={[{ required: true }]}>
              <Select style={{ width: 160 }} options={SCOPE_OPTIONS} />
            </Form.Item>
            <Form.Item
              label="仅首次购买"
              name="firstTimeOnly"
              valuePropName="checked"
            >
              <Switch />
            </Form.Item>
          </Space>

          <Space>
            <Form.Item label="全局限次 (0=无限)" name="maxUses">
              <StableNumberInput min={0} precision={0} />
            </Form.Item>
            <Form.Item label="每人限次 (0=无限)" name="maxUsesPerUser">
              <StableNumberInput min={0} precision={0} />
            </Form.Item>
          </Space>
          <Form.Item label="生效时间范围（可选）" name="range">
            <DatePicker.RangePicker showTime style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
