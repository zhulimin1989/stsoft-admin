import { describe, expect, it } from 'vitest';
import {
  normalizePlanPriceCurrency,
  planPriceCurrencyOptions,
} from '../planPriceCurrency';

describe('plan price currency defaults', () => {
  it('uses the current deployment currency instead of a fixed default', () => {
    expect(normalizePlanPriceCurrency('CNY')).toBe('cny');
    expect(normalizePlanPriceCurrency('sgd')).toBe('sgd');
  });

  it('puts a configured platform currency first and avoids duplicates', () => {
    expect(planPriceCurrencyOptions('HKD')[0]).toEqual({ value: 'hkd', label: 'HKD' });
    expect(planPriceCurrencyOptions('CNY').filter((item) => item.value === 'cny')).toHaveLength(1);
  });
});
