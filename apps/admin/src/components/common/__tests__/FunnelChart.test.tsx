import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FunnelChart } from '../FunnelChart';

describe('FunnelChart', () => {
  it('renders values, relative widths, and conversion rates', () => {
    const { container } = render(
      <FunnelChart
        steps={[
          { label: '访问', value: 1000 },
          { label: '注册', value: 250 },
          { label: '付费', value: 50 },
        ]}
      />,
    );

    expect(screen.getByText('访问')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('20.0%')).toBeInTheDocument();

    const bars = container.querySelectorAll<HTMLElement>('.rt-funnel-bar');
    expect(bars[0]).toHaveStyle({ width: '100%' });
    expect(bars[1]).toHaveStyle({ width: '25%' });
    expect(bars[2]).toHaveStyle({ width: '5%' });
  });

  it('does not divide by zero when previous step is empty', () => {
    render(
      <FunnelChart
        steps={[
          { label: '访问', value: 0 },
          { label: '注册', value: 10 },
        ]}
      />,
    );

    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
