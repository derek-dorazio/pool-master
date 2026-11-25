import type { EventPage, EventPageNextSlot, EventPageOffer, Sport } from '../domain';

/** The event pages (#1007): reference data, seeded by migrations, read by the public pages. */
export interface EventPageRepository {
  /** The page at this address (its sport's URL segment, then its own), active or retired, or null when there is none. */
  findByUrlSegments(sportUrlSegment: string, urlSegment: string): Promise<EventPage | null>;
  /** The active pages, of one sport or every sport, by sport then display order. */
  findActive(sport?: Sport): Promise<EventPage[]>;
  /** The pages' offers whose setup is active, each page's in sort order. */
  findOffers(eventPageIds: readonly string[]): Promise<EventPageOffer[]>;
  /**
   * Each slot definition's Season slots whose event is not over, in one read however many
   * definitions (#1316, #2010): the owning event DRAFT, SCHEDULED, POSTPONED or IN_PROGRESS, the
   * one under way first, then the soonest to start. One list per definition asked for, in the
   * order asked; a Season slot no event owns yet is left out.
   */
  findSlotsNotOver(sportLeaguePhaseSlotIds: readonly string[]): Promise<EventPageNextSlot[][]>;
}
