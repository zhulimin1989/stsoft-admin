import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BalanceAdjustmentModal } from '../BalanceAdjustmentModal';

describe('BalanceAdjustmentModal', () => {
  it('keeps the shared adjustment form account-level', () => {
    render(
      <BalanceAdjustmentModal
        open
        loading={false}
        entityLabel="测试账户"
        currencyCode="CNY"
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(screen.getByText('调整方向')).toBeInTheDocument();
    expect(screen.getByText('调整金额（CNY）')).toBeInTheDocument();
    expect(screen.getByText('调整原因')).toBeInTheDocument();
    expect(screen.getByText('调整说明')).toBeInTheDocument();
    expect(screen.queryByText('关联产品')).not.toBeInTheDocument();
    expect(screen.queryByText('选择按量产品')).not.toBeInTheDocument();
  });
});
