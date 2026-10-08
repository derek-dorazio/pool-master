import { useQueryClient } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { useEffect, useMemo, useState } from 'react';
import { type SquadDto, createLeagueSquad, updateLeagueSquad } from '@/lib/api';
import { useAuth } from '@/features/auth/auth-context';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { buildDefaultTeamName } from './team-defaults';
import type { ActiveTeamDialog } from './my-team-shared';

/**
 * The My Team details flow: creating the viewer's squad, and the rename and icon edits for the
 * selected one. Owns the name and icon drafts and the three writes that save them.
 *
 * `otherWritesPending` is every other write on the page, so closing the rename modal stays
 * blocked while any team write is in flight, not only this hook's own.
 */
export function useMyTeamDetails({
  leagueId,
  leagueCode,
  teams,
  selectedTeam,
  isInactiveLeague,
  isInactiveTeam,
  canCreateOwnTeam,
  canManageSelectedTeam,
  activeDialog,
  setActiveDialog,
  otherWritesPending,
}: {
  leagueId: string;
  leagueCode: string;
  teams: SquadDto[] | undefined;
  selectedTeam: SquadDto | null;
  isInactiveLeague: boolean;
  isInactiveTeam: boolean;
  canCreateOwnTeam: boolean;
  canManageSelectedTeam: boolean;
  activeDialog: ActiveTeamDialog;
  setActiveDialog: (dialog: ActiveTeamDialog) => void;
  otherWritesPending: boolean;
}) {
  const auth = useAuth();
  const queryClient = useQueryClient();
  const [teamName, setTeamName] = useState('');
  const [teamNameSeedKey, setTeamNameSeedKey] = useState<string | null>(null);
  const [teamNameDraftTeamId, setTeamNameDraftTeamId] = useState<string | null>(null);
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconDraftKey, setIconDraftKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);

  const defaultTeamNameSeed = useMemo(
    () => buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName),
    [auth.user?.firstName, auth.user?.lastName],
  );
  const teamNameDraftSource = useMemo(() => {
    if (!selectedTeam) {
      return null;
    }

    return {
      id: selectedTeam.id,
      name: selectedTeam.name,
    };
    // Keyed on id and name on purpose: a refetch must not rebuild the draft
    // (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTeam?.id, selectedTeam?.name]);

  // With a team, the draft follows the saved icon whenever the picker is closed. Without one,
  // the draft IS the choice that team creation will send, so closing the picker must keep it.
  const selectedTeamIconKey = selectedTeam?.iconKey;
  useEffect(() => {
    if (iconModalOpen || !selectedTeamIconKey) {
      return;
    }

    setIconDraftKey(selectedTeamIconKey);
  }, [iconModalOpen, selectedTeamIconKey]);

  useEffect(() => {
    if (selectedTeam) {
      return;
    }

    const nextSeedKey = leagueId || leagueCode;
    if (teamNameSeedKey === nextSeedKey) {
      return;
    }

    setTeamName(defaultTeamNameSeed);
    setTeamNameSeedKey(nextSeedKey);
  }, [defaultTeamNameSeed, leagueCode, leagueId, selectedTeam, teamNameSeedKey]);

  useEffect(() => {
    if (activeDialog !== 'name') {
      return;
    }

    if (!teamNameDraftSource) {
      setActiveDialog(null);
      setTeamNameDraftTeamId(null);
      return;
    }

    if (teamNameDraftTeamId && teamNameDraftTeamId !== teamNameDraftSource.id) {
      setTeamName(teamNameDraftSource.name);
      setTeamNameDraftTeamId(teamNameDraftSource.id);
    }
  }, [activeDialog, setActiveDialog, teamNameDraftSource, teamNameDraftTeamId]);

  const createTeamMutation = useInvalidatingMutation({
    mutationFn: async ({ nextTeamName, nextIconKey }: { nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await createLeagueSquad({
        path: { id: leagueId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throwApiError(response.error, 'Team creation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: (team) => {
      setTeamName(team.name);
      queryClient.setQueryData<SquadDto[]>(QueryKeys.leagueTeams.byLeague(leagueId), (current) =>
        current ? [...current.filter((candidate) => candidate.id !== team.id), team] : [team],
      );
    },
    invalidates: [],
  });

  const updateTeamMutation = useInvalidatingMutation({
    mutationFn: async ({ teamId, nextTeamName, nextIconKey }: { teamId: string; nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throwApiError(response.error, 'Team update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: (team) => {
      setTeamName(team.name);
      queryClient.setQueryData<SquadDto[]>(QueryKeys.leagueTeams.byLeague(leagueId), (current) =>
        current?.map((candidate) => (candidate.id === team.id ? team : candidate)) ?? [team],
      );
    },
    invalidates: [],
  });

  const updateTeamIconMutation = useInvalidatingMutation({
    mutationFn: async ({ teamId, nextIconKey }: { teamId: string; nextIconKey: TeamIconKey }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throwApiError(response.error, 'Team icon update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: (team) => {
      setIconDraftKey(team.iconKey);
      setIconModalOpen(false);
      queryClient.setQueryData<SquadDto[]>(QueryKeys.leagueTeams.byLeague(leagueId), (current) =>
        current?.map((candidate) => (candidate.id === team.id ? team : candidate)) ?? [team],
      );
    },
    invalidates: [],
  });

  const isPending =
    createTeamMutation.isPending
    || updateTeamMutation.isPending
    || updateTeamIconMutation.isPending;
  const isBusy = isPending || otherWritesPending;

  async function handleSaveTeam() {
    const nextTeamName = teamName.trim();
    if (!nextTeamName || !leagueId || isInactiveLeague) {
      return;
    }

    if (selectedTeam) {
      if (!canManageSelectedTeam) {
        return;
      }
      const targetTeamId = activeDialog === 'name' ? teamNameDraftTeamId : selectedTeam.id;
      const targetTeam = teams?.find((team) => team.id === targetTeamId) ?? selectedTeam;

      if (!targetTeamId || targetTeamId !== targetTeam.id) {
        throw new Error('Team selection changed before the team name could be saved.');
      }

      await updateTeamMutation.mutateAsync({
        teamId: targetTeamId,
        nextTeamName,
        nextIconKey: targetTeam.iconKey,
      });
      return;
    }

    if (!canCreateOwnTeam) {
      return;
    }
    await createTeamMutation.mutateAsync({ nextTeamName, nextIconKey: iconDraftKey });
  }

  function handleOpenIconModal() {
    setIconDraftKey(selectedTeam?.iconKey ?? iconDraftKey);
    setIconModalOpen(true);
  }

  function handleOpenTeamNameModal() {
    if (!selectedTeam) {
      return;
    }

    setTeamName(selectedTeam.name);
    setTeamNameDraftTeamId(selectedTeam.id);
    updateTeamMutation.reset();
    setActiveDialog('name');
  }

  function handleCloseTeamNameModal() {
    if (isBusy) {
      return;
    }

    setActiveDialog(null);
    setTeamNameDraftTeamId(null);
  }

  function handleCloseIconModal() {
    if (updateTeamIconMutation.isPending) {
      return;
    }

    setIconDraftKey(selectedTeam?.iconKey ?? iconDraftKey);
    setIconModalOpen(false);
    updateTeamIconMutation.reset();
  }

  async function handleSaveTeamIcon() {
    if (selectedTeam) {
      if (!canManageSelectedTeam || isInactiveLeague || isInactiveTeam) {
        return;
      }

      await updateTeamIconMutation.mutateAsync({
        teamId: selectedTeam.id,
        nextIconKey: iconDraftKey,
      });
      return;
    }

    setIconModalOpen(false);
  }

  return {
    teamName,
    setTeamName,
    teamNameDraftTeamId,
    iconModalOpen,
    iconDraftKey,
    setIconDraftKey,
    createTeamMutation,
    updateTeamMutation,
    updateTeamIconMutation,
    isPending,
    handleSaveTeam,
    handleOpenIconModal,
    handleOpenTeamNameModal,
    handleCloseTeamNameModal,
    handleCloseIconModal,
    handleSaveTeamIcon,
  };
}

export type MyTeamDetails = ReturnType<typeof useMyTeamDetails>;
