import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  DatePicker,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import { DeleteOutlined, PlusOutlined, ReloadOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons';
import { ModelTierPrices, buildDisplayPriceTiers } from '../../components/ModelTierPrices';
import dayjs from 'dayjs';
import {
  DataTable,
  EmptyPlaceholder,
  FilterBar,
  PageHeader,
  StableNumberInput,
} from '../../components/common';
import {
  paygModelPricingApi,
  productApi,
  type PaygModelCandidateItem,
  type PaygModelPricingItem,
} from '../../api/admin';
import { useCurrentProduct } from '../../hooks/useCurrentProduct';
import { usePermission } from '../../hooks/usePermission';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { formatModelUnitPrice } from '../../utils/price';
import './PaygPricing.css';

interface ProductRow {
  id: string;
  name: string;
  slug?: string;
  billingMode?: 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
  isActive?: boolean;
}

interface Draft {
  priceMultiplier: number;
  input: number | null;
  cached: number | null;
  cacheWrite: number | null;
  output: number | null;
  startsAt: string;
  endsAt: string | null;
  isActive: boolean;
  description: string;
}

type PriceBucket = 'input' | 'cached' | 'cacheWrite' | 'output';

const BUCKET_LABELS: Record<PriceBucket, string> = {
  input: 'input',
  cached: 'cached',
  cacheWrite: 'cache write',
  output: 'output',
};

const STATUS_LABELS: Record<string, { label: string; color?: string }> = {
  ACTIVE: { label: '已授权', color: 'green' },
  SUSPENDED: { label: '已暂停', color: 'orange' },
  RETIRED: { label: '已移出' },
};

function policyToDraft(row: PaygModelPricingItem): Draft {
  return {
    priceMultiplier: row.policy?.priceMultiplier ?? 1,
    input: row.policy?.input ?? null,
    cached: row.policy?.cached ?? null,
    cacheWrite: row.policy?.cacheWrite ?? null,
    output: row.policy?.output ?? null,
    startsAt: dayjs().toISOString(),
    endsAt: null,
    isActive: row.policy?.isActive ?? true,
    description: '',
  };
}

function formatPeriod(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt) return '未配置';
  const start = dayjs(startsAt).format('YYYY-MM-DD HH:mm');
  const end = endsAt ? dayjs(endsAt).format('YYYY-MM-DD HH:mm') : '长期';
  return `${start} ~ ${end}`;
}

const LEGACY_OVERRIDE_BUCKETS: PriceBucket[] = ['input', 'cached', 'cacheWrite', 'output'];

/**
 * 历史遗留的绝对覆盖价（机制已废除）。命中即整卡降级为告警态，不展示任何价格。
 * 后端在当前价格投影层已给出 `pricingReason=LEGACY_OVERRIDE_DETECTED` 并把 effective 置空，
 * 这里以它为准，再以策略行字段作为兜底（旧版后端未返回该字段时仍能拦住）。
 */
function hasLegacyOverride(row: PaygModelPricingItem): boolean {
  if ((row as { pricingReason?: string | null }).pricingReason === 'LEGACY_OVERRIDE_DETECTED') {
    return true;
  }
  const policy = row.policy as unknown as Record<string, number | null> | undefined;
  if (!policy) return false;
  return LEGACY_OVERRIDE_BUCKETS.some((bucket) => policy[bucket] != null);
}

function availabilityStatusTag(row: PaygModelPricingItem) {
  const status = row.availability?.status ?? 'ACTIVE';
  const config = STATUS_LABELS[status] ?? { label: status };
  return <Tag color={config.color}>{config.label}</Tag>;
}

function PriceStrip({
  prices,
  currency,
  emptyBase,
}: {
  prices: Record<PriceBucket, number | null | undefined>;
  currency: string;
  emptyBase?: string;
}) {
  return (
    <div className="payg-price-strip">
      {(Object.keys(BUCKET_LABELS) as PriceBucket[]).map((key) => (
        <span key={key} className="payg-price-chip">
          <span className="payg-price-label">{BUCKET_LABELS[key]}</span>
          <span className="payg-price-value">
            {formatModelUnitPrice(prices[key], currency, { emptyText: emptyBase ?? '-' })}
          </span>
        </span>
      ))}
    </div>
  );
}

