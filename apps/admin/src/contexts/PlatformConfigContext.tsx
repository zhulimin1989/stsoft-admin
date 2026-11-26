import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { platformConfigApi } from '../api/admin';
import { DEFAULT_PLATFORM_CURRENCY, normalizeCurrency } from '../utils/price';
import { warnNonCritical } from '../utils/logging';

interface PlatformConfigContextValue {
  currency: string;
  refresh: () => Promise<void>;
  setCurrency: (currency: string | null | undefined) => void;
}

const envCurrency = normalizeCurrency(
  import.meta.env.VITE_PLATFORM_CURRENCY ??
    import.meta.env.VITE_BILLING_CURRENCY ??
    import.meta.env.VITE_CURRENCY ??
    currencyForRegion(import.meta.env.VITE_PLATFORM_REGION) ??
    DEFAULT_PLATFORM_CURRENCY,
);

const PlatformConfigContext = createContext<PlatformConfigContextValue>({
  currency: envCurrency,
  refresh: async () => {},
  setCurrency: () => {},
});

function normalizePlatformCurrency(value: unknown): string {
  return normalizeCurrency(typeof value === 'string' ? value : undefined, envCurrency);
}

function extractPlatformCurrency(data: unknown): string {
  if (!data || typeof data !== 'object') return envCurrency;
  const platformConfig = (data as { platformConfig?: unknown }).platformConfig;
  if (!platformConfig || typeof platformConfig !== 'object') return envCurrency;
  const src = platformConfig as { currency?: unknown; region?: unknown };
  return normalizeCurrency(
    typeof src.currency === 'string' ? src.currency : undefined,
    currencyForRegion(src.region) ?? envCurrency,
  );
}

function currencyForRegion(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'domestic' || normalized === 'cn' || normalized === 'china') return 'CNY';
  if (
    normalized === 'overseas' ||
    normalized === 'global' ||
    normalized === 'intl' ||
    normalized === 'international'
  ) {
    return 'USD';
  }
  return undefined;
}

export function PlatformConfigProvider({ children }: { children: ReactNode }) {
  const [currency, setCurrencyState] = useState(envCurrency);

  const setCurrency = useCallback((next: string | null | undefined) => {
    setCurrencyState(normalizePlatformCurrency(next));
  }, []);

  const refresh = useCallback(async () => {
    const data = await platformConfigApi.get();
    setCurrencyState(extractPlatformCurrency(data));
  }, []);

  useEffect(() => {
    void refresh().catch((error: unknown) => {
      warnNonCritical('Load admin platform config', error);
    });
  }, [refresh]);

  const value = useMemo(
    () => ({ currency, refresh, setCurrency }),
    [currency, refresh, setCurrency],
  );

  return (
    <PlatformConfigContext.Provider value={value}>
      {children}
    </PlatformConfigContext.Provider>
  );
}

export function usePlatformConfig() {
  return useContext(PlatformConfigContext);
}

export function usePlatformCurrency() {
  return usePlatformConfig().currency;
}
