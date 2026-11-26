import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';

const STORAGE_KEY = 'admin.currentProduct';
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Persisted {
  value: string | null;
  expiresAt: number;
}

interface ProductCtx {
  currentProductId: string | null;
  setProduct: (id: string | null) => void;
  locked: boolean;
  setLocked: (locked: boolean) => void;
}

const Ctx = createContext<ProductCtx | null>(null);

function readPersisted(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Persisted;
    if (parsed.expiresAt < Date.now()) {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed.value ?? null;
  } catch {
    return null;
  }
}

function writePersisted(value: string | null) {
  if (value === null) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  const data: Persisted = { value, expiresAt: Date.now() + TTL_MS };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function ProductProvider({ children }: { children: ReactNode }) {
  const [currentProductId, setCurrentProductId] = useState<string | null>(readPersisted);
  const [locked, setLocked] = useState(false);

  const setProduct = useCallback((id: string | null) => {
    setCurrentProductId(id);
    writePersisted(id);
  }, []);

  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setCurrentProductId(readPersisted());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  return (
    <Ctx.Provider value={{ currentProductId, setProduct, locked, setLocked }}>
      {children}
    </Ctx.Provider>
  );
}

export function useProduct() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useProduct must be inside ProductProvider');
  return ctx;
}
