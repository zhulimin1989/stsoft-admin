import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Spin,
  Switch,
  Typography,
} from 'antd';
import {
  DeleteOutlined,
  KeyOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  DataTable,
  EmptyPlaceholder,
  PageHeader,
  StatCard,
  StatCardGroup,
  StableNumberInput,
  Tag,
  type TagVariant,
} from '../../components/common';
import {
  codingPlanAdminApi,
  providerAccountIdentityApi,
  productApi,
  publisherSyncMessage,
  publisherWarningsText,
  type CodingPlanResalePlanWriteInput,
  type CodingPlanResalePlanRouteWriteInput,
  type CodingPlanProviderEntitlement,
  type CodingPlanProviderLine,
  type CodingPlanProviderProduct,
  type CodingPlanResaleRoute,
  type CodingPlanWorkspace,
  type CodingPlanWorkspacePlan,
  type ProviderAccountIdentity,
  type ProductChannelRouteRow,
  type ProductRuntimePolicyChannel,
  type ProtocolPath,
} from '../../api/admin';
import { ProtocolPathList, suggestedProtocolChannel } from '../../components/common/ProtocolPathList';
import { usePlatformCurrency } from '../../contexts/PlatformConfigContext';
import { usePermission } from '../../hooks/usePermission';
import { userSegmentApi, type UserSegment } from '../../api/v2';
import { currencyMinorUnitLabel, formatCurrencyCents } from '../../utils/price';
import {
  isProviderAccountIdentityActive,
  providerAccountIdentitiesForProvider,
  providerAccountIdentitySelectionError,
} from '../../utils/providerAccountIdentities';
import '../CodingPlan/CodingPlan.css';
import './CodingPlanResale.css';

type ResalePageMode = 'plans' | 'config' | 'report';
type DedicatedProtocolStrategy = 'passthrough' | 'responses_to_chat' | 'anthropic_to_chat';

type FormValidationErrorField = {
  name?: Array<string | number>;
  errors?: unknown[];
};

type FormValidationError = {
  errorFields?: FormValidationErrorField[];
};

type ThirdPartyPlanForm = {
  productId: string;
  name: string;
  description?: string;
  badge?: string;
  monthlyPrice?: number;
  quarterlyPrice?: number;
  yearlyPrice?: number;
  billingPeriod?: string;
  validityDays?: number;
  memberLimit?: number;
  salesLimit?: number;
  sortOrder?: number;
  isActive?: boolean;
  routes?: ThirdPartyPlanRouteForm[];
  routeEnabled?: boolean;
  routeMarket?: string | null;
  routeCurrency?: string | null;
  routeSalesChannel?: string | null;
  routeUserSegmentId?: string | null;
  routeStartAt?: Dayjs | string | null;
  routeEndAt?: Dayjs | string | null;
};

type ThirdPartyPlanRouteForm = {
  routeId?: string | null;
  providerLineId?: string;
  upstreamProductId?: string;
};

type ProviderLineForm = {
  code: string;
  name: string;
  providerCode: string;
  providerAccountIdentityId?: string;
  providerName?: string;
  adapterType: string;
  environment?: string;
  apiBaseUrl: string;
  authType?: string;
  partnerCode?: string;
  partnerSecretKey?: string;
  salesEnabled?: boolean;
  fulfillmentEnabled?: boolean;
  runtimeEnabled?: boolean;
  syncEnabled?: boolean;
  dedicatedEndpoints?: ProviderLineDedicatedEndpointForm[];
};

type ProviderLineDedicatedEndpointForm = {
  client_protocol?: 'anthropic' | 'openai' | 'responses' | string;
  provider_id?: string;
  protocol_strategy?: DedicatedProtocolStrategy | string;
  base_url?: string;
  provider_profile?: string;
  name?: string;
  code?: string;
  owned_by?: string;
  status?: string;
  client_compatibility?: string[];
  served_inbound_protocols?: string[];
  paths?: ProtocolPath[];
  capabilities?: string[];
  token_count_strategy?: string;
  priority?: number;
  weight?: number;
};

type DedicatedProductChannelRow = ProductChannelRouteRow & {
  id: string;
  productId?: string;
  channelId?: string;
  displayName?: string | null;
  status?: string;
  allowedModels?: unknown;
  priority?: number;
  weight?: number;
  maxRpm?: number | null;
  maxTpm?: number | null;
  metadata?: Record<string, unknown> | null;
  channel?: ProductRuntimePolicyChannel;
};

type ThirdPartyPlanRow = {
  id: string;
  plan: CodingPlanWorkspacePlan | null;
  routePlan: CodingPlanResaleRoute['plan'] | null;
  route: CodingPlanResaleRoute;
  routes: CodingPlanResaleRoute[];
  bindings: ThirdPartyPlanRouteBinding[];
  providerLine: CodingPlanProviderLine | CodingPlanResaleRoute['providerLine'] | null;
  upstreamProduct: CodingPlanProviderProduct | null;
};

type ThirdPartyPlanRouteBinding = {
  route: CodingPlanResaleRoute;
  providerLine: CodingPlanProviderLine | CodingPlanResaleRoute['providerLine'] | null;
  upstreamProduct: CodingPlanProviderProduct | null;
};

const MODE_META: Record<ResalePageMode, { title: string; subtitle: string }> = {
  plans: {
    title: 'CodingPlan 三方套餐',
    subtitle: '管理用户看到的本地售卖 SKU，并把 SKU 绑定到供应商线路的上游套餐。',
  },
  config: {
    title: 'CodingPlan 转售配置',
    subtitle: '管理供应商线路凭证、专属端点、目录刷新和上架状态。',
  },
  report: {
    title: 'CodingPlan 转售报表',
    subtitle: '查看购买三方套餐的用户、激活状态、绑定上游 key 前缀和有效期。',
  },
};

const DEDICATED_CLIENT_PROTOCOL_OPTIONS = [
  { value: 'openai', label: 'OpenAI Chat' },
  { value: 'responses', label: 'OpenAI Responses' },
  { value: 'anthropic', label: 'Anthropic' },
];

const DEDICATED_PROTOCOL_CHANNELS = ['passthrough', 'responses_to_chat', 'anthropic_to_chat'] as const;
const DEDICATED_PROTOCOL_CHANNEL_SET = new Set<string>(DEDICATED_PROTOCOL_CHANNELS);
const DEDICATED_PROTOCOL_STRATEGY_OPTIONS = [
  { value: 'passthrough', label: 'passthrough · 原生直连' },
  { value: 'responses_to_chat', label: 'responses_to_chat · responses→chat 桥' },
  { value: 'anthropic_to_chat', label: 'anthropic_to_chat · anthropic→chat 桥' },
];

const DEDICATED_PROVIDER_PROFILE_OPTIONS = [
  { value: 'glm_coding', label: 'GLM Coding' },
  { value: 'openai_compatible', label: 'OpenAI Compatible' },
  { value: 'anthropic_native', label: 'Anthropic Native' },
];

const DEDICATED_ENDPOINT_STATUS_OPTIONS = [
  { value: 'active', label: '启用' },
  { value: 'disabled', label: '停用' },
];

const PROVIDER_LINE_PRESETS = [
  {
    providerCode: 'zhipu',
    providerName: '智谱',
    adapterType: 'zhipu_partner',
    environment: 'production',
    authType: 'partner_md5_header',
  },
] as const;

const DEFAULT_PROVIDER_LINE_PRESET = PROVIDER_LINE_PRESETS[0];

const LINE_PUBLISH_PATCH = {
  salesEnabled: true,
  fulfillmentEnabled: true,
  runtimeEnabled: true,
  syncEnabled: true,
} as const;
const LINE_DISABLE_PATCH = {
  salesEnabled: false,
  fulfillmentEnabled: false,
  runtimeEnabled: false,
  syncEnabled: false,
} as const;

function zhipuCodingAnthropicDedicatedEndpointTemplate(): ProviderLineDedicatedEndpointForm[] {
  return [{
    client_protocol: 'anthropic',
    protocol_strategy: 'passthrough',
    provider_profile: 'anthropic_native',
    base_url: 'https://open.bigmodel.cn/api/anthropic',
    served_inbound_protocols: ['anthropic'],
    paths: [{ inbound_protocol: 'anthropic', channel: 'passthrough' }],
    status: 'active',
  }];
}

function zhipuCodingOpenAiDedicatedEndpointTemplate(): ProviderLineDedicatedEndpointForm[] {
  return [
    {
      client_protocol: 'openai',
      protocol_strategy: 'passthrough',
      provider_profile: 'glm_coding',
      base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
      served_inbound_protocols: ['openai'],
      paths: [{ inbound_protocol: 'openai', channel: 'passthrough' }],
      status: 'active',
    },
    {
      client_protocol: 'openai',
      protocol_strategy: 'responses_to_chat',
      provider_profile: 'glm_coding',
      base_url: 'https://open.bigmodel.cn/api/coding/paas/v4',
      served_inbound_protocols: ['responses'],
      paths: [{ inbound_protocol: 'responses', channel: 'responses_to_chat' }],
      status: 'active',
    },
  ];
}

function resolveMode(pathname: string): ResalePageMode {
  if (pathname.includes('/resale-config')) return 'config';
  if (pathname.includes('/resale-report')) return 'report';
  return 'plans';
}

function formatCents(cents: number | null | undefined, currency: string): string {
  return formatCurrencyCents(cents, currency, { zeroAsEmpty: true });
}

function buildResalePlanPayload(
  values: ThirdPartyPlanForm,
  currency: string,
  routePriority?: number | null,
): CodingPlanResalePlanWriteInput {
  const routes = normalizePlanRouteForms(values.routes);
  if (routes.length === 0) {
    throw new Error('请至少绑定一条供应商线路');
  }
  const firstRoute = routes[0];
  const routeMarket = values.routeMarket?.trim() || null;
  const routeCurrency = values.routeCurrency?.trim() || null;
  const routeSalesChannel = values.routeSalesChannel?.trim() || null;
  const routeUserSegmentId = values.routeUserSegmentId?.trim() || null;
  const routeStartAt = serializeRouteDate(values.routeStartAt);
  const routeEndAt = serializeRouteDate(values.routeEndAt);
  const routeEnabled = values.routeEnabled ?? true;
  const priority = routePriority ?? 100;
  const writeRoutes: CodingPlanResalePlanRouteWriteInput[] = routes.map((route) => ({
    routeId: route.routeId ?? null,
    providerLineId: route.providerLineId,
    upstreamProductId: route.upstreamProductId,
    routeEnabled,
    routePriority: priority,
    routeMarket,
    routeCurrency,
    routeSalesChannel,
    routeUserSegmentId,
    routeStartAt,
    routeEndAt,
  }));
  return {
    productId: values.productId,
    name: values.name,
    description: values.description ?? '',
    monthlyPrice: values.monthlyPrice ?? 0,
    quarterlyPrice: values.quarterlyPrice ?? 0,
    yearlyPrice: values.yearlyPrice ?? 0,
    billingPeriod: values.billingPeriod ?? 'monthly',
    memberLimit: values.memberLimit ?? 1,
    trialDays: 0,
    validityDays: values.validityDays ?? 30,
    salesLimit: values.salesLimit ?? 0,
    badge: values.badge?.trim() || null,
    sortOrder: values.sortOrder ?? 0,
    isActive: values.isActive ?? false,
    isLegacy: false,
    currency,
    providerLineId: firstRoute.providerLineId,
    upstreamProductId: firstRoute.upstreamProductId,
    routes: writeRoutes,
    routeEnabled,
    routePriority: priority,
    routeId: firstRoute.routeId ?? null,
    routeMarket,
    routeCurrency,
    routeSalesChannel,
    routeUserSegmentId,
    routeStartAt,
    routeEndAt,
  };
}

function normalizePlanRouteForms(
  routes: ThirdPartyPlanRouteForm[] | undefined,
): Array<{ routeId?: string | null; providerLineId: string; upstreamProductId: string }> {
  return (routes ?? [])
    .map((route) => ({
      routeId: compactText(route.routeId) ?? null,
      providerLineId: compactText(route.providerLineId) ?? '',
      upstreamProductId: compactText(route.upstreamProductId) ?? '',
    }))
    .filter((route) => route.providerLineId || route.upstreamProductId)
    .map((route) => ({
      routeId: route.routeId,
      providerLineId: route.providerLineId,
      upstreamProductId: route.upstreamProductId,
    }));
}

function formatDate(value?: string | null): string {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '—';
}

function serializeRouteDate(value?: Dayjs | string | null): string | null {
  if (!value) return null;
  if (dayjs.isDayjs(value)) return value.toISOString();
  const normalized = String(value).trim();
  if (!normalized) return null;
  const parsed = dayjs(normalized);
  return parsed.isValid() ? parsed.toISOString() : normalized;
}

function statusTag(status: string) {
  if (status === 'ACTIVE') return <Tag variant="success">已激活</Tag>;
  if (status === 'PENDING') return <Tag variant="warn">待履约</Tag>;
  if (status === 'FAILED') return <Tag variant="error">履约失败</Tag>;
  if (status === 'EXPIRED' || status === 'REVOKED') return <Tag variant="muted">{status}</Tag>;
  return <Tag>{status}</Tag>;
}

function compactText(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function validationErrorText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  return undefined;
}

