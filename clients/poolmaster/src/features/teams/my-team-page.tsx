import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { TeamIconKey } from '@poolmaster/shared/domain';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  createSquadOwnerInvitation,
  createLeagueSquad,
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
import { buildUserPath } from '@/features/account/user-routing';
import { formatUserName } from '@/features/account/user-name';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import {
  buildLeagueEntriesPath,
  buildLeagueHistoryPath,
  buildLeaguePath,
  setRecentLeagueCode,
} from '@/features/leagues/league-routing';
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

function extractErrorMessage(error: unknown): string {
  if (!error || typeof error !== 'object') {
    return 'We could not complete that team action. Please try again.';
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return 'We could not complete that team action. Please try again.';
}

export function MyTeamPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const auth = useAuth();
  const queryClient = useQueryClient();
  const logger = useLogger().child({
    feature: 'my-team-page',
  });
  const [teamName, setTeamName] = useState('');
  const [selectedIconKey, setSelectedIconKey] = useState<TeamIconKey>(TeamIconKey.CAPTAIN_SMILE_FIELD);
  const [coOwnerEmail, setCoOwnerEmail] = useState('');
  const [teamInactivationNotice, setTeamInactivationNotice] = useState<string | null>(null);
  const [replaceTargetUserId, setReplaceTargetUserId] = useState<string | null>(null);
  const [replaceEmail, setReplaceEmail] = useState('');

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
    if (!auth.user?.id) {
      return null;
    }

    return teamsQuery.data?.find((team) =>
      team.members?.some(
        (member) => member.userId === auth.user?.id && member.status === 'ACTIVE',
      ),
    ) ?? null;
  }, [auth.user?.id, teamsQuery.data]);

  const requestedTeamId = searchParams.get('teamId');
  const selectedTeam = useMemo(() => {
    if ((leagueQuery.data?.role === 'COMMISSIONER' || auth.user?.isRootAdmin === true) && requestedTeamId) {
      return teamsQuery.data?.find((team) => team.id === requestedTeamId) ?? myTeam;
    }

    return myTeam;
  }, [auth.user?.isRootAdmin, leagueQuery.data?.role, myTeam, requestedTeamId, teamsQuery.data]);

  const leagueMembersByUserId = useMemo(
    () => new Map((leagueMembersQuery.data ?? []).map((member) => [member.userId, member])),
    [leagueMembersQuery.data],
  );

  useEffect(() => {
    if (selectedTeam) {
      setTeamName(selectedTeam.name);
      setSelectedIconKey(selectedTeam.iconKey);
      setTeamInactivationNotice(null);
      return;
    }

    setTeamName(buildDefaultTeamName(auth.user?.firstName, auth.user?.lastName));
    setSelectedIconKey(TeamIconKey.CAPTAIN_SMILE_FIELD);
    setTeamInactivationNotice(null);
  }, [auth.user?.firstName, auth.user?.lastName, selectedTeam]);

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
      setSelectedIconKey(team.iconKey);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
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
      setSelectedIconKey(team.iconKey);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-teams', leagueId] });
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

  async function handleSaveTeam() {
    const nextTeamName = teamName.trim();
    if (!nextTeamName || !leagueId || leagueQuery.data?.isActive === false) {
      return;
    }

    if (selectedTeam) {
      await updateTeamMutation.mutateAsync({
        teamId: selectedTeam.id,
        nextTeamName,
        nextIconKey: selectedIconKey,
      });
      return;
    }

    await createTeamMutation.mutateAsync({ nextTeamName, nextIconKey: selectedIconKey });
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
  const isCommissioner = leagueQuery.data.role === 'COMMISSIONER' || auth.user?.isRootAdmin === true;
  const isBusy =
    createTeamMutation.isPending
    || updateTeamMutation.isPending
    || createOwnerInvitationMutation.isPending
    || replaceOwnerMutation.isPending
    || revokeOwnerInvitationMutation.isPending
    || inactivateTeamMutation.isPending;
  const activeMembers = (selectedTeam?.members ?? []).filter((member) => member.status === 'ACTIVE');
  const selectedIcon = getTeamIconOption(selectedIconKey);
  const teamOwnerInvitations = ownerInvitationsQuery.data?.filter(
    (invitation) => invitation.squadId === selectedTeam?.id,
  ) ?? [];

  return (
    <section className="space-y-6" data-testid="my-team-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`flex h-16 w-16 items-center justify-center rounded-[1.4rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
              <TeamIcon iconKey={selectedIconKey} size="lg" />
            </div>
            <div>
              <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
                {isCommissioner && selectedTeam && selectedTeam.id !== myTeam?.id ? 'Commissioner team view' : 'Team'}
              </span>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">
                {selectedTeam ? selectedTeam.name : 'Create your team'}
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {isCommissioner && selectedTeam && selectedTeam.id !== myTeam?.id
                  ? 'Commissioners and root admins can use this same team surface to review and update any team in the league.'
                  : 'Team identity lives inside the league context. This slice adds the built-in icon catalog so your Team can look distinct before owner controls expand.'}
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

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">{selectedTeam ? 'Team details' : 'Create your team'}</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            {selectedTeam
              ? 'You can update your team name and choose a built-in icon here.'
              : 'A team is required for league participation. Start with a name and icon that feel right for your group.'}
          </p>

          <div className="mt-5 space-y-4">
            <label className="block space-y-2">
              <span className="text-sm font-medium text-foreground">Team name</span>
              <input
                className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="my-team-name"
                disabled={isInactiveLeague || isBusy}
                maxLength={100}
                onChange={(event) => setTeamName(event.target.value)}
                value={teamName}
              />
            </label>

            <div className="space-y-3">
              <div className="text-sm font-medium text-foreground">Team icon</div>
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-background px-4 py-4">
                <div className={`flex h-14 w-14 items-center justify-center rounded-[1rem] ${selectedIcon.surfaceClass} ${selectedIcon.accentClass}`}>
                  <TeamIcon iconKey={selectedIconKey} size="lg" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Selected icon
                  </div>
                  <div className="mt-1 text-base font-medium">{selectedIcon.label}</div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-5">
                {TEAM_ICON_OPTIONS.map((icon) => {
                  const isSelected = selectedIconKey === icon.key;
                  return (
                    <button
                      className={`rounded-[1.1rem] border px-3 py-4 text-center transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-background text-muted-foreground hover:bg-muted/40'
                      }`}
                      data-testid={`my-team-icon-${icon.key}`}
                      disabled={isInactiveLeague || isBusy}
                      key={icon.key}
                      onClick={() => setSelectedIconKey(icon.key)}
                      type="button"
                    >
                      <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-full ${icon.surfaceClass} ${icon.accentClass}`}>
                        <TeamIcon iconKey={icon.key} size="md" />
                      </div>
                      <div className="mt-3 text-xs font-medium">{icon.label}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <button
              className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="my-team-save"
              disabled={!teamName.trim() || isInactiveLeague || isBusy}
              onClick={() => void handleSaveTeam()}
              type="button"
            >
              {isBusy
                ? 'Saving...'
                : selectedTeam
                  ? 'Save team'
                  : 'Create team'}
            </button>

            {createTeamMutation.isSuccess && !selectedTeam ? (
              <p className="text-sm text-emerald-700">Your team was created.</p>
            ) : null}
            {updateTeamMutation.isSuccess ? (
              <p className="text-sm text-emerald-700">Your team was updated.</p>
            ) : null}
            {createTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(createTeamMutation.error)}</p>
            ) : null}
            {updateTeamMutation.isError ? (
              <p className="text-sm text-destructive">{extractErrorMessage(updateTeamMutation.error)}</p>
            ) : null}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Active entry management</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Active entry creation and rename actions now live on the dedicated My Entries page,
              and historical results now live on the dedicated My Contest History page. Team Home
              stays focused on team identity, owners, and lifecycle.
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Link
                className="inline-flex rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
                data-testid="my-team-open-my-entries"
                to={buildLeagueEntriesPath(leagueCode)}
              >
                Open My Entries
              </Link>
              <Link
                className="inline-flex rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/40"
                data-testid="my-team-open-my-history"
                to={buildLeagueHistoryPath(leagueCode)}
              >
                Open My Contest History
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Active team members</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Teams support one or more owners. Add co-owners by email, replace an existing owner,
              or remove an owner when the backend rules allow it.
            </p>

            {selectedTeam ? (
              <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-4">
                <h4 className="text-sm font-semibold text-foreground">Add co-owner</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  Invite another person to co-manage this team. Existing league members are rejected automatically.
                </p>
                <div className="mt-4 flex gap-3">
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="my-team-owner-email"
                    disabled={isInactiveLeague || isBusy}
                    onChange={(event) => setCoOwnerEmail(event.target.value)}
                    placeholder="owner@example.com"
                    type="email"
                    value={coOwnerEmail}
                  />
                  <button
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-team-owner-invite"
                    disabled={isInactiveLeague || isBusy || !coOwnerEmail.trim()}
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

            <div className="mt-5 space-y-3">
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
                        canManageLeagueRole={isCommissioner}
                        canRemoveOwner={
                          isCommissioner
                          || activeMembers.some((owner) => owner.userId === auth.user?.id)
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
                          disabled={isInactiveLeague || isBusy}
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
              <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-4">
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
                          disabled={isInactiveLeague || isBusy}
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
              <div className="mt-6 rounded-[1.5rem] border border-border bg-background p-4">
                <h4 className="text-sm font-semibold text-foreground">Replace owner</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  Replacing an owner inactivates the selected current owner and starts the owner-invite flow for the replacement email.
                </p>
                <div className="mt-4 flex gap-3">
                  <input
                    className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="my-team-replace-email"
                    disabled={isInactiveLeague || isBusy}
                    onChange={(event) => setReplaceEmail(event.target.value)}
                    placeholder="replacement@example.com"
                    type="email"
                    value={replaceEmail}
                  />
                  <button
                    className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="my-team-replace-submit"
                    disabled={isInactiveLeague || isBusy || !replaceEmail.trim()}
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
              <p className="mt-4 text-sm text-destructive">{extractErrorMessage(revokeOwnerInvitationMutation.error)}</p>
            ) : null}
            {teamInactivationNotice ? (
              <p className="mt-4 text-sm text-emerald-700">{teamInactivationNotice}</p>
            ) : null}
            {inactivateTeamMutation.isError ? (
              <p className="mt-4 text-sm text-destructive">{extractErrorMessage(inactivateTeamMutation.error)}</p>
            ) : null}
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Team lifecycle</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Inactivating a team preserves its history, removes its active owners from the league, and inactivates any affected users who no longer belong to any other active leagues.
            </p>
            <button
              className="mt-4 rounded-2xl border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm font-medium text-destructive disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="my-team-inactivate"
              disabled={!selectedTeam || isInactiveLeague || isBusy}
              onClick={() => void inactivateTeamMutation.mutateAsync()}
              type="button"
            >
              {inactivateTeamMutation.isPending ? 'Inactivating...' : 'Inactivate team'}
            </button>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>Commissioner and owner tooling share the same team page so the surface stays honest and small.</li>
              <li>League home and Teams keep this page easy to reach as team management grows.</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
