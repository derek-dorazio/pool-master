import type { EventPage, EventPageEdition, EventPageOffer, Sport } from '../domain';

/** The event pages (#1007): reference data, seeded by migrations, read by the public pages. */
export interface EventPageRepository {
  /** The page at this address, active or retired, or null when there is none. */
  findBySportSlug(sport: Sport, slug: string): Promise<EventPage | null>;
  /** The active pages, of one sport or every sport, by sport then display order. */
  findActive(sport?: Sport): Promise<EventPage[]>;
  /** The pages' offers whose setup is active, each page's in sort order. */
  findOffers(eventPageIds: readonly string[]): Promise<EventPageOffer[]>;
  /**
   * Each series' editions that are not over, in one read however many series (#1316): DRAFT,
   * SCHEDULED, POSTPONED or IN_PROGRESS, the one under way first, then the soonest to start. One
   * list per series asked for, in the order asked; a series is a sport league's, by name.
   */
  findEditionsNotOver(series: readonly EventPageSeries[]): Promise<EventPageEdition[][]>;
}

/** A sport league's series, by name, as an offer names it. */
export interface EventPageSeries {
  sportLeagueId: string;
  eventSeriesName: string;
}