function firstFormValidationError(error: unknown): { name?: Array<string | number>; message?: string } | null {
  const errorFields = (error as FormValidationError | undefined)?.errorFields;
  if (!Array.isArray(errorFields) || errorFields.length === 0) return null;
  const field = errorFields.find((item) => item.errors?.some(validationErrorText)) ?? errorFields[0];
  return {
    name: Array.isArray(field.name) ? field.name : undefined,
    message: field.errors?.map(validationErrorText).find(Boolean),
  };
}

function providerLineCodePart(value: unknown): string {
  return (compactText(value) ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function providerLineCodeHash(value: unknown): string {
  const text = compactText(value);
  if (!text) return '';
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash * 31) + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36).padStart(4, '0').slice(0, 6);
}

function generatedProviderLineCode(values: Partial<ProviderLineForm>): string {
  const providerCode = providerLineCodePart(values.providerCode) || DEFAULT_PROVIDER_LINE_PRESET.providerCode;
  const rawName = compactText(values.name);
  const nameCode = providerLineCodePart(values.name);
  if (!nameCode && rawName) return `${providerCode}-${providerLineCodeHash(rawName)}`;
  if (!nameCode) return `${providerCode}-resale`;
  return nameCode.startsWith(providerCode) ? nameCode : `${providerCode}-${nameCode}`;
}

function routeScopeLabels(
  route: CodingPlanResaleRoute,
  userSegmentById: Map<string, UserSegment>,
): string[] {
  const labels: string[] = [];
  if (route.market) labels.push(`市场 ${route.market}`);
  if (route.currency) labels.push(`币种 ${route.currency.toUpperCase()}`);
  if (route.salesChannel) labels.push(`渠道 ${route.salesChannel}`);
  if (route.userSegmentId) {
    labels.push(`分群 ${userSegmentById.get(route.userSegmentId)?.name ?? route.userSegmentId}`);
  }
  if (route.startAt || route.endAt) {
    labels.push(`${formatDate(route.startAt)} - ${formatDate(route.endAt)}`);
  }
  return labels;
}

function providerLinePresetForCode(providerCode?: string | null) {
  const normalized = compactText(providerCode);
  return PROVIDER_LINE_PRESETS.find((preset) => preset.providerCode === normalized);
}

function providerLinePresetValues(values: ProviderLineForm) {
  const preset = providerLinePresetForCode(values.providerCode) ?? DEFAULT_PROVIDER_LINE_PRESET;
  return {
    providerCode: compactText(values.providerCode) ?? preset.providerCode,
    providerName: compactText(values.providerName) ?? preset.providerName,
    adapterType: compactText(values.adapterType) ?? preset.adapterType,
    environment: compactText(values.environment) ?? preset.environment,
    authType: compactText(values.authType) ?? preset.authType,
  };
}

function dedicatedEndpointObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeDedicatedProtocolStrategy(value: unknown): DedicatedProtocolStrategy | undefined {
  const text = compactText(value);
  return text && DEDICATED_PROTOCOL_CHANNEL_SET.has(text)
    ? text as DedicatedProtocolStrategy
    : undefined;
}

const DEDICATED_ENDPOINT_RUNTIME_CONFIG_KEYS = [
  'base_url',
  'baseUrl',
  'endpoint',
  'provider_profile',
  'providerProfile',
  'name',
  'code',
  'owned_by',
  'ownedBy',
  'status',
  'client_compatibility',
  'clientCompatibility',
  'capabilities',
  'token_count_strategy',
  'tokenCountStrategy',
  'priority',
  'weight',
  'owner_scope',
  'ownerScope',
] as const;

const DEDICATED_ENDPOINT_RUNTIME_DEFINITION_KEYS = [
  'base_url',
  'baseUrl',
  'endpoint',
  'provider_profile',
  'providerProfile',
] as const;

function configValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

function dedicatedEndpointRuntimeConfigKeys(endpoint: Record<string, unknown>): string[] {
  return DEDICATED_ENDPOINT_RUNTIME_CONFIG_KEYS
    .filter((key) => configValuePresent(endpoint[key]));
}

function dedicatedEndpointStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => compactText(item)).filter(Boolean) as string[];
  }
  const text = compactText(value);
  if (!text) return [];
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function dedicatedEndpointProtocolPaths(value: unknown): ProtocolPath[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      const record = dedicatedEndpointObject(item);
      const inboundProtocol = compactText(record.inbound_protocol ?? record.inboundProtocol);
      const channel = compactText(record.channel);
      if (!inboundProtocol || !channel) return null;
      return { inbound_protocol: inboundProtocol, channel };
    })
    .filter((item): item is ProtocolPath => Boolean(item));
}

function dedicatedServedInboundProtocolsForPaths(paths: ProtocolPath[]): string[] {
  return Array.from(new Set(paths.map((path) => path.inbound_protocol).filter(Boolean)));
}

function defaultDedicatedEndpointPath(clientProtocol?: string | null): ProtocolPath {
  const inboundProtocol = clientProtocol === 'responses'
    ? 'responses'
    : clientProtocol === 'anthropic'
      ? 'anthropic'
      : 'openai';
  const upstreamProtocol = inboundProtocol === 'responses' ? 'openai' : inboundProtocol;
  return {
    inbound_protocol: inboundProtocol,
    channel: suggestedProtocolChannel(upstreamProtocol, inboundProtocol),
  };
}

function hasDedicatedRuntimeConfig(endpoint: Record<string, unknown>): boolean {
  return DEDICATED_ENDPOINT_RUNTIME_DEFINITION_KEYS
    .some((key) => configValuePresent(endpoint[key]));
}

