import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Steps,
  Switch,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { DataTable, PageHeader, StableNumberInput } from '../../components/common';
import {
  channelApi,
  publisherSyncMessage,
  publisherWarningsText,
  productApi,
  type DeliverySettingAudienceScope,
  type DeliverySettingInput,
  type ProductChannelGroupMemberRole,
  type ProductChannelGroupRow,
  type ProductChannelGroupStrategy,
  type ProductRouteAssignmentInput,
  type ProductRouteAssignmentRow,
} from '../../api/admin';
import { userSegmentApi, type UserSegment } from '../../api/v2';
import { usePermission } from '../../hooks/usePermission';
import './DeliverySettings.css';

type BillingMode = 'SUBSCRIPTION' | 'PAY_AS_YOU_GO' | 'CODING_PLAN';
type DeliveryAudienceFormScope = DeliverySettingAudienceScope | 'UNBOUND';

interface ProductRecord {
  id: string;
  name: string;
  slug: string;
  billingMode: BillingMode | string;
  isActive: boolean;
}

interface ChannelRecord {
  id: string;
  name: string;
  provider: string;
  baseUrl?: string;
  sdkType?: string;
  providerProfile?: string | null;
  models?: unknown;
  status?: string;
  isActive: boolean;
  priority?: number;
  weight?: number;
}

interface DeliveryFormValues {
  productId?: string;
  groupName?: string;
  groupCode?: string;
  groupDescription?: string;
  groupStrategy?: ProductChannelGroupStrategy;
  groupStatus?: 'active' | 'disabled';
  groupIsDefault?: boolean;
  channelIds?: string[];
  audienceScope?: DeliveryAudienceFormScope;
  userSegmentId?: string;
  userId?: string;
  assignmentMode?: 'ONLY' | 'PREFER';
  assignmentPriority?: number;
  modelPattern?: string;
  clientCompatibility?: string;
  reason?: string;
}

interface ChannelDraft {
  channelId: string;
  priority: number;
  weight: number;
  role: ProductChannelGroupMemberRole;
  allowedModels: string[];
  maxRpm?: number | null;
  maxTpm?: number | null;
}

type ProductChannelSummary = {
  id: string;
  channelId?: string;
  displayName?: string | null;
  allowedModels?: unknown;
  priority?: number;
  weight?: number;
  maxRpm?: number | null;
  maxTpm?: number | null;
  metadata?: Record<string, unknown> | null;
  channel?: {
    id?: string;
    name?: string;
    provider?: string;
    providerProfile?: string | null;
    sdkType?: string;
    status?: string;
    isActive?: boolean;
  };
};

type ProductChannelForDelivery = ProductChannelSummary & {
  status?: string;
  isDefault?: boolean;
};

type DeliveryGroupMember = {
  id: string;
  productChannelId: string;
  priority?: number;
  weight?: number;
  role?: string;
  maxRpm?: number | null;
  maxTpm?: number | null;
  productChannel?: ProductChannelSummary;
};

type DeliveryGroupApiRow = ProductChannelGroupRow & {
  id: string;
  productId: string;
  code: string;
  name: string;
  description?: string | null;
  strategy: string;
  status: string;
  isDefault?: boolean;
  members?: DeliveryGroupMember[];
  updatedAt?: string;
};

type DeliveryAssignmentApiRow = ProductRouteAssignmentRow & {
  id: string;
  productId: string;
  subjectType: 'USER' | 'USER_SEGMENT' | string;
  subjectId: string;
  targetType: string;
  targetId: string;
  mode?: string;
  priority?: number;
  isActive?: boolean;
};

interface DeliveryGroupRow {
  id: string;
  product: ProductRecord;
  group: DeliveryGroupApiRow;
  members: DeliveryGroupMember[];
  assignments: DeliveryAssignmentApiRow[];
}

const STRATEGY_OPTIONS: Array<{ value: ProductChannelGroupStrategy; label: string }> = [
  { value: 'weighted_failover', label: '权重优先' },
  { value: 'priority_failover', label: '优先级故障转移' },
  { value: 'round_robin', label: '轮询' },
  { value: 'cost_first', label: '成本优先' },
  { value: 'latency_first', label: '延迟优先' },
];

const ROLE_OPTIONS: Array<{ value: ProductChannelGroupMemberRole; label: string }> = [
  { value: 'primary', label: '主渠道' },
  { value: 'fallback', label: '备用' },
  { value: 'shadow', label: '影子' },
];

const AUDIENCE_OPTIONS: Array<{ value: DeliverySettingAudienceScope; label: string }> = [
  { value: 'ALL', label: '全部用户' },
  { value: 'USER_SEGMENT', label: '用户分群' },
  { value: 'USER', label: '指定用户' },
];

const UNBOUND_AUDIENCE_OPTION: { value: 'UNBOUND'; label: string } = {
  value: 'UNBOUND',
  label: '不绑定对象',
};

const BILLING_MODE_LABEL: Record<string, string> = {
  SUBSCRIPTION: '订阅',
  PAY_AS_YOU_GO: '按量',
  CODING_PLAN: 'CodingPlan',
};

function getItems<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object' && Array.isArray((value as { items?: unknown }).items)) {
    return (value as { items: T[] }).items;
  }
  return [];
}

function normalizeModelList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  if (typeof value !== 'string') return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    return trimmed
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function codeSeed(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '')
    .slice(0, 42);
  return /^[a-z0-9]/.test(normalized) ? normalized : 'delivery';
}

function defaultGroupCode(product: ProductRecord): string {
  return `${codeSeed(product.slug || product.name)}-${Date.now().toString(36).slice(-6)}`.slice(0, 64);
}

