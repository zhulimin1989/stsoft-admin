import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { StatCard, StatCardGroup } from '../StatCard';

describe('StatCard', () => {
  it('renders label and value', () => {
    render(<StatCard label="总用户" value={12486} />);
    expect(screen.getByText('总用户')).toBeInTheDocument();
    expect(screen.getByText('12,486')).toBeInTheDocument();
  });

  it('renders string value as-is', () => {
    render(<StatCard label="GMV" value="¥328,450" />);
    expect(screen.getByText('¥328,450')).toBeInTheDocument();
  });

  it('renders delta with up trend', () => {
    render(<StatCard label="x" value={1} delta={{ value: 124, period: '本周', trend: 'up' }} />);
    expect(screen.getByText(/124/)).toBeInTheDocument();
    expect(screen.getByText(/本周/)).toBeInTheDocument();
  });

  it('applies error variant class', () => {
    const { container } = render(<StatCard label="异常" value={17} variant="error" />);
    expect(container.querySelector('.rt-stat-value')).toHaveClass('rt-stat-value-error');
  });
});

describe('StatCardGroup', () => {
  it('renders children in grid', () => {
    const { container } = render(
      <StatCardGroup>
        <StatCard label="a" value={1} />
        <StatCard label="b" value={2} />
      </StatCardGroup>,
    );
    expect(container.querySelectorAll('.rt-stat')).toHaveLength(2);
  });
});
