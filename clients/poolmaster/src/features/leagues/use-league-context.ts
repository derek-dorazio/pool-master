import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
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
  const auth = useAuth();

  const query = useQuery({
    queryKey: QueryKeys.leagues.detail(leagueCode),
    queryFn: async (): Promise<LeagueContextResponse> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throwApiError(response.error, 'League context response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  // Looking at a league IS selecting it, so this is where the recent-league cookie is
  // written. Four pages had their own copy of this effect.
  const loadedLeagueCode = query.data?.league.leagueCode;
  useEffect(() => {
    if (loadedLeagueCode) {
      rememberRecentLeagueCode(loadedLeagueCode);
    }
  }, [loadedLeagueCode]);

  const membership = query.data?.membership ?? null;
  const squadMembership = query.data?.squadMembership ?? null;
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
    league: query.data?.league,
    viewer,
  };
}
