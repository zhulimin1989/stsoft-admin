import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Tag } from '../Tag';

describe('Tag', () => {
  it('renders text content', () => {
    render(<Tag variant="success">启用</Tag>);
    expect(screen.getByText('启用')).toBeInTheDocument();
  });

  it('exposes variant via data-variant attribute', () => {
    const { container } = render(<Tag variant="error">异常</Tag>);
    expect(container.firstChild).toHaveAttribute('data-variant', 'error');
  });

  it('defaults to muted variant', () => {
    const { container } = render(<Tag>类型</Tag>);
    expect(container.firstChild).toHaveAttribute('data-variant', 'muted');
  });

  it('renders rich children', () => {
    render(<Tag variant="success"><b>3</b> 在线</Tag>);
    expect(screen.getByText('3').tagName).toBe('B');
    expect(screen.getByText(/在线/)).toBeInTheDocument();
  });
});
