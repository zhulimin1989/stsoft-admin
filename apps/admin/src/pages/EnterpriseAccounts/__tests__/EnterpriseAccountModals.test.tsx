import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App, Form } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import type {
  EnterpriseAccount,
  EnterpriseAccountCreditEvent,
  EnterpriseModelDiscountRow,
} from '../../../api/v2/enterpriseAccounts';
import {
  CreditEventAuditTrail,
  EnterpriseModelTierPrices,
  formatEnterprisePriceTierRange,
  RechargeEnterpriseAccountModal,
  RejectReviewModal,
} from '../components/EnterpriseAccountModals';
import { BillingAccountView, ReviewApplicationView } from '../components/EnterpriseAccountDetailViews';

const tieredRow: EnterpriseModelDiscountRow = {
  modelName: 'glm-5-turbo',
  provider: 'zhipu',
  modelActive: true,
  base: {
    input: 99,
    cached: 19,
    cacheWrite: 29,
    output: 199,
  },
  effective: {
    input: 49.5,
    cached: 9.5,
    cacheWrite: 14.5,
    output: 99.5,
  },
  tiers: [
    {
      tierKey: 'default',
      displayName: '0-32K',
      minInputTokens: 0,
      maxInputTokensExclusive: 32_000,
      base: { input: 5, cached: 1.2, cacheWrite: null, output: 22 },
      effective: { input: 2.5, cached: 0.6, cacheWrite: null, output: 11 },
    },
    {
      tierKey: 'tier_2',
      displayName: '32K+',
      minInputTokens: 32_000,
      maxInputTokensExclusive: null,
      base: { input: 7, cached: 1.8, cacheWrite: 8, output: 26 },
      effective: { input: 3.5, cached: 0.9, cacheWrite: 4, output: 13 },
    },
  ],
  configured: true,
  priceMultiplier: '0.5000',
  discount: null,
};

