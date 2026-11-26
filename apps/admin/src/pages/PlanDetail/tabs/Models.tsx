import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Switch, Tag, Typography, Alert, Button, Space, Select } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { ReloadOutlined } from '@ant-design/icons';
import { modelPricingApi } from '../../../api/admin';
import { DataTable, StableNumberInput } from '../../../components/common';
import { usePlatformCurrency } from '../../../contexts/PlatformConfigContext';
import { warnNonCritical } from '../../../utils/logging';
import { formatModelUnitPrice } from '../../../utils/price';
import type {
  ChannelModel,
  PlanDetailChange,
  PlanDetailState,
  PlanModelAccessConfig,
  PlanModelRoutePolicyConfig,
} from '../types';

const { Text } = Typography;

interface Props {
  plan: PlanDetailState;
  onChange: PlanDetailChange;
  /** 是否展示「模型路由策略」段。自营 CodingPlan 用不到，传 false 隐藏。默认 true（通用套餐保持原样）。 */
  showRoutePolicies?: boolean;
  canManage?: boolean;
}

const PREVIEW_INPUT_TOKENS = 2000;
const PREVIEW_OUTPUT_TOKENS = 1000;
const ROUTE_POLICIES: { key: string; label: string; description: string }[] = [
  { key: 'general', label: '日常问答', description: '普通文本问答、轻量编辑' },
  { key: 'tool_use', label: '工具执行', description: '需要文件、代码、终端或多步操作' },
  { key: 'vision', label: '图片理解', description: '用户上传图片或截图' },
  { key: 'presentation', label: '演示文稿', description: 'PPT/路演/汇报材料' },
  { key: 'spreadsheet', label: 'Excel/数据表', description: '表格、公式、数据整理' },
  { key: 'chart', label: '图表可视化', description: '图表、仪表盘、数据展示' },
  { key: 'long_context', label: '长上下文', description: '长文档、多附件、大段资料' },
  { key: 'fast', label: '快速响应', description: '低成本、低延迟任务' },
];

interface ModelPricingRow {
  modelName: string;
  provider?: string | null;
  isActive?: boolean;
  inputPricePerMToken?: number | string | null;
  outputPricePerMToken?: number | string | null;
  cachedInputPrice?: number | string | null;
  priceTiers?: Array<{
    inputPricePerMToken?: number | string | null;
    outputPricePerMToken?: number | string | null;
    cachedInputPrice?: number | string | null;
    priority?: number | null;
    isActive?: boolean;
  }> | null;
}

interface AvailableModel extends ChannelModel {
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPrice: number | null;
}

async function listModelPricings(): Promise<ModelPricingRow[]> {
  try {
    const pricingRes = await modelPricingApi.list() as ModelPricingRow[] | { items?: ModelPricingRow[] };
    return Array.isArray(pricingRes) ? pricingRes : pricingRes.items || [];
  } catch (error: unknown) {
    warnNonCritical('PlanDetail model pricing preload', error);
    return [];
  }
}

