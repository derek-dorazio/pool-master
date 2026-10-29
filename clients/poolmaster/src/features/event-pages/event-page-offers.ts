import type { EventPageDto, EventPageOfferDto } from '@/lib/api';

/** A page's primary offer, the one whose edition heads it; none when its series is between editions. */
export function primaryOffer(page: EventPageDto): EventPageOfferDto | undefined {
  return page.offers.find((offer) => offer.isPrimary);
}

/**
 * Each page with its primary offer, in the order given. The upcoming list (#1202) already holds
 * only pages with one, soonest first; this pairs them so the offer is typed as present.
 */
export function withPrimaryOffer(pages: readonly EventPageDto[]): Array<{ page: EventPageDto; primary: EventPageOfferDto }> {
  return pages.flatMap((page) => {
    const primary = primaryOffer(page);
    return primary ? [{ page, primary }] : [];
  });
}
