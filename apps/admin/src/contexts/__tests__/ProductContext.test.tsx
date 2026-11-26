import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProductProvider, useProduct } from '../ProductContext';

function Probe() {
  const { currentProductId, setProduct } = useProduct();
  return (
    <div>
      <span data-testid="current">{currentProductId ?? 'ALL'}</span>
      <button onClick={() => setProduct('codingplan')}>set</button>
    </div>
  );
}

describe('ProductContext', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to ALL (null)', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });

  it('setProduct updates value and persists', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    act(() => { screen.getByText('set').click(); });
    expect(screen.getByTestId('current').textContent).toBe('codingplan');
    const stored = JSON.parse(localStorage.getItem('admin.currentProduct') ?? '{}');
    expect(stored.value).toBe('codingplan');
  });

  it('restores from localStorage if not expired', () => {
    localStorage.setItem('admin.currentProduct', JSON.stringify({
      value: 'ai-write',
      expiresAt: Date.now() + 1000 * 60 * 60,
    }));
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ai-write');
  });

  it('ignores expired localStorage', () => {
    localStorage.setItem('admin.currentProduct', JSON.stringify({
      value: 'expired',
      expiresAt: Date.now() - 1000,
    }));
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });

  it('falls back to ALL when localStorage value is malformed JSON', () => {
    localStorage.setItem('admin.currentProduct', '{not valid json');
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });

  it('removes the entry when setProduct(null) is called', () => {
    localStorage.setItem('admin.currentProduct', JSON.stringify({
      value: 'codingplan',
      expiresAt: Date.now() + 1000 * 60 * 60,
    }));
    function Resetter() {
      const { setProduct } = useProduct();
      return <button onClick={() => setProduct(null)}>reset</button>;
    }
    render(<ProductProvider><Probe /><Resetter /></ProductProvider>);
    act(() => { screen.getByText('reset').click(); });
    expect(localStorage.getItem('admin.currentProduct')).toBeNull();
    expect(screen.getByTestId('current').textContent).toBe('ALL');
  });
});
