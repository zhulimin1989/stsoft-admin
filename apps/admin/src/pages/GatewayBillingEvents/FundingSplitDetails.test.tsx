import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GatewayTokenUsageFundingRow } from '../../api/admin';
import {
  gatewayBillingEventFundingCurrency,
  GatewayFundingReservationDetails,
  GatewayFundingSplitDetails,
  summarizeGatewayFundingReservation,
  summarizeGatewayFundingSplit,
} from './FundingSplitDetails';

function fundingUsage(): GatewayTokenUsageFundingRow {
  return {
    id: 'usage-1',
    customerChargePolicy: 'enterprise_credit',
    customerChargeAmount: '0.300000000003',
    customerCollectedAmount: '0.100000000003',
    customerApprovedReceivableAmount: '0.150000000000',
    customerUnapprovedDebtAmount: '0.050000000000',
    customerFundingClassificationComplete: true,
    consumptionAllocations: [
      {
        id: 'allocation-credit',
        source: 'ENTERPRISE_CREDIT',
        amount: '0.150000000000',
        approvedCreditAmount: '0.150000000000',
        unapprovedDebtAmount: '0.000000000000',
        fundingClassificationComplete: true,
        settledAmount: '0.020000000000',
        settledAt: null,
        creditPolicyAt: '2026-07-01T00:00:00.000Z',
        creditTermsDays: 30,
        creditDueAt: '2026-07-31T00:00:00.000Z',
        creditPolicySnapshotComplete: true,
        ledgerSequence: '42',
        settlements: [{
          id: 'settlement-1',
          debtSource: 'ENTERPRISE_CREDIT',
          trigger: 'FUNDING',
          repaymentTransactionId: 'transaction-1',
          operationKey: 'operation-1',
          amount: '0.020000000000',
          paidAmount: '0.015000000000',
          bonusAmount: '0.005000000000',
          occurredAt: '2026-07-15T10:00:00.000Z',
        }],
      },
      {
        id: 'allocation-debt',
        source: 'NEGATIVE_BALANCE',
        amount: '0.050000000000',
        approvedCreditAmount: '0.000000000000',
        unapprovedDebtAmount: '0.050000000000',
        fundingClassificationComplete: true,
        settledAmount: '0.010000000000',
        creditPolicySnapshotComplete: false,
        ledgerSequence: '43',
        settlements: [{
          id: 'settlement-2',
          amount: '0.010000000000',
          paidAmount: '0.010000000000',
          bonusAmount: '0.000000000000',
          occurredAt: '2026-07-16T10:00:00.000Z',
        }],
      },
    ],
  };
}

