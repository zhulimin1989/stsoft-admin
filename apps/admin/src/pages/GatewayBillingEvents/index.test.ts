import { describe, expect, it } from 'vitest';
import type { GatewayBillingEventRow, GatewayUsageEvidenceRow } from '../../api/admin';
import {
  canAbsorbGatewayBillingEvent,
  canAbsorbGatewayBillingEventDelta,
  canMarkGatewayBillingEventManualReview,
  canReconcileAndSettleGatewayBillingEvent,
  canRetryGatewayBillingEvent,
  canStartGatewayBillingEventDeltaAbsorption,
  canStartGatewayBillingEventSettlement,
  collectGatewayBillingEventSnapshots,
  deltaAbsorbableGatewayUsageEvidences,
  gatewayUsageEvidenceDeltaAbsorptionIssue,
  gatewayUsageEvidenceSettlementIssue,
  settleableGatewayUsageEvidences,
  summarizeGatewaySettlementAnchor,
} from './index';

function event(overrides: Partial<GatewayBillingEventRow> = {}): GatewayBillingEventRow {
  return {
    id: 'event-1',
    requestId: 'request-1',
    status: 'RECEIVED',
    inputTokens: 0,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    totalTokens: 0,
    createdAt: '2026-08-06T00:00:00.000Z',
    updatedAt: '2026-08-06T00:00:00.000Z',
    revision: 2,
    ...overrides,
  };
}

function authoritativeEvidence(
  rawOverrides: Record<string, unknown> = {},
): GatewayUsageEvidenceRow {
  return {
    id: 'evidence-1',
    source: 'GATEWAY_USAGE_EVENT',
    tokenSource: 'provider',
    providerCredentialRef: 'provider-credential-1',
    upstreamRequestId: 'upstream-request-1',
    evidenceHash: 'hash-correction',
    evidenceRevision: 2,
    rawEvidence: {
      version: 'v2',
      event_type: 'usage',
      request_id: 'request-1',
      token_source: 'provider',
      prompt_tokens: 120,
      completion_tokens: 15,
      total_tokens: 135,
      token_extras: {
        cache_hit_tokens: 20,
        cache_write_tokens: 5,
      },
      usage_evidence: {
        source: 'provider_terminal',
        status: 'complete',
        protocol: 'anthropic_sse',
        terminal_frame_seen: true,
      },
      provider_reconciliation_required: false,
      provider_credential_ref: 'provider-credential-1',
      upstream_request_id: 'upstream-request-1',
      ...rawOverrides,
    },
  };
}

