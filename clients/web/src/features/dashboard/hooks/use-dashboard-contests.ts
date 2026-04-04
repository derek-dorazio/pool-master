import { useQuery } from '@tanstack/react-query';
import { client, listContests, listLeagues } from '@/lib/api';
import type {
  ContestListResponse,
  ContestSummaryDto,
  LeagueListResponse,
  LeagueSummaryDto,
} from '@poolmaster/shared/dto';

export interface DashboardContestItem extends ContestSummaryDto {
  leagueName: string;
}

async function fetchDashboardContests(): Promise<DashboardContestItem[]> {
  const { data: leagueData, error: leagueError } = await listLeagues({ client });
  if (leagueError) throw leagueError;

  const leagues = (leagueData as LeagueListResponse | undefined)?.leagues ?? [];
  const contestLists = await Promise.all(
    leagues.map(async (league: LeagueSummaryDto) => {
      const { data, error } = await listContests({
        client,
        path: { id: league.id },
      });
      if (error) throw error;

      return (((data as ContestListResponse | undefined)?.contests) ?? []).map((contest) => ({
        ...contest,
        leagueName: league.name,
      }));
    }),
  );

  return contestLists.flat();
}

export function useDashboardContests() {
  return useQuery({
    queryKey: ['dashboard', 'contest-catalog'],
    queryFn: fetchDashboardContests,
    staleTime: 30_000,
  });
}
