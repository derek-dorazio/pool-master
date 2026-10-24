import type { BillingConfig, ExpansionPrice } from '@/lib/api';

const PRICE = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 });

/** A price in US cents as the app shows it: "$10", "$12.50". */
export function formatPriceCents(cents: number): string {
  return PRICE.format(cents / 100);
}

/** One plan's expansion price list in a line: "50 entries $10 · 1,000 entries $30", or "None". */
export function describeExpansionPrices(prices: readonly ExpansionPrice[]): string {
  return prices.length > 0
    ? prices.map((band) => `${band.entriesPerContest.toLocaleString('en-US')} entries ${formatPriceCents(band.priceCents)}`).join(' · ')
    : 'None';
}

/** Whether payments are on, as the Settings page and the Expand choice word it. */
export function describePayments(config: Pick<BillingConfig, 'paymentsEnabled'>): string {
  return config.paymentsEnabled ? 'On' : 'Off: expanding a contest is free';
}