function defaultChannelDraft(channelId: string, index: number): ChannelDraft {
  return {
    channelId,
    priority: index === 0 ? 5 : (index + 1) * 10,
    weight: 1,
    role: index === 0 ? 'primary' : 'fallback',
    allowedModels: [],
  };
}

function compactPayload(payload: DeliverySettingInput): string {
  return JSON.stringify(payload, null, 2);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const data = (error as { response?: { data?: { message?: unknown; error?: unknown } } }).response?.data;
    if (typeof data?.message === 'string') return data.message;
    if (Array.isArray(data?.message)) return data.message.filter((item): item is string => typeof item === 'string').join('；') || fallback;
    if (typeof data?.error === 'string') return data.error;
    if (typeof (error as { message?: unknown }).message === 'string') return (error as { message: string }).message;
  }
  return fallback;
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

function isDedicatedProductChannel(productChannel?: ProductChannelSummary | null): boolean {
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

function productChannelPhysicalId(productChannel?: ProductChannelSummary | null): string | null {
  if (!productChannel) return null;
  return productChannel.channel?.id || productChannel.channelId || null;
}

function memberPhysicalChannelId(member: DeliveryGroupMember): string | null {
  return productChannelPhysicalId(member.productChannel);
}

function channelDraftFromMember(member: DeliveryGroupMember, index: number): ChannelDraft | null {
  const channelId = memberPhysicalChannelId(member);
  if (!channelId) return null;
  const productChannel = member.productChannel;
  return {
    channelId,
    priority: member.priority ?? productChannel?.priority ?? (index === 0 ? 5 : (index + 1) * 10),
    weight: member.weight ?? productChannel?.weight ?? 1,
    role: (member.role as ProductChannelGroupMemberRole | undefined) ?? (index === 0 ? 'primary' : 'fallback'),
    allowedModels: normalizeModelList(productChannel?.allowedModels),
    maxRpm: member.maxRpm ?? productChannel?.maxRpm ?? null,
    maxTpm: member.maxTpm ?? productChannel?.maxTpm ?? null,
  };
}

type PublisherSyncAggregate =
  | { ok: true; warnings?: unknown[] }
  | { ok: false; error?: string; warnings?: unknown[] }
  | null;

export default function DeliverySettingsPage() {
  const { message } = App.useApp();
  const canManage = usePermission('admin.page.delivery_settings.manage');
  const [form] = Form.useForm<DeliveryFormValues>();
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<DeliveryGroupRow | null>(null);
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [segments, setSegments] = useState<UserSegment[]>([]);
  const [deliveryRows, setDeliveryRows] = useState<DeliveryGroupRow[]>([]);
  const [channelDrafts, setChannelDrafts] = useState<Record<string, ChannelDraft>>({});
  const [saveResult, setSaveResult] = useState<Record<string, unknown> | null>(null);

  const productId = Form.useWatch('productId', form);
  const watchedChannelIds = Form.useWatch('channelIds', form);
  const channelIds = useMemo(() => watchedChannelIds ?? [], [watchedChannelIds]);
  const audienceScope = Form.useWatch('audienceScope', form) ?? 'ALL';
  const groupIsDefault = Form.useWatch('groupIsDefault', form);
  const audienceOptions = useMemo<Array<{ value: DeliveryAudienceFormScope; label: string }>>(
    () => (editingRow ? [...AUDIENCE_OPTIONS, UNBOUND_AUDIENCE_OPTION] : AUDIENCE_OPTIONS),
    [editingRow],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === productId) ?? null,
    [productId, products],
  );
  const channelById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel])),
    [channels],
  );
  const selectedChannels = useMemo(
    () => channelIds.map((id) => channelById.get(id)).filter((channel): channel is ChannelRecord => Boolean(channel)),
    [channelById, channelIds],
  );
  const activeChannels = useMemo(
    () => channels.filter((channel) => channel.isActive && channel.status !== 'disabled'),
    [channels],
  );

  const segmentById = useMemo(
    () => new Map(segments.map((segment) => [segment.id, segment])),
    [segments],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [productRes, channelResult, segmentResult] = await Promise.all([
        productApi.list(),
        channelApi.list({ page: 1, pageSize: 100 }).catch(() => null),
        userSegmentApi.list({ pageSize: 100, isActive: true }).catch(() => null),
      ]);
      const nextProducts = getItems<ProductRecord>(productRes);
      const nextChannels = getItems<ChannelRecord>(channelResult);
      const nextSegments = getItems<UserSegment>(segmentResult);
      setProducts(nextProducts);
      setChannels(nextChannels);
      setSegments(nextSegments);

      let routeLoadFailed = false;
      const routeEntries = await Promise.all(nextProducts.map(async (product) => {
        const [groupsResult, assignmentsResult] = await Promise.allSettled([
          productApi.productChannelGroups(product.id),
          productApi.productRouteAssignments(product.id, { targetType: 'GROUP', isActive: true }),
        ]);
        if (groupsResult.status === 'rejected' || assignmentsResult.status === 'rejected') {
          routeLoadFailed = true;
        }
        return {
          product,
          groups: groupsResult.status === 'fulfilled' ? getItems<DeliveryGroupApiRow>(groupsResult.value) : [],
          assignments: assignmentsResult.status === 'fulfilled'
            ? getItems<DeliveryAssignmentApiRow>(assignmentsResult.value)
            : [],
        };
      }));
      setDeliveryRows(routeEntries.flatMap(({ product, groups, assignments }) =>
        groups.map((group) => ({
          id: group.id,
          product,
          group,
          members: Array.isArray(group.members) ? group.members : [],
          assignments: assignments.filter((assignment) => assignment.targetId === group.id),
        })),
      ));
      if (routeLoadFailed) {
        message.warning('部分投放数据未加载完整，请稍后刷新');
      }
    } catch {
      message.error('加载投放数据失败');
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedProduct || editingRow) return;
    form.setFieldsValue({
      groupName: `${selectedProduct.name} 默认投放组`,
      groupCode: defaultGroupCode(selectedProduct),
    });
  }, [editingRow, form, selectedProduct]);

  useEffect(() => {
    form.setFieldsValue({ groupIsDefault: audienceScope === 'ALL' });
    if (audienceScope === 'USER_SEGMENT' && !form.getFieldValue('userSegmentId') && segments.length === 1) {
      form.setFieldsValue({ userSegmentId: segments[0].id });
    }
  }, [audienceScope, form, segments]);

  const openCreate = () => {
    const defaultProduct = products.find((product) => product.isActive) ?? products[0];
    const defaultChannelIds = activeChannels.length === 1 ? [activeChannels[0].id] : [];
    setEditingRow(null);
    form.resetFields();
    form.setFieldsValue({
      productId: defaultProduct?.id,
      groupName: defaultProduct ? `${defaultProduct.name} 默认投放组` : undefined,
      groupCode: defaultProduct ? defaultGroupCode(defaultProduct) : undefined,
      groupStrategy: 'weighted_failover',
      groupStatus: 'active',
      groupIsDefault: true,
      channelIds: defaultChannelIds,
      audienceScope: 'ALL',
      assignmentMode: 'ONLY',
      assignmentPriority: 100,
    });
    setChannelDrafts(defaultChannelIds.reduce<Record<string, ChannelDraft>>((next, id, index) => {
      next[id] = defaultChannelDraft(id, index);
      return next;
    }, {}));
    setSaveResult(null);
    setCurrent(0);
    setCreateOpen(true);
  };

  const openEdit = (record: DeliveryGroupRow) => {
    const assignment = record.assignments[0];
    const scope: DeliveryAudienceFormScope = assignment
      ? (assignment.subjectType === 'USER_SEGMENT' ? 'USER_SEGMENT' : 'USER')
      : (record.group.isDefault ? 'ALL' : 'UNBOUND');
    const drafts = record.members.reduce<Record<string, ChannelDraft>>((next, member, index) => {
      const draft = channelDraftFromMember(member, index);
      if (draft) next[draft.channelId] = draft;
      return next;
    }, {});
    const channelIds = Object.keys(drafts);

    setEditingRow(record);
    form.resetFields();
    form.setFieldsValue({
      productId: record.product.id,
      groupName: record.group.name,
      groupCode: record.group.code,
      groupDescription: typeof record.group.description === 'string' ? record.group.description : undefined,
      groupStrategy: record.group.strategy as ProductChannelGroupStrategy,
      groupStatus: record.group.status === 'disabled' ? 'disabled' : 'active',
      groupIsDefault: Boolean(record.group.isDefault),
      channelIds,
      audienceScope: scope,
      userSegmentId: scope === 'USER_SEGMENT' ? assignment?.subjectId : undefined,
      userId: scope === 'USER' ? assignment?.subjectId : undefined,
      assignmentMode: (assignment?.mode as DeliveryFormValues['assignmentMode']) ?? 'ONLY',
      assignmentPriority: assignment?.priority ?? 100,
      modelPattern: typeof assignment?.modelPattern === 'string' ? assignment.modelPattern : undefined,
      clientCompatibility: typeof assignment?.clientCompatibility === 'string' ? assignment.clientCompatibility : undefined,
      reason: typeof assignment?.reason === 'string' ? assignment.reason : undefined,
    });
    setChannelDrafts(drafts);
    setSaveResult(null);
    setCurrent(0);
    setCreateOpen(true);
  };

  const syncChannelDrafts = (ids: string[]) => {
    setChannelDrafts((prev) => ids.reduce<Record<string, ChannelDraft>>((next, id, index) => {
      next[id] = prev[id] ?? defaultChannelDraft(id, index);
      return next;
    }, {}));
  };

  const updateDraft = (channelId: string, patch: Partial<ChannelDraft>) => {
    setChannelDrafts((prev) => ({
      ...prev,
      [channelId]: {
        ...(prev[channelId] ?? defaultChannelDraft(channelId, channelIds.indexOf(channelId))),
        ...patch,
      },
    }));
  };

  const buildPayload = (): DeliverySettingInput => {
    const values = form.getFieldsValue(true);
    const ids: string[] = values.channelIds ?? [];
    const scope = values.audienceScope ?? 'ALL';
    const audience = scope === 'UNBOUND'
      ? undefined
      : scope === 'ALL'
        ? { scope: 'ALL' as const }
        : {
            scope,
            subjectId: scope === 'USER_SEGMENT' ? values.userSegmentId : values.userId,
            mode: values.assignmentMode ?? 'ONLY',
            priority: values.assignmentPriority ?? 100,
            modelPattern: values.modelPattern || null,
            clientCompatibility: values.clientCompatibility || null,
            reason: values.reason || null,
            isActive: true,
          };
    return {
      group: {
        name: values.groupName,
        code: values.groupCode,
        description: values.groupDescription || null,
        strategy: values.groupStrategy ?? 'weighted_failover',
        status: values.groupStatus ?? 'active',
        isDefault: scope === 'ALL' ? true : Boolean(values.groupIsDefault),
      },
      channels: ids.map((id, index) => {
        const draft = channelDrafts[id] ?? defaultChannelDraft(id, index);
        return {
          channelId: id,
          status: 'active',
          priority: draft.priority,
          weight: draft.weight,
          allowedModels: draft.allowedModels.length > 0 ? draft.allowedModels : undefined,
          groupMember: {
            role: draft.role,
            priority: draft.priority,
            weight: draft.weight,
            maxRpm: draft.maxRpm ?? null,
            maxTpm: draft.maxTpm ?? null,
          },
        };
      }),
      ...(audience ? { audience } : {}),
    };
  };

  const validateStep = async (step = current): Promise<boolean> => {
    try {
      if (step === 0) await form.validateFields(['productId']);
      if (step === 1) await form.validateFields(['groupName', 'groupCode', 'groupStrategy', 'groupStatus']);
      if (step === 2) {
        await form.validateFields(['channelIds']);
        if ((form.getFieldValue('channelIds') ?? []).length === 0) {
          message.warning('至少选择一个供应商渠道');
          return false;
        }
      }
      if (step === 3) {
        if (audienceScope === 'USER_SEGMENT') await form.validateFields(['userSegmentId']);
        if (audienceScope === 'USER') await form.validateFields(['userId']);
      }
      return true;
    } catch {
      return false;
    }
  };

  const goNext = async () => {
    if (await validateStep()) setCurrent((value) => Math.min(value + 1, 4));
  };

  const rememberPublisherResult = (
    result: unknown,
    current: PublisherSyncAggregate,
  ): PublisherSyncAggregate => {
    const sync = publisherSyncMessage(result);
    if (!sync) return current;
    const warnings = [
      ...(current?.warnings ?? []),
      ...(sync.warnings ?? []),
    ];
    if (sync.ok === false) {
      return { ok: false, error: sync.error, warnings: warnings.length ? warnings : undefined };
    }
    if (current?.ok === false) {
      return { ...current, warnings: warnings.length ? warnings : undefined };
    }
    return warnings.length ? { ok: true, warnings } : current;
  };

  const productChannelPayloadFromDraft = (draft: ChannelDraft) => ({
    status: 'active' as const,
    priority: draft.priority,
    weight: draft.weight,
    allowedModels: draft.allowedModels.length > 0 ? draft.allowedModels : null,
    maxRpm: draft.maxRpm ?? null,
    maxTpm: draft.maxTpm ?? null,
  });

  const groupMemberPayloadFromDraft = (draft: ChannelDraft) => ({
    role: draft.role,
    priority: draft.priority,
    weight: draft.weight,
    maxRpm: draft.maxRpm ?? null,
    maxTpm: draft.maxTpm ?? null,
  });

  const loadProductChannelsByPhysicalId = async (productId: string) => {
    const rows = getItems<ProductChannelForDelivery>(await productApi.productChannels(productId));
    return new Map(rows.map((row) => [productChannelPhysicalId(row), row]).filter((entry): entry is [string, ProductChannelForDelivery] => Boolean(entry[0])));
  };

  const syncEditedMembers = async (
    record: DeliveryGroupRow,
    selectedChannelIds: string[],
  ): Promise<PublisherSyncAggregate> => {
    let publisherSync: PublisherSyncAggregate = null;
    const productChannelsByChannelId = await loadProductChannelsByPhysicalId(record.product.id);
    const existingMembersByChannelId = new Map(
      record.members
        .map((member) => [memberPhysicalChannelId(member), member] as const)
        .filter((entry): entry is [string, DeliveryGroupMember] => Boolean(entry[0])),
    );
    const selected = new Set(selectedChannelIds);

    for (const [index, channelId] of selectedChannelIds.entries()) {
      const draft = channelDrafts[channelId] ?? defaultChannelDraft(channelId, index);
      let productChannel = productChannelsByChannelId.get(channelId);
      const channelPayload = productChannelPayloadFromDraft(draft);
      if (productChannel) {
        if (isDedicatedProductChannel(productChannel)) {
          throw new Error('Dedicated-only ProductChannel 只发布 Runtime Provider，不能复用到普通投放组');
        }
        const result = await productApi.updateProductChannel(record.product.id, productChannel.id, channelPayload);
        publisherSync = rememberPublisherResult(result, publisherSync);
      } else {
        productChannel = await productApi.createProductChannel(record.product.id, {
          channelId,
          ...channelPayload,
        });
        publisherSync = rememberPublisherResult(productChannel, publisherSync);
        productChannelsByChannelId.set(channelId, productChannel);
      }

      const member = existingMembersByChannelId.get(channelId);
      const memberPayload = groupMemberPayloadFromDraft(draft);
      if (member) {
        const result = await productApi.updateProductChannelGroupMember(record.product.id, record.group.id, member.id, memberPayload);
        publisherSync = rememberPublisherResult(result, publisherSync);
      } else {
        const result = await productApi.addProductChannelGroupMember(record.product.id, record.group.id, {
          productChannelId: productChannel.id,
          ...memberPayload,
        });
        publisherSync = rememberPublisherResult(result, publisherSync);
      }
    }

    for (const member of record.members) {
      const channelId = memberPhysicalChannelId(member);
      if (!channelId || selected.has(channelId)) continue;
      const result = await productApi.deleteProductChannelGroupMember(record.product.id, record.group.id, member.id);
      publisherSync = rememberPublisherResult(result, publisherSync);
    }

    return publisherSync;
  };

  const syncEditedAudience = async (
    record: DeliveryGroupRow,
    values: DeliveryFormValues,
  ): Promise<PublisherSyncAggregate> => {
    let publisherSync: PublisherSyncAggregate = null;
    const scope = values.audienceScope ?? 'ALL';

    if (scope === 'ALL' || scope === 'UNBOUND') {
      for (const assignment of record.assignments) {
        const result = await productApi.deleteProductRouteAssignment(record.product.id, assignment.id);
        publisherSync = rememberPublisherResult(result, publisherSync);
      }
      return publisherSync;
    }

    const assignmentPayload: ProductRouteAssignmentInput = {
      subjectType: scope,
      subjectId: scope === 'USER_SEGMENT' ? values.userSegmentId : values.userId,
      targetType: 'GROUP',
      targetId: record.group.id,
      mode: values.assignmentMode ?? 'ONLY',
      priority: values.assignmentPriority ?? 100,
      modelPattern: values.modelPattern || null,
      clientCompatibility: values.clientCompatibility || null,
      reason: values.reason || null,
      isActive: true,
    };
    const [primaryAssignment, ...extraAssignments] = record.assignments;
    const result = primaryAssignment
      ? await productApi.updateProductRouteAssignment(record.product.id, primaryAssignment.id, assignmentPayload)
      : await productApi.createProductRouteAssignment(record.product.id, assignmentPayload);
    publisherSync = rememberPublisherResult(result, publisherSync);

    for (const assignment of extraAssignments) {
      const deleteResult = await productApi.deleteProductRouteAssignment(record.product.id, assignment.id);
      publisherSync = rememberPublisherResult(deleteResult, publisherSync);
    }
    return publisherSync;
  };

  const updateDeliverySetting = async (
    record: DeliveryGroupRow,
    payload: DeliverySettingInput,
  ): Promise<PublisherSyncAggregate> => {
    let publisherSync: PublisherSyncAggregate = null;
    const values = form.getFieldsValue(true);
    const selectedChannelIds = values.channelIds ?? [];
    const groupResult = await productApi.updateProductChannelGroup(record.product.id, record.group.id, payload.group ?? {});
    publisherSync = rememberPublisherResult(groupResult, publisherSync);
    publisherSync = (await syncEditedMembers(record, selectedChannelIds)) ?? publisherSync;
    publisherSync = (await syncEditedAudience(record, values)) ?? publisherSync;
    return publisherSync;
  };

  const submit = async () => {
    for (let step = 0; step < 4; step += 1) {
      if (!(await validateStep(step))) {
        setCurrent(step);
        return;
      }
    }
    const values = form.getFieldsValue(true);
    if (!values.productId) return;
    const payload = buildPayload();
    setSubmitting(true);
    setSaveResult(null);
    try {
      if (!editingRow) {
        const productChannelsByChannelId = await loadProductChannelsByPhysicalId(values.productId);
        const selectedChannelIds: string[] = Array.isArray(values.channelIds) ? values.channelIds : [];
        const dedicatedConflict = selectedChannelIds
          .find((channelId) => isDedicatedProductChannel(productChannelsByChannelId.get(channelId)));
        if (dedicatedConflict) {
          throw new Error('选择的渠道在该产品下已有 dedicated-only ProductChannel，不能复用到普通投放组');
        }
      }
      const result = editingRow ? null : await productApi.createDeliverySetting(values.productId, payload);
      const sync = editingRow ? await updateDeliverySetting(editingRow, payload) : publisherSyncMessage(result);
      setSaveResult(editingRow ? { publisherSync: sync ?? { ok: true } } : null);
      if (result) setSaveResult(result);
      if (sync?.ok === false) {
        message.warning(`已保存，Publisher 下发失败：${sync.error || '未知错误'}`);
        await refresh();
      } else {
        const warningText = publisherWarningsText(sync?.warnings);
        if (warningText) {
          message.warning(`已保存，Publisher 返回警告：${warningText}`);
        } else {
          message.success(editingRow ? '投放设置已更新并下发' : '投放设置已保存并下发');
        }
        setCreateOpen(false);
        setEditingRow(null);
        await refresh();
      }
    } catch (error) {
      message.error(getErrorMessage(error, '保存投放设置失败'));
    } finally {
      setSubmitting(false);
    }
  };

  const deleteDeliverySetting = async (record: DeliveryGroupRow) => {
    setActionLoading(`delete:${record.id}`);
    try {
      for (const assignment of record.assignments) {
        await productApi.deleteProductRouteAssignment(record.product.id, assignment.id);
      }
      await productApi.deleteProductChannelGroup(record.product.id, record.group.id);
      message.success('投放设置已删除并下发');
      await refresh();
    } catch (error) {
      message.error(getErrorMessage(error, '删除投放设置失败'));
    } finally {
      setActionLoading(null);
    }
  };

  const channelColumns: ColumnsType<ChannelRecord> = [
    {
      title: '渠道',
      dataIndex: 'name',
      key: 'name',
      width: 260,
      render: (_value, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.name}</Typography.Text>
          <Space size={6} wrap>
            <Tag>{record.providerProfile || record.sdkType || record.provider}</Tag>
            {record.status === 'active' && record.isActive ? <Tag color="green">可用</Tag> : <Tag>停用</Tag>}
          </Space>
        </Space>
      ),
    },
    {
      title: '模型范围',
      key: 'allowedModels',
      render: (_value, record) => {
        const models = normalizeModelList(record.models).filter((model) => model !== '*');
        return (
          <Select
            mode="multiple"
            maxTagCount="responsive"
            allowClear
            placeholder="继承渠道模型"
            value={channelDrafts[record.id]?.allowedModels ?? []}
            options={models.map((model) => ({ value: model, label: model }))}
            onChange={(allowedModels) => updateDraft(record.id, { allowedModels })}
          />
        );
      },
    },
    {
      title: '角色',
      key: 'role',
      width: 120,
      render: (_value, record) => (
        <Select
          value={channelDrafts[record.id]?.role ?? 'primary'}
          options={ROLE_OPTIONS}
          onChange={(role) => updateDraft(record.id, { role })}
        />
      ),
    },
    {
      title: '优先级',
      key: 'priority',
      width: 110,
      render: (_value, record) => (
        <StableNumberInput
          min={1}
          precision={0}
          value={channelDrafts[record.id]?.priority ?? 5}
          onChange={(priority) => updateDraft(record.id, { priority: Number(priority || 1) })}
        />
      ),
    },
    {
      title: '权重',
      key: 'weight',
      width: 100,
      render: (_value, record) => (
        <StableNumberInput
          min={1}
          precision={0}
          value={channelDrafts[record.id]?.weight ?? 1}
          onChange={(weight) => updateDraft(record.id, { weight: Number(weight || 1) })}
        />
      ),
    },
    {
      title: '限流',
      key: 'limits',
      width: 220,
      render: (_value, record) => (
        <Space.Compact>
          <StableNumberInput
            min={1}
            precision={0}
            placeholder="RPM"
            value={channelDrafts[record.id]?.maxRpm ?? undefined}
            onChange={(maxRpm) => updateDraft(record.id, { maxRpm: maxRpm === null ? null : Number(maxRpm) })}
          />
          <StableNumberInput
            min={1}
            precision={0}
            placeholder="TPM"
            value={channelDrafts[record.id]?.maxTpm ?? undefined}
            onChange={(maxTpm) => updateDraft(record.id, { maxTpm: maxTpm === null ? null : Number(maxTpm) })}
          />
        </Space.Compact>
      ),
    },
  ];

  const deliveryColumns: ColumnsType<DeliveryGroupRow> = [
    {
      title: '产品',
      key: 'product',
      width: 240,
      render: (_value, record) => (
        <div className="rt-delivery-entity">
          <Typography.Text strong className="rt-delivery-entity-title">
            {record.product.name}
          </Typography.Text>
          <div className="rt-delivery-tag-list">
            <Tag>{record.product.slug}</Tag>
            <Tag color={record.product.isActive ? 'green' : 'default'}>
              {BILLING_MODE_LABEL[record.product.billingMode] || record.product.billingMode}
            </Tag>
          </div>
        </div>
      ),
    },
    {
      title: '投放组',
      key: 'group',
      width: 300,
      render: (_value, record) => (
        <div className="rt-delivery-entity">
          <div className="rt-delivery-title-row">
            <Typography.Text strong className="rt-delivery-entity-title">
              {record.group.name}
            </Typography.Text>
            {record.group.isDefault && <Tag color="blue">默认</Tag>}
          </div>
          <Typography.Text type="secondary" code className="rt-delivery-code">
            {record.group.code}
          </Typography.Text>
        </div>
      ),
    },
    {
      title: '渠道',
      key: 'members',
      width: 360,
      render: (_value, record) => {
        if (record.members.length === 0) return <Typography.Text type="secondary">未配置</Typography.Text>;
        return (
          <div className="rt-delivery-tag-list">
            {record.members.map((member) => {
              const channel = member.productChannel?.channel;
              const name = member.productChannel?.displayName || channel?.name || member.productChannel?.channelId || member.productChannelId;
              return (
                <Tooltip key={member.id} title={name}>
                  <Tag>
                    {name}
                    {member.role ? ` / ${member.role}` : ''}
                  </Tag>
                </Tooltip>
              );
            })}
          </div>
        );
      },
    },
    {
      title: '适用对象',
      key: 'audience',
      width: 360,
      render: (_value, record) => {
        const tags = record.assignments.map((assignment) => {
          if (assignment.subjectType === 'USER_SEGMENT') {
            return `分群：${segmentById.get(assignment.subjectId)?.name || assignment.subjectId}`;
          }
          return `用户：${assignment.subjectId}`;
        });
        if (record.group.isDefault && tags.length === 0) tags.push('全部用户');
        if (tags.length === 0) return <Typography.Text type="secondary">未绑定对象</Typography.Text>;
        return (
          <div className="rt-delivery-tag-list">
            {tags.map((tag) => (
              <Tooltip key={tag} title={tag}>
                <Tag>{tag}</Tag>
              </Tooltip>
            ))}
          </div>
        );
      },
    },
    {
      title: '策略',
      key: 'strategy',
      width: 140,
      render: (_value, record) => (
        <Typography.Text>
          {STRATEGY_OPTIONS.find((option) => option.value === record.group.strategy)?.label || record.group.strategy}
        </Typography.Text>
      ),
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      render: (_value, record) => (
        <Tag color={record.group.status === 'active' ? 'green' : 'default'}>
          {record.group.status === 'active' ? '启用' : '停用'}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      width: 220,
      fixed: 'right',
      render: (_value, record) => (
        <Space size={4}>
          <Button
            size="small"
            type="link"
            icon={<EditOutlined />}
            onClick={() => openEdit(record)}
            disabled={!canManage || Boolean(actionLoading)}
          >
            编辑
          </Button>
          <Popconfirm
            title={`删除投放组「${record.group.name}」？`}
            description="会同步删除该投放组绑定的适用对象规则。"
            okText="删除"
            cancelText="取消"
            onConfirm={() => deleteDeliverySetting(record)}
          >
            <Button
              size="small"
              type="link"
              danger
              icon={<DeleteOutlined />}
              loading={actionLoading === `delete:${record.id}`}
              disabled={!canManage || Boolean(actionLoading && actionLoading !== `delete:${record.id}`)}
            >
              删除
            </Button>
          </Popconfirm>
          <Button
            size="small"
            type="link"
            loading={actionLoading === `rebuild:${record.id}`}
            disabled={!canManage || Boolean(actionLoading && actionLoading !== `rebuild:${record.id}`)}
            onClick={async () => {
              setActionLoading(`rebuild:${record.id}`);
              try {
                await productApi.rebuildProductRouteGraph(record.product.id);
                message.success('已重推 Publisher');
              } catch (error) {
                message.error(getErrorMessage(error, '重推 Publisher 失败'));
              } finally {
                setActionLoading(null);
              }
            }}
          >
            重推
          </Button>
        </Space>
      ),
    },
  ];

  const payload = buildPayload();
  const sync = publisherSyncMessage(saveResult);

  return (
    <div className="rt-delivery-page">
      <PageHeader
        title="投放设置"
        subtitle="按产品创建投放组，绑定供应商渠道和适用对象"
        actions={[
          <Button key="new" type="primary" icon={<PlusOutlined />} disabled={!canManage} onClick={openCreate}>
            新建投放
          </Button>,
          <Button key="refresh" icon={<ReloadOutlined />} onClick={refresh} loading={loading}>
            刷新
          </Button>,
        ]}
      />

      <div className="rt-delivery-list-panel">
        <DataTable<DeliveryGroupRow>
          className="rt-delivery-list-table"
          rowKey="id"
          loading={loading}
          columns={deliveryColumns}
          dataSource={deliveryRows}
          searchable
          searchPlaceholder="搜索投放组 / 产品 / 渠道"
          size="middle"
          tableLayout="fixed"
          scroll={{ x: 1630 }}
          pagination={{
            pageSize: 20,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 个投放组`,
          }}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无投放组"
              />
            ),
          }}
        />
      </div>

      <Drawer
        title={editingRow ? '编辑投放' : '新建投放'}
        width="min(1280px, calc(100vw - 48px))"
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setEditingRow(null);
        }}
        className="rt-delivery-create-drawer"
      >
        <div className="rt-delivery-shell">
        <aside className="rt-delivery-rail">
          <Steps
            direction="vertical"
            current={current}
            onChange={(step) => setCurrent(step)}
            items={[
              { title: '选择产品' },
              { title: '创建组' },
              { title: '选择渠道' },
              { title: '适用对象' },
              { title: '下发预览' },
            ]}
          />
        </aside>

        <main className="rt-delivery-main">
          <Form form={form} layout="vertical" requiredMark disabled={!canManage}>
            {current === 0 && (
              <section className="rt-delivery-panel">
                <div className="rt-delivery-section-head">
                  <Typography.Title level={4}>产品</Typography.Title>
                  {selectedProduct && (
                    <Tag color={selectedProduct.isActive ? 'green' : 'default'}>
                      {BILLING_MODE_LABEL[selectedProduct.billingMode] || selectedProduct.billingMode}
                    </Tag>
                  )}
                </div>
                <Form.Item name="productId" label="产品" rules={[{ required: true, message: '请选择产品' }]}>
                  <Select
                    showSearch
                    loading={loading}
                    disabled={Boolean(editingRow)}
                    optionFilterProp="label"
                    placeholder="选择已有产品"
                    options={products.map((product) => ({
                      value: product.id,
                      label: `${product.name} / ${product.slug}`,
                    }))}
                  />
                </Form.Item>
              </section>
            )}

            {current === 1 && (
              <section className="rt-delivery-panel">
                <div className="rt-delivery-section-head">
                  <Typography.Title level={4}>投放组</Typography.Title>
                  <Switch
                    checkedChildren="默认"
                    unCheckedChildren="非默认"
                    checked={Boolean(groupIsDefault)}
                    disabled={audienceScope === 'ALL' || audienceScope === 'UNBOUND'}
                    onChange={(checked) => form.setFieldsValue({ groupIsDefault: checked })}
                  />
                </div>
                <div className="rt-delivery-form-grid">
                  <Form.Item name="groupName" label="组名称" rules={[{ required: true, message: '请输入组名称' }]}>
                    <Input placeholder="如 GLM Coding 生产组" />
                  </Form.Item>
                  <Form.Item
                    name="groupCode"
                    label="组 Code"
                    rules={[
                      { required: true, message: '请输入组 Code' },
                      { pattern: /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, message: '只能包含字母、数字、下划线和中划线' },
                    ]}
                  >
                    <Input />
                  </Form.Item>
                  <Form.Item name="groupStrategy" label="策略" rules={[{ required: true, message: '请选择策略' }]}>
                    <Select options={STRATEGY_OPTIONS} />
                  </Form.Item>
                  <Form.Item name="groupStatus" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
                    <Select
                      options={[
                        { value: 'active', label: '启用' },
                        { value: 'disabled', label: '停用' },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item className="rt-delivery-grid-wide" name="groupDescription" label="备注">
                    <Input.TextArea rows={3} placeholder="可选" />
                  </Form.Item>
                </div>
              </section>
            )}

            {current === 2 && (
              <section className="rt-delivery-panel">
                <div className="rt-delivery-section-head">
                  <Typography.Title level={4}>供应商渠道</Typography.Title>
                  <Typography.Text type="secondary">{selectedChannels.length} 个已选</Typography.Text>
                </div>
                <Form.Item
                  name="channelIds"
                  label="渠道"
                  rules={[{ required: true, message: '请选择渠道' }]}
                >
                  <Select
                    mode="multiple"
                    showSearch
                    loading={loading}
                    optionFilterProp="label"
                    placeholder="选择供应商管理中的渠道"
                    options={activeChannels.map((channel) => ({
                      value: channel.id,
                      label: `${channel.name} / ${channel.providerProfile || channel.sdkType || channel.provider}`,
                    }))}
                    onChange={syncChannelDrafts}
                  />
                </Form.Item>
                {selectedChannels.length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未选择渠道" />
                ) : (
                  <DataTable<ChannelRecord>
                    rowKey="id"
                    className="rt-delivery-channel-table"
                    size="middle"
                    pagination={false}
                    columns={channelColumns}
                    dataSource={selectedChannels}
                    searchable
                    searchPlaceholder="搜索渠道 / Provider"
                    scroll={{ x: 980 }}
                  />
                )}
              </section>
            )}

            {current === 3 && (
              <section className="rt-delivery-panel">
                <div className="rt-delivery-section-head">
                  <Typography.Title level={4}>适用对象</Typography.Title>
                  <Tag>
                    {audienceScope === 'ALL' ? '默认路由' : (audienceScope === 'UNBOUND' ? '未绑定' : '覆盖规则')}
                  </Tag>
                </div>
                <div className="rt-delivery-form-grid">
                  <Form.Item name="audienceScope" label="对象类型" rules={[{ required: true, message: '请选择对象类型' }]}>
                    <Select options={audienceOptions} />
                  </Form.Item>
                  {audienceScope === 'USER_SEGMENT' && (
                    <Form.Item name="userSegmentId" label="用户分群" rules={[{ required: true, message: '请选择用户分群' }]}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        placeholder="选择已有用户分群"
                        options={segments.map((segment) => ({
                          value: segment.id,
                          label: `${segment.name} (${segment.memberCount})`,
                        }))}
                      />
                    </Form.Item>
                  )}
                  {audienceScope === 'USER' && (
                    <Form.Item name="userId" label="用户 ID" rules={[{ required: true, message: '请输入用户 ID' }]}>
                      <Input placeholder="user id" />
                    </Form.Item>
                  )}
                  {(audienceScope === 'USER_SEGMENT' || audienceScope === 'USER') && (
                    <>
                      <Form.Item name="assignmentMode" label="模式">
                        <Select
                          options={[
                            { value: 'ONLY', label: '仅使用该目标' },
                            { value: 'PREFER', label: '优先使用该目标' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name="assignmentPriority" label="优先级">
                        <StableNumberInput min={1} precision={0} />
                      </Form.Item>
                      <Form.Item name="modelPattern" label="模型匹配">
                        <Input placeholder="可选，如 glm-*" />
                      </Form.Item>
                      <Form.Item name="clientCompatibility" label="客户端兼容">
                        <Input placeholder="可选" />
                      </Form.Item>
                      <Form.Item className="rt-delivery-grid-wide" name="reason" label="原因">
                        <Input placeholder="可选" />
                      </Form.Item>
                    </>
                  )}
                  {audienceScope === 'ALL' && (
                    <div className="rt-delivery-all-target">
                      <Checkbox checked disabled>作为产品默认投放组</Checkbox>
                    </div>
                  )}
                  {audienceScope === 'UNBOUND' && (
                    <div className="rt-delivery-all-target">
                      <Checkbox checked={false} disabled>不绑定适用对象</Checkbox>
                    </div>
                  )}
                </div>
              </section>
            )}

            {current === 4 && (
              <section className="rt-delivery-panel">
                <div className="rt-delivery-section-head">
                  <Typography.Title level={4}>下发预览</Typography.Title>
                  <Button
                    type="primary"
                    icon={<CloudUploadOutlined />}
                    loading={submitting}
                    disabled={!canManage}
                    onClick={submit}
                  >
                    {editingRow ? '保存修改并下发 Publisher' : '保存并下发 Publisher'}
                  </Button>
                </div>
                {sync && (
                  <Alert
                    className="rt-delivery-alert"
                    type={sync.ok ? 'success' : 'warning'}
                    showIcon
                    icon={sync.ok ? <CheckCircleOutlined /> : undefined}
                    message={sync.ok ? 'Publisher 下发成功' : '已保存，Publisher 下发失败'}
                    description={sync.ok ? undefined : sync.error}
                  />
                )}
                <div className="rt-delivery-summary">
                  <div>
                    <span>产品</span>
                    <strong>{selectedProduct?.name || '-'}</strong>
                  </div>
                  <div>
                    <span>投放组</span>
                    <strong>{form.getFieldValue('groupName') || '-'}</strong>
                  </div>
                  <div>
                    <span>渠道</span>
                    <strong>{selectedChannels.length}</strong>
                  </div>
                  <div>
                    <span>对象</span>
                    <strong>{audienceOptions.find((item) => item.value === audienceScope)?.label || '-'}</strong>
                  </div>
                </div>
                <pre className="rt-delivery-payload">{compactPayload(payload)}</pre>
              </section>
            )}
          </Form>

          <div className="rt-delivery-actions">
            <Button disabled={current === 0 || !canManage} onClick={() => setCurrent((value) => Math.max(value - 1, 0))}>
              上一步
            </Button>
            {current < 4 ? (
              <Button type="primary" disabled={!canManage} onClick={goNext}>
                下一步
              </Button>
            ) : (
              <Button onClick={() => setCurrent(0)}>
                回到开始
              </Button>
            )}
          </div>
        </main>
        </div>
      </Drawer>
    </div>
  );
}
