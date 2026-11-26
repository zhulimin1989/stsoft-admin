import { describe, expect, it } from 'vitest';
import {
  centsToDollars,
  dollarInputProps,
  dollarsToCents,
  formatCurrencyCents,
  formatDollarPrice,
  formatModelUnitPrice,
  modelUnitPriceInputProps,
  normalizeCurrency,
} from '../price';

describe('price utilities', () => {
  it('keeps stored dollar values unchanged', () => {
    expect(centsToDollars(2.5)).toBe(2.5);
    expect(dollarsToCents(0.1)).toBe(0.1);
    expect(centsToDollars(null)).toBeNull();
    expect(dollarsToCents(Number.NaN)).toBeNull();
  });

  it('formats prices with adaptive precision', () => {
    expect(formatDollarPrice(2.5)).toBe('$2.50/M');
    expect(formatDollarPrice(0.1)).toBe('$0.1000/M');
    expect(formatDollarPrice(0.00012)).toBe('$0.000120/M');
    expect(formatDollarPrice(null, { emptyText: 'N/A' })).toBe('N/A');
    expect(formatDollarPrice(1.2345, { precision: 3, unit: '/K' })).toBe('$1.234/K');
    expect(formatModelUnitPrice(2.5, 'cny')).toBe('¥2.50/M');
    expect(formatModelUnitPrice(0.001, 'sgd')).toBe('S$0.001000/M');
  });

  it('formats minor-unit amounts with the requested currency', () => {
    expect(normalizeCurrency('usd')).toBe('USD');
    expect(normalizeCurrency(' usd ')).toBe('USD');
    expect(normalizeCurrency('bad-code')).toBe('USD');
    expect(normalizeCurrency(undefined, 'cny')).toBe('CNY');

    expect(formatCurrencyCents(500, 'usd')).toBe('$5.00');
    expect(formatCurrencyCents(500, 'cny')).toBe('¥5.00');
    expect(formatCurrencyCents(500, 'sgd')).toBe('S$5.00');
    expect(formatCurrencyCents(500, 'aud')).toBe('AUD 5.00');
    expect(formatCurrencyCents(0, 'cny', { zeroAsEmpty: true })).toBe('—');
    expect(formatCurrencyCents(123456, 'cny', { fractionDigits: 0 })).toBe('¥1,235');
  });

  it('parses and formats dollar input values', () => {
    expect(dollarInputProps.formatter(2)).toBe('$ 2.00');
    expect(dollarInputProps.formatter(0.001)).toBe('$ 0.001000');
    expect(dollarInputProps.formatter('bad')).toBe('');
    expect(dollarInputProps.formatter(undefined)).toBe('');

    expect(dollarInputProps.parser('$ 1.234')).toBe(1.234);
    expect(dollarInputProps.parser(undefined)).toBe(0);
    expect(dollarInputProps.parser('abc')).toBe(0);

    const cnyInputProps = modelUnitPriceInputProps('cny');
    expect(cnyInputProps.formatter(2)).toBe('¥ 2.00');
    expect(cnyInputProps.parser('¥ 1.234')).toBe(1.234);
  });
});
