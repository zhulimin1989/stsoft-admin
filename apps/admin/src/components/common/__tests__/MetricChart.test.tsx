import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MetricChart } from '../MetricChart';

describe('MetricChart', () => {
  it('renders without crashing with empty data', () => {
    const { container } = render(<MetricChart data={[]} dataKey="value" />);
    expect(container.querySelector('.rt-chart')).not.toBeNull();
  });

  it('renders with sample data', () => {
    const data = [{ date: '2026-04-01', value: 100 }, { date: '2026-04-02', value: 200 }];
    const { container } = render(<MetricChart data={data} dataKey="value" />);
    expect(container.querySelector('.rt-chart')).not.toBeNull();
  });
});
