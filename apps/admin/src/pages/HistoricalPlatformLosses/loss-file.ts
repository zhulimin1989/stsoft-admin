import type {
  HistoricalPlatformLossLineInput,
  HistoricalPlatformLossLineType,
} from '../../api/admin';

export interface NormalizedUsageRow {
  lineNumber: number;
  lineType: HistoricalPlatformLossLineType;
  sourceRowRef: string;
  serviceDate: string;
  model: string;
  meter: string;
  platformUsage: string;
  providerUsage: string;
  requestId?: string;
  upstreamRequestId?: string;
  providerAggregateRef?: string;
  sourceEvidence: Record<string, unknown>;
}

export interface PricingEvidenceEntry {
  sourceRef: string;
  version: string;
  model: string;
  meter: string;
  pricingCurrency: string;
  customerRatePerMillion: string;
  providerCostRatePerMillion: string;
  effectiveFrom: string;
  effectiveTo: string;
  approvedBy: string;
  approvedAt: string;
  pricingDocumentSha256: string;
  pricingEvidenceHash: string;
  pricingEvidence: Record<string, unknown>;
}

export interface ParsedPricingEvidenceFile {
  filename: string;
  sha256: string;
  entries: PricingEvidenceEntry[];
  issues: FileParseIssue[];
}

export interface FileParseIssue {
  lineNumber?: number;
  code: string;
  message: string;
}

export interface ParsedUsageFile {
  filename: string;
  sha256: string;
  rows: NormalizedUsageRow[];
  issues: FileParseIssue[];
}

export interface ValuationSelection {
  version: string;
  pricingCurrency: string;
}

const FIELD_ALIASES: Record<string, string[]> = {
  lineType: ['linetype', 'line_type', '类型'],
  sourceRowRef: ['sourcerowref', 'source_row_ref', '源行'],
  serviceDate: ['servicedate', 'service_date', 'date', 'day', '日期'],
  model: ['model', '模型'],
  meter: ['meter', 'metric', '计量项', '用量类型'],
  platformUsage: ['platformusage', 'platform_usage', 'platformtoken', '平台用量', '平台token'],
  providerUsage: ['providerusage', 'provider_usage', 'providerstatementusage', '供应商用量', '智谱用量'],
  requestId: ['requestid', 'request_id', '请求id'],
  upstreamRequestId: ['upstreamrequestid', 'upstream_request_id', '上游请求id'],
  providerAggregateRef: ['provideraggregateref', 'provider_aggregate_ref', '供应商聚合标识'],
};

const CANONICAL_BY_ALIAS = new Map<string, string>();
for (const [canonical, aliases] of Object.entries(FIELD_ALIASES)) {
  for (const alias of aliases) CANONICAL_BY_ALIAS.set(normalizeHeader(alias), canonical);
}

export const STANDARD_USAGE_CSV_TEMPLATE = [
  'serviceDate,model,meter,platformUsage,providerUsage,lineType,providerAggregateRef,requestId,upstreamRequestId',
  '2026-07-01,glm-5.2,INPUT,1000000,1100000,PROVIDER_AGGREGATE,2026-07-01|glm-5.2|INPUT,,',
].join('\n');

export const PRICING_EVIDENCE_JSON_TEMPLATE = `${JSON.stringify([
  {
    sourceRef: 'oss://finance-pricing/glm-2026-07-v1.json?versionId=immutable',
    version: 'glm-2026-07-v1',
    model: 'glm-5.2',
    meter: 'INPUT',
    pricingCurrency: 'CNY',
    customerRatePerMillion: '4.000000000000',
    providerCostRatePerMillion: '2.000000000000',
    effectiveFrom: '2026-07-01',
    effectiveTo: '2026-08-01',
    approvedBy: 'finance-pricing-committee',
    approvedAt: '2026-06-30T08:00:00.000Z',
  },
], null, 2)}\n`;

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function parseNormalizedUsageFile(file: File): Promise<ParsedUsageFile> {
  const sha256 = await sha256File(file);
  const extension = extensionOf(file.name);
  if (extension === 'xlsx' || extension === 'xls') {
    return {
      filename: file.name,
      sha256,
      rows: [],
      issues: [{
        code: 'XLSX_REQUIRES_NORMALIZATION',
        message: 'Excel 原件只用于绑定来源 SHA-256；请勿直接另存 CSV。须先向下填充合并的日期/模型，再按页面映射转换为标准 CSV/JSON。',
      }],
    };
  }
  if (!['csv', 'json'].includes(extension)) {
    return {
      filename: file.name,
      sha256,
      rows: [],
      issues: [{ code: 'UNSUPPORTED_FILE_TYPE', message: '标准明细仅支持 .csv 或 .json' }],
    };
  }

  const text = await file.text();
  const parsed = parseNormalizedUsageText(file.name, text);
  return { filename: file.name, sha256, ...parsed };
}

