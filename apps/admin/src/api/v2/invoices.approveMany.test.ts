import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoiceApi } from './invoices';
import api from '../axios';

vi.mock('../axios', () => ({
  default: { post: vi.fn() },
}));

afterEach(() => {
  vi.mocked(api.post).mockReset();
});

describe('invoiceApi.approveMany', () => {
  it('逐张审核并通过去重，收集部分失败', async () => {
    vi.mocked(api.post)
      .mockResolvedValueOnce({ data: { data: { id: 'inv-1' } } })
      .mockRejectedValueOnce({ response: { data: { message: '状态不允许' } } })
      .mockResolvedValueOnce({ data: { data: { id: 'inv-3' } } });

    await expect(invoiceApi.approveMany(['inv-1', ' inv-2 ', 'inv-1', 'inv-3'])).resolves.toEqual({
      succeeded: ['inv-1', 'inv-3'],
      failed: [{ id: 'inv-2', message: '状态不允许' }],
    });
    expect(api.post).toHaveBeenCalledTimes(3);
    expect(api.post).toHaveBeenNthCalledWith(1, '/admin/invoices/inv-1/approve', { remark: undefined });
    expect(api.post).toHaveBeenNthCalledWith(2, '/admin/invoices/inv-2/approve', { remark: undefined });
    expect(api.post).toHaveBeenNthCalledWith(3, '/admin/invoices/inv-3/approve', { remark: undefined });
  });
});
