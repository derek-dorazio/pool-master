/**
 * Event pages (#1007, `plans/event-landing-pages.md`): public pages for one event a fan would
 * name, at `/play/<sport>/<slug>`. Each lists offers, a contest setup on one sport league's
 * series, shown with that series' next edition.
 */
import type { ContestConfigTemplate } from './contest-management-types';
import type { Sport } from './enums';

/**
 * An event page's URL name: lower case letters and digits, in words joined by single dashes.
 * Stored on the page, never derived from a name, so web and API cannot disagree. The
 * `event_pages` table checks the same pattern.
 */
export const EVENT_PAGE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function isEventPageSlug(value: string): boolean {
  return EVENT_PAGE_SLUG_PATTERN.test(value);
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
export interface EventPage {
  id: string;
  sport: Sport;
  slug: string;
  displayOrder: number;
  /** False: retired; its URL goes to `redirectTo`, or says it has moved. */
  isActive: boolean;
  /** Where a retired page's URL goes now; null without a successor. */
  redirectTo: { sport: Sport; slug: string } | null;
}

/** One offer of an event page, with the setup it starts as and its sport league's name. */
export interface EventPageOffer {
  id: string;
  eventPageId: string;
  sportLeagueId: string;
  /** The sport league as screens away from its sport's own pages name it. */
  sportLeagueName: string;
  eventSeriesName: string;
  template: ContestConfigTemplate;
  /** The round a bracket starts at, when not the template's own; null otherwise. */
  bracketStartRound: number | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** An edition an offer may be shown with: one of its series' editions not yet over. */
export interface EventPageEdition {
  sportEventId: string;
  name: string;
  eventYear: number;
  startDate: Date;
  endDate: Date | null;
}