export default function PaygPricingPage() {
  const canManage = usePermission('admin.page.payg_pricing.manage');
  const { message } = App.useApp();
  const currentProductId = useCurrentProduct();
  const platformCurrency = usePlatformCurrency();
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [productId, setProductId] = useState<string | undefined>();
  const [rows, setRows] = useState<PaygModelPricingItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [candidateOpen, setCandidateOpen] = useState(false);
  const [candidateRows, setCandidateRows] = useState<PaygModelCandidateItem[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [selectedCandidates, setSelectedCandidates] = useState<string[]>([]);
  const [addingModels, setAddingModels] = useState(false);

  useEffect(() => {
    let cancelled = false;
    productApi
      .list()
      .then((res) => {
        if (cancelled) return;
        const raw: ProductRow[] = Array.isArray(res) ? res : res?.items ?? [];
        const paygProducts = raw.filter(
          (product) => product.billingMode === 'PAY_AS_YOU_GO' && product.isActive !== false,
        );
        setProducts(paygProducts);
        const current = paygProducts.find((product) => product.id === currentProductId);
        setProductId((prev) => prev ?? current?.id ?? paygProducts[0]?.id);
      })
      .catch(() => {
        if (!cancelled) message.error('加载按量产品失败');
      });
    return () => {
      cancelled = true;
    };
  }, [currentProductId, message]);

  useEffect(() => {
    const current = products.find((product) => product.id === currentProductId);
    if (current) setProductId(current.id);
  }, [currentProductId, products]);

  const loadRows = async (pid: string) => {
    setLoading(true);
    try {
      const res = await paygModelPricingApi.list(pid);
      const items = res.items ?? [];
      setRows(items);
      setDrafts(Object.fromEntries(items.map((row) => [row.modelName, policyToDraft(row)])));
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '加载产品模型授权失败');
      setRows([]);
      setDrafts({});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (productId) {
      void loadRows(productId);
    } else {
      setRows([]);
      setDrafts({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => (
      row.modelName.toLowerCase().includes(q) ||
      (row.provider ?? '').toLowerCase().includes(q)
    ));
  }, [rows, search]);

  const stats = useMemo(() => {
    const apiAvailable = rows.filter((row) => row.availability?.active).length;
    const visible = rows.filter((row) => row.availability?.visible).length;
    const configured = rows.filter((row) => row.policy).length;
    return { total: rows.length, apiAvailable, visible, configured };
  }, [rows]);

  const updateDraft = (modelName: string, patch: Partial<Draft>) => {
    setDrafts((prev) => ({
      ...prev,
      [modelName]: {
        ...(prev[modelName] ?? {
          priceMultiplier: 1,
          input: null,
          cached: null,
          cacheWrite: null,
          output: null,
          startsAt: dayjs().toISOString(),
          endsAt: null,
          isActive: true,
          description: '',
        }),
        ...patch,
      },
    }));
  };

  const handleSave = async (row: PaygModelPricingItem) => {
    if (!productId) return;
    const draft = drafts[row.modelName] ?? policyToDraft(row);
    setSavingKey(`price:${row.modelName}`);
    try {
      await paygModelPricingApi.createVersion({
        productId,
        modelName: row.modelName,
        priceMultiplier: draft.priceMultiplier ?? 1,
        // 绝对覆盖价已废除：请求体完全不带这四个字段（后端也会拒绝非 null 值）
        startsAt: draft.startsAt || dayjs().toISOString(),
        endsAt: draft.endsAt,
        isActive: draft.isActive,
        description: draft.description?.trim() || null,
      });
      message.success('已保存新版本');
      await loadRows(productId);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '保存失败');
    } finally {
      setSavingKey(null);
    }
  };

  const handleReset = async (row: PaygModelPricingItem) => {
    if (!productId) return;
    setSavingKey(`price:${row.modelName}`);
    try {
      await paygModelPricingApi.createVersion({
        productId,
        modelName: row.modelName,
        priceMultiplier: 1,
        startsAt: dayjs().toISOString(),
        endsAt: null,
        isActive: true,
        description: 'reset to base price',
      });
      message.success('已创建基础价版本');
      await loadRows(productId);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '重置失败');
    } finally {
      setSavingKey(null);
    }
  };

  const handleAvailabilityUpdate = async (
    row: PaygModelPricingItem,
    patch: Parameters<typeof paygModelPricingApi.updateProductModel>[1],
  ) => {
    if (!productId || !row.availability?.id) return;
    setSavingKey(`availability:${row.availability.id}`);
    try {
      await paygModelPricingApi.updateProductModel(row.availability.id, patch);
      message.success('授权已更新');
      await loadRows(productId);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '更新授权失败');
    } finally {
      setSavingKey(null);
    }
  };

  const handleRetire = async (row: PaygModelPricingItem) => {
    if (!productId || !row.availability?.id) return;
    setSavingKey(`retire:${row.availability.id}`);
    try {
      await paygModelPricingApi.retireProductModel(row.availability.id);
      message.success('已移出产品');
      await loadRows(productId);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '移出失败');
    } finally {
      setSavingKey(null);
    }
  };

  const openCandidateModal = async () => {
    if (!productId) return;
    setCandidateOpen(true);
    setCandidateLoading(true);
    setSelectedCandidates([]);
    try {
      const res = await paygModelPricingApi.candidates(productId);
      setCandidateRows(res.items ?? []);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '加载模型库失败');
      setCandidateRows([]);
    } finally {
      setCandidateLoading(false);
    }
  };

  const handleAddModels = async () => {
    if (!productId || selectedCandidates.length === 0) return;
    setAddingModels(true);
    try {
      await paygModelPricingApi.addModels({ productId, modelNames: selectedCandidates });
      message.success('模型已加入产品');
      setCandidateOpen(false);
      setCandidateRows([]);
      setSelectedCandidates([]);
      await loadRows(productId);
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '新增模型失败');
    } finally {
      setAddingModels(false);
    }
  };

  const columns = [
    {
      title: '模型',
      key: 'model',
      fixed: 'left' as const,
      width: 230,
      render: (_: unknown, row: PaygModelPricingItem) => (
        <div className="payg-model-cell">
          <div className="payg-model-name">{row.modelName}</div>
          <div className="payg-model-meta">
            {row.provider ?? 'unknown'}
          </div>
        </div>
      ),
    },
    {
      title: '产品授权',
      key: 'availability',
      width: 250,
      render: (_: unknown, row: PaygModelPricingItem) => {
        const availability = row.availability;
        const saving = availability ? savingKey === `availability:${availability.id}` : false;
        const apiChecked = availability?.status === 'ACTIVE' && availability.apiEnabled;
        return (
          <div className="payg-availability-cell">
            <Space size={6} wrap>
              {availabilityStatusTag(row)}
              {row.modelActive === false && <Tag color="red">模型库停用</Tag>}
              {availability?.active ? <Tag color="blue">可调用</Tag> : <Tag>不可调用</Tag>}
            </Space>
            <Space size={16} wrap>
              <span className="payg-switch-line">
                <span>API</span>
                <Switch
                  size="small"
                  loading={saving}
                  checked={apiChecked}
                  disabled={!canManage || !availability?.id || row.modelActive === false}
                  onChange={(checked) => handleAvailabilityUpdate(row, checked
                    ? { status: 'ACTIVE', apiEnabled: true }
                    : { apiEnabled: false })}
                />
              </span>
              <span className="payg-switch-line">
                <span>展示</span>
                <Switch
                  size="small"
                  loading={saving}
                  checked={availability?.visible === true}
                  disabled={!canManage || !availability?.id}
                  onChange={(checked) => handleAvailabilityUpdate(row, { visible: checked })}
                />
              </span>
            </Space>
          </div>
        );
      },
    },
    {
      title: '基础价',
      key: 'base',
      width: 330,
      render: (_: unknown, row: PaygModelPricingItem) => (
        <PriceStrip prices={row.base} currency={platformCurrency} />
      ),
    },
    {
      title: '价格覆盖',
      key: 'policy',
      width: 560,
      render: (_: unknown, row: PaygModelPricingItem) => {
        const draft = drafts[row.modelName] ?? policyToDraft(row);
        return (
          <div className="payg-policy-cell">
            <Space size={12} align="center" wrap>
              <Tooltip title="生效价 = 基础价 × 倍率（绝对覆盖价已废除）">
                <StableNumberInput
                  min={0}
                  max={100}
                  step={0.05}
                  precision={4}
                  value={draft.priceMultiplier}
                  addonBefore="倍率"
                  className="payg-multiplier-input"
                  disabled={!canManage}
                  onChange={(value) => updateDraft(row.modelName, { priceMultiplier: value ?? 1 })}
                />
              </Tooltip>
              <Switch
                size="small"
                checked={draft.isActive}
                checkedChildren="覆盖"
                unCheckedChildren="停用"
                disabled={!canManage}
                onChange={(value) => updateDraft(row.modelName, { isActive: value })}
              />
              {row.policy ? (
                <Tag color={row.policy.isActive ? 'green' : undefined}>
                  {formatPeriod(row.policy.startsAt, row.policy.endsAt)}
                </Tag>
              ) : (
                <Tag>基础价</Tag>
              )}
              {(row.policies?.length ?? 0) > 0 && <Tag>{row.policies?.length} 个版本</Tag>}
            </Space>
            <div className="payg-version-grid">
              <DatePicker
                showTime
                allowClear={false}
                value={draft.startsAt ? dayjs(draft.startsAt) : dayjs()}
                placeholder="开始时间"
                onChange={(value) => updateDraft(row.modelName, { startsAt: (value ?? dayjs()).toISOString() })}
              />
              <DatePicker
                showTime
                allowClear
                value={draft.endsAt ? dayjs(draft.endsAt) : null}
                placeholder="结束时间"
                onChange={(value) => updateDraft(row.modelName, { endsAt: value ? value.toISOString() : null })}
              />
              <Input
                allowClear
                value={draft.description}
                placeholder="版本说明"
                onChange={(event) => updateDraft(row.modelName, { description: event.target.value })}
              />
            </div>
          </div>
        );
      },
    },
    {
      title: '各档生效价',
      key: 'effective',
      width: 360,
      render: (_: unknown, row: PaygModelPricingItem) => {
        const draft = drafts[row.modelName] ?? policyToDraft(row);
        if (hasLegacyOverride(row)) {
          // fail-closed：检测到已废除的绝对覆盖价，不展示任何价格（不得按倍率伪造与实际扣费不符的价）
          return (
            <Alert
              type="error"
              showIcon
              message="LEGACY_OVERRIDE_DETECTED"
              description="该模型的按量策略仍带已废除的绝对覆盖价，价格展示已停用，请联系运维清理该策略行后再查看。"
            />
          );
        }
        // 草稿倍率：未启用策略时按 1（与既有 effectivePrice 口径一致）。
        const draftMultiplier = draft.isActive ? draft.priceMultiplier ?? 1 : 1;
        // 已保存倍率：用于判断"倍率是否被改动"——未改动就用后端算好的生效价
        // （与计费同规则），改动了才现算，避免展示价与实际扣费口径漂移。
        const persistedMultiplier = row.policy?.priceMultiplier ?? 1;
        const tiers = buildDisplayPriceTiers({
          tiers: row.tiers ?? null,
          fallbackPricing: row.fallbackPricing ?? null,
          base: row.base,
          effective: row.effective,
        });
        if (tiers.length === 0) {
          return <span style={{ color: '#999' }}>—</span>;
        }
        return (
          <ModelTierPrices
            tiers={tiers}
            persistedMultiplier={persistedMultiplier}
            draftMultiplier={draftMultiplier}
            currency={platformCurrency}
            formatPrice={(value, currency) =>
              formatModelUnitPrice(value, currency, { emptyText: '— 未配置' })}
            ariaLabel={`${row.modelName} 各档生效价`}
            testIdPrefix={`payg-price-tier-${row.modelName}`}
            effectiveHeader="生效价"
          />
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 210,
      align: 'right' as const,
      render: (_: unknown, row: PaygModelPricingItem) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            icon={<SaveOutlined />}
            loading={savingKey === `price:${row.modelName}`}
            disabled={!canManage}
            onClick={() => handleSave(row)}
          >
            保存
          </Button>
          <Popconfirm
            title="创建基础价版本?"
            description="会从当前时间开始按模型库基础价生效，历史版本不会删除。"
            okText="重置"
            cancelText="取消"
            onConfirm={() => handleReset(row)}
          >
            <Button
              type="link"
              size="small"
              icon={<UndoOutlined />}
              disabled={!canManage}
            >
              重置
            </Button>
          </Popconfirm>
          <Popconfirm
            title="移出产品?"
            description="模型会从该 PAYG 产品授权中移除，价格历史保留。"
            okText="移出"
            cancelText="取消"
            onConfirm={() => handleRetire(row)}
          >
            <Button
              danger
              type="link"
              size="small"
              icon={<DeleteOutlined />}
              loading={row.availability ? savingKey === `retire:${row.availability.id}` : false}
              disabled={!canManage}
            >
              移出
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const candidateColumns = [
    {
      title: '模型',
      key: 'model',
      render: (_: unknown, row: PaygModelCandidateItem) => (
        <div className="payg-model-cell">
          <div className="payg-model-name">{row.modelName}</div>
          <div className="payg-model-meta">
            {row.provider ?? 'unknown'}
          </div>
        </div>
      ),
    },
    {
      title: '基础价',
      key: 'base',
      width: 330,
      render: (_: unknown, row: PaygModelCandidateItem) => (
        <PriceStrip prices={row.base} currency={platformCurrency} />
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: unknown, row: PaygModelCandidateItem) => (
        row.previouslyRemoved ? <Tag color="orange">曾移出</Tag> : <Tag>未加入</Tag>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="PAYG 产品模型授权"
        subtitle="圈定按量产品可用模型，并维护这些模型的价格覆盖版本"
        actions={[
          <Button
            key="add"
            type="primary"
            icon={<PlusOutlined />}
            onClick={openCandidateModal}
            disabled={!canManage || !productId}
          >
            新增模型
          </Button>,
          <Button
            key="reload"
            icon={<ReloadOutlined />}
            onClick={() => productId && loadRows(productId)}
            disabled={!productId}
          >
            刷新
          </Button>,
        ]}
      />

      <Card className="payg-summary-card">
        <Space size={32} wrap>
          <div>
            <div className="payg-summary-label">授权模型</div>
            <div className="payg-summary-value">{stats.total}</div>
          </div>
          <div>
            <div className="payg-summary-label">API 可用</div>
            <div className="payg-summary-value">{stats.apiAvailable}</div>
          </div>
          <div>
            <div className="payg-summary-label">用户展示</div>
            <div className="payg-summary-value">{stats.visible}</div>
          </div>
          <div>
            <div className="payg-summary-label">价格覆盖</div>
            <div className="payg-summary-value">{stats.configured}</div>
          </div>
        </Space>
      </Card>

      <FilterBar
        search={{
          placeholder: '搜索模型或供应商',
          value: search,
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="product"
            placeholder="按量产品"
            style={{ minWidth: 220 }}
            value={productId}
            onChange={setProductId}
            options={products.map((product) => ({
              label: product.name,
              value: product.id,
            }))}
          />,
        ]}
      />

      {products.length === 0 ? (
        <EmptyPlaceholder
          title="暂无按量产品"
          description="请先在产品管理中创建 PAY_AS_YOU_GO 产品。"
        />
      ) : filteredRows.length === 0 && !loading ? (
        <EmptyPlaceholder
          title="暂无授权模型"
          description="点击新增模型，从模型库选择该产品可用的模型。"
        />
      ) : (
        <DataTable<PaygModelPricingItem>
          columns={columns}
          dataSource={filteredRows}
          rowKey="modelName"
          loading={loading}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1910 }}
        />
      )}

      <Modal
        title="从模型库新增模型"
        open={candidateOpen}
        width={900}
        okText="加入产品"
        cancelText="取消"
        confirmLoading={addingModels}
        okButtonProps={{ disabled: !canManage || selectedCandidates.length === 0 }}
        onOk={handleAddModels}
        onCancel={() => setCandidateOpen(false)}
      >
        <DataTable<PaygModelCandidateItem>
          size="small"
          rowKey="modelName"
          loading={candidateLoading}
          columns={candidateColumns}
          dataSource={candidateRows}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          rowSelection={{
            selectedRowKeys: selectedCandidates,
            onChange: (keys) => setSelectedCandidates(keys.map(String)),
            getCheckboxProps: () => ({ disabled: !canManage }),
          }}
          locale={{ emptyText: '模型库中暂无可新增模型' }}
        />
      </Modal>
    </div>
  );
}
