import { usePreferencesStore } from '@/stores/preferences-store';
import { getCurrencyDecimals } from '@/lib/format-currency';
import { formatPercent } from '@/lib/format-number';

function getLocale(locale?: string): string {
  return locale ?? usePreferencesStore.getState().numberFormat;
}

function fromCents(amountInCents: number, currency: string): number {
  const decimals = getCurrencyDecimals(currency);
  return amountInCents / Math.pow(10, decimals);
}

/**
 * Format participant price in salary cap context.
 * Whole dollars, no cents: $12,500
 */
export function formatParticipantPrice(
  priceInCents: number,
  currency: string,
  locale?: string,
): string {
  const value = fromCents(priceInCents, currency);
  return new Intl.NumberFormat(getLocale(locale), {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

/**
 * Format remaining budget.
 * "$37,500 of $50,000 remaining"
 */
export function formatRemainingBudget(
  remainingCents: number,
  totalCents: number,
  currency: string,
  locale?: string,
): string {
  const remaining = formatParticipantPrice(remainingCents, currency, locale);
  const total = formatParticipantPrice(totalCents, currency, locale);
  return `${remaining} of ${total} remaining`;
}

/**
 * Format budget percentage used.
 * "25% used"
 */
export function formatBudgetUsed(usedCents: number, totalCents: number): string {
  if (totalCents === 0) {
    return '0% used';
  }
  const ratio = usedCents / totalCents;
  return `${formatPercent(ratio, 0)} used`;
}