export async function parsePricingEvidenceFile(file: File): Promise<ParsedPricingEvidenceFile> {
  const sha256 = await sha256File(file);
  if (extensionOf(file.name) !== 'json') {
    return {
      filename: file.name,
      sha256,
      entries: [],
      issues: [{ code: 'PRICING_EVIDENCE_JSON_REQUIRED', message: '历史价目证据仅支持标准 JSON' }],
    };
  }
  const parsed = await parsePricingEvidenceText(await file.text(), sha256);
  return { filename: file.name, sha256, ...parsed };
}

export async function parsePricingEvidenceText(
  text: string,
  documentSha256?: string,
): Promise<Pick<ParsedPricingEvidenceFile, 'entries' | 'issues'>> {
  const pricingDocumentSha256 = documentSha256 ?? await sha256Text(text);
  let rawEntries: Record<string, unknown>[];
  try {
    const parsed: unknown = JSON.parse(text);
    const value = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed)
        ? parsed.entries ?? parsed.rows ?? parsed.items
        : null;
    if (!Array.isArray(value) || !value.every(isRecord)) {
      throw new Error('价目证据 JSON 必须是对象数组，或包含 entries/rows/items 数组');
    }
    rawEntries = value as Record<string, unknown>[];
  } catch (error) {
    return {
      entries: [],
      issues: [{
        code: 'PRICING_EVIDENCE_PARSE_FAILED',
        message: error instanceof Error ? error.message : '历史价目证据无法解析',
      }],
    };
  }

  const entries: PricingEvidenceEntry[] = [];
  const issues: FileParseIssue[] = [];
  for (let index = 0; index < rawEntries.length; index += 1) {
    const lineNumber = index + 1;
    const raw = rawEntries[index];
    const sourceRef = textValue(raw.sourceRef);
    const version = textValue(raw.version);
    const model = textValue(raw.model);
    const meter = textValue(raw.meter).toUpperCase();
    const pricingCurrency = textValue(raw.pricingCurrency).toUpperCase();
    const customerRatePerMillion = fixed12Decimal(textValue(raw.customerRatePerMillion));
    const providerCostRatePerMillion = fixed12Decimal(textValue(raw.providerCostRatePerMillion));
    const effectiveFrom = normalizeDate(textValue(raw.effectiveFrom));
    const effectiveTo = normalizeDate(textValue(raw.effectiveTo));
    const approvedBy = textValue(raw.approvedBy);
    const approvedAt = normalizeIsoDateTime(textValue(raw.approvedAt));
    const missing = [
      ['sourceRef', sourceRef],
      ['version', version],
      ['model', model],
      ['meter', meter],
      ['pricingCurrency', pricingCurrency],
      ['customerRatePerMillion', customerRatePerMillion],
      ['providerCostRatePerMillion', providerCostRatePerMillion],
      ['effectiveFrom', effectiveFrom],
      ['effectiveTo', effectiveTo],
      ['approvedBy', approvedBy],
      ['approvedAt', approvedAt],
    ].filter(([, value]) => !value).map(([field]) => field);
    if (missing.length) {
      issues.push({
        lineNumber,
        code: 'PRICING_EVIDENCE_INVALID',
        message: `价目证据缺少或格式错误：${missing.join(', ')}`,
      });
      continue;
    }
    if (!/^[A-Z]{3}$/.test(pricingCurrency)) {
      issues.push({ lineNumber, code: 'PRICING_CURRENCY_INVALID', message: 'pricingCurrency 必须是三位币种码' });
      continue;
    }
    if (effectiveFrom! >= effectiveTo!) {
      issues.push({ lineNumber, code: 'PRICING_PERIOD_INVALID', message: 'effectiveTo 必须晚于 effectiveFrom' });
      continue;
    }
    const pricingEvidence = {
      sourceRef,
      documentSha256: pricingDocumentSha256,
      version,
      model,
      meter,
      pricingCurrency,
      customerRatePerMillion,
      providerCostRatePerMillion,
      effectiveFrom,
      effectiveTo,
      approvedBy,
      approvedAt,
    };
    entries.push({
      ...pricingEvidence as Omit<
        PricingEvidenceEntry,
        'pricingDocumentSha256' | 'pricingEvidenceHash' | 'pricingEvidence'
      >,
      pricingDocumentSha256,
      pricingEvidenceHash: await canonicalSha256(pricingEvidence),
      pricingEvidence,
    });
  }
  if (!rawEntries.length) {
    issues.push({ code: 'PRICING_EVIDENCE_EMPTY', message: '历史价目证据没有条目' });
  }
  return { entries, issues };
}

