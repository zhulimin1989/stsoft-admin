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
  historicalPlatformLossApi,
  type HistoricalPlatformLossBatchInput,
  type HistoricalPlatformLossPreview,
} from '../admin';

describe('historicalPlatformLossApi', () => {
  const draft: HistoricalPlatformLossBatchInput = {
    provider: 'zhipu',
    providerAccountRef: 'acct-1',
    region: 'domestic',
    periodStart: '2026-07-01',
    periodEnd: '2026-08-01',
    currency: 'CNY',
    sourceFileRef: 'oss://finance/source.xlsx?versionId=1',
    sourceFileSha256: 'a'.repeat(64),
    calculationMethod: 'TOKEN_RATE_PER_MILLION_V1',
    roundingPolicy: 'HALF_UP_12',
    exchangeRate: '7.2',
    exchangeRateSource: 'PBOC',
    exchangeRateSourceCurrency: 'USD',
    exchangeRateAsOf: '2026-07-31T00:00:00.000Z',
    reason: 'FIN-42',
    lines: [{
      lineType: 'PROVIDER_AGGREGATE',
      sourceRowRef: '2',
      sourceEvidence: { row: 2 },
      serviceDate: '2026-07-01',
      model: 'glm-5.2',
      meter: 'INPUT',
      platformUsage: '100',
      providerUsage: '110',
      providerAggregateRef: '2026-07-01|glm-5.2|INPUT',
      valuationBasis: {
        version: 'glm-2026-07-v1',
        rateUnit: 'TOKENS_PER_MILLION',
        pricingCurrency: 'CNY',
        customerRatePerMillion: '4',
        providerCostRatePerMillion: '2',
        pricingSourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
        pricingDocumentSha256: 'c'.repeat(64),
        pricingEvidenceHash: 'd'.repeat(64),
        pricingEffectiveFrom: '2026-07-01',
        pricingEffectiveTo: '2026-08-01',
        pricingApprovedBy: 'finance-pricing-committee',
        pricingApprovedAt: '2026-06-30T08:00:00.000Z',
        pricingEvidence: {
          sourceRef: 'oss://finance-pricing/glm-v1.json?versionId=1',
          documentSha256: 'c'.repeat(64),
        },
      },
    }],
  };

  beforeEach(() => {
    mocks.get.mockReset();
    mocks.post.mockReset();
    mocks.get.mockResolvedValue({ data: { data: {} } });
    mocks.post.mockResolvedValue({ data: { data: {} } });
  });

  it('requires preview before create by exposing separate immutable-fingerprint calls', async () => {
    await historicalPlatformLossApi.preview(draft);
    await historicalPlatformLossApi.create({
      ...draft,
      expectedFingerprint: 'b'.repeat(64),
      idempotencyKey: 'prepare-1',
    });

    expect(mocks.post).toHaveBeenNthCalledWith(
      1,
      '/admin/historical-platform-loss-batches/preview',
      draft,
    );
    expect(mocks.post).toHaveBeenNthCalledWith(
      2,
      '/admin/historical-platform-loss-batches',
      expect.objectContaining({
        expectedFingerprint: 'b'.repeat(64),
        idempotencyKey: 'prepare-1',
      }),
    );
  });

  it('preserves the Billing preview wire shape, including explicit null exchange fields', async () => {
    const preview: HistoricalPlatformLossPreview = {
      provider: 'zhipu',
      providerAccountRef: 'acct-1',
      region: 'domestic',
      periodStart: '2026-07-01T00:00:00.000Z',
      periodEnd: '2026-08-01T00:00:00.000Z',
      currency: 'CNY',
      sourceFileRef: 'oss://finance/source.xlsx?versionId=1',
      sourceFileSha256: 'a'.repeat(64),
      calculationMethod: 'TOKEN_RATE_PER_MILLION_V1',
      roundingPolicy: 'HALF_UP_12',
      exchangeRate: null,
      exchangeRateSource: null,
      exchangeRateSourceCurrency: null,
      exchangeRateDirection: null,
      exchangeRateAsOf: null,
      reason: 'FIN-42 platform absorption',
      status: 'READY',
      fingerprint: 'b'.repeat(64),
      itemCount: 1,
      totals: {
        platformAmountBefore: '0.000400000000',
        platformAmountCorrected: '0.000440000000',
        customerAbsorbedDelta: '0.000040000000',
        customerDeduction: '0.000000000000',
        providerCostBefore: '0.000200000000',
        providerCostCorrected: '0.000220000000',
        providerCostDelta: '0.000020000000',
      },
      lines: [{
        lineNumber: 1,
        lineType: 'PROVIDER_AGGREGATE',
        gatewayBillingEventId: null,
        requestId: null,
        upstreamRequestId: null,
        providerAggregateRef: '2026-07-01|glm-5.2|INPUT',
        serviceDate: '2026-07-01',
        model: 'glm-5.2',
        meter: 'INPUT',
        platformUsage: '100',
        providerUsage: '110',
        usageDelta: '10',
        valuationBasis: draft.lines[0].valuationBasis,
        sourceRowRef: '2',
        sourceEvidence: { row: 2 },
        sourceRowHash: 'e'.repeat(64),
        recognitionKeys: [{ type: 'PROVIDER_AGGREGATE', key: 'aggregate-key-1' }],
        platformAmountBefore: '0.000400000000',
        platformAmountCorrected: '0.000440000000',
        customerAbsorbedDelta: '0.000040000000',
        customerDeduction: '0.000000000000',
        providerCostBefore: '0.000200000000',
        providerCostCorrected: '0.000220000000',
        providerCostDelta: '0.000020000000',
        lineHash: 'f'.repeat(64),
      }],
      issues: [],
    };
    mocks.post.mockResolvedValueOnce({ data: { data: preview } });

    await expect(historicalPlatformLossApi.preview(draft)).resolves.toEqual(preview);
    expect(preview).toMatchObject({
      exchangeRate: null,
      exchangeRateDirection: null,
      reason: 'FIN-42 platform absorption',
      lines: [{
        gatewayBillingEventId: null,
        customerDeduction: '0.000000000000',
      }],
    });
  });

  it('sends CAS and fingerprint to the maker-checker approval endpoint', async () => {
    const approval = {
      expectedRevision: 0,
      expectedFingerprint: 'b'.repeat(64),
      reason: 'approved FIN-42',
      idempotencyKey: 'approve-1',
    };

    await historicalPlatformLossApi.approveAndPost('batch/1', approval);
    await historicalPlatformLossApi.export('batch/1');

    expect(mocks.post).toHaveBeenCalledWith(
      '/admin/historical-platform-loss-batches/batch%2F1/approve-and-post',
      approval,
    );
    expect(mocks.get).toHaveBeenCalledWith(
      '/admin/historical-platform-loss-batches/batch%2F1/export',
    );
  });
});
