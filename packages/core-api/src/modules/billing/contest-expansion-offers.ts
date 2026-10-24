import type { ContestExpansionOffer, ExpansionPrice } from '@poolmaster/shared/dto';

/**
 * The bands a contest can be expanded to (plans/payments.md §4): those on its plan's price list
 * above its cap now, smallest first. A step up costs the band's price less the price of the band
 * the contest bought, both at the plan's current prices; a bought band not on the list counts as
 * the dearest listed band at or below it, or nothing.
 */
export function contestExpansionOffers(
  prices: readonly ExpansionPrice[],
  entriesPerContest: number | null,
  expandedTo: number | null,
): ContestExpansionOffer[] {
  if (entriesPerContest === null) return [];
  const credit = expandedTo === null
    ? 0
    : prices.filter((band) => band.entriesPerContest <= expandedTo).reduce((highest, band) => Math.max(highest, band.priceCents), 0);
  return prices
    .filter((band) => band.entriesPerContest > entriesPerContest)
    .map((band) => ({ entriesPerContest: band.entriesPerContest, priceCents: band.priceCents - credit }));
}
