import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App, ConfigProvider } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import InvoicesPage from './index';
import { invoiceApi, type InvoiceApplication, type InvoiceStatus } from '../../api/v2/invoices';
import { exportInvoiceData } from './export';

vi.mock('../../api/v2/invoices', () => ({
  invoiceApi: {
    list: vi.fn(),
    getDeployment: vi.fn(),
    approveMany: vi.fn(),
    downloadZip: vi.fn(),
    downloadPsaAttachment: vi.fn(),
  },
}));
vi.mock('./export', () => ({ exportInvoiceData: vi.fn() }));
vi.mock('../../hooks/usePermission', () => ({ usePermission: () => true }));

function renderPage() {
  return render(
    <MemoryRouter>
      <ConfigProvider theme={{ token: { motion: false } }}>
        <App>
          <InvoicesPage />
        </App>
      </ConfigProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(invoiceApi.list).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  vi.mocked(invoiceApi.getDeployment).mockResolvedValue({ deployment: 'international' });
  vi.mocked(invoiceApi.approveMany).mockResolvedValue({ succeeded: [], failed: [] });
  vi.mocked(invoiceApi.downloadZip).mockResolvedValue(undefined);
  vi.mocked(invoiceApi.downloadPsaAttachment).mockResolvedValue(undefined);
  vi.mocked(exportInvoiceData).mockResolvedValue(0);
});

