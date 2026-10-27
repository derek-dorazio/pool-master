import { Sport, sportPathSegment } from '@poolmaster/shared/domain';

/** The sport a `/play` address's first segment names, or null when it names none. */
export function sportFromPathSegment(segment: string | undefined): Sport | null {
  return Object.values(Sport).find((sport) => sportPathSegment(sport) === segment) ?? null;
}

/** How to Play at one sport, where an event page's breadcrumb goes back to. */
export function buildHowToPlaySportPath(sport: Sport): string {
  return `/how-to-play?sport=${sportPathSegment(sport)}`;
}

/** The Clutch Card's own landing page (#1066), where How to Play's Clutch Card links for more. */
export const CLUTCH_CARD_PAGE_PATH = '/play/clutch-card';
