import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, App, Button, Collapse, Drawer, Form, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { DataTable } from '../../components/common';
import { usePaginatedList } from '../../hooks/usePaginatedList';
import { usePermission } from '../../hooks/usePermission';
import {
  gatewayBillingEventApi,
  type GatewayBillingEventActionInput,
  type GatewayBillingEventRow,
  type GatewayUsageEvidenceRow,
} from '../../api/admin';
import {
  gatewayBillingEventFundingCurrency,
  GatewayFundingReservationDetails,
  GatewayFundingSplitDetails,
} from './FundingSplitDetails';
import { GatewayPlatformLossDetails } from './PlatformLossDetails';

const { Text } = Typography;

type GatewayBillingEventAction =
  | 'retry'
  | 'manualReview'
  | 'reconcileSettle'
  | 'absorb'
  | 'absorbDelta';

interface GatewayBillingEventFilters {
  status?: string;
  evidenceVerdict?: string;
  reconciliationStatus?: string;
  fundingOutcome?: string;
  requestId?: string;
  apiKeyId?: string;
  tenantId?: string;
  userId?: string;
  modelName?: string;
}

interface ActionTarget {
  action: GatewayBillingEventAction;
  row: GatewayBillingEventRow;
  idempotencyKey: string;
}

const statusColors: Record<string, string> = {
  RECEIVED: 'processing',
  DEDUCTED: 'success',
  SKIPPED: 'default',
  FAILED: 'error',
  RETRYABLE_FAILED: 'warning',
  QUARANTINED: 'purple',
  ABSORBED: 'gold',
  DEBT_OPEN: 'error',
};

const evidenceColors: Record<string, string> = {
  UNKNOWN: 'default',
  INCOMPLETE: 'warning',
  SETTLEABLE: 'success',
  SETTLEABLE_BY_POLICY: 'success',
  VERIFIED_PROVIDER_CORRECTION: 'success',
  CONFLICTED: 'error',
};

const reconciliationColors: Record<string, string> = {
  OPEN: 'processing',
  EVIDENCE_PENDING: 'warning',
  READY: 'cyan',
  PROCESSING: 'blue',
  RETRY_WAIT: 'warning',
  MANUAL_REVIEW: 'purple',
  CLOSED: 'success',
  SETTLED: 'success',
};

const fundingColors: Record<string, string> = {
  COLLECTED: 'success',
  INCLUDED: 'cyan',
  RECEIVABLE: 'blue',
  DEBT_OPEN: 'error',
  ABSORBED: 'gold',
};

const actionCopy: Record<GatewayBillingEventAction, {
  title: string;
  okText: string;
  description: string;
  success: string;
}> = {
  retry: {
    title: '技术重试',
    okText: '确认重试',
    description: '仅 RETRY_WAIT 事件可重试。请求会携带当前 revision 和幂等键，不改变证据结论。',
    success: '技术重试已提交',
  },
  manualReview: {
    title: '进入人工复核',
    okText: '确认进入复核',
    description: '该动作只改变对账工作流状态，不会产生客户扣费或其他资金影响。',
    success: '事件已进入人工复核',
  },
  absorb: {
    title: '确认平台吸收',
    okText: '确认平台吸收',
    description: '该动作只允许人工复核中的事件使用，并由 Billing 生成永久结算回执；不会补扣客户。',
    success: '平台吸收已记录',
  },
  reconcileSettle: {
    title: '使用权威证据结算',
    okText: '确认产生资金结果',
    description: '仅能选择该事件已落库且通过完整性硬闸的权威证据。Billing 将使用当前 revision 执行幂等结算。',
    success: '权威证据结算已提交',
  },
  absorbDelta: {
    title: '吸收已结算少计差额',
    okText: '确认由平台吸收差额',
    description: '仅适用于已结算或已形成应收、且权威证据发生冲突的人工复核事件。必须选择不同于原结算 evidence 的权威完整证据。',
    success: '已结算请求的少计差额已由平台吸收',
  },
};

function cleanFilters(values: GatewayBillingEventFilters): GatewayBillingEventFilters {
  return {
    status: values.status || undefined,
    evidenceVerdict: values.evidenceVerdict || undefined,
    reconciliationStatus: values.reconciliationStatus || undefined,
    fundingOutcome: values.fundingOutcome || undefined,
    requestId: values.requestId?.trim() || undefined,
    apiKeyId: values.apiKeyId?.trim() || undefined,
    tenantId: values.tenantId?.trim() || undefined,
    userId: values.userId?.trim() || undefined,
    modelName: values.modelName?.trim() || undefined,
  };
}

