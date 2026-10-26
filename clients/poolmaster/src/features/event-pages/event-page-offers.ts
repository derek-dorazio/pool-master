import type { EventPageDto, EventPageOfferDto } from '@/lib/api';

/** A page's primary offer, the one whose edition heads it; none when its series is between editions. */
export function primaryOffer(page: EventPageDto): EventPageOfferDto | undefined {
  return page.offers.find((offer) => offer.isPrimary);
}

/** The pages with an edition coming, soonest first. */
export function upcomingEventPages(pages: readonly EventPageDto[]): Array<{ page: EventPageDto; primary: EventPageOfferDto }> {
  return pages
    .flatMap((page) => {
      const primary = primaryOffer(page);
      return primary ? [{ page, primary }] : [];
    })
    .sort((a, b) => a.primary.edition.startDate.localeCompare(b.primary.edition.startDate));
}
