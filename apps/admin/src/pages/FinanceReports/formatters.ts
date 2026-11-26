import { currencySymbol, formatCurrencyCents } from '../../utils/price';

export function formatExactDecimal(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const raw = String(value).trim();
  if (!raw) return '—';
  let text = raw;
  if (/e/i.test(text)) {
    const num = Number(text);
    if (!Number.isFinite(num)) return '—';
    text = num.toLocaleString('zh-CN', {
      useGrouping: false,
      maximumFractionDigits: 20,
    });
  }
  if (!/^-?\d+(\.\d+)?$/.test(text)) return '—';
  const [integer, fraction = ''] = text.split('.');
  const negative = integer.startsWith('-');
  const normalizedInteger = integer.replace(/^-/, '').replace(/^0+(?=\d)/, '');
  const significantFraction = fraction.replace(/0+$/, '');
  const normalized = `${negative ? '-' : ''}${normalizedInteger}${significantFraction ? `.${significantFraction}` : ''}`;
  return /^-0(?:\.0+)?$/.test(normalized) ? '0' : normalized;
}

function shiftExactDecimal(value: unknown, places: number): string {
  const normalized = formatExactDecimal(value);
  if (normalized === '—') return normalized;
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [integer, fraction = ''] = unsigned.split('.');
  const digits = `${integer}${fraction}`;
  const decimalIndex = integer.length + places;
  let shifted: string;
  if (decimalIndex <= 0) {
    shifted = `0.${'0'.repeat(-decimalIndex)}${digits}`;
  } else if (decimalIndex >= digits.length) {
    shifted = `${digits}${'0'.repeat(decimalIndex - digits.length)}`;
  } else {
    shifted = `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  }
  return formatExactDecimal(`${negative ? '-' : ''}${shifted}`);
}

export function formatExactMinorUnitMoney(
  value: unknown,
  currency: string,
  rawMajorUnit?: unknown,
): string {
  const amount = rawMajorUnit === null || rawMajorUnit === undefined || rawMajorUnit === ''
    ? shiftExactDecimal(value, -2)
    : formatExactDecimal(rawMajorUnit);
  return amount === '—' ? amount : `${currencySymbol(currency)}${amount}`;
}

export function formatFinanceTableMoney(
  value: unknown,
  currency: string,
  options: { summary: boolean; rawMajorUnit?: unknown },
): string {
  if (!options.summary) {
    return formatExactMinorUnitMoney(value, currency, options.rawMajorUnit);
  }
  if (value === null || value === undefined || value === '') return '—';
  const num = Number(value);
  return Number.isFinite(num) ? formatCurrencyCents(num, currency) : '—';
}

export function formatExactRatioPercent(value: unknown): string {
  const percentage = shiftExactDecimal(value, 2);
  return percentage === '—' ? percentage : `${percentage}%`;
}
