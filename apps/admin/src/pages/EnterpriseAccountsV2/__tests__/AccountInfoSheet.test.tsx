import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AccountInfoSheet } from '../AccountInfoSheet';
import type { EnterpriseAccountV2 } from '../../../api/v2/enterpriseAccountsV2';
import { creditStatusLabel, fundingModeText } from '../formatters';

function sampleAccount(overrides: Partial<EnterpriseAccountV2> = {}): EnterpriseAccountV2 {
  return {
    id: 'ba-1',
    type: 'enterprise',
    enterpriseName: '示例科技有限公司',
    uscc: '91110000DEMO0001',
    ownerUserId: 'user-1',
    status: 'active',
    verificationId: 'ver-1',
    createdAt: '2026-07-01T04:00:00.000Z',
    phone: '13812348888',
    email: 'owner@example.com',
    prepaid: false,
    credit: {
      billingAccountId: 'ba-1',
      status: 'ACTIVE',
      limitCents: 1_000_000,
      usedCents: 550_050,
      remainingCents: 449_950,
      activeLimitCents: 1_000_000,
      accountBalanceCents: -222_000,
      accountAvailableBalanceCents: 227_950,
      policyRevision: 2,
      policyEffectiveBoundaryAt: '2026-09-04T07:21:58.000Z',
      policyBoundaryComplete: true,
      termsDays: 30,
      expiresAt: null,
    },
    ownerMembers: [],
    ...overrides,
  };
}

describe('AccountInfoSheet', () => {
  it('renders three PRD sections with billing labels and empty owner members as 无', () => {
    render(<AccountInfoSheet account={sampleAccount()} currency="CNY" />);

    expect(screen.getByText('基础信息')).toBeInTheDocument();
    expect(screen.getByText('账户信息')).toBeInTheDocument();
    expect(screen.getByText('账务态 billing')).toBeInTheDocument();
    expect(screen.getByText('Owner 成员')).toBeInTheDocument();

    expect(screen.getByText('余额（CNY）')).toBeInTheDocument();
    expect(screen.getByText('企业授信（信用额度）')).toBeInTheDocument();
    expect(screen.getByText('资金处理方式')).toBeInTheDocument();
    expect(screen.getByText('信用额度（额度 + 自然月结算 + 30 天回款）')).toBeInTheDocument();
    expect(screen.getByText('启用')).toBeInTheDocument();
    expect(screen.getByText('长期有效')).toBeInTheDocument();
    expect(screen.getByText('无')).toBeInTheDocument();
    expect(document.querySelector('.ea-v2-desc-wrap')).not.toBeNull();
    const colgroups = document.querySelectorAll('colgroup.ea-v2-desc-cols');
    expect(colgroups.length).toBeGreaterThanOrEqual(2);
    expect(colgroups[0]?.querySelectorAll('col')).toHaveLength(4);
  });

  it('uses platform currency in the balance label', () => {
    render(<AccountInfoSheet account={sampleAccount()} currency="usd" />);
    expect(screen.getByText('余额（USD）')).toBeInTheDocument();
    expect(screen.queryByText('余额（CNY）')).not.toBeInTheDocument();
  });

  it('wraps long policy-boundary copy so Descriptions cells can shrink', () => {
    const { container } = render(
      <AccountInfoSheet
        account={sampleAccount({
          credit: {
            billingAccountId: 'ba-1',
            status: 'DISABLED',
            limitCents: 0,
            usedCents: 0,
            remainingCents: 0,
            activeLimitCents: 0,
            accountBalanceCents: 1000,
            accountAvailableBalanceCents: 1000,
            policyRevision: 0,
            policyEffectiveBoundaryAt: null,
            policyBoundaryComplete: false,
            termsDays: null,
            expiresAt: null,
          },
        })}
        currency="CNY"
      />,
    );

    const wrap = container.querySelector('.ea-v2-desc-wrap');
    expect(wrap).not.toBeNull();
    expect(wrap?.textContent).toMatch(/无可验证的策略时间边界/);
  });

  it('lists owner members when present', () => {
    render(
      <AccountInfoSheet
        account={sampleAccount({
          ownerMembers: [{ userId: 'u-owner', role: 'owner', status: 'active' }],
        })}
        currency="CNY"
      />,
    );
    expect(screen.getByText('u-owner')).toBeInTheDocument();
    expect(screen.getByText('owner · active')).toBeInTheDocument();
  });
});

describe('creditStatusLabel / fundingModeText', () => {
  it('maps credit statuses to PRD copy', () => {
    expect(creditStatusLabel('ACTIVE')).toBe('启用');
    expect(creditStatusLabel('DISABLED')).toBe('停用');
    expect(creditStatusLabel('SUSPENDED')).toBe('已失效（逾期）');
    expect(creditStatusLabel(null)).toBe('—');
  });

  it('maps prepaid vs credit funding modes', () => {
    expect(fundingModeText(true, 30)).toBe('预付款');
    expect(fundingModeText(false, 30)).toBe('信用额度（额度 + 自然月结算 + 30 天回款）');
  });
});
