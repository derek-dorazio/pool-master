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
  leagueCode,
  leagueId,
  selectedTeam,
}: {
  leagueCode: string;
  leagueId: string;
  selectedTeam: SquadDto | null;
}) {
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [replaceTargetUserId, setReplaceTargetUserId] = useState<string | null>(null);
  const [replaceEmail, setReplaceEmail] = useState('');

  // Both writes below can change who is in the league, which the member list and the league
  // context (its member count) show.
  const ownerChangeKeys = [
    QueryKeys.leagues.detail(leagueCode),
    QueryKeys.leagues.members(leagueId),
    QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
    QueryKeys.leagueTeams.byLeague(leagueId),
  ];

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
    // An invitee who already has an account joins the league at once.
    invalidates: ownerChangeKeys,
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
    // The replaced owner leaves the league.
    invalidates: ownerChangeKeys,
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
