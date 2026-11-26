import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  App,
  Alert,
  Button,
  Collapse,
  Descriptions,
  Divider,
  Drawer,
  Modal,
  Form,
  Input,
  List,
  Select,
  Space,
  Popconfirm,
  Switch,
  Tabs,
  Tooltip,
  Typography,
} from 'antd';
import {
  PlusOutlined,
  ThunderboltOutlined,
  DeleteOutlined,
  EditOutlined,
  CloudDownloadOutlined,
  SettingOutlined,
  ApiOutlined,
  HeartOutlined,
  WarningOutlined,
  LineChartOutlined,
  ReloadOutlined,
  IdcardOutlined,
} from '@ant-design/icons';
import type {
  CHANNEL_CLIENT_COMPATIBILITIES,
  CHANNEL_PROTOCOL_PATH_CHANNELS,
  CHANNEL_PROVIDER_PROFILES,
  CHANNEL_SERVED_INBOUND_PROTOCOLS,
  CHANNEL_SDK_TYPES,
} from '@ruidong/shared';
import {
  PageHeader,
  StatCard,
  StatCardGroup,
  FilterBar,
  DataTable,
  StableNumberInput,
  Tag,
} from '../../components/common';
import {
  channelApi,
  providerAccountIdentityApi,
  productApi,
  publisherSyncMessage,
  publisherWarningsText,
  type ChannelProtocolTemplatesResponse,
  type CreateProviderAccountIdentityInput,
  type ProviderAccountIdentity,
  type ProductChannelGroupInput,
  type ProductChannelGroupMemberInput,
  type ProductChannelGroupRow,
  type ProductChannelRouteInput,
  type ProductChannelRouteRow,
  type ProductRouteAssignmentInput,
  type ProductRouteAssignmentRow,
  type ProductRouteGraphPreview,
  type ProductRuntimePolicyChannel,
  type ProtocolPath,
} from '../../api/admin';
import { ProtocolPathList, suggestedProtocolChannel } from '../../components/common/ProtocolPathList';
import { userSegmentApi, type UserSegment } from '../../api/v2';
import { usePermission } from '../../hooks/usePermission';
import {
  isProviderAccountIdentityActive,
  normalizeProviderCode,
  providerAccountIdentitiesForProvider,
  providerAccountIdentitySelectionError,
} from '../../utils/providerAccountIdentities';
import './Channels.css';

interface ChannelRecord {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  priority?: number;
  weight?: number;
  successRate?: number;
  totalReqs?: number;
  isActive: boolean;
  status?: string;
  sdkType?: string;
  providerProfile?: string | null;
  clientCompatibility?: string | string[] | null;
  servedInboundProtocols?: string | string[] | null;
  protocolPaths?: ProtocolPath[] | null;
  tokenCountStrategy?: string | null;
  ownedBy?: string | null;
  providerAccountIdentityId?: string | null;
  providerAccountIdentity?: ProviderAccountIdentity | null;
  models?: unknown;
  /** Per-model JSON 配置，shape 见 api/src/channel/model-configs.ts */
  modelConfigs?: string | null;
  apiKey?: string;
  remark?: string;
}

type BillingMode = 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';

interface ProductRecord {
  id: string;
  name: string;
  slug: string;
  billingMode: BillingMode | string;
  isActive: boolean;
}

type ProductRouteChannel = ProductChannelRouteRow & {
  productId: string;
  channelId: string;
  displayName?: string | null;
  status: 'active' | 'disabled' | 'testing' | string;
  isDefault?: boolean;
  allowedModels?: string[] | null;
  deniedModels?: string[] | null;
  priority?: number;
  weight?: number;
  maxRpm?: number | null;
  maxTpm?: number | null;
  metadata?: Record<string, unknown> | null;
  channel?: ProductRuntimePolicyChannel;
};

type ProductRouteGroup = ProductChannelGroupRow & {
  productId: string;
  code: string;
  name: string;
  strategy: string;
  isDefault?: boolean;
  status: 'active' | 'disabled' | string;
  members?: ProductRouteGroupMember[];
};

type ProductRouteGroupMember = {
  id: string;
  groupId: string;
  productChannelId: string;
  priority?: number;
  weight?: number;
  role?: string;
  maxRpm?: number | null;
  maxTpm?: number | null;
  productChannel?: ProductRouteChannel;
};

type ProductRouteAssignment = ProductRouteAssignmentRow & {
  productId: string;
  subjectType: 'USER' | 'USER_SEGMENT' | string;
  subjectId: string;
  modelPattern?: string | null;
  clientCompatibility?: string | null;
  targetType: 'GROUP' | 'PRODUCT_CHANNEL' | string;
  targetId: string;
  mode: 'ONLY' | 'PREFER' | string;
  priority?: number;
  startsAt?: string | null;
  endsAt?: string | null;
  isActive?: boolean;
  reason?: string | null;
};

const DEFAULT_SERVED_INBOUND_PROTOCOLS = ['openai'];
type RuntimeContract = ChannelProtocolTemplatesResponse['contract'];

const EMPTY_RUNTIME_CONTRACT: RuntimeContract = {
  providerProfiles: [],
  clientCompatibilities: [],
  inboundProtocols: [],
  tokenCountStrategies: [],
  profileCapabilities: {},
};

const PROVIDER_OPTIONS = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'zhipu', label: '智谱 AI' },
  { value: 'qwen', label: '阿里云/Qwen' },
  { value: 'google', label: 'Google/Gemini' },
  { value: 'mistral', label: 'Mistral' },
  { value: 'kimi', label: 'Kimi / Moonshot' },
  { value: 'minimax', label: 'MiniMax' },
  { value: 'doubao', label: 'Doubao / 火山文本' },
  { value: 'seedance', label: 'Seedance / 火山视频' },
  { value: 'runway', label: 'Runway' },
  { value: 'kling', label: 'Kling / 可灵' },
  { value: 'stability', label: 'Stability AI' },
  { value: 'fal', label: 'fal.ai' },
  { value: 'elevenlabs', label: 'ElevenLabs' },
  { value: 'other', label: '其他' },
];

const SDK_TYPE_LABEL: Record<(typeof CHANNEL_SDK_TYPES)[number], string> = {
  openai_compatible: 'OpenAI Compatible (All CLI/API)',
  openai_completions: 'OpenAI Chat Completions (Legacy)',
  openai_responses: 'OpenAI Responses',
  openai_completions_with_tools: 'OpenAI Chat Completions + Tools',
  anthropic: 'Anthropic Messages',
  gemini: 'Gemini Native',
  glm: 'GLM / 智谱原生',
  doubao: 'Doubao / 火山原生',
  azure: 'Azure OpenAI',
  cohere_v2: 'Cohere v2',
  minimax_video: 'MiniMax Video (Hailuo)',
  seedance_video: 'Seedance Video',
  runway_video: 'Runway Video',
  kling_video: 'Kling Video',
  openai_image: 'OpenAI Images',
  minimax_image: 'MiniMax Image',
  stability_image: 'Stability Image',
  fal_image: 'fal.ai Image',
  openai_audio: 'OpenAI Audio',
  elevenlabs_audio: 'ElevenLabs Audio',
  minimax_audio: 'MiniMax Speech',
  minimax_music: 'MiniMax Music',
  video_generation: 'Video Generation (Generic)',
  image_generation: 'Image Generation (Generic)',
  audio_generation: 'Audio Generation (Generic)',
  tts: 'Text to Speech (Generic)',
  stt: 'Speech to Text (Generic)',
  music_generation: 'Music Generation (Generic)',
};

const SDK_TYPE_OPTIONS = (Object.keys(SDK_TYPE_LABEL) as Array<keyof typeof SDK_TYPE_LABEL>)
  .map((value) => ({ value, label: SDK_TYPE_LABEL[value] }));

const SDK_TYPE_LABELS: ReadonlyMap<string, string> = new Map(
  SDK_TYPE_OPTIONS.map((option) => [option.value, option.label]),
);

function sdkTypeLabel(value?: string): string {
  if (!value) return '';
  return SDK_TYPE_LABELS.get(value) ?? value;
}

const PROVIDER_PROFILE_LABEL: Record<(typeof CHANNEL_PROVIDER_PROFILES)[number], string> = {
  openai_compatible: 'OpenAI Compatible',
  anthropic_native: 'Anthropic Native',
  openai_native: 'OpenAI Native',
  openai_responses_native: 'OpenAI Responses Native',
  azure_openai: 'Azure OpenAI',
  gemini_native: 'Gemini Native',
  doubao_ark: 'Doubao Ark',
  glm: 'GLM',
  glm_coding: 'GLM Coding',
  cohere_v2: 'Cohere v2',
};

const CLIENT_COMPATIBILITY_LABEL: Record<(typeof CHANNEL_CLIENT_COMPATIBILITIES)[number], string> = {
  all: 'All clients',
  claude_code: 'Claude Code',
  codex: 'Codex',
  openai_sdk: 'OpenAI SDK',
  openclaw: 'OpenClaw',
  gemini_cli: 'Gemini CLI',
  cursor: 'Cursor',
  cline: 'Cline',
  cherrystudio: 'Cherry Studio',
  dify: 'Dify',
};

const SERVED_INBOUND_PROTOCOL_LABEL: Record<(typeof CHANNEL_SERVED_INBOUND_PROTOCOLS)[number], string> = {
  openai: 'OpenAI Chat',
  anthropic: 'Anthropic Messages',
  responses: 'OpenAI Responses',
  gemini: 'Gemini',
};

const PROTOCOL_PATH_CHANNEL_LABEL: Record<(typeof CHANNEL_PROTOCOL_PATH_CHANNELS)[number], string> = {
  passthrough: 'passthrough · 原生直连',
  responses_to_chat: 'responses_to_chat · responses→chat 桥',
  anthropic_to_chat: 'anthropic_to_chat · anthropic→chat 桥',
};

const DEFAULT_PROTOCOL_PATH_CHANNELS = Object.keys(PROTOCOL_PATH_CHANNEL_LABEL);

const INBOUND_PROTOCOL_COMPATIBLE_CLIENTS: Record<string, string[]> = {
  openai: ['OpenAI SDK', 'Cursor'],
  anthropic: ['Claude Code'],
  responses: ['Codex'],
  gemini: ['Gemini CLI'],
};

const PROVIDER_PROFILE_OPTIONS = (Object.keys(PROVIDER_PROFILE_LABEL) as Array<keyof typeof PROVIDER_PROFILE_LABEL>).map((value) => ({
  value,
  label: PROVIDER_PROFILE_LABEL[value],
}));

const CLIENT_COMPATIBILITY_OPTIONS = (Object.keys(CLIENT_COMPATIBILITY_LABEL) as Array<keyof typeof CLIENT_COMPATIBILITY_LABEL>).map((value) => ({
  value,
  label: CLIENT_COMPATIBILITY_LABEL[value],
}));

const SERVED_INBOUND_PROTOCOL_OPTIONS = (Object.keys(SERVED_INBOUND_PROTOCOL_LABEL) as Array<keyof typeof SERVED_INBOUND_PROTOCOL_LABEL>).map((value) => ({
  value,
  label: SERVED_INBOUND_PROTOCOL_LABEL[value],
}));

const PROVIDER_PROFILE_LABELS: ReadonlyMap<string, string> = new Map(
  PROVIDER_PROFILE_OPTIONS.map((option) => [option.value, option.label]),
);
const CLIENT_COMPATIBILITY_LABELS: ReadonlyMap<string, string> = new Map(
  CLIENT_COMPATIBILITY_OPTIONS.map((option) => [option.value, option.label]),
);
const SERVED_INBOUND_PROTOCOL_LABELS: ReadonlyMap<string, string> = new Map(
  SERVED_INBOUND_PROTOCOL_OPTIONS.map((option) => [option.value, option.label]),
);
const PROTOCOL_PATH_CHANNEL_LABELS: ReadonlyMap<string, string> = new Map(
  Object.entries(PROTOCOL_PATH_CHANNEL_LABEL).map(([value, label]) => [value, label]),
);

