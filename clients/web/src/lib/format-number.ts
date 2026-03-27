import { usePreferencesStore } from '@/stores/preferences-store';

function getLocale(locale?: string): string {
  return locale ?? usePreferencesStore.getState().numberFormat;
}

/**
 * Format a number according to locale (uses Intl.NumberFormat).
 * 1234.56 -> "1,234.56" (en-US), "1.234,56" (de-DE), "1 234,56" (fr-FR)
 */
export function formatNumber(value: number, locale?: string): string {
  return new Intl.NumberFormat(getLocale(locale)).format(value);
}

/**
 * Format with specific decimal places.
 */
export function formatDecimal(value: number, decimals: number, locale?: string): string {
  return new Intl.NumberFormat(getLocale(locale), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format as percentage.
 * 0.753 -> "75.3%" (en-US), "75,3%" (de-DE)
 */
export function formatPercent(value: number, decimals?: number, locale?: string): string {
  return new Intl.NumberFormat(getLocale(locale), {
    style: 'percent',
    minimumFractionDigits: decimals ?? 0,
    maximumFractionDigits: decimals ?? 1,
  }).format(value);
}

/**
 * Format ordinal ("1st", "2nd", "3rd", etc.).
 * English only for now, but structured for i18n later.
 */
export function formatOrdinal(n: number): string {
  const abs = Math.abs(n);
  const rem100 = abs % 100;

  if (rem100 >= 11 && rem100 <= 13) {
    return `${n}th`;
  }

  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/**
 * Format compact number ("1.2K", "3.4M").
 */
export function formatCompact(value: number, locale?: string): string {
  return new Intl.NumberFormat(getLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}
