import { normalizeCurrency } from '../../utils/price';

const PLAN_PRICE_CURRENCIES = ['usd', 'sgd', 'cny', 'eur'] as const;

export function normalizePlanPriceCurrency(currency: string | null | undefined): string {
  return normalizeCurrency(currency).toLowerCase();
}

export function planPriceCurrencyOptions(platformCurrency: string): Array<{
  value: string;
  label: string;
}> {
  const currencies = [
    normalizePlanPriceCurrency(platformCurrency),
    ...PLAN_PRICE_CURRENCIES,
  ];
  return [...new Set(currencies)].map((currency) => ({
    value: currency,
    label: currency.toUpperCase(),
  }));
}
