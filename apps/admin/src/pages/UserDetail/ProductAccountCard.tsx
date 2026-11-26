import { CodingPlanCard } from './CodingPlanCard';
import { SubscriptionCard } from './SubscriptionCard';
import { PayAsYouGoCard } from './PayAsYouGoCard';

interface Subscription {
  id: string;
  productId: string;
  productName: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
  plan: { id: string; name: string; monthlyCredits: number };
  status: string;
  startedAt: string;
  expiresAt: string | null;
  // mode-specific data (all optional, fallbacks to empty)
  quotas?: Array<{ windowType: 'ROLLING' | 'FIXED_PERIOD' | 'CUMULATIVE'; durationLabel: string; used: number; limit: number; metric: 'requests' | 'tokens' | 'credits' }>;
  keys?: Array<{ id: string; prefix: string; lastUsedAt?: string; isActive: boolean; monthUsageCents?: number }>;
  planCredits?: { used: number; total: number };
  boosterCredits?: number;
  quotaCredits?: number;
  bonusCredits?: number;
  productCredits?: number;
  usedThisMonth?: number;
  balanceCents?: number;
  monthUsageCents?: number;
  resetAt?: string;
  remainingDays?: number;
  walletBalanceCents?: number;
}

interface Props {
  subscription: Subscription;
}

export function ProductAccountCard({ subscription }: Props) {
  const { billingMode, productName } = subscription;

  if (billingMode === 'CODING_PLAN') {
    return (
      <CodingPlanCard
        productName={productName}
        planName={subscription.plan.name}
        status={subscription.status}
        expiresAt={subscription.expiresAt}
        resetAt={subscription.resetAt}
        planCredits={subscription.planCredits}
        boosterCredits={subscription.bonusCredits ?? subscription.boosterCredits ?? 0}
        usedThisMonth={subscription.usedThisMonth ?? 0}
        quotas={subscription.quotas ?? []}
        keys={(subscription.keys ?? []).map((k) => ({
          id: k.id, prefix: k.prefix, lastUsedAt: k.lastUsedAt, isActive: k.isActive,
        }))}
      />
    );
  }
  if (billingMode === 'SUBSCRIPTION') {
    return (
      <SubscriptionCard
        productName={productName}
        planName={subscription.plan.name}
        status={subscription.status}
        expiresAt={subscription.expiresAt}
        remainingDays={subscription.remainingDays}
        planCredits={subscription.planCredits ?? { used: 0, total: 0 }}
        boosterCredits={subscription.bonusCredits ?? subscription.boosterCredits ?? 0}
        usedThisMonth={subscription.usedThisMonth ?? 0}
      />
    );
  }
  return (
    <PayAsYouGoCard
      productName={productName}
      planName={subscription.plan.name}
      status={subscription.status}
      expiresAt={subscription.expiresAt}
      balanceCents={subscription.walletBalanceCents ?? subscription.balanceCents ?? 0}
      keys={(subscription.keys ?? []).map((k) => ({
        id: k.id, prefix: k.prefix, lastUsedAt: k.lastUsedAt, isActive: k.isActive,
        monthUsageCents: k.monthUsageCents ?? 0,
      }))}
    />
  );
}
