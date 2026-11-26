import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// AntD components (Table, Drawer, Grid) use window.matchMedia which jsdom does not implement.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

// vitest 4 + jsdom 29 ship a Storage object whose methods aren't reachable.
// Replace with a working in-memory Storage so localStorage/sessionStorage behave correctly in tests.
if (typeof window !== 'undefined') {
  const makeStorage = (): Storage => {
    let store: Record<string, string> = {};
    return {
      get length() { return Object.keys(store).length; },
      key(i: number) { return Object.keys(store)[i] ?? null; },
      getItem(key: string) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key: string, value: string) { store[key] = String(value); },
      removeItem(key: string) { delete store[key]; },
      clear() { store = {}; },
    } as Storage;
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, writable: true, value: makeStorage() });
  Object.defineProperty(window, 'sessionStorage', { configurable: true, writable: true, value: makeStorage() });
}

afterEach(() => {
  cleanup();
});