function formatTime(value?: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function actionRevision(row: GatewayBillingEventRow): number | null {
  return typeof row.revision === 'number' && Number.isSafeInteger(row.revision) && row.revision >= 0
    ? row.revision
    : null;
}

export function canRetryGatewayBillingEvent(row: GatewayBillingEventRow): boolean {
  return actionRevision(row) !== null
    && row.status === 'RETRYABLE_FAILED'
    && row.reconciliationStatus === 'RETRY_WAIT';
}

export function canMarkGatewayBillingEventManualReview(row: GatewayBillingEventRow): boolean {
  if (actionRevision(row) === null) return false;
  return row.status === 'QUARANTINED' && ['OPEN', 'NOT_READY', 'READY', 'EVIDENCE_PENDING'].includes(
    row.reconciliationStatus || '',
  );
}

export function canAbsorbGatewayBillingEvent(row: GatewayBillingEventRow): boolean {
  return actionRevision(row) !== null
    && row.status === 'QUARANTINED'
    && row.reconciliationStatus === 'MANUAL_REVIEW'
    && !row.fundingOutcome;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function strictNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function firstPositiveInteger(
  roots: Array<Record<string, unknown>>,
  keys: string[],
): number {
  for (const key of keys) {
    for (const root of roots) {
      const value = strictNonNegativeInteger(root[key]);
      if (value !== null && value > 0) return value;
    }
  }
  return 0;
}

function gatewayUsageEvidences(row: GatewayBillingEventRow): GatewayUsageEvidenceRow[] {
  return row.usageEvidences ?? row.evidence ?? [];
}

export function gatewayUsageEvidenceSettlementIssue(
  evidence: GatewayUsageEvidenceRow,
): string | null {
  if (evidence.source !== 'GATEWAY_USAGE_EVENT') return '非签名 Gateway UsageEvent 证据';
  const event = jsonObject(evidence.rawEvidence);
  if (!event) return '缺少原始证据';
  if (nonEmptyString(event.event_type) !== 'usage' || nonEmptyString(event.version) !== 'v2') {
    return '不是 UsageEvent v2';
  }
  const tokenSource = nonEmptyString(event.token_source) ?? evidence.tokenSource ?? null;
  if (!['provider', 'estimated_tokenizer', 'image_count', 'video_task'].includes(tokenSource ?? '')) {
    return 'token_source 不可结算';
  }
  if (tokenSource !== 'provider') return null;

  const usageEvidence = jsonObject(event.usage_evidence);
  if (!usageEvidence) return '缺少 usage_evidence';
  const evidenceStatus = nonEmptyString(usageEvidence.status)?.toLowerCase();
  const evidenceSource = nonEmptyString(usageEvidence.source)?.toLowerCase();
  if (evidenceStatus !== 'complete') return 'usage_evidence 未完整';
  if (!['provider_terminal', 'provider_response'].includes(evidenceSource ?? '')) {
    return 'usage_evidence source 不权威';
  }
  if (!nonEmptyString(usageEvidence.protocol)) return '缺少 usage_evidence protocol';
  if (evidenceSource === 'provider_terminal' && usageEvidence.terminal_frame_seen !== true) {
    return '未观测到供应商终帧';
  }
  if (event.provider_reconciliation_required !== false) {
    return '供应商对账仍未完成';
  }

  const promptTokens = strictNonNegativeInteger(event.prompt_tokens);
  const completionTokens = strictNonNegativeInteger(event.completion_tokens);
  const totalTokens = strictNonNegativeInteger(event.total_tokens);
  const tokenExtras = jsonObject(event.token_extras) ?? {};
  if (
    promptTokens === null || completionTokens === null || totalTokens === null ||
    Object.values(tokenExtras).some((value) => strictNonNegativeInteger(value) === null)
  ) {
    return 'Token 维度不完整';
  }
  if (totalTokens !== promptTokens + completionTokens) return 'total_tokens 不一致';

  const tokenRoots = [event, tokenExtras];
  const cacheReadTokens = firstPositiveInteger(tokenRoots, [
    'cache_hit_tokens',
    'cached_tokens',
    'cached_input_tokens',
    'cache_read_tokens',
    'cache_read_input_tokens',
    'prompt_cache_hit_tokens',
    'cachedContentTokenCount',
    'cached_content_token_count',
  ]);
  const explicitCacheWriteTokens = firstPositiveInteger(tokenRoots, [
    'cache_write_tokens',
    'cache_creation_input_tokens',
    'cache_creation_tokens',
  ]);
  const bucketCacheWriteTokens = [
    'anthropic_ephemeral_5m_input_tokens',
    'anthropic_ephemeral_1h_input_tokens',
    'ephemeral_5m_input_tokens',
    'ephemeral_1h_input_tokens',
  ].reduce(
    (sum, key) => sum + firstPositiveInteger(tokenRoots, [key]),
    0,
  );
  if (cacheReadTokens + (explicitCacheWriteTokens || bucketCacheWriteTokens) > promptTokens) {
    return 'cache Token 超过 prompt_tokens';
  }
  if (!nonEmptyString(event.provider_credential_ref) && !evidence.providerCredentialRef) {
    return '缺少 provider credential 绑定';
  }
  if (
    !nonEmptyString(event.upstream_request_id) &&
    !nonEmptyString(event.upstream_response_id) &&
    !evidence.upstreamRequestId &&
    !evidence.upstreamResponseId
  ) {
    return '缺少上游关联 ID';
  }
  return null;
}

export function settleableGatewayUsageEvidences(
  row: GatewayBillingEventRow,
): GatewayUsageEvidenceRow[] {
  return gatewayUsageEvidences(row).filter(
    (evidence) => gatewayUsageEvidenceSettlementIssue(evidence) === null,
  );
}

export function canStartGatewayBillingEventSettlement(row: GatewayBillingEventRow): boolean {
  return actionRevision(row) !== null
    && row.status === 'QUARANTINED'
    && ['OPEN', 'MANUAL_REVIEW'].includes(row.reconciliationStatus || '');
}

export function canReconcileAndSettleGatewayBillingEvent(
  row: GatewayBillingEventRow,
): boolean {
  return canStartGatewayBillingEventSettlement(row)
    && settleableGatewayUsageEvidences(row).length > 0;
}

export function canStartGatewayBillingEventDeltaAbsorption(
  row: GatewayBillingEventRow,
): boolean {
  return actionRevision(row) !== null
    && ['DEDUCTED', 'DEBT_OPEN'].includes(row.status)
    && row.reconciliationStatus === 'MANUAL_REVIEW'
    && row.evidenceVerdict === 'CONFLICTED';
}

export function gatewayUsageEvidenceDeltaAbsorptionIssue(
  row: GatewayBillingEventRow,
  evidence: GatewayUsageEvidenceRow,
): string | null {
  const settlementIssue = gatewayUsageEvidenceSettlementIssue(evidence);
  if (settlementIssue) return settlementIssue;
  if (!row.evidenceHash) return '缺少原结算 evidence hash';
  if (!evidence.evidenceHash) return '修正证据缺少 evidence hash';
  if (evidence.evidenceHash === row.evidenceHash) return '与原结算 evidence 相同';
  return null;
}

export function deltaAbsorbableGatewayUsageEvidences(
  row: GatewayBillingEventRow,
): GatewayUsageEvidenceRow[] {
  return gatewayUsageEvidences(row).filter(
    (evidence) => gatewayUsageEvidenceDeltaAbsorptionIssue(row, evidence) === null,
  );
}

export function canAbsorbGatewayBillingEventDelta(row: GatewayBillingEventRow): boolean {
  return canStartGatewayBillingEventDeltaAbsorption(row)
    && deltaAbsorbableGatewayUsageEvidences(row).length > 0;
}

export function collectGatewayBillingEventSnapshots(row: GatewayBillingEventRow): unknown {
  const entries = [
    ['settlementSnapshot', row.settlementSnapshot],
    ['pricingSnapshot', row.pricingSnapshot],
    ['entitlementSnapshot', row.entitlementSnapshot],
    ['subjectSnapshot', row.subjectSnapshot],
  ].filter((entry) => entry[1] !== undefined && entry[1] !== null);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

export interface GatewaySettlementAnchorSummary {
  apiKeyId: string | null;
  userId: string | null;
  tenantId: string | null;
  billingAccountId: string | null;
  productId: string | null;
  productSlug: string | null;
  billingUnit: string | null;
  occurredAt: string | null;
  anchorHash: string | null;
}

function stringField(value: Record<string, unknown>, field: string): string | null {
  const candidate = value[field];
  return typeof candidate === 'string' && candidate.trim() ? candidate : null;
}

export function summarizeGatewaySettlementAnchor(value: unknown): GatewaySettlementAnchorSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const anchor = value as Record<string, unknown>;
  return {
    apiKeyId: stringField(anchor, 'apiKeyId'),
    userId: stringField(anchor, 'userId'),
    tenantId: stringField(anchor, 'tenantId'),
    billingAccountId: stringField(anchor, 'billingAccountId'),
    productId: stringField(anchor, 'productId'),
    productSlug: stringField(anchor, 'productSlug'),
    billingUnit: stringField(anchor, 'billingUnit'),
    occurredAt: stringField(anchor, 'occurredAt'),
    anchorHash: stringField(anchor, 'anchorHash'),
  };
}

function createActionIdempotencyKey(action: GatewayBillingEventAction, requestId: string): string {
  const randomId = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `admin:gateway-billing:${action}:${requestId}:${randomId}`;
}

function errorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { message?: unknown } } }).response;
    if (typeof response?.data?.message === 'string' && response.data.message.trim()) {
      return response.data.message;
    }
  }
  return error instanceof Error && error.message ? error.message : '操作失败';
}

