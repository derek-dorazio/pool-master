import type { BillingConfig, ExpansionPrice } from '@/lib/api';
import { formatCount, formatMoneyCents } from '@/features/shared/ui';

/** One plan's expansion price list in a line: "50 entries $10 · 1,000 entries $30", or "None". */
export function describeExpansionPrices(prices: readonly ExpansionPrice[], locale: string): string {
  return prices.length > 0
    ? prices.map((band) => `${formatCount(band.entriesPerContest, 'entry', locale, 'entries')} ${formatMoneyCents(band.priceCents, locale)}`).join(' · ')
    : 'None';
}

/** Whether payments are on, as the Settings page and the Expand choice word it. */
export function describePayments(config: Pick<BillingConfig, 'paymentsEnabled'>): string {
  return config.paymentsEnabled ? 'On' : 'Off: expanding a contest is free';
}
