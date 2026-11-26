import { useProduct } from '../contexts/ProductContext';

/** Returns the currently selected productId, or null if "all products" is active. */
export function useCurrentProduct(): string | null {
  return useProduct().currentProductId;
}
