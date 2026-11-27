import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SubscriptionsPage from '../index';

const mocks = vi.hoisted(() => ({
  listSubscriptions: vi.fn(),
  grantCredits: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock('../../../api/admin', () => ({
  adminSubscriptionApi: {
    list: mocks.listSubscriptions,
    grantCredits: mocks.grantCredits,
  },
  productApi: {
    list: mocks.listProducts,
  },
}));

vi.mock('../../../hooks/usePermission', () => ({
  usePermission: () => true,
}));

const subscriptionRow = {
  id: 'sub-1',
  tenantId: 'tenant-1',
  tenantName: 'stsoft studio',
  tenantType: 'personal',
  tenantStatus: 'ACTIVE',
  accountId: 'acct-1',
  accountName: 'shine_lee_211的个人空间',
  userId: 'user-1',
  userEmail: 'shine.lee.211@gmail.com',
  userNickname: 'shine_lee_211',
  productName: 'stsoft studio',
  productSlug: 'stsoft-studio',
  planId: 'plan-1',
  planName: 'Pro',
  status: 'ACTIVE',
  startedAt: '2026-05-23T16:37:00.000Z',
  expiresAt: '2026-06-22T16:37:00.000Z',
  updatedAt: '2026-05-23T16:37:00.000Z',
  monthlyPrice: 0,
  quarterlyPrice: 0,
  yearlyPrice: 0,
  monthlyCredits: 300,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/subscriptions']}>
      <SubscriptionsPage />
    </MemoryRouter>,
  );
}

describe('SubscriptionsPage grant credits modal', () => {
  beforeEach(() => {
    mocks.listSubscriptions.mockReset();
    mocks.grantCredits.mockReset();
    mocks.listProducts.mockReset();

    mocks.listSubscriptions.mockResolvedValue({
      items: [subscriptionRow],
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
      stats: {
        active: 1,
        expiringSoon: 0,
        cancelled: 0,
        expired: 0,
      },
    });
    mocks.grantCredits.mockResolvedValue({});
    mocks.listProducts.mockResolvedValue([
      { id: 'product-1', name: 'stsoft studio', slug: 'stsoft-studio' },
    ]);
  });

  it('shows inline validation before granting subscription credits', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: '赠送积分' }));
    await user.type(screen.getByPlaceholderText('输入赠送积分数量'), '1000');
    await user.click(screen.getByRole('button', { name: '确认赠送' }));

    expect(await screen.findByText('请补全赠送信息后再确认')).toBeInTheDocument();
    expect(await screen.findByText('请填写赠送原因')).toBeInTheDocument();
    expect(mocks.grantCredits).not.toHaveBeenCalled();

    await user.type(screen.getByPlaceholderText('如：上线前体验额度补发'), '上线前体验额度补发');
    await user.click(screen.getByRole('button', { name: '确认赠送' }));

    await waitFor(() => {
      expect(mocks.grantCredits).toHaveBeenCalledWith(
        'sub-1',
        1000,
        '上线前体验额度补发',
        expect.stringMatching(/^admin:subscription-grant:sub-1:/),
      );
    });
  }, 20000);
});
