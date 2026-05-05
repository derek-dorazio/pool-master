import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  createSquadOwnerInvitation,
  createLeagueSquad,
  deleteLeagueSquad,
  getLeagueByCode,
  inactivateLeagueSquad,
  listLeagueMembers,
  listLeagueSquads,
  listSquadOwnerInvitations,
  replaceSquadOwner,
  revokeSquadOwnerInvitation,
  updateLeagueSquad,
  type ListSquadOwnerInvitationsResponses,
  type GetLeagueByCodeResponses,
  type ListLeagueMembersResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  ActionList,
  ActionModal,
  ActionTile,
  Alert,
  Button,
  ConfirmDialog,
  DefinitionList,
  DetailWithActionsPage,
  FormField,
  IconAvatar,
  IconPickerModal,
  Input,
  LinkButton,
  LifecycleActionSet,
  Modal,
  Tile,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { buildUserPath } from '@/features/account/user-routing';
import { formatUserName } from '@/features/account/user-name';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { buildLeaguePath, setRecentLeagueCode } from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import { TeamOwnerActionMenu } from './team-owner-action-menu';
import { getTeamIconOption, TEAM_ICON_OPTIONS } from './team-icon-catalog';
import { buildDefaultTeamName } from './team-defaults';
import { TeamIcon } from './team-icon';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type LeagueMember = ListLeagueMembersResponses[200]['members'][number];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type TeamMember = NonNullable<TeamSummary['members']>[number];
type OwnerInvitation = ListSquadOwnerInvitationsResponses[200]['invitations'][number];
type ActiveTeamDialog = 'name' | 'owners' | 'inactivate' | 'delete' | null;

const TEAM_PAGE_FALLBACK_ERROR = 'We could not complete that team action. Please try again.';

