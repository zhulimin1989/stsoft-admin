import { describe, expect, it } from 'vitest';
import {
  buildHistoricalPlatformLossLines,
  parseNormalizedUsageText,
  parsePricingEvidenceText,
  PRICING_EVIDENCE_JSON_TEMPLATE,
  STANDARD_USAGE_CSV_TEMPLATE,
} from './loss-file';

describe('historical platform loss standard file', () => {
  it('parses quoted CSV, normalizes aliases and preserves the raw source row', () => {
    const csv = [
      'date,model,meter,platformUsage,providerUsage',
      '2026/7/1,"glm-5.2,prod",input,"1,000","1,100"',
    ].join('\n');

    const parsed = parseNormalizedUsageText('normalized.csv', csv);

    expect(parsed.issues).toEqual([]);
    expect(parsed.rows).toEqual([expect.objectContaining({
      lineType: 'PROVIDER_AGGREGATE',
      serviceDate: '2026-07-01',
      model: 'glm-5.2,prod',
      meter: 'INPUT',
      platformUsage: '1000',
      providerUsage: '1100',
      providerAggregateRef: '2026-07-01|glm-5.2,prod|INPUT',
      sourceEvidence: expect.objectContaining({ serviceDate: '2026/7/1' }),
    })]);
  });

  it('builds only token/verified valuation inputs and never accepts a client-entered total loss', async () => {
    const parsed = parseNormalizedUsageText('normalized.csv', STANDARD_USAGE_CSV_TEMPLATE);
    const pricing = await parsePricingEvidenceText(PRICING_EVIDENCE_JSON_TEMPLATE);
    const built = buildHistoricalPlatformLossLines(parsed.rows, {
      version: 'glm-2026-07-v1',
      pricingCurrency: 'CNY',
    }, pricing.entries);

    expect(built.issues).toEqual([]);
    expect(built.lines[0]).toEqual(expect.objectContaining({
      platformUsage: '1000000',
      providerUsage: '1100000',
      valuationBasis: {
        version: 'glm-2026-07-v1',
        rateUnit: 'TOKENS_PER_MILLION',
        pricingCurrency: 'CNY',
        customerRatePerMillion: '4.000000000000',
        providerCostRatePerMillion: '2.000000000000',
        pricingSourceRef: 'oss://finance-pricing/glm-2026-07-v1.json?versionId=immutable',
        pricingDocumentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        pricingEvidenceHash: '589a1546f86c978715413d5ea1d589df50d83a0f439c884e7651e80f3f4aef52',
        pricingEffectiveFrom: '2026-07-01',
        pricingEffectiveTo: '2026-08-01',
        pricingApprovedBy: 'finance-pricing-committee',
        pricingApprovedAt: '2026-06-30T08:00:00.000Z',
        pricingEvidence: expect.objectContaining({
          documentSha256: 'fe1c01729d228ab69f602708f6be8af02286d8a933c9e088f569b39cf3aa04be',
          model: 'glm-5.2',
          meter: 'INPUT',
        }),
      },
    }));
    expect(built.lines[0]).not.toHaveProperty('customerAbsorbedDelta');
    expect(built.lines[0]).not.toHaveProperty('providerCostDelta');
  });

  it('blocks missing evidence and a mismatched historical valuation version', async () => {
    const parsed = parseNormalizedUsageText('normalized.json', JSON.stringify([{
      date: '2026-07-01',
      model: 'glm-5.2',
      meter: 'CACHE',
      platformUsage: '10',
      providerUsage: '20',
    }]));
    const pricing = await parsePricingEvidenceText(PRICING_EVIDENCE_JSON_TEMPLATE);
    const built = buildHistoricalPlatformLossLines(parsed.rows, {
      version: 'wrong-version',
      pricingCurrency: 'CNY',
    }, pricing.entries);

    expect(built.lines).toEqual([]);
    expect(built.issues[0]?.code).toBe('PRICING_EVIDENCE_NOT_FOUND');
  });

  it('rejects an unauditable pricing row before any financial preview', async () => {
    const parsed = await parsePricingEvidenceText(JSON.stringify([{
      version: 'glm-2026-07-v1',
      model: 'glm-5.2',
      meter: 'INPUT',
      pricingCurrency: 'CNY',
      customerRatePerMillion: '4',
      providerCostRatePerMillion: '2',
      effectiveFrom: '2026-07-01',
      effectiveTo: '2026-08-01',
    }]));

    expect(parsed.entries).toEqual([]);
    expect(parsed.issues[0]).toEqual(expect.objectContaining({
      code: 'PRICING_EVIDENCE_INVALID',
    }));
  });

  it('reports malformed source rows instead of silently dropping them', () => {
    const parsed = parseNormalizedUsageText('normalized.csv', [
      'date,model,meter,platformUsage,providerUsage',
      '2025-02-30,glm-5.2,OUTPUT,not-a-token,20',
    ].join('\n'));

    expect(parsed.rows).toEqual([]);
    expect(parsed.issues.map((issue) => issue.code)).toEqual([
      'SERVICE_DATE_REQUIRED',
      'PLATFORM_USAGE_INVALID',
    ]);
  });

  it('rejects a directly exported two-row source sheet instead of treating it as normalized input', () => {
    const parsed = parseNormalizedUsageText('source-export.csv', [
      ',,,智谱统计,软通统计',
      '入账时间,模型编码（推理专用）,价格类型,求和项:用量,求和项:用量',
      '2026-07-01,glm-5.2,INPUT,1100,1000',
      ',,CACHE,220,200',
    ].join('\n'));

    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).not.toEqual([]);
    expect(parsed.issues.some((issue) => issue.code === 'SERVICE_DATE_REQUIRED')).toBe(true);
  });
});
