import type { SelectionType } from '@poolmaster/shared/domain';

/** How to Play, every contest type explained. */
export const HOW_TO_PLAY_PATH = '/how-to-play';

/** How to Play at one sport, named by its URL segment: where an event page's breadcrumb goes back to. */
export function buildHowToPlaySportPath(sportUrlSegment: string): string {
  return `${HOW_TO_PLAY_PATH}?sport=${encodeURIComponent(sportUrlSegment)}`;
}

/**
 * How to Play opened on one way to play (#1392), at the contest's sport when it has one: where a
 * contest page sends a member who wants its rules explained.
 */
export function buildHowToPlayFormatPath(sportUrlSegment: string | null, selectionType: SelectionType): string {
  const format = `format=${encodeURIComponent(selectionType)}`;
  return sportUrlSegment ? `${buildHowToPlaySportPath(sportUrlSegment)}&${format}` : `${HOW_TO_PLAY_PATH}?${format}`;
}

/** The anchor of a way to play's tile on How to Play, which the format link scrolls to. */
export function howToPlayFormatAnchor(selectionType: SelectionType): string {
  return `how-to-play-${selectionType.toLowerCase().replaceAll('_', '-')}`;
}
