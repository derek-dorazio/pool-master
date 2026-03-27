import { usePreferencesStore } from '@/stores/preferences-store';
import {
  formatNumber,
  formatDecimal,
  formatPercent,
  formatOrdinal,
  formatCompact,
} from '@/lib/format-number';
import { formatCurrency, formatCurrencyWithCode } from '@/lib/format-currency';
import { formatParticipantPrice } from '@/lib/format-salary';

/**
 * Convenience hook that reads the user's locale from the preferences store
 * and returns bound formatting functions.
 */
export function useFormat() {
  const { numberFormat } = usePreferencesStore();

  return {
    number: (value: number) => formatNumber(value, numberFormat),
    decimal: (value: number, decimals: number) => formatDecimal(value, decimals, numberFormat),
    percent: (value: number, decimals?: number) => formatPercent(value, decimals, numberFormat),
    ordinal: formatOrdinal,
    compact: (value: number) => formatCompact(value, numberFormat),
    currency: (amountInCents: number, currency: string) =>
      formatCurrency(amountInCents, currency, numberFormat),
    currencyWithCode: (amountInCents: number, currency: string) =>
      formatCurrencyWithCode(amountInCents, currency, numberFormat),
    salary: (priceInCents: number, currency: string) =>
      formatParticipantPrice(priceInCents, currency, numberFormat),
  };
}
