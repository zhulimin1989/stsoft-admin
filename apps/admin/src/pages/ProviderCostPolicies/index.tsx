import { useEffect, useMemo, useState } from 'react';
import {
  App,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, StopOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { DataTable, PageHeader, StableNumberInput } from '../../components/common';
import {
  codingPlanAdminApi,
  modelPricingApi,
  productApi,
  providerCostPolicyApi,
  type CodingPlanProviderLine,
  type ProviderCostPolicy,
  type ProviderCostPolicyInput,
} from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatModelUnitPrice } from '../../utils/price';
import { usePermission } from '../../hooks/usePermission';

interface ProductRow {
  id: string;
  name: string;
  slug?: string;
  billingMode?: string;
}

interface ModelRow {
  modelName?: string;
  name?: string;
  provider?: string | null;
  inputPricePerMToken?: number | string | null;
  input_price_per_m_token?: number | string | null;
  cachedInputPrice?: number | string | null;
  cached_input_price_cents?: number | string | null;
  cacheWrite5minPrice?: number | string | null;
  cache_write_5min_price_cents?: number | string | null;
  cacheWrite1hPrice?: number | string | null;
  cache_write_1h_price_cents?: number | string | null;
  outputPricePerMToken?: number | string | null;
  output_price_per_m_token?: number | string | null;
}

interface PolicyFormValues {
  productId?: string | null;
  providerCode: string;
  providerLineId?: string | null;
  modelName: string;
  priceMultiplier: number;
  startsAt?: dayjs.Dayjs | null;
  endsAt?: dayjs.Dayjs | null;
  priority?: number;
  isActive: boolean;
  description?: string | null;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  const items = record.items;
  return Array.isArray(items) ? (items as T[]) : [];
}

function modelNameOf(row: ModelRow): string {
  return row.modelName || row.name || '';
}

function decimalNumber(value: string | number | null | undefined, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function nullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function formatDate(value?: string | null, emptyText = '长期'): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : emptyText;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  return (error as { response?: { data?: { message?: string } } })?.response?.data?.message
    || (error instanceof Error ? error.message : fallback);
}

type CostBucket = 'input' | 'cached' | 'cacheWrite' | 'output';

const COST_BUCKETS: CostBucket[] = ['input', 'cached', 'cacheWrite', 'output'];
const COST_BUCKET_LABEL: Record<CostBucket, string> = {
  input: 'input',
  cached: 'cached',
  cacheWrite: 'write',
  output: 'output',
};
const POLICY_COST_FIELD: Record<CostBucket, keyof Pick<
  ProviderCostPolicy,
  'inputCostUsdPerM' | 'cachedInputCostUsdPerM' | 'cacheWriteCostUsdPerM' | 'outputCostUsdPerM'
>> = {
  input: 'inputCostUsdPerM',
  cached: 'cachedInputCostUsdPerM',
  cacheWrite: 'cacheWriteCostUsdPerM',
  output: 'outputCostUsdPerM',
};

function modelBaseCost(model: ModelRow | undefined, bucket: CostBucket): number | null {
  if (!model) return null;
  const input = nullableNumber(model.inputPricePerMToken ?? model.input_price_per_m_token) ?? 0;
  if (bucket === 'input') return input;
  if (bucket === 'cached') {
    return nullableNumber(model.cachedInputPrice ?? model.cached_input_price_cents) ?? input;
  }
  if (bucket === 'cacheWrite') {
    return nullableNumber(
      model.cacheWrite5minPrice ??
        model.cache_write_5min_price_cents ??
        model.cacheWrite1hPrice ??
        model.cache_write_1h_price_cents,
    ) ?? input;
  }
  return nullableNumber(model.outputPricePerMToken ?? model.output_price_per_m_token) ?? 0;
}

function multipliedCost(model: ModelRow | undefined, bucket: CostBucket, multiplier: number): number | null {
  const base = modelBaseCost(model, bucket);
  return base == null ? null : base * multiplier;
}

