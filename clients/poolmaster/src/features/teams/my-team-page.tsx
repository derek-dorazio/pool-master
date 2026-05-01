import * as Dialog from '@radix-ui/react-dialog';
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
import { IconPickerModal } from '@/features/shared/icon-picker-modal';
import { ConfirmDialog, DetailsActionsLayout } from '@/features/shared/ui';
import { extractErrorMessage as extractSharedErrorMessage } from '@/lib/errors';
import { buildUserPath } from '@/features/account/user-routing';
import { formatUserName } from '@/features/account/user-name';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { buildLeaguePath, setRecentLeagueCode } from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
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

function extractErrorMessage(error: unknown): string {
  return extractSharedErrorMessage(error, {
    fallback: 'We could not complete that team action. Please try again.',
  });
}

export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const logger = useLogger().child({
    feature: 'my-team-page',
  });
  const [teamName, setTeamName] = useState('');
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
    if (selectedTeam) {
      setTeamName(selectedTeam.name);
      setTeamInactivationNotice(null);
      setTeamDeletionNotice(null);
      return;
    }

    setTeamName(buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName));
    setTeamInactivationNotice(null);
    setTeamDeletionNotice(null);
  }, [auth.user?.firstName, auth.user?.lastName, selectedTeam]);

  useEffect(() => {
    if (iconModalOpen) {
      return;
    }

    setIconDraftKey(selectedTeam?.iconKey ?? TeamIconKey.CAPTAIN_SMILE_FIELD);
  }, [iconModalOpen, selectedTeam?.iconKey]);

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
      await updateTeamMutation.mutateAsync({
        teamId: selectedTeam.id,
        nextTeamName,
        nextIconKey: selectedTeam.iconKey,
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
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading your team...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {copy.body}
        </p>
        <Link
          className="mt-4 inline-flex text-sm font-medium text-primary hover:underline"
          to="/welcome"
        >
          Back to welcome
        </Link>
      </section>
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
        <div className="rounded-[1.5rem] border border-border bg-background p-4">
          <h4 className="text-sm font-semibold text-foreground">Add co-owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Invite another person to co-manage this team. Existing league members are rejected automatically.
          </p>
          <div className="mt-4 flex gap-3">
            <input
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
              data-testid="my-team-owner-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setCoOwnerEmail(event.target.value)}
              placeholder="owner@example.com"
              type="email"
              value={coOwnerEmail}
            />
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="my-team-owner-invite"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !coOwnerEmail.trim()}
              onClick={() => void createOwnerInvitationMutation.mutateAsync(coOwnerEmail.trim())}
              type="button"
            >
              Invite
            </button>
          </div>
          {createOwnerInvitationMutation.isSuccess ? (
            <p className="mt-3 text-sm text-emerald-700">Co-owner invite created.</p>
          ) : null}
          {createOwnerInvitationMutation.isError ? (
            <p className="mt-3 text-sm text-destructive">{extractErrorMessage(createOwnerInvitationMutation.error)}</p>
          ) : null}
        </div>
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
            <div
              className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-4"
              data-testid={`my-team-member-${member.userId}`}
              key={member.id}
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
                  <button
                    className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`my-team-open-replace-${member.userId}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                    onClick={() => {
                      setReplaceTargetUserId((current) => current === member.userId ? null : member.userId);
                      setReplaceEmail('');
                    }}
                    type="button"
                  >
                    Replace owner
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>

      {selectedTeam && teamOwnerInvitations.length ? (
        <div className="rounded-[1.5rem] border border-border bg-background p-4">
          <h4 className="text-sm font-semibold text-foreground">Pending owner invites</h4>
          <div className="mt-4 space-y-3">
            {teamOwnerInvitations.map((invitation) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-4"
                data-testid={`my-team-owner-invitation-${invitation.id}`}
                key={invitation.id}
              >
                <div>
                  <div className="font-medium text-foreground">{invitation.email}</div>
                  <div className="text-sm text-muted-foreground">
                    {invitation.status} {invitation.replacementForUserId ? '· Replacement invite' : ''}
                  </div>
                </div>
                {invitation.status === 'PENDING' ? (
                  <button
                    className="rounded-2xl border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid={`my-team-revoke-owner-invitation-${invitation.id}`}
                    disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                    onClick={() => void revokeOwnerInvitationMutation.mutateAsync(invitation.id)}
                    type="button"
                  >
                    Revoke
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {replaceTargetUserId ? (
        <div className="rounded-[1.5rem] border border-border bg-background p-4">
          <h4 className="text-sm font-semibold text-foreground">Replace owner</h4>
          <p className="mt-2 text-sm text-muted-foreground">
            Replacing an owner inactivates the selected current owner and starts the owner-invite flow for the replacement email.
          </p>
          <div className="mt-4 flex gap-3">
            <input
              className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
              data-testid="my-team-replace-email"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
              onChange={(event) => setReplaceEmail(event.target.value)}
              placeholder="replacement@example.com"
              type="email"
              value={replaceEmail}
            />
            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="my-team-replace-submit"
              disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam || !replaceEmail.trim()}
              onClick={() =>
                void replaceOwnerMutation.mutateAsync({
                  userId: replaceTargetUserId,
                  email: replaceEmail.trim(),
                })}
              type="button"
            >
              Replace
            </button>
            <button
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
              data-testid="my-team-replace-cancel"
              onClick={() => {
                setReplaceTargetUserId(null);
                setReplaceEmail('');
              }}
              type="button"
            >
              Cancel
            </button>
          </div>
          {replaceOwnerMutation.isError ? (
            <p className="mt-3 text-sm text-destructive">{extractErrorMessage(replaceOwnerMutation.error)}</p>
          ) : null}
        </div>
      ) : null}

      {revokeOwnerInvitationMutation.isError ? (
        <p className="text-sm text-destructive">{extractErrorMessage(revokeOwnerInvitationMutation.error)}</p>
      ) : null}
      {teamInactivationNotice ? (
        <p className="text-sm text-emerald-700">{teamInactivationNotice}</p>
      ) : null}
      {teamDeletionNotice ? (
        <p className="text-sm text-emerald-700">{teamDeletionNotice}</p>
      ) : null}
      {inactivateTeamMutation.isError ? (
        <p className="text-sm text-destructive">{extractErrorMessage(inactivateTeamMutation.error)}</p>
      ) : null}
      {deleteTeamMutation.isError ? (
        <p className="text-sm text-destructive">{extractErrorMessage(deleteTeamMutation.error)}</p>
      ) : null}
    </div>
  );

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-16 w-16 items-center justify-center rounded-[1.4rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
              <TeamIcon iconKey={currentIconKey} size="lg" />
            </div>
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
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
            to={buildLeaguePath(leagueCode)}
          >
            Back to league
          </Link>
        </div>
      </div>

      {isInactiveLeague ? (
        <div className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h3 className="text-xl font-semibold">This league is inactive.</h3>
          <p className="mt-2 text-sm text-amber-900/90">
            Team information stays visible, but team updates are read-only while the league is
            inactive.
          </p>
        </div>
      ) : null}

      <DetailsActionsLayout
        actions={(
          <>
            {selectedTeam ? (
              <>
                <button
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-4 text-left text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-team-open-name"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  onClick={() => setActiveDialog('name')}
                  type="button"
                >
                  <span>Change team name</span>
                  <span className="text-muted-foreground">Open</span>
                </button>
                <button
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-4 text-left text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-team-change-icon"
                  disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                  onClick={handleOpenIconModal}
                  type="button"
                >
                  <span>Change team icon</span>
                  <span className="text-muted-foreground">Open</span>
                </button>
                <button
                  className="flex w-full items-center justify-between rounded-2xl border border-border bg-background px-4 py-4 text-left text-sm font-medium text-foreground transition hover:border-primary/40 disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-team-open-owners"
                  disabled={isBusy || !canManageSelectedTeam}
                  onClick={() => setActiveDialog('owners')}
                  type="button"
                >
                  <span>Manage owners</span>
                  <span className="text-muted-foreground">Open</span>
                </button>
                {isInactiveTeam ? (
                  <button
                    className="w-full rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-4 text-left text-sm font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-team-delete"
                    disabled={!canDeleteSelectedTeam || isInactiveLeague || isBusy}
                    onClick={() => setActiveDialog('delete')}
                    type="button"
                  >
                    {deleteTeamMutation.isPending ? 'Deleting...' : 'Delete team'}
                  </button>
                ) : (
                  <button
                    className="w-full rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-4 text-left text-sm font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-team-inactivate"
                    disabled={isInactiveLeague || isBusy || !canManageSelectedTeam}
                    onClick={() => setActiveDialog('inactivate')}
                    type="button"
                  >
                    {inactivateTeamMutation.isPending ? 'Inactivating...' : 'Inactivate team'}
                  </button>
                )}
              </>
            ) : (
              <p className="rounded-2xl border border-border bg-background px-4 py-4 text-sm text-muted-foreground">
                Create your team before managing owners and lifecycle.
              </p>
            )}

            {updateTeamMutation.isSuccess ? (
              <p className="text-sm text-emerald-700">Your team was updated.</p>
            ) : null}
            {updateTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(updateTeamMutation.error)}</p>
            ) : null}
            {teamInactivationNotice ? (
              <p className="text-sm text-emerald-700">{teamInactivationNotice}</p>
            ) : null}
            {teamDeletionNotice ? (
              <p className="text-sm text-emerald-700">{teamDeletionNotice}</p>
            ) : null}
            {inactivateTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(inactivateTeamMutation.error)}</p>
            ) : null}
            {deleteTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(deleteTeamMutation.error)}</p>
            ) : null}
          </>
        )}
        actionsTestId="my-team-actions-tile"
        details={(
          <section className="rounded-[2rem] border border-border bg-card p-6" data-testid="my-team-details-tile">
            <h3 className="text-xl font-semibold">{selectedTeam ? 'Team details' : 'Create your team'}</h3>

            {selectedTeam ? (
              <div className="mt-5 space-y-4">
                <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-[1rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
                    <TeamIcon iconKey={currentIconKey} size="lg" />
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Team name
                    </div>
                    <div className="mt-1 text-base font-medium">{selectedTeam.name}</div>
                  </div>
                </div>

                <div className="grid gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4 sm:grid-cols-2">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Status
                    </div>
                    <div className={`mt-1 text-base font-semibold ${teamStatusClass}`} data-testid="my-team-lifecycle-status">
                      {teamLifecycleLabel}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Current icon
                    </div>
                    <div className="mt-1 text-base font-medium" data-testid="my-team-current-icon-label">
                      {selectedIcon.label}
                    </div>
                  </div>
                </div>

                <div className="rounded-[1.25rem] border border-border bg-background px-4 py-4">
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
                </div>
              </div>
            ) : (
              <div className="mt-5 space-y-4">
                <p className="text-sm text-muted-foreground">
                  A team is required for league participation. Start with a name and icon that feel right for your group.
                </p>
                <label className="block space-y-2">
                  <span className="text-sm font-medium text-foreground">Team name</span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="my-team-name"
                    disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
                    maxLength={100}
                    onChange={(event) => setTeamName(event.target.value)}
                    value={teamName}
                  />
                </label>
                <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
                  <div className={`flex h-14 w-14 items-center justify-center rounded-[1rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
                    <TeamIcon iconKey={currentIconKey} size="lg" />
                  </div>
                  <button
                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-team-change-icon"
                    disabled={isInactiveLeague || isBusy || !canCreateOwnTeam}
                    onClick={handleOpenIconModal}
                    type="button"
                  >
                    Change icon
                  </button>
                </div>
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="my-team-save"
                  disabled={!teamName.trim() || isInactiveLeague || isBusy || !canCreateOwnTeam}
                  onClick={() => void handleSaveTeam()}
                  type="button"
                >
                  {isBusy ? 'Saving...' : canCreateOwnTeam ? 'Create team' : 'Choose a team first'}
                </button>
                {createTeamMutation.isSuccess ? (
                  <p className="text-sm text-emerald-700">Your team was created.</p>
                ) : null}
                {createTeamMutation.isError ? (
                  <p className="text-sm text-destructive">{extractErrorMessage(createTeamMutation.error)}</p>
                ) : null}
              </div>
            )}
          </section>
        )}
      />

      <Dialog.Root
        onOpenChange={(open) => setActiveDialog(open ? 'name' : null)}
        open={activeDialog === 'name'}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby="my-team-name-modal-description"
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
            data-testid="my-team-name-modal"
          >
            <Dialog.Title className="text-2xl font-semibold tracking-tight">
              Change team name
            </Dialog.Title>
            <Dialog.Description
              className="mt-2 text-sm text-muted-foreground"
              id="my-team-name-modal-description"
            >
              Update the team name shown across league and contest pages.
            </Dialog.Description>
            <label className="mt-5 block space-y-2">
              <span className="text-sm font-medium text-foreground">Team name</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="my-team-name"
                disabled={isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                maxLength={100}
                onChange={(event) => setTeamName(event.target.value)}
                value={teamName}
              />
            </label>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isBusy}
                onClick={() => setActiveDialog(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="my-team-save"
                disabled={!teamName.trim() || isInactiveLeague || isInactiveTeam || isBusy || !canManageSelectedTeam}
                onClick={() => void handleSaveTeam().then(() => setActiveDialog(null))}
                type="button"
              >
                {updateTeamMutation.isPending ? 'Saving...' : 'Save team'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <Dialog.Root
        onOpenChange={(open) => setActiveDialog(open ? 'owners' : null)}
        open={activeDialog === 'owners'}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby="my-team-owners-modal-description"
            className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100vh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
            data-testid="my-team-owners-modal"
          >
            <Dialog.Title className="text-2xl font-semibold tracking-tight">
              Manage owners
            </Dialog.Title>
            <Dialog.Description
              className="mt-2 text-sm text-muted-foreground"
              id="my-team-owners-modal-description"
            >
              Add, replace, or remove team owners.
            </Dialog.Description>
            <div className="mt-5">
              {ownerManagementContent}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground"
                onClick={() => setActiveDialog(null)}
                type="button"
              >
                Close
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
            ? extractErrorMessage(updateTeamIconMutation.error)
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
        onSave={() => void handleSaveTeamIcon()}
        onSelect={setIconDraftKey}
        open={iconModalOpen}
        optionTestIdPrefix="my-team-icon"
        options={TEAM_ICON_OPTIONS}
        paletteTestId="my-team-icon-palette"
        renderOptionIcon={(icon) => (
          <div className={`mx-auto flex h-9 w-9 items-center justify-center rounded-full ${icon.surfaceClass} ${icon.accentClass}`}>
            <TeamIcon iconKey={icon.key} size="md" />
          </div>
        )}
        renderSelectedIcon={() => (
          <div className={`flex h-16 w-16 items-center justify-center rounded-[1.25rem] ${draftIcon.surfaceClass} ${draftIcon.accentClass}`}>
            <TeamIcon iconKey={iconDraftKey} size="lg" />
          </div>
        )}
        saveTestId="my-team-save-icon"
        selectedLabel={draftIcon.label}
        title="Change team icon"
        value={iconDraftKey}
      />
    </section>
  );
}
