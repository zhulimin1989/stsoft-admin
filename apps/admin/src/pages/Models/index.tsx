import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  Select,
  Space,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
} from '@ant-design/icons';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  Tag,
  ProviderLogo,
} from '../../components/common';
import { modelPricingApi } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { formatModelUnitPrice } from '../../utils/price';

interface ModelV2 {
  id?: string;
  name: string;
  displayName?: string;
  inputPriceCents: number;
  outputPriceCents: number;
  isActive: boolean;
  // v2 fields (backend not yet ready)
  provider?: string;
  modelType?: string;
  description?: string;
  inputModalities?: string[];
  outputModalities?: string[];
  contextLength?: number;
  maxOutputTokens?: number;
  providerLogo?: string;
  displayOrder?: number;
  releaseAt?: string;
  tags?: string[];
  supportedFeatures?: string[];
  pricingUnit?: string;
  unitPriceUsd?: number;
  cachedInputPriceCents?: number;
  cacheWrite5minPriceCents?: number;
  cacheWrite1hPriceCents?: number;
  priceTiers?: unknown[];
  monthlyTokenUsage?: number;
}

const PROVIDER_OPTIONS = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Anthropic', value: 'anthropic' },
  { label: 'Qwen', value: 'qwen' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Google', value: 'google' },
  { label: 'Mistral', value: 'mistral' },
  { label: 'Zhipu', value: 'zhipu' },
  { label: 'Moonshot / Kimi', value: 'moonshot' },
  { label: 'MiniMax', value: 'minimax' },
  { label: 'Doubao', value: 'doubao' },
  { label: 'Seedance', value: 'seedance' },
  { label: 'Volcengine', value: 'volcengine' },
  { label: 'Runway', value: 'runway' },
  { label: 'Kling', value: 'kling' },
  { label: 'Stability AI', value: 'stability' },
  { label: 'fal.ai', value: 'fal' },
  { label: 'ElevenLabs', value: 'elevenlabs' },
  { label: 'Other', value: 'other' },
];

const MODALITY_LABELS: Record<string, string> = {
  text: '📝 文本',
  image: '🖼️ 图片',
  file: '📄 文件',
  audio: '🎵 音频',
  video: '🎬 视频',
  embedding: 'Embedding',
};

const MODEL_TYPE_LABELS: Record<string, string> = {
  chat: '文本',
  embedding: 'Embedding',
  rerank: 'Rerank',
  image: '图像',
  audio: '音频',
  video: '视频',
  multimodal: '多模态',
  task: '任务',
};

const MODALITY_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '图片', value: 'image' },
  { label: '文件', value: 'file' },
  { label: '音频', value: 'audio' },
  { label: '视频', value: 'video' },
];

const CONTEXT_OPTIONS = [
  { label: '< 16k', value: 'lt16k' },
  { label: '16k - 128k', value: '16to128' },
  { label: '128k - 1M', value: '128to1m' },
  { label: '> 1M', value: 'gt1m' },
];

const TAG_OPTIONS = ['推理', '编码', '视觉', '快速', '长文本', 'agent'];

function getErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const response = 'response' in error ? error.response : undefined;
    if (typeof response === 'object' && response !== null && 'data' in response) {
      const data = (response as { data?: unknown }).data;
      if (
        typeof data === 'object' &&
        data !== null &&
        'message' in data &&
        typeof (data as { message?: unknown }).message === 'string'
      ) {
        return (data as { message: string }).message;
      }
    }
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
  }
  return fallback;
}

function getCacheWritePrice(row: {
  cacheWrite5minPriceCents?: number | null;
  cacheWrite1hPriceCents?: number | null;
}): number | null {
  return row.cacheWrite5minPriceCents ?? row.cacheWrite1hPriceCents ?? null;
}

function bucketContext(len?: number): string | null {
  if (!len) return null;
  if (len < 16_000) return 'lt16k';
  if (len < 128_000) return '16to128';
  if (len < 1_000_000) return '128to1m';
  return 'gt1m';
}

