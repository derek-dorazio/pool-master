import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ProviderSyncKind } from '@poolmaster/shared/domain';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { plural } from '@/lib/plural';

export type SportLeagueIssue = SportLeagueOverviewDto['issues'][number];

const HOUR_MS = 60 * 60 * 1000;

/** How late an overdue event's results are, from when it should have ended: whole hours, then whole days. */
export function overdueLateness(expectedEndAt: string, now: Date): string {
  const hours = Math.floor((now.getTime() - new Date(expectedEndAt).getTime()) / HOUR_MS);
  return hours < 48 ? `${plural(hours, 'hour')} late` : `${plural(Math.floor(hours / 24), 'day')} late`;
}

/** A sync failure's line, the sync named in domain words (rules/ux-rules.md §12 item 14): "Field sync failed". */
export function syncFailedText(kind: ProviderSyncKind): string {
  return `${enumLabel('ProviderSyncKind', kind)} sync failed`;
}

/** The header's count line: how many sports, and how many of the sport leagues are on. */
export function sportsCountLine(overviews: readonly SportLeagueOverviewDto[]): string {
  const sports = new Set(overviews.map((overview) => overview.sport)).size;
  const on = overviews.filter((overview) => overview.isActive).length;
  return `${plural(sports, 'sport')} · ${String(on)} of ${plural(overviews.length, 'sport league')}`;
}

