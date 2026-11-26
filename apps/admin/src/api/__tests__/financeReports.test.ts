import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('../axios', () => ({
  default: {
    get: mocks.get,
  },
}));

import { financeReportsApi } from '../admin';

describe('financeReportsApi', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.get.mockResolvedValue({ data: { data: { rows: [] } } });
  });

  it('passes the structured filter and cursor pagination to the details endpoint', async () => {
    const params = {
      month: '2026-07',
      tab: 'buyGiftConsumptionDetails',
      billingMode: 'PAY_AS_YOU_GO',
      pageSize: 50,
      cursor: 'next-cursor',
      filterField: 'model',
      filterValue: 'claude-sonnet',
    };

    await financeReportsApi.detail(params);

    expect(mocks.get).toHaveBeenCalledWith('/admin/finance-reports/details', { params });
  });
});