export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const logger = getLogger().child({
    feature: 'my-team-page',
  });
  const [teamName, setTeamName] = useState('');
  const [teamNameDraftTeamId, setTeamNameDraftTeamId] = useState<string | null>(null);
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [iconDraftKey, setIconDraftKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [teamInactivationNotice, setTeamInactivationNotice] = useState<string | null>(null);
  const [teamDeletionNotice, setTeamDeletionNotice] = useState<string | null>(null);
  const [replaceTargetUserId, setReplaceTargetUserId] = useState<string | null>(null);
  const [replaceEmail, setReplaceEmail] = useState('');
  const [activeDialog, setActiveDialog] = useState<ActiveTeamDialog>(null);

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueCode],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeagueByCode({ path: { leagueCode } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league;
    },
    enabled: Boolean(leagueCode),
    retry: false,
  });

  useEffect(() => {
    if (leagueQuery.data?.leagueCode) {
      setRecentLeagueCode(leagueQuery.data.leagueCode);
    }
  }, [leagueQuery.data?.leagueCode]);

  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'team.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'My team page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = leagueQuery.data?.id ?? '';

  const teamsQuery = useQuery({
    queryKey: ['poolmaster', 'league-teams', leagueId],
    queryFn: async (): Promise<TeamSummary[]> => {
      const response = await listLeagueSquads({ path: { id: leagueId } });

      if (!response.data?.squads) {
        throw response.error ?? new Error('Team list response is missing data.');
      }

      return response.data.squads;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const ownerInvitationsQuery = useQuery({
    queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId],
    queryFn: async (): Promise<OwnerInvitation[]> => {
      const response = await listSquadOwnerInvitations({ path: { id: leagueId } });
      if (!response.data?.invitations) {
        throw response.error ?? new Error('Owner invitation list response is missing data.');
      }

      return response.data.invitations;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const leagueMembersQuery = useQuery({
    queryKey: ['poolmaster', 'league-members', leagueId],
    queryFn: async (): Promise<LeagueMember[]> => {
      const response = await listLeagueMembers({ path: { id: leagueId } });
      if (!response.data?.members) {
        throw response.error ?? new Error('League members response is missing data.');
      }

      return response.data.members;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

  const myTeam = useMemo(() => {
    return teamsQuery.data?.find((team) => team.teamRelationship.owner) ?? null;
  }, [teamsQuery.data]);

  const requestedTeamId = searchParams.get('teamId');
  const requestedTeam = useMemo(
    () => teamsQuery.data?.find((team) => team.id === requestedTeamId) ?? null,
    [requestedTeamId, teamsQuery.data],
  );
  const selectedTeam = useMemo(() => {
    if (
      requestedTeam
      && (requestedTeam.teamRelationship.commissioner || requestedTeam.isRootAdmin)
    ) {
      return requestedTeam;
    }

    return myTeam;
  }, [myTeam, requestedTeam]);

  const leagueMembersByUserId = useMemo(
    () => new Map((leagueMembersQuery.data ?? []).map((member) => [member.userId, member])),
    [leagueMembersQuery.data],
  );

  useEffect(() => {
    if (iconModalOpen) {
      return;
    }

    setIconDraftKey(selectedTeam?.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD);
  }, [iconModalOpen, selectedTeam?.iconKey]);

  useEffect(() => {
    if (selectedTeam) {
      return;
    }

    setTeamName(buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName));
  }, [auth.user?.firstName, auth.user?.lastName, selectedTeam]);

  useEffect(() => {
    setTeamInactivationNotice(null);
    setTeamDeletionNotice(null);
  }, [selectedTeam?.id]);

  useEffect(() => {
    if (activeDialog !== 'name') {
      return;
    }

    if (!selectedTeam) {
      setActiveDialog(null);
      setTeamNameDraftTeamId(null);
      return;
    }

    if (teamNameDraftTeamId && teamNameDraftTeamId !== selectedTeam.id) {
      setTeamName(selectedTeam.name);
      setTeamNameDraftTeamId(selectedTeam.id);
    }
  }, [activeDialog, selectedTeam, teamNameDraftTeamId]);

  const createTeamMutation = useMutation({
    mutationFn: async ({ nextTeamName, nextIconKey }: { nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await createLeagueSquad({
        path: { id: leagueId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team creation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      queryClient.setQueryData<TeamSummary[]>(['poolmaster', 'league-teams', leagueId], (current) =>
        current ? [...current.filter((candidate) => candidate.id !== team.id), team] : [team],
      );
    },
  });

  const updateTeamMutation = useMutation({
    mutationFn: async ({ teamId, nextTeamName, nextIconKey }: { teamId: string; nextTeamName: string; nextIconKey: TeamIconKey }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { name: nextTeamName, iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setTeamName(team.name);
      queryClient.setQueryData<TeamSummary[]>(['poolmaster', 'league-teams', leagueId], (current) =>
        current?.map((candidate) => (candidate.id === team.id ? team : candidate)) ?? [team],
      );
    },
  });

  const updateTeamIconMutation = useMutation({
    mutationFn: async ({ teamId, nextIconKey }: { teamId: string; nextIconKey: TeamIconKey }) => {
      const response = await updateLeagueSquad({
        path: { id: leagueId, squadId: teamId },
        body: { iconKey: nextIconKey },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team icon update response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setIconDraftKey(team.iconKey);
      setIconModalOpen(false);
      queryClient.setQueryData<TeamSummary[]>(['poolmaster', 'league-teams', leagueId], (current) =>
        current?.map((candidate) => (candidate.id === team.id ? team : candidate)) ?? [team],
      );
    },
  });

  const createOwnerInvitationMutation = useMutation({
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
        throw response.error ?? new Error('Owner invitation response is missing data.');
      }

      return response.data.invitation;
    },
    onSuccess: async () => {
      setCoOwnerEmail('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  const replaceOwnerMutation = useMutation({
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
        throw response.error ?? new Error('Replace owner response is missing data.');
      }

      return response.data.invitation;
    },
    onSuccess: async () => {
      setReplaceTargetUserId(null);
      setReplaceEmail('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  const revokeOwnerInvitationMutation = useMutation({
    mutationFn: async (invitationId: string) => {
      const response = await revokeSquadOwnerInvitation({
        path: { id: leagueId, invitationId },
      });

      if (!response.data?.invitation) {
        throw response.error ?? new Error('Revoke owner invitation response is missing data.');
      }

      return response.data.invitation;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
    },
  });

  const inactivateTeamMutation = useMutation({
    mutationFn: async () => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before it can be inactivated.');
      }

      const response = await inactivateLeagueSquad({
        path: { id: leagueId, squadId },
      });

      if (!response.data?.squad) {
        throw response.error ?? new Error('Team inactivation response is missing data.');
      }

      return response.data.squad;
    },
    onSuccess: async (team) => {
      setActiveDialog(null);
      setTeamInactivationNotice(
        `${team.name} is now inactive. Its active owners were removed from the league, and any user with no other active leagues was also inactivated.`,
      );
      setReplaceTargetUserId(null);
      setReplaceEmail('');
      setCoOwnerEmail('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
    },
  });

  const deleteTeamMutation = useMutation({
    mutationFn: async () => {
      const squadId = selectedTeam?.id;
      if (!squadId) {
        throw new Error('A team must exist before it can be deleted.');
      }

      const response = await deleteLeagueSquad({
        path: { id: leagueId, squadId },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('Team deletion response is missing data.');
      }

      return selectedTeam.name;
    },
    onSuccess: async (teamNameDeleted) => {
      setActiveDialog(null);
      setTeamDeletionNotice(`${teamNameDeleted} was deleted.`);
      setTeamInactivationNotice(null);
      setReplaceTargetUserId(null);
      setReplaceEmail('');
      setCoOwnerEmail('');
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-team-owner-invitations', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
      navigate('/manage/teams');
    },
  });

  async function handleSaveTeam() {
    const nextTeamName = teamName.trim();
    if (!nextTeamName || !leagueId || leagueQuery.data?.isActive === false) {
      return;
    }

    if (selectedTeam) {
      if (!canManageSelectedTeam) {
        return;
      }
      const targetTeamId = activeDialog === 'name' ? teamNameDraftTeamId : selectedTeam.id;
      const targetTeam = teamsQuery.data?.find((team) => team.id === targetTeamId) ?? selectedTeam;

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
      if (!canManageSelectedTeam || leagueQuery.data?.isActive === false || isInactiveTeam) {
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

  if (leagueQuery.isLoading) {
    return (
      <Tile padding="lg">Loading your team...</Tile>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <Tile padding="lg">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.body}
        </p>
        <LinkButton className="mt-4" to="/welcome" variant="subtle">
          Back to welcome
        </LinkButton>
      </Tile>
    );
  }

  const isInactiveLeague = leagueQuery.data.isActive === false;
  const isInactiveTeam = selectedTeam?.isActive === false;
  const canCreateOwnTeam = leagueQuery.data.leagueRelationship.leagueMember;
  const canManageSelectedTeam = Boolean(
    selectedTeam
    && (selectedTeam.teamRelationship.owner
      || selectedTeam.teamRelationship.commissioner
      || selectedTeam.isRootAdmin),
  );
  const canDeleteSelectedTeam = Boolean(selectedTeam && isInactiveTeam && selectedTeam.isRootAdmin);
  const isManagingAnotherTeam = Boolean(
    selectedTeam
    && myTeam
    && selectedTeam.id !== myTeam.id
    && (selectedTeam.teamRelationship.commissioner || selectedTeam.isRootAdmin),
  );
  const isBusy =
    createTeamMutation.isPending
    || updateTeamMutation.isPending
    || updateTeamIconMutation.isPending
    || createOwnerInvitationMutation.isPending
    || replaceOwnerMutation.isPending
    || revokeOwnerInvitationMutation.isPending
    || inactivateTeamMutation.isPending
    || deleteTeamMutation.isPending;
  const activeMembers = (selectedTeam?.members ?? []).filter((member) => member.status === 'ACTIVE');
  const currentIconKey = selectedTeam?.iconKey ?? iconDraftKey;
  const selectedIcon = getTeamIconOption(currentIconKey);
  const draftIcon = getTeamIconOption(iconDraftKey);
  const teamLifecycleLabel = selectedTeam?.isActive === false ? 'Inactive' : 'Active';
  const teamOwnerInvitations = ownerInvitationsQuery.data?.filter(
    (invitation) => invitation.squadId === selectedTeam?.id,
  ) ?? [];
  const teamStatusClass = isInactiveTeam ? 'text-destructive' : 'text-foreground';
  const activeOwnerNames = activeMembers.map((member) => formatUserName(member.firstName, member.lastName));
  const ownerManagementContent = (
    <div className="space-y-5" data-testid="my-team-owners-panel">
      {selectedTeam ? (
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Add co-owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite another person to co-manage this team. Existing league members are rejected automatically.
          </p>
          <div className="mt-4 flex gap-3">
            <Input
              data-testid="my-team-owner-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setCoOwnerEmail(event.target.value)}
              placeholder="owner@example.com"
              type="email"
              value={coOwnerEmail}
            />
            <Button
              data-testid="my-team-owner-invite"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !coOwnerEmail.trim()}
              onClick={() =>
                void createOwnerInvitationMutation.mutateAsync(coOwnerEmail.trim()).catch(() => undefined)}
            >
              Invite
            </Button>
          </div>
          {createOwnerInvitationMutation.isSuccess ? (
            <Alert className="mt-3" tone="success">Co-owner invite created.</Alert>
          ) : null}
          {createOwnerInvitationMutation.isError ? (
            <Alert className="mt-3" tone="danger">{extractErrorMessage(createOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
          ) : null}
        </Tile>
      ) : null}

      <div className="space-y-3">
        {teamsQuery.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading team members...</p>
        ) : teamsQuery.isError ? (
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your team yet.</p>
        ) : !selectedTeam ? (
          <p className="text-sm text-muted-foreground">
            Create your team first and the active member list will appear here.
          </p>
        ) : activeMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This team does not have any active members yet.
          </p>
        ) : (
          activeMembers.map((member: TeamMember) => (
            <Tile
              className="flex items-center justify-between gap-4"
              data-testid={`my-team-member-${member.userId}`}
              key={member.id}
              radius="lg"
            >
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <Link
                    className="font-medium text-foreground hover:underline"
                    data-testid={`my-team-member-link-${member.userId}`}
                    to={buildUserPath(member.userId)}
                  >
                    {formatUserName(member.firstName, member.lastName)}
                  </Link>
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    Active owner
                  </span>
                  {leagueMembersByUserId.get(member.userId) ? (
                    <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                      {leagueMembersByUserId.get(member.userId)?.role === 'COMMISSIONER' ? 'Commissioner' : 'Member'}
                    </span>
                  ) : null}
                </div>
                <div className="text-sm text-muted-foreground">{member.userId}</div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <TeamOwnerActionMenu
                  activeOwnerCount={activeMembers.length}
                  canManageLeagueRole={
                    selectedTeam.teamRelationship.commissioner || selectedTeam.isRootAdmin
                  }
                  canRemoveOwner={
                    selectedTeam.teamRelationship.owner
                    || selectedTeam.teamRelationship.commissioner
                    || selectedTeam.isRootAdmin
                  }
                  leagueCode={leagueCode}
                  leagueId={leagueId}
                  ownerName={formatUserName(member.firstName, member.lastName)}
                  ownerRole={leagueMembersByUserId.get(member.userId)?.role}
                  ownerUserId={member.userId}
                  surface="team-home"
                  teamId={selectedTeam.id}
                />
                {member.userId !== auth.user?.id ? (
                  <Button
                    data-testid={`my-team-open-replace-${member.userId}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                    onClick={() => {
                      setReplaceTargetUserId((current) => current === member.userId ? null : member.userId);
                      setReplaceEmail('');
                    }}
                    size="sm"
                    variant="secondary"
                  >
                    Replace owner
                  </Button>
                ) : null}
              </div>
            </Tile>
          ))
        )}
      </div>

      {selectedTeam && teamOwnerInvitations.length ? (
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Pending owner invites</h4>
          <div className="mt-4 space-y-3">
            {teamOwnerInvitations.map((invitation) => (
              <Tile
                className="flex flex-wrap items-center justify-between gap-3"
                data-testid={`my-team-owner-invitation-${invitation.id}`}
                key={invitation.id}
                radius="lg"
              >
                <div>
                  <div className="font-medium text-foreground">{invitation.email}</div>
                  <div className="text-sm text-muted-foreground">
                    {invitation.status} {invitation.replacementForUserId ? '· Replacement invite' : ''}
                  </div>
                </div>
                {invitation.status === 'PENDING' ? (
                  <Button
                    data-testid={`my-team-revoke-owner-invitation-${invitation.id}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                    onClick={() =>
                      void revokeOwnerInvitationMutation.mutateAsync(invitation.id).catch(() => undefined)}
                    size="sm"
                    variant="secondary"
                  >
                    Revoke
                  </Button>
                ) : null}
              </Tile>
            ))}
          </div>
        </Tile>
      ) : null}

      {replaceTargetUserId ? (
        <Tile radius="lg">
          <h4 className="text-sm font-semibold text-foreground">Replace owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Replacing an owner inactivates the selected current owner and starts the owner-invite flow for the replacement email.
          </p>
          <div className="mt-4 flex gap-3">
            <Input
              data-testid="my-team-replace-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setReplaceEmail(event.target.value)}
              placeholder="replacement@example.com"
              type="email"
              value={replaceEmail}
            />
            <Button
              data-testid="my-team-replace-submit"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !replaceEmail.trim()}
              onClick={() =>
                void replaceOwnerMutation.mutateAsync({
                  userId: replaceTargetUserId,
                  email: replaceEmail.trim(),
                }).catch(() => undefined)}
            >
              Replace
            </Button>
            <Button
              data-testid="my-team-replace-cancel"
              onClick={() => {
                setReplaceTargetUserId(null);
                setReplaceEmail('');
              }}
              variant="secondary"
            >
              Cancel
            </Button>
          </div>
          {replaceOwnerMutation.isError ? (
            <Alert className="mt-3" tone="danger">{extractErrorMessage(replaceOwnerMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
          ) : null}
        </Tile>
      ) : null}

      {revokeOwnerInvitationMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(revokeOwnerInvitationMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
      {teamInactivationNotice ? (
        <Alert tone="success">{teamInactivationNotice}</Alert>
      ) : null}
      {teamDeletionNotice ? (
        <Alert tone="success">{teamDeletionNotice}</Alert>
      ) : null}
      {inactivateTeamMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(inactivateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
      {deleteTeamMutation.isError ? (
        <Alert tone="danger">{extractErrorMessage(deleteTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <Tile padding="lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <IconAvatar className={selectedIcon.themeClass} size="lg">
              <TeamIcon iconKey={currentIconKey} size="lg" />
            </IconAvatar>
            <div>
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {isManagingAnotherTeam ? 'Commissioner team view' : 'Team'}
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                {selectedTeam ? selectedTeam.name : 'Create your team'}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {isManagingAnotherTeam
                  ? 'Review this team, update its details, and manage its owners.'
                  : !selectedTeam && !canCreateOwnTeam
                    ? 'Select a team from Teams and Owners to manage it here. Root admins can review any team without becoming league members.'
                    : 'Manage your team name, icon, owners, and lifecycle.'}
              </p>
            </div>
          </div>
          <LinkButton to={buildLeaguePath(leagueCode)} variant="secondary">
            Back to league
          </LinkButton>
        </div>
      </Tile>

      {isInactiveLeague ? (
        <Alert tone="warning" title="This league is inactive.">
          <p>
            Team information stays visible, but team updates are read-only while the league is
            inactive.
          </p>
        </Alert>
      ) : null}

      <DetailWithActionsPage
        actions={(
          <ActionList>
            {selectedTeam ? (
              <>
                <ActionTile
                  data-testid="my-team-open-name"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  label="Change team name"
                  onClick={handleOpenTeamNameModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="my-team-change-icon"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  label="Change team icon"
                  onClick={handleOpenIconModal}
                  trailing="Open"
                />
                <ActionTile
                  data-testid="my-team-open-owners"
                  disabled={isBusy || !canManageSelectedTeam}
                  label="Manage owners"
                  onClick={() => setActiveDialog('owners')}
                  trailing="Open"
                />
                <LifecycleActionSet
                  actions={[
                    {
                      key: 'inactivate',
                      label: 'Inactivate team',
                      pending: inactivateTeamMutation.isPending,
                      pendingLabel: 'Inactivating...',
                      disabled: isInactiveLeague || isBusy || !canManageSelectedTeam,
                      onSelect: () => setActiveDialog('inactivate'),
                      testId: 'my-team-inactivate',
                      tone: 'danger',
                      visibleForStatuses: ['Active'],
                    },
                    {
                      key: 'delete',
                      label: 'Delete team',
                      pending: deleteTeamMutation.isPending,
                      pendingLabel: 'Deleting...',
                      disabled: !canDeleteSelectedTeam || isInactiveLeague || isBusy,
                      onSelect: () => setActiveDialog('delete'),
                      testId: 'my-team-delete',
                      tone: 'danger',
                      visibleForStatuses: ['Inactive'],
                    },
                  ]}
                  currentStatus={isInactiveTeam ? 'Inactive' : 'Active'}
                  statusTone={isInactiveTeam ? 'inactive' : 'active'}
                  title="Team lifecycle"
                />
              </>
            ) : (
              <Alert>
                Create your team before managing owners and lifecycle.
              </Alert>
            )}

            {updateTeamMutation.isSuccess ? (
              <Alert tone="success">Your team was updated.</Alert>
            ) : null}
            {teamInactivationNotice ? (
              <Alert tone="success">{teamInactivationNotice}</Alert>
            ) : null}
            {teamDeletionNotice ? (
              <Alert tone="success">{teamDeletionNotice}</Alert>
            ) : null}
            {inactivateTeamMutation.isError ? (
              <Alert tone="danger">{extractErrorMessage(inactivateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
            ) : null}
            {deleteTeamMutation.isError ? (
              <Alert tone="danger">{extractErrorMessage(deleteTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
            ) : null}
          </ActionList>
        )}
        actionsTestId="my-team-actions-tile"
        details={(
          <Tile data-testid="my-team-details-tile">
            <h3 className="text-xl font-semibold">{selectedTeam ? 'Team details' : 'Create your team'}</h3>

            {selectedTeam ? (
              <div className="mt-5 space-y-4">
                <Tile className="flex items-center gap-4" radius="lg">
                  <IconAvatar className={selectedIcon.themeClass} size="md">
                    <TeamIcon iconKey={currentIconKey} size="lg" />
                  </IconAvatar>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Team name
                    </div>
                    <div className="mt-1 text-base font-medium">{selectedTeam.name}</div>
                  </div>
                </Tile>

                <DefinitionList
                  items={[
                    {
                      id: 'status',
                      label: 'Status',
                      value: (
                        <span className={teamStatusClass} data-testid="my-team-lifecycle-status">
                          {teamLifecycleLabel}
                        </span>
                      ),
                    },
                    {
                      id: 'current-icon',
                      label: 'Current icon',
                      value: <span data-testid="my-team-current-icon-label">{selectedIcon.label}</span>,
                    },
                  ]}
                />

                <Tile radius="lg">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Team owners
                  </div>
                  <div className="mt-3 space-y-2">
                    {activeOwnerNames.length ? (
                      activeOwnerNames.map((ownerName, index) => (
                        <div className="text-base font-medium text-foreground" key={`${ownerName}-${index}`}>
                          {ownerName}
                        </div>
                      ))
                    ) : (
                      <div className="text-sm text-muted-foreground">No active owners</div>
                    )}
                  </div>
                </Tile>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  A team is required for league participation. Start with a name and icon that feel right for your group.
                </p>
                <FormField label="Team name">
                  <Input
                    data-testid="my-team-name"
                    disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
                    maxLength={100}
                    onChange={(event) => setTeamName(event.target.value)}
                    value={teamName}
                  />
                </FormField>
                <Tile className="flex items-center gap-4" radius="lg">
                  <IconAvatar className={selectedIcon.themeClass} size="md">
                    <TeamIcon iconKey={currentIconKey} size="lg" />
                  </IconAvatar>
                  <Button
                    data-testid="my-team-change-icon"
                    disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
                    onClick={handleOpenIconModal}
                    variant="secondary"
                  >
                    Change icon
                  </Button>
                </Tile>
                <Button
                  data-testid="my-team-save"
                  disabled={!teamName.trim() || isInactiveLeague || isBusy || !canCreateOwnTeam}
                  onClick={() => void handleSaveTeam().catch(() => undefined)}
                >
                  {isBusy ? 'Saving...' : canCreateOwnTeam ? 'Create team' : 'Choose a team first'}
                </Button>
                {createTeamMutation.isSuccess ? (
                  <Alert tone="success">Your team was created.</Alert>
                ) : null}
                {createTeamMutation.isError ? (
                  <Alert tone="danger">{extractErrorMessage(createTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}</Alert>
                ) : null}
              </div>
            )}
          </Tile>
        )}
      />

      <Modal
        description="Update the team name shown across league and contest pages."
        descriptionId="my-team-name-modal-description"
        onOpenChange={(open) => {
          if (open) {
            handleOpenTeamNameModal();
            return;
          }

          if (!isBusy) {
            handleCloseTeamNameModal();
          }
        }}
        open={activeDialog === 'name'}
        testId="my-team-name-modal"
        title="Change team name"
      >
        <FormField label="Team name">
          <Input
            data-testid="my-team-name"
            disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
            maxLength={100}
            onChange={(event) => setTeamName(event.target.value)}
            value={teamName}
          />
        </FormField>
        {updateTeamMutation.isError ? (
          <Alert className="mt-4" tone="danger">
            {extractErrorMessage(updateTeamMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })}
          </Alert>
        ) : null}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            disabled={isBusy}
            onClick={handleCloseTeamNameModal}
            variant="secondary"
          >
            Cancel
          </Button>
          <Button
            data-testid="my-team-save"
            disabled={
              !teamName.trim()
              || isInactiveLeague
              || isInactiveTeam
              || isBusy
              || !canManageSelectedTeam
              || teamNameDraftTeamId !== selectedTeam?.id
            }
            onClick={() =>
              void handleSaveTeam()
                .then(handleCloseTeamNameModal)
                .catch(() => undefined)}
          >
            {updateTeamMutation.isPending ? 'Saving...' : 'Save team'}
          </Button>
        </div>
      </Modal>

      <ActionModal
        description="Add, replace, or remove team owners."
        footer={(
          <Button onClick={() => setActiveDialog(null)} variant="secondary">
            Close
          </Button>
        )}
        onCancel={() => setActiveDialog(null)}
        onOpenChange={(open) => setActiveDialog(open ? 'owners' : null)}
        open={activeDialog === 'owners'}
        size="lg"
        testId="my-team-owners-modal"
        title="Manage owners"
      >
        <div className="mt-5">
          {ownerManagementContent}
        </div>
      </ActionModal>

      <ConfirmDialog
        confirmLabel="Inactivate team"
        confirmTestId="my-team-confirm-inactivate"
        description={
          selectedTeam
            ? `${selectedTeam.name} will become inactive. Active owners are removed from the league if they do not have another active team.`
            : 'This team will become inactive.'
        }
        isPending={inactivateTeamMutation.isPending}
        onCancel={() => {
          if (!inactivateTeamMutation.isPending) {
            inactivateTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        onConfirm={() => void inactivateTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setActiveDialog('inactivate');
            return;
          }

          if (!inactivateTeamMutation.isPending) {
            inactivateTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'inactivate'}
        pendingLabel="Inactivating..."
        testId="my-team-inactivate-dialog"
        title="Inactivate team"
        tone="danger"
      />

      <ConfirmDialog
        confirmLabel="Delete team"
        confirmTestId="my-team-confirm-delete"
        description={
          selectedTeam
            ? `${selectedTeam.name} will be permanently deleted. This is only available after the team is inactive.`
            : 'This inactive team will be permanently deleted.'
        }
        isPending={deleteTeamMutation.isPending}
        onCancel={() => {
          if (!deleteTeamMutation.isPending) {
            deleteTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        onConfirm={() => void deleteTeamMutation.mutateAsync().catch(() => undefined)}
        onOpenChange={(open) => {
          if (open) {
            setActiveDialog('delete');
            return;
          }

          if (!deleteTeamMutation.isPending) {
            deleteTeamMutation.reset();
            setActiveDialog(null);
          }
        }}
        open={activeDialog === 'delete'}
        pendingLabel="Deleting..."
        testId="my-team-delete-dialog"
        title="Delete team"
        tone="danger"
      />

      <IconPickerModal
        canSave={!isInactiveLeague && !isBusy && (selectedTeam ? canManageSelectedTeam : canCreateOwnTeam)}
        canSelect={!isInactiveLeague && !isBusy}
        closeLabel="Close team icon modal"
        description="Pick a built-in icon and save it without leaving Team Home."
        descriptionId="my-team-icon-modal-description"
        errorMessage={
          updateTeamIconMutation.isError
            ? extractErrorMessage(updateTeamIconMutation.error, { fallback: TEAM_PAGE_FALLBACK_ERROR })
            : null
        }
        isPending={updateTeamIconMutation.isPending}
        modalTestId="my-team-icon-modal"
        onCancel={handleCloseIconModal}
        onOpenChange={(open) => {
          if (open) {
            handleOpenIconModal();
            return;
          }

          handleCloseIconModal();
        }}
        onSave={() => void handleSaveTeamIcon().catch(() => undefined)}
        onSelect={setIconDraftKey}
        open={iconModalOpen}
        optionTestIdPrefix="my-team-icon"
        options={TEAM_ICON_OPTIONS}
        paletteTestId="my-team-icon-palette"
        renderOptionIcon={(icon) => (
          <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${icon.themeClass}`}>
            <TeamIcon iconKey={icon.key} size="md" />
          </div>
        )}
        renderSelectedIcon={() => (
          <IconAvatar className={draftIcon.themeClass} size="lg">
            <TeamIcon iconKey={iconDraftKey} size="lg" />
          </IconAvatar>
        )}
        saveTestId="my-team-save-icon"
        selectedLabel={draftIcon.label}
        title="Change team icon"
        value={iconDraftKey}
      />
    </section>
  );
}