function JsonBlock({ value }: { value: unknown }) {
  if (value == null) return <span>—</span>;
  return (
    <pre
      style={{
        margin: 0,
        padding: 12,
        borderRadius: 6,
        background: '#0f172a',
        color: '#e2e8f0',
        maxHeight: 360,
        overflow: 'auto',
        fontSize: 12,
      }}
    >
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function StateTag({ value, colors }: { value?: string | null; colors: Record<string, string> }) {
  return value ? <Tag color={colors[value] || 'default'}>{value}</Tag> : <Text type="secondary">—</Text>;
}

function SettlementAnchorBlock({ value }: { value: unknown }) {
  const summary = summarizeGatewaySettlementAnchor(value);
  if (value == null) return <div>—</div>;

  return (
    <Space direction="vertical" size={8} style={{ width: '100%' }}>
      {summary ? (
        <>
          <div>
            <Text type="secondary">计费主体：</Text>
            <Text code>{summary.billingAccountId || '—'}</Text>
            {' / tenant '}
            <Text code>{summary.tenantId || '—'}</Text>
            {' / user '}
            <Text code>{summary.userId || '—'}</Text>
            {' / key '}
            <Text code>{summary.apiKeyId || '—'}</Text>
          </div>
          <div>
            <Text type="secondary">产品 / 计费单位：</Text>
            <Text code>{summary.productSlug || summary.productId || '—'}</Text>
            {' / '}
            <Tag>{summary.billingUnit || '—'}</Tag>
          </div>
          <div>
            <Text type="secondary">发生时间：</Text>
            {summary.occurredAt ? formatTime(summary.occurredAt) : '—'}
          </div>
          <div>
            <Text type="secondary">Anchor Hash：</Text>
            <Text code copyable={!!summary.anchorHash}>{summary.anchorHash || '—'}</Text>
          </div>
        </>
      ) : (
        <Text type="warning">Anchor 结构无法识别，请查看原始 JSON。</Text>
      )}
      <Collapse
        size="small"
        items={[{
          key: 'settlement-anchor-json',
          label: '查看不可变 Anchor 快照 JSON',
          children: <JsonBlock value={value} />,
        }]}
      />
    </Space>
  );
}

export default function GatewayBillingEventsPage() {
  const { message } = App.useApp();
  const canRetry = usePermission('admin.page.gateway_billing_events.retry');
  const canReview = usePermission('admin.page.gateway_billing_events.review');
  const canSettle = usePermission('admin.page.gateway_billing_events.settle');
  const canAbsorb = usePermission('admin.page.gateway_billing_events.absorb');
  const [form] = Form.useForm<GatewayBillingEventFilters>();
  const [filters, setFilters] = useState<GatewayBillingEventFilters>({});
  const [active, setActive] = useState<GatewayBillingEventRow | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const detailRequestRef = useRef(0);
  const [actionTarget, setActionTarget] = useState<ActionTarget | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [selectedEvidenceId, setSelectedEvidenceId] = useState('');
  const [settlementLoadingRequestId, setSettlementLoadingRequestId] = useState<string | null>(null);
  const [deltaAbsorptionLoadingRequestId, setDeltaAbsorptionLoadingRequestId] = useState<string | null>(null);
  const [actionSubmitting, setActionSubmitting] = useState(false);

  const fetchEvents = useCallback(
    ({ page, pageSize }: { page: number; pageSize: number }) =>
      gatewayBillingEventApi.list({
        page,
        pageSize,
        ...filters,
      }),
    [filters],
  );

  const events = usePaginatedList<GatewayBillingEventRow>({
    fetcher: fetchEvents,
    deps: [filters],
  });
  const reloadEvents = events.reload;

  const applyFilters = useCallback(() => {
    setFilters(cleanFilters(form.getFieldsValue()));
  }, [form]);

  const resetFilters = useCallback(() => {
    form.resetFields();
    setFilters({});
  }, [form]);

  const openDetails = useCallback(async (row: GatewayBillingEventRow) => {
    const requestNumber = detailRequestRef.current + 1;
    detailRequestRef.current = requestNumber;
    setActive(row);
    setDetailLoading(true);
    try {
      const detail = await gatewayBillingEventApi.get(row.requestId);
      if (detailRequestRef.current === requestNumber) setActive(detail);
    } catch (error) {
      if (detailRequestRef.current === requestNumber) {
        message.error(`事件详情加载失败：${errorMessage(error)}`);
      }
    } finally {
      if (detailRequestRef.current === requestNumber) setDetailLoading(false);
    }
  }, [message]);

  const closeDetails = useCallback(() => {
    detailRequestRef.current += 1;
    setDetailLoading(false);
    setActive(null);
  }, []);

  const openAction = useCallback((action: GatewayBillingEventAction, row: GatewayBillingEventRow) => {
    setActionReason('');
    setSelectedEvidenceId('');
    setActionTarget({
      action,
      row,
      idempotencyKey: createActionIdempotencyKey(action, row.requestId),
    });
  }, []);

  const openSettlement = useCallback(async (row: GatewayBillingEventRow) => {
    if (!canStartGatewayBillingEventSettlement(row)) {
      message.warning('仅 QUARANTINED + OPEN/MANUAL_REVIEW 且带有效 revision 的事件可结算');
      return;
    }
    setSettlementLoadingRequestId(row.requestId);
    try {
      const detail = await gatewayBillingEventApi.get(row.requestId);
      if (!canStartGatewayBillingEventSettlement(detail)) {
        message.error('事件状态或 revision 已变化，请刷新后重试');
        reloadEvents();
        return;
      }
      setActionReason('');
      setSelectedEvidenceId('');
      setActionTarget({
        action: 'reconcileSettle',
        row: detail,
        idempotencyKey: createActionIdempotencyKey('reconcileSettle', detail.requestId),
      });
    } catch (error) {
      message.error(`证据详情加载失败：${errorMessage(error)}`);
    } finally {
      setSettlementLoadingRequestId(null);
    }
  }, [message, reloadEvents]);

  const openDeltaAbsorption = useCallback(async (row: GatewayBillingEventRow) => {
    if (!canStartGatewayBillingEventDeltaAbsorption(row)) {
      message.warning('仅 DEDUCTED/DEBT_OPEN + MANUAL_REVIEW + CONFLICTED 且带有效 revision 的事件可吸收少计差额');
      return;
    }
    setDeltaAbsorptionLoadingRequestId(row.requestId);
    try {
      const detail = await gatewayBillingEventApi.get(row.requestId);
      if (!canStartGatewayBillingEventDeltaAbsorption(detail)) {
        message.error('事件状态、证据结论或 revision 已变化，请刷新后重试');
        reloadEvents();
        return;
      }
      setActionReason('');
      setSelectedEvidenceId('');
      setActionTarget({
        action: 'absorbDelta',
        row: detail,
        idempotencyKey: createActionIdempotencyKey('absorbDelta', detail.requestId),
      });
    } catch (error) {
      message.error(`证据详情加载失败：${errorMessage(error)}`);
    } finally {
      setDeltaAbsorptionLoadingRequestId(null);
    }
  }, [message, reloadEvents]);

  const closeAction = useCallback(() => {
    if (actionSubmitting) return;
    setActionTarget(null);
    setActionReason('');
    setSelectedEvidenceId('');
  }, [actionSubmitting]);

  const submitAction = useCallback(async () => {
    if (!actionTarget) return;
    const reason = actionReason.trim();
    if (!reason || reason.length > 500) {
      message.warning('请填写 1 到 500 个字符的操作原因');
      return;
    }
    const expectedRevision = actionRevision(actionTarget.row);
    if (expectedRevision === null) {
      message.error('事件缺少有效 revision，请刷新后重试');
      return;
    }
    const body: GatewayBillingEventActionInput = {
      expectedRevision,
      reason,
      idempotencyKey: actionTarget.idempotencyKey,
    };
    const selectableEvidences = actionTarget.action === 'reconcileSettle'
      ? settleableGatewayUsageEvidences(actionTarget.row)
      : actionTarget.action === 'absorbDelta'
        ? deltaAbsorbableGatewayUsageEvidences(actionTarget.row)
        : [];
    const selectedEvidence = selectableEvidences.find(
      (evidence) => evidence.id === selectedEvidenceId,
    );
    if (actionTarget.action === 'reconcileSettle' && (
      !canReconcileAndSettleGatewayBillingEvent(actionTarget.row) || !selectedEvidence
    )) {
      message.error('请选择当前事件中一条通过完整性硬闸的权威证据');
      return;
    }
    if (actionTarget.action === 'absorbDelta' && (
      !canAbsorbGatewayBillingEventDelta(actionTarget.row) || !selectedEvidence
    )) {
      message.error('请选择一条通过完整性硬闸、且不同于原结算 evidence 的权威证据');
      return;
    }
    setActionSubmitting(true);
    try {
      if (actionTarget.action === 'retry') {
        await gatewayBillingEventApi.retry(actionTarget.row.requestId, body);
      } else if (actionTarget.action === 'manualReview') {
        await gatewayBillingEventApi.manualReview(actionTarget.row.requestId, body);
      } else if (actionTarget.action === 'reconcileSettle') {
        await gatewayBillingEventApi.reconcileSettle(actionTarget.row.requestId, {
          evidenceId: selectedEvidence!.id,
          ...body,
        });
      } else if (actionTarget.action === 'absorbDelta') {
        await gatewayBillingEventApi.absorbDelta(actionTarget.row.requestId, {
          evidenceId: selectedEvidence!.id,
          ...body,
        });
      } else {
        await gatewayBillingEventApi.absorb(actionTarget.row.requestId, body);
      }
      message.success(actionCopy[actionTarget.action].success);
      setActionTarget(null);
      setActionReason('');
      setSelectedEvidenceId('');
      setActive(null);
      reloadEvents();
    } catch (error) {
      message.error(errorMessage(error));
    } finally {
      setActionSubmitting(false);
    }
  }, [actionReason, actionTarget, message, reloadEvents, selectedEvidenceId]);

  const columns = useMemo<ColumnsType<GatewayBillingEventRow>>(() => [
    {
      title: '入账状态',
      dataIndex: 'status',
      width: 110,
      render: (value: string) => <Tag color={statusColors[value] || 'default'}>{value}</Tag>,
    },
    {
      title: '证据结论',
      dataIndex: 'evidenceVerdict',
      width: 130,
      render: (value?: string | null) => <StateTag value={value} colors={evidenceColors} />,
    },
    {
      title: '对账状态',
      key: 'reconciliation',
      width: 155,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <StateTag value={row.reconciliationStatus} colors={reconciliationColors} />
          <Text type="secondary">revision {row.revision ?? '—'}</Text>
        </Space>
      ),
    },
    {
      title: '资金结果',
      dataIndex: 'fundingOutcome',
      width: 125,
      render: (value?: string | null) => <StateTag value={value} colors={fundingColors} />,
    },
    {
      title: 'Request ID',
      dataIndex: 'requestId',
      width: 230,
      render: (value: string) => <Text code copyable>{value}</Text>,
    },
    {
      title: 'Tenant / Key / 用户',
      key: 'identity',
      width: 240,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <Text code>{row.tenantId || '—'}</Text>
          <Text code>{row.apiKeyId || '—'}</Text>
          <Text type="secondary">{row.userId || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '产品 / 模型',
      key: 'productModel',
      width: 220,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.productSlug || row.productId || '—'}</span>
          <Text type="secondary">{row.modelName || '—'}</Text>
        </Space>
      ),
    },
    {
      title: 'Token',
      key: 'tokens',
      width: 190,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>{row.totalTokens.toLocaleString()} total</span>
          <Text type="secondary">
            in {row.inputTokens.toLocaleString()} / out {row.outputTokens.toLocaleString()}
          </Text>
          <Text type="secondary">来源 {row.tokenSource || row.source || '—'}</Text>
        </Space>
      ),
    },
    {
      title: '原因',
      dataIndex: 'reason',
      ellipsis: true,
      width: 180,
      render: (value: string | null | undefined, row) => value || row.errorMessage || '—',
    },
    {
      title: '处理时间',
      key: 'times',
      width: 180,
      render: (_, row) => (
        <Space direction="vertical" size={0}>
          <span>发生 {formatTime(row.occurredAt)}</span>
          <Text type="secondary">处理 {formatTime(row.processedAt)}</Text>
        </Space>
      ),
    },
    {
      title: '操作',
      key: 'actions',
      fixed: 'right',
      width: 560,
      render: (_, row) => (
        <Space wrap>
          <Button size="small" onClick={() => void openDetails(row)}>详情</Button>
          {canRetry && (
            <Button
              size="small"
              disabled={!canRetryGatewayBillingEvent(row)}
              title={canRetryGatewayBillingEvent(row) ? undefined : '仅 RETRY_WAIT 且带有效 revision 的事件可重试'}
              onClick={() => openAction('retry', row)}
            >
              技术重试
            </Button>
          )}
          {canReview && (
            <Button
              size="small"
              disabled={!canMarkGatewayBillingEventManualReview(row)}
              title={canMarkGatewayBillingEventManualReview(row) ? undefined : '当前状态不可进入人工复核'}
              onClick={() => openAction('manualReview', row)}
            >
              人工复核
            </Button>
          )}
          {canSettle && (
            <Button
              size="small"
              danger
              loading={settlementLoadingRequestId === row.requestId}
              disabled={!canStartGatewayBillingEventSettlement(row)}
              title={canStartGatewayBillingEventSettlement(row)
                ? '将先加载详情并选择权威证据'
                : '仅 QUARANTINED + OPEN/MANUAL_REVIEW 且带有效 revision 的事件可结算'}
              onClick={() => void openSettlement(row)}
            >
              证据结算
            </Button>
          )}
          {canAbsorb && (
            <>
              <Button
                size="small"
                danger
                disabled={!canAbsorbGatewayBillingEvent(row)}
                title={canAbsorbGatewayBillingEvent(row) ? undefined : '仅无资金结果的 QUARANTINED + MANUAL_REVIEW 事件可由平台吸收'}
                onClick={() => openAction('absorb', row)}
              >
                待结算吸收
              </Button>
              <Button
                size="small"
                danger
                loading={deltaAbsorptionLoadingRequestId === row.requestId}
                disabled={!canStartGatewayBillingEventDeltaAbsorption(row)}
                title={canStartGatewayBillingEventDeltaAbsorption(row)
                  ? '将先加载详情并选择不同于原结算 evidence 的权威证据'
                  : '仅 DEDUCTED/DEBT_OPEN + MANUAL_REVIEW + CONFLICTED 且带有效 revision 的事件可吸收差额'}
                onClick={() => void openDeltaAbsorption(row)}
              >
                吸收少计差额
              </Button>
            </>
          )}
        </Space>
      ),
    },
  ], [
    canAbsorb,
    canRetry,
    canReview,
    canSettle,
    deltaAbsorptionLoadingRequestId,
    openAction,
    openDeltaAbsorption,
    openDetails,
    openSettlement,
    settlementLoadingRequestId,
  ]);

  const snapshots = active ? collectGatewayBillingEventSnapshots(active) : null;
  const fundingCurrency = active ? gatewayBillingEventFundingCurrency(active) : null;
  const currentActionCopy = actionTarget ? actionCopy[actionTarget.action] : null;
  const requiresAuthoritativeEvidence = actionTarget?.action === 'reconcileSettle'
    || actionTarget?.action === 'absorbDelta';
  const authoritativeEvidenceOptions = requiresAuthoritativeEvidence && actionTarget
    ? gatewayUsageEvidences(actionTarget.row).map((evidence) => {
        const issue = actionTarget.action === 'absorbDelta'
          ? gatewayUsageEvidenceDeltaAbsorptionIssue(actionTarget.row, evidence)
          : gatewayUsageEvidenceSettlementIssue(evidence);
        const labelParts = [
          evidence.evidenceRevision == null ? null : `rev ${evidence.evidenceRevision}`,
          evidence.tokenSource || 'unknown source',
          evidence.usageEvidenceStatus || null,
          evidence.id,
        ].filter(Boolean);
        return {
          value: evidence.id,
          label: issue ? `${labelParts.join(' · ')} — ${issue}` : labelParts.join(' · '),
          disabled: !!issue,
        };
      })
    : [];
  const authoritativeEvidenceSelected = actionTarget?.action === 'reconcileSettle'
    ? settleableGatewayUsageEvidences(actionTarget.row).some(
        (evidence) => evidence.id === selectedEvidenceId,
      )
    : actionTarget?.action === 'absorbDelta'
      ? deltaAbsorbableGatewayUsageEvidences(actionTarget.row).some(
          (evidence) => evidence.id === selectedEvidenceId,
        )
      : false;

  return (
    <div>
      <h2 style={{ marginBottom: 8, fontSize: 20, fontWeight: 600 }}>Gateway 入账事件</h2>
      <div style={{ marginBottom: 16, color: 'var(--text-muted)', fontSize: 13 }}>
        按证据、对账和资金三个维度追踪事件。待结算吸收与已结算差额吸收是独立动作；差额吸收不会补扣客户，也不会修改原账单或原回执。
      </div>

      <Form
        form={form}
        layout="inline"
        style={{ marginBottom: 16, rowGap: 8 }}
        onFinish={applyFilters}
      >
        <Form.Item name="status">
          <Select
            allowClear
            placeholder="入账状态"
            style={{ width: 145 }}
            options={['RECEIVED', 'QUARANTINED', 'RETRYABLE_FAILED', 'DEDUCTED', 'DEBT_OPEN', 'ABSORBED', 'FAILED', 'SKIPPED']
              .map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item name="evidenceVerdict">
          <Select
            allowClear
            placeholder="证据结论"
            style={{ width: 145 }}
            options={['UNKNOWN', 'INCOMPLETE', 'SETTLEABLE_BY_POLICY', 'CONFLICTED', 'VERIFIED_PROVIDER_CORRECTION']
              .map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item name="reconciliationStatus">
          <Select
            allowClear
            placeholder="对账状态"
            style={{ width: 165 }}
            options={['OPEN', 'EVIDENCE_PENDING', 'NOT_READY', 'READY', 'PROCESSING', 'RETRY_WAIT', 'MANUAL_REVIEW', 'CLOSED']
              .map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item name="fundingOutcome">
          <Select
            allowClear
            placeholder="资金结果"
            style={{ width: 145 }}
            options={['COLLECTED', 'RECEIVABLE', 'DEBT_OPEN', 'INCLUDED', 'ABSORBED'].map((value) => ({ value, label: value }))}
          />
        </Form.Item>
        <Form.Item name="requestId"><Input placeholder="Request ID" allowClear /></Form.Item>
        <Form.Item name="apiKeyId"><Input placeholder="API Key ID" allowClear /></Form.Item>
        <Form.Item name="tenantId"><Input placeholder="Tenant ID" allowClear /></Form.Item>
        <Form.Item name="userId"><Input placeholder="User ID" allowClear /></Form.Item>
        <Form.Item name="modelName"><Input placeholder="模型名" allowClear /></Form.Item>
        <Form.Item>
          <Space>
            <Button type="primary" htmlType="submit">查询</Button>
            <Button onClick={resetFilters}>重置</Button>
          </Space>
        </Form.Item>
      </Form>

      <DataTable<GatewayBillingEventRow>
        columns={columns}
        dataSource={events.items}
        rowKey="id"
        loading={events.loading}
        scroll={{ x: 2200 }}
        listPagination={events.tablePagination}
      />

      <Drawer
        title="Gateway 入账事件详情"
        width="min(1180px, 96vw)"
        open={!!active}
        onClose={closeDetails}
      >
        {active && (
          <Spin spinning={detailLoading}>
            <Space direction="vertical" size={18} style={{ width: '100%' }}>
            <div>
              <Text type="secondary">Request ID / 上游 Request ID</Text>
              <div><Text code copyable>{active.requestId}</Text></div>
              <div><Text code copyable={!!active.upstreamRequestId}>{active.upstreamRequestId || '—'}</Text></div>
            </div>
            <div>
              <Text type="secondary">证据 / 对账 / 资金</Text>
              <div>
                <Space wrap>
                  <StateTag value={active.evidenceVerdict} colors={evidenceColors} />
                  <StateTag value={active.reconciliationStatus} colors={reconciliationColors} />
                  <StateTag value={active.fundingOutcome} colors={fundingColors} />
                  <Tag>revision {active.revision ?? '—'}</Tag>
                </Space>
              </div>
            </div>
            <div>
              <Text type="secondary">计费账户 / Tenant / Key / 用户</Text>
              <div><Text code>{active.billingAccountId || '—'}</Text></div>
              <div>
                <Text code>{active.tenantId || '—'}</Text>
                {' / '}
                <Text code>{active.apiKeyId || '—'}</Text>
                {' / '}
                {active.userId || '—'}
              </div>
              <div>发生 {formatTime(active.occurredAt)} / 接收 {formatTime(active.receivedAt)}</div>
            </div>
            <div>
              <Text type="secondary">首收资金预占（财务只读详情）</Text>
              <GatewayFundingReservationDetails
                reservation={active.fundingReservation}
                currency={fundingCurrency}
              />
            </div>
            <div>
              <Text type="secondary">客户资金拆分（财务只读详情）</Text>
              <GatewayFundingSplitDetails
                tokenUsage={active.tokenUsage}
                currency={fundingCurrency}
              />
            </div>
            <div>
              <Text type="secondary">Token 来源 / 待结算敞口 / 额度占用</Text>
              <div>
                {active.tokenSource || active.source || '—'}
                {' / '}
                {active.pendingExposureAmount ?? active.pendingExposureUsd ?? '—'}
                {' / '}
                {active.pendingHoldAmount ?? active.pendingHoldUsd ?? '—'}
              </div>
            </div>
            <div>
              <Text type="secondary">失败/跳过原因</Text>
              <div>{active.reason || active.errorMessage || '—'}</div>
            </div>
            <div>
              <Text type="secondary">不可变证据</Text>
              <JsonBlock value={active.evidence ?? active.usageEvidences} />
            </div>
            <div>
              <Text type="secondary">逐请求平台损失（财务只读详情）</Text>
              <GatewayPlatformLossDetails
                entries={active.platformLossEntries}
                currency={fundingCurrency}
              />
            </div>
            <div>
              <Text type="secondary">Settlement Anchor（只读）</Text>
              <SettlementAnchorBlock value={active.settlementAnchor} />
            </div>
            <div>
              <Text type="secondary">Settlement receipts</Text>
              <JsonBlock value={active.settlementReceipts} />
            </div>
            <div>
              <Text type="secondary">对账操作记录</Text>
              <JsonBlock value={active.reconciliationActions} />
            </div>
            <div>
              <Text type="secondary">账户访问限制（只读）</Text>
              <JsonBlock value={active.accessRestrictions} />
            </div>
            <div>
              <Text type="secondary">发生时快照</Text>
              <JsonBlock value={snapshots} />
            </div>
            <div>
              <Text type="secondary">扣费结果</Text>
              <JsonBlock value={active.billingResult} />
            </div>
            <div>
              <Text type="secondary">原始 Gateway 事件</Text>
              <JsonBlock value={active.rawEvent} />
            </div>
            </Space>
          </Spin>
        )}
      </Drawer>

      <Modal
        title={currentActionCopy?.title}
        open={!!actionTarget}
        okText={currentActionCopy?.okText}
        cancelText="取消"
        confirmLoading={actionSubmitting}
        okButtonProps={{
          danger: actionTarget?.action === 'absorb'
            || actionTarget?.action === 'reconcileSettle'
            || actionTarget?.action === 'absorbDelta',
          disabled:
            !actionReason.trim() ||
            actionReason.trim().length > 500 ||
            (requiresAuthoritativeEvidence && !authoritativeEvidenceSelected),
        }}
        onOk={() => void submitAction()}
        onCancel={closeAction}
        destroyOnClose
      >
        {actionTarget && currentActionCopy && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Typography.Paragraph>{currentActionCopy.description}</Typography.Paragraph>
            {actionTarget.action === 'reconcileSettle' && (
              <Alert
                type="error"
                showIcon
                message="该操作会产生资金影响"
                description="Billing 可能扣减客户余额/积分、记录企业应收或触发账户限制。这不是历史差额吸收；请确认所选证据和当前 revision。"
              />
            )}
            {actionTarget.action === 'absorbDelta' && (
              <Alert
                type="error"
                showIcon
                message="该操作会记录平台财务损失"
                description="客户补扣恒为 0；按冻结费率记录客户少计差额、供应商成本差额和平台损失，原账单/原回执不修改。"
              />
            )}
            <div>
              <Text type="secondary">Request ID</Text>
              <div><Text code copyable>{actionTarget.row.requestId}</Text></div>
            </div>
            <div>
              <Text type="secondary">Expected revision / 幂等键</Text>
              <div>{actionTarget.row.revision ?? '—'}</div>
              <div><Text code copyable>{actionTarget.idempotencyKey}</Text></div>
            </div>
            {requiresAuthoritativeEvidence && (
              <div>
                <Text type="secondary">
                  {actionTarget.action === 'absorbDelta'
                    ? '独立修正权威证据（必选）'
                    : '权威证据（必选）'}
                </Text>
                <Select
                  style={{ width: '100%', marginTop: 6 }}
                  placeholder={actionTarget.action === 'absorbDelta'
                    ? '选择不同于原结算 evidence 的权威 evidenceId'
                    : '选择通过完整性硬闸的 evidenceId'}
                  value={selectedEvidenceId || undefined}
                  options={authoritativeEvidenceOptions}
                  onChange={setSelectedEvidenceId}
                  notFoundContent={actionTarget.action === 'absorbDelta'
                    ? '该事件没有独立且可用于差额估值的权威证据'
                    : '该事件没有可结算的权威证据'}
                />
              </div>
            )}
            <div>
              <Text type="secondary">操作原因（必填，将永久留痕）</Text>
              <Input.TextArea
                rows={4}
                maxLength={500}
                showCount
                value={actionReason}
                placeholder="请填写工单号、证据判断或吸收政策编号"
                onChange={(event) => setActionReason(event.target.value)}
              />
            </div>
          </Space>
        )}
      </Modal>
    </div>
  );
}
