import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  getLeague,
  getLeagueByCode,
  type LeagueContextResponse,
  type LeagueDto,
  type LeagueMembershipDto,
  type SquadMembershipDto,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';
import { rememberRecentLeagueCode } from './league-routing';

/**
 * The viewer's relationship to one league (#202, access rule A8).
 *
 * Every field here answers a question the entity DTOs used to answer per row. `LeagueDto`
 * carried `memberType`, `leagueRelationship` and `isRootAdmin`; `SquadDto` carried
 * `teamRelationship` and `isRootAdmin`. That made both DTOs a function of *who asked*, so two
 * requesters got different values for the same league.
 *
 * The answers now come from three places, each of which is the authority for it:
 *
 *   - `isRootAdmin` is a property of the **User**, off the cached session user.
 *   - membership and role come from the viewer's own `LeagueMembership`.
 *   - which squad is mine comes from the viewer's own `SquadMembership`.
 *
 * The last two arrive together on the league-context call, once per league.
 */
export interface LeagueViewer {
  /** From the cached session user, not from the league. */
  isRootAdmin: boolean;
  /** An ACTIVE membership in this league. */
  isMember: boolean;
  /** An ACTIVE membership whose role is COMMISSIONER. */
  isCommissioner: boolean;
  /** The viewer's own membership, or null when they hold none (a root admin looking in). */
  membership: LeagueMembershipDto | null;
  /** The viewer's own squad membership in this league, or null. */
  squadMembership: SquadMembershipDto | null;
  /**
   * The id of the viewer's own squad.
   *
   * This replaced `teams.find(t => t.teamRelationship.owner)` — fetching every squad in the
   * league to scan a per-row viewer flag, where the viewer's own membership answers it
   * directly. A8 cites that line as the evidence the flag was residue.
   */
  mySquadId: string | null;
}

export interface UseLeagueContextResult {
  query: UseQueryResult<LeagueContextResponse>;
  league: LeagueDto | undefined;
  viewer: LeagueViewer;
}

/**
 * Fetches a league together with the viewer's edges in it, and caches it at
 * `QueryKeys.leagues.detail(leagueCode)` — one entry per league, shared by every page.
 *
 * Eight pages had their own copy of this `useQuery`, byte-identical apart from a log action
 * name, each unwrapping `response.data.league` and throwing the viewer context away because
 * the league carried it. There is one copy now.
 */
export function useLeagueContext(leagueCode: string): UseLeagueContextResult {
  return useLeagueContextQuery({
    queryKey: QueryKeys.leagues.detail(leagueCode),
    enabled: Boolean(leagueCode),
    fetch: async () => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throwApiError(response.error, 'League context response is missing data.');
      }

      return response.data;
    },
  });
}

/**
 * The same league context, for a surface that holds a league ID rather than a league code
 * (#202).
 *
 * Contest-rooted routes are the case: they resolve a contest first and learn its `leagueId`,
 * so there is no code to look the league up by. Before the by-id read returned the context,
 * those pages answered "which squad is mine?" by fetching every squad in the league and
 * scanning each one's member list for the signed-in user — the exact read A8 exists to
 * replace, and one the type change could not flag because it was written out by hand.
 */
export function useLeagueContextById(leagueId: string | undefined): UseLeagueContextResult {
  return useLeagueContextQuery({
    queryKey: QueryKeys.leagues.contextById(leagueId),
    enabled: Boolean(leagueId),
    fetch: async () => {
      const response = await getLeague({ path: { id: leagueId as string } });

      if (!response.data?.league) {
        throwApiError(response.error, 'League context response is missing data.');
      }

      return response.data;
    },
  });
}

/**
 * The shared body: fetch a `LeagueContextResponse`, derive the viewer from it, and keep the
 * two addresses of one league in step.
 */
function useLeagueContextQuery(options: {
  queryKey: readonly unknown[];
  enabled: boolean;
  fetch: () => Promise<LeagueContextResponse>;
}): UseLeagueContextResult {
  const auth = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: options.queryKey,
    queryFn: options.fetch,
    enabled: options.enabled,
    retry: false,
  });

  // One league, two addresses: whichever one this hook fetched, the other is seeded from the
  // same response. Without this a page that navigates from a contest into its league refetches
  // a context it already holds, and the two entries could drift apart.
  const context = query.data;
  useEffect(() => {
    if (!context) {
      return;
    }
    queryClient.setQueryData(QueryKeys.leagues.detail(context.league.leagueCode), context);
    queryClient.setQueryData(QueryKeys.leagues.contextById(context.league.id), context);
  }, [context, queryClient]);

  // Looking at a league IS selecting it, so this is where the recent-league cookie is
  // written. Four pages had their own copy of this effect.
  const loadedLeagueCode = context?.league.leagueCode;
  useEffect(() => {
    if (loadedLeagueCode) {
      rememberRecentLeagueCode(loadedLeagueCode);
    }
  }, [loadedLeagueCode]);

  const membership = context?.membership ?? null;
  const squadMembership = context?.squadMembership ?? null;
  const isRootAdmin = auth.user?.isRootAdmin === true;

  const viewer = useMemo<LeagueViewer>(() => {
    const isMember = membership?.status === 'ACTIVE';
    return {
      isRootAdmin,
      isMember,
      isCommissioner: isMember && membership?.role === 'COMMISSIONER',
      membership,
      squadMembership,
      mySquadId: squadMembership?.status === 'ACTIVE' ? squadMembership.squadId : null,
    };
  }, [isRootAdmin, membership, squadMembership]);

  return {
    query,
    league: context?.league,
    viewer,
  };
}
