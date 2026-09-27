import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listLeagues } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';
import type { LeagueListCache } from './league-cache';
import { getCommissionerLeagueIds } from './league-routing';

/**
 * #202 (A8) — the leagues list, with the viewer's memberships alongside it.
 *
 * This is the one read where viewer context is a set rather than a single edge: the caller is
 * looking at many leagues at once, so `LeagueListResponse` carries their memberships once as an
 * array instead of repeating a relationship block on every league. `commissionerLeagueIds` is
 * that array reduced to the question callers actually ask of it.
 */
export function useLeaguesQuery({ enabled = true }: { enabled?: boolean } = {}) {
  const query = useQuery({
    queryKey: QueryKeys.leagues.list,
    queryFn: async (): Promise<LeagueListCache> => {
      // #202 — `scope: 'mine'` is the leagues the viewer belongs to. It is stated rather than
      // left to the default because the other scope exists: a root admin has both, and which
      // one this hook wants is not something the server can infer from their role.
      const response = await listLeagues({ query: { scope: 'mine' } });
      if (!response.data) {
        throwApiError(response.error, 'League list response is missing data.');
      }

      return {
        leagues: response.data.leagues,
        memberships: response.data.memberships,
      };
    },
    enabled,
    retry: false,
  });

  const memberships = query.data?.memberships;
  const commissionerLeagueIds = useMemo(
    () => getCommissionerLeagueIds(memberships ?? []),
    [memberships],
  );

  return {
    query,
    leagues: query.data?.leagues,
    commissionerLeagueIds,
  };
}
