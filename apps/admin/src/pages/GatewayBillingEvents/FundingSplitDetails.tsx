import { Alert, Descriptions, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import type {
  GatewayBillingEventRow,
  GatewayFundingAllocationRow,
  GatewayFundingReservationRow,
  GatewayFundingSettlementRow,
  GatewayTokenUsageFundingRow,
} from '../../api/admin';
import { formatExactDecimal } from '../FinanceReports/formatters';

const { Text } = Typography;

interface ExactDecimal {
  units: bigint;
  scale: number;
}

export interface GatewayFundingAllocationSummary {
  key: string;
  source: string | null;
  amount: string | null;
  approvedReceivable: string | null;
  unapprovedDebt: string | null;
  settled: string | null;
  outstanding: string | null;
  classificationComplete: boolean | null;
  creditPolicyAt: string | null;
  creditTermsDays: number | null;
  creditDueAt: string | null;
  creditPolicySnapshotComplete: boolean | null;
  ledgerSequence: string | null;
  settledAt: string | null;
  settlements: GatewayFundingSettlementRow[];
  settlementEvidenceTotal: string | null;
  settlementEvidenceMatches: boolean | null;
}

export interface GatewayFundingSplitSummary {
  chargePolicy: string | null;
  gross: string | null;
  collected: string | null;
  approvedReceivable: string | null;
  unapprovedDebt: string | null;
  settled: string | null;
  outstanding: string | null;
  classificationComplete: boolean | null;
  allocations: GatewayFundingAllocationSummary[];
  issues: string[];
}

export interface GatewayFundingReservationSummary {
  id: string | null;
  requestId: string | null;
  billingAccountId: string | null;
  tenantId: string | null;
  userId: string | null;
  apiKeyId: string | null;
  billingUnit: string | null;
  occurredAt: string | null;
  firstReceivedAt: string | null;
  reservationSequence: string | null;
  reserved: string | null;
  collected: string | null;
  approvedCredit: string | null;
  unapprovedDebt: string | null;
  policyAt: string | null;
  policyRevision: number | null;
  policySource: string | null;
  policyReconstructible: boolean | null;
  creditLimit: string | null;
  termsDays: number | null;
  dueAt: string | null;
  creditStatus: string | null;
  creditEffectiveAt: string | null;
  creditExpiresAt: string | null;
  anchorHash: string | null;
  reservationHash: string | null;
  status: string | null;
  reviewReason: string | null;
  authoritativeAmount: string | null;
  consumedAt: string | null;
  releasedAt: string | null;
  releaseReason: string | null;
  createdAt: string | null;
}

function firstDefined(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function parseExactDecimal(value: unknown): ExactDecimal | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const raw = String(value).trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(raw);
  if (!match) return null;
  const fraction = match[3] ?? '';
  const units = BigInt(`${match[1]}${match[2]}${fraction}`);
  return { units, scale: fraction.length };
}

function tenTo(power: number): bigint {
  return BigInt(10) ** BigInt(power);
}

function formatParsedDecimal(value: ExactDecimal): string {
  const negative = value.units < BigInt(0);
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  const integer = value.scale ? digits.slice(0, -value.scale) : digits;
  const fraction = value.scale ? digits.slice(-value.scale).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function exactSum(values: Array<string | null>): string | null {
  if (values.some((value) => value === null)) return null;
  const parsed = values.map((value) => parseExactDecimal(value));
  if (parsed.some((value) => value === null)) return null;
  const decimals = parsed as ExactDecimal[];
  const scale = decimals.reduce((maximum, value) => Math.max(maximum, value.scale), 0);
  const units = decimals.reduce(
    (sum, value) => sum + value.units * tenTo(scale - value.scale),
    BigInt(0),
  );
  return formatParsedDecimal({ units, scale });
}

function exactSubtract(left: string | null, right: string | null): string | null {
  if (left === null || right === null) return null;
  const parsedLeft = parseExactDecimal(left);
  const parsedRight = parseExactDecimal(right);
  if (!parsedLeft || !parsedRight) return null;
  const scale = Math.max(parsedLeft.scale, parsedRight.scale);
  return formatParsedDecimal({
    units: parsedLeft.units * tenTo(scale - parsedLeft.scale)
      - parsedRight.units * tenTo(scale - parsedRight.scale),
    scale,
  });
}

function normalizedMoney(...values: unknown[]): string | null {
  const parsed = parseExactDecimal(firstDefined(...values));
  return parsed ? formatParsedDecimal(parsed) : null;
}

function exactEqual(left: string, right: string): boolean {
  return exactSubtract(left, right) === '0';
}

function isNegative(value: string | null): boolean {
  return value?.startsWith('-') ?? false;
}

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function optionalTermsDays(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function optionalRevision(...values: unknown[]): number | null {
  const value = firstDefined(...values);
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function ledgerSequence(value: unknown): string | null {
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return value.trim();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  return null;
}

function settlementAmount(row: GatewayFundingSettlementRow): string | null {
  return normalizedMoney(row.amount, row.amountUsd);
}

function summarizeAllocation(
  row: GatewayFundingAllocationRow,
  index: number,
): GatewayFundingAllocationSummary {
  const approvedReceivable = normalizedMoney(row.approvedCreditAmount, row.approvedCreditUsd);
  const unapprovedDebt = normalizedMoney(row.unapprovedDebtAmount, row.unapprovedDebtUsd);
  const settled = normalizedMoney(row.settledAmount, row.settledUsd);
  const classifiedDebt = exactSum([approvedReceivable, unapprovedDebt]);
  const settlements = Array.isArray(row.settlements) ? row.settlements : [];
  const settlementEvidenceTotal = Array.isArray(row.settlements)
    ? exactSum(settlements.map(settlementAmount))
    : null;

  return {
    key: optionalString(row.id) ?? `allocation-${index + 1}`,
    source: optionalString(row.source),
    amount: normalizedMoney(row.amount, row.amountUsd),
    approvedReceivable,
    unapprovedDebt,
    settled,
    outstanding: exactSubtract(classifiedDebt, settled),
    classificationComplete: optionalBoolean(row.fundingClassificationComplete),
    creditPolicyAt: optionalString(row.creditPolicyAt),
    creditTermsDays: optionalTermsDays(row.creditTermsDays),
    creditDueAt: optionalString(row.creditDueAt),
    creditPolicySnapshotComplete: optionalBoolean(row.creditPolicySnapshotComplete),
    ledgerSequence: ledgerSequence(row.ledgerSequence),
    settledAt: optionalString(row.settledAt),
    settlements,
    settlementEvidenceTotal,
    settlementEvidenceMatches: settled !== null && settlementEvidenceTotal !== null
      ? exactEqual(settled, settlementEvidenceTotal)
      : null,
  };
}

export function summarizeGatewayFundingSplit(
  tokenUsage: GatewayTokenUsageFundingRow | null | undefined,
): GatewayFundingSplitSummary | null {
  if (!tokenUsage) return null;
  const allocationRows = Array.isArray(tokenUsage.consumptionAllocations)
    ? tokenUsage.consumptionAllocations
    : [];
  const allocations = allocationRows.map(summarizeAllocation);
  const gross = normalizedMoney(tokenUsage.customerChargeAmount, tokenUsage.customerChargeUsd);
  const collected = normalizedMoney(
    tokenUsage.customerCollectedAmount,
    tokenUsage.customerCollectedUsd,
  );
  const approvedReceivable = normalizedMoney(
    tokenUsage.customerApprovedReceivableAmount,
    tokenUsage.customerApprovedReceivableUsd,
  );
  const unapprovedDebt = normalizedMoney(
    tokenUsage.customerUnapprovedDebtAmount,
    tokenUsage.customerUnapprovedDebtUsd,
  );
  const settled = Array.isArray(tokenUsage.consumptionAllocations)
    ? exactSum(allocations.map((allocation) => allocation.settled))
    : null;
  const classifiedDebt = exactSum([approvedReceivable, unapprovedDebt]);
  const outstanding = exactSubtract(classifiedDebt, settled);
  const classificationComplete = optionalBoolean(
    tokenUsage.customerFundingClassificationComplete,
  );
  const issues: string[] = [];

  if (classificationComplete !== true) {
    issues.push('TokenUsage 客户资金分类未标记为完整，不能把缺失历史字段解释为 0');
  }
  allocations.forEach((allocation, index) => {
    const label = allocation.source ?? `allocation ${index + 1}`;
    if (allocation.classificationComplete !== true) {
      issues.push(`${label} 的 funding classification 不完整`);
    }
    if (allocation.source === 'ENTERPRISE_CREDIT' && allocation.creditPolicySnapshotComplete !== true) {
      issues.push(`${label} 缺少完整的发生时信用政策快照`);
    }
    if (allocation.settlementEvidenceMatches === false) {
      issues.push(`${label} 的 settledAmount 与 settlements 回执合计不一致`);
    }
    if (isNegative(allocation.outstanding)) {
      issues.push(`${label} 的已核销金额超过已分类应收/欠款`);
    }
  });
  if (isNegative(outstanding)) {
    issues.push('TokenUsage 汇总的已核销金额超过已审批应收与未审批欠款之和');
  }

  return {
    chargePolicy: optionalString(tokenUsage.customerChargePolicy),
    gross,
    collected,
    approvedReceivable,
    unapprovedDebt,
    settled,
    outstanding,
    classificationComplete,
    allocations,
    issues,
  };
}

export function summarizeGatewayFundingReservation(
  reservation: GatewayFundingReservationRow | null | undefined,
): GatewayFundingReservationSummary | null {
  if (!reservation) return null;
  return {
    id: optionalString(reservation.id),
    requestId: optionalString(reservation.requestId),
    billingAccountId: optionalString(reservation.billingAccountId),
    tenantId: optionalString(reservation.tenantId),
    userId: optionalString(reservation.userId),
    apiKeyId: optionalString(reservation.apiKeyId),
    billingUnit: optionalString(reservation.billingUnit),
    occurredAt: optionalString(reservation.occurredAt),
    firstReceivedAt: optionalString(reservation.firstReceivedAt),
    reservationSequence: ledgerSequence(reservation.reservationSequence),
    reserved: normalizedMoney(reservation.reservedAmount, reservation.reservedAmountUsd),
    collected: normalizedMoney(reservation.collectedAmount, reservation.collectedUsd),
    approvedCredit: normalizedMoney(
      reservation.approvedCreditAmount,
      reservation.approvedCreditUsd,
    ),
    unapprovedDebt: normalizedMoney(
      reservation.unapprovedDebtAmount,
      reservation.unapprovedDebtUsd,
    ),
    policyAt: optionalString(firstDefined(reservation.policyAt, reservation.creditPolicyAt)),
    policyRevision: optionalRevision(reservation.revision, reservation.creditPolicyRevision),
    policySource: optionalString(firstDefined(reservation.source, reservation.creditPolicySource)),
    policyReconstructible: optionalBoolean(firstDefined(
      reservation.reconstructible,
      reservation.creditPolicyReconstructible,
    )),
    creditLimit: normalizedMoney(reservation.limit, reservation.creditLimitUsd),
    termsDays: optionalTermsDays(firstDefined(reservation.terms, reservation.creditTermsDays)),
    dueAt: optionalString(firstDefined(
      reservation.approvedCreditDueAt,
      reservation.due,
      reservation.creditDueAt,
    )),
    creditStatus: optionalString(reservation.creditStatus),
    creditEffectiveAt: optionalString(firstDefined(
      reservation.effective,
      reservation.creditEffectiveAt,
    )),
    creditExpiresAt: optionalString(firstDefined(
      reservation.expires,
      reservation.creditExpiresAt,
    )),
    anchorHash: optionalString(reservation.anchorHash),
    reservationHash: optionalString(reservation.reservationHash),
    status: optionalString(reservation.status),
    reviewReason: optionalString(reservation.reviewReason),
    authoritativeAmount: normalizedMoney(
      reservation.authoritativeAmount,
      reservation.authoritativeAmountUsd,
    ),
    consumedAt: optionalString(reservation.consumedAt),
    releasedAt: optionalString(reservation.releasedAt),
    releaseReason: optionalString(reservation.releaseReason),
    createdAt: optionalString(reservation.createdAt),
  };
}

function formatMoney(value: string | null, currency?: string | null): string {
  const amount = formatExactDecimal(value);
  return amount === '—' ? amount : `${currency ?? '平台币种'} ${amount}`;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function explicitCurrency(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const currency = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : null;
}

function currencyFromFrozenObject(value: unknown): string | null {
  const root = jsonRecord(value);
  if (!root) return null;
  for (const key of ['platformCurrency', 'billingCurrency', 'currency', 'currencyCode']) {
    const currency = explicitCurrency(root[key]);
    if (currency) return currency;
  }
  for (const key of ['quote', 'customerPricing', 'pricing']) {
    const nested = jsonRecord(root[key]);
    if (!nested) continue;
    for (const currencyKey of ['platformCurrency', 'billingCurrency', 'currency', 'currencyCode']) {
      const currency = explicitCurrency(nested[currencyKey]);
      if (currency) return currency;
    }
  }
  return null;
}

function billingCurrencyFromFrozenObject(value: unknown): string | null {
  const root = jsonRecord(value);
  return root ? explicitCurrency(root.billingCurrency) : null;
}

function billingCurrencyFromReceipts(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return value
    .map(billingCurrencyFromFrozenObject)
    .find((currency) => currency !== null) ?? null;
}

export function gatewayBillingEventFundingCurrency(
  event: Pick<
    GatewayBillingEventRow,
    | 'settlementAnchor'
    | 'settlementReceipts'
    | 'tokenUsage'
    | 'fundingReservation'
    | 'settlementSnapshot'
    | 'pricingSnapshot'
    | 'billingResult'
  >,
): string | null {
  const anchorCurrency = billingCurrencyFromFrozenObject(event.settlementAnchor);
  if (anchorCurrency) return anchorCurrency;
  const receiptCurrency = billingCurrencyFromReceipts(event.settlementReceipts);
  if (receiptCurrency) return receiptCurrency;
  return [
    event.tokenUsage,
    event.fundingReservation,
    event.settlementSnapshot,
    event.pricingSnapshot,
    event.billingResult,
  ].map(currencyFromFrozenObject).find((currency) => currency !== null) ?? null;
}

function formatEvidenceTime(value: string | null): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function CompleteTag({ value, label = '分类' }: { value: boolean | null; label?: string }) {
  if (value === true) return <Tag color="success">{label}完整</Tag>;
  if (value === false) return <Tag color="warning">{label}不完整</Tag>;
  return <Tag>未提供{label}状态</Tag>;
}

function ReconstructibleTag({ value }: { value: boolean | null }) {
  if (value === true) return <Tag color="success">可重建</Tag>;
  if (value === false) return <Tag color="warning">不可重建</Tag>;
  return <Tag>未提供可重建状态</Tag>;
}

function FrozenCreditPolicy({ row }: { row: GatewayFundingAllocationSummary }) {
  const applicable = row.source === 'ENTERPRISE_CREDIT'
    || row.creditPolicyAt !== null
    || row.creditTermsDays !== null
    || row.creditDueAt !== null
    || row.creditPolicySnapshotComplete === true;
  if (!applicable) return <Tag>非审批信用，不适用</Tag>;
  return (
    <Space direction="vertical" size={0}>
      <CompleteTag value={row.creditPolicySnapshotComplete} label="政策快照" />
      <Text type="secondary">policyAt {formatEvidenceTime(row.creditPolicyAt)}</Text>
      <Text type="secondary">
        terms {row.creditTermsDays === null ? '—' : `${row.creditTermsDays} 天`}
        {' / '}due {formatEvidenceTime(row.creditDueAt)}
      </Text>
    </Space>
  );
}

function settlementColumns(currency?: string | null): ColumnsType<GatewayFundingSettlementRow> {
  return [
  {
    title: '发生时间',
    dataIndex: 'occurredAt',
    width: 180,
    render: (value: string | null | undefined) => formatEvidenceTime(value ?? null),
  },
  {
    title: '核销 / 实付 / 赠送',
    width: 300,
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text>{formatMoney(settlementAmount(row), currency)}</Text>
        <Text type="secondary">
          实付 {formatMoney(normalizedMoney(row.paidAmount, row.paidUsd), currency)}
          {' / '}赠送 {formatMoney(normalizedMoney(row.bonusAmount, row.bonusUsd), currency)}
        </Text>
      </Space>
    ),
  },
  {
    title: '触发 / 债务来源',
    width: 220,
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text>{optionalString(row.trigger) ?? '—'}</Text>
        <Text type="secondary">{optionalString(row.debtSource) ?? '—'}</Text>
      </Space>
    ),
  },
  {
    title: '还款流水 / Operation Key',
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text code copyable={Boolean(optionalString(row.repaymentTransactionId))}>
          {optionalString(row.repaymentTransactionId) ?? '—'}
        </Text>
        <Text code copyable={Boolean(optionalString(row.operationKey))}>
          {optionalString(row.operationKey) ?? '—'}
        </Text>
      </Space>
    ),
  },
  ];
}

function allocationColumns(currency?: string | null): ColumnsType<GatewayFundingAllocationSummary> {
  return [
  {
    title: '资金来源',
    dataIndex: 'source',
    width: 190,
    render: (value: string | null) => <Tag>{value ?? 'UNKNOWN'}</Tag>,
  },
  {
    title: 'Gross / 分类',
    width: 220,
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text>{formatMoney(row.amount, currency)}</Text>
        <CompleteTag value={row.classificationComplete} />
      </Space>
    ),
  },
  {
    title: '已审批应收 / 未审批欠款',
    width: 260,
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text>{formatMoney(row.approvedReceivable, currency)}</Text>
        <Text type="secondary">未审批 {formatMoney(row.unapprovedDebt, currency)}</Text>
      </Space>
    ),
  },
  {
    title: '已核销 / 未核销',
    width: 230,
    render: (_, row) => (
      <Space direction="vertical" size={0}>
        <Text>{formatMoney(row.settled, currency)}</Text>
        <Text type={isNegative(row.outstanding) ? 'danger' : 'secondary'}>
          未核销 {formatMoney(row.outstanding, currency)}
        </Text>
        {row.settlementEvidenceMatches === false ? <Tag color="error">回执合计不一致</Tag> : null}
      </Space>
    ),
  },
  {
    title: '发生时信用政策',
    width: 300,
    render: (_, row) => <FrozenCreditPolicy row={row} />,
  },
  {
    title: '账本顺序',
    dataIndex: 'ledgerSequence',
    width: 150,
    render: (value: string | null) => <Text code>{value ?? '—'}</Text>,
  },
  ];
}

