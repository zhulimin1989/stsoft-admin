import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import dayjs from 'dayjs';
import DefaultFinanceReportsPage, {
  FinanceReportsPage,
  formatCustomerMultiplier,
  formatFinanceReportAsOf,
} from '../index';

// 页面默认账期取 dayjs().format('YYYY-MM')（index.tsx 的 initialMonth）。
// 断言必须同源推导，否则跨月即失败（曾在 2026-08 把 CI 卡死）。
const CURRENT_MONTH = dayjs().format('YYYY-MM');

const mocks = vi.hoisted(() => ({
  overview: vi.fn(),
  detail: vi.fn(),
  createExportJob: vi.fn(),
  messageError: vi.fn(),
  messageSuccess: vi.fn(),
  canExport: false,
}));

vi.mock('../../../api/admin', () => ({
  financeReportsApi: {
    overview: mocks.overview,
    detail: mocks.detail,
    createExportJob: mocks.createExportJob,
  },
}));

vi.mock('../../../contexts/PlatformConfigContext', () => ({
  usePlatformCurrency: () => 'CNY',
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => mocks.canExport,
}));

vi.mock('@ant-design/icons', () => ({
  CloudDownloadOutlined: () => null,
  ReloadOutlined: () => null,
}));

vi.mock('antd', () => {
  const message = {
    error: mocks.messageError,
    success: mocks.messageSuccess,
  };
  return {
    App: {
      useApp: () => ({ message }),
    },
    Button: ({
      children,
      disabled,
      onClick,
      title,
    }: {
      children: ReactNode;
      disabled?: boolean;
      onClick?: () => void;
      title?: string;
    }) => (
      <button type="button" disabled={disabled} onClick={onClick} title={title}>
        {children}
      </button>
    ),
    DatePicker: ({
      value,
      onChange,
      ...props
    }: {
      value: { format: (pattern: string) => string };
      onChange: (value: { format: (pattern: string) => string }) => void;
      'aria-label'?: string;
    }) => (
      <input
        aria-label={props['aria-label']}
        value={value.format('YYYY-MM')}
        onChange={(event) => onChange({ format: () => event.target.value })}
      />
    ),
    Input: ({
      value,
      placeholder,
      onChange,
      onPressEnter,
      ...props
    }: {
      value: string;
      placeholder?: string;
      onChange: (event: { target: { value: string } }) => void;
      onPressEnter?: () => void;
      'aria-label'?: string;
    }) => (
      <input
        aria-label={props['aria-label']}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={(event) => {
          if (event.key === 'Enter') onPressEnter?.();
        }}
      />
    ),
    Select: ({
      value,
      options,
      onChange,
      ...props
    }: {
      value?: string | number;
      options: Array<{ label: string; value: string | number }>;
      onChange: (value: never) => void;
      'aria-label'?: string;
    }) => (
      <select
        aria-label={props['aria-label']}
        value={value}
        onChange={(event) => {
          const selected = options.find((item) => String(item.value) === event.target.value);
          onChange(selected?.value as never);
        }}
      >
        {options.map((item) => (
          <option key={String(item.value)} value={item.value}>
            {item.label}
          </option>
        ))}
      </select>
    ),
    Segmented: ({
      value,
      options,
      onChange,
    }: {
      value: string;
      options: Array<{ label: ReactNode; value: string }>;
      onChange?: (value: string) => void;
    }) => (
      <div data-testid="report-mode">
        {options.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-pressed={item.value === value}
            onClick={() => onChange?.(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    ),
    Space: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Tabs: ({
      activeKey,
      items,
      onChange,
    }: {
      activeKey: string;
      items: Array<{ key: string; label: ReactNode; children: ReactNode }>;
      onChange?: (key: string) => void;
    }) => (
      <div>
        <div>
          {items.map((item) => (
            <button key={item.key} type="button" onClick={() => onChange?.(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
        {items.find((item) => item.key === activeKey)?.children}
      </div>
    ),
    Tag: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    Typography: {
      Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
    },
  };
});

vi.mock('../../../components/common', () => ({
  DataTable: ({
    columns,
    dataSource,
    searchable,
  }: {
    columns?: Array<{ key?: string; title?: ReactNode }>;
    dataSource: unknown[];
    searchable?: boolean;
  }) => (
    <div
      data-testid="finance-table"
      data-searchable={searchable ? 'true' : 'false'}
    >
      <div>{columns?.map((column) => <span key={column.key}>{column.title}</span>)}</div>
      {JSON.stringify(dataSource)}
    </div>
  ),
  PageHeader: ({
    title,
    actions,
  }: {
    title: ReactNode;
    actions?: ReactNode[];
  }) => (
    <header>
      <h1>{title}</h1>
      {actions}
    </header>
  ),
  StatCard: ({ label, value }: { label: ReactNode; value: ReactNode }) => (
    <div>{label}:{value}</div>
  ),
  StatCardGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const period = {
  month: '2026-07',
  startDate: '2026-06-30T16:00:00.000Z',
  endDate: '2026-07-31T16:00:00.000Z',
  asOf: '2026-07-23T06:32:10.000Z',
  timezone: 'Asia/Shanghai',
};

const overview = {
  period,
  metrics: {
    orderCount: 0,
    refundedOrderCount: 0,
    tokenUsageCount: 1,
    orderRevenueCents: 0,
    rechargeCents: 0,
    balanceConsumeCents: 0,
    refundCents: 0,
    apiChargeCents: 0,
    totalTokens: 1,
  },
  monthlySummary: [{ period: period.month, product: '全部产品' }],
  supplierCosts: { rows: [], status: '', requiredFields: [] },
  fieldGaps: [],
  rowLimits: { maxRowsPerDetail: 500, note: '' },
};

interface DetailRequest {
  month?: string;
  tab?: string;
  pageSize?: number;
  cursor?: string;
}

function detailPage({
  cursor,
  month = period.month,
  tab = 'pureGiftAccountChanges',
  pageSize = 20,
}: DetailRequest = {}) {
  return {
    period: { ...period, month },
    tab,
    rows: cursor ? [{ id: 'row-2' }] : [{ id: 'row-1' }],
    pagination: {
      mode: 'cursor',
      pageSize,
      hasMore: !cursor,
      nextCursor: cursor ? null : 'cursor-page-2',
      rowsReturned: 1,
    },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/finance-reports']}>
      <DefaultFinanceReportsPage />
    </MemoryRouter>,
  );
}

function renderReconciliationPage() {
  return render(
    <MemoryRouter initialEntries={['/finance-reconciliation']}>
      <FinanceReportsPage variant="reconciliation" />
    </MemoryRouter>,
  );
}

describe('FinanceReportsPage current snapshot and query controls', () => {
  beforeEach(() => {
    mocks.overview.mockReset();
    mocks.detail.mockReset();
    mocks.createExportJob.mockReset();
    mocks.messageError.mockReset();
    mocks.messageSuccess.mockReset();
    mocks.canExport = false;
    mocks.overview.mockResolvedValue(overview);
    mocks.detail.mockImplementation((request: DetailRequest) =>
      Promise.resolve(detailPage(request)));
    mocks.createExportJob.mockResolvedValue({ filename: 'finance.csv' });
  });

  it('formats the server snapshot in its declared timezone', () => {
    expect(formatFinanceReportAsOf(period)).toBe(
      '当前明细页数据截至 2026-07-23 14:32:10（Asia/Shanghai）',
    );
  });

  it('formats customer pricing multipliers as two-decimal discounts', () => {
    expect(formatCustomerMultiplier(0.85)).toBe('0.85');
    expect(formatCustomerMultiplier('0.75')).toBe('0.75');
    expect(formatCustomerMultiplier(1)).toBe('1.00');
    expect(formatCustomerMultiplier(null)).toBe('—');
    expect(formatCustomerMultiplier('invalid')).toBe('—');
  });

  it('renders the reconciliation summary from overview without recomputing it as detail', async () => {
    renderReconciliationPage();

    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));
    expect(mocks.detail).not.toHaveBeenCalled();
    expect(screen.getByTestId('finance-table')).toHaveTextContent('全部产品');
    expect(screen.getByText(
      '当前明细页数据截至 2026-07-23 14:32:10（Asia/Shanghai）',
    )).toBeInTheDocument();
  });

  it('shows discount and funding columns in API usage reconciliation order', async () => {
    const user = userEvent.setup();
    renderReconciliationPage();

    await user.click(screen.getByRole('button', { name: 'API 用量扣费' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        tab: 'apiUsage',
      }));
    });

    const table = screen.getByTestId('finance-table');
    const pricingHeaders = within(table).getAllByText(/^(price|折扣|charge)$/u);
    expect(pricingHeaders.map((header) => header.textContent)).toEqual([
      'price',
      '折扣',
      'charge',
    ]);
    const headers = within(table).getAllByText(/^(本金扣费|赠送扣费|信用扣费|欠费)$/u);
    expect(headers.map((header) => header.textContent)).toEqual([
      '本金扣费',
      '赠送扣费',
      '信用扣费',
      '欠费',
    ]);
    const sourceHeaders = within(table).getAllByText(/^(信用扣费|欠费|扣费来源|用量ID)$/u);
    expect(sourceHeaders.map((header) => header.textContent)).toEqual([
      '信用扣费', '欠费', '扣费来源', '用量ID',
    ]);
  });

  it('shows the server snapshot and refreshes from the first page without clearing query state', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText(
      '当前明细页数据截至 2026-07-23 14:32:10（Asia/Shanghai）',
    )).toBeInTheDocument();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());

    await user.type(screen.getByLabelText('查询内容'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        filterField: 'user',
        filterValue: 'user@example.com',
      }));
    });

    await user.click(await screen.findByRole('button', { name: '下一页' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        cursor: 'cursor-page-2',
      }));
      expect(screen.getByText(/第 2 页/)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        cursor: undefined,
        filterField: 'user',
        filterValue: 'user@example.com',
      }));
      expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
      expect(screen.getByLabelText('查询内容')).toHaveValue('user@example.com');
    });
  });

  it('submits the selected month and field filter in one server-side page request', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '当期消耗明细' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        tab: 'pureGiftConsumptionDetails',
      }));
    });
    const callsBeforeDraftChanges = mocks.detail.mock.calls.length;
    fireEvent.change(screen.getByLabelText('账期月份'), {
      target: { value: '2026-06' },
    });
    await user.selectOptions(screen.getByLabelText('查询字段'), 'model');
    await user.type(screen.getByLabelText('查询内容'), 'claude-sonnet');
    expect(mocks.detail).toHaveBeenCalledTimes(callsBeforeDraftChanges);
    const callsBeforeQuery = mocks.detail.mock.calls.length;
    await user.click(screen.getByRole('button', { name: '查询' }));

    await waitFor(() => {
      expect(mocks.overview).toHaveBeenLastCalledWith({
        month: '2026-06',
        billingMode: 'PAY_AS_YOU_GO',
      });
      expect(mocks.detail).toHaveBeenLastCalledWith({
        month: '2026-06',
        tab: 'pureGiftConsumptionDetails',
        billingMode: 'PAY_AS_YOU_GO',
        pageSize: 20,
        cursor: undefined,
        filterField: 'model',
        filterValue: 'claude-sonnet',
      });
    });
    expect(mocks.detail).toHaveBeenCalledTimes(callsBeforeQuery + 1);
    expect(screen.getByTestId('finance-table')).toHaveAttribute('data-searchable', 'false');
    expect(screen.getByText(
      '当前明细页数据截至 2026-07-23 14:32:10（Asia/Shanghai）',
    )).toBeInTheDocument();
  });

  it('offers exactly six page sizes and reloads the first page when size changes', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());

    await user.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(screen.getByText(/第 2 页/)).toBeInTheDocument());

    const sizeSelect = screen.getByLabelText('每页展示数量');
    expect(within(sizeSelect).getAllByRole('option').map((item) => item.textContent)).toEqual([
      '10',
      '20',
      '30',
      '40',
      '50',
      '100',
    ]);
    await user.selectOptions(sizeSelect, '50');

    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        pageSize: 50,
        cursor: undefined,
      }));
      expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
    });
  });

  it('keeps the shared PAY_AS_YOU_GO overview when switching report modes', async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByText('API 用量记录:1')).toBeInTheDocument();
    await waitFor(() => expect(mocks.overview).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: '按量买赠' }));

    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        tab: 'buyGiftAccountChanges',
        billingMode: 'PAY_AS_YOU_GO',
      }));
    });
    expect(mocks.overview).toHaveBeenCalledTimes(1);
    expect(screen.getByText('API 用量记录:1')).toBeInTheDocument();
  });

  it('clears only the applied filter and keeps the applied month', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('账期月份'), {
      target: { value: '2026-06' },
    });
    await user.selectOptions(screen.getByLabelText('查询字段'), 'rechargeBatchNo');
    await user.type(screen.getByLabelText('查询内容'), 'grant-1');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        month: '2026-06',
        filterField: 'rechargeBatchNo',
        filterValue: 'grant-1',
      }));
    });

    await user.click(screen.getByRole('button', { name: '清空筛选' }));
    await waitFor(() => {
      expect(screen.getByLabelText('账期月份')).toHaveValue('2026-06');
      expect(screen.getByLabelText('查询内容')).toHaveValue('');
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        month: '2026-06',
        cursor: undefined,
        filterField: undefined,
        filterValue: undefined,
      }));
    });
  });

  it('does not discard a draft month when clearing the applied filter', async () => {
    const user = userEvent.setup();
    renderPage();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());

    await user.type(screen.getByLabelText('查询内容'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        month: CURRENT_MONTH,
        filterValue: 'user@example.com',
      }));
    });

    fireEvent.change(screen.getByLabelText('账期月份'), {
      target: { value: '2026-06' },
    });
    await user.click(screen.getByRole('button', { name: '清空筛选' }));

    await waitFor(() => {
      expect(screen.getByLabelText('账期月份')).toHaveValue('2026-06');
      expect(screen.getByLabelText('查询内容')).toHaveValue('');
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        month: CURRENT_MONTH,
        filterField: undefined,
        filterValue: undefined,
      }));
    });
  });

  it('does not let an older page response replace a refreshed snapshot', async () => {
    const user = userEvent.setup();
    let resolveOldPage: ((value: ReturnType<typeof detailPage>) => void) | undefined;
    let detailRequestCount = 0;
    mocks.detail.mockImplementation((request: DetailRequest) => {
      detailRequestCount += 1;
      if (detailRequestCount === 2) {
        return new Promise((resolve) => {
          resolveOldPage = resolve;
        });
      }
      return Promise.resolve(detailPage(request));
    });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('finance-table')).toHaveTextContent('row-1'));
    await user.click(screen.getByRole('button', { name: '下一页' }));
    await waitFor(() => expect(detailRequestCount).toBe(2));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    await waitFor(() => {
      expect(detailRequestCount).toBe(3);
      expect(screen.getByTestId('finance-table')).toHaveTextContent('row-1');
    });

    resolveOldPage?.(detailPage({ cursor: 'cursor-page-2' }));
    await waitFor(() => {
      expect(screen.getByTestId('finance-table')).not.toHaveTextContent('row-2');
      expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
    });
  });

  it('does not let an older overview response replace refreshed metrics', async () => {
    const user = userEvent.setup();
    let resolveOldOverview: ((value: typeof overview) => void) | undefined;
    let overviewRequestCount = 0;
    mocks.overview.mockImplementation(() => {
      overviewRequestCount += 1;
      if (overviewRequestCount === 1) {
        return new Promise((resolve) => {
          resolveOldOverview = resolve;
        });
      }
      return Promise.resolve({
        ...overview,
        metrics: { ...overview.metrics, tokenUsageCount: 2 },
      });
    });
    renderPage();

    await waitFor(() => expect(overviewRequestCount).toBe(1));
    await user.click(screen.getByRole('button', { name: '刷新' }));
    expect(await screen.findByText('API 用量记录:2')).toBeInTheDocument();

    resolveOldOverview?.(overview);
    await waitFor(() => {
      expect(screen.getByText('API 用量记录:2')).toBeInTheDocument();
      expect(screen.queryByText('API 用量记录:1')).not.toBeInTheDocument();
    });
  });

  it('labels export as the full applied accounting period and does not send filters', async () => {
    const user = userEvent.setup();
    mocks.canExport = true;
    renderPage();
    await waitFor(() => expect(mocks.detail).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('账期月份'), {
      target: { value: '2026-06' },
    });
    await user.type(screen.getByLabelText('查询内容'), 'user@example.com');
    await user.click(screen.getByRole('button', { name: '查询' }));
    await waitFor(() => {
      expect(mocks.detail).toHaveBeenLastCalledWith(expect.objectContaining({
        month: '2026-06',
        filterValue: 'user@example.com',
      }));
    });

    const exportButton = screen.getByRole('button', { name: '导出当前账期全部数据' });
    expect(exportButton).toHaveAttribute(
      'title',
      '导出当前账期全部数据，不包含页面筛选条件',
    );
    await user.click(exportButton);

    expect(mocks.createExportJob).toHaveBeenCalledWith({
      month: '2026-06',
      tab: 'pureGiftAccountChanges',
      billingMode: 'PAY_AS_YOU_GO',
    });
  });
});
