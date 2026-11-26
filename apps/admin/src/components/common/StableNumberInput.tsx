import { useEffect, useMemo, useState } from 'react';
import { Input, type InputProps } from 'antd';

export interface StableNumberInputProps
  extends Omit<InputProps, 'value' | 'defaultValue' | 'onChange' | 'type'> {
  value?: number | string | null;
  onChange?: (value: number | null) => void;
  min?: number;
  max?: number;
  precision?: number;
  step?: number;
  formatter?: (value: number | string | undefined) => string;
  parser?: (value: string | undefined) => number | null;
}

function toDisplayValue(value: StableNumberInputProps['value']): string {
  if (value == null || value === '') return '';
  return String(value);
}

function parseDraft(
  value: string,
  parser?: StableNumberInputProps['parser'],
): number | null {
  if (value === '' || value === '-' || value === '.' || value === '-.') return null;
  const next = parser ? parser(value) : Number(value);
  return Number.isFinite(next) ? next : null;
}

function normalizeValue(
  value: number | null,
  min?: number,
  max?: number,
  precision?: number,
): number | null {
  if (value == null) return null;
  let next = value;
  if (typeof min === 'number' && Number.isFinite(min)) next = Math.max(min, next);
  if (typeof max === 'number' && Number.isFinite(max)) next = Math.min(max, next);
  if (typeof precision === 'number' && Number.isFinite(precision)) {
    const factor = 10 ** precision;
    const step = 1 / factor;
    const rounded = Math.round(next * factor) / factor;
    // 0.005 + precision=2 会进到 0.01；金额输入要保留原值交给「大于 0」校验。
    if (next > 0 && next < step && rounded >= step) {
      next = 0;
    } else if (next < 0 && next > -step && rounded <= -step) {
      next = 0;
    } else {
      next = rounded;
    }
  }
  return next;
}

function formatValue(
  value: number | null,
  precision?: number,
  formatter?: StableNumberInputProps['formatter'],
): string {
  if (value == null) return '';
  if (formatter) return formatter(value);
  if (typeof precision === 'number' && Number.isFinite(precision)) {
    return value.toFixed(precision);
  }
  return String(value);
}

export function StableNumberInput({
  value,
  onChange,
  min,
  max,
  precision,
  step,
  formatter,
  parser,
  inputMode,
  onBlur,
  onFocus,
  onKeyDown,
  ...rest
}: StableNumberInputProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState(() =>
    formatValue(
      typeof value === 'number' ? value : parseDraft(String(value ?? ''), parser),
      precision,
      formatter,
    ),
  );

  useEffect(() => {
    if (!focused) {
      setDraft(
        formatValue(
          typeof value === 'number' ? value : parseDraft(String(value ?? ''), parser),
          precision,
          formatter,
        ),
      );
    }
  }, [focused, formatter, parser, precision, value]);

  const pattern = useMemo(() => {
    const allowNegative = typeof min !== 'number' || min < 0;
    return allowNegative ? /^-?\d*(\.\d*)?$/ : /^\d*(\.\d*)?$/;
  }, [min]);

  return (
    <Input
      {...rest}
      value={draft}
      inputMode={inputMode ?? (precision === 0 ? 'numeric' : 'decimal')}
      onFocus={(event) => {
        setFocused(true);
        setDraft(toDisplayValue(value));
        onFocus?.(event);
      }}
      onBlur={(event) => {
        setFocused(false);
        const normalized = normalizeValue(parseDraft(draft, parser), min, max, precision);
        setDraft(formatValue(normalized, precision, formatter));
        const current = typeof value === 'number'
          ? value
          : parseDraft(String(value ?? ''), parser);
        if (normalized !== current) {
          onChange?.(normalized);
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return;
        const nextStep = typeof step === 'number' && Number.isFinite(step) && step > 0 ? step : 1;
        const current = parseDraft(draft, parser);
        const base = current ?? (event.key === 'ArrowUp' ? min ?? 0 : max ?? 0);
        const next = normalizeValue(
          base + (event.key === 'ArrowUp' ? nextStep : -nextStep),
          min,
          max,
          precision,
        );
        if (next === current) return;
        event.preventDefault();
        setDraft(formatValue(next, precision, formatter));
        onChange?.(next);
      }}
      onChange={(event) => {
        const nextDraft = event.target.value.trim();
        if (!pattern.test(nextDraft)) return;
        setDraft(nextDraft);
        onChange?.(parseDraft(nextDraft, parser));
      }}
    />
  );
}
