import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { GatewayUsagePlatformLossRow } from '../../api/admin';
import { GatewayPlatformLossDetails } from './PlatformLossDetails';

const loss: GatewayUsagePlatformLossRow = {
  id: 'platform-loss-1',
  gatewayBillingEventId: 'event-1',
  requestId: 'request-1',
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
  reason: 'finance approved platform absorption',
  actorId: 'finance-actor-1',
  idempotencyKey: 'platform-loss:command-1',
  createdAt: '2026-08-07T08:00:00.000Z',
};

describe('GatewayPlatformLossDetails', () => {
  it('renders exact string amounts, zero customer deduction and every linked audit ID', () => {
    render(<GatewayPlatformLossDetails entries={[loss]} currency="CNY" />);

    expect(screen.getAllByText('CNY 0.300000000003').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('CNY 0')).toBeInTheDocument();
    expect(screen.getByText('客户补扣为 0；该差额由平台吸收')).toBeInTheDocument();

    for (const id of [
      'platform-loss-1',
      'evidence-correction-1',
      'evidence-hash-1',
      'action-1',
      'receipt-original-1',
      'receipt-absorption-1',
      'finance-actor-1',
    ]) {
      expect(screen.getAllByText(id).length).toBeGreaterThan(0);
    }
    expect(screen.getByText('finance approved platform absorption')).toBeInTheDocument();
  });

  it('does not invent a loss record for historical events', () => {
    render(<GatewayPlatformLossDetails entries={undefined} />);
    expect(screen.getByText('该事件没有逐请求平台损失记录')).toBeInTheDocument();
  });
});