function toNumber(value: number | string | null | undefined, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function resolvePreviewPricing(row: ModelPricingRow): Pick<
  AvailableModel,
  'inputPricePerMToken' | 'outputPricePerMToken' | 'cachedInputPrice'
> {
  const tier = [...(row.priceTiers || [])]
    .filter((item) => item.isActive !== false)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
  return {
    inputPricePerMToken: toNumber(row.inputPricePerMToken ?? tier?.inputPricePerMToken),
    outputPricePerMToken: toNumber(row.outputPricePerMToken ?? tier?.outputPricePerMToken),
    cachedInputPrice: row.cachedInputPrice !== undefined && row.cachedInputPrice !== null
      ? toNumber(row.cachedInputPrice)
      : tier?.cachedInputPrice !== undefined && tier.cachedInputPrice !== null
        ? toNumber(tier.cachedInputPrice)
        : null,
  };
}

export function ModelsTab({ plan, onChange, showRoutePolicies = true, canManage = true }: Props) {
  const navigate = useNavigate();
  const platformCurrency = usePlatformCurrency();
  // 套餐候选模型来自平台模型库中的启用模型。是否给用户展示、是否可用，
  // 由当前产品/套餐配置决定，不由模型库的全局字段决定。
  // 业务流:
  //   1. 模型库录入并启用模型 → 进入候选池
  //   2. 套餐勾选 + 配 multiplier → 该套餐可用
  //   3. 用户使用时按 ModelAccess 鉴权 + 按 multiplier 扣费
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [emptyHint, setEmptyHint] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const modelAccess: Record<string, PlanModelAccessConfig> = plan.modelAccessMap || {};
  const routePolicies: Record<string, PlanModelRoutePolicyConfig> = plan.modelRoutePoliciesMap || {};
  const monthlyCredits = plan.monthlyCredits || 0;
  const usageMultiplier = plan.usageMultiplier ?? 1.0;
  const activeModelOptions = availableModels
    .filter((m) => modelAccess[m.model]?.isActive)
    .map((m) => ({ label: m.provider ? `${m.model} · ${m.provider}` : m.model, value: m.model }));

  const loadModels = useCallback(async () => {
    setRefreshing(true);
    try {
      const pricings = await listModelPricings();

      const activeModels = pricings.filter(
        (p) => p.isActive === true,
      );

      if (activeModels.length === 0) {
        setEmptyHint(
          '模型库中暂无启用模型。请先去"供给与渠道 → 模型库"录入并启用模型，才能在套餐里配置。',
        );
        setAvailableModels([]);
        return;
      }

      setEmptyHint(null);
      setAvailableModels(
        activeModels
          .map((p) => ({
            model: p.modelName,
            provider: p.provider ?? undefined,
            ...resolvePreviewPricing(p),
          }))
          .sort((a: AvailableModel, b: AvailableModel) => a.model.localeCompare(b.model)),
      );
    } catch (e) {
      console.error('Load models failed', e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  // 依赖 plan.id：切套餐时重拉。但运营常见路径是"另开窗口去模型库打开展示后回到本窗口",
  // plan.id 不变，所以 useEffect 不会重跑 → 提供右上角"刷新"按钮兜底。
  useEffect(() => {
    loadModels();
  }, [loadModels, plan.id]);

  const toggleModel = (modelName: string, active: boolean) => {
    const next = {
      ...modelAccess,
      [modelName]: {
        ...modelAccess[modelName],
        isActive: active,
        creditMultiplier: modelAccess[modelName]?.creditMultiplier ?? 1.0,
      },
    };
    // 路由策略隐藏时（自营 CodingPlan）不联动改写 modelRoutePoliciesMap，只改模型授权
    if (!showRoutePolicies) {
      onChange({ ...plan, modelAccessMap: next });
      return;
    }
    let nextRoutePolicies = routePolicies;
    if (!active) {
      nextRoutePolicies = Object.fromEntries(
        Object.entries(routePolicies).map(([key, policy]) => [
          key,
          {
            ...policy,
            primaryModel: policy.primaryModel === modelName ? null : policy.primaryModel,
            fallbackModels: policy.fallbackModels.filter((item) => item !== modelName),
          },
        ]),
      );
    }
    onChange({ ...plan, modelAccessMap: next, modelRoutePoliciesMap: nextRoutePolicies });
  };

  const updateMultiplier = (modelName: string, multiplier: number) => {
    const next = {
      ...modelAccess,
      [modelName]: {
        ...modelAccess[modelName],
        isActive: modelAccess[modelName]?.isActive ?? false,
        creditMultiplier: multiplier,
      }
    };
    onChange({ ...plan, modelAccessMap: next });
  };

  const updateRoutePolicy = (routeKey: string, patch: Partial<PlanModelRoutePolicyConfig>) => {
    const current = routePolicies[routeKey] || {
      primaryModel: null,
      fallbackModels: [],
      isActive: true,
    };
    onChange({
      ...plan,
      modelRoutePoliciesMap: {
        ...routePolicies,
        [routeKey]: { ...current, ...patch },
      },
    });
  };

  const estimatePerQuery = (record: AvailableModel, multiplier: number): number => {
    const costUsd = (
      PREVIEW_INPUT_TOKENS * record.inputPricePerMToken
      + PREVIEW_OUTPUT_TOKENS * record.outputPricePerMToken
    ) / 1_000_000;
    return Math.ceil(costUsd * 100 * multiplier * usageMultiplier);
  };
  const estimateQueryCount = (record: AvailableModel, multiplier: number): string => {
    if (!monthlyCredits || !multiplier) return '—';
    const perQuery = estimatePerQuery(record, multiplier);
    if (perQuery <= 0) return '—';
    const count = Math.floor(monthlyCredits / perQuery);
    if (count >= 10000) return `≈ ${(count / 10000).toFixed(1)} 万次`;
    return `≈ ${count.toLocaleString()} 次`;
  };

  const columns: ColumnsType<AvailableModel & { key: string }> = [
    {
      title: '模型',
      key: 'model',
      width: 200,
      render: (_: unknown, record: AvailableModel) => (
        <div>
          <span style={{ fontWeight: 500 }}>{record.model}</span>
          {record.provider && <Tag style={{ marginLeft: 8, fontSize: 11 }}>{record.provider}</Tag>}
        </div>
      ),
    },
    {
      title: '启用',
      key: 'active',
      width: 60,
      render: (_: unknown, record: AvailableModel) => (
        <Switch
          size="small"
          checked={modelAccess[record.model]?.isActive ?? false}
          disabled={!canManage}
          onChange={(v) => toggleModel(record.model, v)}
        />
      ),
    },
    {
      title: `上游价 ${platformCurrency} / 1M`,
      key: 'basePricing',
      width: 150,
      render: (_: unknown, record: AvailableModel) => (
        <div>
          <Text style={{ fontSize: 12 }}>in {formatModelUnitPrice(record.inputPricePerMToken, platformCurrency)}</Text>
          <br />
          <Text type="secondary" style={{ fontSize: 12 }}>out {formatModelUnitPrice(record.outputPricePerMToken, platformCurrency)}</Text>
        </div>
      ),
    },
    {
      title: '模型积分倍率',
      key: 'creditMultiplier',
      width: 150,
      render: (_: unknown, record: AvailableModel) => {
        const mult = modelAccess[record.model]?.creditMultiplier ?? 1.0;
        const active = modelAccess[record.model]?.isActive ?? false;
        return (
          <StableNumberInput
            size="small"
            min={0}
            max={1000}
            step={0.1}
            precision={3}
            value={mult}
            onChange={(v) => updateMultiplier(record.model, Number(v ?? 1))}
            disabled={!canManage || !active}
            style={{ width: 110 }}
          />
        );
      },
    },
    {
      title: (
        <span>
          每次问答{' '}
          <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
            ({PREVIEW_INPUT_TOKENS / 1000}K in + {PREVIEW_OUTPUT_TOKENS / 1000}K out)
          </Text>
        </span>
      ),
      key: 'perQuery',
      width: 130,
      render: (_: unknown, record: AvailableModel) => {
        const mult = modelAccess[record.model]?.creditMultiplier ?? 1.0;
        const active = modelAccess[record.model]?.isActive ?? false;
        if (!active) return <Text type="secondary">—</Text>;
        return <Text type="secondary">~{estimatePerQuery(record, mult)} 积分</Text>;
      },
    },
    {
      title: '本套餐可用量',
      key: 'estimate',
      width: 130,
      render: (_: unknown, record: AvailableModel) => {
        const mult = modelAccess[record.model]?.creditMultiplier ?? 1.0;
        const active = modelAccess[record.model]?.isActive ?? false;
        if (!active) return <Text type="secondary">—</Text>;
        return <Text style={{ color: '#059669', fontWeight: 500 }}>{estimateQueryCount(record, mult)}</Text>;
      },
    },
  ];

  const routeColumns: ColumnsType<(typeof ROUTE_POLICIES)[number] & { key: string }> = [
    {
      title: '策略大类',
      key: 'route',
      width: 180,
      render: (_: unknown, record) => (
        <div>
          <div style={{ fontWeight: 500 }}>{record.label}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.description}</Text>
        </div>
      ),
    },
    {
      title: '启用',
      key: 'active',
      width: 70,
      render: (_: unknown, record) => (
        <Switch
          size="small"
          checked={routePolicies[record.key]?.isActive ?? true}
          disabled={!canManage}
          onChange={(v) => updateRoutePolicy(record.key, { isActive: v })}
        />
      ),
    },
    {
      title: '主模型',
      key: 'primaryModel',
      width: 260,
      render: (_: unknown, record) => (
        <Select
          allowClear
          showSearch
          placeholder="选择主模型"
          value={routePolicies[record.key]?.primaryModel || undefined}
          options={activeModelOptions}
          disabled={!canManage || activeModelOptions.length === 0 || routePolicies[record.key]?.isActive === false}
          onChange={(value) => updateRoutePolicy(record.key, { primaryModel: value || null })}
          style={{ width: '100%' }}
        />
      ),
    },
    {
      title: 'Fallback 模型',
      key: 'fallbackModels',
      render: (_: unknown, record) => (
        <Select
          mode="multiple"
          allowClear
          showSearch
          placeholder="可选，按选择顺序降级"
          value={routePolicies[record.key]?.fallbackModels || []}
          options={activeModelOptions}
          disabled={!canManage || activeModelOptions.length === 0 || routePolicies[record.key]?.isActive === false}
          onChange={(value) => updateRoutePolicy(record.key, { fallbackModels: value })}
          style={{ width: '100%' }}
        />
      ),
    },
  ];

  return (
    <div>
      <Space style={{ marginBottom: 12, width: '100%', justifyContent: 'flex-end' }}>
        <Button
          icon={<ReloadOutlined />}
          onClick={loadModels}
          loading={refreshing}
          size="small"
        >
          刷新模型目录
        </Button>
      </Space>
      {emptyHint && (
        <Alert
          type="warning"
          showIcon
          message="没有可配置的模型"
          description={emptyHint}
          action={(
            <Button size="small" type="primary" onClick={() => navigate('/models')}>
              去模型库
            </Button>
          )}
          style={{ marginBottom: 16 }}
        />
      )}
      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: '#f9fafb',
          borderRadius: 8,
          fontSize: 13,
          color: '#4b5563',
        }}
      >
        <div style={{ marginBottom: 4 }}>
          <strong>当前套餐:</strong> 月度积分 <strong>{(monthlyCredits || 0).toLocaleString()}</strong>, 套餐倍率{' '}
          <strong>{usageMultiplier}x</strong>
          {usageMultiplier > 1 && <span style={{ color: '#dc2626' }}>(积分消耗 ×{usageMultiplier})</span>}
        </div>
        <div>
          积分按 上游 {platformCurrency} 成本 × 100 × 模型积分倍率 × 套餐倍率 计算。先勾选套餐可用模型，再为不同任务大类配置主模型和 fallback。
        </div>
      </div>
      <DataTable<AvailableModel & { key: string }>
        dataSource={availableModels.map((m) => ({ ...m, key: m.model }))}
        columns={columns}
        searchable
        searchPlaceholder="搜索模型名称 / 类型"
        pagination={false}
        size="middle"
        locale={{ emptyText: '暂无可用模型,请先在模型库中启用模型' }}
      />
      {showRoutePolicies && (
        <>
          <Typography.Title level={5} style={{ marginTop: 24, marginBottom: 12 }}>
            模型路由策略
          </Typography.Title>
          <DataTable<(typeof ROUTE_POLICIES)[number] & { key: string }>
            dataSource={ROUTE_POLICIES}
            columns={routeColumns}
            searchable
            searchPlaceholder="搜索路由策略"
            pagination={false}
            size="middle"
            locale={{ emptyText: '暂无路由策略' }}
          />
        </>
      )}
    </div>
  );
}
