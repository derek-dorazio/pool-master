/**
 * Event pages (#1007, `plans/event-landing-pages.md`): public pages for one event a fan would
 * name, at `/play/<sport URL segment>/<page URL segment>`. Each lists offers, a contest setup on one sport league's
 * series, shown with that series' next edition.
 */
import type { ContestConfigTemplate } from './contest-management-types';
import type { Sport } from './enums';

/** Where an event page lives: its sport and both stored URL segments (#2042). */
export interface EventPageAddress {
  sport: Sport;
  /** The sport's stored URL segment: `football`. */
  sportUrlSegment: string;
  /** The page's stored URL segment within its sport: `championship-weekend`. */
  urlSegment: string;
}

/**
 * An event page's address: `/play/football/championship-weekend`, from the two stored
 * segments, never from names or codes. The API returns it on each page, and emails link to it.
 */
export function buildEventPagePath(address: Pick<EventPageAddress, 'sportUrlSegment' | 'urlSegment'>): string {
  return `/play/${address.sportUrlSegment}/${address.urlSegment}`;
}

/**
 * Whether an offer's edition takes contests now. OPEN: Create contest would accept it (released,
 * field loaded, cutoff ahead; for a later-round bracket, that round's teams set). NOT_YET: the
 * edition is still to open. An edition past its cutoff is no state: the offer is left out.
 */
export const EventPageOfferState = {
  OPEN: 'OPEN',
  NOT_YET: 'NOT_YET',
} as const;
export type EventPageOfferState = (typeof EventPageOfferState)[keyof typeof EventPageOfferState];

/** An event page's row: its address, its place among its sport's pages, and its lifecycle. */
export interface EventPage extends EventPageAddress {
  id: string;
  displayOrder: number;
  /** False: retired; its URL goes to `redirectTo`, or says it has moved. */
  isActive: boolean;
  /** Where a retired page's URL goes now; null without a successor. */
  redirectTo: EventPageAddress | null;
}

/** One offer of an event page, with the setup it starts as and its sport league's name. */
export interface EventPageOffer {
  id: string;
  eventPageId: string;
  sportLeagueId: string;
  /** The sport league as screens away from its sport's own pages name it. */
  sportLeagueName: string;
  /** The slot definition it runs on (#2010): shown with the next Season slot of it not yet over. */
  sportLeagueCompetitionSlotId: string;
  template: ContestConfigTemplate;
  /** The round a bracket starts at, when not the template's own; null otherwise. */
  bracketStartRound: number | null;
  sortOrder: number;
  isPrimary: boolean;
}

/**
 * A Season slot an offer may be shown with (#2010): one of its slot definition's Season slots not
 * yet over, with the event that owns it.
 */
export interface EventPageNextSlot {
  seasonSlotId: string;
  sportEventId: string;
  name: string;
  /** The year its Season is named for. */
  championshipYear: number;
  startDate: Date;
  endDate: Date | null;
}
