import { easternCalendarYear } from '@poolmaster/shared/domain';
import type { ContestResultSummaryDto } from '@/lib/api';
import { formatCount, formatNumber, formatPlace } from '@/features/shared/ui';

/** How long a contest stays on League Home's More contests once it is final (#1763), before only My team lists it. */
export const RECENTLY_FINAL_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** The championship years a recently final contest can have gone final in: this one, and last year early in January. */
export function recentlyFinalYears(now: Date): number[] {
  const year = easternCalendarYear(now);
  const windowStartYear = easternCalendarYear(new Date(now.getTime() - RECENTLY_FINAL_DAYS * DAY_MS));
  return windowStartYear === year ? [year] : [year, windowStartYear];
}

/**
 * The moment League Home asks for finals since (#1782): the start of the UTC day the window opens
 * on, so the read's address changes once a day rather than every minute; `pickRecentlyFinal`
 * trims the extra hours.
 */
export function recentlyFinalSince(now: Date): string {
  const opens = new Date(now.getTime() - RECENTLY_FINAL_DAYS * DAY_MS);
  // poolmaster-allow-clock-year: the start of a UTC day, not a season
  return new Date(Date.UTC(opens.getUTCFullYear(), opens.getUTCMonth(), opens.getUTCDate())).toISOString();
}

/** The contests that went final in the last few days, newest first. */
export function pickRecentlyFinal(contests: readonly ContestResultSummaryDto[], now: Date): ContestResultSummaryDto[] {
  const since = now.getTime() - RECENTLY_FINAL_DAYS * DAY_MS;
  return contests
    .filter((contest) => Date.parse(contest.completedAt) >= since)
    .sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
}

/** A final contest's row line: "Final · you were 5th of 14", or "Final · 14 entries" for a team not in it. */
export function describeRecentlyFinal(contest: Pick<ContestResultSummaryDto, 'rankedEntryCount' | 'squadFinish'>, locale: string): string {
  const finish = contest.squadFinish;
  if (finish) {
    return `Final · you were ${formatPlace({ displayPosition: finish.displayPlace, position: finish.place })} of ${formatNumber(contest.rankedEntryCount, locale)}`;
  }
  return `Final · ${formatCount(contest.rankedEntryCount, 'entry', locale, 'entries')}`;
}
