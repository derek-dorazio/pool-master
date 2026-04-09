import { usePreferencesStore } from '@/stores/preferences-store';

function getLocale(locale?: string): string {
  return locale ?? usePreferencesStore.getState().numberFormat;
}

/**
 * ISO 4217 decimal places for common currencies.
 */
const CURRENCY_DECIMALS: Record<string, number> = {
  USD: 2,
  GBP: 2,
  EUR: 2,
  CAD: 2,
  AUD: 2,
  CHF: 2,
  SEK: 2,
  NOK: 2,
  DKK: 2,
  NZD: 2,
  MXN: 2,
  BRL: 2,
  JPY: 0,
  KRW: 0,
  BHD: 3,
  KWD: 3,
  OMR: 3,
};

/**
 * Get decimal places for a currency (from ISO 4217).
 */
export function getCurrencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Convert from smallest unit (cents) to major unit based on currency decimals.
 */
function fromCents(amountInCents: number, currency: string): number {
  const decimals = getCurrencyDecimals(currency);
  return amountInCents / Math.pow(10, decimals);
}

/**
 * Format currency amount (stored in cents/smallest unit).
 * formatCurrency(5000, 'USD', 'en-US') -> "$50.00"
 * formatCurrency(5000, 'EUR', 'de-DE') -> "50,00 €"
 * formatCurrency(5000, 'JPY', 'ja-JP') -> "¥5,000"
 */
export function formatCurrency(amountInCents: number, currency: string, locale?: string): string {
  const value = fromCents(amountInCents, currency);
  return new Intl.NumberFormat(getLocale(locale), {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(value);
}

/**
 * Format with currency code for disambiguation.
 * "$50.00 USD", "£50.00 GBP"
 */
export function formatCurrencyWithCode(
  amountInCents: number,
  currency: string,
  locale?: string,
): string {
  const formatted = formatCurrency(amountInCents, currency, locale);
  return `${formatted} ${currency.toUpperCase()}`;
}

/**
 * Get currency symbol only.
 */
export function getCurrencySymbol(currency: string, locale?: string): string {
  const parts = new Intl.NumberFormat(getLocale(locale), {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'symbol',
  }).formatToParts(0);

  const symbolPart = parts.find((p) => p.type === 'currency');
  return symbolPart?.value ?? currency.toUpperCase();
}

/**
 * Format salary cap budget display.
 * "$50,000" — no decimal places for large round amounts.
 */
export function formatBudget(amountInCents: number, currency: string, locale?: string): string {
  const value = fromCents(amountInCents, currency);
  return new Intl.NumberFormat(getLocale(locale), {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}
