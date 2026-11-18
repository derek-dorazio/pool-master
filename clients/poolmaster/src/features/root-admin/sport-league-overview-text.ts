import { ProviderSyncKind, type ReleaseCheckKey } from '@poolmaster/shared/domain';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { plural } from '@/lib/plural';

export type SportLeagueIssue = SportLeagueOverviewDto['issues'][number];

/** Each issue type's chip word, as the Issues column and its filter name it. */
export const SPORT_LEAGUE_ISSUE_LABELS: Record<SportLeagueIssue['type'], string> = {
  SYNC: 'Sync',
  RELEASE: 'Release',
};

/** Each sync's name in domain words (rules/ux-rules.md §12 item 14). */
export const SYNC_KIND_LABELS: Record<ProviderSyncKind, string> = {
  [ProviderSyncKind.EVENTS]: 'Event list sync',
  [ProviderSyncKind.FIELD]: 'Field sync',
  [ProviderSyncKind.SCORES]: 'Live scores and results sync',
};

/** Each ready check that can hold an automatic release, as a short phrase. */
export const RELEASE_CHECK_LABELS: Record<ReleaseCheckKey, string> = {
  NOT_STARTED: 'Not started',
  ROUNDS_SCHEDULED: 'Rounds scheduled',
  FIELD_LOADED: 'Field loaded',
  FIELD_LINKED: 'Every field participant linked',
  TIERS_ASSIGNED: 'Every participant in a tier',
  TIERS_FILLED: 'No empty tier',
  PRICES_ASSIGNED: 'Prices made',
  BRACKET_COMPLETE: 'Bracket complete',
  CONTEST_SETUPS_ON: 'Contest template on',
};

/** The header's count line: how many sports, and how many of the sport leagues are on. */
export function sportsCountLine(overviews: readonly SportLeagueOverviewDto[]): string {
  const sports = new Set(overviews.map((overview) => overview.sport)).size;
  const on = overviews.filter((overview) => overview.isActive).length;
  return `${plural(sports, 'sport')} · ${String(on)} of ${plural(overviews.length, 'sport league')}`;
}
