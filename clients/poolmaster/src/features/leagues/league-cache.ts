import type { QueryClient } from '@tanstack/react-query';
import type { LeagueDetailDto, LeagueSummaryDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';


export function toLeagueSummary(league: LeagueDetailDto): LeagueSummaryDto {
  return {
    id: league.id,
    leagueCode: league.leagueCode,
    name: league.name,
    description: league.description,
    isActive: league.isActive,
    iconKey: league.iconKey,
    memberCount: league.memberCount,
    activeContestCount: league.activeContestCount,
    memberType: league.memberType,
    leagueRelationship: league.leagueRelationship,
    isRootAdmin: league.isRootAdmin,
    createdAt: league.createdAt,
  };
}

export function upsertLeagueSummary(
  leagues: LeagueSummaryDto[] | undefined,
  nextLeague: LeagueSummaryDto,
) {
  if (!leagues) {
    return [nextLeague];
  }

  const existingIndex = leagues.findIndex((league) => league.id === nextLeague.id);
  if (existingIndex === -1) {
    return [...leagues, nextLeague];
  }

  const nextLeagues = [...leagues];
  nextLeagues[existingIndex] = nextLeague;
  return nextLeagues;
}

export function removeLeagueSummary(leagues: LeagueSummaryDto[] | undefined, leagueId: string) {
  return (leagues ?? []).filter((league) => league.id !== leagueId);
}

export function syncLeagueCaches(
  queryClient: QueryClient,
  league: LeagueDetailDto,
  options: {
    manageLeagueId?: string | null;
  } = {},
) {
  const summary = toLeagueSummary(league);

  queryClient.setQueryData<LeagueSummaryDto[]>(QueryKeys.leagues.list, (current) =>
    upsertLeagueSummary(current, summary),
  );
  queryClient.setQueryData(QueryKeys.leagues.detail(league.leagueCode), league);

  if (options.manageLeagueId) {
    queryClient.setQueryData(QueryKeys.leagues.manage(options.manageLeagueId), league);
  }
}
