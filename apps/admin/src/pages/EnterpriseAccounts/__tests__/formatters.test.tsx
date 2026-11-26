import { describe, expect, it } from 'vitest';
import { formatEnterpriseModelPrice, yuanToPositiveCents } from '../formatters';

describe('formatEnterpriseModelPrice', () => {
  it('formats model prices with the deployment currency', () => {
    expect(formatEnterpriseModelPrice(2.5, 'cny')).toBe('¥2.50');
    expect(formatEnterpriseModelPrice(0.001, 'sgd')).toBe('S$0.001000');
  });

  it('keeps the empty placeholder for missing prices', () => {
    expect(formatEnterpriseModelPrice(null, 'cny')).toBe('—');
    expect(formatEnterpriseModelPrice(Number.POSITIVE_INFINITY, 'cny')).toBe('—');
  });
});

describe('yuanToPositiveCents', () => {
  it('rejects zero, negative and sub-cent amounts instead of rounding up to 1 cent', () => {
    expect(yuanToPositiveCents(0)).toBeNull();
    expect(yuanToPositiveCents(-1)).toBeNull();
    expect(yuanToPositiveCents(0.004)).toBeNull();
    expect(yuanToPositiveCents(0.009)).toBeNull();
    expect(yuanToPositiveCents('0')).toBeNull();
  });

  it('converts a valid yuan amount to cents', () => {
    expect(yuanToPositiveCents(0.01)).toBe(1);
    expect(yuanToPositiveCents(1.25)).toBe(125);
  });
});
