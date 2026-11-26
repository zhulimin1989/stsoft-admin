import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BillActionButton } from '../billActions';

describe('BillActionButton', () => {
  it('disables current-month write-off with the 当月 tooltip', () => {
    render(
      <BillActionButton
        label="账单核销"
        reason="当月仅支持下载"
        onClick={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: '账单核销' })).toBeDisabled();
  });

  it('keeps download-related actions clickable when no reason is given', () => {
    const onClick = vi.fn();
    render(<BillActionButton label="账单核销" reason={null} onClick={onClick} />);
    expect(screen.getByRole('button', { name: '账单核销' })).toBeEnabled();
  });
});