describe('发票标签业务列表', () => {
  it('五个标签分别导出对应状态，仅已开票列表显示发票号', async () => {
    renderPage();
    const tabs = screen.getByRole('tablist');
    for (const [label, status] of [
      ['待审核', 'PENDING_REVIEW'], ['待开票', 'APPROVED_ISSUING'],
      ['已开票', 'ISSUED'], ['异常', 'FAILED'], ['全部', undefined],
    ] as const) {
      const tab = within(tabs).getByText(label, { exact: true }).closest('[role="tab"]')!;
      expect(tab).toHaveAccessibleName(label);
      await act(async () => { fireEvent.click(tab); });
      await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
      const button = screen.getByLabelText(`导出${label}数据`);
      expect(button).toHaveRole('button');
      expect(button).toHaveAccessibleName(`导出${label}数据`);
      expect(button).toBeVisible();
      await waitFor(() => expect(button).toBeEnabled());
      const headerRow = document.querySelector<HTMLTableSectionElement>('table thead')!;
      expect(within(headerRow).getByText('订单号', { exact: true })).toBeInTheDocument();
      if (label === '已开票') {
        const header = within(headerRow).getByText('发票号', { exact: true }).closest('th')!;
        expect(header).toBeInTheDocument();
        expect(header).toHaveRole('columnheader');
        expect(header).toBeVisible();
        expect(header).toHaveAccessibleName('发票号');
      } else expect(within(headerRow).queryByText('发票号', { exact: true })).not.toBeInTheDocument();
      await act(async () => { fireEvent.click(button); });
      await waitFor(() => expect(exportInvoiceData).toHaveBeenLastCalledWith(status ? { status } : {}, label, expect.any(Object)));
    }
  }, 20000);

  it('使用已查询的筛选快照导出，重置仍留在当前业务标签', async () => {
    renderPage();
    const tab = screen.getByRole('tab', { name: '已开票' });
    await act(async () => { fireEvent.click(tab); });
    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'applied@example.com' } });
    await act(async () => { fireEvent.click(screen.getByText(/^查\s*询$/).closest('button')!); });
    fireEvent.change(screen.getByPlaceholderText('邮箱'), { target: { value: 'draft@example.com' } });
    const button = screen.getByLabelText('导出已开票数据');
    await waitFor(() => expect(button).toBeEnabled());
    await act(async () => { fireEvent.click(button); });
    expect(exportInvoiceData).toHaveBeenLastCalledWith({ status: 'ISSUED', email: 'applied@example.com' }, '已开票', expect.any(Object));
    await act(async () => { fireEvent.click(screen.getByText(/^重\s*置$/).closest('button')!); });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(invoiceApi.list).toHaveBeenLastCalledWith({ status: 'ISSUED', page: 1, pageSize: 20 }));
  }, 20000);

  it('待审核可勾选批量通过，且仍保留下载选中', async () => {
    vi.mocked(invoiceApi.list).mockResolvedValue({
      items: [invoice('inv-1', 'APP-1', 'PENDING_REVIEW'), invoice('inv-2', 'APP-2', 'PENDING_REVIEW')],
      total: 2, page: 1, pageSize: 20, totalPages: 1,
    });
    vi.mocked(invoiceApi.approveMany).mockResolvedValue({ succeeded: ['inv-1', 'inv-2'], failed: [] });
    renderPage();

    await waitFor(() => expect(screen.getByText('APP-1')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '批量通过（0）' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下载选中（0）' })).toBeDisabled();

    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox')[0]); });
    expect(screen.getByRole('button', { name: '批量通过（2）' })).toBeEnabled();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '批量通过（2）' })); });
    expect(await screen.findByText('确认批量审核通过？')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '全部通过' })); });
    await waitFor(() => expect(invoiceApi.approveMany).toHaveBeenCalledWith(['inv-1', 'inv-2']));
  }, 20000);

  it('同一申请号下多个订单拆成多行并展示订单号', async () => {
    vi.mocked(invoiceApi.list).mockResolvedValue({
      items: [invoice('inv-multi', 'IA-20261009-302889', 'APPROVED_ISSUING', {
        items: [
          { id: 'item-a', orderId: 'order-a', principalCents: 1000, description: 'A' },
          { id: 'item-b', orderId: 'order-b', principalCents: 2000, description: 'B' },
          { id: 'item-c', orderId: 'order-c', principalCents: 3000, description: 'C' },
        ],
      })],
      total: 1, page: 1, pageSize: 20, totalPages: 1,
    });
    renderPage();
    const tab = screen.getByRole('tab', { name: '待开票' });
    await act(async () => { fireEvent.click(tab); });
    await waitFor(() => expect(tab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getAllByText('IA-20261009-302889')).toHaveLength(3));
    expect(screen.getByText('order-a')).toBeInTheDocument();
    expect(screen.getByText('order-b')).toBeInTheDocument();
    expect(screen.getByText('order-c')).toBeInTheDocument();
  }, 20000);

  it('待开票可勾选并下载 Invoice，已开票勾选下载 PDF', async () => {
    const issuing = [
      invoice('issuing-1', 'APP-3', 'APPROVED_ISSUING', { psaAttachmentUrl: 's3://psa.xlsx' }),
      invoice('issuing-2', 'APP-4', 'APPROVED_ISSUING'),
    ];
    const issued = [
      invoice('issued-1', 'APP-5', 'ISSUED', { pdfUrl: 's3://a.pdf', invoiceNumber: 'INV-1' }),
      invoice('issued-2', 'APP-6', 'ISSUED', { pdfUrl: 's3://b.pdf', invoiceNumber: 'INV-2' }),
    ];
    vi.mocked(invoiceApi.list).mockResolvedValue({ items: issuing, total: 2, page: 1, pageSize: 20, totalPages: 1 });
    renderPage();
    const issuingTab = screen.getByRole('tab', { name: '待开票' });
    await act(async () => { fireEvent.click(issuingTab); });
    await waitFor(() => expect(issuingTab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByText('APP-3')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /批量通过/ })).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox')[0]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下载选中（2）' })); });
    await waitFor(() => expect(invoiceApi.downloadPsaAttachment).toHaveBeenCalledWith('issuing-1'));
    expect(invoiceApi.downloadPsaAttachment).toHaveBeenCalledWith('issuing-2');
    expect(invoiceApi.downloadZip).not.toHaveBeenCalled();

    vi.mocked(invoiceApi.list).mockResolvedValue({ items: issued, total: 2, page: 1, pageSize: 20, totalPages: 1 });
    const issuedTab = screen.getByRole('tab', { name: '已开票' });
    await act(async () => { fireEvent.click(issuedTab); });
    await waitFor(() => expect(issuedTab).toHaveAttribute('aria-selected', 'true'));
    await waitFor(() => expect(screen.getByText('APP-5')).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getAllByRole('checkbox')[0]); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '下载选中（2）' })); });
    await waitFor(() => expect(invoiceApi.downloadZip).toHaveBeenCalledWith(['issued-1', 'issued-2']));
  }, 20000);
});

function invoice(
  id: string,
  applicationNo: string,
  status: InvoiceStatus,
  extra: Partial<InvoiceApplication> = {},
): InvoiceApplication {
  return {
    id,
    applicationNo,
    userId: 'user-1',
    tenantId: 't1',
    currency: 'USD',
    subtotalCents: 1000,
    totalCents: 1000,
    status,
    invoiceNumber: extra.invoiceNumber ?? null,
    issuingEntity: null,
    issueDate: extra.issueDate ?? null,
    dueDate: null,
    pdfUrl: extra.pdfUrl ?? null,
    psaAttachmentUrl: extra.psaAttachmentUrl ?? null,
    createdAt: '2026-09-22T00:00:00Z',
    items: extra.items ?? [{ id: `${id}-item`, orderId: `order-${id}`, principalCents: extra.totalCents ?? 1000, description: '套餐' }],
    ...extra,
  };
}
