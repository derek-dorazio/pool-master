import type { QueryClient } from '@tanstack/react-query';
import type { GetLeagueResponses, ListLeaguesResponses } from '@/lib/api';

export type LeagueSummary = ListLeaguesResponses[200]['leagues'][number];
export type LeagueDetail = GetLeagueResponses[200]['league'];

export function toLeagueSummary(league: LeagueDetail): LeagueSummary {
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
  leagues: LeagueSummary[] | undefined,
  nextLeague: LeagueSummary,
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

export function removeLeagueSummary(leagues: LeagueSummary[] | undefined, leagueId: string) {
  return (leagues ?? []).filter((league) => league.id !== leagueId);
}

export function syncLeagueCaches(
  queryClient: QueryClient,
  league: LeagueDetail,
  options: {
    manageLeagueId?: string | null;
  } = {},
) {
  const summary = toLeagueSummary(league);

  queryClient.setQueryData<LeagueSummary[]>(['poolmaster', 'leagues'], (current) =>
    upsertLeagueSummary(current, summary),
  );
  queryClient.setQueryData(['poolmaster', 'league', league.leagueCode], league);

  if (options.manageLeagueId) {
    queryClient.setQueryData(['poolmaster', 'league', options.manageLeagueId, 'manage'], league);
  }
}