function normalizeRuntimeToken(value?: string | null): string {
  return (value ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function providerProfileLabel(value?: string | null): string {
  if (!value) return '';
  return PROVIDER_PROFILE_LABELS.get(value) ?? value;
}

function clientCompatibilityLabel(value: string): string {
  return CLIENT_COMPATIBILITY_LABELS.get(value) ?? value;
}

function servedInboundProtocolLabel(value: string): string {
  return SERVED_INBOUND_PROTOCOL_LABELS.get(value) ?? value;
}

function sdkTypeDefaultForProviderProfile(profile?: string | null): string {
  const normalized = normalizeRuntimeToken(profile);
  if (normalized === 'anthropic_native') return 'anthropic';
  if (normalized === 'openai_native') return 'openai_completions';
  if (normalized === 'openai_responses_native') return 'openai_responses';
  if (normalized === 'azure_openai') return 'azure';
  if (normalized === 'gemini_native') return 'gemini';
  if (normalized === 'doubao_ark') return 'doubao';
  if (normalized === 'glm' || normalized === 'glm_coding') return 'glm';
  if (normalized === 'cohere_v2') return 'cohere_v2';
  if (normalized === 'openai_compatible') return 'openai_compatible';
  return 'openai_compatible';
}

function defaultServedInboundProtocolsForProfile(
  profile?: string | null,
  contract: RuntimeContract = EMPTY_RUNTIME_CONTRACT,
): string[] | undefined {
  if (!profile) return undefined;
  const defaults = contract.profileCapabilities?.[profile]?.defaultServedInboundProtocols;
  if (defaults?.length) return defaults;
  const upstream = upstreamProtocolForProviderProfile(profile);
  return upstream ? [upstream] : undefined;
}

function parseServedInboundProtocols(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  }
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    // Billing also accepts comma-separated protocol strings.
  }
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function upstreamProtocolForProviderProfile(profile?: string | null): string | null {
  const normalized = normalizeRuntimeToken(profile);
  if (normalized === 'anthropic_native') return 'anthropic';
  if (normalized === 'gemini_native') return 'gemini';
  if (normalized === 'openai_responses_native') return 'responses';
  if (!normalized) return null;
  return 'openai';
}

function compatibleClientLabelsForServedInboundProtocols(protocols: string[]): string[] {
  const seen = new Set<string>();
  for (const protocol of protocols) {
    for (const label of INBOUND_PROTOCOL_COMPATIBLE_CLIENTS[protocol] ?? []) {
      seen.add(label);
    }
  }
  return Array.from(seen);
}

function parseProtocolPaths(value: unknown): ProtocolPath[] {
  const rawItems = Array.isArray(value) ? value : [];
  return rawItems
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const inboundProtocol = typeof record.inbound_protocol === 'string'
        ? record.inbound_protocol.trim()
        : typeof record.inboundProtocol === 'string'
          ? record.inboundProtocol.trim()
          : '';
      const channel = typeof record.channel === 'string' ? record.channel.trim() : '';
      if (!inboundProtocol || !channel) return null;
      return { inbound_protocol: inboundProtocol, channel };
    })
    .filter((item): item is ProtocolPath => Boolean(item));
}

function servedInboundProtocolsForProtocolPaths(paths: ProtocolPath[]): string[] {
  return uniqueStrings(paths.map((path) => path.inbound_protocol));
}

function protocolPathsForServedInboundProtocols(
  protocols: string[],
  profile?: string | null,
): ProtocolPath[] {
  const upstream = upstreamProtocolForProviderProfile(profile);
  return uniqueStrings(protocols).map((protocol) => ({
    inbound_protocol: protocol,
    channel: suggestedProtocolChannel(upstream, protocol),
  }));
}

function servedInboundProtocolsForChannelRecord(
  record: Pick<ChannelRecord, 'servedInboundProtocols' | 'providerProfile'>,
  contract: RuntimeContract,
): string[] {
  const explicit = parseServedInboundProtocols(record.servedInboundProtocols);
  if (explicit.length) return explicit;
  return defaultServedInboundProtocolsForProfile(record.providerProfile, contract) ?? [];
}

function normalizeModelNames(value: unknown[]): string[] {
  const seen = new Set<string>();
  const models: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const model = item.trim();
    if (!model || seen.has(model)) continue;
    seen.add(model);
    models.push(model);
  }
  return models;
}

function parseChannelModels(value: unknown): string[] {
  if (Array.isArray(value)) {
    return normalizeModelNames(value);
  }
  if (typeof value !== 'string') return [];
  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return normalizeModelNames(parsed);
    }
  } catch {
    // Support legacy comma-separated model lists.
  }
  return normalizeModelNames(raw.split(','));
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((item) => item.trim()).filter(Boolean)));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data?.message ||
    (error as { message?: string })?.message ||
    fallback
  );
}

function plainObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function productChannelProviderIsolation(value: unknown): Record<string, unknown> {
  const metadata = plainObject(value);
  return plainObject(
    metadata.provider_isolation
    ?? metadata.providerIsolation
    ?? metadata.runtime_provider_isolation
    ?? metadata.runtimeProviderIsolation,
  );
}

function isDedicatedProductChannel(productChannel?: { metadata?: unknown } | null): boolean {
  const isolation = productChannelProviderIsolation(productChannel?.metadata);
  const visibility = String(isolation.visibility ?? '');
  const credentialSource = String(isolation.credential_source ?? isolation.credentialSource ?? '');
  const routeKinds = Array.isArray(isolation.allowed_route_kinds)
    ? isolation.allowed_route_kinds
    : Array.isArray(isolation.allowedRouteKinds)
      ? isolation.allowedRouteKinds
      : [];
  return visibility === 'dedicated_only'
    || credentialSource === 'dedicated_upstream'
    || routeKinds.includes('dedicated_route');
}

function isSystemDedicatedResaleChannel(channel?: { id?: string; remark?: string | null } | null): boolean {
  return Boolean(
    channel?.id?.startsWith('dch_')
    || channel?.remark === 'system:dedicated_resale_runtime_provider',
  );
}

function normalizeChannelFormValues(
  values: Record<string, unknown>,
  isEditing: boolean,
  contract: RuntimeContract = EMPTY_RUNTIME_CONTRACT,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...values };
  const providerProfile = typeof payload.providerProfile === 'string' ? payload.providerProfile.trim() : '';
  if (providerProfile) {
    payload.providerProfile = providerProfile;
  } else if (isEditing) {
    payload.providerProfile = null;
  } else {
    delete payload.providerProfile;
  }

  delete payload.tokenCountStrategy;

  delete payload.clientCompatibility;

  const contractInboundProtocols = contract.inboundProtocols?.length
    ? contract.inboundProtocols
    : SERVED_INBOUND_PROTOCOL_OPTIONS.map((option) => option.value);
  const contractProtocolChannels = contract.dedicatedProtocolChannels?.length
    ? contract.dedicatedProtocolChannels
    : DEFAULT_PROTOCOL_PATH_CHANNELS;
  let protocolPaths = parseProtocolPaths(payload.protocolPaths)
    .filter((path) => contractInboundProtocols.includes(path.inbound_protocol))
    .filter((path) => contractProtocolChannels.includes(path.channel));
  let servedInboundProtocols = protocolPaths.length
    ? servedInboundProtocolsForProtocolPaths(protocolPaths)
    : uniqueStrings(parseServedInboundProtocols(payload.servedInboundProtocols))
      .filter((protocol) => contractInboundProtocols.includes(protocol));
  if (servedInboundProtocols.length === 0) {
    servedInboundProtocols = defaultServedInboundProtocolsForProfile(providerProfile, contract) ?? [];
  }
  if (protocolPaths.length === 0) {
    protocolPaths = protocolPathsForServedInboundProtocols(servedInboundProtocols, providerProfile);
  }
  if (protocolPaths.length > 0) {
    payload.protocolPaths = protocolPaths;
  } else if (isEditing) {
    payload.protocolPaths = null;
  } else {
    delete payload.protocolPaths;
  }
  if (servedInboundProtocols.length > 0) {
    payload.servedInboundProtocols = JSON.stringify(servedInboundProtocols);
  } else if (isEditing) {
    payload.servedInboundProtocols = null;
  } else {
    delete payload.servedInboundProtocols;
  }

  const ownedBy = typeof payload.ownedBy === 'string'
    ? payload.ownedBy.trim()
    : '';
  if (ownedBy) {
    payload.ownedBy = ownedBy;
  } else if (isEditing) {
    payload.ownedBy = null;
  } else {
    delete payload.ownedBy;
  }

  return payload;
}

function servedInboundProtocolOptionsForProfile(
  _profile?: string | null,
  contract: RuntimeContract = EMPTY_RUNTIME_CONTRACT,
) {
  const contractValues = contract.inboundProtocols?.length
    ? contract.inboundProtocols
    : SERVED_INBOUND_PROTOCOL_OPTIONS.map((option) => option.value);
  return contractValues.map((value) => {
    const option = SERVED_INBOUND_PROTOCOL_OPTIONS.find((item) => item.value === value) ?? { value, label: value };
    return { ...option };
  });
}

// channel 层只保留 per-channel 特有的两个字段；thinking / reasoning / maxOutput
// 全部下沉到 ModelPricing。详见 src/pages/Models/detail.tsx 能力 tab。
interface PerModelConfig {
  enabled?: boolean;
  upstreamModelId?: string;
  routingPriority?: number;
}

type ModelConfigsMap = Record<string, PerModelConfig>;

function parseModelConfigsClient(raw: unknown): ModelConfigsMap {
  if (!raw) return {};
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 只保留 channel 层支持的字段；旧脏数据里残留的 thinking* 之类被静默丢弃，
      // 避免运营在 channel 抽屉看不到的字段继续生效。
      const map = parsed as Record<string, Record<string, unknown>>;
      const out: ModelConfigsMap = {};
      for (const [k, v] of Object.entries(map)) {
        if (!v || typeof v !== 'object') continue;
        const cfg: PerModelConfig = {};
        if (v.enabled === false) cfg.enabled = false;
        if (typeof v.upstreamModelId === 'string' && v.upstreamModelId.trim()) {
          cfg.upstreamModelId = v.upstreamModelId.trim();
        }
        const rawPriority = v.routingPriority ?? v.routing_priority ?? v.priority;
        const routingPriority = Number(rawPriority);
        if (Number.isInteger(routingPriority) && routingPriority >= 1 && routingPriority <= 100) {
          cfg.routingPriority = routingPriority;
        }
        if (Object.keys(cfg).length > 0) out[k] = cfg;
      }
      return out;
    }
  } catch {
    /* fallthrough — 旧脏数据 */
  }
  return {};
}

/** 生成稀疏 JSON：剔除空 cfg / 默认值，避免下发噪音字段 */
function serializeModelConfigs(map: ModelConfigsMap): string {
  const out: ModelConfigsMap = {};
  for (const [name, cfg] of Object.entries(map)) {
    const compact: PerModelConfig = {};
    if (cfg.enabled === false) compact.enabled = false;
    if (cfg.upstreamModelId && cfg.upstreamModelId.trim()) compact.upstreamModelId = cfg.upstreamModelId.trim();
    if (typeof cfg.routingPriority === 'number') compact.routingPriority = cfg.routingPriority;
    if (Object.keys(compact).length > 0) {
      out[name] = compact;
    }
  }
  return JSON.stringify(out);
}

function HealthCell({ status, isActive }: { status?: string; isActive: boolean }) {
  if (!isActive) {
    return (
      <span className="rt-health">
        <span className="rt-health-dot rt-health-dot-muted" />
        未启用
      </span>
    );
  }
  if (status === 'healthy' || status === 'active') {
    return (
      <span className="rt-health">
        <span className="rt-health-dot rt-health-dot-ok" />
        健康
      </span>
    );
  }
  if (status === 'degraded') {
    return (
      <span className="rt-health">
        <span className="rt-health-dot rt-health-dot-warn" />
        波动
      </span>
    );
  }
  if (status === 'down') {
    return (
      <span className="rt-health">
        <span className="rt-health-dot rt-health-dot-err" />
        异常
      </span>
    );
  }
  // No explicit status → infer from active flag (legacy data)
  return (
    <span className="rt-health">
      <span className="rt-health-dot rt-health-dot-ok" />
      健康
    </span>
  );
}

function channelInitial(record: Pick<ChannelRecord, 'name' | 'provider'>): string {
  const raw = (record.name || record.provider || '?').trim();
  return (Array.from(raw)[0] || '?').toUpperCase();
}

function channelTone(record: Pick<ChannelRecord, 'name' | 'provider'>): string {
  const token = `${record.provider || ''} ${record.name || ''}`.toLowerCase();
  if (token.includes('anthropic') || token.includes('claude')) return 'violet';
  if (token.includes('deepseek')) return 'cyan';
  if (token.includes('minimax')) return 'orange';
  if (token.includes('glm') || token.includes('zhipu')) return 'green';
  if (token.includes('kimi') || token.includes('moonshot')) return 'blue';
  if (token.includes('qwen') || token.includes('ali')) return 'gold';
  return 'slate';
}

