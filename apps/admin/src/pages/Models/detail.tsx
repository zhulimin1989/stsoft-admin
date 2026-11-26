import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Form,
  Input,
  List,
  Radio,
  Select,
  Space,
  Switch,
  Tabs,
  Typography,
} from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  ArrowLeftOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  PageHeader,
  EmptyPlaceholder,
  StableNumberInput,
  Tag,
} from '../../components/common';
import { channelApi, modelPricingApi, type BandScheduleWindow, type ModelPricingUpsertInput } from '../../api/admin';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { currencySymbol, modelUnitPriceInputProps } from '../../utils/price';

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

const TAG_OPTIONS = ['推理', '编码', '视觉', '图像', '音频', '视频', '生成', '快速', '长文本', 'agent'];
const MODEL_TYPE_OPTIONS = [
  { label: 'Chat / 文本', value: 'chat' },
  { label: 'Embedding', value: 'embedding' },
  { label: 'Rerank', value: 'rerank' },
  { label: 'Image / 图像', value: 'image' },
  { label: 'Audio / 音频', value: 'audio' },
  { label: 'Video / 视频', value: 'video' },
  { label: 'Multimodal / 多模态', value: 'multimodal' },
  { label: 'Task / 异步任务', value: 'task' },
];
const PRICING_UNIT_VALUES = [
  { label: '1M token', value: 'token_1m' },
  { label: 'image', value: 'image' },
  { label: 'video second', value: 'video_second' },
  { label: 'video task', value: 'video_task' },
  { label: 'audio second', value: 'audio_second' },
  { label: 'audio minute', value: 'audio_minute' },
  { label: 'character', value: 'character' },
  { label: 'request', value: 'request' },
  { label: 'search unit', value: 'search_unit' },
  { label: 'Custom', value: 'custom' },
];
const MODALITY_OPTIONS = [
  { label: '文本', value: 'text' },
  { label: '图片', value: 'image' },
  { label: '文件', value: 'file' },
  { label: '音频', value: 'audio' },
  { label: '视频', value: 'video' },
  { label: 'Embedding', value: 'embedding' },
];
const FEATURE_OPTIONS = [
  { label: 'function_call', value: 'function_call' },
  { label: 'function_tools', value: 'function_tools' },
  { label: 'streaming', value: 'streaming' },
  { label: 'streaming_tools', value: 'streaming_tools' },
  { label: 'caching', value: 'caching' },
  { label: 'vision', value: 'vision' },
  { label: 'reasoning', value: 'reasoning' },
  { label: 'embedding', value: 'embedding' },
  { label: 'rerank', value: 'rerank' },
  { label: 'longContext', value: 'longContext' },
  { label: 'tools', value: 'tools' },
  { label: 'json_mode', value: 'json_mode' },
  { label: 'json_schema', value: 'json_schema' },
  { label: 'image_generation', value: 'image_generation' },
  { label: 'image_edit', value: 'image_edit' },
  { label: 'image_variation', value: 'image_variation' },
  { label: 'image_upscale', value: 'image_upscale' },
  { label: 'image_control', value: 'image_control' },
  { label: 'subject_reference', value: 'subject_reference' },
  { label: 'video_generation', value: 'video_generation' },
  { label: 'audio_generation', value: 'audio_generation' },
  { label: 'tts', value: 'tts' },
  { label: 'stt', value: 'stt' },
  { label: 'text_to_speech', value: 'text_to_speech' },
  { label: 'speech_to_text', value: 'speech_to_text' },
  { label: 'speech_translation', value: 'speech_translation' },
  { label: 'speech_to_speech', value: 'speech_to_speech' },
  { label: 'voice_clone', value: 'voice_clone' },
  { label: 'voice_design', value: 'voice_design' },
  { label: 'sound_effects', value: 'sound_effects' },
  { label: 'timestamps', value: 'timestamps' },
  { label: 'diarization', value: 'diarization' },
  { label: 'music_generation', value: 'music_generation' },
  { label: 'async_task', value: 'async_task' },
  { label: 't2v', value: 't2v' },
  { label: 'i2v', value: 'i2v' },
  { label: 'first_last_frame', value: 'first_last_frame' },
  { label: 'reference_to_video', value: 'reference_to_video' },
  { label: 'video_edit', value: 'video_edit' },
  { label: 'video_extend', value: 'video_extend' },
  { label: 'text_to_image', value: 'text_to_image' },
];

function resolveCacheWritePrice(values: {
  cacheWrite5minPriceCents?: number | null;
  cacheWrite1hPriceCents?: number | null;
}): number | null {
  return values.cacheWrite5minPriceCents ?? values.cacheWrite1hPriceCents ?? null;
}

interface PriceTierFormValue {
  tierKey: string;
  displayName?: string | null;
  minInputTokens?: number | null;
  maxInputTokensExclusive?: number | null;
  inputPricePerMToken: number;
  outputPricePerMToken: number;
  cachedInputPrice?: number | null;
  cacheWritePrice?: number | null;
  bandSchedule?: BandScheduleWindow[];
  currency?: string | null;
  rawCondition?: string | null;
  priority?: number | null;
  isActive?: boolean;
}

/** 时段价格档（me/time-based-pricing.md v13.4）：档位与上下文分档二选一 */
const OFF_PEAK_TIER_KEY = 'OFF_PEAK';
type TierMode = 'context' | 'off_peak';
const WEEKDAY_OPTIONS = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
];
// admin 表单预填 DeepSeek 口径——纯前端初始值，引擎无任何回落常量
const DEFAULT_PEAK_WINDOWS: BandScheduleWindow[] = [
  { days: [1, 2, 3, 4, 5], start: '09:00', end: '12:00' },
  { days: [1, 2, 3, 4, 5], start: '14:00', end: '18:00' },
];
const HHMM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function parseBandScheduleForm(raw: unknown): BandScheduleWindow[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const windows: BandScheduleWindow[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return undefined;
    const { days, start, end } = item as Record<string, unknown>;
    if (!Array.isArray(days) || typeof start !== 'string' || typeof end !== 'string') return undefined;
    windows.push({ days: days.map(Number), start, end });
  }
  return windows;
}

function tierModeOf(tiers: PriceTierFormValue[] | null | undefined): TierMode {
  return tiers?.some((tier) => tier?.tierKey === OFF_PEAK_TIER_KEY) ? 'off_peak' : 'context';
}

