import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

export const HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS = {
  valuationVersion: 100,
  sourceRowRef: 500,
  providerAccountRef: 300,
  sourceFileRef: 1000,
  reason: 1000,
} as const;

const trimmedText = (label: string, max: number) => z.string()
  .trim()
  .min(1, `${label}不能为空`)
  .max(max, `${label}不能超过${max}个字符`);

const sha256Schema = z.string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, 'sourceFileSha256 必须是 64 位 SHA-256 十六进制');

const decimalSchema = z.string().transform((value, context) => {
  const normalized = value.trim();
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: '金额必须是十进制定点数' });
    return z.NEVER;
  }
  return normalized;
});

const nonNegativeDecimalSchema = decimalSchema.refine(
  (value) => !value.startsWith('-'),
  '费率必须是非负十进制数',
);

const positiveDecimalSchema = decimalSchema.refine(
  (value) => !value.startsWith('-') && !/^0(?:\.0+)?$/.test(value),
  'exchangeRate 必须大于 0',
);

const isoDateSchema = trimmedText('日期', 64).refine(
  (value) => Number.isFinite(Date.parse(value)),
  '日期必须是有效 ISO 时间',
);

const sourceEvidenceSchema = z.record(z.unknown());

const usageIntegerSchema = z.string()
  .trim()
  .regex(/^(?:0|[1-9]\d*)$/, '用量必须是非负整数字符串');

const serviceDateSchema = z.string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'serviceDate 必须使用 YYYY-MM-DD');

const valuationBasisSchema = z.object({
  version: trimmedText(
    'valuationBasis.version',
    HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.valuationVersion,
  ),
  rateUnit: z.literal('TOKENS_PER_MILLION'),
  pricingCurrency: trimmedText('valuationBasis.pricingCurrency', 3)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'pricingCurrency 必须是 3 位 ISO 货币代码'),
  customerRatePerMillion: nonNegativeDecimalSchema,
  providerCostRatePerMillion: nonNegativeDecimalSchema,
  pricingSourceRef: trimmedText('valuationBasis.pricingSourceRef', 1000),
  pricingDocumentSha256: sha256Schema.transform((value) => value.toLowerCase()),
  pricingEvidenceHash: sha256Schema.transform((value) => value.toLowerCase()),
  pricingEffectiveFrom: serviceDateSchema,
  pricingEffectiveTo: serviceDateSchema,
  pricingApprovedBy: trimmedText('valuationBasis.pricingApprovedBy', 300),
  pricingApprovedAt: isoDateSchema,
  pricingEvidence: sourceEvidenceSchema,
}).strict().superRefine((value, context) => {
  if (!Object.keys(value.pricingEvidence).length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'valuationBasis.pricingEvidence 不能为空',
      path: ['pricingEvidence'],
    });
  }
  if (value.pricingEffectiveFrom >= value.pricingEffectiveTo) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'pricingEffectiveTo 必须晚于 pricingEffectiveFrom',
      path: ['pricingEffectiveTo'],
    });
  }
});

export const historicalPlatformLossLineSchema = z.object({
  lineType: z.enum(['MISSING_ANCHOR_REQUEST', 'PROVIDER_AGGREGATE']),
  sourceRowRef: trimmedText(
    'sourceRowRef',
    HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceRowRef,
  ),
  sourceEvidence: sourceEvidenceSchema,
  serviceDate: serviceDateSchema,
  model: trimmedText('model', 200),
  meter: trimmedText('meter', 100).transform((value) => value.toUpperCase()),
  platformUsage: usageIntegerSchema,
  providerUsage: usageIntegerSchema,
  valuationBasis: valuationBasisSchema,
  requestId: trimmedText('requestId', 300).optional(),
  upstreamRequestId: trimmedText('upstreamRequestId', 300).optional(),
  providerAggregateRef: trimmedText('providerAggregateRef', 300).optional(),
}).strict().superRefine((line, context) => {
  if (!Object.keys(line.sourceEvidence).length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'sourceEvidence 不能为空',
      path: ['sourceEvidence'],
    });
  }
  if (line.lineType === 'MISSING_ANCHOR_REQUEST' && !line.requestId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'MISSING_ANCHOR_REQUEST 必须提供 requestId',
      path: ['requestId'],
    });
  }
  if (line.lineType === 'PROVIDER_AGGREGATE' && !line.providerAggregateRef) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROVIDER_AGGREGATE 必须提供 providerAggregateRef',
      path: ['providerAggregateRef'],
    });
  }
  if (line.lineType === 'PROVIDER_AGGREGATE' && line.requestId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'PROVIDER_AGGREGATE 不得提供 requestId',
      path: ['requestId'],
    });
  }
});