export default function ModelsPage() {
  // antd v5: 静态 modal/message 调用不渲染 context，改用 App.useApp() 实例。
  // 改用 App.useApp() 拿到带 React context 的实例。
  const { modal, message } = App.useApp();
  const navigate = useNavigate();
  const platformCurrency = usePlatformCurrency();
  const canManage = usePermission('admin.page.models.manage');
  const [rows, setRows] = useState<ModelV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deactivatingOrphans, setDeactivatingOrphans] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [provider, setProvider] = useState<string | undefined>();
  const [inputModality, setInputModality] = useState<string | undefined>();
  const [outputModality, setOutputModality] = useState<string | undefined>();
  const [contextBucket, setContextBucket] = useState<string | undefined>();
  const [tagFilter, setTagFilter] = useState<string | undefined>();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await modelPricingApi.list();
      const items: ModelV2[] = (data?.items || data || []).map(
        (item: Record<string, unknown>) => {
          const inputDollar = Number(
            item.inputPricePerMToken ?? item.input_price_per_m_token ?? 0,
          );
          const outputDollar = Number(
            item.outputPricePerMToken ?? item.output_price_per_m_token ?? 0,
          );
          // Backend stores JSON arrays as TEXT (Prisma String?). Parse defensively
          // — older rows may still have null, malformed payloads, or already-array
          // values from in-memory mock fixtures.
          const parseArray = (raw: unknown): string[] | undefined => {
            if (Array.isArray(raw)) return raw as string[];
            if (typeof raw === 'string' && raw.length > 0) {
              try {
                const v = JSON.parse(raw);
                return Array.isArray(v) ? v : undefined;
              } catch {
                return undefined;
              }
            }
            return undefined;
          };
          // Zero-migration compatibility: older Billing responses expose the
          // user-facing name through the existing modelId/model_id field.
          const displayName = [
            item.displayName,
            item.display_name,
            item.modelId,
            item.model_id,
          ].find(
            (value): value is string =>
              typeof value === 'string' && value.trim().length > 0,
          );
          return {
            id: (item.id as string | undefined) ?? (item.modelName as string),
            name: (item.modelName || item.model_name) as string,
            displayName: displayName?.trim(),
            // 兼容旧变量名，字段值已是当前部署主币种 / 1M token。
            inputPriceCents: inputDollar,
            outputPriceCents: outputDollar,
            isActive: (item.isActive ?? item.is_active ?? true) as boolean,
            provider: item.provider as string | undefined,
            modelType: (item.modelType ?? item.model_type) as string | undefined,
            description: item.description as string | undefined,
            inputModalities: parseArray(item.inputModalities ?? item.input_modalities),
            outputModalities: parseArray(item.outputModalities ?? item.output_modalities),
            contextLength: (item.contextLength ?? item.context_length) as number | undefined,
            maxOutputTokens: (item.maxOutputTokens ?? item.max_output_tokens) as number | undefined,
            providerLogo: (item.providerLogo ?? item.provider_logo) as string | undefined,
            displayOrder: (item.displayOrder ?? item.display_order) as number | undefined,
            releaseAt: (item.releaseAt ?? item.release_at) as string | undefined,
            tags: parseArray(item.tags),
            supportedFeatures: parseArray(item.supportedFeatures ?? item.supported_features),
            pricingUnit: (item.pricingUnit ?? item.pricing_unit) as string | undefined,
            unitPriceUsd: (item.unitPriceUsd ?? item.unit_price_usd) as number | undefined,
            cachedInputPriceCents: (item.cachedInputPrice ??
              item.cached_input_price_cents) as number | undefined,
            cacheWrite5minPriceCents: (item.cacheWrite5minPrice ??
              item.cache_write_5min_price_cents ??
              item.cacheWrite1hPrice ??
              item.cache_write_1h_price_cents) as number | undefined,
            cacheWrite1hPriceCents: (item.cacheWrite1hPrice ??
              item.cache_write_1h_price_cents) as number | undefined,
            priceTiers: Array.isArray(item.priceTiers ?? item.price_tiers)
              ? ((item.priceTiers ?? item.price_tiers) as unknown[])
              : undefined,
            monthlyTokenUsage: item.monthlyTokenUsage as number | undefined,
          };
        },
      );
      items.sort((a, b) => a.name.localeCompare(b.name));
      setRows(items);
    } catch {
      message.error('加载模型列表失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (s) {
        // 搜索覆盖:模型 ID / 用户展示名称 / Provider / 描述 / Tags
        const haystack = [
          r.name,
          r.displayName ?? '',
          r.provider ?? '',
          r.description ?? '',
          (r.tags ?? []).join(' '),
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(s)) return false;
      }
      if (provider && r.provider !== provider) return false;
      if (inputModality && !(r.inputModalities ?? []).includes(inputModality)) return false;
      if (outputModality && !(r.outputModalities ?? []).includes(outputModality)) return false;
      if (contextBucket && bucketContext(r.contextLength) !== contextBucket) return false;
      if (tagFilter && !(r.tags ?? []).includes(tagFilter)) return false;
      return true;
    });
  }, [rows, search, provider, inputModality, outputModality, contextBucket, tagFilter]);

  const totalCount = rows.length;
  const activeCount = rows.filter((r) => r.isActive).length;
  const monthlyTokenSum = rows.reduce((sum, r) => sum + (r.monthlyTokenUsage ?? 0), 0);
  const inactiveCount = rows.filter((r) => !r.isActive).length;
  const topRevenueModel = rows
    .filter((r) => (r.monthlyTokenUsage ?? 0) > 0)
    .sort((a, b) => (b.monthlyTokenUsage ?? 0) - (a.monthlyTokenUsage ?? 0))[0]?.name;

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await modelPricingApi.sync();
      const count = result?.synced ?? result?.count ?? 0;
      message.success(`同步完成，共同步 ${count} 个模型`);
      fetchData();
    } catch {
      message.error('同步失败');
    } finally {
      setSyncing(false);
    }
  };

  const handleDeactivateOrphans = async () => {
    setDeactivatingOrphans(true);
    try {
      const preview = await modelPricingApi.deactivateOrphans(false);
      const orphans: string[] = preview?.orphans ?? [];
      if (orphans.length === 0) {
        message.info('没有孤儿定价，所有 active 模型都有 Channel 覆盖');
        return;
      }
      modal.confirm({
        title: `确认禁用 ${orphans.length} 个孤儿定价？`,
        width: 560,
        content: (
          <div>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
              以下 ModelPricing 条目处于 active 状态，但没有任何 active Channel 覆盖，
              用户选择这些模型调用会返回 404。点击确认后它们将被标记为 isActive=false。
            </Typography.Paragraph>
            <div
              style={{
                maxHeight: 240,
                overflow: 'auto',
                background: '#fafafa',
                padding: 12,
                borderRadius: 4,
                border: '1px solid #f0f0f0',
              }}
            >
              {orphans.map((name) => (
                <span
                  key={name}
                  style={{
                    display: 'inline-block',
                    padding: '2px 8px',
                    margin: '0 6px 6px 0',
                    background: '#fff',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    fontSize: 12,
                  }}
                >
                  {name}
                </span>
              ))}
            </div>
          </div>
        ),
        okText: `确认禁用 ${orphans.length} 个`,
        cancelText: '取消',
        okButtonProps: { danger: true },
        onOk: async () => {
          try {
            const result = await modelPricingApi.deactivateOrphans(true);
            message.success(`已禁用 ${result?.deactivated ?? 0} 个孤儿定价`);
            fetchData();
          } catch (error) {
            message.error(getErrorMessage(error, '禁用失败'));
            throw error;
          }
        },
      });
    } catch (error) {
      message.error(getErrorMessage(error, '获取孤儿定价失败'));
    } finally {
      setDeactivatingOrphans(false);
    }
  };

  const handleDelete = async (row: ModelV2) => {
    modal.confirm({
      title: `确认从模型库彻底删除 ${row.name}？`,
      content:
        '此操作会从 model_pricing 表中物理删除该模型条目（不可撤销）。如该模型仍被某个套餐引用，删除会被拒绝，请先去对应套餐里移除。',
      okText: '彻底删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await modelPricingApi.remove(row.name);
          message.success(`已删除 ${row.name}`);
          fetchData();
        } catch (err) {
          message.error(getErrorMessage(err, '删除失败'));
        }
      },
    });
  };

  const columns = [
    {
      title: '模型',
      key: 'name',
      render: (_: unknown, record: ModelV2) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {record.providerLogo ? (
            <img
              src={record.providerLogo}
              alt=""
              style={{ width: 28, height: 28, borderRadius: 6, objectFit: 'contain' }}
            />
          ) : (
            <ProviderLogo provider={record.provider} modelName={record.name} size={28} />
          )}
          <div>
            <div style={{ fontWeight: 500 }}>{record.displayName || record.name}</div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
              {record.name}
            </div>
          </div>
        </div>
      ),
    },
    {
      title: '类型',
      key: 'modelType',
      width: 105,
      render: (_: unknown, record: ModelV2) =>
        record.modelType ? (
          <Tag>{MODEL_TYPE_LABELS[record.modelType] ?? record.modelType}</Tag>
        ) : '—',
    },
    {
      title: '输入',
      key: 'inputModalities',
      width: 120,
      render: (_: unknown, record: ModelV2) =>
        record.inputModalities && record.inputModalities.length > 0
          ? record.inputModalities.map((m) => (
              <span key={m} style={{ marginRight: 4 }} title={m}>
                {MODALITY_LABELS[m]?.split(' ')[0] ?? m}
              </span>
            ))
          : '—',
    },
    {
      title: '输出',
      key: 'outputModalities',
      width: 120,
      render: (_: unknown, record: ModelV2) =>
        record.outputModalities && record.outputModalities.length > 0
          ? record.outputModalities.map((m) => (
              <span key={m} style={{ marginRight: 4 }} title={m}>
                {MODALITY_LABELS[m]?.split(' ')[0] ?? m}
              </span>
            ))
          : '—',
    },
    {
      title: '上下文',
      key: 'contextLength',
      width: 110,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) =>
        record.contextLength ? record.contextLength.toLocaleString() : '—',
    },
    {
      title: `input (${platformCurrency}/1M)`,
      key: 'inputPriceCents',
      width: 140,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) => formatModelUnitPrice(record.inputPriceCents, platformCurrency),
    },
    {
      title: `cache read (${platformCurrency}/1M)`,
      key: 'cachedInputPriceCents',
      width: 150,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) =>
        formatModelUnitPrice(record.cachedInputPriceCents, platformCurrency),
    },
    {
      title: `cache write (${platformCurrency}/1M)`,
      key: 'cacheWrite5minPriceCents',
      width: 155,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) =>
        formatModelUnitPrice(getCacheWritePrice(record), platformCurrency),
    },
    {
      title: `output (${platformCurrency}/1M)`,
      key: 'outputPriceCents',
      width: 140,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) => formatModelUnitPrice(record.outputPriceCents, platformCurrency),
    },
    {
      title: '媒体单价',
      key: 'unitPriceUsd',
      width: 130,
      align: 'right' as const,
      render: (_: unknown, record: ModelV2) =>
        record.unitPriceUsd !== undefined && record.unitPriceUsd !== null
          ? `${formatModelUnitPrice(record.unitPriceUsd, platformCurrency, { unit: '' })} / ${record.pricingUnit ?? 'unit'}`
          : '—',
    },
    {
      title: '价格档',
      key: 'priceTiers',
      width: 100,
      align: 'center' as const,
      render: (_: unknown, record: ModelV2) =>
        record.priceTiers?.length ? <Tag variant="proc">{record.priceTiers.length} 档</Tag> : <Tag>基础价</Tag>,
    },
    {
      title: '操作',
      key: 'actions',
      width: 200,
      render: (_: unknown, record: ModelV2) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() =>
              navigate(`/models/${encodeURIComponent(record.id ?? record.name)}`)
            }
          >
            详情
          </Button>
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            disabled={!canManage}
            onClick={() => handleDelete(record)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="模型库"
        subtitle="平台模型目录、能力基准与基础定价"
        actions={[
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={() => navigate('/models/new')}
          >
            新建模型
          </Button>,
          <Button key="reload" icon={<ReloadOutlined />} onClick={fetchData}>
            刷新
          </Button>,
          <Button
            key="orphans"
            icon={<DeleteOutlined />}
            onClick={handleDeactivateOrphans}
            loading={deactivatingOrphans}
            disabled={!canManage}
            danger
          >
            批量下架孤儿
          </Button>,
          <Button
            key="sync"
            icon={<SyncOutlined />}
            onClick={handleSync}
            loading={syncing}
            disabled={!canManage}
          >
            从代理同步
          </Button>,
        ]}
      />

      <StatCardGroup columns={5}>
        <StatCard label="模型总数" value={totalCount} />
        <StatCard label="已启用" value={activeCount} variant="success" />
        <StatCard
          label="30 天调用 token"
          value={monthlyTokenSum > 0 ? monthlyTokenSum.toLocaleString() : '—'}
        />
        <StatCard label="Top 收入模型" value={topRevenueModel ?? '—'} />
        <StatCard
          label="异常 / 不活跃"
          value={inactiveCount}
          variant={inactiveCount > 0 ? 'warning' : 'default'}
        />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索模型 ID / 用户展示名称 / Provider / 描述 / 标签',
          value: search,
          onSearch: setSearch,
        }}
        filters={[
          <Select
            key="provider"
            placeholder="Provider"
            allowClear
            style={{ width: 140 }}
            value={provider}
            onChange={setProvider}
            options={PROVIDER_OPTIONS}
          />,
          <Select
            key="input"
            placeholder="输入类型"
            allowClear
            style={{ width: 130 }}
            value={inputModality}
            onChange={setInputModality}
            options={MODALITY_OPTIONS}
          />,
          <Select
            key="output"
            placeholder="输出类型"
            allowClear
            style={{ width: 130 }}
            value={outputModality}
            onChange={setOutputModality}
            options={MODALITY_OPTIONS}
          />,
          <Select
            key="ctx"
            placeholder="上下文档位"
            allowClear
            style={{ width: 140 }}
            value={contextBucket}
            onChange={setContextBucket}
            options={CONTEXT_OPTIONS}
          />,
          <Select
            key="tag"
            placeholder="标签"
            allowClear
            style={{ width: 130 }}
            value={tagFilter}
            onChange={setTagFilter}
            options={TAG_OPTIONS.map((t) => ({ label: t, value: t }))}
          />,
        ]}
      />

      <DataTable<ModelV2>
        rowKey={(r) => r.id ?? r.name}
        columns={columns}
        dataSource={filtered}
        loading={loading}
        pagination={{ pageSize: 50, showTotal: (t) => `共 ${t} 个模型` }}
        scroll={{ x: 1280 }}
        size="middle"
      />

    </div>
  );
}
