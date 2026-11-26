import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  message,
} from 'antd';
import {
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  StableNumberInput,
  Tag,
  EmptyPlaceholder,
} from '../../components/common';
import { boosterPackApi, productApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';

interface BoosterPack {
  id: string;
  name: string;
  productId: string;
  product?: { id: string; name: string };
  creditsAmount: number;
  priceCents: number;
  isActive: boolean;
  sortOrder: number;
  createdAt: string;
  validityDays?: number;
  totalSales?: number;
  totalRevenueCents?: number;
}

interface Product {
  id: string;
  name: string;
  slug: string;
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'active', label: '启用' },
  { value: 'inactive', label: '停用' },
];

export default function BoosterPacksPage() {
  const canManage = usePermission('admin.page.subscription_booster_packs.manage');
  const platformCurrency = usePlatformCurrency();
  const [data, setData] = useState<BoosterPack[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm();

  const [search, setSearch] = useState('');
  const [productFilter, setProductFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [bpRes, prodRes] = await Promise.all([
        boosterPackApi.list(),
        productApi.list(),
      ]);
      setData(bpRes.items || bpRes || []);
      setProducts(prodRes.items || prodRes || []);
    } catch {
      message.error('加载加油包列表失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const productMap = useMemo(
    () => new Map(products.map((p) => [p.id, p.name])),
    [products],
  );
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const formatMoney = useCallback(
    (cents: number | null | undefined): string =>
      formatCurrencyCents(cents, platformCurrency, { emptyText: '—' }),
    [platformCurrency],
  );

  const filtered = useMemo(() => {
    return data.filter((p) => {
      if (search && !p.name.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      if (productFilter !== 'all' && p.productId !== productFilter) return false;
      if (statusFilter === 'active' && !p.isActive) return false;
      if (statusFilter === 'inactive' && p.isActive) return false;
      return true;
    });
  }, [data, search, productFilter, statusFilter]);

  const stats = useMemo(() => {
    const total = data.length;
    const totalRevenueCents = data.reduce(
      (acc, r) => acc + (r.totalRevenueCents ?? 0),
      0,
    );
    const sales30d = data.reduce((acc, r) => acc + (r.totalSales ?? 0), 0);
    const top = [...data]
      .filter((r) => (r.totalSales ?? 0) > 0)
      .sort((a, b) => (b.totalSales ?? 0) - (a.totalSales ?? 0))[0];
    return {
      total,
      totalRevenue: totalRevenueCents > 0 ? formatMoney(totalRevenueCents) : '—',
      sales30d: sales30d > 0 ? sales30d : '—',
      topName: top?.name ?? '—',
    };
  }, [data, formatMoney]);

  const handleCreate = () => {
    setEditingId(null);
    form.resetFields();
    form.setFieldsValue({ isActive: true, sortOrder: 0 });
    setModalOpen(true);
  };

  const handleEdit = (record: BoosterPack) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      productId: record.productId,
      creditsAmount: record.creditsAmount,
      priceCents: record.priceCents,
      isActive: record.isActive,
      sortOrder: record.sortOrder,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    setSaving(true);
    try {
      if (editingId) {
        await boosterPackApi.update(editingId, values);
        message.success('加油包更新成功');
      } else {
        await boosterPackApi.create(values);
        message.success('加油包创建成功');
      }
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      fetchData();
    } catch {
      message.error(editingId ? '更新失败' : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await boosterPackApi.delete(id);
      message.success('删除成功');
      fetchData();
    } catch {
      message.error('删除失败');
    }
  };

  const columns = [
    {
      title: '名称',
      dataIndex: 'name',
      key: 'name',
      render: (name: string) => <span style={{ fontWeight: 500 }}>{name}</span>,
    },
    {
      title: '适用产品',
      key: 'product',
      width: 140,
      render: (_: unknown, record: BoosterPack) => {
        const name =
          record.product?.name || productMap.get(record.productId) || '-';
        return <Tag variant="muted">{name}</Tag>;
      },
    },
    {
      title: '积分数',
      dataIndex: 'creditsAmount',
      key: 'creditsAmount',
      width: 110,
      render: (v: number) => v?.toLocaleString() ?? '-',
    },
    {
      title: '售价',
      dataIndex: 'priceCents',
      key: 'priceCents',
      width: 100,
      render: (v: number) => formatMoney(v),
    },
    {
      title: '有效期(天)',
      key: 'validityDays',
      width: 110,
      render: (_: unknown, r: BoosterPack) =>
        r.validityDays != null ? `${r.validityDays} 天` : '—',
    },
    {
      title: '销售总数',
      key: 'totalSales',
      width: 100,
      render: (_: unknown, r: BoosterPack) =>
        r.totalSales != null ? r.totalSales.toLocaleString() : '—',
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 80,
      render: (active: boolean) => (
        <Tag variant={active ? 'success' : 'muted'}>
          {active ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 160,
      align: 'right' as const,
      render: (_: unknown, record: BoosterPack) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<EditOutlined />}
            onClick={() => handleEdit(record)}
            disabled={!canManage}
          >
            编辑
          </Button>
          <Popconfirm
            title="确定删除此加油包？"
            onConfirm={() => handleDelete(record.id)}
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
        title="加油包"
        subtitle="管理各产品的加油包，用户可购买补充积分"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleCreate}
            disabled={!canManage}
          >
            新建加油包
          </Button>,
        ]}
      />

      <StatCardGroup columns={4}>
        <StatCard label="加油包总数" value={stats.total} />
        <StatCard label="总销售额" value={stats.totalRevenue} />
        <StatCard label="30 天销售数" value={stats.sales30d} />
        <StatCard label="Top 销售款" value={stats.topName} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索加油包名',
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
          title="暂无加油包"
          description={
            data.length === 0
              ? '尚未创建任何加油包。点击右上角新建。'
              : '当前筛选下没有匹配的加油包。'
          }
        />
      ) : (
        <DataTable<BoosterPack>
          columns={columns}
          dataSource={filtered}
          rowKey="id"
          loading={loading}
          pagination={false}
          scroll={{ x: 1000 }}
        />
      )}

      <Modal
        title={editingId ? '编辑加油包' : '新建加油包'}
        open={modalOpen}
        onOk={handleSave}
        onCancel={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        okText={editingId ? '保存' : '创建'}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ disabled: !canManage }}
        width={520}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }} disabled={!canManage}>
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '请输入加油包名称' }]}
          >
            <Input placeholder="例如：100积分加油包" />
          </Form.Item>
          <Form.Item
            name="productId"
            label="所属产品"
            rules={[{ required: true, message: '请选择所属产品' }]}
          >
            <Select
              placeholder="选择产品"
              options={products.map((p) => ({ value: p.id, label: p.name }))}
            />
          </Form.Item>
          <Space size={16} style={{ width: '100%' }}>
            <Form.Item
              name="creditsAmount"
              label="积分数"
              rules={[{ required: true, message: '请输入积分数' }]}
              style={{ flex: 1 }}
            >
              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} placeholder="如 10000" />
            </Form.Item>
            <Form.Item
              name="priceCents"
              label={`价格 (${minorUnitLabel})`}
              rules={[{ required: true, message: '请输入价格' }]}
              style={{ flex: 1 }}
              help={`如 990 = ${formatMoney(990)}`}
            >
              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} placeholder="如 990" />
            </Form.Item>
          </Space>
          <Space size={16}>
            <Form.Item name="sortOrder" label="排序" initialValue={0}>
              <StableNumberInput min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item
              name="isActive"
              label="状态"
              valuePropName="checked"
              initialValue={true}
            >
              <Switch checkedChildren="启用" unCheckedChildren="停用" />
            </Form.Item>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