export function parseNormalizedUsageText(
  filename: string,
  text: string,
): Pick<ParsedUsageFile, 'rows' | 'issues'> {
  const extension = extensionOf(filename);
  if (!['csv', 'json'].includes(extension)) {
    return {
      rows: [],
      issues: [{ code: 'UNSUPPORTED_FILE_TYPE', message: '标准明细仅支持 .csv 或 .json' }],
    };
  }
  let rawRows: Record<string, unknown>[];
  try {
    rawRows = extension === 'json' ? parseJsonRows(text) : parseCsvRows(text);
  } catch (error) {
    return {
      rows: [],
      issues: [{
        code: 'FILE_PARSE_FAILED',
        message: error instanceof Error ? error.message : '文件无法解析',
      }],
    };
  }

  const rows: NormalizedUsageRow[] = [];
  const issues: FileParseIssue[] = [];
  rawRows.forEach((rawRow, index) => {
    const lineNumber = index + 2;
    const parsed = normalizeUsageRow(rawRow, lineNumber);
    if (parsed.issues.length) issues.push(...parsed.issues);
    else if (parsed.row) rows.push(parsed.row);
  });
  if (!rawRows.length) issues.push({ code: 'EMPTY_FILE', message: '标准明细文件没有数据行' });
  return { rows, issues };
}

export function buildHistoricalPlatformLossLines(
  rows: NormalizedUsageRow[],
  selection: ValuationSelection,
  pricingEntries: PricingEvidenceEntry[],
): { lines: HistoricalPlatformLossLineInput[]; issues: FileParseIssue[] } {
  const version = selection.version.trim();
  const currency = selection.pricingCurrency.trim().toUpperCase();
  const issues: FileParseIssue[] = [];
  const lines: HistoricalPlatformLossLineInput[] = [];

  for (const row of rows) {
    if (!version) {
      issues.push({ lineNumber: row.lineNumber, code: 'VALUATION_VERSION_REQUIRED', message: '必须选择历史价目版本' });
      continue;
    }
    if (!currency) {
      issues.push({
        lineNumber: row.lineNumber,
        code: 'PRICING_CURRENCY_MISMATCH',
        message: '必须选择计价币种',
      });
      continue;
    }
    const matchingPricing = pricingEntries.filter((entry) => (
      entry.version === version
      && entry.model === row.model
      && entry.meter === row.meter
      && entry.pricingCurrency === currency
      && row.serviceDate >= entry.effectiveFrom
      && row.serviceDate < entry.effectiveTo
    ));
    if (matchingPricing.length !== 1) {
      issues.push({
        lineNumber: row.lineNumber,
        code: matchingPricing.length ? 'PRICING_EVIDENCE_AMBIGUOUS' : 'PRICING_EVIDENCE_NOT_FOUND',
        message: matchingPricing.length
          ? '同一服务日期/model/meter 匹配到多个历史价目证据'
          : '未找到覆盖该服务日期/model/meter/币种的已审批历史价目证据',
      });
      continue;
    }
    const pricing = matchingPricing[0];

    lines.push({
      lineType: row.lineType,
      sourceRowRef: row.sourceRowRef,
      sourceEvidence: row.sourceEvidence,
      serviceDate: row.serviceDate,
      model: row.model,
      meter: row.meter,
      platformUsage: row.platformUsage,
      providerUsage: row.providerUsage,
      valuationBasis: {
        version,
        rateUnit: 'TOKENS_PER_MILLION',
        pricingCurrency: currency,
        customerRatePerMillion: pricing.customerRatePerMillion,
        providerCostRatePerMillion: pricing.providerCostRatePerMillion,
        pricingSourceRef: pricing.sourceRef,
        pricingDocumentSha256: pricing.pricingDocumentSha256,
        pricingEvidenceHash: pricing.pricingEvidenceHash,
        pricingEffectiveFrom: pricing.effectiveFrom,
        pricingEffectiveTo: pricing.effectiveTo,
        pricingApprovedBy: pricing.approvedBy,
        pricingApprovedAt: pricing.approvedAt,
        pricingEvidence: pricing.pricingEvidence,
      },
      ...(row.requestId ? { requestId: row.requestId } : {}),
      ...(row.upstreamRequestId ? { upstreamRequestId: row.upstreamRequestId } : {}),
      ...(row.providerAggregateRef ? { providerAggregateRef: row.providerAggregateRef } : {}),
    });
  }
  return { lines, issues };
}

function parseJsonRows(text: string): Record<string, unknown>[] {
  const parsed: unknown = JSON.parse(text);
  const value = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed)
      ? parsed.rows ?? parsed.lines ?? parsed.items
      : null;
  if (!Array.isArray(value)) throw new Error('JSON 必须是明细数组，或包含 rows/lines/items 数组');
  if (!value.every(isRecord)) throw new Error('JSON 明细中的每一项都必须是对象');
  return value as Record<string, unknown>[];
}

