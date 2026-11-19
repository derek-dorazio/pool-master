import type { ExpansionPrice } from '@/lib/api';
import { formatCount, formatMoneyCents } from '@/features/shared/ui';

/** One plan's expansion price list in a line: "50 entries $10 · 1,000 entries $30", or "None". */
export function describeExpansionPrices(prices: readonly ExpansionPrice[], locale: string): string {
  return prices.length > 0
    ? prices.map((band) => `${formatCount(band.entriesPerContest, 'entry', locale, 'entries')} ${formatMoneyCents(band.priceCents, locale)}`).join(' · ')
    : 'None';
}
