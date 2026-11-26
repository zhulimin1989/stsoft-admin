import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ReferralsPage from '../index';

const mocks = vi.hoisted(() => ({
  listPrograms: vi.fn(),
  summary: vi.fn(),
  listRedemptions: vi.fn(),
  leaderboard: vi.fn(),
  listProducts: vi.fn(),
}));

vi.mock('../../../api/v2', () => ({
  referralApi: {
    listPrograms: mocks.listPrograms,
    summary: mocks.summary,
    listRedemptions: mocks.listRedemptions,
    leaderboard: mocks.leaderboard,
  },
}));

vi.mock('../../../api/admin', () => ({
  productApi: {
    list: mocks.listProducts,
  },
}));

const program = {
  id: 'p1',
  name: 'yyy',
  inviterReward: 0,
  inviteeReward: 0,
  rewardCondition: 'REGISTER' as const,
  trackingOnly: true,
  isActive: true,
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/referrals']}>
      <ReferralsPage />
    </MemoryRouter>,
  );
}

describe('ReferralsPage summary metrics', () => {
  beforeEach(() => {
    mocks.listPrograms.mockReset();
    mocks.summary.mockReset();
    mocks.listRedemptions.mockReset();
    mocks.leaderboard.mockReset();
    mocks.listProducts.mockReset();

    mocks.listPrograms.mockResolvedValue({ items: [program] });
    mocks.summary.mockResolvedValue({
      totalInviters: 12,
      totalInvitees: 34,
      totalRedemptions: 8,
      totalAttempts: 10,
      conversionRate: 0.8,
      totalRewardIssued: 930,
      perProgram: { p1: { redemptionCount: 42 } },
    });
    mocks.listRedemptions.mockResolvedValue({ items: [], total: 0 });
    mocks.leaderboard.mockResolvedValue({ items: [] });
    mocks.listProducts.mockResolvedValue([]);
  });

  it('renders real aggregate metrics from summary endpoint', async () => {
    renderPage();

    // 顶部指标卡:真实数字,不再是 '—'
    expect(await screen.findByText('12')).toBeInTheDocument(); // 总邀请人
    expect(await screen.findByText('34')).toBeInTheDocument(); // 总被邀请人
    expect(await screen.findByText('80.0%')).toBeInTheDocument(); // 转化率
    expect(await screen.findByText('8')).toBeInTheDocument(); // 条件达成数
  });

  it('renders per-program redemption count in the program list', async () => {
    renderPage();

    // 程序行渲染 + 达成数取自 summary.perProgram
    expect(await screen.findByText('yyy')).toBeInTheDocument();
    expect(await screen.findByText('42')).toBeInTheDocument();
  });

  it('shows invitation progress in one records tab', async () => {
    const user = userEvent.setup();
    const subscribeProgram = {
      ...program,
      rewardCondition: 'FIRST_SUBSCRIBE' as const,
    };
    mocks.listPrograms.mockResolvedValue({ items: [subscribeProgram] });
    mocks.listRedemptions.mockResolvedValue({
      items: [
        {
          id: 'completed-1',
          programId: 'p1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'invitee-1',
          triggeredAt: '2026-07-13T03:00:00.000Z',
          rewardGranted: true,
          createdAt: '2026-07-13T02:00:00.000Z',
        },
        {
          id: 'pending-1',
          programId: 'p1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'invitee-2',
          triggeredAt: null,
          rewardGranted: false,
          createdAt: '2026-07-13T02:30:00.000Z',
        },
        {
          id: 'rejected-1',
          programId: 'p1',
          inviterUserId: 'inviter-1',
          inviteeUserId: 'invitee-3',
          triggeredAt: null,
          rewardGranted: false,
          rejectReason: 'SAME_IP_LIMIT',
          createdAt: '2026-07-13T02:40:00.000Z',
        },
      ],
      total: 3,
    });

    renderPage();
    await user.click(await screen.findByRole('tab', { name: '邀请记录' }));

    await waitFor(() => {
      expect(mocks.listRedemptions).toHaveBeenCalledWith({
        page: 1,
        pageSize: 20,
      });
    });
    expect(await screen.findByText('待首次订阅')).toBeInTheDocument();
    expect(screen.getByText('已完成首次订阅')).toBeInTheDocument();
    expect(screen.getByText('已拒绝')).toBeInTheDocument();
  });
});