export default function ChannelsPage() {
  // antd v5: 必须从 App context 取 message,静态 import { message } from 'antd'
  // 在 <App> 包裹下样式正常但实际不会渲染。这是 v5 的"静态消费"行为。
  const { message, modal } = App.useApp();
  const canManage = usePermission('admin.page.channels.manage');
  const canViewDeliverySettings = usePermission('admin.page.delivery_settings.view');
  const showPublisherAwareMessage = (
    result: unknown,
    successText: string,
  ) => {
    const sync = publisherSyncMessage(result);
    if (sync?.ok === false) {
      message.warning(`${successText}，但 Publisher 下发未完成：${sync.error || sync.status || '未知错误'}`);
      return;
    }
    const warningText = publisherWarningsText(sync?.warnings);
    if (warningText) {
      message.warning(`${successText}，Publisher 返回警告：${warningText}`);
      return;
    }
    message.success(successText);
  };
  const navigate = useNavigate();
  const [data, setData] = useState<{ items: ChannelRecord[]; total: number }>({
    items: [],
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [healthChecking, setHealthChecking] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runtimePreviewing, setRuntimePreviewing] = useState(false);
  const [runtimeContract, setRuntimeContract] = useState<RuntimeContract>(EMPTY_RUNTIME_CONTRACT);
  const [runtimeContractLoading, setRuntimeContractLoading] = useState(false);
  const [providerAccountIdentities, setProviderAccountIdentities] = useState<ProviderAccountIdentity[]>([]);
  const [providerAccountIdentitiesLoading, setProviderAccountIdentitiesLoading] = useState(false);
  const [providerAccountDrawerOpen, setProviderAccountDrawerOpen] = useState(false);
  const [providerAccountCreateOpen, setProviderAccountCreateOpen] = useState(false);
  const [providerAccountCreating, setProviderAccountCreating] = useState(false);
  const [providerAccountDeactivatingId, setProviderAccountDeactivatingId] = useState<string | null>(null);
  const savingRef = useRef(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const [providerAccountCreateForm] = Form.useForm<CreateProviderAccountIdentityInput>();
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [deliveryChannel, setDeliveryChannel] = useState<ChannelRecord | null>(null);
  const [deliveryProducts, setDeliveryProducts] = useState<ProductRecord[]>([]);
  const [deliveryProductId, setDeliveryProductId] = useState<string | null>(null);
  const [deliveryProductsLoading, setDeliveryProductsLoading] = useState(false);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeSaving, setRouteSaving] = useState<string | null>(null);
  const [routeAvailableChannels, setRouteAvailableChannels] = useState<ProductRuntimePolicyChannel[]>([]);
  const [routeChannels, setRouteChannels] = useState<ProductRouteChannel[]>([]);
  const [routeGroups, setRouteGroups] = useState<ProductRouteGroup[]>([]);
  const [routeAssignments, setRouteAssignments] = useState<ProductRouteAssignment[]>([]);
  const [routeGraph, setRouteGraph] = useState<ProductRouteGraphPreview | null>(null);
  const [routeSegments, setRouteSegments] = useState<UserSegment[]>([]);
  const [editingRouteChannelId, setEditingRouteChannelId] = useState<string | null>(null);
  const [editingRouteGroupId, setEditingRouteGroupId] = useState<string | null>(null);
  const [editingRouteMember, setEditingRouteMember] = useState<{ groupId: string; memberId: string } | null>(null);
  const [editingRouteAssignmentId, setEditingRouteAssignmentId] = useState<string | null>(null);
  const [routeChannelForm] = Form.useForm<ProductChannelRouteInput>();
  const [routeGroupForm] = Form.useForm<ProductChannelGroupInput>();
  const [routeMemberForm] = Form.useForm<ProductChannelGroupMemberInput & { groupId?: string }>();
  const [routeAssignmentForm] = Form.useForm<ProductRouteAssignmentInput>();

  // 拉取模型 Modal:从上游 /v1/models 获取后多选回写 channel.models
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [discoverChannel, setDiscoverChannel] = useState<ChannelRecord | null>(null);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [savingModels, setSavingModels] = useState(false);
  // Per-model 配置（Discover Modal 共用），保存时与 selectedModels 一并写回
  const [modelConfigs, setModelConfigs] = useState<ModelConfigsMap>({});
  const [perModelDrawerName, setPerModelDrawerName] = useState<string | null>(null);
  const watchedProvider = Form.useWatch('provider', form) as string | undefined;
  const watchedProviderAccountIdentityId = Form.useWatch(
    'providerAccountIdentityId',
    form,
  ) as string | undefined;
  const watchedProviderProfile = Form.useWatch('providerProfile', form) as string | undefined;
  const watchedAssignmentSubjectType = Form.useWatch('subjectType', routeAssignmentForm);
  const watchedAssignmentTargetType = Form.useWatch('targetType', routeAssignmentForm);
  const effectiveProviderProfile = watchedProviderProfile || undefined;
  const providerAccountIdentityOptions = useMemo(
    () => providerAccountIdentitiesForProvider(providerAccountIdentities, watchedProvider).map(
      (identity) => ({
        value: identity.id,
        label: `${identity.displayName} · ${identity.ref}`,
        disabled: !isProviderAccountIdentityActive(identity),
      }),
    ),
    [providerAccountIdentities, watchedProvider],
  );
  const selectedProviderAccountIdentity = useMemo(
    () => providerAccountIdentities.find(
      (identity) => identity.id === watchedProviderAccountIdentityId,
    ),
    [providerAccountIdentities, watchedProviderAccountIdentityId],
  );
  const providerProfileOptions = useMemo(() => {
    const values = runtimeContract.providerProfiles?.length
      ? runtimeContract.providerProfiles
      : PROVIDER_PROFILE_OPTIONS.map((option) => option.value);
    return values.map((value) =>
      PROVIDER_PROFILE_OPTIONS.find((option) => option.value === value) ?? { value, label: value },
    );
  }, [runtimeContract]);
  const runtimeServedInboundProtocolOptions = useMemo(
    () => servedInboundProtocolOptionsForProfile(effectiveProviderProfile, runtimeContract),
    [effectiveProviderProfile, runtimeContract],
  );
  const runtimeProtocolPathChannelOptions = useMemo(() => {
    const values = runtimeContract.dedicatedProtocolChannels?.length
      ? runtimeContract.dedicatedProtocolChannels
      : DEFAULT_PROTOCOL_PATH_CHANNELS;
    return values.map((value) => ({
      value,
      label: PROTOCOL_PATH_CHANNEL_LABELS.get(value) ?? value,
    }));
  }, [runtimeContract]);
  const runtimeUpstreamProtocol = useMemo(
    () => upstreamProtocolForProviderProfile(effectiveProviderProfile),
    [effectiveProviderProfile],
  );
  const channelRuntimeDefaults = useCallback((provider = 'openai') => {
    const providerProfile = runtimeContract.providerProfiles?.[0] ?? 'openai_compatible';
    const servedInboundProtocols = defaultServedInboundProtocolsForProfile(providerProfile, runtimeContract) ?? DEFAULT_SERVED_INBOUND_PROTOCOLS;
    return {
      provider,
      sdkType: sdkTypeDefaultForProviderProfile(providerProfile),
      providerProfile,
      servedInboundProtocols,
      protocolPaths: protocolPathsForServedInboundProtocols(servedInboundProtocols, providerProfile),
    };
  }, [runtimeContract]);

  // Local filters (client-side; backend currently ignores extra params)
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [providerFilter, setProviderFilter] = useState<string>('all');
  const [sdkFilter, setSdkFilter] = useState<string>('all');

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const channels = await channelApi.listAll<ChannelRecord>();
      const visibleChannels = channels.filter((item) => !isSystemDedicatedResaleChannel(item));
      setData({
        items: visibleChannels,
        total: visibleChannels.length,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProviderAccountIdentities = useCallback(async () => {
    setProviderAccountIdentitiesLoading(true);
    try {
      setProviderAccountIdentities(await providerAccountIdentityApi.list());
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || '加载供应商账户身份失败');
    } finally {
      setProviderAccountIdentitiesLoading(false);
    }
  }, [message]);

  const fetchRuntimeContract = useCallback(async () => {
    setRuntimeContractLoading(true);
    try {
      const res = await channelApi.protocolTemplates();
      setRuntimeContract(res.contract ?? EMPTY_RUNTIME_CONTRACT);
    } catch {
      setRuntimeContract(EMPTY_RUNTIME_CONTRACT);
      message.error('加载 Publisher Profile 配置失败，请稍后重试');
    } finally {
      setRuntimeContractLoading(false);
    }
  }, [message]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    fetchProviderAccountIdentities();
  }, [fetchProviderAccountIdentities]);

  useEffect(() => {
    fetchRuntimeContract();
  }, [fetchRuntimeContract]);

  const validateProviderAccountIdentity = async (_: unknown, value: unknown) => {
    const error = providerAccountIdentitySelectionError(
      providerAccountIdentities,
      value,
      watchedProvider,
    );
    if (error) throw new Error(error);
  };

  const openProviderAccountCreate = () => {
    providerAccountCreateForm.resetFields();
    if (watchedProvider) {
      providerAccountCreateForm.setFieldsValue({
        providerCode: normalizeProviderCode(watchedProvider),
      });
    }
    setProviderAccountCreateOpen(true);
  };

  const handleCreateProviderAccountIdentity = async () => {
    let values: CreateProviderAccountIdentityInput;
    try {
      values = await providerAccountCreateForm.validateFields();
    } catch {
      return;
    }

    setProviderAccountCreating(true);
    try {
      const identity = await providerAccountIdentityApi.create({
        providerCode: values.providerCode.trim(),
        displayName: values.displayName.trim(),
      });
      await fetchProviderAccountIdentities();
      if (
        modalOpen
        && normalizeProviderCode(identity.providerCode) === normalizeProviderCode(watchedProvider)
      ) {
        form.setFieldValue('providerAccountIdentityId', identity.id);
      }
      setProviderAccountCreateOpen(false);
      providerAccountCreateForm.resetFields();
      message.success('供应商账户身份已创建');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (err instanceof Error ? err.message : '创建失败'));
    } finally {
      setProviderAccountCreating(false);
    }
  };

  const handleDeactivateProviderAccountIdentity = async (identity: ProviderAccountIdentity) => {
    setProviderAccountDeactivatingId(identity.id);
    try {
      await providerAccountIdentityApi.deactivate(identity.id);
      await fetchProviderAccountIdentities();
      message.success('供应商账户身份已停用');
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (err instanceof Error ? err.message : '停用失败'));
    } finally {
      setProviderAccountDeactivatingId(null);
    }
  };

  const handleSave = async () => {
    if (savingRef.current) return;

    let values: Record<string, unknown>;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (editingId) {
        const payload = normalizeChannelFormValues(values, true, runtimeContract);
        if (typeof payload.apiKey === 'string') {
          const apiKey = payload.apiKey.trim();
          if (apiKey && !/[*•]/.test(apiKey)) {
            payload.apiKey = apiKey;
          } else {
            delete payload.apiKey;
          }
        } else {
          delete payload.apiKey;
        }
        const result = await channelApi.update(editingId, payload);
        showPublisherAwareMessage(result, '更新成功');
      } else {
        const payload = normalizeChannelFormValues(values, false, runtimeContract);
        const apiKey = typeof payload.apiKey === 'string' ? payload.apiKey.trim() : '';
        const result = await channelApi.create({
          ...payload,
          apiKey,
        } as never);
        showPublisherAwareMessage(result, '创建成功');
      }
      setModalOpen(false);
      setEditingId(null);
      form.resetFields();
      fetchChannels();
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (err instanceof Error ? err.message : '保存失败'));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handlePublisherCompilePreview = async () => {
    const values = form.getFieldsValue() as Record<string, unknown>;
    if (!values.provider || !values.baseUrl) {
      message.warning('请先选择供应商并填写 Base URL');
      return;
    }
    setRuntimePreviewing(true);
    try {
      const payload = normalizeChannelFormValues(values, Boolean(editingId), runtimeContract);
      delete payload.apiKey;
      const preview = await channelApi.publisherCompilePreview(payload as never);
      modal.info({
        title: 'Publisher 编译预览',
        width: 820,
        content: (
          <pre style={{ maxHeight: 520, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(preview, null, 2)}
          </pre>
        ),
      });
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (err instanceof Error ? err.message : '编译预览失败'));
    } finally {
      setRuntimePreviewing(false);
    }
  };

  const handleEdit = (record: ChannelRecord) => {
    const providerProfile = record.providerProfile || undefined;
    const sdkType = providerProfile
      ? sdkTypeDefaultForProviderProfile(providerProfile)
      : record.sdkType || 'openai_compatible';
    const servedInboundProtocols = parseServedInboundProtocols(record.servedInboundProtocols);
    const protocolPaths = parseProtocolPaths(record.protocolPaths);
    const effectiveServedInboundProtocols = servedInboundProtocols.length
      ? servedInboundProtocols
      : defaultServedInboundProtocolsForProfile(providerProfile, runtimeContract) ?? [];
    const formRecord: Record<string, unknown> = { ...record };
    delete formRecord.tokenCountStrategy;
    delete formRecord.clientCompatibility;
    setEditingId(record.id);
    form.setFieldsValue({
      ...formRecord,
      sdkType,
      providerProfile,
      servedInboundProtocols: effectiveServedInboundProtocols,
      protocolPaths: protocolPaths.length
        ? protocolPaths
        : protocolPathsForServedInboundProtocols(effectiveServedInboundProtocols, providerProfile),
      ownedBy: record.ownedBy || undefined,
      providerAccountIdentityId:
        record.providerAccountIdentityId || record.providerAccountIdentity?.id || undefined,
      apiKey: undefined,
    });
    setModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    try {
      const result = await channelApi.delete(id);
      showPublisherAwareMessage(result, '已删除');
      fetchChannels();
    } catch (err) {
      const apiMessage = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(apiMessage || (err instanceof Error ? err.message : '删除失败'));
    }
  };

  const resetDeliveryRouteForms = (channel: ChannelRecord | null = deliveryChannel) => {
    setEditingRouteChannelId(null);
    setEditingRouteGroupId(null);
    setEditingRouteMember(null);
    setEditingRouteAssignmentId(null);
    routeChannelForm.resetFields();
    routeGroupForm.resetFields();
    routeMemberForm.resetFields();
    routeAssignmentForm.resetFields();
    routeChannelForm.setFieldsValue({
      channelId: channel?.id,
      status: 'active',
      isDefault: false,
      priority: 5,
      weight: 1,
    });
    routeGroupForm.setFieldsValue({
      strategy: 'weighted_failover',
      status: 'active',
      isDefault: false,
    });
    routeMemberForm.setFieldsValue({ role: 'primary', priority: 5, weight: 1 });
    routeAssignmentForm.setFieldsValue({
      subjectType: 'USER',
      targetType: 'GROUP',
      mode: 'ONLY',
      priority: 100,
      isActive: true,
    });
  };

  const loadDeliveryRouteData = async (productId: string, closeOnError = false) => {
    setRouteLoading(true);
    try {
      const [
        channels,
        groups,
        assignments,
        graph,
        runtimePolicySnapshot,
        channelPayload,
        segmentPayload,
      ] = await Promise.all([
        productApi.productChannels(productId),
        productApi.productChannelGroups(productId),
        productApi.productRouteAssignments(productId),
        productApi.previewProductRouteGraph(productId).catch(() => ({} as ProductRouteGraphPreview)),
        productApi.runtimePolicy(productId).catch(() => null),
        channelApi.listAll<ProductRuntimePolicyChannel>().catch(() => []),
        userSegmentApi.list({ pageSize: 100, isActive: true }).catch(() => null),
      ]);

      setRouteChannels(channels as ProductRouteChannel[]);
      setRouteGroups(groups as ProductRouteGroup[]);
      setRouteAssignments(assignments as ProductRouteAssignment[]);
      setRouteGraph(graph);

      const globalChannels = channelPayload.filter((channel) => !isSystemDedicatedResaleChannel(channel));
      const availableById = new Map<string, ProductRuntimePolicyChannel>();
      for (const item of [...(runtimePolicySnapshot?.channels ?? []), ...globalChannels]) {
        if (isSystemDedicatedResaleChannel(item)) continue;
        if (item?.id) availableById.set(item.id, item);
      }
      setRouteAvailableChannels([...availableById.values()]);
      setRouteSegments(segmentPayload?.items ?? []);
    } catch (error) {
      message.error(getErrorMessage(error, '加载渠道投放配置失败'));
      if (closeOnError) setDeliveryOpen(false);
    } finally {
      setRouteLoading(false);
    }
  };

  const openDeliveryManager = async (record: ChannelRecord) => {
    setDeliveryChannel(record);
    setDeliveryOpen(true);
    setDeliveryProductId(null);
    setRouteChannels([]);
    setRouteGroups([]);
    setRouteAssignments([]);
    setRouteGraph(null);
    resetDeliveryRouteForms(record);
    setDeliveryProductsLoading(true);
    try {
      const productPayload = await productApi.list();
      const products = ((productPayload.items || productPayload || []) as ProductRecord[])
        .filter((product) => product.id);
      setDeliveryProducts(products);
      const firstProduct = products.find((product) => product.isActive) ?? products[0];
      if (firstProduct) {
        setDeliveryProductId(firstProduct.id);
        await loadDeliveryRouteData(firstProduct.id, true);
      }
    } catch (error) {
      message.error(getErrorMessage(error, '加载产品列表失败'));
    } finally {
      setDeliveryProductsLoading(false);
    }
  };

  const handleDeliveryProductChange = async (productId: string) => {
    setDeliveryProductId(productId);
    resetDeliveryRouteForms();
    setRouteGraph(null);
    await loadDeliveryRouteData(productId);
  };

  const refreshDeliveryRouteData = async () => {
    if (!deliveryProductId) return;
    await loadDeliveryRouteData(deliveryProductId);
  };

  const saveRouteChannel = async () => {
    if (!deliveryProductId || !deliveryChannel?.id) return;
    try {
      const values = await routeChannelForm.validateFields();
      const payload: ProductChannelRouteInput = {
        ...values,
        channelId: deliveryChannel.id,
        allowedModels: Array.isArray(values.allowedModels) ? values.allowedModels : undefined,
        deniedModels: Array.isArray(values.deniedModels) ? values.deniedModels : undefined,
      };
      setRouteSaving('channel');
      if (editingRouteChannelId) {
        const updatePayload = { ...payload };
        delete updatePayload.channelId;
        const result = await productApi.updateProductChannel(deliveryProductId, editingRouteChannelId, updatePayload);
        showPublisherAwareMessage(result, '产品投放已更新');
      } else {
        const result = await productApi.createProductChannel(deliveryProductId, payload);
        showPublisherAwareMessage(result, '产品投放已添加');
      }
      resetDeliveryRouteForms();
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error(getErrorMessage(error, '保存产品投放失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const editRouteChannel = (record: ProductRouteChannel) => {
    setEditingRouteChannelId(record.id);
    routeChannelForm.setFieldsValue({
      channelId: record.channelId,
      displayName: record.displayName ?? undefined,
      status: record.status as ProductChannelRouteInput['status'],
      isDefault: Boolean(record.isDefault),
      allowedModels: Array.isArray(record.allowedModels) ? record.allowedModels : undefined,
      deniedModels: Array.isArray(record.deniedModels) ? record.deniedModels : undefined,
      priority: record.priority ?? 5,
      weight: record.weight ?? 1,
      maxRpm: record.maxRpm ?? undefined,
      maxTpm: record.maxTpm ?? undefined,
    });
  };

  const deleteRouteChannel = async (record: ProductRouteChannel) => {
    if (!deliveryProductId) return;
    try {
      setRouteSaving(`channel:${record.id}`);
      const result = await productApi.deleteProductChannel(deliveryProductId, record.id);
      showPublisherAwareMessage(result, '产品投放已删除');
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      message.error(getErrorMessage(error, '删除产品投放失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const saveRouteGroup = async () => {
    if (!deliveryProductId) return;
    try {
      const values = await routeGroupForm.validateFields();
      setRouteSaving('group');
      if (editingRouteGroupId) {
        const result = await productApi.updateProductChannelGroup(deliveryProductId, editingRouteGroupId, values);
        showPublisherAwareMessage(result, '渠道组已更新');
      } else {
        const result = await productApi.createProductChannelGroup(deliveryProductId, values);
        showPublisherAwareMessage(result, '渠道组已创建');
      }
      resetDeliveryRouteForms();
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error(getErrorMessage(error, '保存渠道组失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const editRouteGroup = (record: ProductRouteGroup) => {
    setEditingRouteGroupId(record.id);
    routeGroupForm.setFieldsValue({
      code: record.code,
      name: record.name,
      strategy: record.strategy as ProductChannelGroupInput['strategy'],
      isDefault: Boolean(record.isDefault),
      status: record.status as ProductChannelGroupInput['status'],
    });
  };

  const deleteRouteGroup = async (record: ProductRouteGroup) => {
    if (!deliveryProductId) return;
    try {
      setRouteSaving(`group:${record.id}`);
      const result = await productApi.deleteProductChannelGroup(deliveryProductId, record.id);
      showPublisherAwareMessage(result, '渠道组已删除');
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      message.error(getErrorMessage(error, '删除渠道组失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const saveRouteMember = async () => {
    if (!deliveryProductId) return;
    try {
      const values = await routeMemberForm.validateFields();
      const { groupId, productChannelId, ...memberPayload } = values;
      const selectedProductChannel = routeChannels.find((channel) => channel.id === productChannelId);
      if (!editingRouteMember && isDedicatedProductChannel(selectedProductChannel)) {
        message.error('Dedicated-only ProductChannel 只发布 Runtime Provider，不能加入普通渠道组');
        return;
      }
      setRouteSaving('member');
      if (editingRouteMember) {
        const result = await productApi.updateProductChannelGroupMember(
          deliveryProductId,
          editingRouteMember.groupId,
          editingRouteMember.memberId,
          memberPayload,
        );
        showPublisherAwareMessage(result, '组成员已更新');
      } else {
        if (!groupId) return;
        const result = await productApi.addProductChannelGroupMember(deliveryProductId, groupId, {
          ...memberPayload,
          productChannelId,
        });
        showPublisherAwareMessage(result, '组成员已添加');
      }
      resetDeliveryRouteForms();
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error(getErrorMessage(error, '保存组成员失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const editRouteMember = (record: ProductRouteGroupMember) => {
    setEditingRouteMember({ groupId: record.groupId, memberId: record.id });
    routeMemberForm.setFieldsValue({
      groupId: record.groupId,
      productChannelId: record.productChannelId,
      role: record.role as ProductChannelGroupMemberInput['role'],
      priority: record.priority ?? 5,
      weight: record.weight ?? 1,
      maxRpm: record.maxRpm ?? undefined,
      maxTpm: record.maxTpm ?? undefined,
    });
  };

  const deleteRouteMember = async (record: ProductRouteGroupMember) => {
    if (!deliveryProductId) return;
    try {
      setRouteSaving(`member:${record.id}`);
      const result = await productApi.deleteProductChannelGroupMember(deliveryProductId, record.groupId, record.id);
      showPublisherAwareMessage(result, '组成员已删除');
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      message.error(getErrorMessage(error, '删除组成员失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const saveRouteAssignment = async () => {
    if (!deliveryProductId) return;
    try {
      const values = await routeAssignmentForm.validateFields();
      if (
        values.targetType === 'PRODUCT_CHANNEL'
        && isDedicatedProductChannel(routeChannels.find((channel) => channel.id === values.targetId))
      ) {
        message.error('Dedicated-only ProductChannel 不能作为普通适用对象规则目标');
        return;
      }
      setRouteSaving('assignment');
      if (editingRouteAssignmentId) {
        const result = await productApi.updateProductRouteAssignment(deliveryProductId, editingRouteAssignmentId, values);
        showPublisherAwareMessage(result, '适用对象规则已更新');
      } else {
        const result = await productApi.createProductRouteAssignment(deliveryProductId, values);
        showPublisherAwareMessage(result, '适用对象规则已创建');
      }
      resetDeliveryRouteForms();
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      if ((error as { errorFields?: unknown[] })?.errorFields) return;
      message.error(getErrorMessage(error, '保存适用对象规则失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const editRouteAssignment = (record: ProductRouteAssignment) => {
    setEditingRouteAssignmentId(record.id);
    routeAssignmentForm.setFieldsValue({
      subjectType: record.subjectType as ProductRouteAssignmentInput['subjectType'],
      subjectId: record.subjectId,
      targetType: record.targetType as ProductRouteAssignmentInput['targetType'],
      targetId: record.targetId,
      mode: record.mode as ProductRouteAssignmentInput['mode'],
      priority: record.priority ?? 100,
      modelPattern: record.modelPattern ?? undefined,
      clientCompatibility: record.clientCompatibility ?? undefined,
      startsAt: record.startsAt ?? undefined,
      endsAt: record.endsAt ?? undefined,
      isActive: record.isActive !== false,
      reason: record.reason ?? undefined,
    });
  };

  const deleteRouteAssignment = async (record: ProductRouteAssignment) => {
    if (!deliveryProductId) return;
    try {
      setRouteSaving(`assignment:${record.id}`);
      const result = await productApi.deleteProductRouteAssignment(deliveryProductId, record.id);
      showPublisherAwareMessage(result, '适用对象规则已删除');
      await loadDeliveryRouteData(deliveryProductId);
    } catch (error) {
      message.error(getErrorMessage(error, '删除适用对象规则失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  const rebuildRouteGraph = async () => {
    if (!deliveryProductId) return;
    try {
      setRouteSaving('graph');
      const graph = await productApi.rebuildProductRouteGraph(deliveryProductId);
      setRouteGraph(graph);
      message.success('Publisher runtime 配置已重推');
    } catch (error) {
      message.error(getErrorMessage(error, '重推 Publisher runtime 配置失败'));
    } finally {
      setRouteSaving(null);
    }
  };

  // 打开拉取模型 Modal:并发触发 discoverModels 拉列表,
  // 同时把 channel 已配置的 models 作为初始选中。
  const handleOpenDiscover = async (record: ChannelRecord) => {
    setDiscoverChannel(record);
    setDiscoverOpen(true);
    setDiscoverLoading(true);
    setDiscoverError(null);
    setAvailableModels([]);

    // 解析当前 channel 已选模型作为初始 selected
    let initialSelected: string[] = [];
    try {
      const raw = typeof record.models === 'string' ? record.models : JSON.stringify(record.models ?? []);
      const arr = JSON.parse(raw || '[]');
      if (Array.isArray(arr)) {
        initialSelected = normalizeModelNames(arr);
      }
    } catch {
      // 旧脏数据 → 忽略
    }
    setSelectedModels(initialSelected);
    setModelConfigs(parseModelConfigsClient(record.modelConfigs));

    try {
      const res = await channelApi.discoverModels(record.id);
      if (!res.success) {
        setDiscoverError(res.error || '拉取失败');
        // 仍把 initialSelected 显示出来,让用户即使拉不到也能看到现有
        setAvailableModels(initialSelected);
      } else {
        // 合并:上游可用 + 已选(防止上游临时过滤掉了某个旧模型)
        const merged = normalizeModelNames([...res.models, ...initialSelected]);
        setAvailableModels(merged);
      }
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : String(err));
      setAvailableModels(initialSelected);
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleSaveModels = async () => {
    if (!discoverChannel) return;
    setSavingModels(true);
    try {
      // 写回 channel：models（白名单数组） + modelConfigs（per-model 配置）。
      // modelConfigs 只保留 selectedModels 中存在的 key — 删模型时自动清掉它的配置。
      const nextModels = normalizeModelNames(selectedModels);
      const filteredConfigs: ModelConfigsMap = {};
      for (const m of nextModels) {
        if (modelConfigs[m]) filteredConfigs[m] = modelConfigs[m];
      }
      await channelApi.update(discoverChannel.id, {
        models: JSON.stringify(nextModels),
        modelConfigs: serializeModelConfigs(filteredConfigs),
      });
      setSelectedModels(nextModels);
      message.success(`已保存 ${nextModels.length} 个模型`);
      setDiscoverOpen(false);
      setDiscoverChannel(null);
      fetchChannels();
    } catch (err) {
      message.error(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSavingModels(false);
    }
  };

  // 更新某个模型的 per-model 配置（写到 state，保存按钮才落库）
  const updatePerModelConfig = (modelName: string, patch: Partial<PerModelConfig>) => {
    setModelConfigs((prev) => {
      const next = { ...prev };
      const merged = { ...(next[modelName] ?? {}), ...patch };
      // 清掉值为 undefined / 空字符串 的字段，避免 JSON 噪音
      Object.keys(merged).forEach((k) => {
        const v = (merged as Record<string, unknown>)[k];
        if (v === undefined || v === '' || v === null) {
          delete (merged as Record<string, unknown>)[k];
        }
      });
      next[modelName] = merged;
      return next;
    });
  };

  // 该模型是否被设置过任何 per-model 字段（控制小圆点提示）
  const hasModelConfig = (modelName: string): boolean => {
    const cfg = modelConfigs[modelName];
    if (!cfg) return false;
    return Object.keys(cfg).some((k) => {
      const v = (cfg as Record<string, unknown>)[k];
      return v !== undefined && v !== '' && v !== null;
    });
  };

  const handleTest = async (id: string) => {
    const hide = message.loading('测试中…', 0);
    try {
      const res = await channelApi.test(id);
      hide();
      if (res?.success) {
        message.success(`连接成功 (${res.latencyMs}ms)`);
      } else {
        message.error(`连接失败: ${res?.error || '未知原因'}`);
      }
    } catch (err) {
      hide();
      // 网络错 / 401 刷新失败 / 后端 500 都进这里。之前没 try/catch 被吞掉
      const msg = err instanceof Error ? err.message : String(err);
      const apiMsg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      message.error(`测试失败: ${apiMsg || msg}`);
    }
  };

  // Bulk health check across visible channels.
  // TODO: replace with a dedicated bulk endpoint once backend supports it.
  const handleBulkHealthCheck = async () => {
    if (healthChecking) return;
    setHealthChecking(true);
    const items = data.items;
    let ok = 0;
    let fail = 0;
    try {
      for (const c of items) {
        if (!c.isActive) continue;
        try {
          const res = await channelApi.test(c.id);
          if (res?.success) ok += 1;
          else fail += 1;
        } catch {
          fail += 1;
        }
      }
      if (fail === 0) {
        message.success(`健康检测完成：${ok} 个通过`);
      } else {
        message.warning(`健康检测完成：${ok} 通过 / ${fail} 失败`);
      }
      fetchChannels();
    } finally {
      setHealthChecking(false);
    }
  };

  // Derived stats
  const items = useMemo(() => data.items ?? [], [data.items]);
  const summary = useMemo(() => {
    const healthy = items.filter(
      (c) => c.isActive && (c.status === 'healthy' || c.status === 'active' || !c.status),
    ).length;
    const down = items.filter((c) => c.status === 'down').length;
    const totalReqs = items.reduce((acc, c) => acc + (c.totalReqs ?? 0), 0);
    return { healthy, down, totalReqs };
  }, [items]);

  // Client-side filtered list for the table
  const filtered = useMemo(() => {
    return items.filter((c) => {
      if (search) {
        const s = search.toLowerCase();
        if (
          !c.name?.toLowerCase().includes(s) &&
          !c.provider?.toLowerCase().includes(s)
        ) {
          return false;
        }
      }
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && !c.isActive) return false;
        if (statusFilter === 'inactive' && c.isActive) return false;
        if (statusFilter === 'down' && c.status !== 'down') return false;
      }
      if (providerFilter !== 'all' && c.provider !== providerFilter) return false;
      if (sdkFilter !== 'all' && (c.sdkType ?? '') !== sdkFilter) return false;
      return true;
    });
  }, [items, search, statusFilter, providerFilter, sdkFilter]);

  const visibleItems = useMemo(
    () => filtered.slice((page - 1) * 20, page * 20),
    [filtered, page],
  );

  useEffect(() => {
    setPage(1);
  }, [search, statusFilter, providerFilter, sdkFilter]);

  // Build provider options dynamically from data + a known fallback set
  const providerOptions = useMemo(() => {
    const known = PROVIDER_OPTIONS.map((option) => option.value);
    const seen = new Set<string>(known);
    items.forEach((c) => c.provider && seen.add(c.provider));
    return Array.from(seen);
  }, [items]);

  const sdkOptions = useMemo(() => {
    const seen = new Set<string>(SDK_TYPE_OPTIONS.map((option) => option.value));
    items.forEach((c) => c.sdkType && seen.add(c.sdkType));
    return Array.from(seen);
  }, [items]);

  const selectedDeliveryProduct = useMemo(
    () => deliveryProducts.find((product) => product.id === deliveryProductId) ?? null,
    [deliveryProducts, deliveryProductId],
  );

  const deliveryChannelModels = useMemo(() => {
    const direct = parseChannelModels(deliveryChannel?.models);
    if (direct.length > 0) return direct;
    return routeAvailableChannels.find((channel) => channel.id === deliveryChannel?.id)?.models ?? [];
  }, [deliveryChannel, routeAvailableChannels]);

  const routeModelOptions = deliveryChannelModels
    .slice()
    .sort()
    .map((model) => ({ value: model, label: model }));

  const currentChannelBindings = routeChannels.filter((channel) =>
    channel.channelId === deliveryChannel?.id && !isDedicatedProductChannel(channel));
  const currentProductChannel = currentChannelBindings[0] ?? null;
  const routeProductChannelOptions = routeChannels
    .filter((channel) => !isDedicatedProductChannel(channel))
    .map((channel) => ({
      value: channel.id,
      label: `${channel.displayName || channel.channel?.name || channel.channelId} · ${channel.channelId}`,
    }));
  const routeGroupOptions = routeGroups.map((group) => ({
    value: group.id,
    label: `${group.name} (${group.code})`,
  }));
  const routeAssignmentTargetOptions = watchedAssignmentTargetType === 'PRODUCT_CHANNEL'
    ? routeProductChannelOptions
    : routeGroupOptions;
  const routeSegmentOptions = routeSegments.map((segment) => ({
    value: segment.id,
    label: `${segment.name} · ${segment.id}`,
  }));
  const routeClientCompatibilityOptions = (
    runtimeContract.clientCompatibilities?.length
      ? runtimeContract.clientCompatibilities
      : CLIENT_COMPATIBILITY_OPTIONS.map((option) => option.value)
  ).map((client) => ({
    value: client,
    label: clientCompatibilityLabel(client),
  }));
  const routeGroupMembers = routeGroups.flatMap((group) =>
    (group.members || []).map((member) => ({ ...member, groupName: group.name, groupCode: group.code })),
  );
  const productChannelName = (id: string) =>
    routeChannels.find((channel) => channel.id === id)?.displayName ||
    routeChannels.find((channel) => channel.id === id)?.channel?.name ||
    id;
  const routeGroupName = (id: string) =>
    routeGroups.find((group) => group.id === id)?.name || id;
  const routeSegmentName = (id: string) =>
    routeSegments.find((segment) => segment.id === id)?.name || id;

  const deliveryProductOptions = deliveryProducts.map((product) => ({
    value: product.id,
    label: `${product.name} · ${product.slug}${product.isActive ? '' : ' · 停用'}`,
  }));
  void openDeliveryManager;

  const deliveryChannelColumns = [
    {
      title: '产品投放',
      key: 'name',
      width: 220,
      render: (_: unknown, record: ProductRouteChannel) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.displayName || deliveryChannel?.name || record.channelId}</Typography.Text>
          <Typography.Text type="secondary" code>{record.id}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 120,
      render: (status: string, record: ProductRouteChannel) => (
        <Space size={4}>
          <Tag variant={status === 'active' ? 'success' : status === 'testing' ? 'warn' : 'muted'}>
            {status === 'active' ? '启用' : status === 'testing' ? '测试' : '停用'}
          </Tag>
          {record.isDefault && <Tag variant="proc">默认</Tag>}
        </Space>
      ),
    },
    {
      title: '权重',
      key: 'weight',
      width: 110,
      render: (_: unknown, record: ProductRouteChannel) => `${record.priority ?? '-'} / ${record.weight ?? '-'}`,
    },
    {
      title: '模型范围',
      key: 'models',
      render: (_: unknown, record: ProductRouteChannel) => {
        const allowCount = Array.isArray(record.allowedModels) ? record.allowedModels.length : 0;
        const denyCount = Array.isArray(record.deniedModels) ? record.deniedModels.length : 0;
        return allowCount || denyCount
          ? <Typography.Text type="secondary">allow {allowCount} / deny {denyCount}</Typography.Text>
          : <Typography.Text type="secondary">继承当前渠道模型</Typography.Text>;
      },
    },
    {
      title: '限流',
      key: 'limits',
      width: 150,
      render: (_: unknown, record: ProductRouteChannel) => (
        <Typography.Text type="secondary">
          RPM {record.maxRpm ?? '-'} / TPM {record.maxTpm ?? '-'}
        </Typography.Text>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: ProductRouteChannel) => (
        <Space size={4}>
          <Button size="small" type="link" disabled={!canManage} onClick={() => editRouteChannel(record)}>编辑</Button>
          <Popconfirm
            title="删除这个产品投放？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteRouteChannel(record)}
          >
            <Button
              size="small"
              type="link"
              danger
              disabled={!canManage}
              loading={routeSaving === `channel:${record.id}`}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const routeGroupColumns = [
    {
      title: '渠道组',
      key: 'name',
      width: 220,
      render: (_: unknown, record: ProductRouteGroup) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Typography.Text type="secondary" code>{record.code}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '策略',
      dataIndex: 'strategy',
      key: 'strategy',
      width: 160,
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: unknown, record: ProductRouteGroup) => (
        <Space size={4}>
          <Tag variant={record.status === 'active' ? 'success' : 'muted'}>
            {record.status === 'active' ? '启用' : '停用'}
          </Tag>
          {record.isDefault && <Tag variant="proc">默认</Tag>}
        </Space>
      ),
    },
    {
      title: '成员',
      key: 'members',
      render: (_: unknown, record: ProductRouteGroup) => (
        <Space wrap size={4}>
          {(record.members || []).length === 0
            ? <Typography.Text type="secondary">暂无成员</Typography.Text>
            : (record.members || []).map((member) => (
              <Tag
                key={member.id}
                variant={member.productChannelId === currentProductChannel?.id ? 'proc' : 'muted'}
              >
                {productChannelName(member.productChannelId)}
              </Tag>
            ))}
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: ProductRouteGroup) => (
        <Space size={4}>
          <Button size="small" type="link" disabled={!canManage} onClick={() => editRouteGroup(record)}>编辑</Button>
          <Popconfirm
            title="删除渠道组？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteRouteGroup(record)}
          >
            <Button size="small" type="link" danger disabled={!canManage} loading={routeSaving === `group:${record.id}`}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const routeMemberColumns = [
    {
      title: '渠道组',
      dataIndex: 'groupName',
      key: 'groupName',
      width: 190,
      render: (_: unknown, record: ProductRouteGroupMember & { groupName: string; groupCode: string }) =>
        `${record.groupName} (${record.groupCode})`,
    },
    {
      title: '产品渠道',
      dataIndex: 'productChannelId',
      key: 'productChannelId',
      render: (id: string) => (
        <Tag variant={id === currentProductChannel?.id ? 'proc' : 'muted'}>{productChannelName(id)}</Tag>
      ),
    },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 110,
      render: (role: string) => <Tag variant="muted">{role || 'primary'}</Tag>,
    },
    {
      title: '权重',
      key: 'weight',
      width: 110,
      render: (_: unknown, record: ProductRouteGroupMember) => `${record.priority ?? '-'} / ${record.weight ?? '-'}`,
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: ProductRouteGroupMember) => (
        <Space size={4}>
          <Button size="small" type="link" disabled={!canManage} onClick={() => editRouteMember(record)}>编辑</Button>
          <Popconfirm
            title="删除组成员？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteRouteMember(record)}
          >
            <Button size="small" type="link" danger disabled={!canManage} loading={routeSaving === `member:${record.id}`}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const routeAssignmentColumns = [
    {
      title: '适用对象',
      key: 'subject',
      width: 220,
      render: (_: unknown, record: ProductRouteAssignment) => (
        <Space direction="vertical" size={0}>
          <Tag variant={record.subjectType === 'USER_SEGMENT' ? 'proc' : 'muted'}>
            {record.subjectType === 'USER_SEGMENT' ? '用户分群' : '指定用户'}
          </Tag>
          <Typography.Text code>
            {record.subjectType === 'USER_SEGMENT' ? routeSegmentName(record.subjectId) : record.subjectId}
          </Typography.Text>
        </Space>
      ),
    },
    {
      title: '路由目标',
      key: 'target',
      width: 220,
      render: (_: unknown, record: ProductRouteAssignment) => (
        <Space direction="vertical" size={0}>
          <Tag variant={record.targetType === 'GROUP' ? 'success' : 'warn'}>
            {record.targetType === 'GROUP' ? '渠道组' : '产品渠道'}
          </Tag>
          <span>{record.targetType === 'GROUP' ? routeGroupName(record.targetId) : productChannelName(record.targetId)}</span>
        </Space>
      ),
    },
    {
      title: '模式',
      key: 'mode',
      width: 130,
      render: (_: unknown, record: ProductRouteAssignment) => (
        <Space size={4}>
          <Tag variant="muted">{record.mode}</Tag>
          <Tag variant={record.isActive === false ? 'muted' : 'success'}>
            {record.isActive === false ? '停用' : '启用'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '条件',
      key: 'condition',
      render: (_: unknown, record: ProductRouteAssignment) => (
        <Space direction="vertical" size={0}>
          <Typography.Text type="secondary">{record.modelPattern || '所有模型'}</Typography.Text>
          <Typography.Text type="secondary">{record.clientCompatibility || '所有客户端'}</Typography.Text>
        </Space>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 90,
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_: unknown, record: ProductRouteAssignment) => (
        <Space size={4}>
          <Button size="small" type="link" disabled={!canManage} onClick={() => editRouteAssignment(record)}>编辑</Button>
          <Popconfirm
            title="删除适用对象规则？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteRouteAssignment(record)}
          >
            <Button size="small" type="link" danger disabled={!canManage} loading={routeSaving === `assignment:${record.id}`}>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const columns = [
      {
        title: '渠道',
        key: 'name',
        width: 330,
        render: (_: unknown, r: ChannelRecord) => {
          const servedInboundProtocols = servedInboundProtocolsForChannelRecord(r, runtimeContract);
          const compatibleClients = compatibleClientLabelsForServedInboundProtocols(servedInboundProtocols);
          return (
            <div className="rt-channel-cell">
              <span className={`rt-channel-avatar rt-channel-avatar-${channelTone(r)}`}>
                {channelInitial(r)}
              </span>
              <div className="rt-channel-copy">
                <div className="rt-channel-name">{r.name}</div>
                <div className="rt-channel-meta">
                  {r.provider}
                  {r.sdkType ? ` / ${sdkTypeLabel(r.sdkType)}` : ''}
                </div>
                {(r.providerProfile || servedInboundProtocols.length || r.ownedBy) && (
                  <Space size={4} wrap className="rt-channel-tags">
                    {r.providerProfile && <Tag variant="proc">{providerProfileLabel(r.providerProfile)}</Tag>}
                    {servedInboundProtocols.slice(0, 4).map((protocol) => (
                      <Tag key={protocol} variant="muted">{servedInboundProtocolLabel(protocol)}</Tag>
                    ))}
                    {compatibleClients.length > 0 && (
                      <Tag variant="success">兼容 {compatibleClients.join(' + ')}</Tag>
                    )}
                    {r.ownedBy && <Tag variant="muted">Owned by {r.ownedBy}</Tag>}
                  </Space>
                )}
              </div>
            </div>
          );
        },
      },
    {
      title: '健康度',
      key: 'health',
      width: 100,
      render: (_: unknown, r: ChannelRecord) => (
        <HealthCell status={r.status} isActive={r.isActive} />
      ),
    },
    {
      title: 'Base URL',
      dataIndex: 'baseUrl',
      key: 'baseUrl',
      width: 330,
      ellipsis: true,
      render: (value?: string) => (
        value
          ? (
            <Tooltip title={value}>
              <span className="rt-channel-url">{value}</span>
            </Tooltip>
          )
          : <span className="rt-channel-url">-</span>
      ),
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      key: 'priority',
      width: 82,
      render: (value?: number) => <span className="rt-channel-number">{value ?? '-'}</span>,
    },
    {
      title: '权重',
      dataIndex: 'weight',
      key: 'weight',
      width: 78,
      render: (value?: number) => <span className="rt-channel-number">{value ?? '-'}</span>,
    },
    {
      title: '成功率',
      dataIndex: 'successRate',
      key: 'successRate',
      width: 96,
      render: (v: number | undefined) =>
        <span className="rt-channel-number">{typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : '-'}</span>,
    },
    {
      title: '请求数',
      dataIndex: 'totalReqs',
      key: 'totalReqs',
      width: 90,
      render: (value?: number) => <span className="rt-channel-number">{value ?? 0}</span>,
    },
    {
      title: '状态',
      dataIndex: 'isActive',
      key: 'isActive',
      width: 90,
      render: (v: boolean) =>
        v ? <Tag variant="success">启用</Tag> : <Tag variant="muted">停用</Tag>,
    },
    {
      title: '操作',
      key: 'action',
      width: 350,
      align: 'right' as const,
      fixed: 'right' as const,
      render: (_: unknown, record: ChannelRecord) => (
        <Space size="small" className="rt-channel-actions">
          <Button
            size="small"
            className="rt-action-btn"
            icon={<ThunderboltOutlined />}
            disabled={!canManage}
            onClick={() => handleTest(record.id)}
          >
            测试
          </Button>
          <Button
            size="small"
            className="rt-action-btn"
            icon={<CloudDownloadOutlined />}
            disabled={!canManage}
            onClick={() => handleOpenDiscover(record)}
          >
            拉取模型
          </Button>
          <Button
            size="small"
            className="rt-action-btn"
            icon={<SettingOutlined />}
            disabled={!canViewDeliverySettings}
            onClick={() => {
              navigate('/delivery-settings');
            }}
          >
            投放设置
          </Button>
          <Tooltip title="编辑渠道">
            <Button
              size="small"
              className="rt-action-icon"
              aria-label="编辑"
              icon={<EditOutlined />}
              disabled={!canManage}
              onClick={() => handleEdit(record)}
            />
          </Tooltip>
          <Popconfirm
            title="确认删除？"
            onConfirm={() => handleDelete(record.id)}
          >
            <Button
              size="small"
              className="rt-action-icon"
              aria-label="删除"
              danger
              icon={<DeleteOutlined />}
              disabled={!canManage}
            />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="rt-channels-page">
      <PageHeader
        title="供应商管理"
        subtitle="维护上游供应商渠道、协议 Profile 和凭证状态"
        actions={[
          <Button
            key="hc"
            icon={<HeartOutlined />}
            onClick={handleBulkHealthCheck}
            loading={healthChecking}
            disabled={!canManage}
          >
            健康检测
          </Button>,
          <Button
            key="provider-accounts"
            icon={<IdcardOutlined />}
            onClick={() => {
              setProviderAccountDrawerOpen(true);
              void fetchProviderAccountIdentities();
            }}
          >
            账户身份
          </Button>,
          <Button
            key="new"
            type="primary"
            icon={<PlusOutlined />}
            loading={runtimeContractLoading}
            disabled={!canManage}
            onClick={() => {
              setEditingId(null);
              form.resetFields();
              form.setFieldsValue(channelRuntimeDefaults());
              setModalOpen(true);
            }}
          >
            新建渠道
          </Button>,
        ]}
      />

      <StatCardGroup>
        <StatCard label="总渠道" value={data.total} icon={<ApiOutlined />} />
        <StatCard label="健康" value={summary.healthy} variant="success" icon={<HeartOutlined />} />
        <StatCard label="异常" value={summary.down} variant="error" icon={<WarningOutlined />} />
        <StatCard label="今日请求" value={summary.totalReqs} icon={<LineChartOutlined />} />
      </StatCardGroup>

      <FilterBar
        search={{
          placeholder: '搜索渠道名 / Provider',
          value: search,
          onSearch: (v) => setSearch(v),
        }}
        filters={[
          <Select
            key="status"
            value={statusFilter}
            style={{ width: 130 }}
            onChange={setStatusFilter}
            options={[
              { value: 'all', label: '全部状态' },
              { value: 'active', label: '启用' },
              { value: 'inactive', label: '停用' },
              { value: 'down', label: '异常' },
            ]}
          />,
          <Select
            key="provider"
            value={providerFilter}
            style={{ width: 150 }}
            onChange={setProviderFilter}
            options={[
              { value: 'all', label: '全部供应商' },
              ...providerOptions.map((p) => ({ value: p, label: p })),
            ]}
          />,
          <Select
            key="sdk"
            value={sdkFilter}
            style={{ width: 130 }}
            onChange={setSdkFilter}
            disabled={sdkOptions.length === 0}
            options={[
              { value: 'all', label: '全部 SDK' },
              ...sdkOptions.map((s) => ({ value: s, label: sdkTypeLabel(s) })),
            ]}
          />,
        ]}
        rightActions={(
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setSearch('');
              setStatusFilter('all');
              setProviderFilter('all');
              setSdkFilter('all');
            }}
          >
            重置
          </Button>
        )}
      />

      <DataTable<ChannelRecord>
        className="rt-channel-table"
        columns={columns}
        dataSource={visibleItems}
        rowKey="id"
        loading={loading}
        size="middle"
        tableLayout="fixed"
        listPagination={{
          current: page,
          total: filtered.length,
          pageSize: 20,
          onChange: setPage,
        }}
        scroll={{ x: 1546 }}
      />

      <Modal
        title={editingId ? '编辑渠道' : '新增渠道'}
        open={modalOpen}
        onOk={handleSave}
        confirmLoading={saving}
        okButtonProps={{ disabled: saving || !canManage }}
        onCancel={() => {
          setModalOpen(false);
          setEditingId(null);
        }}
        width={720}
      >
        <Form form={form} layout="vertical" className="rt-channel-form" disabled={!canManage}>
          <Form.Item name="sdkType" hidden rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <div className="rt-channel-form-grid">
            <Form.Item name="name" label="名称" rules={[{ required: true }]}>
              <Input placeholder="如：智谱主力" />
            </Form.Item>
            <Form.Item
              name="provider"
              label="上游供应商"
              rules={[{ required: true }]}
            >
              <Select
                showSearch
                placeholder="选择上游供应商"
                options={PROVIDER_OPTIONS}
                optionFilterProp="label"
                onChange={(value) => {
                  form.setFieldsValue({
                    ...channelRuntimeDefaults(value),
                    providerAccountIdentityId: undefined,
                  });
                }}
              />
            </Form.Item>
          </div>

          <div className="rt-channel-form-grid">
            <Form.Item
              name="providerProfile"
              label="协议 Profile"
              rules={[{ required: true, message: '请选择协议 Profile' }]}
            >
                <Select
                  allowClear
                  showSearch
                  placeholder="选择协议 Profile"
                  options={providerProfileOptions}
                  optionFilterProp="label"
                  onChange={(value) => {
                    const servedInboundProtocols = defaultServedInboundProtocolsForProfile(value, runtimeContract) ?? DEFAULT_SERVED_INBOUND_PROTOCOLS;
                    form.setFieldsValue({
                      providerProfile: value,
                      sdkType: sdkTypeDefaultForProviderProfile(value),
                      servedInboundProtocols,
                      protocolPaths: protocolPathsForServedInboundProtocols(servedInboundProtocols, value),
                    });
                  }}
                />
            </Form.Item>
            <Form.Item
              name="providerAccountIdentityId"
              label="供应商账户"
              tooltip="稳定标识上游供应商账户；更换 API Key 时应保持不变。"
              rules={[
                { required: true, message: '请选择供应商账户身份' },
                { validator: validateProviderAccountIdentity },
              ]}
              extra={selectedProviderAccountIdentity ? (
                <span>
                  账户引用：{' '}
                  <Typography.Text code copyable>
                    {selectedProviderAccountIdentity.ref}
                  </Typography.Text>
                </span>
              ) : (
                <Typography.Text type="secondary">
                  没有可用账户？{' '}
                  <Typography.Link onClick={openProviderAccountCreate}>
                    新建账户身份
                  </Typography.Link>
                </Typography.Text>
              )}
            >
              <Select
                showSearch
                loading={providerAccountIdentitiesLoading}
                disabled={!watchedProvider}
                placeholder={watchedProvider ? '选择与供应商匹配的账户' : '请先选择供应商'}
                optionFilterProp="label"
                options={providerAccountIdentityOptions}
                notFoundContent={providerAccountIdentitiesLoading ? '加载中…' : '暂无匹配账户'}
              />
            </Form.Item>
          </div>

          <div className="rt-channel-form-grid">
            <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true }]}>
              <Input placeholder="https://example.com/v1" />
            </Form.Item>
            <Form.Item name="apiKey" label="API Key" rules={[{ required: !editingId }]}>
              <Input.Password placeholder={editingId ? '留空则保持原 key' : 'sk-...'} />
            </Form.Item>
          </div>

          <Form.Item
            name="models"
            label="支持模型"
            tooltip="保存后,用列表上的'拉取模型'按钮从上游拉取并多选填入。也可手写 JSON 数组。"
          >
            <Input placeholder='留空,创建后用"拉取模型"按钮选择;或手写如 ["gpt-4o","gpt-4o-mini"]' />
          </Form.Item>

          <Collapse
            ghost
            size="small"
            className="rt-channel-advanced"
            items={[
                {
                  key: 'runtime',
                  label: '高级设置',
                  children: (
                    <>
                      <ProtocolPathList
                        name="protocolPaths"
                        label="路径列表"
                        inboundProtocolOptions={runtimeServedInboundProtocolOptions}
                        channelOptions={runtimeProtocolPathChannelOptions}
                        upstreamProtocol={runtimeUpstreamProtocol}
                      />
                      <div className="rt-channel-form-grid">
                        <Form.Item
                          name="servedInboundProtocols"
                          label="服务入站协议（双发兼容）"
                          tooltip='GLM coding 示例：Anthropic 端点选择 ["anthropic"]；OpenAI 端点选择 ["openai","responses"]。'
                        >
                          <Select
                            allowClear
                            mode="multiple"
                            placeholder="选择入站协议"
                            options={runtimeServedInboundProtocolOptions}
                          />
                        </Form.Item>
                      </div>
                      <div className="rt-channel-form-grid">
                        <Form.Item
                          name="ownedBy"
                          label="Owned by"
                          tooltip="用于生成 Publisher provider owned_by；按实际上游归属填写，不再从渠道 ID 自动派生。"
                        >
                          <Input placeholder="如：kimi-main 或 provider line code" />
                        </Form.Item>
                      </div>
                    <Button
                      size="small"
                      icon={<SettingOutlined />}
                      loading={runtimePreviewing}
                      disabled={!canManage}
                      onClick={handlePublisherCompilePreview}
                    >
                      预览 Publisher 编译结果
                    </Button>
                  </>
                ),
              },
            ]}
          />

          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="供应商账户身份"
        placement="right"
        width={640}
        open={providerAccountDrawerOpen}
        onClose={() => setProviderAccountDrawerOpen(false)}
        extra={(
          <Button
            type="primary"
            size="small"
            icon={<PlusOutlined />}
            disabled={!canManage}
            onClick={openProviderAccountCreate}
          >
            新建账户
          </Button>
        )}
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <Alert
            type="info"
            showIcon
            message="账户身份独立于 API Key"
            description="同一供应商账户轮换 Key 时继续使用原账户身份。账户引用由服务端生成，只读且不会保存密钥内容。"
          />
          <List
            loading={providerAccountIdentitiesLoading}
            dataSource={providerAccountIdentities}
            locale={{ emptyText: '暂无供应商账户身份' }}
            renderItem={(identity) => {
              const active = isProviderAccountIdentityActive(identity);
              return (
                <List.Item
                  actions={active ? [
                    <Popconfirm
                      key="deactivate"
                      title="停用这个账户身份？"
                      description="已被渠道引用时，Billing 会拒绝不安全的停用操作。"
                      okText="停用"
                      cancelText="取消"
                      onConfirm={() => handleDeactivateProviderAccountIdentity(identity)}
                    >
                      <Button
                        type="link"
                        danger
                        size="small"
                        disabled={!canManage}
                        loading={providerAccountDeactivatingId === identity.id}
                      >
                        停用
                      </Button>
                    </Popconfirm>,
                  ] : undefined}
                >
                  <List.Item.Meta
                    title={(
                      <Space size={8}>
                        <Typography.Text strong>{identity.displayName}</Typography.Text>
                        <Tag variant={active ? 'success' : 'muted'}>
                          {active ? '启用' : '已停用'}
                        </Tag>
                        <Tag variant="proc">{identity.providerCode}</Tag>
                      </Space>
                    )}
                    description={(
                      <Space direction="vertical" size={2}>
                        <Typography.Text type="secondary">账户引用</Typography.Text>
                        <Typography.Text code copyable>{identity.ref}</Typography.Text>
                      </Space>
                    )}
                  />
                </List.Item>
              );
            }}
          />
        </Space>
      </Drawer>

      <Modal
        title="新建供应商账户身份"
        open={providerAccountCreateOpen}
        onOk={handleCreateProviderAccountIdentity}
        confirmLoading={providerAccountCreating}
        okButtonProps={{ disabled: !canManage }}
        onCancel={() => {
          setProviderAccountCreateOpen(false);
          providerAccountCreateForm.resetFields();
        }}
        destroyOnClose
      >
        <Form
          form={providerAccountCreateForm}
          layout="vertical"
          disabled={!canManage}
          preserve={false}
        >
          <Form.Item
            name="providerCode"
            label="上游供应商"
            rules={[{ required: true, message: '请选择上游供应商' }]}
          >
            <Select
              showSearch
              optionFilterProp="label"
              options={PROVIDER_OPTIONS}
              placeholder="选择账户所属供应商"
            />
          </Form.Item>
          <Form.Item
            name="displayName"
            label="账户名称"
            rules={[
              { required: true, whitespace: true, message: '请输入账户名称' },
              { max: 100, message: '账户名称最多 100 个字符' },
            ]}
          >
            <Input placeholder="如：Kimi 国内主账户" maxLength={100} />
          </Form.Item>
          <Alert
            type="warning"
            showIcon
            message="供应商创建后不可修改"
            description="请按真实账单账户归属选择供应商；账户引用会由服务端自动生成。"
          />
        </Form>
      </Modal>

      <Drawer
        title={deliveryChannel ? `${deliveryChannel.name} · 投放配置` : '渠道投放配置'}
        placement="right"
        width={1180}
        open={deliveryOpen}
        onClose={() => {
          setDeliveryOpen(false);
          setDeliveryChannel(null);
          setDeliveryProductId(null);
        }}
        destroyOnClose
      >
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          {deliveryChannel && (
            <Descriptions bordered size="small" column={3}>
              <Descriptions.Item label="物理渠道">
                <Typography.Text strong>{deliveryChannel.name}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="协议">
                {providerProfileLabel(deliveryChannel.providerProfile) || sdkTypeLabel(deliveryChannel.sdkType)}
              </Descriptions.Item>
              <Descriptions.Item label="模型数">
                {deliveryChannelModels.length}
              </Descriptions.Item>
              <Descriptions.Item label="Channel ID">
                <Typography.Text copyable code>{deliveryChannel.id}</Typography.Text>
              </Descriptions.Item>
              <Descriptions.Item label="Provider">
                {deliveryChannel.provider}
              </Descriptions.Item>
              <Descriptions.Item label="状态">
                <HealthCell status={deliveryChannel.status} isActive={deliveryChannel.isActive} />
              </Descriptions.Item>
            </Descriptions>
          )}

          <div className="rt-delivery-toolbar">
            <div>
              <Typography.Text strong>产品上下文</Typography.Text>
              <Typography.Paragraph type="secondary" style={{ margin: '4px 0 0' }}>
                Publisher runtime 以产品 route graph 下发，渠道组和适用对象规则都必须落在某个产品下。
              </Typography.Paragraph>
            </div>
            <Select
              showSearch
              optionFilterProp="label"
              loading={deliveryProductsLoading}
              value={deliveryProductId ?? undefined}
              placeholder="选择产品"
              options={deliveryProductOptions}
              onChange={handleDeliveryProductChange}
              style={{ minWidth: 320 }}
            />
          </div>

          {!deliveryProductId ? (
            <Alert
              type="info"
              showIcon
              message="先选择产品"
              description="选择产品后，可以把当前物理渠道投放成产品渠道，再配置渠道组和适用对象规则。"
            />
          ) : (
            <>
              {selectedDeliveryProduct && (
                <Alert
                  type={currentProductChannel ? 'success' : 'warning'}
                  showIcon
                  message={
                    currentProductChannel
                      ? `当前渠道已投放到 ${selectedDeliveryProduct.name}`
                      : `当前渠道尚未投放到 ${selectedDeliveryProduct.name}`
                  }
                  description={
                    currentProductChannel
                      ? '可以继续把该产品渠道加入渠道组，或把用户/用户分群定向到它。'
                      : '先在“产品投放”里添加产品渠道，否则不能作为 route graph 的目标。'
                  }
                />
              )}

              <Tabs
                items={[
                  {
                    key: 'delivery',
                    label: '产品投放',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Form form={routeChannelForm} layout="vertical" disabled={!canManage}>
                          <Form.Item name="channelId" hidden>
                            <Input />
                          </Form.Item>
                          <div className="rt-delivery-grid">
                            <Form.Item name="displayName" label="展示名">
                              <Input placeholder="默认使用物理渠道名称" />
                            </Form.Item>
                            <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                              <Select
                                options={[
                                  { value: 'active', label: '启用' },
                                  { value: 'testing', label: '测试' },
                                  { value: 'disabled', label: '停用' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="isDefault" label="默认渠道" valuePropName="checked">
                              <Switch checkedChildren="是" unCheckedChildren="否" />
                            </Form.Item>
                            <Form.Item name="allowedModels" label="允许模型">
                              <Select
                                mode="tags"
                                allowClear
                                tokenSeparators={[',', ' ']}
                                options={routeModelOptions}
                                placeholder="留空继承当前渠道模型"
                              />
                            </Form.Item>
                            <Form.Item name="deniedModels" label="拒绝模型">
                              <Select
                                mode="tags"
                                allowClear
                                tokenSeparators={[',', ' ']}
                                options={routeModelOptions}
                                placeholder="可选"
                              />
                            </Form.Item>
                            <Form.Item name="priority" label="优先级">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="weight" label="权重">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="maxRpm" label="Max RPM">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="maxTpm" label="Max TPM">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                          </div>
                          <Space>
                            <Button
                              type="primary"
                              onClick={saveRouteChannel}
                              loading={routeSaving === 'channel'}
                              disabled={!canManage || Boolean(currentProductChannel && !editingRouteChannelId)}
                            >
                              {editingRouteChannelId ? '保存产品投放' : '添加产品投放'}
                            </Button>
                            <Button onClick={() => resetDeliveryRouteForms()}>取消编辑</Button>
                          </Space>
                        </Form>

                        <DataTable
                          dataSource={currentChannelBindings}
                          columns={deliveryChannelColumns}
                          rowKey="id"
                          loading={routeLoading}
                          pagination={false}
                          size="small"
                          scroll={{ x: 860 }}
                        />
                      </Space>
                    ),
                  },
                  {
                    key: 'targets',
                    label: '路由目标',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Form form={routeGroupForm} layout="vertical" disabled={!canManage}>
                          <div className="rt-delivery-grid compact">
                            <Form.Item name="code" label="Code" rules={[{ required: true, message: '请输入 code' }]}>
                              <Input placeholder="default / vip" />
                            </Form.Item>
                            <Form.Item name="name" label="名称" rules={[{ required: true, message: '请输入名称' }]}>
                              <Input />
                            </Form.Item>
                            <Form.Item name="strategy" label="策略" rules={[{ required: true, message: '请选择策略' }]}>
                              <Select
                                options={[
                                  { value: 'weighted_failover', label: '加权 failover' },
                                  { value: 'priority_failover', label: '优先级 failover' },
                                  { value: 'round_robin', label: '轮询' },
                                  { value: 'cost_first', label: '成本优先' },
                                  { value: 'latency_first', label: '延迟优先' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                              <Select
                                options={[
                                  { value: 'active', label: '启用' },
                                  { value: 'disabled', label: '停用' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="isDefault" label="默认组" valuePropName="checked">
                              <Switch checkedChildren="是" unCheckedChildren="否" />
                            </Form.Item>
                          </div>
                          <Space>
                            <Button type="primary" disabled={!canManage} onClick={saveRouteGroup} loading={routeSaving === 'group'}>
                              {editingRouteGroupId ? '保存渠道组' : '创建渠道组'}
                            </Button>
                            <Button onClick={() => resetDeliveryRouteForms()}>取消编辑</Button>
                          </Space>
                        </Form>

                        <DataTable
                          dataSource={routeGroups}
                          columns={routeGroupColumns}
                          rowKey="id"
                          loading={routeLoading}
                          pagination={false}
                          size="small"
                          scroll={{ x: 900 }}
                        />

                        <Divider style={{ margin: '4px 0' }} />

                        <Form form={routeMemberForm} layout="vertical" disabled={!canManage}>
                          <div className="rt-delivery-grid compact">
                            <Form.Item name="groupId" label="渠道组" rules={[{ required: true, message: '请选择渠道组' }]}>
                              <Select options={routeGroupOptions} disabled={!!editingRouteMember} />
                            </Form.Item>
                            <Form.Item
                              name="productChannelId"
                              label="产品渠道"
                              rules={[{ required: true, message: '请选择产品渠道' }]}
                            >
                              <Select options={routeProductChannelOptions} disabled={!!editingRouteMember} />
                            </Form.Item>
                            <Form.Item name="role" label="角色">
                              <Select
                                options={[
                                  { value: 'primary', label: 'primary' },
                                  { value: 'fallback', label: 'fallback' },
                                  { value: 'shadow', label: 'shadow' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="priority" label="优先级">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="weight" label="权重">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item label="操作">
                              <Button type="primary" disabled={!canManage} onClick={saveRouteMember} loading={routeSaving === 'member'}>
                                {editingRouteMember ? '保存成员' : '添加成员'}
                              </Button>
                            </Form.Item>
                          </div>
                        </Form>

                        <DataTable
                          dataSource={routeGroupMembers}
                          columns={routeMemberColumns}
                          rowKey="id"
                          loading={routeLoading}
                          pagination={false}
                          size="small"
                          scroll={{ x: 820 }}
                        />
                      </Space>
                    ),
                  },
                  {
                    key: 'subjects',
                    label: '适用对象',
                    children: (
                      <Space direction="vertical" size={16} style={{ width: '100%' }}>
                        <Form form={routeAssignmentForm} layout="vertical" disabled={!canManage}>
                          <div className="rt-delivery-grid">
                            <Form.Item name="subjectType" label="适用对象" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { value: 'USER', label: '指定用户' },
                                  { value: 'USER_SEGMENT', label: '用户分群' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="subjectId" label="对象 ID" rules={[{ required: true, message: '请选择或输入对象' }]}>
                              {watchedAssignmentSubjectType === 'USER_SEGMENT' ? (
                                <Select
                                  showSearch
                                  optionFilterProp="label"
                                  placeholder="选择用户分群"
                                  options={routeSegmentOptions}
                                />
                              ) : (
                                <Input placeholder="user id" />
                              )}
                            </Form.Item>
                            <Form.Item name="targetType" label="目标类型" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { value: 'GROUP', label: '渠道组' },
                                  { value: 'PRODUCT_CHANNEL', label: '产品渠道' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="targetId" label="目标" rules={[{ required: true, message: '请选择目标' }]}>
                              <Select showSearch optionFilterProp="label" options={routeAssignmentTargetOptions} />
                            </Form.Item>
                            <Form.Item name="mode" label="模式" rules={[{ required: true }]}>
                              <Select
                                options={[
                                  { value: 'ONLY', label: 'ONLY' },
                                  { value: 'PREFER', label: 'PREFER' },
                                ]}
                              />
                            </Form.Item>
                            <Form.Item name="priority" label="优先级">
                              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
                            </Form.Item>
                            <Form.Item name="modelPattern" label="模型匹配">
                              <Input placeholder="可选，如 glm-*" />
                            </Form.Item>
                            <Form.Item name="clientCompatibility" label="客户端兼容">
                              <Select allowClear options={routeClientCompatibilityOptions} placeholder="所有客户端" />
                            </Form.Item>
                            <Form.Item name="startsAt" label="开始时间">
                              <Input placeholder="ISO 时间，可选" />
                            </Form.Item>
                            <Form.Item name="endsAt" label="结束时间">
                              <Input placeholder="ISO 时间，可选" />
                            </Form.Item>
                            <Form.Item name="isActive" label="启用" valuePropName="checked">
                              <Switch checkedChildren="启用" unCheckedChildren="停用" />
                            </Form.Item>
                            <Form.Item name="reason" label="原因">
                              <Input placeholder="可选" />
                            </Form.Item>
                          </div>
                          <Space>
                            <Button
                              type="primary"
                              onClick={saveRouteAssignment}
                              loading={routeSaving === 'assignment'}
                              disabled={!canManage}
                            >
                              {editingRouteAssignmentId ? '保存规则' : '创建规则'}
                            </Button>
                            <Button onClick={() => resetDeliveryRouteForms()}>取消编辑</Button>
                          </Space>
                        </Form>

                        <DataTable
                          dataSource={routeAssignments}
                          columns={routeAssignmentColumns}
                          rowKey="id"
                          loading={routeLoading}
                          pagination={false}
                          size="small"
                          scroll={{ x: 980 }}
                        />
                      </Space>
                    ),
                  },
                  {
                    key: 'graph',
                    label: '下发预览',
                    children: (
                      <Space direction="vertical" size={12} style={{ width: '100%' }}>
                        <Alert
                          type="info"
                          showIcon
                          message="这里展示 Billing 按 Publisher contract 编译出的产品 route graph"
                          description="前端只维护产品渠道、渠道组和适用对象规则；RuntimeIntent 仍由 Billing 统一生成并校验。"
                        />
                        <Space>
                          <Button onClick={refreshDeliveryRouteData} loading={routeLoading}>刷新预览</Button>
                          <Button
                            type="primary"
                            onClick={rebuildRouteGraph}
                            loading={routeSaving === 'graph'}
                            disabled={!canManage}
                          >
                            重推配置
                          </Button>
                        </Space>
                        <Input.TextArea
                          value={JSON.stringify(routeGraph ?? {}, null, 2)}
                          readOnly
                          rows={18}
                          style={{ fontFamily: 'monospace' }}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
            </>
          )}
        </Space>
      </Drawer>

      {/* 拉取模型 Modal */}
      <Modal
        title={`拉取上游模型${discoverChannel ? ` - ${discoverChannel.name}` : ''}`}
        open={discoverOpen}
        onCancel={() => {
          setDiscoverOpen(false);
          setDiscoverChannel(null);
        }}
        onOk={handleSaveModels}
        okText="保存到渠道"
        confirmLoading={savingModels}
        okButtonProps={{ disabled: discoverLoading || !canManage }}
        width={640}
      >
        {discoverLoading && <div style={{ padding: 24, textAlign: 'center' }}>正在拉取...</div>}
        {!discoverLoading && discoverError && (
          <div style={{ padding: 12, marginBottom: 12, background: '#fff2e8', border: '1px solid #ffbb96', borderRadius: 4 }}>
            <strong>拉取失败:</strong>{discoverError}
            <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
              你仍可手动维护下方已选模型列表。
            </div>
          </div>
        )}
        {!discoverLoading && (
          <>
            <div style={{ marginBottom: 12, fontSize: 13, color: '#666' }}>
              上游发现 <strong>{availableModels.length}</strong> 个可用模型,已选 <strong>{selectedModels.length}</strong>
              <Button
                type="link"
                size="small"
                style={{ marginLeft: 8 }}
                disabled={!canManage}
                onClick={() => setSelectedModels(normalizeModelNames([...selectedModels, ...availableModels]))}
              >
                全选
              </Button>
              <Button
                type="link"
                size="small"
                disabled={!canManage}
                onClick={() => setSelectedModels([])}
              >
                清空
              </Button>
            </div>
            <Select
              mode="tags"
              style={{ width: '100%' }}
              placeholder="选择或输入模型名，按 Enter 添加"
              value={selectedModels}
              disabled={!canManage}
              onChange={(values) => {
                const models = normalizeModelNames(values);
                setSelectedModels(models);
                setAvailableModels((prev) => normalizeModelNames([...prev, ...models]));
              }}
              options={availableModels.map((m) => ({ label: m, value: m }))}
              showSearch
              tokenSeparators={[',', '\n']}
              filterOption={(input, option) =>
                String(option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
              拉取失败或上游不提供 /v1/models 时，可直接输入模型 ID 手动加入渠道白名单。
            </Typography.Text>
            {selectedModels.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  点击模型行配置该模型在此渠道的启用状态、上游别名和路由优先级。
                </Typography.Text>
                <List
                  size="small"
                  bordered
                  style={{ marginTop: 8, maxHeight: 280, overflow: 'auto' }}
                  dataSource={selectedModels}
                  renderItem={(modelName) => (
                    <List.Item
                      actions={[
                        <Tooltip
                          key="cfg"
                          title={hasModelConfig(modelName) ? '已配置 per-model 参数' : '配置 per-model 参数'}
                        >
                          <Button
                            type={hasModelConfig(modelName) ? 'primary' : 'default'}
                            ghost={hasModelConfig(modelName)}
                            size="small"
                            icon={<SettingOutlined />}
                            disabled={!canManage}
                            onClick={() => setPerModelDrawerName(modelName)}
                          >
                            {hasModelConfig(modelName) ? '已配置' : '配置'}
                          </Button>
                        </Tooltip>,
                      ]}
                    >
                      <span style={{ fontFamily: 'monospace', fontSize: 13 }}>{modelName}</span>
                    </List.Item>
                  )}
                />
              </div>
            )}
          </>
        )}
      </Modal>

      {/* Per-model 配置抽屉 */}
      <Drawer
        title={perModelDrawerName ? `Per-model 配置 - ${perModelDrawerName}` : 'Per-model 配置'}
        placement="right"
        width={460}
        open={!!perModelDrawerName}
        onClose={() => setPerModelDrawerName(null)}
        extra={
          perModelDrawerName && hasModelConfig(perModelDrawerName) ? (
            <Popconfirm
              title="清空此模型的所有 per-model 配置？"
              onConfirm={() => {
                if (!perModelDrawerName) return;
                setModelConfigs((prev) => {
                  const next = { ...prev };
                  delete next[perModelDrawerName];
                  return next;
                });
              }}
              okText="清空"
              cancelText="取消"
            >
              <Button danger size="small" disabled={!canManage}>清空</Button>
            </Popconfirm>
          ) : null
        }
      >
        {perModelDrawerName && (
          <PerModelConfigForm
            modelName={perModelDrawerName}
            value={modelConfigs[perModelDrawerName] ?? {}}
            onChange={(patch) => updatePerModelConfig(perModelDrawerName, patch)}
          />
        )}
      </Drawer>
    </div>
  );
}

// ─── Per-model 配置表单（受控组件） ───
interface PerModelConfigFormProps {
  modelName: string;
  value: PerModelConfig;
  onChange: (patch: Partial<PerModelConfig>) => void;
}

function PerModelConfigForm({ modelName, value, onChange }: PerModelConfigFormProps) {
  // channel 抽屉只保留 per-channel 特有字段：
  //   - enabled：软下线（不删模型只关闭）
  //   - upstreamModelId：上游别名映射（每家上游名可能不同）
  //   - routingPriority：同一模型跨渠道时的路由优先级
  // thinking_budget / reasoning_effort / max_output 这些"模型本身的调用方式"
  // 全部移到模型库（ModelPricing 详情页 → 能力 tab → 调用默认值）。
  return (
    <Form layout="vertical" size="middle">
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
        💡 <strong>thinking budget / reasoning effort 等调用默认值</strong>请到{' '}
        <strong>模型库 → {modelName} → 能力 tab → 调用默认值</strong> 配置。
        <br />
        本页只配置 <strong>per-channel 特有</strong>字段：软下线、上游真实模型 ID、模型级路由优先级。
      </div>

      <Form.Item label="启用此模型" tooltip="软下线开关：关闭后此 channel 不再服务该模型，但保留配置不删">
        <Switch
          checked={value.enabled !== false}
          onChange={(v) => onChange({ enabled: v })}
        />
      </Form.Item>
      <Form.Item
        label="上游真实模型 ID"
        tooltip="平台对外名 → 上游真实名映射。如平台叫 claude-opus-4-7，但走 Bedrock 上游真实名是 anthropic.claude-opus-4-v1。留空则上游与对外名同名。"
      >
        <Input
          placeholder={`默认与 ${modelName} 同名`}
          value={value.upstreamModelId ?? ''}
          onChange={(e) => onChange({ upstreamModelId: e.target.value })}
        />
      </Form.Item>
      <Form.Item
        label="模型路由优先级"
        tooltip="同一个模型被多个渠道提供时优先走数字更小的渠道。留空则使用渠道全局优先级。"
      >
        <StableNumberInput
          min={1}
          max={100}
          precision={0}
          placeholder="跟随渠道优先级"
          value={value.routingPriority}
          onChange={(v) => onChange({ routingPriority: typeof v === 'number' ? v : undefined })}
          style={{ width: 180 }}
        />
      </Form.Item>
    </Form>
  );
}
