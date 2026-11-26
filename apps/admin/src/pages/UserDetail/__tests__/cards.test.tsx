import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { CodingPlanCard } from '../CodingPlanCard';
import { SubscriptionCard } from '../SubscriptionCard';
import { PayAsYouGoCard } from '../PayAsYouGoCard';
import { ProductAccountCard } from '../ProductAccountCard';

describe('CodingPlanCard', () => {
  it('renders quotas with progress bars', () => {
    render(
      <CodingPlanCard
        productName="CodingPlan Pro"
        quotas={[
          { windowType: 'ROLLING', durationLabel: '5h', used: 6, limit: 10, metric: 'requests' },
          { windowType: 'ROLLING', durationLabel: '7d', used: 120, limit: 400, metric: 'requests' },
        ]}
        keys={[]}
        onAddKey={() => {}}
        onRenew={() => {}}
      />,
    );
    expect(screen.getByText(/CodingPlan Pro/)).toBeInTheDocument();
    expect(screen.getByText(/6 \/ 10/)).toBeInTheDocument();
    expect(screen.getByText(/120 \/ 400/)).toBeInTheDocument();
  });

  it('marks near-limit quota with warn style', () => {
    const { container } = render(
      <CodingPlanCard
        productName="x"
        quotas={[{ windowType: 'CUMULATIVE', durationLabel: '30d', used: 1840, limit: 2000, metric: 'requests' }]}
        keys={[]}
        onAddKey={() => {}}
        onRenew={() => {}}
      />,
    );
    expect(container.querySelector('.rt-quota-fill-warn')).not.toBeNull();
  });
});

describe('SubscriptionCard', () => {
  it('renders plan + booster + total', () => {
    render(
      <SubscriptionCard
        productName="AI 对话 Pro"
        planCredits={{ used: 3800, total: 5000 }}
        boosterCredits={300}
        onRenew={() => {}}
        onBuyBooster={() => {}}
      />,
    );
    expect(screen.getByText(/AI 对话 Pro/)).toBeInTheDocument();
    // 5000 - 3800 = 1,200 remaining plan credits
    expect(screen.getByText(/1,200/)).toBeInTheDocument();
    // booster 300
    expect(screen.getByText(/\+300/)).toBeInTheDocument();
    // total 1,500
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
  });
});

describe('PayAsYouGoCard', () => {
  it('renders balance + month usage + key list', () => {
    render(
      <PayAsYouGoCard
        productName="AI 写作"
        balanceCents={23450}
        monthUsageCents={4520}
        keys={[
          { id: 'k1', prefix: 'write_live_***c4d8', lastUsedAt: '2 mins ago', monthUsageCents: 1820, isActive: true },
        ]}
        onAddKey={() => {}}
        onRecharge={() => {}}
      />,
    );
    expect(screen.getByText(/AI 写作/)).toBeInTheDocument();
    expect(screen.getByText(/\$234.50/)).toBeInTheDocument();
    expect(screen.getByText(/\$45.20/)).toBeInTheDocument();
    expect(screen.getByText(/write_live_\*\*\*c4d8/)).toBeInTheDocument();
  });
});

describe('ProductAccountCard', () => {
  const baseSubscription = {
    id: 'sub-1',
    productId: 'product-1',
    productName: 'CodingPlan Pro',
    plan: { id: 'plan-1', name: '专业版', monthlyCredits: 5000 },
    status: 'ACTIVE',
    startedAt: '2026-01-01T00:00:00.000Z',
    expiresAt: null,
  };

  it('renders coding-plan subscriptions with quota defaults', () => {
    render(
      <ProductAccountCard
        subscription={{
          ...baseSubscription,
          billingMode: 'CODING_PLAN',
          planCredits: { used: 500, total: 2000 },
          bonusCredits: 100,
          usedThisMonth: 300,
        }}
      />,
    );

    expect(screen.getByText(/CodingPlan Pro/)).toBeInTheDocument();
    expect(screen.getByText(/专业版/)).toBeInTheDocument();
    expect(screen.getByText(/1,500/)).toBeInTheDocument();
    expect(screen.getByText(/\+100/)).toBeInTheDocument();
  });

  it('renders subscription products with remaining days', () => {
    render(
      <ProductAccountCard
        subscription={{
          ...baseSubscription,
          productName: 'AI 对话 Pro',
          billingMode: 'SUBSCRIPTION',
          planCredits: { used: 1200, total: 5000 },
          boosterCredits: 200,
          remainingDays: 12,
        }}
      />,
    );

    expect(screen.getByText(/AI 对话 Pro/)).toBeInTheDocument();
    expect(screen.getByText(/本期剩余 12 天/)).toBeInTheDocument();
    expect(screen.getByText(/3,800/)).toBeInTheDocument();
  });

  it('renders pay-as-you-go products using wallet balance fallback', () => {
    render(
      <ProductAccountCard
        subscription={{
          ...baseSubscription,
          productName: 'AI 写作',
          billingMode: 'PAY_AS_YOU_GO',
          walletBalanceCents: 12345,
          keys: [
            { id: 'key-1', prefix: 'payg_live_***', isActive: false, monthUsageCents: 678 },
          ],
        }}
      />,
    );

    expect(screen.getByText(/AI 写作/)).toBeInTheDocument();
    expect(screen.getByText(/\$123.45/)).toBeInTheDocument();
    expect(screen.getByText(/payg_live_\*\*\*/)).toBeInTheDocument();
    expect(screen.getByText(/停用/)).toBeInTheDocument();
  });
});
