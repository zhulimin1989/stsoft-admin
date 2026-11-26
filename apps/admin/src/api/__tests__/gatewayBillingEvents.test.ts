import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../axios', () => ({
  default: {
    get: mocks.get,
    post: mocks.post,
  },
}));

import {
  gatewayBillingEventApi,
  type GatewayBillingEventAbsorbInput,
  type GatewayBillingEventRow,
} from '../admin';

describe('gatewayBillingEventApi', () => {
  const action = {
    expectedRevision: 7,
    reason: 'approved by finance',
    idempotencyKey: 'admin-action-7',
  };

  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.get.mockResolvedValue({ data: { data: { items: [] } } });
    mocks.post.mockResolvedValue({ data: { data: { ok: true } } });
  });

  it('passes the three reconciliation dimensions as list filters', async () => {
    const params = {
      evidenceVerdict: 'VERIFIED_PROVIDER_CORRECTION',
      reconciliationStatus: 'MANUAL_REVIEW',
      fundingOutcome: 'RECEIVABLE',
      tenantId: 'tenant-1',
    };

    await gatewayBillingEventApi.list(params);

    expect(mocks.get).toHaveBeenCalledWith('/admin/gateway-billing-events', { params });
  });

  it('keeps the optional immutable funding split on the detail response', async () => {
    const detail: GatewayBillingEventRow = {
      id: 'event-1',
      requestId: 'request/1',
      status: 'DEDUCTED',
      tenantId: 'tenant-1',
      occurredAt: '2026-08-06T23:59:59.000Z',
      inputTokens: 10,
      outputTokens: 2,
      cachedInputTokens: 0,
      cacheWriteInputTokens: 0,
      totalTokens: 12,
      createdAt: '2026-08-07T00:00:00.000Z',
      updatedAt: '2026-08-07T00:00:00.000Z',
      fundingReservation: {
        id: 'reservation-1',
        requestId: 'request/1',
        billingAccountId: 'account-1',
        reservationSequence: '101',
        reservedAmountUsd: '1.25',
        collectedUsd: '0.25',
        approvedCreditUsd: '1',
        unapprovedDebtUsd: '0',
        creditPolicyAt: '2026-08-07T00:00:00.000Z',
        creditPolicyRevision: 3,
        creditTermsDays: 30,
        approvedCreditDueAt: '2026-09-06T00:00:00.000Z',
        reservationHash: 'reservation-hash-1',
        canonicalPayload: { frozen: true },
        status: 'ACTIVE',
      },
      tokenUsage: {
        customerChargeAmount: '1.25',
        customerCollectedAmount: '0.25',
        customerApprovedReceivableAmount: '1',
        customerUnapprovedDebtAmount: '0',
        customerFundingClassificationComplete: true,
        consumptionAllocations: [{
          id: 'allocation-1',
          source: 'ENTERPRISE_CREDIT',
          amount: '1',
          approvedCreditAmount: '1',
          unapprovedDebtAmount: '0',
          settledAmount: '0.1',
          fundingClassificationComplete: true,
          creditPolicyAt: '2026-08-07T00:00:00.000Z',
          creditTermsDays: 30,
          creditDueAt: '2026-09-06T00:00:00.000Z',
          creditPolicySnapshotComplete: true,
          ledgerSequence: '101',
          settlements: [{
            id: 'settlement-1',
            amount: '0.1',
            paidAmount: '0.1',
            bonusAmount: '0',
          }],
        }],
      },
      platformLossEntries: [{
        id: 'platform-loss-1',
        gatewayBillingEventId: 'event-1',
        requestId: 'request/1',
        reconciliationActionId: 'action-1',
        correctionEvidenceId: 'evidence-correction-1',
        correctionEvidenceHash: 'evidence-hash-1',
        originalSettlementReceiptId: 'receipt-original-1',
        absorptionSettlementReceiptId: 'receipt-absorption-1',
        billingUnit: 'BALANCE',
        customerChargeBeforeUsd: '0.100000000001',
        customerChargeCorrectedUsd: '0.400000000004',
        absorbedCustomerChargeUsd: '0.300000000003',
        customerDeductionUsd: '0.000000000000',
        providerCostBeforeUsd: '0.200000000001',
        providerCostCorrectedUsd: '0.500000000004',
        providerCostDeltaUsd: '0.300000000003',
        platformLossUsd: '0.300000000003',
        valuationPolicyVersion: 'gateway-platform-loss-v1',
        reason: 'approved platform absorption',
        actorId: 'finance-1',
        idempotencyKey: 'platform-loss:command-1',
        createdAt: '2026-08-07T00:00:00.000Z',
      }],
    };
    mocks.get.mockResolvedValueOnce({ data: { data: detail } });

    await expect(gatewayBillingEventApi.get('request/1')).resolves.toEqual(detail);
    expect(mocks.get).toHaveBeenCalledWith('/admin/gateway-billing-events/request%2F1');
  });

  it('sends the CAS action contract to every gateway evidence action endpoint', async () => {
    await gatewayBillingEventApi.retry('request/1', action);
    await gatewayBillingEventApi.manualReview('request/1', action);
    await gatewayBillingEventApi.reconcileSettle('request/1', {
      evidenceId: 'evidence-1',
      ...action,
    });
    await gatewayBillingEventApi.absorb('request/1', action);
    await gatewayBillingEventApi.absorbDelta('request/1', {
      evidenceId: 'evidence-2',
      ...action,
    });

    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      '/admin/gateway-billing-events/request%2F1/retry',
      action,
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      '/admin/gateway-billing-events/request%2F1/manual-review',
      action,
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      3,
      '/admin/gateway-billing-events/request%2F1/reconcile-settle',
      { evidenceId: 'evidence-1', ...action },
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      4,
      '/admin/gateway-billing-events/request%2F1/absorb',
      action,
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      5,
      '/admin/gateway-billing-events/request%2F1/absorb-delta',
      { evidenceId: 'evidence-2', ...action },
    );
  });

  it('forwards the explicit unanchored currency repair proof as one absorb request', async () => {
    const repairAbsorb: GatewayBillingEventAbsorbInput = {
      ...action,
      protocol: 'gateway-unanchored-absorb-v1',
      currencyRepairRunId: 'currency-repair-run-1',
      currencyRepairItemId: 'currency-repair-item-1',
      manifestHash: 'a'.repeat(64),
    };

    await gatewayBillingEventApi.absorb('request/1', repairAbsorb);

    expect(mocks.post).toHaveBeenCalledWith(
      '/admin/gateway-billing-events/request%2F1/absorb',
      repairAbsorb,
    );
  });
});
