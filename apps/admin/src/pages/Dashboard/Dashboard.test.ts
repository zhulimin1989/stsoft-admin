import { describe, expect, it } from 'vitest';
import { productRevenueShare } from './index';

describe('productRevenueShare', () => {
  it('does not render a bar for zero revenue products', () => {
    expect(productRevenueShare(0, 1022000)).toBe(0);
  });

  it('keeps a minimum visible bar for non-zero smaller products', () => {
    expect(productRevenueShare(1, 1022000)).toBe(3);
  });

  it('uses the top product as the full-width baseline', () => {
    expect(productRevenueShare(1022000, 1022000)).toBe(100);
  });
});
