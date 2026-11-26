import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DetailDrawer } from '../DetailDrawer';

describe('DetailDrawer', () => {
  it('does not render content when open=false', () => {
    render(<DetailDrawer open={false} onClose={() => {}} title="x" tabs={[]} />);
    expect(screen.queryByText('x')).toBeNull();
  });

  it('renders title and subtitle when open', () => {
    render(
      <DetailDrawer
        open
        onClose={() => {}}
        title="ORD-1"
        subtitle="alice@example.com"
        tabs={[{ key: 'a', label: 'Tab', content: <div>contentA</div> }]}
      />,
    );
    expect(screen.getByText('ORD-1')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
    expect(screen.getByText('contentA')).toBeInTheDocument();
  });

  it('switches tabs', () => {
    render(
      <DetailDrawer
        open
        onClose={() => {}}
        title="t"
        tabs={[
          { key: 'a', label: 'A', content: <div>contentA</div> },
          { key: 'b', label: 'B', content: <div>contentB</div> },
        ]}
      />,
    );
    fireEvent.click(screen.getByText('B'));
    expect(screen.getByText('contentB')).toBeInTheDocument();
  });

  it('calls onClose', () => {
    const onClose = vi.fn();
    render(<DetailDrawer open onClose={onClose} title="t" tabs={[]} />);
    fireEvent.click(screen.getByLabelText('关闭'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