describe('RechargeEnterpriseAccountModal amount', () => {
  it('keeps typed 0 and blocks submit instead of charging ¥0.01', async () => {
    const user = userEvent.setup();
    const onValidated = vi.fn();

    function Harness() {
      const [form] = Form.useForm();
      return (
        <App>
          <RechargeEnterpriseAccountModal
            open
            account={{
              id: 'ba-1',
              enterpriseName: '示例科技',
              status: 'active',
              credit: { accountBalanceCents: 100 },
            } as EnterpriseAccount}
            form={form}
            acting={false}
            productLoading={false}
            products={[{ id: 'prod-1', name: '按量产品', billingMode: 'PAY_AS_YOU_GO' }]}
            currencyCode="CNY"
            onOk={() => {
              void form.validateFields().then(onValidated).catch(() => undefined);
            }}
            onCancel={() => undefined}
          />
        </App>
      );
    }

    render(<Harness />);

    await user.type(screen.getByRole('textbox', { name: '充值金额（CNY）' }), '0');
    await user.type(screen.getByRole('textbox', { name: '备注' }), '测试备注');
    await user.click(screen.getByRole('combobox', { name: /关联产品/ }));
    await user.click(await screen.findByText('按量产品 (PAY_AS_YOU_GO)'));
    await user.click(screen.getByRole('button', { name: '确认充值' }));

    expect(await screen.findByText('请输入大于 0 的充值金额')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('0.00')).toHaveValue('0.00');
    expect(onValidated).not.toHaveBeenCalled();
  });

  it('disables confirm while submitting so a second click cannot start another charge', () => {
    function Harness() {
      const [form] = Form.useForm();
      return (
        <App>
          <RechargeEnterpriseAccountModal
            open
            account={{
              id: 'ba-1',
              enterpriseName: '示例科技',
              status: 'active',
              credit: { accountBalanceCents: 100 },
            } as EnterpriseAccount}
            form={form}
            acting
            productLoading={false}
            products={[{ id: 'prod-1', name: '按量产品', billingMode: 'PAY_AS_YOU_GO' }]}
            currencyCode="CNY"
            onOk={() => undefined}
            onCancel={() => undefined}
          />
        </App>
      );
    }

    render(<Harness />);

    expect(screen.getByRole('button', { name: /确认充值/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取 消' })).toBeDisabled();
  });
});

describe('RejectReviewModal', () => {
  function Harness() {
    const [form] = Form.useForm();
    return (
      <App>
        <RejectReviewModal
          open
          form={form}
          acting={false}
          onOk={() => undefined}
          onCancel={() => undefined}
        />
      </App>
    );
  }

  /** jsdom 不做布局，Modal 容器动画也会影响 toBeVisible，因此直接断言内联 display。 */
  function noteItem(): HTMLElement {
    const item = screen.getByText('运营备注（可选）').closest('.ant-form-item');
    if (!(item instanceof HTMLElement)) throw new Error('未找到运营备注 Form.Item');
    return item;
  }

  it('hides the operator note but keeps the required reject fields', () => {
    render(<Harness />);

    // 字段仍挂在表单里（可重置/回填），只是视觉隐藏
    expect(noteItem()).toHaveStyle({ display: 'none' });
    expect(screen.getByPlaceholderText('内部备注')).toBeInTheDocument();

    // 驳回必填项不受影响
    expect(screen.getByText('驳回分类')).toBeInTheDocument();
    expect(screen.getByText('驳回原因')).toBeInTheDocument();
  });
});

describe('ReviewApplicationView', () => {
  it('hides the operator note row but keeps the reject reason row', () => {
    render(
      <App>
        <ReviewApplicationView
          application={{
            applicationId: 'app-1',
            applicationNo: 'EVR-20261026-0001',
            verificationId: 'ver-1',
            userId: 'user-1',
            enterpriseName: '示例科技有限公司',
            uscc: '91110108MA01XXXX01',
            reviewStatus: 'REJECTED',
            provisioningStatus: null,
            rejectCategory: 'payment_proof',
            rejectReason: '转账金额与申请不一致',
            reviewNote: '这是内部运营备注，不应展示',
          }}
          canReview={false}
          acting={false}
          onViewProof={() => undefined}
          onViewLicense={() => undefined}
          onApprove={() => undefined}
          onReject={() => undefined}
          onVoid={() => undefined}
        />
      </App>,
    );

    expect(screen.getByText('驳回原因')).toBeInTheDocument();
    expect(screen.getByText('转账金额与申请不一致')).toBeInTheDocument();
    expect(screen.queryByText('运营备注')).not.toBeInTheDocument();
    expect(screen.queryByText('这是内部运营备注，不应展示')).not.toBeInTheDocument();
  });
});

describe('EnterpriseModelTierPrices', () => {
  it('renders every LIST tier and all token price buckets instead of the top-level fallback', () => {
    render(<EnterpriseModelTierPrices row={tieredRow} multiplier={0.5} currency="cny" />);

    const defaultTier = screen.getByTestId('enterprise-price-tier-glm-5-turbo-default');
    expect(defaultTier).toHaveTextContent('0-32K · input tokens < 32,000');
    expect(defaultTier).toHaveTextContent('输入¥5.00→¥2.50');
    expect(defaultTier).toHaveTextContent('缓存读¥1.20→¥0.60');
    expect(defaultTier).toHaveTextContent('缓存写—→—');
    expect(defaultTier).toHaveTextContent('输出¥22.00→¥11.00');

    const longTier = screen.getByTestId('enterprise-price-tier-glm-5-turbo-tier_2');
    expect(longTier).toHaveTextContent('32K+ · input tokens ≥ 32,000');
    expect(longTier).toHaveTextContent('输入¥7.00→¥3.50');
    expect(longTier).toHaveTextContent('缓存读¥1.80→¥0.90');
    expect(longTier).toHaveTextContent('缓存写¥8.00→¥4.00');
    expect(longTier).toHaveTextContent('输出¥26.00→¥13.00');

    expect(screen.queryByText('¥99.00')).not.toBeInTheDocument();
    expect(screen.queryByText('¥199.00')).not.toBeInTheDocument();
  });

  it('previews a changed model-level multiplier for every tier', () => {
    render(<EnterpriseModelTierPrices row={tieredRow} multiplier={0.25} currency="cny" />);

    const defaultTier = screen.getByTestId('enterprise-price-tier-glm-5-turbo-default');
    expect(defaultTier).toHaveTextContent('输入¥5.00→¥1.25');
    expect(defaultTier).toHaveTextContent('输出¥22.00→¥5.50');

    const longTier = screen.getByTestId('enterprise-price-tier-glm-5-turbo-tier_2');
    expect(longTier).toHaveTextContent('输入¥7.00→¥1.75');
    expect(longTier).toHaveTextContent('输出¥26.00→¥6.50');
  });

  it('falls back to the legacy base/effective contract when tiers are absent', () => {
    const legacyRow: EnterpriseModelDiscountRow = {
      ...tieredRow,
      tiers: undefined,
      fallbackPricing: undefined,
      base: { input: 7, cached: 1.8, cacheWrite: null, output: 26 },
      effective: { input: 3.5, cached: 0.9, cacheWrite: null, output: 13 },
    };

    render(<EnterpriseModelTierPrices row={legacyRow} multiplier={0.5} currency="cny" />);

    const fallback = screen.getByTestId('enterprise-price-tier-glm-5-turbo-legacy-base');
    expect(fallback).toHaveTextContent('默认价（未返回价格档）');
    expect(fallback).toHaveTextContent('输入¥7.00→¥3.50');
    expect(fallback).toHaveTextContent('缓存读¥1.80→¥0.90');
    expect(fallback).toHaveTextContent('缓存写—→—');
    expect(fallback).toHaveTextContent('输出¥26.00→¥13.00');
    expect(within(fallback).getAllByText('→')).toHaveLength(4);
  });

  it('appends long-context and default runtime fallbacks after explicit tiers', () => {
    const row: EnterpriseModelDiscountRow = {
      ...tieredRow,
      fallbackPricing: {
        longContext: {
          minInputTokens: 128_000,
          base: { input: 9, cached: 2.1, cacheWrite: 10, output: 30 },
          effective: { input: 4.5, cached: 1.05, cacheWrite: 5, output: 15 },
        },
        default: {
          base: { input: 6, cached: 1.4, cacheWrite: null, output: 24 },
          effective: { input: 3, cached: 0.7, cacheWrite: null, output: 12 },
        },
      },
    };

    render(<EnterpriseModelTierPrices row={row} multiplier={0.5} currency="cny" />);

    expect(screen.getByTestId('enterprise-price-tier-glm-5-turbo-default')).toBeInTheDocument();
    expect(screen.getByTestId('enterprise-price-tier-glm-5-turbo-tier_2')).toBeInTheDocument();

    const longContext = screen.getByTestId(
      'enterprise-price-tier-glm-5-turbo-fallback-long-context',
    );
    expect(longContext).toHaveTextContent(
      '长上下文后备价 · 未命中显式价格档且 input tokens ≥ 128,000',
    );
    expect(longContext).toHaveTextContent('输入¥9.00→¥4.50');
    expect(longContext).toHaveTextContent('缓存读¥2.10→¥1.05');
    expect(longContext).toHaveTextContent('缓存写¥10.00→¥5.00');
    expect(longContext).toHaveTextContent('输出¥30.00→¥15.00');

    const fallbackDefault = screen.getByTestId(
      'enterprise-price-tier-glm-5-turbo-fallback-default',
    );
    expect(fallbackDefault).toHaveTextContent(
      '默认后备价 · 未命中显式价格档且未命中长上下文价',
    );
    expect(fallbackDefault).toHaveTextContent('输入¥6.00→¥3.00');
    expect(fallbackDefault).toHaveTextContent('输出¥24.00→¥12.00');
    expect(screen.queryByTestId('enterprise-price-tier-glm-5-turbo-legacy-base'))
      .not.toBeInTheDocument();
  });

  it('shows only the default runtime fallback when no long-context price exists', () => {
    const row: EnterpriseModelDiscountRow = {
      ...tieredRow,
      tiers: undefined,
      fallbackPricing: {
        longContext: null,
        default: {
          base: { input: 5, cached: 1.2, cacheWrite: null, output: 22 },
          effective: { input: 2.5, cached: 0.6, cacheWrite: null, output: 11 },
        },
      },
    };

    render(<EnterpriseModelTierPrices row={row} multiplier={0.5} currency="cny" />);

    const fallbackDefault = screen.getByTestId(
      'enterprise-price-tier-glm-5-turbo-fallback-default',
    );
    expect(fallbackDefault).toHaveTextContent('默认后备价 · 未命中显式价格档');
    expect(fallbackDefault).toHaveTextContent('输入¥5.00→¥2.50');
    expect(fallbackDefault).toHaveTextContent('缓存读¥1.20→¥0.60');
    expect(fallbackDefault).toHaveTextContent('缓存写—→—');
    expect(fallbackDefault).toHaveTextContent('输出¥22.00→¥11.00');
    expect(screen.queryByTestId('enterprise-price-tier-glm-5-turbo-fallback-long-context'))
      .not.toBeInTheDocument();
    expect(screen.queryByTestId('enterprise-price-tier-glm-5-turbo-legacy-base'))
      .not.toBeInTheDocument();
  });
});

describe('formatEnterprisePriceTierRange', () => {
  it('formats bounded, open-ended and all-token ranges precisely', () => {
    expect(formatEnterprisePriceTierRange(0, 32_000)).toBe('input tokens < 32,000');
    expect(formatEnterprisePriceTierRange(32_000, null)).toBe('input tokens ≥ 32,000');
    expect(formatEnterprisePriceTierRange(16_000, 32_000)).toBe(
      '16,000 ≤ input tokens < 32,000',
    );
    expect(formatEnterprisePriceTierRange(0, null)).toBe('全部 input tokens');
  });
});

describe('enterprise credit policy boundary audit', () => {
  it('shows the current enterprise credit settlement mode and confirmed boundary', () => {
    render(
      <BillingAccountView
        account={{
          id: 'acct-1',
          credit: {
            billingAccountId: 'acct-1',
            status: 'ACTIVE',
            limitCents: 100_000,
            activeLimitCents: 100_000,
            usedCents: 10_000,
            remainingCents: 90_000,
            accountBalanceCents: -10_000,
            accountAvailableBalanceCents: 90_000,
            policyRevision: 3,
            policyEffectiveBoundaryAt: '2026-08-06T12:00:00.001Z',
            policyBoundaryComplete: true,
            termsDays: 30,
          },
        }}
        canManage={false}
        currency="cny"
        onRecharge={() => undefined}
        onAdjustBalance={() => undefined}
        onConfigureCredit={() => undefined}
        onConfigureDiscount={() => undefined}
      />,
    );

    expect(screen.getByText('信用额度（额度 + 30 天账期）')).toBeInTheDocument();
    expect(screen.getByText('已确认')).toBeInTheDocument();
    expect(screen.getByText('策略 v3')).toBeInTheDocument();
  });

  it('marks the decision-to-confirmed gap as pending and renders the closed gap precisely', () => {
    const events: EnterpriseAccountCreditEvent[] = [
      {
        id: 'event-pending',
        billingAccountId: 'acct-1',
        oldLimitCents: 0,
        newLimitCents: 100_000,
        oldStatus: 'DISABLED',
        newStatus: 'ACTIVE',
        oldTermsDays: null,
        newTermsDays: 30,
        policyRevision: 4,
        policyDecisionAt: '2026-08-06T12:00:00.000Z',
        policyEffectiveBoundaryAt: null,
        policyBoundaryComplete: false,
        policyFanoutEnqueuedAt: null,
        reason: '合同授信',
        createdAt: '2026-08-06T12:00:00.000Z',
      },
      {
        id: 'event-complete',
        billingAccountId: 'acct-1',
        oldLimitCents: 100_000,
        newLimitCents: 200_000,
        oldStatus: 'ACTIVE',
        newStatus: 'ACTIVE',
        oldTermsDays: 30,
        newTermsDays: 30,
        policyRevision: 3,
        policyDecisionAt: '2026-08-05T12:00:00.000Z',
        policyEffectiveBoundaryAt: '2026-08-05T12:00:00.001Z',
        policyBoundaryComplete: true,
        policyFanoutEnqueuedAt: '2026-08-05T12:00:01.000Z',
        reason: '额度调整',
        createdAt: '2026-08-05T12:00:00.000Z',
      },
    ];

    render(<CreditEventAuditTrail creditEvents={events} currency="cny" />);

    expect(screen.getByText('信用策略时间边界审计（最近 5 条）')).toBeInTheDocument();
    expect(screen.getByText('确认中')).toBeInTheDocument();
    expect(screen.getByText(/decision → confirmed gap 尚未闭合/)).toBeInTheDocument();
    expect(screen.getByText('已确认')).toBeInTheDocument();
    expect(screen.getByText(/decision → confirmed gap 1 毫秒（已闭合）/)).toBeInTheDocument();
    expect(screen.getByText(/后续处理：已入队/)).toBeInTheDocument();
  });
});
