/**
 * 价格单位转换工具(2026-05-02)
 *
 * 模型价格库存储为主币种金额 / 1M token(浮点)
 *   例:input $2.50/M = 2.5
 *   例:cache read ¥0.10/M = 0.1
 */

/** Backward-compatible alias: stored value is already Dollar (per 1M tokens). */
export function centsToDollars(value: number | null | undefined): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return value;
}

/** Backward-compatible alias: stored value is already Dollar (per 1M tokens). */
export function dollarsToCents(dollars: number | null | undefined): number | null {
  if (dollars == null || Number.isNaN(dollars)) return null;
  return dollars;
}

/** 显示字符串:¥2.50 / $0.0001 / —(null 时)。模型价格按传入币种展示。 */
export function formatModelUnitPrice(value: number | null | undefined, currency = DEFAULT_PLATFORM_CURRENCY, opts?: {
  unit?: string;       // 默认 '/M'
  emptyText?: string;  // 默认 '—'
  precision?: number;  // 小数位,默认按值大小自动
}): string {
  const amount = centsToDollars(value);
  if (amount == null) return opts?.emptyText ?? '—';
  const precision = opts?.precision ?? (amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6);
  const unit = opts?.unit ?? '/M';
  return `${currencySymbol(currency)}${amount.toFixed(precision)}${unit}`;
}

/** Backward-compatible USD formatter for legacy callers. Prefer formatModelUnitPrice(value, currency). */
export function formatDollarPrice(value: number | null | undefined, opts?: {
  unit?: string;
  emptyText?: string;
  precision?: number;
}): string {
  return formatModelUnitPrice(value, DEFAULT_PLATFORM_CURRENCY, opts);
}

export const DEFAULT_PLATFORM_CURRENCY = 'USD';

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  SGD: 'S$',
  EUR: '€',
  GBP: '£',
  HKD: 'HK$',
  JPY: '¥',
};

const CURRENCY_MINOR_UNIT_LABELS: Record<string, string> = {
  CNY: '分',
  USD: '美分',
  SGD: '分',
  EUR: '分',
  GBP: '便士',
  HKD: '分',
  JPY: '最小单位',
};

export function normalizeCurrency(currency: string | null | undefined, fallback = DEFAULT_PLATFORM_CURRENCY): string {
  const normalized = currency?.trim().toUpperCase();
  if (normalized && /^[A-Z]{3}$/.test(normalized)) return normalized;
  const normalizedFallback = fallback.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalizedFallback) ? normalizedFallback : DEFAULT_PLATFORM_CURRENCY;
}

export function currencySymbol(currency: string | null | undefined = DEFAULT_PLATFORM_CURRENCY): string {
  const code = normalizeCurrency(currency);
  return CURRENCY_SYMBOLS[code] ?? `${code} `;
}

export function currencyMinorUnitLabel(currency: string | null | undefined = DEFAULT_PLATFORM_CURRENCY): string {
  const code = normalizeCurrency(currency);
  return CURRENCY_MINOR_UNIT_LABELS[code] ?? '最小货币单位';
}

export function formatCurrencyCents(
  cents: number | null | undefined,
  currency: string | null | undefined = DEFAULT_PLATFORM_CURRENCY,
  opts?: {
    emptyText?: string;
    fractionDigits?: number;
    locale?: string;
    zeroAsEmpty?: boolean;
  },
): string {
  if (cents == null) return opts?.emptyText ?? `${currencySymbol(currency)}0.00`;
  if (opts?.zeroAsEmpty && cents === 0) return opts.emptyText ?? '—';
  const code = normalizeCurrency(currency);
  const amount = cents / 100;
  const fractionDigits = opts?.fractionDigits ?? 2;
  const formatted = amount.toLocaleString(opts?.locale ?? 'zh-CN', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
  return `${currencySymbol(code)}${formatted}`;
}

/**
 * antd InputNumber 的 formatter / parser 配置(展示币种符号 + 限制小数)。
 * 使用方式:
 *   <InputNumber {...modelUnitPriceInputProps(currency)} value={pricePerM} onChange={setPricePerM} />
 *   - value 是当前系统币种 / 1M token
 */
export function modelUnitPriceInputProps(currency = DEFAULT_PLATFORM_CURRENCY) {
  const symbol = currencySymbol(currency);
  return {
    // 禁用千分位逗号(token 价小数多,逗号易混淆)
    formatter: (value: number | string | undefined): string => {
      if (value === undefined || value === '' || value === null) return '';
      const amount = Number(value);
      if (Number.isNaN(amount)) return '';
      return `${symbol} ${amount.toFixed(amount >= 1 ? 2 : amount >= 0.01 ? 4 : 6)}`;
    },
    parser: (value: string | undefined): number => {
      if (!value) return 0;
      // 抽取数字 + 小数点
      const match = value.replace(/[^0-9.]/g, '');
      const amount = Number(match);
      if (Number.isNaN(amount)) return 0;
      return amount;
    },
    step: 0.0001,
    min: 0,
    precision: 6 as const,
  };
}

export const dollarInputProps = {
  formatter: (value: number | string | undefined): string => {
    return modelUnitPriceInputProps(DEFAULT_PLATFORM_CURRENCY).formatter(value);
  },
  parser: (value: string | undefined): number => {
    return modelUnitPriceInputProps(DEFAULT_PLATFORM_CURRENCY).parser(value);
  },
  step: 0.0001,
  min: 0,
  precision: 6 as const,
};
