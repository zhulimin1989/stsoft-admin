import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import dayjs from 'dayjs';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EnterpriseAccountsV2DetailPage from '../detail';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  listBills: vi.fn(),
  listTenants: vi.fn(),
  listProducts: vi.fn(),
  issueVoucher: vi.fn(),
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => true,
}));

vi.mock('../../../contexts/PlatformConfigContext', () => ({
  usePlatformCurrency: () => 'CNY',
}));

vi.mock('../../../api/v2/enterpriseAccountsV2', () => ({
  enterpriseAccountV2Api: {
    get: mocks.get,
    listBills: mocks.listBills,
    listTenants: mocks.listTenants,
    issueVoucher: mocks.issueVoucher,
  },
}));

vi.mock('../../../api/v2/enterpriseAccounts', () => ({
  enterpriseAccountApi: {},
}));

vi.mock('../../../api/admin', () => ({
  productApi: { list: mocks.listProducts },
}));

vi.mock('../../EnterpriseAccounts/components/EnterpriseAccountModals', () => ({
  AttachTenantModal: () => null,
  CreditConfigModal: () => null,
  EnterpriseModelDiscountModal: () => null,
  RechargeEnterpriseAccountModal: () => null,
}));

function renderDetail(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/enterprise-accounts-v2/ba-1${search}`]}>
      <App>
        <Routes>
          <Route path="/enterprise-accounts-v2/:id" element={<EnterpriseAccountsV2DetailPage />} />
        </Routes>
      </App>
    </MemoryRouter>,
  );
}

describe('EnterpriseAccountsV2DetailPage tab loading', () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue({
      account: {
        id: 'ba-1',
        enterpriseName: '示例科技有限公司',
        uscc: '91110000DEMO0001',
        status: 'active',
        prepaid: false,
        credit: { accountBalanceCents: 0, remainingCents: 0 },
        ownerMembers: [],
      },
      ownerVerification: { type: 'ENTERPRISE', status: 'VERIFIED' },
    });
    mocks.listBills.mockResolvedValue({ items: [], buttonVisible: false });
    mocks.listTenants.mockResolvedValue({ items: [] });
    mocks.listProducts.mockResolvedValue({ items: [] });
    mocks.issueVoucher.mockReset();
  });

  it('loads account detail only until the bills tab is opened', async () => {
    renderDetail();

    expect(await screen.findByRole('tab', { name: '账户信息' })).toBeInTheDocument();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('ba-1'));
    expect(mocks.listBills).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: '认证信息' }));
    expect(mocks.listBills).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('tab', { name: '企业账单' }));
    await waitFor(() => expect(mocks.listBills).toHaveBeenCalledWith('ba-1', { buttonVisible: false }));
  });

  it('keeps 挂载 tenant in the DOM but hides it from the detail header', async () => {
    renderDetail();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('ba-1'));
    const attach = (await screen.findByText('挂载 tenant')).closest('button');
    expect(attach).not.toBeNull();
    expect(attach).toHaveAttribute('hidden');
    expect(attach).not.toBeVisible();
    expect(screen.queryByRole('button', { name: /挂载 tenant/ })).not.toBeInTheDocument();
  });

  it('loads bills on first paint when the URL asks for the bills sheet', async () => {
    renderDetail('?sheet=bills');

    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('ba-1'));
    await waitFor(() => expect(mocks.listBills).toHaveBeenCalledWith('ba-1', { buttonVisible: false }));
  });

  it('shows 欠款金额 separately from 信用支付金额 on the bills sheet', async () => {
    mocks.listBills.mockResolvedValue({
      items: [{
        yearMonth: '2026-09',
        currentMonth: false,
        requestCount: 1,
        tokenTotal: 100,
        consumeCents: 1004970,
        accountPayCents: 1001993,
        voucherDeductCents: 0,
        creditPayCents: 0,
        debtPayCents: 2977,
        adjustedCents: 0,
        issuedVoucherCents: 0,
        receivableCents: 2977,
        paidCents: 2977,
        pendingCents: 0,
        status: '已核销',
        termsDays: null,
        dueAt: null,
        originalDueAt: null,
        extended: false,
        remainingDays: null,
        prepaid: true,
        writeOffDisabledReason: null,
        adjustDisabledReason: null,
        extendDisabledReason: null,
        compensateDisabledReason: null,
      }],
      buttonVisible: false,
    });
    renderDetail('?sheet=bills');

    expect(await screen.findAllByText('信用支付金额')).not.toHaveLength(0);
    expect(screen.getAllByText('欠款金额').length).toBeGreaterThan(0);
    expect(screen.getAllByText('¥0.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('¥29.77').length).toBeGreaterThan(0);
  });
});

describe('EnterpriseAccountsV2DetailPage 发券过期时间', () => {
  beforeEach(() => {
    mocks.get.mockResolvedValue({
      account: {
        id: 'ba-1',
        enterpriseName: '示例科技有限公司',
        uscc: '91110000DEMO0001',
        status: 'active',
        prepaid: false,
        credit: { accountBalanceCents: 0, remainingCents: 0 },
        ownerMembers: [],
        ownerUserId: 'owner-1',
      },
      ownerVerification: { type: 'ENTERPRISE', status: 'VERIFIED' },
    });
    mocks.listBills.mockResolvedValue({ items: [], buttonVisible: false });
    mocks.listTenants.mockResolvedValue({
      items: [{ id: 't-1', name: '示例科技有限公司' }],
    });
    mocks.listProducts.mockResolvedValue({
      items: [{ id: 'p-payg', name: '按量产品', billingMode: 'PAY_AS_YOU_GO', isActive: true }],
    });
    mocks.issueVoucher.mockReset();
  });

  async function openVoucherModal() {
    renderDetail();
    fireEvent.click(await screen.findByRole('button', { name: /发券/ }));
    await waitFor(() => expect(document.getElementById('expiresAt')).not.toBeNull());
    return document.getElementById('expiresAt') as HTMLInputElement;
  }

  it('过期时间默认当前日期 + 31 天', async () => {
    const input = await openVoucherModal();
    const expected = dayjs().add(31, 'day').format('YYYY-MM-DD');
    await waitFor(() => expect(input).toHaveValue(expected));
  }, 20000);

  it('过期时间必填，清空后不能提交发券', async () => {
    const input = await openVoucherModal();
    expect(input).toHaveAttribute('aria-required', 'true');

    const picker = input.closest('.ant-picker') as HTMLElement;
    const clear = picker.querySelector('.ant-picker-clear');
    expect(clear).not.toBeNull();
    fireEvent.click(clear!);
    await waitFor(() => expect(input).toHaveValue(''));

    fireEvent.click(screen.getByRole('button', { name: /^OK$/i }));

    expect(await screen.findByText('请选择过期时间')).toBeInTheDocument();
    expect(mocks.issueVoucher).not.toHaveBeenCalled();
  }, 20000);
});