describe('Gateway billing event action policy', () => {
  it('allows technical retry only for RETRY_WAIT with a valid revision', () => {
    expect(canRetryGatewayBillingEvent(event({ status: 'RETRYABLE_FAILED', reconciliationStatus: 'RETRY_WAIT' }))).toBe(true);
    expect(canRetryGatewayBillingEvent(event({ status: 'FAILED', reconciliationStatus: 'RETRY_WAIT' }))).toBe(false);
    expect(canRetryGatewayBillingEvent(event({
      status: 'RETRYABLE_FAILED',
      reconciliationStatus: 'RETRY_WAIT',
      revision: null,
    }))).toBe(false);
  });

  it('keeps absorption behind manual review and refuses an existing funding outcome', () => {
    expect(canAbsorbGatewayBillingEvent(event({
      status: 'QUARANTINED',
      reconciliationStatus: 'MANUAL_REVIEW',
    }))).toBe(true);
    expect(canAbsorbGatewayBillingEvent(event({ reconciliationStatus: 'OPEN' }))).toBe(false);
    expect(canAbsorbGatewayBillingEvent(event({
      status: 'QUARANTINED',
      reconciliationStatus: 'MANUAL_REVIEW',
      fundingOutcome: 'DEBT_OPEN',
    }))).toBe(false);
  });

  it('does not reopen processing or terminal events for manual review', () => {
    expect(canMarkGatewayBillingEventManualReview(event({
      status: 'QUARANTINED',
      reconciliationStatus: 'OPEN',
    }))).toBe(true);
    expect(canMarkGatewayBillingEventManualReview(event({ reconciliationStatus: undefined }))).toBe(false);
    expect(canMarkGatewayBillingEventManualReview(event({ reconciliationStatus: 'PROCESSING' }))).toBe(false);
    expect(canMarkGatewayBillingEventManualReview(event({ reconciliationStatus: 'CLOSED' }))).toBe(false);
  });

  it('allows financial settlement only for a quarantined open/review event with complete evidence', () => {
    const open = event({
      status: 'QUARANTINED',
      reconciliationStatus: 'OPEN',
      usageEvidences: [authoritativeEvidence()],
    });
    const review = event({ ...open, reconciliationStatus: 'MANUAL_REVIEW' });

    expect(canStartGatewayBillingEventSettlement(open)).toBe(true);
    expect(canReconcileAndSettleGatewayBillingEvent(open)).toBe(true);
    expect(canReconcileAndSettleGatewayBillingEvent(review)).toBe(true);
    expect(settleableGatewayUsageEvidences(open).map((item) => item.id))
      .toEqual(['evidence-1']);

    expect(canReconcileAndSettleGatewayBillingEvent(event({
      ...open,
      status: 'RETRYABLE_FAILED',
    }))).toBe(false);
    expect(canReconcileAndSettleGatewayBillingEvent(event({
      ...open,
      reconciliationStatus: 'READY',
    }))).toBe(false);
    expect(canReconcileAndSettleGatewayBillingEvent(event({
      ...open,
      revision: null,
    }))).toBe(false);
    expect(canReconcileAndSettleGatewayBillingEvent(event({
      ...open,
      usageEvidences: [],
    }))).toBe(false);
  });

  it('keeps historical delta absorption separate and requires a different authoritative evidence', () => {
    const originalEvidence = {
      ...authoritativeEvidence(),
      id: 'evidence-original',
      evidenceHash: 'hash-original',
    };
    const correctionEvidence = authoritativeEvidence();
    const conflicted = event({
      status: 'DEDUCTED',
      reconciliationStatus: 'MANUAL_REVIEW',
      evidenceVerdict: 'CONFLICTED',
      evidenceHash: 'hash-original',
      usageEvidences: [originalEvidence, correctionEvidence],
    });

    expect(canStartGatewayBillingEventDeltaAbsorption(conflicted)).toBe(true);
    expect(canAbsorbGatewayBillingEventDelta(conflicted)).toBe(true);
    expect(deltaAbsorbableGatewayUsageEvidences(conflicted).map((item) => item.id))
      .toEqual(['evidence-1']);
    expect(gatewayUsageEvidenceDeltaAbsorptionIssue(conflicted, originalEvidence))
      .toBe('与原结算 evidence 相同');

    expect(canStartGatewayBillingEventDeltaAbsorption(event({
      ...conflicted,
      status: 'DEBT_OPEN',
    }))).toBe(true);
    expect(canStartGatewayBillingEventDeltaAbsorption(event({
      ...conflicted,
      status: 'QUARANTINED',
    }))).toBe(false);
    expect(canStartGatewayBillingEventDeltaAbsorption(event({
      ...conflicted,
      reconciliationStatus: 'OPEN',
    }))).toBe(false);
    expect(canStartGatewayBillingEventDeltaAbsorption(event({
      ...conflicted,
      evidenceVerdict: 'SETTLEABLE_BY_POLICY',
    }))).toBe(false);
    expect(canStartGatewayBillingEventDeltaAbsorption(event({
      ...conflicted,
      revision: null,
    }))).toBe(false);
    expect(canAbsorbGatewayBillingEventDelta(event({
      ...conflicted,
      evidenceHash: null,
    }))).toBe(false);
    expect(canAbsorbGatewayBillingEventDelta(event({
      ...conflicted,
      usageEvidences: [originalEvidence],
    }))).toBe(false);
  });

  it('explains why incomplete provider evidence cannot create a financial settlement', () => {
    expect(gatewayUsageEvidenceSettlementIssue(authoritativeEvidence())).toBeNull();
    expect(gatewayUsageEvidenceSettlementIssue(authoritativeEvidence({
      usage_evidence: {
        source: 'provider_terminal',
        status: 'complete',
        protocol: 'anthropic_sse',
        terminal_frame_seen: false,
      },
    }))).toBe('未观测到供应商终帧');
    expect(gatewayUsageEvidenceSettlementIssue(authoritativeEvidence({
      total_tokens: 134,
    }))).toBe('total_tokens 不一致');
    expect(gatewayUsageEvidenceSettlementIssue(authoritativeEvidence({
      token_extras: { cache_hit_tokens: 100, cache_write_tokens: 30 },
    }))).toBe('cache Token 超过 prompt_tokens');
    expect(gatewayUsageEvidenceSettlementIssue(authoritativeEvidence({
      provider_credential_ref: null,
      upstream_request_id: null,
      upstream_response_id: null,
    }))).toBeNull();

    const missingBindings = authoritativeEvidence({
      provider_credential_ref: null,
      upstream_request_id: null,
      upstream_response_id: null,
    });
    missingBindings.providerCredentialRef = null;
    missingBindings.upstreamRequestId = null;
    expect(gatewayUsageEvidenceSettlementIssue(missingBindings))
      .toBe('缺少 provider credential 绑定');
  });

  it('collects immutable settlement snapshots without inventing missing values', () => {
    expect(collectGatewayBillingEventSnapshots(event())).toBeNull();
    expect(collectGatewayBillingEventSnapshots(event({
      pricingSnapshot: { unitPrice: '1.25' },
      subjectSnapshot: { billingAccountId: 'account-1' },
    }))).toEqual({
      pricingSnapshot: { unitPrice: '1.25' },
      subjectSnapshot: { billingAccountId: 'account-1' },
    });
  });

  it('reads a settlement anchor defensively for the read-only detail view', () => {
    expect(summarizeGatewaySettlementAnchor(null)).toBeNull();
    expect(summarizeGatewaySettlementAnchor([])).toBeNull();
    expect(summarizeGatewaySettlementAnchor({
      apiKeyId: 'key-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      billingAccountId: 'account-1',
      productId: 'product-1',
      productSlug: 'glm-5.2',
      billingUnit: 'BALANCE',
      occurredAt: '2026-08-01T00:00:00.000Z',
      anchorHash: 'sha256:anchor-1',
      canonicalPayload: { immutable: true },
    })).toEqual({
      apiKeyId: 'key-1',
      userId: 'user-1',
      tenantId: 'tenant-1',
      billingAccountId: 'account-1',
      productId: 'product-1',
      productSlug: 'glm-5.2',
      billingUnit: 'BALANCE',
      occurredAt: '2026-08-01T00:00:00.000Z',
      anchorHash: 'sha256:anchor-1',
    });
    expect(summarizeGatewaySettlementAnchor({
      apiKeyId: 123,
      billingUnit: '',
    })).toEqual({
      apiKeyId: null,
      userId: null,
      tenantId: null,
      billingAccountId: null,
      productId: null,
      productSlug: null,
      billingUnit: null,
      occurredAt: null,
      anchorHash: null,
    });
  });
});