interface ModelDetailValues {
  // basic
  name: string;
  provider?: string;
  modelId?: string;
  modelType?: string;
  description?: string;
  tags?: string[];
  // capabilities
  inputModalities?: string[];
  outputModalities?: string[];
  contextLength?: number;
  maxOutputTokens?: number;
  supportedFeatures?: string[];
  // v4 调用默认值（不是定价）
  defaultThinkingMode?: 'disabled' | 'enabled' | 'auto';
  defaultThinkingBudget?: number;
  // pricing
  // 兼容旧表单字段名，字段值已是当前部署主币种 / 1M token。
  pricingUnit?: string;
  unitPriceUsd?: number;
  pricingMetadataText?: string;
  inputPriceCents: number;
  outputPriceCents: number;
  cachedInputPriceCents?: number;
  cacheWrite5minPriceCents?: number;
  cacheWrite1hPriceCents?: number;
  priceTiers?: PriceTierFormValue[];
  // status
  isActive: boolean;
  displayOrder?: number;
  releaseAt?: dayjs.Dayjs;
  providerLogo?: string;
}

interface ChannelRecord {
  id: string;
  name: string;
  provider: string;
  priority?: number;
  weight?: number;
  isActive: boolean;
  status?: string;
  models?: unknown;
  modelConfigs?: string | null;
}

interface PerModelConfig {
  enabled?: boolean;
  upstreamModelId?: string;
  routingPriority?: number;
}

type ModelConfigsMap = Record<string, PerModelConfig>;

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toNumber(value: unknown, fallback = 0): number {
  const n = toNullableNumber(value);
  return n ?? fallback;
}

function parseJsonArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parsePriceTiers(raw: unknown, defaultCurrency: string): PriceTierFormValue[] {
  return parseJsonArray(raw)
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    .map((tier, index) => ({
      tierKey: String(tier.tierKey ?? tier.tier_key ?? `tier_${index + 1}`),
      displayName: (tier.displayName ?? tier.display_name ?? null) as string | null,
      minInputTokens: toNumber(tier.minInputTokens ?? tier.min_input_tokens, 0),
      maxInputTokensExclusive: toNullableNumber(
        tier.maxInputTokensExclusive ?? tier.max_input_tokens_exclusive,
      ),
      inputPricePerMToken: toNumber(
        tier.inputPricePerMToken ?? tier.input_price_per_m_token,
        0,
      ),
      outputPricePerMToken: toNumber(
        tier.outputPricePerMToken ?? tier.output_price_per_m_token,
        0,
      ),
      cachedInputPrice: toNullableNumber(tier.cachedInputPrice ?? tier.cached_input_price),
      cacheWritePrice: toNullableNumber(tier.cacheWritePrice ?? tier.cache_write_price),
      bandSchedule: parseBandScheduleForm(tier.bandSchedule ?? tier.band_schedule),
      currency: (tier.currency as string | undefined) ?? defaultCurrency,
      rawCondition: (tier.rawCondition ?? tier.raw_condition ?? null) as string | null,
      priority: toNumber(tier.priority, index),
      isActive: (tier.isActive ?? tier.is_active ?? true) as boolean,
    }));
}

function formatJsonObject(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  try {
    return JSON.stringify(raw, null, 2);
  } catch {
    return '';
  }
}

function parseJsonObjectText(raw?: string): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('pricingMetadata 必须是 JSON 对象');
  }
  return parsed as Record<string, unknown>;
}

function normalizePriceTiersForSubmit(tiers: PriceTierFormValue[] | null | undefined, defaultCurrency: string): PriceTierFormValue[] {
  return (tiers ?? [])
    .filter((tier) => tier?.tierKey?.trim())
    .map((tier, index) => ({
      tierKey: tier.tierKey.trim(),
      displayName: tier.displayName?.trim() || null,
      minInputTokens: tier.minInputTokens ?? 0,
      maxInputTokensExclusive: tier.maxInputTokensExclusive ?? null,
      inputPricePerMToken: tier.inputPricePerMToken,
      outputPricePerMToken: tier.outputPricePerMToken,
      cachedInputPrice: tier.cachedInputPrice ?? null,
      cacheWritePrice: tier.cacheWritePrice ?? null,
      ...(tier.tierKey.trim() === OFF_PEAK_TIER_KEY && tier.bandSchedule
        ? { bandSchedule: tier.bandSchedule }
        : {}),
      currency: tier.currency?.trim() || defaultCurrency,
      rawCondition: tier.rawCondition?.trim() || null,
      priority: tier.priority ?? index,
      isActive: tier.isActive ?? true,
    }));
}

function hasFormValue<K extends keyof ModelDetailValues>(
  values: ModelDetailValues,
  key: K,
): boolean {
  return Object.prototype.hasOwnProperty.call(values, key);
}

function createBlankPriceTier(index: number, values: ModelDetailValues, defaultCurrency: string): PriceTierFormValue {
  return {
    tierKey: index === 0 ? 'default' : `tier_${index + 1}`,
    displayName: index === 0 ? 'Default' : '',
    minInputTokens: index === 0 ? 0 : undefined,
    maxInputTokensExclusive: undefined,
    inputPricePerMToken: values.inputPriceCents ?? 0,
    outputPricePerMToken: values.outputPriceCents ?? 0,
    cachedInputPrice: values.cachedInputPriceCents ?? null,
    cacheWritePrice: resolveCacheWritePrice(values),
    currency: defaultCurrency,
    priority: index,
    isActive: true,
  };
}

function parseChannelModels(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((m): m is string => typeof m === 'string');
  if (raw && typeof raw === 'object') return Object.keys(raw as Record<string, unknown>);
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseChannelModels(JSON.parse(raw));
    } catch {
      return [raw.trim()];
    }
  }
  return [];
}

function parseChannelModelConfigs(raw: unknown): ModelConfigsMap {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: ModelConfigsMap = {};
    for (const [modelName, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const cfg = value as Record<string, unknown>;
      const next: PerModelConfig = {};
      if (cfg.enabled === false) next.enabled = false;
      if (typeof cfg.upstreamModelId === 'string' && cfg.upstreamModelId.trim()) {
        next.upstreamModelId = cfg.upstreamModelId.trim();
      }
      const rawPriority = cfg.routingPriority ?? cfg.routing_priority ?? cfg.priority;
      const routingPriority = Number(rawPriority);
      if (Number.isInteger(routingPriority) && routingPriority >= 1 && routingPriority <= 100) {
        next.routingPriority = routingPriority;
      }
      if (Object.keys(next).length > 0) out[modelName] = next;
    }
    return out;
  } catch {
    return {};
  }
}

function serializeChannelModelConfigs(configs: ModelConfigsMap): string {
  const out: ModelConfigsMap = {};
  for (const [modelName, cfg] of Object.entries(configs)) {
    const compact: PerModelConfig = {};
    if (cfg.enabled === false) compact.enabled = false;
    if (cfg.upstreamModelId?.trim()) compact.upstreamModelId = cfg.upstreamModelId.trim();
    if (typeof cfg.routingPriority === 'number') compact.routingPriority = cfg.routingPriority;
    if (Object.keys(compact).length > 0) out[modelName] = compact;
  }
  return JSON.stringify(out);
}

