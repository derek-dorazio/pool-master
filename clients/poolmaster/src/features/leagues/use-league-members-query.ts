import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { listLeagueMembers, type LeagueMembershipDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { throwApiError } from '@/lib/errors';

/**
 * A league's member roster, indexed by user (#202).
 *
 * Both team surfaces — the teams directory and Team Home — had their own copy of this query
 * and their own byte-identical `new Map(members.map(m => [m.userId, m]))`, for the same
 * purpose: labelling a squad owner with their league role. One copy, one cache entry.
 *
 * This is NOT viewer context. `LeagueMembershipDto` here is every member's edge, and the
 * question it answers — "what is *this* person's role in the league?" — is a property of them,
 * not of the requester. The viewer's own standing comes from `useLeagueContext` (A8).
 */
export function useLeagueMembersQuery(leagueId: string) {
  const query = useQuery({
    queryKey: QueryKeys.leagues.members(leagueId),
    queryFn: async (): Promise<LeagueMembershipDto[]> => {
      const response = await listLeagueMembers({ path: { id: leagueId } });
      if (!response.data?.members) {
        throwApiError(response.error, 'League members response is missing data.');
      }

      return response.data.members;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const members = query.data;
  const membersByUserId = useMemo(
    () => new Map((members ?? []).map((member) => [member.userId, member])),
    [members],
  );

  return { query, members, membersByUserId };
}