function parseCsvRows(text: string): Record<string, unknown>[] {
  const matrix = parseCsvMatrix(text.replace(/^\uFEFF/, ''));
  if (!matrix.length) return [];
  const headers = matrix[0].map((header) => canonicalHeader(header));
  if (new Set(headers.filter(Boolean)).size !== headers.filter(Boolean).length) {
    throw new Error('CSV 存在重复字段名');
  }
  return matrix.slice(1)
    .filter((row) => row.some((cell) => cell.trim()))
    .map((cells) => Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ''])));
}

function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('CSV 存在未闭合的引号');
  if (cell || row.length) {
    row.push(cell.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function normalizeUsageRow(
  raw: Record<string, unknown>,
  lineNumber: number,
): { row?: NormalizedUsageRow; issues: FileParseIssue[] } {
  const values = canonicalizeRecord(raw);
  const issues: FileParseIssue[] = [];
  const lineType = textValue(values.lineType) || 'PROVIDER_AGGREGATE';
  const serviceDate = normalizeDate(textValue(values.serviceDate));
  const model = textValue(values.model);
  const meter = textValue(values.meter).toUpperCase();
  const platformUsage = normalizeUsage(textValue(values.platformUsage));
  const providerUsage = normalizeUsage(textValue(values.providerUsage));
  const requestId = optionalText(values.requestId);
  const upstreamRequestId = optionalText(values.upstreamRequestId);
  const providerAggregateRef = optionalText(values.providerAggregateRef)
    || (serviceDate && model && meter ? `${serviceDate}|${model}|${meter}` : undefined);

  if (!['MISSING_ANCHOR_REQUEST', 'PROVIDER_AGGREGATE'].includes(lineType)) {
    issues.push({ lineNumber, code: 'INVALID_LINE_TYPE', message: `不支持的 lineType: ${lineType}` });
  }
  if (!serviceDate) issues.push({ lineNumber, code: 'SERVICE_DATE_REQUIRED', message: '缺少有效的 date/serviceDate' });
  if (!model) issues.push({ lineNumber, code: 'MODEL_REQUIRED', message: '缺少 model' });
  if (!meter) issues.push({ lineNumber, code: 'METER_REQUIRED', message: '缺少 meter' });
  if (!platformUsage) issues.push({ lineNumber, code: 'PLATFORM_USAGE_INVALID', message: 'platformUsage 必须是非负整数' });
  if (!providerUsage) issues.push({ lineNumber, code: 'PROVIDER_USAGE_INVALID', message: 'providerUsage 必须是非负整数' });
  if (lineType === 'MISSING_ANCHOR_REQUEST' && !requestId) {
    issues.push({ lineNumber, code: 'REQUEST_ID_REQUIRED', message: '逐请求缺失锚点行必须提供 requestId' });
  }
  if (lineType === 'PROVIDER_AGGREGATE' && requestId) {
    issues.push({ lineNumber, code: 'AGGREGATE_REQUEST_ID_FORBIDDEN', message: '供应商聚合行不能填写 requestId' });
  }
  if (issues.length) return { issues };

  return {
    issues,
    row: {
      lineNumber,
      lineType: lineType as HistoricalPlatformLossLineType,
      sourceRowRef: optionalText(values.sourceRowRef) || String(lineNumber),
      serviceDate: serviceDate!,
      model,
      meter,
      platformUsage: platformUsage!,
      providerUsage: providerUsage!,
      ...(requestId ? { requestId } : {}),
      ...(upstreamRequestId ? { upstreamRequestId } : {}),
      ...(lineType === 'PROVIDER_AGGREGATE' && providerAggregateRef ? { providerAggregateRef } : {}),
      sourceEvidence: raw,
    },
  };
}

function canonicalizeRecord(raw: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[canonicalHeader(key)] = value;
  }
  return result;
}

function canonicalHeader(value: string): string {
  return CANONICAL_BY_ALIAS.get(normalizeHeader(value)) ?? value.trim();
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_.-]+/g, '');
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function optionalText(value: unknown): string | undefined {
  return textValue(value) || undefined;
}

function normalizeUsage(value: string): string | null {
  const normalized = value.replace(/,/g, '').trim();
  return /^(?:0|[1-9]\d*)$/.test(normalized) ? normalized : null;
}

function normalizeDate(value: string): string | null {
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${matched[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function fixed12Decimal(value: string): string | null {
  const matched = /^(?:0|[1-9]\d*)(?:\.(\d+))?$/.exec(value.trim());
  if (!matched || (matched[1]?.length ?? 0) > 12) return null;
  const [integer, fraction = ''] = value.trim().split('.');
  return `${integer}.${fraction.padEnd(12, '0')}`;
}

function normalizeIsoDateTime(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

async function canonicalSha256(value: unknown): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function extensionOf(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
