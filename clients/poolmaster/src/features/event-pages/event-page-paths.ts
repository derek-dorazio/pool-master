import { Sport, sportPathSegment, type SelectionType } from '@poolmaster/shared/domain';

/** The sport a `/play` address's first segment names, or null when it names none. */
export function sportFromPathSegment(segment: string | undefined): Sport | null {
  return Object.values(Sport).find((sport) => sportPathSegment(sport) === segment) ?? null;
}

/** An event page's own address, `/play/<sport>/<slug>`. */
export function buildEventPagePath(sport: Sport, slug: string): string {
  return `/play/${sportPathSegment(sport)}/${slug}`;
}

/** How to Play, every contest type explained. */
export const HOW_TO_PLAY_PATH = '/how-to-play';

/** How to Play at one sport, where an event page's breadcrumb goes back to. */
export function buildHowToPlaySportPath(sport: Sport): string {
  return `${HOW_TO_PLAY_PATH}?sport=${sportPathSegment(sport)}`;
}

/**
 * How to Play opened on one way to play (#1392), at the contest's sport when it has one: where a
 * contest page sends a member who wants its rules explained.
 */
export function buildHowToPlayFormatPath(sport: Sport | null, selectionType: SelectionType): string {
  const format = `format=${encodeURIComponent(selectionType)}`;
  return sport ? `${buildHowToPlaySportPath(sport)}&${format}` : `${HOW_TO_PLAY_PATH}?${format}`;
}

/** The anchor of a way to play's tile on How to Play, which the format link scrolls to. */
export function howToPlayFormatAnchor(selectionType: SelectionType): string {
  return `how-to-play-${selectionType.toLowerCase().replaceAll('_', '-')}`;
}
