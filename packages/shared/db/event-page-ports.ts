import type { EventPage, EventPageEdition, EventPageOffer, Sport } from '../domain';

/** The event pages (#1007): reference data, seeded by migrations, read by the public pages. */
export interface EventPageRepository {
  /** The page at this address, active or retired, or null when there is none. */
  findBySportSlug(sport: Sport, slug: string): Promise<EventPage | null>;
  /** The active pages, of one sport or every sport, by sport then display order. */
  findActive(sport?: Sport): Promise<EventPage[]>;
  /** The pages' offers, each page's in sort order. */
  findOffers(eventPageIds: readonly string[]): Promise<EventPageOffer[]>;
  /**
   * The editions of a sport league's series, by name, that are not over: DRAFT, SCHEDULED,
   * POSTPONED or IN_PROGRESS. The one under way first, then the soonest to start.
   */
  findEditionsNotOver(sportLeagueId: string, eventSeriesName: string): Promise<EventPageEdition[]>;
}