describe('GatewayFundingSplitDetails', () => {
  it('uses exact stored decimals for settled and outstanding without floating-point loss', () => {
    const summary = summarizeGatewayFundingSplit(fundingUsage());

    expect(summary).toMatchObject({
      gross: '0.300000000003',
      collected: '0.100000000003',
      approvedReceivable: '0.15',
      unapprovedDebt: '0.05',
      settled: '0.03',
      outstanding: '0.17',
      classificationComplete: true,
      issues: [],
    });
    expect(summary?.allocations[0]).toMatchObject({
      outstanding: '0.13',
      settlementEvidenceTotal: '0.02',
      settlementEvidenceMatches: true,
      ledgerSequence: '42',
    });
  });

  it('does not mistake collected balance consumption for outstanding debt', () => {
    const summary = summarizeGatewayFundingSplit({
      customerChargeAmount: '5',
      customerCollectedAmount: '5',
      customerApprovedReceivableAmount: '0',
      customerUnapprovedDebtAmount: '0',
      customerFundingClassificationComplete: true,
      consumptionAllocations: [{
        source: 'BALANCE_GRANT',
        amount: '5',
        approvedCreditAmount: '0',
        unapprovedDebtAmount: '0',
        settledAmount: '0',
        fundingClassificationComplete: true,
        ledgerSequence: '9',
        settlements: [],
      }],
    });

    expect(summary?.outstanding).toBe('0');
    expect(summary?.allocations[0].outstanding).toBe('0');
  });

  it('accepts the raw USD aliases during a mixed-version Billing rollout', () => {
    const summary = summarizeGatewayFundingSplit({
      customerChargeUsd: '2',
      customerCollectedUsd: '1',
      customerApprovedReceivableUsd: '1',
      customerUnapprovedDebtUsd: '0',
      customerFundingClassificationComplete: true,
      consumptionAllocations: [{
        source: 'ENTERPRISE_CREDIT',
        amountUsd: '1',
        approvedCreditUsd: '1',
        unapprovedDebtUsd: '0',
        settledUsd: '0.25',
        fundingClassificationComplete: true,
        creditPolicySnapshotComplete: true,
        settlements: [{ amountUsd: '0.25' }],
      }],
    });

    expect(summary).toMatchObject({
      gross: '2',
      settled: '0.25',
      outstanding: '0.75',
    });
  });

  it('surfaces incomplete classifications and settlement receipt conflicts', () => {
    const usage = fundingUsage();
    usage.customerFundingClassificationComplete = false;
    usage.consumptionAllocations![0].fundingClassificationComplete = false;
    usage.consumptionAllocations![0].settlements![0].amount = '0.019';

    const summary = summarizeGatewayFundingSplit(usage);

    expect(summary?.issues).toEqual(expect.arrayContaining([
      expect.stringContaining('TokenUsage 客户资金分类未标记为完整'),
      expect.stringContaining('funding classification 不完整'),
      expect.stringContaining('settledAmount 与 settlements 回执合计不一致'),
    ]));
  });

  it('renders the funding facts only in the read-only detail component', () => {
    const { container } = render(<GatewayFundingSplitDetails tokenUsage={fundingUsage()} />);

    expect(screen.getByText('只读发生时资金证据')).toBeInTheDocument();
    expect(screen.getByText(/Admin 不读取当前余额/)).toBeInTheDocument();
    expect(screen.getByText('Approved Receivable')).toBeInTheDocument();
    expect(screen.getByText('Outstanding')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
    expect(screen.getByText(/terms 30 天/)).toBeInTheDocument();
    expect(screen.getAllByText(/平台币种/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^USD /)).not.toBeInTheDocument();

    const expand = container.querySelector<HTMLButtonElement>('.ant-table-row-expand-icon');
    expect(expand).not.toBeNull();
    fireEvent.click(expand!);
    expect(screen.getByText('transaction-1')).toBeInTheDocument();
    expect(screen.getByText('operation-1')).toBeInTheDocument();
  });

  it('uses an explicit frozen CNY currency instead of the historical USD field suffix', () => {
    render(<GatewayFundingSplitDetails tokenUsage={fundingUsage()} currency="CNY" />);

    expect(screen.getByText('CNY 0.300000000003')).toBeInTheDocument();
    expect(screen.getAllByText(/^CNY /).length).toBeGreaterThan(4);
    expect(screen.queryByText(/平台币种/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^USD /)).not.toBeInTheDocument();
  });

  it('does not turn a missing historical TokenUsage into zero amounts', () => {
    expect(summarizeGatewayFundingSplit(null)).toBeNull();
    render(<GatewayFundingSplitDetails tokenUsage={null} />);
    expect(screen.getByText('该事件没有 TokenUsage 资金拆分证据')).toBeInTheDocument();
    expect(screen.getByText(/缺失字段不会被解释为 0/)).toBeInTheDocument();
  });
});

describe('GatewayFundingReservationDetails', () => {
  const reservation = {
    id: 'reservation-1',
    requestId: 'request-1',
    billingAccountId: 'account-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    apiKeyId: 'key-1',
    billingUnit: 'BALANCE',
    occurredAt: '2026-08-07T00:00:00.000Z',
    firstReceivedAt: '2026-08-07T00:00:01.000Z',
    reservationSequence: '90071992547409931234',
    reservedAmountUsd: '1.250000000000',
    collectedUsd: '0.250000000000',
    approvedCreditUsd: '0.750000000000',
    unapprovedDebtUsd: '0.250000000000',
    creditPolicyAt: '2026-08-07T00:00:00.000Z',
    creditPolicyRevision: 7,
    creditPolicySource: 'ENTERPRISE_CREDIT_POLICY',
    creditPolicyReconstructible: true,
    creditLimitUsd: '100.000000000000',
    creditTermsDays: 30,
    approvedCreditDueAt: '2026-09-06T00:00:00.000Z',
    creditStatus: 'ACTIVE',
    creditEffectiveAt: '2026-08-01T00:00:00.000Z',
    creditExpiresAt: '2027-08-01T00:00:00.000Z',
    anchorHash: 'anchor-hash-1',
    reservationHash: 'reservation-hash-1',
    status: 'MANUAL_REVIEW',
    reviewReason: 'out_of_order_first_receipt',
    authoritativeAmountUsd: '1.100000000000',
    consumedAt: null,
    releasedAt: null,
    releaseReason: null,
    createdAt: '2026-08-07T00:00:01.000Z',
  };

  it('reads the raw Billing strings and BigInt sequence without numeric coercion', () => {
    expect(summarizeGatewayFundingReservation(reservation)).toMatchObject({
      reservationSequence: '90071992547409931234',
      reserved: '1.25',
      collected: '0.25',
      approvedCredit: '0.75',
      unapprovedDebt: '0.25',
      policyRevision: 7,
      termsDays: 30,
      dueAt: '2026-09-06T00:00:00.000Z',
      reservationHash: 'reservation-hash-1',
      reviewReason: 'out_of_order_first_receipt',
      authoritativeAmount: '1.1',
    });
  });

  it('accepts short policy and amount aliases during mixed-version rollout', () => {
    expect(summarizeGatewayFundingReservation({
      reservationSequence: 12,
      reservedAmount: '2',
      collectedAmount: '1',
      approvedCreditAmount: '1',
      unapprovedDebtAmount: '0',
      policyAt: '2026-08-07T00:00:00.000Z',
      revision: 9,
      source: 'FROZEN_POLICY',
      reconstructible: false,
      limit: '10',
      terms: 15,
      due: '2026-08-22T00:00:00.000Z',
      effective: '2026-08-01T00:00:00.000Z',
      expires: '2027-08-01T00:00:00.000Z',
      authoritativeAmount: '1.5',
    })).toMatchObject({
      reservationSequence: '12',
      reserved: '2',
      policyRevision: 9,
      policySource: 'FROZEN_POLICY',
      policyReconstructible: false,
      creditLimit: '10',
      termsDays: 15,
      dueAt: '2026-08-22T00:00:00.000Z',
      authoritativeAmount: '1.5',
    });
  });

  it('renders hashes, sequence and manual-review reason as read-only facts', () => {
    render(<GatewayFundingReservationDetails reservation={reservation} currency="CNY" />);

    expect(screen.getByText('首收资金预占是只读、发生时事实')).toBeInTheDocument();
    expect(screen.getByText(/不按当前余额重算/)).toBeInTheDocument();
    expect(screen.getByText('90071992547409931234')).toBeInTheDocument();
    expect(screen.getByText('reservation-hash-1')).toBeInTheDocument();
    expect(screen.getByText('out_of_order_first_receipt')).toBeInTheDocument();
    expect(screen.getByText('CNY 1.25')).toBeInTheDocument();
    expect(screen.queryByText(/^USD /)).not.toBeInTheDocument();
  });

  it('does not derive an approved-credit due date when Billing omits it', () => {
    render(<GatewayFundingReservationDetails reservation={{
      ...reservation,
      approvedCreditDueAt: undefined,
    }} />);

    expect(screen.getByText('—（Billing 未返回，不推算）')).toBeInTheDocument();
  });

  it('does not synthesize a reservation for historical events', () => {
    expect(summarizeGatewayFundingReservation(undefined)).toBeNull();
    render(<GatewayFundingReservationDetails reservation={null} />);
    expect(screen.getByText('该事件没有首收资金预占快照')).toBeInTheDocument();
    expect(screen.getByText(/不会根据当前余额/)).toBeInTheDocument();
  });
});

describe('gatewayBillingEventFundingCurrency', () => {
  it('prefers the immutable settlement anchor, then a settlement receipt', () => {
    expect(gatewayBillingEventFundingCurrency({
      settlementAnchor: { billingCurrency: 'cny' },
      settlementReceipts: [{ billingCurrency: 'EUR' }],
      tokenUsage: { billingCurrency: 'USD' },
    })).toBe('CNY');
    expect(gatewayBillingEventFundingCurrency({
      settlementAnchor: { billingCurrency: null },
      settlementReceipts: [
        { billingCurrency: null },
        { billingCurrency: 'eur' },
      ],
      tokenUsage: { billingCurrency: 'USD' },
    })).toBe('EUR');
  });

  it('resolves a CREDITS event from its anchor when no funding reservation exists', () => {
    expect(gatewayBillingEventFundingCurrency({
      settlementAnchor: {
        billingUnit: 'CREDITS',
        billingCurrency: 'cny',
      },
      settlementReceipts: [],
      fundingReservation: null,
    })).toBe('CNY');
  });

  it('prefers explicit frozen detail currency fields and normalizes CNY', () => {
    expect(gatewayBillingEventFundingCurrency({
      tokenUsage: { platformCurrency: 'cny' },
      fundingReservation: { currency: 'USD' },
      settlementSnapshot: { currency: 'EUR' },
    })).toBe('CNY');
    expect(gatewayBillingEventFundingCurrency({
      pricingSnapshot: { quote: { billingCurrency: 'cny' } },
    })).toBe('CNY');
  });

  it('does not infer a currency from field names or unrelated nested provider data', () => {
    expect(gatewayBillingEventFundingCurrency({
      tokenUsage: { customerChargeUsd: '1' },
      pricingSnapshot: { providerPricing: { currency: 'USD' } },
      billingResult: { amountUsd: '1' },
    })).toBeNull();
  });
});
