import { useQuery } from '@tanstack/react-query';
import { type TeamOwnerInvitationDto, listSquadOwnerInvitations } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

/** Every co-owner invitation in the league, whatever its status. One query, shared by the team pages. */
export function useTeamOwnerInvitationsQuery(leagueId: string) {
  return useQuery({
    queryKey: QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
    queryFn: async (): Promise<TeamOwnerInvitationDto[]> => {
      const response = await listSquadOwnerInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throwApiError(response.error, 'Owner invitation list response is missing data.');
      }

      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });
}