function CostTags({
  prices,
  currency,
}: {
  prices: Record<CostBucket, number | null>;
  currency: string;
}) {
  return (
    <Space size={[8, 6]} wrap>
      {COST_BUCKETS.map((bucket) => (
        <Tag key={bucket}>
          {COST_BUCKET_LABEL[bucket]} {formatModelUnitPrice(prices[bucket], currency)}
        </Tag>
      ))}
    </Space>
  );
}

export default function ProviderCostPoliciesPage() {
  const canManage = usePermission('admin.page.provider_cost_policies.manage');
  const { message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [providerLines, setProviderLines] = useState<CodingPlanProviderLine[]>([]);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [items, setItems] = useState<ProviderCostPolicy[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [filters, setFilters] = useState<{ providerCode?: string; modelName?: string; activeOnly: boolean }>({
    activeOnly: true,
  });
  const [form] = Form.useForm<PolicyFormValues>();
  const selectedProviderCode = Form.useWatch('providerCode', form);
  const selectedModelName = Form.useWatch('modelName', form);
  const selectedPriceMultiplier = Form.useWatch('priceMultiplier', form);

  const modelByName = useMemo(() => {
    const map = new Map<string, ModelRow>();
    for (const model of models) {
      const name = modelNameOf(model);
      if (name && !map.has(name)) map.set(name, model);
    }
    return map;
  }, [models]);

  const selectedModel = selectedModelName ? modelByName.get(selectedModelName) : undefined;
  const selectedMultiplier = decimalNumber(selectedPriceMultiplier, 1);

  const providerOptions = useMemo(() => {
    const providers = new Set<string>();
    for (const line of providerLines) {
      if (line.providerCode) providers.add(line.providerCode);
    }
    for (const model of models) {
      if (model.provider) providers.add(model.provider);
    }
    return Array.from(providers)
      .sort((a, b) => a.localeCompare(b))
      .map((provider) => ({ value: provider, label: provider }));
  }, [models, providerLines]);

  const modelOptions = useMemo(() => {
    return Array.from(modelByName.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, model]) => ({
        value: name,
        label: model.provider ? `${name} · ${model.provider}` : name,
      }));
  }, [modelByName]);

  const selectedBaseCosts = useMemo(() => ({
    input: modelBaseCost(selectedModel, 'input'),
    cached: modelBaseCost(selectedModel, 'cached'),
    cacheWrite: modelBaseCost(selectedModel, 'cacheWrite'),
    output: modelBaseCost(selectedModel, 'output'),
  }), [selectedModel]);

  const selectedEffectiveCosts = useMemo(() => ({
    input: multipliedCost(selectedModel, 'input', selectedMultiplier),
    cached: multipliedCost(selectedModel, 'cached', selectedMultiplier),
    cacheWrite: multipliedCost(selectedModel, 'cacheWrite', selectedMultiplier),
    output: multipliedCost(selectedModel, 'output', selectedMultiplier),
  }), [selectedModel, selectedMultiplier]);

  const productOptions = useMemo(() => products.map((product) => ({
    value: product.id,
    label: `${product.name}${product.billingMode ? ` (${product.billingMode})` : ''}`,
  })), [products]);

  const providerLineOptions = useMemo(() => {
    return providerLines
      .filter((line) => !selectedProviderCode || line.providerCode === selectedProviderCode)
      .map((line) => ({
        value: line.id,
        label: `${line.name || line.code} (${line.providerCode})`,
      }));
  }, [providerLines, selectedProviderCode]);

  const loadPolicies = async () => {
    setLoading(true);
    try {
      const data = await providerCostPolicyApi.list({
        providerCode: filters.providerCode,
        modelName: filters.modelName,
        activeOnly: filters.activeOnly,
      });
      setItems(data);
    } catch (err: unknown) {
      const apiMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '供应商成本策略加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void Promise.all([
      productApi.list().then((res) => setProducts(asArray<ProductRow>(res))),
      codingPlanAdminApi.providerLines().then(setProviderLines),
      modelPricingApi.list().then((res) => setModels(asArray<ModelRow>(res))),
    ]).catch((error: unknown) => {
      const apiMsg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '基础数据加载失败');
    });
  }, [message]);

  useEffect(() => {
    void loadPolicies();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.providerCode, filters.modelName, filters.activeOnly]);

  const openCreate = () => {
    const filteredModel = filters.modelName ? modelByName.get(filters.modelName) : undefined;
    form.resetFields();
    form.setFieldsValue({
      modelName: filters.modelName,
      providerCode: filteredModel?.provider || filters.providerCode,
      priceMultiplier: 1,
      priority: 0,
      startsAt: dayjs(),
      endsAt: null,
      isActive: true,
      description: '',
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload: ProviderCostPolicyInput = {
        productId: values.productId || null,
        providerCode: values.providerCode,
        providerLineId: values.providerLineId || null,
        modelName: values.modelName,
        priceMultiplier: values.priceMultiplier ?? 1,
        inputCostUsdPerM: null,
        cachedInputCostUsdPerM: null,
        cacheWriteCostUsdPerM: null,
        outputCostUsdPerM: null,
        startsAt: values.startsAt ? values.startsAt.toISOString() : dayjs().toISOString(),
        endsAt: values.endsAt ? values.endsAt.toISOString() : null,
        priority: values.priority ?? 0,
        isActive: values.isActive,
        description: values.description?.trim() || null,
      };
      await providerCostPolicyApi.create(payload);
      message.success('成本版本已创建');
      setModalOpen(false);
      await loadPolicies();
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      const apiMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '保存失败');
    }
  };

  const deactivate = async (policy: ProviderCostPolicy) => {
    try {
      await providerCostPolicyApi.deactivate(policy.id);
      message.success('已停用');
      await loadPolicies();
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '停用失败'));
    }
  };

  const deletePolicy = async (policy: ProviderCostPolicy) => {
    try {
      await providerCostPolicyApi.delete(policy.id);
      message.success('已删除');
      await loadPolicies();
    } catch (error: unknown) {
      message.error(apiErrorMessage(error, '删除失败'));
    }
  };

  const policyEffectiveCosts = (record: ProviderCostPolicy): Record<CostBucket, number | null> => {
    const model = modelByName.get(record.modelName);
    const multiplier = decimalNumber(record.priceMultiplier, 1);
    return COST_BUCKETS.reduce((acc, bucket) => {
      acc[bucket] = nullableNumber(record[POLICY_COST_FIELD[bucket]]) ?? multipliedCost(model, bucket, multiplier);
      return acc;
    }, {} as Record<CostBucket, number | null>);
  };

  const columns = [
    {
      title: '供应商',
      dataIndex: 'providerCode',
      width: 130,
      render: (value: string) => <Tag color="blue">{value}</Tag>,
    },
    {
      title: '线路 / 产品',
      key: 'scope',
      width: 220,
      render: (_: unknown, record: ProviderCostPolicy) => (
        <div>
          <div>{record.providerLine?.name || record.providerLine?.code || '全部线路'}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
            {record.product?.name || '全局成本'}
          </div>
        </div>
      ),
    },
    {
      title: '模型',
      dataIndex: 'modelName',
      width: 220,
      ellipsis: true,
    },
    {
      title: '成本倍率',
      dataIndex: 'priceMultiplier',
      width: 110,
      render: (value: string) => `${decimalNumber(value, 1).toFixed(4)}x`,
    },
    {
      title: '生效成本',
      key: 'costs',
      width: 360,
      render: (_: unknown, record: ProviderCostPolicy) => (
        <CostTags prices={policyEffectiveCosts(record)} currency={platformCurrency} />
      ),
    },
    {
      title: '生效区间',
      key: 'period',
      width: 280,
      render: (_: unknown, record: ProviderCostPolicy) => (
        <span>
          {formatDate(record.startsAt, '立即')} ~ {formatDate(record.endsAt)}
        </span>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 90,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      width: 90,
      render: (value: boolean) => (value ? <Tag color="green">启用</Tag> : <Tag>停用</Tag>),
    },
    {
      title: '说明',
      dataIndex: 'description',
      ellipsis: true,
    },
    {
      title: '操作',
      key: 'actions',
      width: 170,
      align: 'right' as const,
      render: (_: unknown, record: ProviderCostPolicy) => (
        <Space size={4}>
          <Popconfirm
            title="停用该成本版本?"
            okText="停用"
            cancelText="取消"
            onConfirm={() => deactivate(record)}
            disabled={!canManage || !record.isActive}
          >
            <Button type="link" size="small" danger icon={<StopOutlined />} disabled={!canManage || !record.isActive}>
              停用
            </Button>
          </Popconfirm>
          <Popconfirm
            title="删除该成本版本?"
            description="已有用量记录引用的版本不能删除，请改用停用。"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => deletePolicy(record)}
          >
            <Button type="link" size="small" danger icon={<DeleteOutlined />} disabled={!canManage}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="供应商成本"
        subtitle="按供应商、模型、产品和时间维护上游成本折扣"
        actions={[
          <Button key="reload" icon={<ReloadOutlined />} onClick={loadPolicies}>
            刷新
          </Button>,
          <Button key="new" type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>
            新建成本版本
          </Button>,
        ]}
      />

      <Card>
        <Space size={12} wrap style={{ marginBottom: 16 }}>
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="供应商"
            style={{ width: 180 }}
            value={filters.providerCode}
            options={providerOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, providerCode: value }))}
          />
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder="模型"
            style={{ width: 260 }}
            value={filters.modelName}
            options={modelOptions}
            onChange={(value) => setFilters((prev) => ({ ...prev, modelName: value }))}
          />
          <Switch
            checked={filters.activeOnly}
            checkedChildren="仅启用"
            unCheckedChildren="全部"
            onChange={(value) => setFilters((prev) => ({ ...prev, activeOnly: value }))}
          />
        </Space>

        <DataTable<ProviderCostPolicy>
          rowKey="id"
          loading={loading}
          dataSource={items}
          columns={columns}
          searchable
          searchPlaceholder="搜索模型 / Provider / 描述"
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1600 }}
        />
      </Card>

      <Modal
        title="新建供应商成本版本"
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={submit}
        destroyOnHidden
        okButtonProps={{ disabled: !canManage }}
        width={760}
      >
        <Form form={form} layout="vertical" disabled={!canManage}>
          <Space align="start" wrap>
            <Form.Item name="modelName" label="模型" rules={[{ required: true, message: '请选择模型' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: 320 }}
                options={modelOptions}
                onChange={(modelName) => {
                  const model = modelByName.get(modelName);
                  form.setFieldsValue({
                    providerCode: model?.provider || form.getFieldValue('providerCode'),
                    providerLineId: null,
                  });
                }}
              />
            </Form.Item>
            <Form.Item name="providerCode" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
              <Select
                showSearch
                optionFilterProp="label"
                style={{ width: 220 }}
                options={providerOptions}
                onChange={() => form.setFieldValue('providerLineId', null)}
              />
            </Form.Item>
            <Form.Item name="providerLineId" label="供应商线路">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 240 }}
                options={providerLineOptions}
                onChange={(lineId) => {
                  const line = providerLines.find((item) => item.id === lineId);
                  if (line?.providerCode) form.setFieldsValue({ providerCode: line.providerCode });
                }}
              />
            </Form.Item>
          </Space>

          <Space align="start" wrap>
            <Form.Item name="productId" label="产品">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 240 }}
                options={productOptions}
              />
            </Form.Item>
            <Form.Item name="priceMultiplier" label="成本倍率" rules={[{ required: true, message: '请输入成本倍率' }]}>
              <StableNumberInput min={0} max={100} precision={4} step={0.05} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="priority" label="优先级">
              <StableNumberInput precision={0} style={{ width: 120 }} />
            </Form.Item>
          </Space>

          <Space align="start" wrap>
            <Form.Item label="模型基准价">
              <CostTags prices={selectedBaseCosts} currency={platformCurrency} />
            </Form.Item>
            <Form.Item label="预计生效成本">
              <CostTags prices={selectedEffectiveCosts} currency={platformCurrency} />
            </Form.Item>
          </Space>

          <Space align="start" wrap>
            <Form.Item name="startsAt" label="开始时间" rules={[{ required: true, message: '请选择开始时间' }]}>
              <DatePicker showTime allowClear={false} style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="endsAt" label="结束时间">
              <DatePicker showTime allowClear style={{ width: 220 }} />
            </Form.Item>
            <Form.Item name="isActive" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item name="description" label="说明">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
