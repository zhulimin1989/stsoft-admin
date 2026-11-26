import { afterEach, describe, expect, it, vi } from 'vitest';
import { invoiceApi, type InvoiceApplication, type InvoiceStatus } from '../../api/v2/invoices';
import { exportInvoiceData, invoiceCsv } from './export';

vi.mock('../../api/v2/invoices', () => ({ invoiceApi: { list: vi.fn() } }));

const labels = { ISSUED: '已开票' } as Record<InvoiceStatus, string>;
const invoice = {
  id: 'inv-1', applicationNo: 'APP-1', userId: 'user-1', tenantId: 'tenant-1', status: 'ISSUED',
  currency: 'USD', subtotalCents: 1234, taxAmountCents: 0, totalCents: 1234,
  invoiceNumber: 'INV-001', createdAt: '2026-09-22T00:00:00Z', dueDate: '2026-10-22T00:00:00Z',
  user: { id: 'user-1', email: 'user@example.com', nickname: 'Alice' },
  profileSnapshot: {
    kind: 'ENTERPRISE', invoiceType: 'COMMERCIAL_HK', title: '=1+1', taxNo: '税号,"测试"\n第二行',
    bankName: 'HSBC', bankAccount: '123456', registeredAddress: 'HK', registeredPhone: '852-1',
    recipientName: 'Bob', recipientEmail: 'billing@example.com', recipientPhone: '13800000000',
    recipientAddress: '收件地址',
  },
  items: [{ orderId: 'order-1', description: '套餐', poNumber: 'PO-9', serviceStart: '2026-09-01', serviceEnd: '2026-09-30' }],
} as InvoiceApplication;

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.mocked(invoiceApi.list).mockReset(); });

function mockDownload() {
  const createObjectURL = vi.fn(() => 'blob:invoices');
  const revokeObjectURL = vi.fn();
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
  const downloads: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
  return { createObjectURL, revokeObjectURL, downloads };
}

describe('发票业务数据导出', () => {
  it('正确输出中文、金额、引号和换行，并避免公式注入', () => {
    const csv = invoiceCsv([invoice], labels, true);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"12.34","0.00","12.34"');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"税号,""测试""\n第二行"');
    expect(csv).toContain('"发票号"');
    expect(csv).toContain('"INV-001"');
    expect(csv).toContain('"接收邮箱"');
    expect(csv).toContain('"billing@example.com"');
    expect(csv).toContain('"接收人"');
    expect(csv).toContain('"Bob"');
    expect(csv).toContain('"收件地址"');
    expect(csv).toContain('"PO-9"');
    expect(csv).toContain('"user@example.com"');
    const otherTabCsv = invoiceCsv([invoice], labels, false);
    expect(otherTabCsv).toContain('"接收邮箱"');
    expect(otherTabCsv).toContain('"billing@example.com"');
    expect(otherTabCsv).not.toContain('"发票号"');
    expect(otherTabCsv).not.toContain('INV-001');
  });

  it('从第一页导出所有分页，保留筛选条件并在文件名标记业务标签', async () => {
    const download = mockDownload();
    // 模拟服务端将每页数量限制为 1，导出仍应遵循返回的总页数。
    vi.mocked(invoiceApi.list)
      .mockResolvedValueOnce({ items: [invoice], total: 2, page: 1, pageSize: 1, totalPages: 2 })
      .mockResolvedValueOnce({ items: [{ ...invoice, id: 'inv-2' }], total: 2, page: 2, pageSize: 1, totalPages: 2 });
    expect(await exportInvoiceData({ status: 'ISSUED', email: 'test@example.com', page: 9 }, '已开票', labels)).toBe(2);
    expect(invoiceApi.list).toHaveBeenNthCalledWith(1, { status: 'ISSUED', email: 'test@example.com', page: 1, pageSize: 100 });
    expect(invoiceApi.list).toHaveBeenNthCalledWith(2, { status: 'ISSUED', email: 'test@example.com', page: 2, pageSize: 100 });
    expect(download.downloads[0]).toMatch(/^发票-已开票-\d{8}-\d{6}\.csv$/);
    expect(download.revokeObjectURL).toHaveBeenCalledWith('blob:invoices');
  });

  it('空结果不下载文件，翻页失败不下载部分数据', async () => {
    const download = mockDownload();
    vi.mocked(invoiceApi.list).mockResolvedValueOnce({ items: [], total: 0, page: 1, pageSize: 100, totalPages: 0 });
    expect(await exportInvoiceData({}, '全部', labels)).toBe(0);
    vi.mocked(invoiceApi.list)
      .mockResolvedValueOnce({ items: [invoice], total: 2, page: 1, pageSize: 1, totalPages: 2 })
      .mockRejectedValueOnce(new Error('网络错误'));
    await expect(exportInvoiceData({}, '全部', labels)).rejects.toThrow('网络错误');
    expect(download.createObjectURL).not.toHaveBeenCalled();
  });
});
