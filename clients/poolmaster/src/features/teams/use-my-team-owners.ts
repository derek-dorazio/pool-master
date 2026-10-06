import { useState } from 'react';
import {
  type SquadDto,
  createSquadOwnerInvitation,
  replaceSquadOwner,
  revokeSquadOwnerInvitation,
} from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

/**
 * Owner management for the My Team page: the co-owner invite and replace-owner drafts and the
 * three owner writes. Called by the page, not the owners panel, so the drafts and the write
 * results outlive the owners modal closing.
 */
export function useMyTeamOwners({
  leagueId,
  selectedTeam,
}: {
  leagueId: string;
  selectedTeam: SquadDto | null;
}) {
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [replaceTargetUserId, setReplaceTargetUserId] = useState<string | null>(null);
  const [replaceEmail, setReplaceEmail] = useState('');

  const createOwnerInvitationMutation = useInvalidatingMutation({
    mutationFn: async (email: string) => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before inviting a co-owner.');
      }

      const response = await createSquadOwnerInvitation({
        path: { id: leagueId, squadId },
        body: { email },
      });

      if (!response.data?.invitation) {
        throwApiError(response.error, 'Owner invitation response is missing data.');
      }

      return response.data.invitation;
    },
    onSuccess: () => {
      setCoOwnerEmail('');
    },
    invalidates: [
      QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
      QueryKeys.leagueTeams.byLeague(leagueId),
    ],
  });

  const replaceOwnerMutation = useInvalidatingMutation({
    mutationFn: async ({ userId, email }: { userId: string; email: string }) => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before replacing an owner.');
      }

      const response = await replaceSquadOwner({
        path: { id: leagueId, squadId, userId },
        body: { email },
      });

      if (!response.data?.invitation) {
        throwApiError(response.error, 'Replace owner response is missing data.');
      }

      return response.data.invitation;
    },
    onSuccess: () => {
      setReplaceTargetUserId(null);
      setReplaceEmail('');
    },
    invalidates: [
      QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
      QueryKeys.leagueTeams.byLeague(leagueId),
    ],
  });

  const revokeOwnerInvitationMutation = useInvalidatingMutation({
    mutationFn: async (invitationId: string) => {
      const response = await revokeSquadOwnerInvitation({
        path: { id: leagueId, invitationId },
      });

      if (!response.data?.invitation) {
        throwApiError(response.error, 'Revoke owner invitation response is missing data.');
      }
      return response.data.invitation;
    },
    invalidates: [QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId)],
  });

  function resetOwnerForms() {
    setReplaceTargetUserId(null);
    setReplaceEmail('');
    setCoOwnerEmail('');
  }

  return {
    coOwnerEmail,
    setCoOwnerEmail,
    replaceTargetUserId,
    setReplaceTargetUserId,
    replaceEmail,
    setReplaceEmail,
    resetOwnerForms,
    createOwnerInvitationMutation,
    replaceOwnerMutation,
    revokeOwnerInvitationMutation,
    isPending:
      createOwnerInvitationMutation.isPending
      || replaceOwnerMutation.isPending
      || revokeOwnerInvitationMutation.isPending,
  };
}

export type MyTeamOwners = ReturnType<typeof useMyTeamOwners>;
