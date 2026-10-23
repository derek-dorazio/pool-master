import { championshipYear } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { isHistoricalContest } from './contest-status';

/**
 * The years Contest History offers (#837): each year, US Eastern, a completed contest went final
 * in, newest first. Contests and the championship share the year a contest counts toward.
 */
export function contestHistoryYears(contests: Pick<ContestDto, 'status' | 'endsAt'>[]): number[] {
  const years = new Set(contests.flatMap((contest) =>
    isHistoricalContest(contest.status) && contest.endsAt ? [championshipYear(new Date(contest.endsAt))] : []));
  return [...years].sort((left, right) => right - left);
}

/** The year shown: the one in the link when it is offered, else the newest. Null with no year to show. */
export function chooseContestHistoryYear(years: number[], yearParam: string | null): number | null {
  const asked = Number(yearParam);
  return years.includes(asked) ? asked : years[0] ?? null;
}
