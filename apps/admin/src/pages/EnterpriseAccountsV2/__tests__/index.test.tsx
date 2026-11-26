import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnterpriseAccountsV2Page from '../index';

const mocks = vi.hoisted(() => ({
  canManage: true,
  list: vi.fn(),
  refreshMonthSummaries: vi.fn(),
  closeHistoricalMonths: vi.fn(),
  reload: vi.fn(),
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => mocks.canManage,
}));

vi.mock('../../../contexts/PlatformConfigContext', () => ({
  usePlatformCurrency: () => 'CNY',
}));

vi.mock('../../../api/v2/enterpriseAccountsV2', () => ({
  enterpriseAccountV2Api: {
    list: mocks.list,
    refreshMonthSummaries: mocks.refreshMonthSummaries,
    closeHistoricalMonths: mocks.closeHistoricalMonths,
  },
}));

vi.mock('../../../api/v2/enterpriseAccounts', () => ({
  enterpriseAccountApi: { create: vi.fn() },
}));

vi.mock('../../EnterpriseAccounts/components/EnterpriseAccountModals', () => ({
  CreateEnterpriseAccountModal: () => null,
}));

vi.mock('../ReviewQueuePanel', () => ({
  ReviewQueuePanel: () => <div>待审核队列面板</div>,
}));

function renderPage(search = '') {
  return render(
    <MemoryRouter initialEntries={[search ? `/${search}` : '/']}>
      <App>
        <EnterpriseAccountsV2Page />
      </App>
    </MemoryRouter>,
  );
}

function jobButton(label: string) {
  const node = screen.getByText(label).closest('button');
  if (!node) throw new Error(`missing button ${label}`);
  return node;
}

/**
 * 「创建 / 补救」按钮已由业务方要求隐藏（hidden + display:none），
 * 因此不能再用 getByRole 做就绪信号或断言；改按文本定位。
 */
async function waitForPageReady() {
  await screen.findByText('关闭历史月');
}

function createButton() {
  const node = screen.getByText('创建 / 补救').closest('button');
  if (!node) throw new Error('missing button 创建 / 补救');
  return node;
}

function revealJobButtons() {
  for (const label of ['刷新当月快照', '关闭历史月']) {
    const btn = jobButton(label);
    btn.removeAttribute('hidden');
    btn.style.display = 'inline-flex';
  }
}

describe('EnterpriseAccountsV2Page month summary jobs', () => {
  beforeEach(() => {
    mocks.canManage = true;
    mocks.reload.mockReset();
    mocks.list.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 10 });
    mocks.refreshMonthSummaries.mockReset();
    mocks.closeHistoricalMonths.mockReset();
  });

  it('keeps job buttons in the DOM with hidden, before 创建 / 补救', async () => {
    renderPage();
    await waitForPageReady();
    const refresh = jobButton('刷新当月快照');
    const close = jobButton('关闭历史月');
    const create = createButton();
    expect(refresh).toHaveAttribute('hidden');
    expect(close).toHaveAttribute('hidden');
    expect(refresh).not.toBeVisible();
    expect(close).not.toBeVisible();
    expect(refresh.compareDocumentPosition(close) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(close.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps 创建 / 补救 in the DOM but hides it from the header', async () => {
    renderPage();
    await waitForPageReady();
    const create = createButton();
    expect(create).toHaveAttribute('hidden');
    expect(create).not.toBeVisible();
    // 隐藏后不应再出现在无障碍树里
    expect(screen.queryByRole('button', { name: /创建 \/ 补救/ })).not.toBeInTheDocument();
  });

  it('hides job buttons on the review tab', async () => {
    renderPage('?tab=review');
    expect(await screen.findByText('待审核队列面板')).toBeInTheDocument();
    expect(screen.queryByText('刷新当月快照')).not.toBeInTheDocument();
    expect(screen.queryByText('关闭历史月')).not.toBeInTheDocument();
  });

  it('runs refresh after hidden is removed, with loading and sibling disable', async () => {
    let resolveRefresh: (value: unknown) => void = () => undefined;
    mocks.refreshMonthSummaries.mockImplementation(
      () => new Promise((resolve) => { resolveRefresh = resolve; }),
    );
    renderPage();
    await waitForPageReady();
    revealJobButtons();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /刷新当月快照/ }));

    expect(jobButton('刷新当月快照')).toHaveClass('ant-btn-loading');
    expect(jobButton('关闭历史月')).toBeDisabled();
    expect(createButton()).toBeDisabled();

    resolveRefresh({
      skipped: false,
      yearMonth: '2026-09',
      processed: 2,
      fundingProcessed: 2,
    });
    expect(await screen.findByText('当月快照已刷新（2026-09，账户 2，资金快照 2）')).toBeInTheDocument();
    await waitFor(() => expect(jobButton('关闭历史月')).toBeEnabled());
  });

  it('warns when refresh is skipped and does not treat it as success', async () => {
    mocks.refreshMonthSummaries.mockResolvedValue({
      skipped: true,
      yearMonth: '2026-09',
      processed: 0,
      fundingProcessed: 0,
      hasMore: true,
    });
    renderPage();
    await waitForPageReady();
    revealJobButtons();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /刷新当月快照/ }));
    expect(await screen.findByText('当月快照作业进行中，请稍后再试')).toBeInTheDocument();
  });

  it('warns when close is skipped and does not treat it as success', async () => {
    mocks.closeHistoricalMonths.mockResolvedValue({
      skipped: true,
      yearMonth: null,
      yearMonths: [],
      processed: 0,
      hasMore: true,
    });
    renderPage();
    await waitForPageReady();
    revealJobButtons();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /关闭历史月/ }));
    expect(await screen.findByText('关闭历史月作业进行中，请稍后再试')).toBeInTheDocument();
  });
});
