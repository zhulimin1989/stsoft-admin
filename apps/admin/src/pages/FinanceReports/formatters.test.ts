import { describe, expect, it } from 'vitest';
import {
  formatExactDecimal,
  formatExactMinorUnitMoney,
  formatExactRatioPercent,
  formatFinanceTableMoney,
} from './formatters';

describe('finance detail value formatters', () => {
  it('uses the backend raw major-unit amount instead of rounded cents', () => {
    expect(formatExactMinorUnitMoney(1, 'USD', '0.005')).toBe('$0.005');
    expect(formatExactMinorUnitMoney(-14, 'CNY', '-0.14356789')).toBe('¥-0.14356789');
  });

  it('keeps two decimals only for summary tables', () => {
    expect(formatFinanceTableMoney(1, 'USD', { summary: true, rawMajorUnit: '0.005' })).toBe('$0.01');
    expect(formatFinanceTableMoney(1, 'USD', { summary: false, rawMajorUnit: '0.005' })).toBe('$0.005');
  });

  it('converts minor units by moving the decimal point without rounding', () => {
    expect(formatExactMinorUnitMoney(1, 'USD')).toBe('$0.01');
    expect(formatExactMinorUnitMoney('0.5', 'USD')).toBe('$0.005');
    expect(formatExactMinorUnitMoney('-0.5', 'USD')).toBe('$-0.005');
  });

  it('shows detail ratios at their available precision', () => {
    expect(formatExactRatioPercent('0.333333333333')).toBe('33.3333333333%');
    expect(formatExactRatioPercent('1')).toBe('100%');
  });

  it('trims storage padding without changing significant digits', () => {
    expect(formatExactDecimal('0.005000000000')).toBe('0.005');
    expect(formatExactDecimal('-0.000000000000')).toBe('0');
  });
});