const historicalPlatformLossCommonSchema = z.object({
  provider: trimmedText('provider', 100),
  providerAccountRef: trimmedText(
    'providerAccountRef',
    HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.providerAccountRef,
  ),
  region: trimmedText('region', 100),
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
  currency: trimmedText('currency', 3)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'currency 必须是 3 位 ISO 货币代码'),
  sourceFileRef: trimmedText(
    'sourceFileRef',
    HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.sourceFileRef,
  ),
  sourceFileSha256: sha256Schema.transform((value) => value.toLowerCase()),
  calculationMethod: z.literal('TOKEN_RATE_PER_MILLION_V1'),
  roundingPolicy: z.literal('HALF_UP_12'),
  exchangeRate: positiveDecimalSchema.optional(),
  exchangeRateSource: trimmedText('exchangeRateSource', 200).optional(),
  exchangeRateSourceCurrency: trimmedText('exchangeRateSourceCurrency', 3)
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), 'exchangeRateSourceCurrency 必须是 3 位 ISO 货币代码')
    .optional(),
  exchangeRateAsOf: isoDateSchema.optional(),
  reason: trimmedText('reason', HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason),
  lines: z.array(historicalPlatformLossLineSchema).min(1, '至少需要一条明细').max(10_000),
}).superRefine((value, context) => {
  if (Date.parse(value.periodStart) >= Date.parse(value.periodEnd)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'periodEnd 必须晚于 periodStart',
      path: ['periodEnd'],
    });
  }
  if (
    value.exchangeRateSourceCurrency
    && value.exchangeRateSourceCurrency === value.currency
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'exchangeRateSourceCurrency 必须不同于批次 currency',
      path: ['exchangeRateSourceCurrency'],
    });
  }
  for (let index = 0; index < value.lines.length; index += 1) {
    if (value.lines[index].valuationBasis.pricingCurrency !== value.currency) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'valuationBasis.pricingCurrency 必须与批次 currency 一致',
        path: ['lines', index, 'valuationBasis', 'pricingCurrency'],
      });
    }
  }
  const exchangeFields = [
    value.exchangeRate,
    value.exchangeRateSource,
    value.exchangeRateSourceCurrency,
    value.exchangeRateAsOf,
  ];
  const exchangeFieldCount = exchangeFields.filter((field) => field !== undefined).length;
  if (exchangeFieldCount > 0 && exchangeFieldCount < exchangeFields.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'exchangeRate、exchangeRateSource、exchangeRateSourceCurrency、exchangeRateAsOf 必须同时提供',
      path: ['exchangeRate'],
    });
  }
});

export const historicalPlatformLossPreviewSchema = historicalPlatformLossCommonSchema;

export const historicalPlatformLossCreateSchema = historicalPlatformLossCommonSchema.and(z.object({
  expectedFingerprint: sha256Schema.transform((value) => value.toLowerCase()),
  idempotencyKey: trimmedText('idempotencyKey', 200),
}));

export const historicalPlatformLossApproveSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  expectedFingerprint: sha256Schema.transform((value) => value.toLowerCase()),
  reason: trimmedText('reason', HISTORICAL_PLATFORM_LOSS_TEXT_LIMITS.reason),
  idempotencyKey: trimmedText('idempotencyKey', 200),
}).strict();

export type HistoricalPlatformLossPreviewRequest = z.infer<
  typeof historicalPlatformLossPreviewSchema
>;
export type HistoricalPlatformLossCreateRequest = z.infer<
  typeof historicalPlatformLossCreateSchema
>;
export type HistoricalPlatformLossApproveRequest = z.infer<
  typeof historicalPlatformLossApproveSchema
>;

export function parseHistoricalPlatformLossPreview(
  body: unknown,
): HistoricalPlatformLossPreviewRequest {
  return parseBody(historicalPlatformLossPreviewSchema, body);
}

export function parseHistoricalPlatformLossCreate(
  body: unknown,
): HistoricalPlatformLossCreateRequest {
  return parseBody(historicalPlatformLossCreateSchema, body);
}

export function parseHistoricalPlatformLossApproval(
  body: unknown,
): HistoricalPlatformLossApproveRequest {
  return parseBody(historicalPlatformLossApproveSchema, body);
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues[0]?.message || '参数不合法');
  }
  return result.data;
}
