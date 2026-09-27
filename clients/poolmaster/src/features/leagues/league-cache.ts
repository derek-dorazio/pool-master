import type { QueryClient } from '@tanstack/react-query';
import type { LeagueContextResponse, LeagueDto, LeagueMembershipDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';

/**
 * #202 — the two league caches and their shapes.
 *
 * `toLeagueSummary()` is gone. It hand-projected `LeagueDetailDto` down to `LeagueSummaryDto`,
 * field by field, in the client — the shadow-projection problem replicated on this side of the
 * wire, and cited in access rule A8 as evidence the two DTOs were one. With `LeagueDto` it is
 * the identity function, so a league written to one cache can be written to the other without a
 * conversion that could silently drop a field.
 *
 * What did change is that neither cache holds a bare league any more, because neither read
 * returns one:
 *
 * - `QueryKeys.leagues.list` holds `{ leagues, memberships }` — the list plus the viewer's own
 *   memberships among them, once (A8's one set-shaped exception).
 * - `QueryKeys.leagues.detail(leagueCode)` holds the league-context response — the league plus
 *   the viewer's edges in it.
 *
 * So writing a changed league into either cache replaces only its league part. The viewer's
 * edges are not ours to invent here, and a commissioner renaming their league does not change
 * their membership in it.
 */
export type LeagueListCache = {
  leagues: LeagueDto[];
  memberships: LeagueMembershipDto[];
};

export function upsertLeague(
  cache: LeagueListCache | undefined,
  nextLeague: LeagueDto,
): LeagueListCache {
  if (!cache) {
    return { leagues: [nextLeague], memberships: [] };
  }

  const existingIndex = cache.leagues.findIndex((league) => league.id === nextLeague.id);
  if (existingIndex === -1) {
    return { ...cache, leagues: [...cache.leagues, nextLeague] };
  }

  const nextLeagues = [...cache.leagues];
  nextLeagues[existingIndex] = nextLeague;
  return { ...cache, leagues: nextLeagues };
}

export function removeLeague(
  cache: LeagueListCache | undefined,
  leagueId: string,
): LeagueListCache {
  if (!cache) {
    return { leagues: [], memberships: [] };
  }

  return {
    leagues: cache.leagues.filter((league) => league.id !== leagueId),
    memberships: cache.memberships.filter((membership) => membership.leagueId !== leagueId),
  };
}

export function syncLeagueCaches(
  queryClient: QueryClient,
  league: LeagueDto,
  options: {
    manageLeagueId?: string | null;
  } = {},
) {
  queryClient.setQueryData<LeagueListCache>(QueryKeys.leagues.list, (current) =>
    upsertLeague(current, league),
  );
  queryClient.setQueryData<LeagueContextResponse>(
    QueryKeys.leagues.detail(league.leagueCode),
    (current) => (current ? { ...current, league } : undefined),
  );

  if (options.manageLeagueId) {
    queryClient.setQueryData(QueryKeys.leagues.manage(options.manageLeagueId), league);
  }
}
