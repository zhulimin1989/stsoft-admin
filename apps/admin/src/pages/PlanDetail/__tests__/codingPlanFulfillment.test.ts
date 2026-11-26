import { describe, expect, it } from 'vitest';
import { normalizePlanFeatures } from '../codingPlanFulfillment';

describe('plan feature normalization', () => {
  it('keeps non-empty feature strings from arrays', () => {
    expect(normalizePlanFeatures(['priority_access', '', 3, 'team'])).toEqual([
      'priority_access',
      'team',
    ]);
  });

  it('parses json feature strings', () => {
    expect(normalizePlanFeatures('["priority_access","team",3]')).toEqual([
      'priority_access',
      'team',
    ]);
  });

  it('falls back to an empty list for invalid values', () => {
    expect(normalizePlanFeatures('not-json')).toEqual([]);
    expect(normalizePlanFeatures(null)).toEqual([]);
  });
});
