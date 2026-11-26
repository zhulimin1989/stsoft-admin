import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Form,
  Input,
  Popconfirm,
  Radio,
  Select,
  Space,
  Switch,
  DatePicker,
  message,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  DetailDrawer,
  EmptyPlaceholder,
  StableNumberInput,
} from '../../components/common';
import {
  rechargeTierApi,
  type RechargeTier,
  type RechargeTierProduct,
} from '../../api/v2';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';

type ProductRow = RechargeTierProduct;

const getNextSortOrder = (rows: RechargeTier[]) => {
  if (rows.length === 0) return 0;
  return Math.max(...rows.map((row) => row.sortOrder ?? 0)) + 10;
};

interface FormValues {
  productId: string;
  amountCents: number;
  bonusType: 'FIXED' | 'PERCENT';
  bonusValue: number;
  badge?: string;
  sortOrder: number;
  isActive: boolean;
  range?: [dayjs.Dayjs, dayjs.Dayjs];
}

export default function RechargeTiersPage() {
  const canManage = usePermission('admin.page.recharge_tiers.manage');
  const platformCurrency = usePlatformCurrency();
  const [items, setItems] = useState<RechargeTier[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [productsLoading, setProductsLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [productFilter, setProductFilter] = useState<string | undefined>();
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>();
  const [editing, setEditing] = useState<RechargeTier | null>(null);
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const formatMoney = useCallback(
    (cents: number | null | undefined, fractionDigits = 2): string =>
      formatCurrencyCents(cents, platformCurrency, { fractionDigits }),
    [platformCurrency],
  );

  const fetchList = async () => {
    setLoading(true);
    try {
      const res = await rechargeTierApi.list({
        productId: productFilter,
        isActive: activeFilter,
      });
      setItems(res.items || []);
    } catch {
      message.error('加载充值面额失败');
    } finally {
      setLoading(false);
    }
  };

  const fetchProducts = async () => {
    setProductsLoading(true);
    try {
      const res = await rechargeTierApi.products();
      setProducts(res.items ?? []);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as { message?: string })?.message;
      message.error(apiMsg ?? '加载按量产品失败');
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
  }, []);

  useEffect(() => {
    fetchList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productFilter, activeFilter]);

  const stats = useMemo(() => {
    return {
      total: items.length,
      total30d: '—',
      topName:
        items.length > 0
          ? formatMoney(items[0].amountCents, 0)
          : '—',
    };
  }, [formatMoney, items]);

  const productLabel = (id: string) =>
    products.find((p) => p.id === id)?.name ?? id;

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    form.resetFields();
    form.setFieldsValue({
      productId: products[0]?.id,
      bonusType: 'FIXED',
      bonusValue: 0,
      sortOrder: getNextSortOrder(items),
      isActive: true,
      amountCents: 1000,
    });
  };

  const openEdit = (row: RechargeTier) => {
    setEditing(row);
    setCreating(false);
    form.setFieldsValue({
      productId: row.productId,
      amountCents: row.amountCents,
      bonusType: row.bonusType,
      bonusValue: row.bonusValue,
      badge: row.badge ?? undefined,
      sortOrder: row.sortOrder,
      isActive: row.isActive,
      range:
        row.startAt && row.endAt
          ? [dayjs(row.startAt), dayjs(row.endAt)]
          : undefined,
    });
  };

  const handleSubmit = async () => {
    if (!editing && products.length === 0) {
      message.warning('请先创建并启用一个按量产品，再配置充值面额');
      return;
    }
    setSaving(true);
    try {
      const values = await form.validateFields();
      const body: Partial<RechargeTier> & {
        startAt?: string | null;
        endAt?: string | null;
      } = {
        productId: values.productId,
        amountCents: Math.round(values.amountCents),
        bonusType: values.bonusType,
        bonusValue: Math.round(values.bonusValue),
        badge: values.badge?.trim() ? values.badge.trim() : null,
        sortOrder: values.sortOrder ?? 0,
        isActive: values.isActive,
        // null on update clears the window; undefined on create means "no window"
        startAt: values.range ? values.range[0].toISOString() : null,
        endAt: values.range ? values.range[1].toISOString() : null,
      };
      const result = editing
        ? await rechargeTierApi.update(editing.id, body)
        : await rechargeTierApi.create(body);
      message.success(editing ? '已更新' : '已创建');
      if (result.overlapWarning) {
        message.warning(result.overlapWarning);
      }
      setEditing(null);
      setCreating(false);
      fetchList();
    } catch (err: unknown) {
      const errorFields = (err as { errorFields?: Array<{ name: string[] }> })
        ?.errorFields;
      if (errorFields) {
        const firstError = errorFields[0]?.name;
        if (firstError) form.scrollToField(firstError);
        message.warning('请先完善必填项');
        return;
      }
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as { message?: string })?.message;
      message.error(apiMsg ?? '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (row: RechargeTier, val: boolean) => {
    try {
      await rechargeTierApi.update(row.id, { isActive: val });
      message.success(val ? '已启用' : '已停用');
      fetchList();
    } catch {
      message.error('操作失败');
    }
  };

  const handleCopy = async (row: RechargeTier) => {
    try {
      await rechargeTierApi.clone(row.id);
      message.success('已复制');
      fetchList();
    } catch {
      message.error('复制失败');
    }
  };

  const handleDelete = async (row: RechargeTier) => {
    try {
      await rechargeTierApi.delete(row.id);
      message.success('已删除');
      fetchList();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '面额',
      key: 'amount',
      width: 120,
      render: (_: unknown, r: RechargeTier) => (
        <span style={{ fontWeight: 500 }}>
          {formatMoney(r.amountCents)}
        </span>
      ),
    },
    {
      title: '适用产品',
      dataIndex: 'productId',
      key: 'productId',
      render: (id: string) => productLabel(id),
    },
    {
      title: '赠送',
      key: 'bonus',
      width: 140,
      render: (_: unknown, r: RechargeTier) =>
        r.bonusType === 'FIXED'
          ? `+${formatMoney(r.bonusValue)}`
          : `+${r.bonusValue}%`,
    },
    {
      title: 'Badge',
      dataIndex: 'badge',
      key: 'badge',
      width: 120,
      render: (v?: string | null) =>
        v ? <span>{v}</span> : <span style={{ color: 'var(--text-muted)' }}>—</span>,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 90,
      sorter: (a: RechargeTier, b: RechargeTier) => a.sortOrder - b.sortOrder,
    },
    {
      title: '启停',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (v: boolean, r: RechargeTier) => (
        <Switch checked={v} size="small" disabled={!canManage} onChange={(b) => handleToggle(r, b)} />
      ),
    },
    {
      title: '限时区间',
      key: 'window',
      width: 220,
      render: (_: unknown, r: RechargeTier) => {
        if (!r.startAt || !r.endAt) {
          return <span style={{ color: 'var(--text-muted)' }}>长期</span>;
        }
        return (
          <span style={{ fontSize: 12 }}>
            {dayjs(r.startAt).format('YYYY-MM-DD HH:mm')}
            <br />
            {dayjs(r.endAt).format('YYYY-MM-DD HH:mm')}
          </span>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 240,
      align: 'right' as const,
      render: (_: unknown, r: RechargeTier) => (
        <Space size={4}>
          <Button type="link" size="small" disabled={!canManage} onClick={() => openEdit(r)}>
            详情
          </Button>
          <Button type="link" size="small" disabled={!canManage} onClick={() => handleCopy(r)}>
            复制
          </Button>
          <Popconfirm
            title="软删除该面额?"
            description="删除后将不再展示给用户，可在数据库恢复。"
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
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

  const drawerOpen = !!editing || creating;
  const drawerTitle = editing
    ? `编辑面额 ${formatMoney(editing.amountCents, 0)}`
    : '新建面额';

  return (
    <div>
      <PageHeader
        title="充值面额"
        subtitle="按量产品的预付充值方案 + 赠送策略"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCreate}
            disabled={!canManage}
          >
            新建面额
          </Button>,
        ]}
      />

      <StatCardGroup columns={3}>
        <StatCard label="面额总数" value={stats.total} />
        <StatCard label="30 天总充值额" value={stats.total30d} />
        <StatCard label="Top 销售面额" value={stats.topName} />
      </StatCardGroup>

      <FilterBar
        filters={[
          <Select
            key="product"
            placeholder="产品"
            allowClear
            style={{ minWidth: 180 }}
            value={productFilter}
            onChange={setProductFilter}
            options={products.map((p) => ({ label: p.name, value: p.id }))}
          />,
          <Select
            key="active"
            placeholder="状态"
            allowClear
            style={{ minWidth: 140 }}
            value={activeFilter}
            onChange={setActiveFilter}
            options={[
              { label: '启用', value: true },
              { label: '停用', value: false },
            ]}
          />,
        ]}
      />

      {items.length === 0 && !loading ? (
        <EmptyPlaceholder
          title="暂无充值面额"
          description="尚未创建任何面额。点击右上角新建。"
        />
      ) : (
        <DataTable<RechargeTier>
          columns={columns}
          dataSource={items}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 1100 }}
        />
      )}

      <DetailDrawer
        open={drawerOpen}
        onClose={() => {
          setEditing(null);
          setCreating(false);
        }}
        title={drawerTitle}
        width={520}
        actions={
          <Space>
            <Button
              onClick={() => {
                setEditing(null);
                setCreating(false);
              }}
            >
              取消
            </Button>
            <Button type="primary" loading={saving} disabled={!canManage} onClick={handleSubmit}>
              保存
            </Button>
          </Space>
        }
        tabs={[
          {
            key: 'form',
            label: '配置',
            content: (
              <Form form={form} layout="vertical" disabled={!canManage}>
                {products.length === 0 && !productsLoading && (
                  <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="暂无可用按量产品"
                    description="充值面额必须绑定到启用状态的 PAY_AS_YOU_GO 产品。请先在产品中心创建并启用按量产品。"
                  />
                )}
                <Form.Item
                  label="适用产品"
                  name="productId"
                  rules={[{ required: true, message: '必选' }]}
                >
                  <Select
                    placeholder="选择产品"
                    loading={productsLoading}
                    options={products.map((p) => ({
                      label: p.name,
                      value: p.id,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  label={`面额（${minorUnitLabel}）`}
                  name="amountCents"
                  rules={[{ required: true, type: 'number', min: 1 }]}
                  tooltip={`单位为${minorUnitLabel}，${formatMoney(1000)} = 1000`}
                >
                  <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="赠送类型" name="bonusType" rules={[{ required: true }]}>
                  <Radio.Group>
                    <Radio value="FIXED">{`固定金额（${minorUnitLabel}）`}</Radio>
                    <Radio value="PERCENT">百分比 %</Radio>
                  </Radio.Group>
                </Form.Item>
                <Form.Item
                  noStyle
                  shouldUpdate={(prev, cur) => prev.bonusType !== cur.bonusType}
                >
                  {({ getFieldValue }) => {
                    const isFixed = getFieldValue('bonusType') === 'FIXED';
                    return (
                      <Form.Item
                        label={isFixed ? `赠送金额（${minorUnitLabel}）` : '赠送比例（%）'}
                        name="bonusValue"
                        tooltip={
                          isFixed
                            ? `单位是${minorUnitLabel}，1000 表示赠送 ${formatMoney(1000)}`
                            : '百分比 0-100，20 表示充值额外赠送 20%'
                        }
                        rules={[
                          { required: true, type: 'number', min: 0 },
                          ...(!isFixed
                            ? [{ type: 'number' as const, max: 100, message: '不得超过 100%' }]
                            : []),
                        ]}
                      >
                        <StableNumberInput
                          min={0}
                          max={isFixed ? undefined : 100}
                          style={{ width: '100%' }}
                          addonAfter={isFixed ? minorUnitLabel : '%'}
                        />
                      </Form.Item>
                    );
                  }}
                </Form.Item>
                <Form.Item
                  label="Badge（如“最受欢迎”）"
                  name="badge"
                  rules={[{ max: 32, message: '不得超过 32 个字符' }]}
                >
                  <Input placeholder="可选" maxLength={32} showCount />
                </Form.Item>
                <Form.Item label="排序" name="sortOrder">
                  <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
                </Form.Item>
                <Form.Item label="启用" name="isActive" valuePropName="checked">
                  <Switch />
                </Form.Item>
                <Form.Item label="限时区间（可选）" name="range">
                  <DatePicker.RangePicker showTime style={{ width: '100%' }} />
                </Form.Item>
              </Form>
            ),
          },
        ]}
      />
    </div>
  );
}
