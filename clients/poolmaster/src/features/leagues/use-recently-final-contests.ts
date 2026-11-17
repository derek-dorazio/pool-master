import { useChampionshipContestsQuery } from '@/features/championships/use-championship-query';
import { pickRecentlyFinal, recentlyFinalYears } from './recently-final';

/**
 * The league's contests that went final in the last few days (#1763), each with the viewer's
 * team's finish, for League Home's More contests: the championship year's results read My team's
 * Past contests uses, and early in January last year's too.
 */
export function useRecentlyFinalContests(leagueId: string, mySquadId: string | null, now: Date) {
  const [thisYear, lastYear = null] = recentlyFinalYears(now);
  const thisYearQuery = useChampionshipContestsQuery(leagueId, thisYear, null, mySquadId);
  const lastYearQuery = useChampionshipContestsQuery(leagueId, lastYear, null, mySquadId);
  return pickRecentlyFinal([...(thisYearQuery.data ?? []), ...(lastYearQuery.data ?? [])], now);
}
