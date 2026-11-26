import { useState, useRef, useEffect } from 'react';
import { useProduct } from '../../contexts/ProductContext';
import './ProductSwitcher.css';

export interface ProductOption {
  id: string;
  name: string;
  billingMode: 'SUBSCRIPTION' | 'CODING_PLAN' | 'PAY_AS_YOU_GO';
}

interface ProductSwitcherProps {
  products: ProductOption[];
  forceLocked?: boolean;
}

export function ProductSwitcher({ products, forceLocked }: ProductSwitcherProps) {
  const { currentProductId, setProduct, locked: ctxLocked } = useProduct();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const locked = forceLocked ?? ctxLocked;

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  const current = products.find((p) => p.id === currentProductId);
  const label = current ? current.name : '全部产品';

  return (
    <div className="rt-prod-switcher" ref={ref}>
      <button
        type="button"
        className={`rt-prod-btn ${locked ? 'rt-prod-locked' : ''}`}
        disabled={locked}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="rt-prod-dot" />
        产品: {label} {!locked && '▾'}
      </button>
      {open && !locked && (
        <div className="rt-prod-menu">
          <div
            className="rt-prod-item"
            onClick={() => {
              setProduct(null);
              setOpen(false);
            }}
          >
            全部产品
          </div>
          {products.map((p) => (
            <div
              key={p.id}
              className="rt-prod-item"
              onClick={() => {
                setProduct(p.id);
                setOpen(false);
              }}
            >
              {p.name}
              <span className="rt-prod-mode">{p.billingMode}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