export default function ModelDetailPage() {
  const { modal, message } = App.useApp();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const platformCurrency = usePlatformCurrency();
  const canManage = usePermission('admin.page.models.manage');
  const canManageChannels = usePermission('admin.page.models.channel_manage');
  const priceInputProps = modelUnitPriceInputProps(platformCurrency);
  const pricingUnitOptions = useMemo(
    () => {
      const symbol = currencySymbol(platformCurrency);
      return PRICING_UNIT_VALUES.map((item) => ({
        ...item,
        label: item.value === 'custom' ? item.label : `${symbol} / ${item.label}`,
      }));
    },
    [platformCurrency],
  );
  const initialTab = searchParams.get('tab') || 'basic';
  const isNew = !id || id === 'new';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [form] = Form.useForm<ModelDetailValues>();
  const [originalName, setOriginalName] = useState<string | null>(null);
  // 能力字段默认只读 — 这些是模型物理属性，避免日常编辑时误改导致漂移。
  // 只有新增模型或修复异常数据时才需要打开此开关手动覆盖。
  const [capabilityOverride, setCapabilityOverride] = useState(false);
  // 档类型二选一：上下文分档 XOR 时段档（OFF_PEAK）——由 priceTiers 现状推导初始值
  const [tierMode, setTierMode] = useState<TierMode>('context');
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [savingChannelConfigId, setSavingChannelConfigId] = useState<string | null>(null);

  const decodedId = useMemo(
    () => (id ? decodeURIComponent(id) : ''),
    [id],
  );

  const loadModel = async () => {
    if (isNew) return;
    setLoading(true);
    try {
      // v1 model-pricing API only returns list; pull and filter by name/id
      const data = await modelPricingApi.list();
      const items = (data?.items || data || []) as Array<Record<string, unknown>>;
      const found = items.find(
        (it) =>
          (it.id as string) === decodedId ||
          ((it.modelName || it.model_name) as string) === decodedId,
      );
      if (!found) {
        message.error('模型不存在');
        return;
      }
      const name = (found.modelName || found.model_name) as string;
      setOriginalName(name);
      // Backend stores arrays as JSON strings (Prisma TEXT). Parse defensively.
      const parseArray = (raw: unknown): string[] => {
        if (Array.isArray(raw)) return raw as string[];
        if (typeof raw === 'string' && raw.length > 0) {
          try {
            const v = JSON.parse(raw);
            return Array.isArray(v) ? v : [];
          } catch {
            return [];
          }
        }
        return [];
      };
      // modelId/model_id is the persisted display-name field. Only fall back
      // to the derived displayName alias when a mixed-version response omits it.
      let storedDisplayName: unknown;
      if (Object.prototype.hasOwnProperty.call(found, 'modelId')) {
        storedDisplayName = found.modelId;
      } else if (Object.prototype.hasOwnProperty.call(found, 'model_id')) {
        storedDisplayName = found.model_id;
      } else {
        storedDisplayName = found.displayName ?? found.display_name;
      }
      const displayName =
        typeof storedDisplayName === 'string' && storedDisplayName.trim().length > 0
          ? storedDisplayName.trim()
          : undefined;
      form.setFieldsValue({
        name,
        modelId: displayName,
        provider: found.provider as string | undefined,
        modelType: (found.modelType ?? found.model_type) as string | undefined,
        description: found.description as string | undefined,
        tags: parseArray(found.tags),
        inputModalities: parseArray(found.inputModalities ?? found.input_modalities),
        outputModalities: parseArray(found.outputModalities ?? found.output_modalities),
        contextLength: (found.contextLength ?? found.context_length) as number | undefined,
        maxOutputTokens: (found.maxOutputTokens ?? found.max_output_tokens) as number | undefined,
        supportedFeatures: parseArray(found.supportedFeatures ?? found.supported_features),
        pricingUnit: (found.pricingUnit ?? found.pricing_unit) as string | undefined,
        unitPriceUsd: (found.unitPriceUsd ?? found.unit_price_usd) as number | undefined,
        pricingMetadataText: formatJsonObject(found.pricingMetadata ?? found.pricing_metadata),
        inputPriceCents: Number(
          found.inputPricePerMToken ?? found.input_price_per_m_token ?? 0,
        ),
        outputPriceCents: Number(
          found.outputPricePerMToken ?? found.output_price_per_m_token ?? 0,
        ),
        cachedInputPriceCents: (found.cachedInputPrice ??
          found.cached_input_price_cents) as number | undefined,
        cacheWrite5minPriceCents: (found.cacheWrite5minPrice ??
          found.cache_write_5min_price_cents ??
          found.cacheWrite1hPrice ??
          found.cache_write_1h_price_cents) as number | undefined,
        cacheWrite1hPriceCents: (found.cacheWrite1hPrice ??
          found.cache_write_1h_price_cents) as number | undefined,
        isActive: (found.isActive ?? found.is_active ?? true) as boolean,
        displayOrder: (found.displayOrder ?? found.display_order) as number | undefined,
        releaseAt: (found.releaseAt ?? found.release_at)
          ? dayjs((found.releaseAt ?? found.release_at) as string)
          : undefined,
        providerLogo: (found.providerLogo ?? found.provider_logo) as string | undefined,
        defaultThinkingMode: (found.defaultThinkingMode ?? found.default_thinking_mode) as
          | 'disabled'
          | 'enabled'
          | 'auto'
          | undefined,
        defaultThinkingBudget: (found.defaultThinkingBudget ??
          found.default_thinking_budget) as number | undefined,
        priceTiers: parsePriceTiers(found.priceTiers ?? found.price_tiers, platformCurrency),
      });
      setTierMode(tierModeOf(parsePriceTiers(found.priceTiers ?? found.price_tiers, platformCurrency)));
    } catch {
      message.error('加载模型失败');
    } finally {
      setLoading(false);
    }
  };

  const loadChannels = async () => {
    setChannelsLoading(true);
    try {
      const pageSize = 100;
      const firstPage = await channelApi.list({ page: 1, pageSize });
      const items = [...(((firstPage?.items ?? []) as ChannelRecord[]) || [])];
      const total = Number(firstPage?.total ?? items.length);
      const totalPages = Math.ceil(total / pageSize);
      for (let page = 2; page <= totalPages; page += 1) {
        const nextPage = await channelApi.list({ page, pageSize });
        items.push(...(((nextPage?.items ?? []) as ChannelRecord[]) || []));
      }
      setChannels(items);
    } catch {
      message.error('加载供应渠道失败');
    } finally {
      setChannelsLoading(false);
    }
  };

  useEffect(() => {
    loadModel();
    loadChannels();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Build an upsert payload from the full form store. Optional fields are only
  // sent when present so unopened tabs cannot clear publish state or tiers.
  const buildUpsertPayload = (
    values: ModelDetailValues,
    modelName: string,
  ): ModelPricingUpsertInput => {
    const cacheWritePrice = resolveCacheWritePrice(values);
    const payload: ModelPricingUpsertInput = {
      modelName,
      inputPricePerMToken: values.inputPriceCents,
      outputPricePerMToken: values.outputPriceCents,
      isActive: values.isActive,
    };
    if (hasFormValue(values, 'provider')) payload.provider = values.provider ?? null;
    if (values.modelId !== undefined || form.isFieldTouched('modelId')) {
      payload.modelId = values.modelId?.trim() || null;
    }
    if (hasFormValue(values, 'modelType')) payload.modelType = values.modelType ?? null;
    if (hasFormValue(values, 'description')) payload.description = values.description ?? null;
    if (hasFormValue(values, 'inputModalities')) payload.inputModalities = values.inputModalities ?? null;
    if (hasFormValue(values, 'outputModalities')) payload.outputModalities = values.outputModalities ?? null;
    if (hasFormValue(values, 'contextLength')) payload.contextLength = values.contextLength ?? null;
    if (hasFormValue(values, 'maxOutputTokens')) payload.maxOutputTokens = values.maxOutputTokens ?? null;
    if (hasFormValue(values, 'providerLogo')) payload.providerLogo = values.providerLogo ?? null;
    if (hasFormValue(values, 'displayOrder')) payload.displayOrder = values.displayOrder ?? 0;
    if (hasFormValue(values, 'releaseAt')) {
      payload.releaseAt = values.releaseAt ? values.releaseAt.toISOString() : null;
    }
    if (hasFormValue(values, 'tags')) payload.tags = values.tags ?? null;
    if (hasFormValue(values, 'supportedFeatures')) {
      payload.supportedFeatures = values.supportedFeatures ?? null;
    }
    if (hasFormValue(values, 'pricingUnit')) payload.pricingUnit = values.pricingUnit ?? null;
    if (hasFormValue(values, 'unitPriceUsd')) payload.unitPriceUsd = values.unitPriceUsd ?? null;
    if (hasFormValue(values, 'pricingMetadataText')) {
      payload.pricingMetadata = parseJsonObjectText(values.pricingMetadataText);
    }
    if (hasFormValue(values, 'cachedInputPriceCents')) {
      payload.cachedInputPrice = values.cachedInputPriceCents ?? null;
    }
    if (
      hasFormValue(values, 'cacheWrite5minPriceCents') ||
      hasFormValue(values, 'cacheWrite1hPriceCents')
    ) {
      payload.cacheWrite5minPrice = cacheWritePrice;
      payload.cacheWrite1hPrice = cacheWritePrice;
    }
    if (Array.isArray(values.priceTiers)) {
      payload.priceTiers = normalizePriceTiersForSubmit(values.priceTiers, platformCurrency);
    }
    if (hasFormValue(values, 'defaultThinkingMode')) {
      payload.defaultThinkingMode = values.defaultThinkingMode ?? null;
    }
    if (hasFormValue(values, 'defaultThinkingBudget')) {
      payload.defaultThinkingBudget = values.defaultThinkingBudget ?? null;
    }
    return payload;
  };

  const getCurrentModelName = () => originalName || form.getFieldValue('name') || decodedId;

  const updateChannelModelConfig = async (
    channel: ChannelRecord,
    modelName: string,
    patch: Partial<PerModelConfig>,
  ) => {
    setSavingChannelConfigId(channel.id);
    try {
      const configs = parseChannelModelConfigs(channel.modelConfigs);
      const nextConfig = { ...(configs[modelName] ?? {}), ...patch };
      Object.keys(nextConfig).forEach((key) => {
        const value = (nextConfig as Record<string, unknown>)[key];
        if (value === undefined || value === null || value === '') {
          delete (nextConfig as Record<string, unknown>)[key];
        }
      });
      if (Object.keys(nextConfig).length > 0) {
        configs[modelName] = nextConfig;
      } else {
        delete configs[modelName];
      }
      await channelApi.update(channel.id, {
        modelConfigs: serializeChannelModelConfigs(configs),
      });
      message.success('已更新渠道模型配置');
      await loadChannels();
    } catch (err: unknown) {
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? '更新渠道模型配置失败');
    } finally {
      setSavingChannelConfigId(null);
    }
  };

  const handleSave = async () => {
    try {
      const validated = await form.validateFields();
      const values = form.getFieldsValue(true) as ModelDetailValues;
      Object.entries(validated).forEach(([key, value]) => {
        if (value !== undefined) {
          (values as unknown as Record<string, unknown>)[key] = value;
        }
      });
      setSaving(true);
      const modelName = isNew ? values.name.trim() : originalName;
      if (!modelName) {
        throw new Error('模型记录尚未加载完成，请稍后重试');
      }
      // PR4: v2 catalog fields are now persisted by the backend.
      await modelPricingApi.upsert(buildUpsertPayload(values, modelName));
      message.success('已保存');
      if (isNew) {
        navigate(`/models/${encodeURIComponent(modelName)}`);
      }
    } catch (err: unknown) {
      if ((err as { errorFields?: unknown })?.errorFields) return;
      const apiMsg =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMsg ?? (err instanceof Error ? err.message : '保存失败'));
    } finally {
      setSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!originalName) return;
    try {
      const values = form.getFieldsValue(true) as ModelDetailValues;
      const copyName = `${originalName}-copy`;
      // Send the full v2 payload (provider/tags/modalities/...) — earlier
      // this only forwarded the four legacy fields and dropped everything
      // else, so a "Copy" of a fully-configured model came back stripped.
      // Force isActive=false so the copy is dormant until user confirms.
      await modelPricingApi.upsert({
        ...buildUpsertPayload(values, copyName),
        isActive: false,
      });
      message.success('已复制');
      navigate(`/models/${encodeURIComponent(copyName)}`);
    } catch {
      message.error('复制失败');
    }
  };

  const handleDelete = () => {
    if (!originalName) return;
    modal.confirm({
      title: `确认从模型库彻底删除 ${originalName}？`,
      content:
        '此操作会从 model_pricing 表中物理删除该模型条目（不可撤销）。如该模型仍被某个套餐引用，删除会被拒绝，请先去对应套餐里移除。',
      okButtonProps: { danger: true },
      okText: '彻底删除',
      cancelText: '取消',
      onOk: async () => {
        try {
          await modelPricingApi.remove(originalName);
          message.success(`已删除 ${originalName}`);
          navigate('/models');
        } catch (err: unknown) {
          const apiMsg =
            (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
          message.error(apiMsg ?? '删除失败');
        }
      },
    });
  };

  const basicTab = (
    <Card loading={loading}>
      <Form.Item
        label="名称"
        name="modelId"
        rules={[{ max: 128, message: '最多 128 个字符' }]}
        extra="仅用于用户侧展示；留空时展示 Model ID，不影响实际渠道调用。"
      >
        <Input placeholder="例如：GPT-4o Mini" maxLength={128} />
      </Form.Item>
      <Form.Item label="Provider" name="provider">
        <Select
          allowClear
          options={PROVIDER_OPTIONS}
          placeholder="选择 provider"
        />
      </Form.Item>
      <Form.Item
        label="Model ID"
        name="name"
        rules={[{ required: true, whitespace: true, message: '必填' }]}
        extra="用于 API 请求、渠道路由与计费匹配，创建后不可修改。"
      >
        <Input placeholder="gpt-4o-mini" disabled={!isNew} />
      </Form.Item>
      <Form.Item label="模型类型" name="modelType">
        <Select
          allowClear
          options={MODEL_TYPE_OPTIONS}
          placeholder="chat / video / image ..."
        />
      </Form.Item>
      <Form.Item label="描述（Markdown）" name="description">
        <Input.TextArea rows={4} placeholder="模型描述..." />
      </Form.Item>
      <Form.Item label="标签" name="tags">
        <Select
          mode="tags"
          placeholder="选择或自定义标签"
          options={TAG_OPTIONS.map((t) => ({ label: t, value: t }))}
        />
      </Form.Item>
    </Card>
  );

  const capabilityTab = (
    <Card
      loading={loading}
      title={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>模型能力</span>
          <Space size={8}>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 400 }}>
              {capabilityOverride ? '⚠️ 手动覆盖中' : '只读'}
            </span>
            <Switch
              size="small"
              checked={capabilityOverride}
              disabled={!canManage}
              onChange={setCapabilityOverride}
              checkedChildren="可改"
              unCheckedChildren="只读"
            />
          </Space>
        </div>
      }
    >
      {!capabilityOverride && (
        <div
          style={{
            marginBottom: 16,
            padding: '10px 12px',
            background: '#f0f5ff',
            border: '1px solid #adc6ff',
            borderRadius: 6,
            fontSize: 12,
            color: '#4b5563',
            lineHeight: 1.7,
          }}
        >
          模型能力字段（模态、上下文、最大输出、支持能力）是模型物理属性，默认不随价格编辑修改。
          <br />
          一般不需要运营手改。仅在新增模型或需修复异常数据时打开右上角开关手动编辑。
        </div>
      )}

      <Form.Item label="输入模态" name="inputModalities">
        <Checkbox.Group options={MODALITY_OPTIONS} disabled={!capabilityOverride} />
      </Form.Item>
      <Form.Item label="输出模态" name="outputModalities">
        <Checkbox.Group options={MODALITY_OPTIONS} disabled={!capabilityOverride} />
      </Form.Item>
      <Space size="large">
        <Form.Item label="上下文长度 (tokens)" name="contextLength">
          <StableNumberInput
            min={0}
            precision={0}
            step={1000}
            style={{ width: 200 }}
            disabled={!capabilityOverride}
          />
        </Form.Item>
        <Form.Item label="最大输出 (tokens)" name="maxOutputTokens">
          <StableNumberInput
            min={0}
            precision={0}
            step={1000}
            style={{ width: 200 }}
            disabled={!capabilityOverride}
          />
        </Form.Item>
      </Space>
      <Form.Item label="支持能力" name="supportedFeatures">
        <Checkbox.Group options={FEATURE_OPTIONS} disabled={!capabilityOverride} />
      </Form.Item>

      {/* v4: 平台调用策略 — 始终可编辑（不属于模型物理属性，是运营对该模型的策略选择） */}
      <div
        style={{
          marginTop: 24,
          padding: '12px 16px',
          background: '#fafafa',
          borderRadius: 6,
          fontSize: 13,
          color: '#4b5563',
        }}
      >
        <strong>Thinking 默认（平台策略 · 始终可改）</strong>
        <span style={{ marginLeft: 8, color: '#9ca3af' }}>
          仅 Anthropic / Gemini 系列生效。OpenAI o-系列 / gpt-5 codex 的 reasoning_effort
          属于用户/请求级参数，由 agent 每次调用时传，不在这里设。
        </span>
      </div>
      <Space size="large" wrap style={{ marginTop: 12 }}>
        <Form.Item
          label="思考模式 (thinking mode)"
          name="defaultThinkingMode"
          tooltip="Anthropic / Gemini thinking 开关。auto = 模型自决；enabled = 强制开；disabled = 关闭。"
          style={{ minWidth: 200 }}
        >
          <Select
            allowClear
            placeholder="不指定（保持上游默认）"
            options={[
              { value: 'disabled', label: '关闭' },
              { value: 'enabled', label: '强制开启' },
              { value: 'auto', label: '自动' },
            ]}
            style={{ width: 200 }}
          />
        </Form.Item>
        <Form.Item
          label="Thinking 预算 (tokens)"
          name="defaultThinkingBudget"
          tooltip="Claude 0-24000，Gemini 0-32768。0 = 不消耗 thinking token"
        >
          <StableNumberInput min={0} max={32768} precision={0} step={1024} style={{ width: 200 }} />
        </Form.Item>
      </Space>
    </Card>
  );

  const pricingTab = (
    <Card loading={loading}>
      <Space size="large" wrap>
        <Form.Item label="计价单位" name="pricingUnit">
          <Select
            allowClear
            options={pricingUnitOptions}
            placeholder="选择计价单位"
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item
          label={`非 token 单价 (${platformCurrency})`}
          name="unitPriceUsd"
          tooltip="用于视频任务、图片张数、音频秒数等非 token 计费；token 模型可留空。"
        >
          <StableNumberInput
            {...priceInputProps}
            style={{ width: 220 }}
          />
        </Form.Item>
      </Space>
      <Space size="large" wrap>
        <Form.Item
          label={`input (${platformCurrency} / 1M token)`}
          name="inputPriceCents"
          rules={[{ required: true, type: 'number', min: 0 }]}
        >
          <StableNumberInput
            {...priceInputProps}
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item
          label={`output (${platformCurrency} / 1M token)`}
          name="outputPriceCents"
          rules={[{ required: true, type: 'number', min: 0 }]}
        >
          <StableNumberInput
            {...priceInputProps}
            style={{ width: 220 }}
          />
        </Form.Item>
      </Space>
      <Space size="large" wrap>
        <Form.Item
          label={`cache read (${platformCurrency} / 1M token)`}
          name="cachedInputPriceCents"
          tooltip="缓存命中读取时的 cache read 价格。"
        >
          <StableNumberInput
            {...priceInputProps}
            style={{ width: 220 }}
          />
        </Form.Item>
        <Form.Item
          label={`cache write (${platformCurrency} / 1M token)`}
          name="cacheWrite5minPriceCents"
          tooltip="缓存创建/写入时的 cache write 价格。"
        >
          <StableNumberInput
            {...priceInputProps}
            style={{ width: 220 }}
          />
        </Form.Item>
      </Space>
      <Form.Item
        label="计价元数据 (JSON)"
        name="pricingMetadataText"
        tooltip="可记录 resolution、duration、endpoint、modes 等厂商规格，必须是 JSON 对象。"
      >
        <Input.TextArea
          rows={4}
          placeholder={'{\n  "endpoint": "/v1/video_generation",\n  "modes": ["t2v", "i2v"]\n}'}
          style={{ fontFamily: 'monospace' }}
        />
      </Form.Item>
      <Form.List name="priceTiers">
        {(fields, { add, remove }) => (
          <div style={{ marginTop: 24 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <Typography.Title level={5} style={{ margin: 0 }}>
                  价格档
                </Typography.Title>
                <Typography.Text type="secondary">
                  {tierMode === 'off_peak'
                    ? '按请求开始时刻所处时段计价：空闲时段命中下方档位价；其余（高峰）时段用上面的基础价格。'
                    : '按本次请求的 input tokens 命中价格档；没有命中时使用上面的基础价格。'}
                </Typography.Text>
              </div>
              <Space>
                <Radio.Group
                  value={tierMode}
                  disabled={!canManage}
                  onChange={(e) => {
                    const next = e.target.value as TierMode;
                    if (next === tierMode) return;
                    const apply = () => {
                      if (next === 'off_peak') {
                        const values = form.getFieldsValue() as ModelDetailValues;
                        form.setFieldValue('priceTiers', [{
                          tierKey: OFF_PEAK_TIER_KEY,
                          displayName: '空闲时段价',
                          minInputTokens: 0,
                          maxInputTokensExclusive: null,
                          inputPricePerMToken: values.inputPriceCents ?? 0,
                          outputPricePerMToken: values.outputPriceCents ?? 0,
                          cachedInputPrice: values.cachedInputPriceCents ?? values.inputPriceCents ?? 0,
                          cacheWritePrice: resolveCacheWritePrice(values) ?? values.inputPriceCents ?? 0,
                          bandSchedule: DEFAULT_PEAK_WINDOWS.map((window) => ({ ...window, days: [...window.days] })),
                          currency: platformCurrency,
                          priority: 0,
                          isActive: true,
                        } satisfies PriceTierFormValue]);
                      } else {
                        form.setFieldValue('priceTiers', []);
                      }
                      setTierMode(next);
                    };
                    if (fields.length > 0) {
                      modal.confirm({
                        title: '切换档类型将清空现有价格档',
                        content: '一个模型的档位二选一：要么上下文分档、要么时段档。切换将清空当前 ' + fields.length + ' 个档位（保存后生效）。',
                        okText: '切换并清空',
                        cancelText: '取消',
                        onOk: apply,
                      });
                    } else {
                      apply();
                    }
                  }}
                  options={[
                    { label: '上下文分档', value: 'context' },
                    { label: '时段档（OFF_PEAK）', value: 'off_peak' },
                  ]}
                  optionType="button"
                />
                {tierMode === 'context' && (
                  <Button
                    icon={<PlusOutlined />}
                    disabled={!canManage}
                    onClick={() => {
                      add(createBlankPriceTier(fields.length, form.getFieldsValue() as ModelDetailValues, platformCurrency));
                    }}
                  >
                    添加价格档
                  </Button>
                )}
              </Space>
            </div>
            {tierMode === 'off_peak' && fields.length > 0 && (
              <div
                style={{
                  border: '1px solid #b7dfca',
                  borderRadius: 6,
                  padding: 12,
                  background: '#f4fbf7',
                  marginBottom: 12,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <Typography.Text strong>OFF_PEAK 空闲时段价（四价必填；上方基础价格 = 高峰价）</Typography.Text>
                  <Form.Item label="启用" name={[0, 'isActive']} valuePropName="checked" style={{ marginBottom: 0 }}>
                    <Switch size="small" />
                  </Form.Item>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '0 12px' }}>
                  <Form.Item
                    label={'input (' + platformCurrency + ' / 1M)'}
                    name={[0, 'inputPricePerMToken']}
                    rules={[{ required: true, type: 'number', min: 0, message: '必填' }]}
                  >
                    <StableNumberInput {...priceInputProps} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label={'output (' + platformCurrency + ' / 1M)'}
                    name={[0, 'outputPricePerMToken']}
                    rules={[{ required: true, type: 'number', min: 0, message: '必填' }]}
                  >
                    <StableNumberInput {...priceInputProps} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label={'cache read (' + platformCurrency + ' / 1M)'}
                    name={[0, 'cachedInputPrice']}
                    rules={[{ required: true, type: 'number', min: 0, message: '时段档四价必填' }]}
                  >
                    <StableNumberInput {...priceInputProps} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item
                    label={'cache write (' + platformCurrency + ' / 1M)'}
                    name={[0, 'cacheWritePrice']}
                    rules={[{ required: true, type: 'number', min: 0, message: '时段档四价必填' }]}
                  >
                    <StableNumberInput {...priceInputProps} style={{ width: '100%' }} />
                  </Form.Item>
                </div>
                <Form.Item noStyle shouldUpdate>
                  {() => {
                    // 高峰基价 vs 空闲档价并排 + 实际比例（仅提示不强校验，各维度比例本就可不同）
                    const values = form.getFieldsValue() as ModelDetailValues;
                    const tier = (values.priceTiers ?? [])[0];
                    const rows: Array<[string, number | null | undefined, number | null | undefined]> = [
                      ['input', values.inputPriceCents, tier?.inputPricePerMToken],
                      ['output', values.outputPriceCents, tier?.outputPricePerMToken],
                      ['cache read', values.cachedInputPriceCents, tier?.cachedInputPrice],
                      ['cache write', resolveCacheWritePrice(values), tier?.cacheWritePrice],
                    ];
                    return (
                      <div style={{ margin: '4px 0 12px', fontSize: 12, color: '#6b7280' }}>
                        {rows.map(([label, peak, offPeak]) => {
                          const ratio = peak && peak > 0 && offPeak != null
                            ? Math.round((offPeak / peak) * 100) + '%'
                            : '—';
                          return (
                            <span key={label} style={{ marginRight: 16 }}>
                              {label}: 高峰 {peak ?? '—'} / 空闲 {offPeak ?? '—'}（{ratio}）
                            </span>
                          );
                        })}
                      </div>
                    );
                  }}
                </Form.Item>
                <Typography.Text strong>高峰窗口（band_schedule，必填 1-8 个）</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
                  存的是高峰窗口，其余时间=空闲；时区 Asia/Shanghai；左闭右开（09:00:00 计高峰、12:00:00 计空闲）；同日窗口不得重叠。预填 DeepSeek 口径，仅为初始值。
                </Typography.Paragraph>
                <Form.List
                  name={[0, 'bandSchedule']}
                  rules={[{
                    // 与后端 validateBandSchedule 等价的前端预检（后端仍是最终防线）
                    validator: async (_, windows) => {
                      if (!Array.isArray(windows) || windows.length < 1 || windows.length > 8) {
                        throw new Error('高峰窗口需要 1-8 个');
                      }
                      const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
                      for (const window of windows as BandScheduleWindow[]) {
                        if (!window || !Array.isArray(window.days) || window.days.length === 0) {
                          throw new Error('每个窗口需选择至少一天');
                        }
                        if (new Set(window.days).size !== window.days.length) {
                          throw new Error('同一窗口内星期不可重复');
                        }
                        if (!HHMM_RE.test(window.start ?? '') || !HHMM_RE.test(window.end ?? '')) return;
                        if (toMinutes(window.start) >= toMinutes(window.end)) {
                          throw new Error('需要 start < end（跨午夜请拆成两个窗口）');
                        }
                      }
                      for (let day = 1; day <= 7; day += 1) {
                        const ranges = (windows as BandScheduleWindow[])
                          .filter((w) => Array.isArray(w?.days) && w.days.includes(day)
                            && HHMM_RE.test(w.start ?? '') && HHMM_RE.test(w.end ?? ''))
                          .map((w) => [toMinutes(w.start), toMinutes(w.end)] as const)
                          .sort((a, b) => a[0] - b[0]);
                        for (let i = 1; i < ranges.length; i += 1) {
                          if (ranges[i][0] < ranges[i - 1][1]) {
                            throw new Error('同一天的高峰窗口存在重叠');
                          }
                        }
                      }
                    },
                  }]}
                >
                  {(windowFields, windowOps, { errors }) => (
                    <div style={{ display: 'grid', gap: 8 }}>
                      {windowFields.map((windowField) => (
                        <Space key={windowField.key} align="baseline" wrap>
                          <Form.Item
                            name={[windowField.name, 'days']}
                            rules={[{ required: true, message: '选择星期' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Select
                              mode="multiple"
                              options={WEEKDAY_OPTIONS}
                              placeholder="星期"
                              style={{ minWidth: 220 }}
                            />
                          </Form.Item>
                          <Form.Item
                            name={[windowField.name, 'start']}
                            rules={[{ required: true, pattern: HHMM_RE, message: 'HH:mm' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="09:00" style={{ width: 90 }} />
                          </Form.Item>
                          <Typography.Text type="secondary">→</Typography.Text>
                          <Form.Item
                            name={[windowField.name, 'end']}
                            rules={[{ required: true, pattern: HHMM_RE, message: 'HH:mm' }]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="12:00" style={{ width: 90 }} />
                          </Form.Item>
                          <Button
                            danger
                            type="text"
                            icon={<DeleteOutlined />}
                            disabled={!canManage || windowFields.length <= 1}
                            onClick={() => windowOps.remove(windowField.name)}
                          />
                        </Space>
                      ))}
                      <div>
                        <Button
                          size="small"
                          disabled={!canManage || windowFields.length >= 8}
                          onClick={() => windowOps.add({ days: [], start: '', end: '' })}
                        >
                          + 添加窗口
                        </Button>
                      </div>
                      <Form.ErrorList errors={errors} />
                    </div>
                  )}
                </Form.List>
              </div>
            )}
            <div style={{ display: tierMode === 'off_peak' ? 'none' : 'grid', gap: 12 }}>
              {fields.length === 0 ? (
                <div
                  style={{
                    padding: '16px 18px',
                    border: '1px dashed #d9d9d9',
                    borderRadius: 6,
                    color: '#6b7280',
                    background: '#fafafa',
                  }}
                >
                  暂未配置价格档。当前模型会始终使用基础 input/output 价格。
                </div>
              ) : (
                fields.map((field) => (
                  <div
                    key={field.key}
                    style={{
                      border: '1px solid #e5e7eb',
                      borderRadius: 6,
                      padding: 12,
                      background: '#fff',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 12,
                      }}
                    >
                      <Space size={12} wrap>
                        <Form.Item
                          label="tier key"
                          name={[field.name, 'tierKey']}
                          rules={[{ required: true, message: '必填' }]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="default" style={{ width: 180 }} />
                        </Form.Item>
                        <Form.Item
                          label="显示名"
                          name={[field.name, 'displayName']}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="0-128K" style={{ width: 160 }} />
                        </Form.Item>
                      </Space>
                      <Space size={12}>
                        <Form.Item
                          label="启用"
                          name={[field.name, 'isActive']}
                          valuePropName="checked"
                          style={{ marginBottom: 0 }}
                        >
                          <Switch size="small" />
                        </Form.Item>
                        <Button
                          danger
                          type="text"
                          icon={<DeleteOutlined />}
                          disabled={!canManage}
                          onClick={() => remove(field.name)}
                        >
                          删除
                        </Button>
                      </Space>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '0 12px',
                      }}
                    >
                      <Form.Item
                        label="min input tokens"
                        name={[field.name, 'minInputTokens']}
                        rules={[{ required: true, type: 'number', min: 0, message: '请输入非负整数' }]}
                      >
                        <StableNumberInput min={0} precision={0} step={1000} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        label="max input tokens（不含）"
                        name={[field.name, 'maxInputTokensExclusive']}
                        tooltip="留空表示无上限。"
                        rules={[
                          {
                            validator: async (_, value) => {
                              if (value === null || value === undefined || value === '') return;
                              const min = form.getFieldValue(['priceTiers', field.name, 'minInputTokens']);
                              if (Number(value) <= Number(min ?? 0)) {
                                throw new Error('必须大于 min input tokens');
                              }
                            },
                          },
                        ]}
                      >
                        <StableNumberInput min={1} precision={0} step={1000} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item
                        label={`input (${platformCurrency} / 1M)`}
                        name={[field.name, 'inputPricePerMToken']}
                        rules={[{ required: true, type: 'number', min: 0, message: '必填' }]}
                      >
                        <StableNumberInput
                          {...priceInputProps}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item
                        label={`output (${platformCurrency} / 1M)`}
                        name={[field.name, 'outputPricePerMToken']}
                        rules={[{ required: true, type: 'number', min: 0, message: '必填' }]}
                      >
                        <StableNumberInput
                          {...priceInputProps}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item label={`cache read (${platformCurrency} / 1M)`} name={[field.name, 'cachedInputPrice']}>
                        <StableNumberInput
                          {...priceInputProps}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item label={`cache write (${platformCurrency} / 1M)`} name={[field.name, 'cacheWritePrice']}>
                        <StableNumberInput
                          {...priceInputProps}
                          style={{ width: '100%' }}
                        />
                      </Form.Item>
                      <Form.Item label="优先级" name={[field.name, 'priority']}>
                        <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="币种" name={[field.name, 'currency']}>
                        <Input placeholder={platformCurrency} style={{ width: '100%' }} />
                      </Form.Item>
                    </div>
                    <Form.Item
                      label="原始条件/备注"
                      name={[field.name, 'rawCondition']}
                      style={{ marginBottom: 0 }}
                    >
                      <Input placeholder="input_tokens >= 128000" />
                    </Form.Item>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </Form.List>
    </Card>
  );

  const statusTab = (
    <Card loading={loading}>
      <Form.Item label="启用 (isActive)" name="isActive" valuePropName="checked">
        <Switch />
      </Form.Item>
      <Form.Item label="目录顺序 (displayOrder)" name="displayOrder">
        <StableNumberInput min={0} precision={0} style={{ width: 160 }} />
      </Form.Item>
      <Form.Item label="发布时间" name="releaseAt">
        <DatePicker showTime style={{ width: 240 }} />
      </Form.Item>
      <Form.Item label="Provider Logo URL" name="providerLogo">
        <Input placeholder="https://..." />
      </Form.Item>
    </Card>
  );

  const usageTab = (
    <Card>
      <EmptyPlaceholder
        title="用量统计待后端聚合"
        description="此 Tab 将显示该模型的用量趋势和分布。"
        todos={[
          '30 天调用趋势 (按天聚合 token 用量)',
          'Top 10 用户 (该模型贡献最多调用)',
          'Top 10 渠道 (路由到该模型的 channel)',
        ]}
      />
    </Card>
  );

  const modelChannelRows = channels.filter((channel) =>
    parseChannelModels(channel.models).includes(getCurrentModelName()),
  );

  const relationsTab = (
    <Card loading={channelsLoading}>
      {modelChannelRows.length === 0 ? (
        <EmptyPlaceholder
          title="暂无供应渠道"
          description="当前模型还没有配置到任何渠道。"
          todos={['到渠道管理里拉取或手动加入此模型']}
        />
      ) : (
        <List
          dataSource={modelChannelRows}
          renderItem={(channel) => {
            const modelName = getCurrentModelName();
            const cfg = parseChannelModelConfigs(channel.modelConfigs)[modelName] ?? {};
            const disabled = savingChannelConfigId === channel.id;
            return (
              <List.Item
                actions={[
                  <Space key="priority" size={8}>
                    <Typography.Text type="secondary">优先级</Typography.Text>
                    <StableNumberInput
                      min={1}
                      max={100}
                      precision={0}
                      value={cfg.routingPriority}
                      placeholder={String(channel.priority ?? 5)}
                      disabled={disabled || !canManageChannels}
                      onChange={(value) =>
                        updateChannelModelConfig(channel, modelName, {
                          routingPriority: typeof value === 'number' ? value : undefined,
                        })
                      }
                      style={{ width: 96 }}
                    />
                  </Space>,
                  <Space key="enabled" size={8}>
                    <Typography.Text type="secondary">启用</Typography.Text>
                    <Switch
                      size="small"
                      checked={cfg.enabled !== false}
                      disabled={disabled || !canManageChannels}
                      onChange={(enabled) =>
                        updateChannelModelConfig(channel, modelName, { enabled })
                      }
                    />
                  </Space>,
                ]}
              >
                <List.Item.Meta
                  title={
                    <Space size={8}>
                      <span>{channel.name}</span>
                      <Tag>{channel.provider}</Tag>
                      {channel.isActive ? <Tag variant="success">启用</Tag> : <Tag variant="muted">停用</Tag>}
                    </Space>
                  }
                  description={
                    <Space size={16} wrap>
                      <span>渠道优先级: {channel.priority ?? '—'}</span>
                      <span>权重: {channel.weight ?? '—'}</span>
                      <span>上游模型: {cfg.upstreamModelId || modelName}</span>
                    </Space>
                  }
                />
              </List.Item>
            );
          }}
        />
      )}
    </Card>
  );

  const tabs = [
    { key: 'basic', label: '基本信息', children: basicTab },
    { key: 'capability', label: '能力', children: capabilityTab },
    { key: 'pricing', label: '定价', children: pricingTab },
    { key: 'status', label: '状态', children: statusTab },
    { key: 'usage', label: '用量', children: usageTab },
    { key: 'relations', label: '关联', children: relationsTab },
  ];

  return (
    <div>
      <PageHeader
        title={isNew ? '新建模型' : originalName ?? '模型详情'}
        subtitle={isNew ? '创建一个新的模型条目' : '编辑模型目录、能力与基础定价'}
        breadcrumb={[
          { label: '模型库', to: '/models' },
          isNew ? '新建' : originalName ?? '...',
        ]}
        actions={[
          <Button
            key="back"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/models')}
          >
            返回
          </Button>,
          ...(isNew
            ? []
            : [
                <Button
                  key="copy"
                  icon={<CopyOutlined />}
                  disabled={!canManage}
                  onClick={handleCopy}
                >
                  复制
                </Button>,
                <Button
                  key="delete"
                  danger
                  icon={<DeleteOutlined />}
                  disabled={!canManage}
                  onClick={handleDelete}
                >
                  删除
                </Button>,
              ]),
        ]}
      />

      {!isNew && originalName === null && !loading ? (
        <EmptyPlaceholder
          title="模型不存在"
          description="该模型可能已被删除。"
          action={
            <Button onClick={() => navigate('/models')}>返回列表</Button>
          }
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          disabled={activeTab === 'relations' ? !canManageChannels : !canManage}
          initialValues={{
            isActive: true,
            inputPriceCents: 0,
            outputPriceCents: 0,
            modelType: 'chat',
            pricingUnit: 'token_1m',
            priceTiers: [],
            inputModalities: ['text'],
            outputModalities: ['text'],
          }}
        >
          <Tabs
            activeKey={activeTab}
            onChange={setActiveTab}
            items={tabs}
          />

          {/* sticky footer */}
          <div
            style={{
              position: 'sticky',
              bottom: 0,
              background: 'var(--bg-canvas, #fff)',
              borderTop: '1px solid var(--border-default, #eee)',
              padding: '12px 16px',
              marginTop: 16,
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 8,
              zIndex: 10,
            }}
          >
            <Button disabled={false} onClick={() => navigate('/models')}>取消</Button>
            <Button type="primary" loading={saving} disabled={!canManage} onClick={handleSave}>
              保存
            </Button>
          </div>
        </Form>
      )}
    </div>
  );
}
