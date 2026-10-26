import { Sport, sportPathSegment } from '@poolmaster/shared/domain';

/**
 * An event page's address (#1007): `/play/american-football/championship-weekend`. The slug is the
 * page's stored one, never derived; the sport segment is the sport's path segment.
 */
export function buildEventPagePath(sport: Sport, slug: string): string {
  return `/play/${sportPathSegment(sport)}/${slug}`;
}

/** The sport a `/play` address's first segment names, or null when it names none. */
export function sportFromPathSegment(segment: string | undefined): Sport | null {
  return Object.values(Sport).find((sport) => sportPathSegment(sport) === segment) ?? null;
}

/** How to Play at one sport, where an event page's breadcrumb goes back to. */
export function buildHowToPlaySportPath(sport: Sport): string {
  return `/how-to-play?sport=${sportPathSegment(sport)}`;
}
