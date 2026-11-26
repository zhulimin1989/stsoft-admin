import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { ProductSwitcher } from '../ProductSwitcher';
import { ProductProvider } from '../../../contexts/ProductContext';

const products = [
  { id: 'codingplan', name: 'CodingPlan', billingMode: 'CODING_PLAN' as const },
  { id: 'ai-write', name: 'AI 写作', billingMode: 'PAY_AS_YOU_GO' as const },
];

beforeEach(() => {
  localStorage.clear();
});

describe('ProductSwitcher', () => {
  it('shows ALL when no product selected', () => {
    render(
      <ProductProvider>
        <ProductSwitcher products={products} />
      </ProductProvider>,
    );
    expect(screen.getByText(/全部产品/)).toBeInTheDocument();
  });

  it('opens dropdown when clicked and selects a product', async () => {
    render(
      <ProductProvider>
        <ProductSwitcher products={products} />
      </ProductProvider>,
    );
    fireEvent.click(screen.getByText(/全部产品/));
    const item = await screen.findByText('CodingPlan');
    fireEvent.click(item);
    // After selection, button label should be "产品: CodingPlan ▾"
    expect(screen.getByText(/CodingPlan/)).toBeInTheDocument();
  });

  it('can reset selection back to all products', async () => {
    render(
      <ProductProvider>
        <ProductSwitcher products={products} />
      </ProductProvider>,
    );
    fireEvent.click(screen.getByText(/全部产品/));
    fireEvent.click(await screen.findByText('CodingPlan'));

    fireEvent.click(screen.getByText(/CodingPlan/));
    fireEvent.click(await screen.findByText('全部产品'));

    expect(screen.getByText(/全部产品/)).toBeInTheDocument();
  });

  it('disables button when forceLocked', () => {
    render(
      <ProductProvider>
        <ProductSwitcher products={products} forceLocked />
      </ProductProvider>,
    );
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
  });
});
