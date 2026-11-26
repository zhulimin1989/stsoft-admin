import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProductProvider, useProduct } from '../../contexts/ProductContext';
import { useCurrentProduct } from '../useCurrentProduct';

function Probe() {
  const productId = useCurrentProduct();
  const { setProduct } = useProduct();
  return (
    <div>
      <span data-testid="value">{productId ?? 'ALL'}</span>
      <button onClick={() => setProduct('codingplan')}>set</button>
    </div>
  );
}

describe('useCurrentProduct', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns null when no product selected', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    expect(screen.getByTestId('value').textContent).toBe('ALL');
  });

  it('reflects current product after selection', () => {
    render(<ProductProvider><Probe /></ProductProvider>);
    act(() => { screen.getByText('set').click(); });
    expect(screen.getByTestId('value').textContent).toBe('codingplan');
  });
});
