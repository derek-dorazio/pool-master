import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type SquadDto, deleteLeagueSquad, inactivateLeagueSquad } from '@/lib/api';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import type { ActiveTeamDialog } from './my-team-shared';

/**
 * Inactivate and delete for Commissioner tools › Manage team. The inactivation notice belongs
 * to the selected team and clears when the selection changes; delete leaves the page.
 */
export function useMyTeamLifecycle({
  leagueId,
  leagueCode,
  selectedTeam,
  setActiveDialog,
  resetOwnerForms,
  afterDeletePath,
}: {
  leagueId: string;
  leagueCode: string;
  selectedTeam: SquadDto | null;
  setActiveDialog: (dialog: ActiveTeamDialog) => void;
  resetOwnerForms: () => void;
  /** Where the page goes once its team is deleted. */
  afterDeletePath: string;
}) {
  const navigate = useNavigate();
  const [teamInactivationNotice, setTeamInactivationNotice] = useState<string | null>(null);

  useEffect(() => {
    setTeamInactivationNotice(null);
  }, [selectedTeam?.id]);

  const inactivateTeamMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before it can be inactivated.');
      }

      const response = await inactivateLeagueSquad({
        path: { id: leagueId, squadId },
      });

      if (!response.data?.squad) {
        throwApiError(response.error, 'Team inactivation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: (team) => {
      setActiveDialog(null);
      setTeamInactivationNotice(
        `${team.name} is now inactive. Its owners were removed from this league. Their accounts and their other leagues are untouched, and inviting them back restores this team.`,
      );
      resetOwnerForms();
    },
    // Inactivating ends the owners' league memberships, so the league's member list and its
    // context (member count, and the viewer's own membership if it was their team) change too.
    invalidates: [
      QueryKeys.leagues.detail(leagueCode),
      QueryKeys.leagues.list,
      QueryKeys.leagues.members(leagueId),
      QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
      QueryKeys.leagueTeams.byLeague(leagueId),
    ],
  });

  const deleteTeamMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before it can be deleted.');
      }

      const response = await deleteLeagueSquad({
        path: { id: leagueId, squadId },
      });

      if (!response.data?.success) {
        throwApiError(response.error, 'Team deletion response is missing data.');
      }
    },
    onSuccess: () => {
      setActiveDialog(null);
      resetOwnerForms();
      navigate(afterDeletePath);
    },
    invalidates: [
      QueryKeys.leagueTeamOwnerInvitations.byLeague(leagueId),
      QueryKeys.leagueTeams.byLeague(leagueId),
    ],
  });

  return {
    teamInactivationNotice,
    inactivateTeamMutation,
    deleteTeamMutation,
    isPending: inactivateTeamMutation.isPending || deleteTeamMutation.isPending,
  };
}

export type MyTeamLifecycle = ReturnType<typeof useMyTeamLifecycle>;