const reservationStatusColors: Record<string, string> = {
  ACTIVE: 'processing',
  MANUAL_REVIEW: 'warning',
  CONSUMED: 'success',
  RELEASED: 'default',
};

export function GatewayFundingReservationDetails({
  reservation,
  currency,
}: {
  reservation: GatewayFundingReservationRow | null | undefined;
  currency?: string | null;
}) {
  const summary = summarizeGatewayFundingReservation(reservation);
  if (!summary) {
    return (
      <Alert
        type="info"
        showIcon
        message="该事件没有首收资金预占快照"
        description="Admin 不会根据当前余额、当前信用额度或当前账期补造历史 reservation。"
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type={summary.status === 'MANUAL_REVIEW' ? 'warning' : 'info'}
        showIcon
        message="首收资金预占是只读、发生时事实"
        description="预占金额、资金分类和信用政策均由 Billing 首次收件时冻结；此处只显示返回字符串，不按当前余额重算，也不补推缺失的 due date。"
      />
      <Descriptions bordered size="small" column={3}>
        <Descriptions.Item label="Reservation Status">
          {summary.status
            ? <Tag color={reservationStatusColors[summary.status] ?? 'default'}>{summary.status}</Tag>
            : '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Reservation Sequence">
          <Text code>{summary.reservationSequence ?? '—'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Billing Unit">{summary.billingUnit ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Reserved">{formatMoney(summary.reserved, currency)}</Descriptions.Item>
        <Descriptions.Item label="Collected">{formatMoney(summary.collected, currency)}</Descriptions.Item>
        <Descriptions.Item label="Authoritative Amount">
          {formatMoney(summary.authoritativeAmount, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="Approved Credit">
          {formatMoney(summary.approvedCredit, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="Unapproved Debt">
          {formatMoney(summary.unapprovedDebt, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="Credit Limit">{formatMoney(summary.creditLimit, currency)}</Descriptions.Item>
        <Descriptions.Item label="Policy At">{formatEvidenceTime(summary.policyAt)}</Descriptions.Item>
        <Descriptions.Item label="Policy Revision">
          {summary.policyRevision ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label="Policy Source">{summary.policySource ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Policy Reconstructible">
          <ReconstructibleTag value={summary.policyReconstructible} />
        </Descriptions.Item>
        <Descriptions.Item label="Terms">
          {summary.termsDays === null ? '—' : `${summary.termsDays} 天`}
        </Descriptions.Item>
        <Descriptions.Item label="Due At">
          {summary.dueAt ? formatEvidenceTime(summary.dueAt) : '—（Billing 未返回，不推算）'}
        </Descriptions.Item>
        <Descriptions.Item label="Credit Status">{summary.creditStatus ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Credit Effective">
          {formatEvidenceTime(summary.creditEffectiveAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Credit Expires">
          {formatEvidenceTime(summary.creditExpiresAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Occurred At">{formatEvidenceTime(summary.occurredAt)}</Descriptions.Item>
        <Descriptions.Item label="First Received">
          {formatEvidenceTime(summary.firstReceivedAt)}
        </Descriptions.Item>
        <Descriptions.Item label="Created At">{formatEvidenceTime(summary.createdAt)}</Descriptions.Item>
        <Descriptions.Item label="Consumed At">{formatEvidenceTime(summary.consumedAt)}</Descriptions.Item>
        <Descriptions.Item label="Released At">{formatEvidenceTime(summary.releasedAt)}</Descriptions.Item>
        <Descriptions.Item label="Release Reason">{summary.releaseReason ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Billing Account" span={3}>
          <Text code copyable={Boolean(summary.billingAccountId)}>{summary.billingAccountId ?? '—'}</Text>
          {' / tenant '}<Text code>{summary.tenantId ?? '—'}</Text>
          {' / user '}<Text code>{summary.userId ?? '—'}</Text>
          {' / key '}<Text code>{summary.apiKeyId ?? '—'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Anchor Hash" span={3}>
          <Text code copyable={Boolean(summary.anchorHash)}>{summary.anchorHash ?? '—'}</Text>
        </Descriptions.Item>
        <Descriptions.Item label="Reservation Hash" span={3}>
          <Text code copyable={Boolean(summary.reservationHash)}>
            {summary.reservationHash ?? '—'}
          </Text>
        </Descriptions.Item>
        <Descriptions.Item label="Review Reason" span={3}>
          {summary.reviewReason ?? '—'}
        </Descriptions.Item>
      </Descriptions>
    </Space>
  );
}

export function GatewayFundingSplitDetails({
  tokenUsage,
  currency,
}: {
  tokenUsage: GatewayTokenUsageFundingRow | null | undefined;
  currency?: string | null;
}) {
  const summary = summarizeGatewayFundingSplit(tokenUsage);
  if (!summary) {
    return (
      <Alert
        type="info"
        showIcon
        message="该事件没有 TokenUsage 资金拆分证据"
        description="历史事件缺失字段不会被解释为 0，也不会读取当前余额进行补算。"
      />
    );
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Alert
        type="info"
        showIcon
        message="只读发生时资金证据"
        description="Gross、已收、应收、欠款和核销均来自 Billing 返回的 TokenUsage、allocation 与 settlement；Admin 不读取当前余额，不按现行信用政策重算。"
      />
      <Descriptions bordered size="small" column={3}>
        <Descriptions.Item label="Charge Policy">{summary.chargePolicy ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="Classification">
          <CompleteTag value={summary.classificationComplete} />
        </Descriptions.Item>
        <Descriptions.Item label="Gross">{formatMoney(summary.gross, currency)}</Descriptions.Item>
        <Descriptions.Item label="Collected">{formatMoney(summary.collected, currency)}</Descriptions.Item>
        <Descriptions.Item label="Approved Receivable">
          {formatMoney(summary.approvedReceivable, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="Unapproved Debt">
          {formatMoney(summary.unapprovedDebt, currency)}
        </Descriptions.Item>
        <Descriptions.Item label="Settled">{formatMoney(summary.settled, currency)}</Descriptions.Item>
        <Descriptions.Item label="Outstanding">{formatMoney(summary.outstanding, currency)}</Descriptions.Item>
      </Descriptions>
      {summary.issues.length ? (
        <Alert
          type="warning"
          showIcon
          message="资金证据存在不完整或冲突字段"
          description={summary.issues.join('；')}
        />
      ) : null}
      <Table<GatewayFundingAllocationSummary>
        rowKey="key"
        size="small"
        columns={allocationColumns(currency)}
        dataSource={summary.allocations}
        pagination={false}
        scroll={{ x: 1350 }}
        locale={{ emptyText: 'Billing 未返回 consumption allocation；不会按当前余额推断' }}
        expandable={{
          rowExpandable: (row) => row.settlements.length > 0,
          expandedRowRender: (row) => (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Text type="secondary">
                Settlement 回执合计 {formatMoney(row.settlementEvidenceTotal, currency)}
                {' / '}allocation settled {formatMoney(row.settled, currency)}
                {' / '}settledAt {formatEvidenceTime(row.settledAt)}
              </Text>
              <Table<GatewayFundingSettlementRow>
                rowKey={(settlement, index) => optionalString(settlement.id) ?? `${row.key}-${index}`}
                size="small"
                columns={settlementColumns(currency)}
                dataSource={row.settlements}
                pagination={false}
                scroll={{ x: 980 }}
              />
            </Space>
          ),
        }}
      />
    </Space>
  );
}