function productChannelProviderIsolation(value: unknown): Record<string, unknown> {
  const metadata = dedicatedEndpointObject(value);
  return dedicatedEndpointObject(
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

function runtimeProviderIdForProductChannel(productChannelId: string): string {
  return `pc_${productChannelId}`;
}

function dedicatedProviderStatus(status?: string | null): { label: string; variant: TagVariant } {
  if (status === 'active') return { label: '启用', variant: 'success' };
  if (status === 'testing') return { label: '测试中', variant: 'proc' };
  if (status === 'disabled') return { label: '停用', variant: 'muted' };
  return { label: status ?? '未知', variant: 'muted' };
}

function upstreamProtocolForDedicatedEndpoint(
  clientProtocol: string | undefined,
  servedProtocol: string | undefined,
): string | undefined {
  if (!clientProtocol) return undefined;
  if (clientProtocol === 'responses') return 'openai';
  if (servedProtocol && servedProtocol !== clientProtocol && clientProtocol === 'openai') return 'openai';
  return clientProtocol;
}

function dedicatedProtocolChannelForEndpoint(
  upstreamProtocol: string | undefined,
  servedProtocol: string | undefined,
  rawStrategy: unknown,
): DedicatedProtocolStrategy | undefined {
  const explicit = normalizeDedicatedProtocolStrategy(rawStrategy);
  if (explicit) return explicit;
  if (servedProtocol === 'responses') return 'responses_to_chat';
  if (servedProtocol === 'anthropic' && upstreamProtocol === 'openai') return 'anthropic_to_chat';
  if (servedProtocol || upstreamProtocol) return 'passthrough';
  return undefined;
}

function configuredDedicatedEndpoints(value: unknown): ProviderLineDedicatedEndpointForm[] {
  const endpoint = dedicatedEndpointObject(value);
  const clientProtocol = compactText(endpoint.client_protocol ?? endpoint.clientProtocol);
  const providerId = compactText(endpoint.provider_id ?? endpoint.providerId);
  const rawStrategy = compactText(endpoint.protocol_strategy ?? endpoint.protocolStrategy);
  const explicitPaths = dedicatedEndpointProtocolPaths(endpoint.paths ?? endpoint.protocol_paths ?? endpoint.protocolPaths);
  const runtimeConfigKeys = dedicatedEndpointRuntimeConfigKeys(endpoint);
  const explicitServedInboundProtocols = dedicatedEndpointStringArray(
    endpoint.served_inbound_protocols ?? endpoint.servedInboundProtocols,
  );
  const servedInboundProtocols = explicitPaths.length
    ? dedicatedServedInboundProtocolsForPaths(explicitPaths)
    : explicitServedInboundProtocols.length
    ? explicitServedInboundProtocols
    : clientProtocol
      ? [clientProtocol]
      : [];
  if (!clientProtocol && !providerId && !rawStrategy && runtimeConfigKeys.length === 0 && servedInboundProtocols.length === 0 && explicitPaths.length === 0) {
    return [];
  }

  const base: ProviderLineDedicatedEndpointForm = {};
  if (providerId) base.provider_id = providerId;
  for (const [sourceKey, targetKey] of [
    ['base_url', 'base_url'],
    ['baseUrl', 'base_url'],
    ['endpoint', 'base_url'],
    ['provider_profile', 'provider_profile'],
    ['providerProfile', 'provider_profile'],
    ['name', 'name'],
    ['code', 'code'],
    ['owned_by', 'owned_by'],
    ['ownedBy', 'owned_by'],
    ['status', 'status'],
    ['token_count_strategy', 'token_count_strategy'],
    ['tokenCountStrategy', 'token_count_strategy'],
  ] as const) {
    const text = compactText(endpoint[sourceKey]);
    if (text) {
      (base as Record<string, unknown>)[targetKey] = text;
    }
  }
  const capabilities = dedicatedEndpointStringArray(endpoint.capabilities);
  if (capabilities.length) base.capabilities = capabilities;
  for (const key of ['priority', 'weight'] as const) {
    const raw = endpoint[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const number = Number(raw);
    if (Number.isFinite(number)) base[key] = number;
  }

  if (explicitPaths.length > 0) {
    const firstPath = explicitPaths[0];
    const upstreamProtocol = clientProtocol || upstreamProtocolForDedicatedEndpoint(firstPath.inbound_protocol, firstPath.inbound_protocol);
    const normalized: ProviderLineDedicatedEndpointForm = { ...base };
    if (upstreamProtocol) normalized.client_protocol = upstreamProtocol;
    normalized.paths = explicitPaths;
    normalized.served_inbound_protocols = servedInboundProtocols;
    const channel = normalizeDedicatedProtocolStrategy(rawStrategy) ?? firstPath.channel;
    if (channel) normalized.protocol_strategy = channel;
    return [normalized];
  }

  const protocols = servedInboundProtocols.length ? servedInboundProtocols : [undefined];
  return protocols.map((servedProtocol) => {
    const upstreamProtocol = upstreamProtocolForDedicatedEndpoint(clientProtocol, servedProtocol);
    const normalized: ProviderLineDedicatedEndpointForm = { ...base };
    if (upstreamProtocol) normalized.client_protocol = upstreamProtocol;
    if (servedProtocol) normalized.served_inbound_protocols = [servedProtocol];
    const channel = dedicatedProtocolChannelForEndpoint(upstreamProtocol, servedProtocol, rawStrategy);
    if (channel) normalized.protocol_strategy = channel;
    if (servedProtocol && channel) {
      normalized.paths = [{ inbound_protocol: servedProtocol, channel }];
    }
    return normalized;
  });
}

function normalizeDedicatedEndpointReferences(value: unknown): ProviderLineDedicatedEndpointForm[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => configuredDedicatedEndpoints(item))
    .filter((endpoint) => Object.keys(endpoint).length > 0);
}

function normalizeDedicatedEndpointsForPayload(values: ProviderLineForm): ProviderLineDedicatedEndpointForm[] {
  return normalizeDedicatedEndpointReferences(values.dedicatedEndpoints);
}

function dedicatedEndpointServedInboundProtocols(
  endpoint: Record<string, unknown>,
  clientProtocol: string,
): string[] {
  const paths = dedicatedEndpointProtocolPaths(endpoint.paths ?? endpoint.protocol_paths ?? endpoint.protocolPaths);
  if (paths.length) return dedicatedServedInboundProtocolsForPaths(paths);
  const explicit = dedicatedEndpointStringArray(
    endpoint.served_inbound_protocols ?? endpoint.servedInboundProtocols,
  );
  return explicit.length ? Array.from(new Set(explicit)) : [clientProtocol];
}

function dedicatedEndpointValidationError(
  value: unknown,
  runtimeEnabled: boolean,
  dedicatedProductId?: string | null,
): string | null {
  const normalized = normalizeDedicatedEndpointReferences(value)
    .map((item) => dedicatedEndpointObject(item))
    .filter((endpoint) => Object.keys(endpoint).length > 0);
  if (runtimeEnabled && normalized.length === 0) {
    return '启用专属运行时前至少配置一个 dedicated 端点';
  }

  const seenProtocols = new Set<string>();
  for (const [index, endpoint] of normalized.entries()) {
    const label = `第 ${index + 1} 个 endpoint`;
    const clientProtocol = compactText(endpoint.client_protocol ?? endpoint.clientProtocol);
    const providerId = compactText(endpoint.provider_id ?? endpoint.providerId);
    const protocolStrategy = normalizeDedicatedProtocolStrategy(endpoint.protocol_strategy ?? endpoint.protocolStrategy);
    if (!clientProtocol) return `${label} 请选择上游协议`;
    if (!DEDICATED_CLIENT_PROTOCOL_OPTIONS.some((option) => option.value === clientProtocol)) {
      return `${label} 上游协议只支持 openai / responses / anthropic`;
    }
    if (endpoint.owner_scope !== undefined || endpoint.ownerScope !== undefined) {
      return `${label} owner_scope 由转售权益自动派生，不能手工配置`;
    }
    const paths = dedicatedEndpointProtocolPaths(endpoint.paths ?? endpoint.protocol_paths ?? endpoint.protocolPaths);
    const servedInboundProtocols = dedicatedEndpointServedInboundProtocols(endpoint, clientProtocol);
    if (paths.length === 0 && !protocolStrategy) {
      return `${label} 请至少配置一条显式路径`;
    }
    for (const path of paths) {
      if (!DEDICATED_CLIENT_PROTOCOL_OPTIONS.some((option) => option.value === path.inbound_protocol)) {
        return `${label} 路径下游协议只支持 openai / responses / anthropic`;
      }
      if (!DEDICATED_PROTOCOL_CHANNEL_SET.has(path.channel)) {
        return `${label} 路径 channel 只支持 passthrough / responses_to_chat / anthropic_to_chat`;
      }
    }
    const hasRuntimeConfig = hasDedicatedRuntimeConfig(endpoint);
    if (providerId && !/^pc_[A-Za-z0-9_-]+$/.test(providerId)) {
      return `${label} provider_id 必须填写 ProductChannel 生成的 pc_<ProductChannelId>`;
    }
    if (!providerId && !hasRuntimeConfig) {
      return `${label} 请填写端点配置；provider_id 保存后由后端生成`;
    }
    if (hasRuntimeConfig) {
      if (!dedicatedProductId) return '请先选择 CodingPlan 转售产品';
      const baseUrl = compactText(endpoint.base_url ?? endpoint.baseUrl ?? endpoint.endpoint);
      const providerProfile = compactText(endpoint.provider_profile ?? endpoint.providerProfile);
      if (!baseUrl || !providerProfile) {
        return `${label} 必须配置模型调用 Base URL 和上游协议类型`;
      }
    }
    for (const protocol of servedInboundProtocols) {
      if (seenProtocols.has(protocol)) return `专属端点的服务入站协议不能重复: ${protocol}`;
      seenProtocols.add(protocol);
    }
  }
  return null;
}

export function providerLinePayload(values: ProviderLineForm, dedicatedProductId?: string | null): Record<string, unknown> {
  const provider = providerLinePresetValues(values);
  const providerAccountIdentityId = compactText(values.providerAccountIdentityId);
  if (!providerAccountIdentityId) {
    throw new Error('请选择供应商账户身份');
  }
  const lineValues = { ...values } as Record<string, unknown>;
  delete lineValues.dedicatedEndpoints;
  return {
    ...lineValues,
    code: compactText(values.code) ?? generatedProviderLineCode(values),
    name: compactText(values.name) ?? '',
    providerCode: provider.providerCode,
    providerAccountIdentityId,
    providerName: provider.providerName,
    adapterType: provider.adapterType,
    environment: provider.environment,
    apiBaseUrl: compactText(values.apiBaseUrl) ?? '',
    authType: provider.authType,
    partnerCode: compactText(values.partnerCode),
    partnerSecretKey: compactText(values.partnerSecretKey),
    dedicatedEndpoints: normalizeDedicatedEndpointsForPayload(values),
    dedicatedProductId: dedicatedProductId ?? undefined,
  };
}

function hasDedicatedEndpoints(line?: CodingPlanProviderLine | null): boolean {
  return Boolean(Array.isArray(line?.dedicatedEndpoints) && line.dedicatedEndpoints.length > 0);
}

function hasConfiguredDedicatedEndpoint(line?: CodingPlanProviderLine | null): boolean {
  if (!Array.isArray(line?.dedicatedEndpoints)) return false;
  return line.dedicatedEndpoints.some((endpoint) => configuredDedicatedEndpoints(endpoint).length > 0);
}

function planStatus(plan?: CodingPlanWorkspacePlan | null): { label: string; variant: TagVariant } {
  if (!plan) return { label: '缺本地套餐', variant: 'error' };
  if (!plan.isActive) return { label: '草稿', variant: 'muted' };
  if (plan.isLegacy) return { label: '旧版', variant: 'warn' };
  return { label: '可售', variant: 'success' };
}

function lineReady(line?: CodingPlanProviderLine | null): boolean {
  return Boolean(
    lineIsPublished(line)
    && compactText(line?.providerAccountIdentityId)
    && hasConfiguredDedicatedEndpoint(line)
    && !dedicatedEndpointValidationError(line?.dedicatedEndpoints, true),
  );
}

function lineHasCredentials(line?: CodingPlanProviderLine | null): boolean {
  return Boolean(line?.partnerCodeConfigured && line.partnerSecretConfigured);
}

function lineIsPublished(line?: CodingPlanProviderLine | null): boolean {
  return Boolean(line?.salesEnabled && line.fulfillmentEnabled && line.runtimeEnabled && line.syncEnabled);
}

function lineHasAnyEnabledFlag(line?: CodingPlanProviderLine | null): boolean {
  return Boolean(line?.salesEnabled || line?.fulfillmentEnabled || line?.runtimeEnabled || line?.syncEnabled);
}

function lineLifecycle(line?: CodingPlanProviderLine | null): { label: string; variant: TagVariant } {
  if (!line) return { label: '未知', variant: 'muted' };
  if (lineReady(line)) return { label: '已上架', variant: 'success' };
  if (lineHasAnyEnabledFlag(line)) return { label: '部分上线', variant: 'warn' };
  if (lineHasCredentials(line) || hasDedicatedEndpoints(line)) return { label: '草稿', variant: 'proc' };
  return { label: '未配置', variant: 'muted' };
}

function linePublishError(line?: CodingPlanProviderLine | null): string | null {
  if (!line) return '供应商线路不存在';
  if (!compactText(line.providerAccountIdentityId)) return '上架前必须选择供应商账户身份';
  if (!lineHasCredentials(line)) return '上架前必须配置 PartnerCode 和 PartnerSecretKey';
  if (!hasConfiguredDedicatedEndpoint(line)) return '上架前必须配置至少一个 dedicated 专属端点';
  return dedicatedEndpointValidationError(line.dedicatedEndpoints, true);
}

function productKey(product: CodingPlanProviderProduct): string {
  return `${product.providerLineId}:${product.upstreamProductId}`;
}

function mergeProviderProducts(products: CodingPlanProviderProduct[]): CodingPlanProviderProduct[] {
  return Array.from(new Map(products.map((product) => [productKey(product), product])).values());
}

function providerProductCount(result: Record<string, unknown> | null | undefined): number | null {
  if (!result) return null;
  for (const key of ['syncedCount', 'productCount', 'count', 'total']) {
    const value = result[key];
    if (typeof value === 'number') return value;
  }
  return null;
}

async function fetchProductsForLines(lines: CodingPlanProviderLine[]): Promise<CodingPlanProviderProduct[]> {
  const allProducts = await codingPlanAdminApi.providerProducts().catch(() => []);
  const groups = await Promise.all(lines.map(async (line) => {
    try {
      return await codingPlanAdminApi.providerProducts({ providerLineId: line.id });
    } catch {
      return [];
    }
  }));
  return mergeProviderProducts([...allProducts, ...groups.flat()]);
}

async function fetchProductsForLine(lineId: string): Promise<CodingPlanProviderProduct[]> {
  const [allProducts, lineProducts] = await Promise.all([
    codingPlanAdminApi.providerProducts().catch(() => []),
    codingPlanAdminApi.providerProducts({ providerLineId: lineId }).catch(() => []),
  ]);
  return mergeProviderProducts([...allProducts, ...lineProducts])
    .filter((product) => product.providerLineId === lineId);
}

function rowText(...values: Array<string | null | undefined>): string {
  return values.filter(Boolean).join(' ').toLowerCase();
}

function sortResaleRoutes(routes: CodingPlanResaleRoute[]): CodingPlanResaleRoute[] {
  return [...routes].sort((a, b) =>
    a.priority - b.priority
    || dayjs(a.createdAt).valueOf() - dayjs(b.createdAt).valueOf()
    || a.id.localeCompare(b.id),
  );
}

export default function CodingPlanResalePage() {
  const { modal, message } = App.useApp();
  const platformCurrency = usePlatformCurrency();
  const minorUnitLabel = currencyMinorUnitLabel(platformCurrency);
  const navigate = useNavigate();
  const location = useLocation();
  const canManagePlans = usePermission('admin.page.coding_third_party_plans.manage');
  const canManageSystem = usePermission('admin.page.coding_resale_config.manage');
  const canManageOrders = usePermission('admin.page.coding_resale_report.manage');
  const mode = resolveMode(location.pathname);
  const meta = MODE_META[mode];
  const showPublisherAwareMessage = useCallback((result: unknown, successText: string) => {
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
  }, [message]);

  const [workspace, setWorkspace] = useState<CodingPlanWorkspace | null>(null);
  const [providerLines, setProviderLines] = useState<CodingPlanProviderLine[]>([]);
  const [providerAccountIdentities, setProviderAccountIdentities] = useState<ProviderAccountIdentity[]>([]);
  const [providerProducts, setProviderProducts] = useState<CodingPlanProviderProduct[]>([]);
  const [resaleRoutes, setResaleRoutes] = useState<CodingPlanResaleRoute[]>([]);
  const [providerEntitlements, setProviderEntitlements] = useState<CodingPlanProviderEntitlement[]>([]);
  const [userSegments, setUserSegments] = useState<UserSegment[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testingLineId, setTestingLineId] = useState<string | null>(null);
  const [publishingLineId, setPublishingLineId] = useState<string | null>(null);
  const [deletingLineId, setDeletingLineId] = useState<string | null>(null);
  const [loadingProductLineId, setLoadingProductLineId] = useState<string | null>(null);
  const [retryingEntitlementId, setRetryingEntitlementId] = useState<string | null>(null);
  const [productFilter, setProductFilter] = useState('all');
  const [lineFilter, setLineFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [planDrawerOpen, setPlanDrawerOpen] = useState(false);
  const [editingPlanRow, setEditingPlanRow] = useState<ThirdPartyPlanRow | null>(null);
  const [lineDrawerOpen, setLineDrawerOpen] = useState(false);
  const [editingLine, setEditingLine] = useState<CodingPlanProviderLine | null>(null);

  const [planForm] = Form.useForm<ThirdPartyPlanForm>();
  const [lineForm] = Form.useForm<ProviderLineForm>();
  const [dedicatedProductId, setDedicatedProductId] = useState<string | null>(null);
  const [dedicatedRuntimeProviders, setDedicatedRuntimeProviders] = useState<DedicatedProductChannelRow[]>([]);
  const [dedicatedLoading, setDedicatedLoading] = useState(false);
  const selectedPlanRoutes = Form.useWatch('routes', planForm) ?? [];
  const lineDedicatedEndpoints = Form.useWatch('dedicatedEndpoints', lineForm);
  const lineNameValue = Form.useWatch('name', lineForm);
  const lineProviderCodeValue = Form.useWatch('providerCode', lineForm);
  const lineProviderAccountIdentityId = Form.useWatch('providerAccountIdentityId', lineForm);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === 'config') {
        const [nextWorkspace, nextLines, nextProviderAccountIdentities] = await Promise.all([
          codingPlanAdminApi.workspace(),
          codingPlanAdminApi.providerLines(),
          providerAccountIdentityApi.list(),
        ]);
        const nextProducts = await fetchProductsForLines(nextLines);
        setWorkspace(nextWorkspace);
        setProviderLines(nextLines);
        setProviderAccountIdentities(nextProviderAccountIdentities);
        setProviderProducts(nextProducts);
        setResaleRoutes([]);
        setProviderEntitlements([]);
        setUserSegments([]);
        return;
      }

      const [nextWorkspace, nextLines, nextRoutes, nextEntitlements, nextSegments] = await Promise.all([
        codingPlanAdminApi.workspace(),
        codingPlanAdminApi.providerLines(),
        codingPlanAdminApi.resaleRoutes(),
        codingPlanAdminApi.providerEntitlements({ take: 200 }),
        userSegmentApi.list({ pageSize: 100, isActive: true }).catch(() => ({ items: [], total: 0 })),
      ]);
      const nextProducts = await fetchProductsForLines(nextLines);
      setWorkspace(nextWorkspace);
      setProviderLines(nextLines);
      setProviderAccountIdentities([]);
      setProviderProducts(nextProducts);
      setResaleRoutes(nextRoutes);
      setProviderEntitlements(nextEntitlements);
      setUserSegments(nextSegments.items);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载转售数据失败');
    } finally {
      setLoading(false);
    }
  }, [message, mode]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const products = useMemo(() => workspace?.products ?? [], [workspace?.products]);
  const plans = useMemo(() => workspace?.plans ?? [], [workspace?.plans]);
  const planById = useMemo(() => new Map(plans.map((plan) => [plan.id, plan])), [plans]);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const lineById = useMemo(() => new Map(providerLines.map((line) => [line.id, line])), [providerLines]);
  const userSegmentById = useMemo(
    () => new Map(userSegments.map((segment) => [segment.id, segment])),
    [userSegments],
  );
  const productByLineAndUpstream = useMemo(() => {
    const map = new Map<string, CodingPlanProviderProduct>();
    for (const product of providerProducts) {
      map.set(`${product.providerLineId}:${product.upstreamProductId}`, product);
    }
    return map;
  }, [providerProducts]);
  const productCountByLineId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const product of providerProducts) {
      counts.set(product.providerLineId, (counts.get(product.providerLineId) ?? 0) + 1);
    }
    return counts;
  }, [providerProducts]);
  const resalePlanCountByProductId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const route of resaleRoutes) {
      const productId = planById.get(route.planId)?.productId ?? route.plan?.productId ?? null;
      if (!productId) continue;
      counts.set(productId, (counts.get(productId) ?? 0) + 1);
    }
    return counts;
  }, [planById, resaleRoutes]);
  const publishedLines = useMemo(
    () => providerLines.filter(lineReady),
    [providerLines],
  );
  const providerResaleProducts = useMemo(
    () => products.filter((product) => product.isActive && product.fulfillmentMode === 'provider_resale'),
    [products],
  );
  const dedicatedProductOptions = providerResaleProducts.map((product) => ({
    value: product.id,
    label: `${product.name} · ${product.slug ?? product.id}`,
  }));
  const referencedDedicatedProviderIds = useMemo(() => {
    const endpoints = Array.isArray(lineDedicatedEndpoints) ? lineDedicatedEndpoints : [];
    return new Set(
      endpoints
        .map((endpoint) => compactText(dedicatedEndpointObject(endpoint).provider_id))
        .filter(Boolean) as string[],
    );
  }, [lineDedicatedEndpoints]);
  const referencedDedicatedRuntimeProviders = useMemo(() => dedicatedRuntimeProviders
    .filter((provider) => referencedDedicatedProviderIds.has(runtimeProviderIdForProductChannel(provider.id))),
  [dedicatedRuntimeProviders, referencedDedicatedProviderIds]);
  const loadDedicatedRuntimeProviders = useCallback(async (productId: string) => {
    setDedicatedLoading(true);
    try {
      const productChannels = await productApi.productChannels(productId);
      setDedicatedRuntimeProviders((productChannels as DedicatedProductChannelRow[])
        .filter((productChannel) => isDedicatedProductChannel(productChannel)));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '加载 dedicated pc_ 失败');
    } finally {
      setDedicatedLoading(false);
    }
  }, [message]);
  const providerLineProviderOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = PROVIDER_LINE_PRESETS.map((preset) => ({
      value: preset.providerCode,
      label: `${preset.providerName} · ${preset.providerCode}`,
    }));
    if (
      editingLine?.providerCode
      && !providerLinePresetForCode(editingLine.providerCode)
    ) {
      options.unshift({
        value: editingLine.providerCode,
        label: `${editingLine.providerName ?? editingLine.providerCode} · ${editingLine.providerCode}`,
      });
    }
    return options;
  }, [editingLine]);
  const providerLineAccountIdentities = useMemo(
    () => providerAccountIdentitiesForProvider(providerAccountIdentities, lineProviderCodeValue),
    [lineProviderCodeValue, providerAccountIdentities],
  );
  const providerLineAccountIdentityOptions = useMemo(
    () => providerLineAccountIdentities.map((identity) => ({
      value: identity.id,
      label: `${identity.displayName} · ${identity.ref}${isProviderAccountIdentityActive(identity) ? '' : ' · 已停用'}`,
      disabled: !isProviderAccountIdentityActive(identity),
    })),
    [providerLineAccountIdentities],
  );
  const selectedProviderLineAccountIdentity = useMemo(
    () => providerAccountIdentities.find(
      (identity) => identity.id === lineProviderAccountIdentityId,
    ) ?? null,
    [lineProviderAccountIdentityId, providerAccountIdentities],
  );

  useEffect(() => {
    if (dedicatedProductId || providerResaleProducts.length === 0) return;
    setDedicatedProductId(providerResaleProducts[0].id);
  }, [dedicatedProductId, providerResaleProducts]);

  useEffect(() => {
    if (!lineDrawerOpen || editingLine) return;
    const nextCode = generatedProviderLineCode({
      name: lineNameValue,
      providerCode: lineProviderCodeValue,
    });
    if (lineForm.getFieldValue('code') !== nextCode) {
      lineForm.setFieldValue('code', nextCode);
    }
  }, [editingLine, lineDrawerOpen, lineForm, lineNameValue, lineProviderCodeValue]);

  useEffect(() => {
    if (!lineDrawerOpen || !dedicatedProductId) return;
    void loadDedicatedRuntimeProviders(dedicatedProductId);
  }, [dedicatedProductId, lineDrawerOpen, loadDedicatedRuntimeProviders]);

  const refreshProductsForLine = useCallback(async (
    lineId: string,
    options?: { forceSync?: boolean; syncIfEmpty?: boolean; silent?: boolean },
  ): Promise<CodingPlanProviderProduct[]> => {
    const line = lineById.get(lineId);
    setLoadingProductLineId(lineId);
    try {
      let nextProducts = await fetchProductsForLine(lineId);
      const shouldSync = Boolean(options?.forceSync || (options?.syncIfEmpty && nextProducts.length === 0));

      if (shouldSync) {
        if (!line?.syncEnabled) {
          if (!options?.silent) message.warning('该线路未允许刷新上游目录');
        } else if (!canManageSystem) {
          if (!options?.silent) message.warning('需要系统管理权限才能刷新上游目录');
        } else {
          const syncResult = await codingPlanAdminApi.syncProviderProducts(lineId);
          nextProducts = await fetchProductsForLine(lineId);
          if (!options?.silent) {
            const count = providerProductCount(syncResult) ?? nextProducts.length;
            message.success(`已刷新 ${count} 个目录条目`);
          }
        }
      }

      setProviderProducts((current) => mergeProviderProducts([
        ...current.filter((product) => product.providerLineId !== lineId),
        ...nextProducts,
      ]));
      return nextProducts;
    } catch (error) {
      if (!options?.silent) {
        message.error(error instanceof Error ? error.message : '读取上游目录失败');
      }
      return [];
    } finally {
      setLoadingProductLineId(null);
    }
  }, [canManageSystem, lineById, message]);

  const handlePlanRouteLineChange = async (
    routeIndex: number,
    lineId: string,
    options?: { forceSync?: boolean },
  ) => {
    planForm.setFieldValue(['routes', routeIndex, 'upstreamProductId'], undefined);
    const currentRoutes = normalizePlanRouteForms(planForm.getFieldValue('routes'));
    const preferredUpstreamProductId = currentRoutes.find((route) =>
      route.upstreamProductId && route.providerLineId !== lineId)?.upstreamProductId;
    const productsForLine = await refreshProductsForLine(lineId, {
      forceSync: options?.forceSync,
      syncIfEmpty: !options?.forceSync,
      silent: !options?.forceSync,
    });
    const matchedProduct = preferredUpstreamProductId
      ? productsForLine.find((product) => product.upstreamProductId === preferredUpstreamProductId)
      : null;
    const nextProduct = matchedProduct ?? productsForLine[0];
    if (nextProduct) {
      planForm.setFieldValue(['routes', routeIndex, 'upstreamProductId'], nextProduct.upstreamProductId);
    }
  };

  const thirdPartyRows = useMemo<ThirdPartyPlanRow[]>(() => {
    const groups = new Map<string, CodingPlanResaleRoute[]>();
    for (const route of resaleRoutes) {
      const bucket = groups.get(route.planId) ?? [];
      bucket.push(route);
      groups.set(route.planId, bucket);
    }
    return Array.from(groups.entries()).map(([planId, routes]) => {
      const sortedRoutes = sortResaleRoutes(routes);
      const route = sortedRoutes[0];
      const bindings = sortedRoutes.map((item) => ({
        route: item,
        providerLine: lineById.get(item.providerLineId) ?? item.providerLine ?? null,
        upstreamProduct: productByLineAndUpstream.get(`${item.providerLineId}:${item.upstreamProductId}`) ?? null,
      }));
      return {
        id: planId,
        plan: planById.get(planId) ?? null,
        routePlan: route.plan ?? null,
        route,
        routes: sortedRoutes,
        bindings,
        providerLine: bindings[0]?.providerLine ?? null,
        upstreamProduct: bindings[0]?.upstreamProduct ?? null,
      };
    }).filter((row) => {
      const productId = row.plan?.productId ?? row.routePlan?.productId ?? null;
      if (productFilter !== 'all' && productId !== productFilter) return false;
      if (lineFilter !== 'all' && !row.routes.some((route) => route.providerLineId === lineFilter)) return false;
      return true;
    });
  }, [lineById, lineFilter, planById, productByLineAndUpstream, productFilter, resaleRoutes]);

  const filteredEntitlements = useMemo(() => {
    const query = search.trim().toLowerCase();
    return providerEntitlements.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (lineFilter !== 'all' && row.providerLineId !== lineFilter) return false;
      if (!query) return true;
      return rowText(row.userId, row.tenantId, row.orderId, row.upstreamProductId, row.upstreamApiKeyPrefix)
        .includes(query);
    });
  }, [lineFilter, providerEntitlements, search, statusFilter]);

  const openCreatePlan = () => {
    const eligibleProducts = products.filter((product) => (
      product.isActive && product.fulfillmentMode === 'provider_resale'
    ));
    const firstProductId = productFilter !== 'all'
      && eligibleProducts.some((product) => product.id === productFilter)
      ? productFilter
      : eligibleProducts[0]?.id;
    const firstLine = publishedLines[0];
    const firstProduct = firstLine
      ? providerProducts.find((product) => product.providerLineId === firstLine.id)
      : null;
    setEditingPlanRow(null);
    planForm.resetFields();
    planForm.setFieldsValue({
      productId: firstProductId,
      name: '',
      description: '',
      badge: '',
      billingPeriod: 'monthly',
      monthlyPrice: 0,
      quarterlyPrice: 0,
      yearlyPrice: 0,
      validityDays: 30,
      memberLimit: 1,
      salesLimit: 0,
      sortOrder: 0,
      isActive: false,
      routes: [{
        providerLineId: firstLine?.id,
        upstreamProductId: firstProduct?.upstreamProductId,
      }],
      routeEnabled: true,
      routeMarket: null,
      routeCurrency: null,
      routeSalesChannel: null,
      routeUserSegmentId: null,
      routeStartAt: null,
      routeEndAt: null,
    });
    setPlanDrawerOpen(true);
    if (firstLine?.id && !firstProduct) {
      void handlePlanRouteLineChange(0, firstLine.id);
    }
  };

  const openEditPlan = (row: ThirdPartyPlanRow) => {
    if (!row.plan) {
      message.error('本地套餐不存在，不能编辑 SKU');
      return;
    }
    setEditingPlanRow(row);
    const planRoutes = sortResaleRoutes(resaleRoutes.filter((route) => route.planId === row.route.planId));
    const formRoutes = (planRoutes.length > 0 ? planRoutes : [row.route]).map((route) => ({
      routeId: route.id,
      providerLineId: route.providerLineId,
      upstreamProductId: route.upstreamProductId,
    }));
    planForm.resetFields();
    planForm.setFieldsValue({
      productId: row.plan.productId ?? undefined,
      name: row.plan.name,
      description: row.plan.description ?? '',
      badge: row.plan.badge ?? '',
      billingPeriod: row.plan.billingPeriod ?? 'monthly',
      monthlyPrice: row.plan.monthlyPrice ?? 0,
      quarterlyPrice: row.plan.quarterlyPrice ?? 0,
      yearlyPrice: row.plan.yearlyPrice ?? 0,
      validityDays: row.plan.validityDays ?? 30,
      memberLimit: row.plan.memberLimit ?? 1,
      salesLimit: row.plan.salesLimit ?? 0,
      sortOrder: row.plan.sortOrder ?? 0,
      isActive: row.plan.isActive,
      routes: formRoutes,
      routeEnabled: planRoutes.length > 0
        ? planRoutes.every((route) => route.enabled)
        : row.route.enabled,
      routeMarket: row.route.market ?? null,
      routeCurrency: row.route.currency ?? null,
      routeSalesChannel: row.route.salesChannel ?? null,
      routeUserSegmentId: row.route.userSegmentId ?? null,
      routeStartAt: row.route.startAt ? dayjs(row.route.startAt) : null,
      routeEndAt: row.route.endAt ? dayjs(row.route.endAt) : null,
    });
    setPlanDrawerOpen(true);
    for (const route of formRoutes) {
      if (
        route.providerLineId
        && !providerProducts.some((product) => product.providerLineId === route.providerLineId)
      ) {
        void refreshProductsForLine(route.providerLineId, { syncIfEmpty: true, silent: true });
      }
    }
  };

  const closePlanDrawer = () => {
    setPlanDrawerOpen(false);
    setEditingPlanRow(null);
  };

  const applyProviderLinePreset = (providerCode: string) => {
    const preset = providerLinePresetForCode(providerCode);
    if (!preset) return;
    lineForm.setFieldsValue({
      providerCode: preset.providerCode,
      providerAccountIdentityId: undefined,
      providerName: preset.providerName,
      adapterType: preset.adapterType,
      environment: preset.environment,
      authType: preset.authType,
    });
  };

  const validateProviderLineAccountIdentity = async (_: unknown, value: unknown) => {
    const error = providerAccountIdentitySelectionError(
      providerAccountIdentities,
      value,
      lineProviderCodeValue,
    );
    if (error) throw new Error(error);
  };

  const appendDedicatedEndpointTemplate = (template: ProviderLineDedicatedEndpointForm[]) => {
    const current = normalizeDedicatedEndpointReferences(lineForm.getFieldValue('dedicatedEndpoints'));
    lineForm.setFieldsValue({ dedicatedEndpoints: [...current, ...template] });
  };

  const applyDedicatedEndpointProtocolDefaults = (
    fieldName: number,
    clientProtocol: string,
  ) => {
    const current = dedicatedEndpointObject(lineForm.getFieldValue(['dedicatedEndpoints', fieldName]));
    const path = defaultDedicatedEndpointPath(clientProtocol);
    const defaults: ProviderLineDedicatedEndpointForm = clientProtocol === 'anthropic'
      ? {
          client_protocol: 'anthropic',
          protocol_strategy: 'passthrough',
          provider_profile: 'anthropic_native',
          served_inbound_protocols: ['anthropic'],
          paths: [path],
        }
      : {
          client_protocol: 'openai',
          protocol_strategy: clientProtocol === 'responses' ? 'responses_to_chat' : 'passthrough',
          provider_profile: 'openai_compatible',
          served_inbound_protocols: [clientProtocol === 'responses' ? 'responses' : 'openai'],
          paths: [path],
        };
    lineForm.setFieldValue(['dedicatedEndpoints', fieldName], {
      ...current,
      ...defaults,
    });
  };

  const handleSavePlan = async () => {
    const values = await planForm.validateFields();
    const editing = editingPlanRow;
    const productId = editing?.plan?.productId ?? values.productId;
    const selectedProduct = productById.get(productId);
    if (!selectedProduct) {
      message.error('请选择 CodingPlan 产品');
      return;
    }
    if (selectedProduct.isActive === false) {
      message.error('请选择启用中的 CodingPlan 产品');
      return;
    }
    if (selectedProduct.fulfillmentMode !== 'provider_resale') {
      message.error('请选择履约模式为三方转售的 CodingPlan 产品');
      return;
    }
    const routeInputs = normalizePlanRouteForms(values.routes);
    if (routeInputs.length === 0) {
      message.error('请至少绑定一条供应商线路');
      return;
    }
    const firstRoute = routeInputs[0];
    const firstLine = lineById.get(firstRoute.providerLineId);
    const seenLineIds = new Set<string>();
    for (const route of routeInputs) {
      if (!route.providerLineId) {
        message.error('请选择供应商线路');
        return;
      }
      if (!route.upstreamProductId) {
        message.error('请选择上游套餐');
        return;
      }
      if (seenLineIds.has(route.providerLineId)) {
        message.error('同一个三方套餐不能重复绑定同一供应商线路');
        return;
      }
      seenLineIds.add(route.providerLineId);
      const line = lineById.get(route.providerLineId);
      if (!line) {
        message.error('请选择供应商线路');
        return;
      }
      if (!lineReady(line)) {
        message.error('绑定线路必须已开启销售、履约和运行时');
        return;
      }
      if (!productByLineAndUpstream.has(`${route.providerLineId}:${route.upstreamProductId}`)) {
        message.error('上游套餐必须来自所选供应商线路的同步目录');
        return;
      }
      if (route.upstreamProductId !== firstRoute.upstreamProductId) {
        message.error('多线路绑定必须共享同一个上游套餐 ID');
        return;
      }
      if (
        firstLine
        && (line.providerCode !== firstLine.providerCode || line.adapterType !== firstLine.adapterType)
      ) {
        message.error('多线路绑定必须来自同一供应商和适配器');
        return;
      }
    }
    setSaving(true);
    try {
      const payload = buildResalePlanPayload(
        { ...values, productId },
        platformCurrency,
        editing?.route.priority ?? 100,
      );
      if (editing) {
        const planId = editing.plan?.id ?? editing.route.planId;
        await codingPlanAdminApi.updateResalePlan(planId, payload);
        message.success('三方套餐已保存');
      } else {
        await codingPlanAdminApi.createResalePlan(payload);
        message.success('三方套餐已创建并绑定上游套餐');
      }
      closePlanDrawer();
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存三方套餐失败');
    } finally {
      setSaving(false);
    }
  };

  const openLineDrawer = (line?: CodingPlanProviderLine) => {
    setEditingLine(line ?? null);
    lineForm.resetFields();
    const firstDedicatedProductId = dedicatedProductId ?? providerResaleProducts[0]?.id ?? null;
    if (firstDedicatedProductId) setDedicatedProductId(firstDedicatedProductId);
    lineForm.setFieldsValue(line ? {
      code: line.code,
      name: line.name,
      providerCode: line.providerCode,
      providerAccountIdentityId: line.providerAccountIdentityId ?? undefined,
      providerName: line.providerName ?? undefined,
      adapterType: line.adapterType,
      environment: line.environment,
      apiBaseUrl: line.apiBaseUrl,
      authType: line.authType,
      salesEnabled: line.salesEnabled,
      fulfillmentEnabled: line.fulfillmentEnabled,
      runtimeEnabled: line.runtimeEnabled,
      syncEnabled: line.syncEnabled,
      dedicatedEndpoints: normalizeDedicatedEndpointReferences(line.dedicatedEndpoints),
    } : {
      code: generatedProviderLineCode({
        providerCode: DEFAULT_PROVIDER_LINE_PRESET.providerCode,
        name: '',
      }),
      name: '',
      providerCode: DEFAULT_PROVIDER_LINE_PRESET.providerCode,
      providerAccountIdentityId: undefined,
      providerName: DEFAULT_PROVIDER_LINE_PRESET.providerName,
      adapterType: DEFAULT_PROVIDER_LINE_PRESET.adapterType,
      environment: DEFAULT_PROVIDER_LINE_PRESET.environment,
      apiBaseUrl: '',
      authType: DEFAULT_PROVIDER_LINE_PRESET.authType,
      salesEnabled: false,
      fulfillmentEnabled: false,
      runtimeEnabled: false,
      syncEnabled: false,
      dedicatedEndpoints: [],
    });
    setLineDrawerOpen(true);
    if (firstDedicatedProductId) void loadDedicatedRuntimeProviders(firstDedicatedProductId);
  };

  const testLineConnection = async (lineId: string): Promise<boolean> => {
    setTestingLineId(lineId);
    try {
      const result = await codingPlanAdminApi.testProviderLine(lineId);
      const count = typeof result.productCount === 'number' ? result.productCount : '—';
      message.success(`连接成功，读取到 ${count} 个目录条目`);
      return true;
    } catch (error) {
      message.error(error instanceof Error ? error.message : '供应商线路测试失败');
      return false;
    } finally {
      setTestingLineId(null);
    }
  };

  const publishLine = async (line: CodingPlanProviderLine): Promise<boolean> => {
    const error = linePublishError(line) ?? providerAccountIdentitySelectionError(
      providerAccountIdentities,
      line.providerAccountIdentityId,
      line.providerCode,
    );
    if (error) {
      message.error(error);
      openLineDrawer(line);
      return false;
    }

    const testPassed = await testLineConnection(line.id);
    if (!testPassed) return false;

    setPublishingLineId(line.id);
    try {
      const result = await codingPlanAdminApi.updateProviderLine(line.id, {
        ...LINE_PUBLISH_PATCH,
        providerAccountIdentityId: line.providerAccountIdentityId,
        dedicatedEndpoints: normalizeDedicatedEndpointReferences(line.dedicatedEndpoints),
      });
      showPublisherAwareMessage(result, '供应商线路已上架');
      return true;
    } catch (error_) {
      message.error(error_ instanceof Error ? error_.message : '上架供应商线路失败');
      return false;
    } finally {
      setPublishingLineId(null);
    }
  };

  const handleSaveLine = async (options?: { publishAfterSave?: boolean }) => {
    let values: ProviderLineForm;
    try {
      values = await lineForm.validateFields();
    } catch (error) {
      const validationError = firstFormValidationError(error);
      message.error(validationError?.message ?? '请检查供应商线路表单必填项');
      if (validationError?.name?.length) {
        const scrollToError = () => {
          try {
            lineForm.scrollToField(validationError.name, { behavior: 'smooth', block: 'center' });
          } catch {
            // Some Form.List-level errors do not have a concrete DOM field to scroll to.
          }
        };
        if (typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(scrollToError);
        } else {
          scrollToError();
        }
      }
      return;
    }
    if (options?.publishAfterSave) {
      const error = dedicatedEndpointValidationError(values.dedicatedEndpoints, true, dedicatedProductId);
      if (error) {
        message.error(error);
        return;
      }
    }
    const payload = providerLinePayload(values, dedicatedProductId);
    setSaving(true);
    try {
      let savedLine: CodingPlanProviderLine;
      if (editingLine) {
        savedLine = await codingPlanAdminApi.updateProviderLine(editingLine.id, payload);
        showPublisherAwareMessage(savedLine, '供应商线路已保存');
      } else {
        savedLine = await codingPlanAdminApi.createProviderLine(payload);
        showPublisherAwareMessage(savedLine, '供应商线路已创建');
      }
      const published = options?.publishAfterSave ? await publishLine(savedLine) : false;
      if (!options?.publishAfterSave || published) setLineDrawerOpen(false);
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存供应商线路失败');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishLine = async (line: CodingPlanProviderLine) => {
    const published = await publishLine(line);
    if (published) await fetchAll();
  };

  const handleDisableLine = async (line: CodingPlanProviderLine) => {
    try {
      const result = await codingPlanAdminApi.updateProviderLine(line.id, LINE_DISABLE_PATCH);
      showPublisherAwareMessage(result, '供应商线路已停用');
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '停用供应商线路失败');
    }
  };

  const handleDeleteLine = async (line: CodingPlanProviderLine) => {
    setDeletingLineId(line.id);
    try {
      const result = await codingPlanAdminApi.deleteProviderLine(line.id);
      setProviderLines((current) => current.filter((item) => item.id !== line.id));
      setProviderProducts((current) => current.filter((item) => item.providerLineId !== line.id));
      showPublisherAwareMessage(result, '供应商线路已删除');
      await fetchAll();
    } catch (error) {
      modal.error({
        title: '删除供应商线路失败',
        content: error instanceof Error ? error.message : '删除供应商线路失败',
      });
      await fetchAll();
    } finally {
      setDeletingLineId(null);
    }
  };

  const confirmDeleteLine = (line: CodingPlanProviderLine) => {
    modal.confirm({
      title: '删除这条供应商线路？',
      content: '已有转售 SKU、权益或履约记录引用时后端会拒绝删除；线上线路建议先停用。',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true, loading: deletingLineId === line.id },
      onOk: () => handleDeleteLine(line),
    });
  };

  const handleDeletePlan = async (row: ThirdPartyPlanRow) => {
    const planId = row.plan?.id;
    setSaving(true);
    try {
      if (!planId) {
        message.error('本地套餐不存在，不能直接清理转售映射，请联系管理员处理异常数据');
        await fetchAll();
        return;
      }
      await codingPlanAdminApi.deletePlan(planId);
      message.success('三方套餐已删除');
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '删除三方套餐失败');
      await fetchAll();
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePlanRoutes = async (row: ThirdPartyPlanRow) => {
    if (!row.plan?.id) {
      message.error('本地套餐不存在，不能更新转售映射');
      await fetchAll();
      return;
    }
    const productId = row.plan.productId ?? row.routePlan?.productId ?? null;
    if (!productId) {
      message.error('本地套餐缺少所属产品，不能更新转售映射');
      await fetchAll();
      return;
    }
    const sortedRoutes = sortResaleRoutes(row.routes);
    const firstRoute = sortedRoutes[0];
    if (!firstRoute) {
      message.error('当前套餐没有可更新的转售映射');
      await fetchAll();
      return;
    }
    const nextEnabled = !row.routes.every((route) => route.enabled);
    try {
      await codingPlanAdminApi.updateResalePlan(row.plan.id, buildResalePlanPayload({
        productId,
        name: row.plan.name,
        description: row.plan.description ?? '',
        badge: row.plan.badge ?? '',
        monthlyPrice: row.plan.monthlyPrice,
        quarterlyPrice: row.plan.quarterlyPrice,
        yearlyPrice: row.plan.yearlyPrice,
        billingPeriod: row.plan.billingPeriod ?? 'monthly',
        validityDays: row.plan.validityDays ?? 30,
        memberLimit: row.plan.memberLimit ?? 1,
        salesLimit: row.plan.salesLimit ?? 0,
        sortOrder: row.plan.sortOrder,
        isActive: row.plan.isActive,
        routes: sortedRoutes.map((route) => ({
          routeId: route.id,
          providerLineId: route.providerLineId,
          upstreamProductId: route.upstreamProductId,
        })),
        routeEnabled: nextEnabled,
        routeMarket: firstRoute.market ?? null,
        routeCurrency: firstRoute.currency ?? null,
        routeSalesChannel: firstRoute.salesChannel ?? null,
        routeUserSegmentId: firstRoute.userSegmentId ?? null,
        routeStartAt: firstRoute.startAt ?? null,
        routeEndAt: firstRoute.endAt ?? null,
      }, platformCurrency, firstRoute.priority));
      message.success(nextEnabled ? '转售映射已启用' : '转售映射已禁用');
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '更新转售映射失败');
      await fetchAll();
    }
  };

  const handleRetry = async (id: string) => {
    setRetryingEntitlementId(id);
    try {
      await codingPlanAdminApi.retryProviderEntitlement(id);
      message.success('供应商履约已重试');
      await fetchAll();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '供应商履约重试失败');
    } finally {
      setRetryingEntitlementId(null);
    }
  };

  const pageActions = [
    <Button key="refresh" icon={<ReloadOutlined />} onClick={fetchAll} loading={loading}>
      刷新
    </Button>,
    mode !== 'plans' && mode !== 'config' && (
      <Button key="plans" onClick={() => navigate('/coding-plan/third-party-plans')}>
        三方套餐
      </Button>
    ),
    mode !== 'config' && (
      <Button key="config" icon={<SettingOutlined />} onClick={() => navigate('/coding-plan/resale-config')}>
        转售配置
      </Button>
    ),
    mode !== 'report' && mode !== 'config' && (
      <Button key="report" icon={<SafetyCertificateOutlined />} onClick={() => navigate('/coding-plan/resale-report')}>
        转售报表
      </Button>
    ),
    mode === 'plans' && (
      <Button key="create" type="primary" icon={<PlusOutlined />} disabled={!canManagePlans} onClick={openCreatePlan}>
        新建三方套餐
      </Button>
    ),
    mode === 'config' && (
      <Button key="line" type="primary" icon={<PlusOutlined />} disabled={!canManageSystem} onClick={() => openLineDrawer()}>
        新建供应商线路
      </Button>
    ),
  ].filter(Boolean);

  const showInitialLoading = loading && (mode === 'config' ? providerLines.length === 0 : !workspace);
  if (showInitialLoading) {
    return <Spin size="large" style={{ display: 'block', margin: '100px auto' }} />;
  }

  const productOptions = [
    { value: 'all', label: '全部 CodingPlan 产品' },
    ...products.map((product) => ({ value: product.id, label: product.name })),
  ];
  const thirdPartyProductOptions = products.map((product) => {
    const resaleCount = resalePlanCountByProductId.get(product.id) ?? 0;
    const isProviderResaleProduct = product.fulfillmentMode === 'provider_resale';
    const modeLabel = isProviderResaleProduct
      ? (resaleCount > 0 ? `已有 ${resaleCount} 个三方套餐` : '三方转售产品')
      : '非三方转售产品';
    const disabled = !product.isActive || !isProviderResaleProduct;
    const disabledReason = !product.isActive
      ? '已停用'
      : !isProviderResaleProduct
        ? '履约模式不是三方转售'
        : null;
    return {
      value: product.id,
      label: `${product.name} · ${product.slug ?? product.id} · ${modeLabel}`,
      disabled,
      title: disabledReason ? `${product.name}：${disabledReason}` : product.name,
    };
  });
  const lineOptions = [
    { value: 'all', label: '全部供应商线路' },
    ...providerLines.map((line) => ({ value: line.id, label: `${line.name} · ${line.code}` })),
  ];
  const routeCurrencyOptions = Array.from(new Set([
    platformCurrency,
    ...providerProducts.map((product) => product.currency),
    'usd',
    'cny',
  ].map((value) => compactText(value)?.toLowerCase()).filter(Boolean) as string[]))
    .sort()
    .map((value) => ({ value, label: value.toUpperCase() }));
  const userSegmentOptions = userSegments.map((segment) => ({
    value: segment.id,
    label: `${segment.name} · ${segment.id}`,
  }));
  const lineDrawerLifecycle = editingLine
    ? lineLifecycle(editingLine)
    : { label: '草稿', variant: 'proc' as TagVariant };
  const planProductOptionsForLine = (lineId?: string, selectedUpstreamProductId?: string) => {
    const options = providerProducts
      .filter((product) => product.providerLineId === lineId)
      .map((product) => ({
        value: product.upstreamProductId,
        label: `${product.productName} · ${product.upstreamProductId}`,
      }));
    if (
      selectedUpstreamProductId
      && !options.some((option) => option.value === selectedUpstreamProductId)
    ) {
      options.unshift({
        value: selectedUpstreamProductId,
        label: `当前绑定 · ${selectedUpstreamProductId}`,
      });
    }
    return options;
  };
  const planProductSelectEmpty = (lineId?: string, routeIndex?: number) => (
    loadingProductLineId === lineId ? (
      <Spin size="small" />
    ) : (
      <div className="cp-resale-select-empty">
        <span>{lineId ? '暂无上游套餐' : '请先选择供应商线路'}</span>
        {lineId && lineById.get(lineId)?.syncEnabled && canManageSystem ? (
          <Button
            type="link"
            size="small"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void handlePlanRouteLineChange(routeIndex ?? 0, lineId, { forceSync: true })}
          >
            刷新上游目录
          </Button>
        ) : null}
      </div>
    )
  );
  const planColumns = [
    {
      title: '本地套餐',
      key: 'plan',
      width: 280,
      render: (_: unknown, row: ThirdPartyPlanRow) => {
        const state = planStatus(row.plan);
        const product = row.plan?.productId ? productById.get(row.plan.productId) : null;
        return (
          <div className="cp-primary-cell">
            <div className="cp-resale-title-line">
              <span>{row.plan?.name ?? row.routePlan?.name ?? row.route.planId}</span>
              <Tag variant={state.variant}>{state.label}</Tag>
            </div>
            <div className="cp-muted">{product?.name ?? row.plan?.productName ?? row.routePlan?.productId ?? '未绑定产品'}</div>
            <div className="cp-muted cp-mono">{row.plan?.id ?? row.route.planId}</div>
          </div>
        );
      },
    },
    {
      title: '用户售价',
      key: 'price',
      width: 190,
      render: (_: unknown, row: ThirdPartyPlanRow) => (
        <div className="cp-stack">
          <span>月 {formatCents(row.plan?.monthlyPrice, platformCurrency)}</span>
          <span className="cp-muted">季 {formatCents(row.plan?.quarterlyPrice, platformCurrency)} / 年 {formatCents(row.plan?.yearlyPrice, platformCurrency)}</span>
        </div>
      ),
    },
    {
      title: '库存',
      key: 'stock',
      width: 170,
      render: (_: unknown, row: ThirdPartyPlanRow) => {
        const salesLimit = row.plan?.salesLimit ?? 0;
        const reservedSalesCount = row.plan?.reservedSalesCount ?? 0;
        const remainingSales = row.plan?.remainingSales ?? Math.max(0, salesLimit - reservedSalesCount);
        const soldOut = row.plan?.soldOut === true || (salesLimit > 0 && remainingSales <= 0);
        return (
          <div className="cp-stack">
            {salesLimit > 0 ? (
              <Tag variant={soldOut ? 'warn' : 'success'}>{soldOut ? '售罄' : '限量'}</Tag>
            ) : (
              <Tag variant="muted">不限量</Tag>
            )}
            <span className="cp-muted">
              {salesLimit > 0 ? `${reservedSalesCount} / ${salesLimit} 已占用` : `${reservedSalesCount} 已占用`}
            </span>
            {salesLimit > 0 ? <span className="cp-muted">剩余 {remainingSales}</span> : null}
          </div>
        );
      },
    },
    {
      title: '上游绑定',
      key: 'upstream',
      width: 310,
      render: (_: unknown, row: ThirdPartyPlanRow) => (
        <div className="cp-stack">
          {row.bindings.map((binding) => (
            <div key={binding.route.id} className="cp-resale-binding-line">
              <span>{binding.providerLine?.name ?? '未绑定供应商线路'}</span>
              <span className="cp-muted">
                {binding.upstreamProduct?.productName ?? binding.route.upstreamProductId ?? '未绑定上游套餐'}
              </span>
              <span className="cp-muted cp-mono">{binding.route.upstreamProductId ?? '—'}</span>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: '映射',
      key: 'route',
      width: 220,
      render: (_: unknown, row: ThirdPartyPlanRow) => {
        const labels = routeScopeLabels(row.route, userSegmentById);
        const enabledCount = row.routes.filter((route) => route.enabled).length;
        const enabledLabel = enabledCount === row.routes.length
          ? '已启用'
          : enabledCount === 0
            ? '已禁用'
            : '部分启用';
        const enabledVariant: TagVariant = enabledCount === row.routes.length
          ? 'success'
          : enabledCount === 0
            ? 'muted'
            : 'warn';
        return (
          <div className="cp-stack">
            <Tag variant={enabledVariant}>{enabledLabel}</Tag>
            <span className="cp-muted">{row.routes.length} 条供应商线路</span>
            {labels.length > 0 ? (
              <span className="cp-muted">{labels.join(' / ')}</span>
            ) : (
              <span className="cp-muted">默认映射</span>
            )}
          </div>
        );
      },
    },
    {
      title: '操作',
      key: 'actions',
      width: 260,
      align: 'right' as const,
      render: (_: unknown, row: ThirdPartyPlanRow) => (
        <Space size={4} wrap>
          <Button
            type="link"
            size="small"
            disabled={!canManagePlans || !row.plan?.id}
            onClick={() => openEditPlan(row)}
          >
            编辑 SKU
          </Button>
          <Button
            type="link"
            size="small"
            disabled={!canManagePlans}
            onClick={() => void handleTogglePlanRoutes(row)}
          >
            {row.routes.every((route) => route.enabled) ? '禁用' : '启用'}
          </Button>
          <Popconfirm
            title={(
              <div>
                <div>{row.plan ? '确认删除这个三方套餐？' : '确认清理这条转售映射？'}</div>
                <div style={{ marginTop: 4, maxWidth: 300, color: 'var(--text-muted)', fontWeight: 400 }}>
                  已有订单、订阅或履约记录引用时后端会拒绝删除，请改为下架。
                </div>
              </div>
            )}
            disabled={!canManagePlans}
            onConfirm={() => handleDeletePlan(row)}
          >
            <Button
              type="link"
              size="small"
              danger
              icon={<DeleteOutlined />}
              disabled={!canManagePlans}
            >
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const lineColumns = [
    {
      title: '供应商线路',
      key: 'line',
      width: 300,
      render: (_: unknown, row: CodingPlanProviderLine) => (
        <div className="cp-primary-cell">
          <div className="cp-resale-title-line">
            <span>{row.name}</span>
            <Tag variant={lineLifecycle(row).variant}>{lineLifecycle(row).label}</Tag>
          </div>
          <div className="cp-muted cp-mono">{row.code}</div>
          <div className="cp-muted">{row.providerName ?? row.providerCode}</div>
        </div>
      ),
    },
    {
      title: '线路状态',
      key: 'status',
      width: 320,
      render: (_: unknown, row: CodingPlanProviderLine) => {
        const lifecycle = lineLifecycle(row);
        const endpointCount = Array.isArray(row.dedicatedEndpoints) ? row.dedicatedEndpoints.length : 0;
        return (
          <div className="cp-line-summary">
            <Tag variant={lifecycle.variant}>{lifecycle.label}</Tag>
            <span>{lineHasCredentials(row) ? '凭证已配置' : '缺少供应商凭证'}</span>
            <span>{hasConfiguredDedicatedEndpoint(row) ? `专属端点 ${endpointCount} 个` : '未配置专属端点'}</span>
          </div>
        );
      },
    },
    {
      title: '上游目录',
      key: 'catalog',
      width: 220,
      render: (_: unknown, row: CodingPlanProviderLine) => (
        <div className="cp-line-summary">
          <Tag variant={row.syncEnabled ? 'proc' : 'muted'}>{row.syncEnabled ? '可刷新' : '未开放'}</Tag>
          <span>{productCountByLineId.get(row.id) ?? 0} 个目录条目</span>
        </div>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 280,
      align: 'right' as const,
      render: (_: unknown, row: CodingPlanProviderLine) => (
        <Space size={4} wrap>
          <Button type="link" size="small" disabled={!canManageSystem} onClick={() => openLineDrawer(row)}>
            编辑
          </Button>
          {!lineReady(row) ? (
            <Button
              type="link"
              size="small"
              icon={<RocketOutlined />}
              loading={publishingLineId === row.id || testingLineId === row.id}
              disabled={!canManageSystem}
              onClick={() => void handlePublishLine(row)}
            >
              上架
            </Button>
          ) : null}
          {lineHasAnyEnabledFlag(row) ? (
            <Popconfirm
              title="停用这条供应商线路？"
              description="将关闭目录刷新、售卖开放、订单履约和运行时调用；已存在的数据不会被删除。"
              okText="停用"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDisableLine(row)}
            >
              <Button type="link" size="small" danger disabled={!canManageSystem}>
                停用
              </Button>
            </Popconfirm>
          ) : null}
          <Button
            type="link"
            size="small"
            danger
            icon={<DeleteOutlined />}
            loading={deletingLineId === row.id}
            disabled={!canManageSystem}
            onClick={() => confirmDeleteLine(row)}
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  const reportColumns = [
    {
      title: '用户 / 账号',
      key: 'user',
      width: 250,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <div className="cp-stack">
          <span className="cp-mono">{row.userId}</span>
          <span className="cp-muted cp-mono">{row.tenantId}</span>
        </div>
      ),
    },
    {
      title: '本地套餐 / 订单',
      key: 'plan',
      width: 280,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <div className="cp-stack">
          <span>{planById.get(row.planId)?.name ?? row.planId}</span>
          <span className="cp-muted cp-mono">{row.orderId}</span>
        </div>
      ),
    },
    {
      title: '上游绑定',
      key: 'upstream',
      width: 300,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <div className="cp-stack">
          <span>{lineById.get(row.providerLineId ?? '')?.name ?? row.providerLine?.name ?? row.providerLineCode ?? '—'}</span>
          <span className="cp-muted cp-mono">{row.upstreamProductId}</span>
          <span className="cp-muted cp-mono">{row.upstreamOrderId ?? '—'}</span>
        </div>
      ),
    },
    {
      title: '上游 Key',
      key: 'key',
      width: 180,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <div className="cp-stack">
          <span className="cp-mono">{row.upstreamApiKeyPrefix ?? '—'}</span>
          <span className="cp-muted">仅展示前缀</span>
        </div>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 120,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => statusTag(row.status),
    },
    {
      title: '有效期',
      key: 'period',
      width: 220,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <div className="cp-stack">
          <span>{formatDate(row.productStartTime)}</span>
          <span className="cp-muted">{formatDate(row.productEndTime)}</span>
        </div>
      ),
    },
    {
      title: '失败原因',
      dataIndex: 'lastError',
      key: 'lastError',
      width: 260,
      render: (value?: string | null) => value || '—',
    },
    {
      title: '操作',
      key: 'actions',
      width: 120,
      align: 'right' as const,
      render: (_: unknown, row: CodingPlanProviderEntitlement) => (
        <Popconfirm
          title="确认重试供应商履约？"
          disabled={!canManageOrders || !['FAILED', 'PENDING'].includes(row.status)}
          onConfirm={() => handleRetry(row.id)}
        >
          <Button
            type="link"
            size="small"
            loading={retryingEntitlementId === row.id}
            disabled={!canManageOrders || !['FAILED', 'PENDING'].includes(row.status)}
          >
            重试
          </Button>
        </Popconfirm>
      ),
    },
  ];

  return (
    <div className="cp-page cp-resale-page">
      <PageHeader
        title={meta.title}
        subtitle={meta.subtitle}
        actions={pageActions}
      />

      {mode !== 'config' && (
        <StatCardGroup columns={4}>
          <StatCard label="三方套餐" value={thirdPartyRows.length} />
          <StatCard label="供应商线路" value={providerLines.length} />
          <StatCard label="上游套餐" value={providerProducts.length} />
          <StatCard label="失败履约" value={providerEntitlements.filter((row) => row.status === 'FAILED').length} />
        </StatCardGroup>
      )}

      {mode === 'plans' && (
        <>
          <Alert
            className="cp-alert"
            type="info"
            showIcon
            message="三方套餐 = 本地售卖 SKU + 转售映射"
            description="新建流程会检查产品运行时；未初始化时自动写入 dedicated_upstream + included_upstream，然后创建本地套餐并绑定上游套餐。"
          />
          <section className="cp-section">
            <div className="cp-section-head">
              <div>
                <h2>三方套餐列表</h2>
                <p>只管理用户看到的本地 SKU；上游权益由转售映射指向供应商套餐。</p>
              </div>
              <Space wrap>
                <Select value={productFilter} style={{ width: 220 }} onChange={setProductFilter} options={productOptions} />
                <Select value={lineFilter} style={{ width: 220 }} onChange={setLineFilter} options={lineOptions} />
              </Space>
            </div>
            {thirdPartyRows.length === 0 && !loading ? (
              <EmptyPlaceholder
                icon={<KeyOutlined />}
                title="暂无三方套餐"
                description="创建本地 SKU 并选择供应商线路、上游套餐后，这里会展示可运营的三方套餐列表。"
                action={<Button type="primary" onClick={openCreatePlan} disabled={!canManagePlans}>新建三方套餐</Button>}
              />
            ) : (
              <DataTable
                columns={planColumns}
                dataSource={thirdPartyRows}
                rowKey="id"
                loading={loading}
                pagination={false}
                scroll={{ x: 1340 }}
              />
            )}
          </section>
        </>
      )}

      {mode === 'config' && (
        <>
          <section className="cp-section">
            <div className="cp-section-head">
              <div>
                <h2>供应商线路</h2>
                <p>线路负责供应商凭证、专属端点和上架状态。</p>
              </div>
            </div>
            <DataTable
              columns={lineColumns}
              dataSource={providerLines}
              rowKey="id"
              loading={loading}
              pagination={false}
              scroll={{ x: 960 }}
            />
          </section>
        </>
      )}

      {mode === 'report' && (
        <section className="cp-section">
          <div className="cp-section-head">
            <div>
              <h2>购买用户与上游激活</h2>
              <p>完整 key 不在后台展示；报表只显示 key prefix、上游订单和有效期。</p>
            </div>
            <Space wrap>
              <Input.Search
                allowClear
                placeholder="搜索用户、账号、订单、key 前缀"
                style={{ width: 300 }}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <Select
                value={statusFilter}
                style={{ width: 150 }}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: '全部状态' },
                  { value: 'ACTIVE', label: '已激活' },
                  { value: 'PENDING', label: '待履约' },
                  { value: 'FAILED', label: '失败' },
                  { value: 'EXPIRED', label: '过期' },
                ]}
              />
              <Select value={lineFilter} style={{ width: 220 }} onChange={setLineFilter} options={lineOptions} />
            </Space>
          </div>
          {filteredEntitlements.length === 0 && !loading ? (
            <EmptyPlaceholder
              icon={<SafetyCertificateOutlined />}
              title="暂无转售履约记录"
              description="用户购买三方套餐后，供应商履约记录会展示在这里。"
            />
          ) : (
            <DataTable
              columns={reportColumns}
              dataSource={filteredEntitlements}
              rowKey="id"
              loading={loading}
              pagination={false}
              scroll={{ x: 1730 }}
            />
          )}
        </section>
      )}

      {mode === 'plans' && (
      <Drawer
        title={editingPlanRow ? '编辑三方套餐' : '新建三方套餐'}
        width={620}
        open={planDrawerOpen}
        onClose={closePlanDrawer}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={closePlanDrawer}>取消</Button>
            <Button type="primary" loading={saving} disabled={!canManagePlans} onClick={handleSavePlan}>
              {editingPlanRow ? '保存 SKU' : '创建套餐'}
            </Button>
          </Space>
        )}
      >
        <Form form={planForm} layout="vertical" className="cp-resale-form">
          <Form.Item label="三方转售产品" name="productId" rules={[{ required: true, message: '请选择产品' }]}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={Boolean(editingPlanRow)}
              options={thirdPartyProductOptions}
            />
          </Form.Item>
          <Form.Item label="套餐名称" name="name" rules={[{ required: true, message: '请输入套餐名称' }]}>
            <Input placeholder="例如 GLM Coding Pro" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea rows={2} placeholder="用户侧展示说明" />
          </Form.Item>
          <div className="cp-resale-form-grid">
            <Form.Item label="徽章" name="badge">
              <Input placeholder="例如 Popular / 推荐" />
            </Form.Item>
            <Form.Item label="排序" name="sortOrder">
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={`月付价格（${minorUnitLabel}）`} name="monthlyPrice">
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={`季付月均（${minorUnitLabel}）`} name="quarterlyPrice">
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label={`年付月均（${minorUnitLabel}）`} name="yearlyPrice">
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="计费周期" name="billingPeriod">
              <Select options={[
                { value: 'monthly', label: '月付' },
                { value: 'quarterly', label: '季付' },
                { value: 'yearly', label: '年付' },
              ]} />
            </Form.Item>
            <Form.Item
              label="本地权益有效天数"
              name="validityDays"
              tooltip="用于 stsoft 本地权益过期兜底；若上游返回到期时间，以上游时间为准。"
            >
              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item label="席位" name="memberLimit">
              <StableNumberInput min={1} precision={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              label="上架数量"
              name="salesLimit"
              tooltip="0 表示不限量；大于 0 时，达到该数量后用户侧显示售罄并禁止继续下单。"
            >
              <StableNumberInput min={0} precision={0} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.List
            name="routes"
            rules={[{
              validator: async (_, routes) => {
                if (!Array.isArray(routes) || routes.length < 1) {
                  throw new Error('请至少绑定一条供应商线路');
                }
              },
            }]}
          >
            {(fields, { add, remove }, { errors }) => (
              <div className="cp-resale-route-bindings">
                <div className="cp-resale-section-header">
                  <div>
                    <strong>线路绑定</strong>
                    <span>同一三方套餐的多条线路必须共享同一个上游套餐 ID。</span>
                  </div>
                  <Button
                    icon={<PlusOutlined />}
                    onClick={() => {
                      const currentRoutes = normalizePlanRouteForms(planForm.getFieldValue('routes'));
                      const currentLineIds = new Set(currentRoutes.map((route) => route.providerLineId));
                      const preferredUpstreamProductId = currentRoutes[0]?.upstreamProductId;
                      const nextLine = publishedLines.find((line) => !currentLineIds.has(line.id));
                      const nextProduct = nextLine
                        ? providerProducts.find((product) =>
                          product.providerLineId === nextLine.id
                          && product.upstreamProductId === preferredUpstreamProductId)
                          ?? providerProducts.find((product) => product.providerLineId === nextLine.id)
                        : null;
                      add({
                        providerLineId: nextLine?.id,
                        upstreamProductId: nextProduct?.upstreamProductId ?? preferredUpstreamProductId,
                      });
                      if (nextLine && !nextProduct) {
                        void refreshProductsForLine(nextLine.id, { syncIfEmpty: true, silent: true });
                      }
                    }}
                  >
                    添加线路
                  </Button>
                </div>
                {fields.map((field, index) => {
                  const currentRoute = selectedPlanRoutes[field.name] as ThirdPartyPlanRouteForm | undefined;
                  const lineId = currentRoute?.providerLineId;
                  const upstreamProductId = currentRoute?.upstreamProductId;
                  return (
                    <div className="cp-resale-route-binding" key={field.key}>
                      <div className="cp-resale-route-binding-head">
                        <span>绑定 {index + 1}</span>
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<DeleteOutlined />}
                          disabled={fields.length <= 1}
                          onClick={() => remove(field.name)}
                        />
                      </div>
                      <div className="cp-resale-form-grid">
                        <Form.Item
                          label="供应商线路"
                          name={[field.name, 'providerLineId']}
                          rules={[{ required: true, message: '请选择供应商线路' }]}
                        >
                          <Select
                            options={providerLines.map((line) => ({
                              value: line.id,
                              label: `${line.name} · ${line.code}`,
                              disabled: !lineReady(line),
                            }))}
                            onChange={(nextLineId) => void handlePlanRouteLineChange(index, nextLineId)}
                          />
                        </Form.Item>
                        <Form.Item
                          label="上游套餐"
                          name={[field.name, 'upstreamProductId']}
                          rules={[{ required: true, message: '请选择上游套餐' }]}
                        >
                          <Select
                            showSearch
                            loading={loadingProductLineId === lineId}
                            disabled={!lineId}
                            notFoundContent={planProductSelectEmpty(lineId, index)}
                            optionFilterProp="label"
                            options={planProductOptionsForLine(lineId, upstreamProductId)}
                          />
                        </Form.Item>
                      </div>
                      <Form.Item name={[field.name, 'routeId']} hidden>
                        <Input />
                      </Form.Item>
                    </div>
                  );
                })}
                <Form.ErrorList errors={errors} />
              </div>
            )}
          </Form.List>
          <div className="cp-resale-form-grid">
            <Form.Item label="限定币种" name="routeCurrency">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={routeCurrencyOptions}
              />
            </Form.Item>
            <Form.Item label="限定市场" name="routeMarket">
              <Input placeholder="可选，如 global / cn" />
            </Form.Item>
            <Form.Item label="限定销售渠道" name="routeSalesChannel">
              <Input placeholder="可选，如 web / app" />
            </Form.Item>
            <Form.Item label="限定用户分群" name="routeUserSegmentId">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                options={userSegmentOptions}
              />
            </Form.Item>
            <Form.Item label="映射开始" name="routeStartAt">
              <DatePicker
                allowClear
                showTime
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
            <Form.Item
              label="映射结束"
              name="routeEndAt"
              dependencies={['routeStartAt']}
              rules={[{
                validator: async (_, value) => {
                  const start = planForm.getFieldValue('routeStartAt');
                  if (start && value && !dayjs(value).isAfter(dayjs(start))) {
                    throw new Error('映射结束必须晚于映射开始');
                  }
                },
              }]}
            >
              <DatePicker
                allowClear
                showTime
                format="YYYY-MM-DD HH:mm"
                style={{ width: '100%' }}
              />
            </Form.Item>
          </div>
          <div className="cp-resale-switch-row cp-resale-switch-row-2">
            <Form.Item label={editingPlanRow ? '上架' : '立即上架'} name="isActive" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item label="启用映射" name="routeEnabled" valuePropName="checked">
              <Switch />
            </Form.Item>
          </div>
        </Form>
      </Drawer>
      )}

      {mode === 'config' && (
      <Drawer
        title={editingLine ? '编辑供应商线路' : '新建供应商线路'}
        rootClassName="cp-resale-line-drawer"
        width={720}
        open={lineDrawerOpen}
        onClose={() => setLineDrawerOpen(false)}
        destroyOnClose
        extra={(
          <Space>
            <Button onClick={() => setLineDrawerOpen(false)}>取消</Button>
            <Button loading={saving} disabled={!canManageSystem} onClick={() => void handleSaveLine()}>
              保存草稿
            </Button>
            <Button
              type="primary"
              icon={<RocketOutlined />}
              loading={saving || Boolean(editingLine && (publishingLineId === editingLine.id || testingLineId === editingLine.id))}
              disabled={!canManageSystem}
              onClick={() => void handleSaveLine({ publishAfterSave: true })}
            >
              保存并上架
            </Button>
          </Space>
        )}
      >
        <Form form={lineForm} layout="vertical" className="cp-resale-form">
          <div className="cp-resale-form-grid">
            <Form.Item label="线路 code（自动生成）" name="code" rules={[{ required: true, message: '请填写线路名称生成 code' }]}>
              <Input placeholder="按供应商和线路名称自动生成" disabled />
            </Form.Item>
            <Form.Item label="线路名称" name="name" rules={[{ required: true, message: '请输入线路名称' }]}>
              <Input placeholder="供应商线路名称" />
            </Form.Item>
            <Form.Item
              label="供应商/适配器"
              name="providerCode"
              tooltip="决定上游目录同步、订单履约和合作伙伴 API 的鉴权适配器。"
              rules={[{ required: true, message: '请选择供应商' }]}
            >
              <Select
                disabled={Boolean(editingLine)}
                options={providerLineProviderOptions}
                onChange={applyProviderLinePreset}
              />
            </Form.Item>
            <Form.Item
              label="供应商账户"
              name="providerAccountIdentityId"
              tooltip="线路的权威账户身份；后续 dedicated entitlement 将原子继承该关联。"
              rules={[
                { required: true, message: '请选择供应商账户身份' },
                { validator: validateProviderLineAccountIdentity },
              ]}
              extra={selectedProviderLineAccountIdentity ? (
                <span>
                  账户引用：{' '}
                  <Typography.Text code copyable>
                    {selectedProviderLineAccountIdentity.ref}
                  </Typography.Text>
                </span>
              ) : (
                <Typography.Text type="secondary">
                  账户身份由渠道管理页统一创建和停用。
                </Typography.Text>
              )}
            >
              <Select
                showSearch
                disabled={!lineProviderCodeValue}
                placeholder={lineProviderCodeValue ? '选择与供应商匹配的账户' : '请先选择供应商'}
                optionFilterProp="label"
                options={providerLineAccountIdentityOptions}
                notFoundContent="暂无匹配账户，请先到渠道管理创建"
              />
            </Form.Item>
          </div>
          <Form.Item name="providerName" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="adapterType" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="environment" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="authType" hidden>
            <Input />
          </Form.Item>
          <Form.Item
            label="合作伙伴 API Base URL"
            name="apiBaseUrl"
            tooltip="调用供应商套餐目录、下单和用量接口的地址，不是模型调用地址。"
            rules={[{ required: true, message: '请输入合作伙伴 API Base URL' }]}
          >
            <Input placeholder="https://open.bigmodel.cn" />
          </Form.Item>
          <div className="cp-resale-config-section">
            <div className="cp-resale-section-header">
              <div>
                <strong>供应商凭证</strong>
                <span>用于测试连接、刷新上游目录和订单履约；编辑已配置线路时留空表示不修改。</span>
              </div>
            </div>
            <Form.Item
              label="PartnerCode"
              name="partnerCode"
              rules={[{ required: !editingLine?.partnerCodeConfigured, message: '请输入 PartnerCode' }]}
            >
              <Input placeholder={editingLine?.partnerCodeConfigured ? '留空表示不修改' : '请输入 PartnerCode'} />
            </Form.Item>
            <Form.Item
              label="PartnerSecretKey"
              name="partnerSecretKey"
              rules={[{ required: !editingLine?.partnerSecretConfigured, message: '请输入 PartnerSecretKey' }]}
            >
              <Input.Password placeholder={editingLine?.partnerSecretConfigured ? '留空表示不修改' : '请输入 PartnerSecretKey'} />
            </Form.Item>
          </div>
          <div className="cp-resale-dedicated-section">
            <div className="cp-resale-section-header">
              <div>
                <strong>专属端点</strong>
                <span>为当前供应商线路生成 dedicated runtime provider；模型调用地址在端点里配置，provider_id 保存后由后端回填。</span>
              </div>
            </div>
            <div className="cp-resale-runtime-manager">
              <div className="cp-resale-runtime-toolbar">
                <Select
                  showSearch
                  value={dedicatedProductId ?? undefined}
                  placeholder="选择该线路所属转售产品"
                  options={dedicatedProductOptions}
                  optionFilterProp="label"
                  style={{ minWidth: 280, flex: 1 }}
                  onChange={(value) => {
                    setDedicatedProductId(value);
                    void loadDedicatedRuntimeProviders(value);
                  }}
                />
                <Button
                  icon={<ReloadOutlined />}
                  loading={dedicatedLoading}
                  disabled={!dedicatedProductId}
                  onClick={() => dedicatedProductId && void loadDedicatedRuntimeProviders(dedicatedProductId)}
                >
                  刷新
                </Button>
              </div>
              <Alert
                type="info"
                showIcon
                message="这是转售线路自己的运行时发布配置；保存供应商线路时生成或更新 pc_ provider，不需要到渠道管理里创建渠道，也不会加入普通投放组。"
              />
              <Spin spinning={dedicatedLoading}>
                {referencedDedicatedRuntimeProviders.length > 0 ? (
                  <div className="cp-resale-runtime-provider-list">
                    {referencedDedicatedRuntimeProviders.map((provider) => {
                      const providerId = runtimeProviderIdForProductChannel(provider.id);
                      const status = dedicatedProviderStatus(provider.status);
                      const providerName = provider.displayName
                        ?? provider.channel?.name
                        ?? provider.channelId
                        ?? provider.id;
                      const runtimeSummary = [
                        provider.channel?.provider,
                        provider.channel?.providerProfile ?? provider.channel?.sdkType,
                        provider.channelId,
                      ].filter(Boolean).join(' · ');
                      return (
                        <div className="cp-resale-runtime-provider-row" key={provider.id}>
                          <div className="cp-resale-runtime-provider-main">
                            <div className="cp-resale-runtime-provider-title">
                              <strong>{providerName}</strong>
                              <Tag variant={status.variant}>{status.label}</Tag>
                              <Tag variant="proc">当前线路引用</Tag>
                            </div>
                            <Typography.Text code copyable={{ text: providerId }}>{providerId}</Typography.Text>
                            <span>{runtimeSummary || 'dedicated runtime provider'}</span>
                            {provider.channel?.baseUrl && <span>模型调用地址: {provider.channel.baseUrl}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <EmptyPlaceholder
                    icon={<SettingOutlined />}
                    title={referencedDedicatedProviderIds.size > 0 ? '未读取到当前线路 provider' : '暂无当前线路 provider'}
                    description={referencedDedicatedProviderIds.size > 0 ? '请确认选择的是该线路所属转售产品。' : '填写下方端点配置并保存后会生成。'}
                  />
                )}
              </Spin>
            </div>
            <Space>
              <Button
                size="small"
                disabled={!canManageSystem}
                onClick={() => {
                  appendDedicatedEndpointTemplate(zhipuCodingAnthropicDedicatedEndpointTemplate());
                }}
              >
                添加智谱 Anthropic 端点
              </Button>
              <Button
                size="small"
                disabled={!canManageSystem}
                onClick={() => {
                  appendDedicatedEndpointTemplate(zhipuCodingOpenAiDedicatedEndpointTemplate());
                }}
              >
                添加智谱 OpenAI/Responses 端点
              </Button>
            </Space>
            <Form.List
              name="dedicatedEndpoints"
              rules={[
                {
                  validator: async (_, value) => {
                    const error = dedicatedEndpointValidationError(value, false, dedicatedProductId);
                    if (error) throw new Error(error);
                  },
                },
              ]}
            >
              {(fields, { add, remove }, { errors }) => (
                <div className="cp-resale-dedicated-endpoints">
                  {fields.map((field, index) => (
                    <div key={field.key} className="cp-resale-dedicated-endpoint">
                      <div className="cp-resale-dedicated-endpoint-header">
                        <span>端点 {index + 1}</span>
                          <Button
                            type="text"
                            size="small"
                            danger
                            icon={<DeleteOutlined />}
                            onClick={() => remove(field.name)}
                          />
                        </div>
                        <div className="cp-resale-dedicated-required-grid">
                          <Form.Item
                            label="上游协议"
                            name={[field.name, 'client_protocol']}
                            rules={[{ required: true, message: '请选择上游协议' }]}
                          >
                            <Select
                              options={DEDICATED_CLIENT_PROTOCOL_OPTIONS}
                              onChange={(value) => applyDedicatedEndpointProtocolDefaults(field.name, value)}
                            />
                          </Form.Item>
                          <div className="cp-resale-protocol-paths">
                            <ProtocolPathList
                              name={[field.name, 'paths']}
                              label="路径列表"
                              inboundProtocolOptions={DEDICATED_CLIENT_PROTOCOL_OPTIONS}
                              channelOptions={DEDICATED_PROTOCOL_STRATEGY_OPTIONS}
                              upstreamProtocol={upstreamProtocolForDedicatedEndpoint(
                                compactText(lineForm.getFieldValue(['dedicatedEndpoints', field.name, 'client_protocol'])) ?? 'openai',
                                undefined,
                              )}
                            />
                          </div>
                          <Form.Item
                            label="服务入站协议（双发兼容）"
                            name={[field.name, 'served_inbound_protocols']}
                            tooltip="过渡期兼容字段；保存时会和路径列表一起提交。"
                          >
                            <Select
                              mode="multiple"
                              options={DEDICATED_CLIENT_PROTOCOL_OPTIONS}
                              placeholder="选择入站协议"
                              onChange={(value) => {
                                const protocols = Array.isArray(value) ? value : [];
                                const clientProtocol = compactText(lineForm.getFieldValue(['dedicatedEndpoints', field.name, 'client_protocol'])) ?? 'openai';
                                const paths = protocols.map((protocol) => ({
                                  inbound_protocol: protocol,
                                  channel: suggestedProtocolChannel(
                                    upstreamProtocolForDedicatedEndpoint(clientProtocol, protocol),
                                    protocol,
                                  ),
                                }));
                                lineForm.setFieldValue(['dedicatedEndpoints', field.name, 'paths'], paths);
                              }}
                            />
                          </Form.Item>
                          <Form.Item
                            label="状态"
                            name={[field.name, 'status']}
                        >
                          <Select options={DEDICATED_ENDPOINT_STATUS_OPTIONS} placeholder="默认启用" allowClear />
                        </Form.Item>
                        <Form.Item
                          label="上游协议类型"
                          name={[field.name, 'provider_profile']}
                        >
                          <Select options={DEDICATED_PROVIDER_PROFILE_OPTIONS} placeholder="选择上游协议类型" />
                        </Form.Item>
                        <Form.Item
                          label="模型调用 Base URL"
                          name={[field.name, 'base_url']}
                          tooltip="gateway 实际调用模型的上游地址；可填写包含路径的完整地址，发布时由后端拆分。"
                        >
                          <Input placeholder="https://open.bigmodel.cn/api/coding/paas/v4" />
                        </Form.Item>
                        <Form.Item
                          label="生成的 provider_id"
                          name={[field.name, 'provider_id']}
                        >
                          <Input disabled placeholder="保存后生成 pc_<ProductChannelId>" />
                        </Form.Item>
                      </div>
                      </div>
                    ))}
                    <Button
                      icon={<PlusOutlined />}
                      onClick={() => add({
                        client_protocol: 'openai',
                        protocol_strategy: 'passthrough',
                        provider_profile: 'openai_compatible',
                        served_inbound_protocols: ['openai'],
                        paths: [{ inbound_protocol: 'openai', channel: 'passthrough' }],
                        status: 'active',
                      })}
                    >
                      添加端点配置
                    </Button>
                  <Form.ErrorList errors={errors} />
                </div>
              )}
            </Form.List>
          </div>
          <div className="cp-resale-config-section">
            <div className="cp-resale-section-header">
              <div>
                <strong>上架状态</strong>
                <span>上架会一次性开启目录刷新、售卖开放、订单履约和专属运行时调用。</span>
              </div>
            </div>
            <div className="cp-resale-publication-panel">
              <Tag variant={lineDrawerLifecycle.variant}>{lineDrawerLifecycle.label}</Tag>
              <span>
                保存草稿不会改变当前上线状态；点击保存并上架会先保存配置、测试供应商连接，成功后统一开放整条线路。
              </span>
            </div>
          </div>
        </Form>
      </Drawer>
      )}

      <div className="cp-generated">
        {workspace?.generatedAt ? `工作台快照生成于 ${dayjs(workspace.generatedAt).format('YYYY-MM-DD HH:mm:ss')}` : null}
      </div>
    </div>
  );
}
