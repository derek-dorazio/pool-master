import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import {
  deleteLeague,
  generateInviteLink,
  getLeagueByCode,
  inactivateLeague,
  leaveLeague,
  listContests,
  listLeagueSquads,
  sendLeagueInvitations,
  updateLeagueDetails,
  updateLeagueIcon,
  type GetLeagueResponses,
  type LeaveLeagueResponses,
  type ListContestsResponses,
  type ListLeagueSquadsResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { extractErrorMessage as extractSharedErrorMessage } from '@/lib/errors';
import { useLogger } from '@/lib/logger';
import { removeLeagueSummary, syncLeagueCaches, type LeagueSummary } from './league-cache';
import { getLeagueIconOption, LEAGUE_ICON_OPTIONS } from './league-icon-catalog';
import { LeagueIcon } from './league-icon';
import { getLeagueLoadErrorCopy } from './league-load-error';
import {
  buildInvitePath,
  buildLeagueContestCreatePath,
  buildLeagueContestsManagePath,
  buildLeagueContestPath,
  buildLeagueTeamHomePath,
  buildLeagueTeamsPath,
  setRecentLeagueCode,
} from './league-routing';

type LeagueDetail = GetLeagueResponses[200]['league'];
type ContestSummary = ListContestsResponses[200]['contests'][number];
type TeamSummary = ListLeagueSquadsResponses[200]['squads'][number];
type LeaveLeagueResponse = LeaveLeagueResponses[200];

function formatRole(role: string | null | undefined) {
  if (!role) {
    return 'Not a member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function isHistoricalContest(status: ContestSummary['status']) {
  return status === 'COMPLETED' || status === 'CANCELLED';
}

function extractErrorMessage(error: unknown, fallback: string) {
  return extractSharedErrorMessage(error, {
    fallback,
    codeMessages: {
      LEAGUE_LAST_COMMISSIONER_REQUIRED:
        'Appoint another commissioner before the last commissioner leaves or steps down.',
    },
  });
}

export function LeagueDetailPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const logger = useLogger().child({
    feature: 'league-detail-page',
  });
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [leaveActionError, setLeaveActionError] = useState<string | null>(null);
  const [detailsName, setDetailsName] = useState('');
  const [detailsDescription, setDetailsDescription] = useState('');
  const [iconModalOpen, setIconModalOpen] = useState(false);
  const [selectedIconKey, setSelectedIconKey] = useState<LeagueDetail['iconKey']>('TROPHY');
  const [iconDraftKey, setIconDraftKey] = useState<LeagueDetail['iconKey']>('TROPHY');
  const [deleteConfirmation, setDeleteConfirmation] = useState('');

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
    if (!leagueQuery.data) {
      return;
    }

    setDetailsName(leagueQuery.data.name);
    setDetailsDescription(leagueQuery.data.description ?? '');
    setSelectedIconKey(leagueQuery.data.iconKey);
    setIconDraftKey(leagueQuery.data.iconKey);
  }, [leagueQuery.data]);

  useEffect(() => {
    if (!leagueQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'leagueDetail.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'League detail page failed to load league context',
    );
  }, [leagueCode, leagueQuery.error, leagueQuery.isError, logger]);

  const leagueId = leagueQuery.data?.id ?? '';

  const contestsQuery = useQuery({
    queryKey: ['poolmaster', 'league-contests', leagueId],
    queryFn: async (): Promise<ContestSummary[]> => {
      const response = await listContests({ path: { id: leagueId } });

      if (!response.data?.contests) {
        throw response.error ?? new Error('Contest list response is missing data.');
      }

      return response.data.contests;
    },
    enabled: Boolean(leagueId),
    retry: false,
  });

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

  const canManageLeague =
    leagueQuery.data?.leagueRelationship.commissioner === true || leagueQuery.data?.isRootAdmin === true;
  const isInactiveLeague = leagueQuery.data?.isActive === false;
  const currentUserId = auth.user?.id;
  const selectedLeagueIcon = getLeagueIconOption(selectedIconKey);
  const draftLeagueIcon = getLeagueIconOption(iconDraftKey);

  const myTeam = useMemo(() => {
    if (!currentUserId) {
      return null;
    }

    return teamsQuery.data?.find((team) =>
      team.members?.some((member) => member.userId === currentUserId && member.status === 'ACTIVE'),
    ) ?? null;
  }, [currentUserId, teamsQuery.data]);

  // pool-master-dxd.13.2 — League Home renders a thin contest list. Per-contest
  // entry detail lives on the Contest Board (open the contest from a card).
  const activeContests = useMemo(
    () => (contestsQuery.data ?? []).filter((contest) => !isHistoricalContest(contest.status)),
    [contestsQuery.data],
  );
  const historicalContests = useMemo(
    () => (contestsQuery.data ?? []).filter((contest) => isHistoricalContest(contest.status)),
    [contestsQuery.data],
  );

  const inviteLinkMutation = useMutation({
    mutationFn: async (): Promise<string> => {
      const response = await generateInviteLink({
        path: { id: leagueId },
        body: {},
      });

      const inviteCode = response.data?.invitation?.inviteCode;
      if (!inviteCode) {
        throw response.error ?? new Error('Invite link generation did not return an invite code.');
      }

      return `${window.location.origin}${buildInvitePath(inviteCode)}`;
    },
  });

  const sendInviteMutation = useMutation({
    mutationFn: async (email: string) => {
      const response = await sendLeagueInvitations({
        path: { id: leagueId },
        body: {
          emails: [email],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Invitation send response is missing data.');
      }

      return response.data;
    },
  });

  const updateDetailsMutation = useMutation({
    mutationFn: async () => {
      const response = await updateLeagueDetails({
        path: { id: leagueId },
        body: {
          name: detailsName.trim(),
          ...(detailsDescription.trim() ? { description: detailsDescription.trim() } : {}),
        },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League details update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      setDetailsName(league.name);
      setDetailsDescription(league.description ?? '');
      syncLeagueCaches(queryClient, league);
    },
  });

  const updateIconMutation = useMutation({
    mutationFn: async (iconKey: LeagueDetail['iconKey']) => {
      const response = await updateLeagueIcon({
        path: { id: leagueId },
        body: { iconKey },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League icon update response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async (league) => {
      setSelectedIconKey(league.iconKey);
      setIconDraftKey(league.iconKey);
      setIconModalOpen(false);
      syncLeagueCaches(queryClient, league);
    },
  });

  const inactivateLeagueMutation = useMutation({
    mutationFn: async () => {
      const response = await inactivateLeague({
        path: { id: leagueId },
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League inactivation response is missing data.');
      }

      return response.data.league;
    },
    onSuccess: async () => {
      if (leagueQuery.data) {
        syncLeagueCaches(
          queryClient,
          {
            ...leagueQuery.data,
            isActive: false,
          },
        );
      }
    },
  });

  const deleteLeagueMutation = useMutation({
    mutationFn: async () => {
      if (!leagueQuery.data) {
        throw new Error('League detail response is missing data.');
      }

      const response = await deleteLeague({
        path: { id: leagueId },
        body: { leagueCode: leagueQuery.data.leagueCode },
      });

      if (!response.data?.success) {
        throw response.error ?? new Error('League delete response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      queryClient.setQueryData(['poolmaster', 'leagues'], (current: LeagueSummary[] | undefined) =>
        removeLeagueSummary(current, leagueQuery.data?.id ?? ''),
      );
      void navigate('/welcome');
    },
  });

  const leaveLeagueMutation = useMutation({
    mutationFn: async (): Promise<LeaveLeagueResponse> => {
      const response = await leaveLeague({
        path: { id: leagueId },
      });

      if (!response.data) {
        throw response.error ?? new Error('Leave league response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      setLeaveActionError(null);
      queryClient.setQueryData(['poolmaster', 'leagues'], (current: LeagueSummary[] | undefined) =>
        removeLeagueSummary(current, leagueQuery.data?.id ?? ''),
      );
      void navigate('/welcome');
    },
    onError: (error) => {
      setLeaveActionError(
        extractErrorMessage(error, 'We could not complete that leave request right now.'),
      );
    },
  });

  async function handleGenerateInviteLink() {
    if (isInactiveLeague) {
      return;
    }

    const nextLink = await inviteLinkMutation.mutateAsync();
    setInviteLink(nextLink);
  }

  async function handleCopyInviteLink() {
    if (!inviteLink) {
      return;
    }

    try {
      await navigator.clipboard.writeText(inviteLink);
    } catch {
      // Keep the link visible for manual copy when clipboard access is unavailable.
    }
  }

  async function handleSendInvite() {
    const email = inviteEmail.trim();
    if (!email || isInactiveLeague) {
      return;
    }

    await sendInviteMutation.mutateAsync(email);
    setInviteEmail('');
  }

  async function handleLeaveLeague() {
    setLeaveActionError(null);
    try {
      await leaveLeagueMutation.mutateAsync();
    } catch {
      // Error state is handled by the mutation onError callback.
    }
  }

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading league detail...</p>
      </section>
    );
  }

  if (leagueQuery.isError || !leagueQuery.data) {
    const copy = getLeagueLoadErrorCopy(leagueQuery.error);
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">{copy.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{copy.body}</p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/welcome">
          Back to welcome
        </Link>
      </section>
    );
  }

  const canEditLeague = canManageLeague && !isInactiveLeague;
  const canDeleteLeague =
    leagueQuery.data.isRootAdmin
    && isInactiveLeague
    && deleteConfirmation.trim().toUpperCase() === leagueQuery.data.leagueCode;

  function handleOpenIconModal() {
    setIconDraftKey(selectedIconKey);
    setIconModalOpen(true);
  }

  function handleCloseIconModal() {
    if (updateIconMutation.isPending) {
      return;
    }

    setIconDraftKey(selectedIconKey);
    setIconModalOpen(false);
    updateIconMutation.reset();
  }

  return (
    <section className="space-y-6" data-testid="league-home">
      {isInactiveLeague ? (
        <div
          className="rounded-[2rem] border border-amber-300 bg-amber-50 p-6 text-amber-950"
          data-testid="league-inactive-banner"
        >
          <h2 className="text-xl font-semibold">This league is not currently active.</h2>
          <p className="mt-2 text-sm text-amber-900/90">
            League Home stays available in read-only mode while the league is inactive.
            Commissioner edits and invites are disabled until the league is reactivated in a later
            lifecycle slice.
          </p>
        </div>
      ) : null}

      <div className="rounded-[2rem] border border-border bg-card p-8" data-testid="league-summary-tile">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {leagueQuery.data.isRootAdmin ? 'Root Admin' : formatRole(leagueQuery.data.memberType)}
            </span>
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary">
                <LeagueIcon iconKey={leagueQuery.data.iconKey} size="lg" />
              </div>
              <div>
                <h2 className="text-3xl font-semibold tracking-tight">{leagueQuery.data.name}</h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  {leagueQuery.data.description?.trim() ||
                    'This league home is the canonical place for league identity, commissioner controls, and member leave actions.'}
                </p>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
            <div className="rounded-2xl bg-background px-4 py-4">
              <div>Members</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {leagueQuery.data.memberCount}
              </div>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <div>Active contests</div>
              <div className="mt-1 text-2xl font-semibold text-foreground">
                {leagueQuery.data.activeContestCount}
              </div>
            </div>
          </div>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-wrap gap-3">
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
            to={buildLeagueTeamsPath(leagueQuery.data.leagueCode)}
          >
            Open Teams and Owners
          </Link>
          {myTeam ? (
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueTeamHomePath(leagueQuery.data.leagueCode, myTeam.id)}
            >
              Open My Team
            </Link>
          ) : null}
          {canManageLeague && !isInactiveLeague ? (
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueContestsManagePath(leagueQuery.data.leagueCode)}
            >
              Manage Contests
            </Link>
          ) : null}
          {canManageLeague && !isInactiveLeague ? (
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueContestCreatePath(leagueQuery.data.leagueCode)}
            >
              Create Contest
            </Link>
          ) : null}
        </div>
      </section>

      {canManageLeague ? (
        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">League details</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              League Home now owns the commissioner-editable identity fields directly instead of
              sending commissioners to a separate modal.
            </p>

            <div className="mt-5 grid gap-4 rounded-[1.5rem] border border-border bg-background p-5 sm:grid-cols-2">
              <label className="block space-y-2 sm:col-span-2">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  League name
                </span>
                <input
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                  data-testid="league-details-name"
                  disabled={!canEditLeague}
                  onChange={(event) => setDetailsName(event.target.value)}
                  type="text"
                  value={detailsName}
                />
              </label>

              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  League code
                </div>
                <div className="mt-1 font-mono text-base font-medium">{leagueQuery.data.leagueCode}</div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Created
                </div>
                <div className="mt-1 text-base font-medium">
                  {leagueQuery.data.createdAt
                    ? new Date(leagueQuery.data.createdAt).toLocaleDateString()
                  : 'Unknown'}
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-border bg-card p-4 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div
                      className="flex h-14 w-14 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary"
                      data-testid="league-current-icon"
                    >
                      <LeagueIcon iconKey={selectedIconKey} size="lg" />
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                        League icon
                      </div>
                      <div className="mt-1 text-base font-medium" data-testid="league-current-icon-label">
                        {selectedLeagueIcon.label}
                      </div>
                    </div>
                  </div>

                  <button
                    className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                    data-testid="league-change-icon"
                    disabled={!canEditLeague}
                    onClick={handleOpenIconModal}
                    type="button"
                  >
                    Change icon
                  </button>
                </div>
              </div>

              <label className="block space-y-2 sm:col-span-2">
                <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Description
                </span>
                <textarea
                  className="min-h-28 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm outline-none transition focus:border-primary disabled:cursor-not-allowed disabled:opacity-70"
                  data-testid="league-details-description"
                  disabled={!canEditLeague}
                  onChange={(event) => setDetailsDescription(event.target.value)}
                  value={detailsDescription}
                />
              </label>
            </div>

            {updateDetailsMutation.isError ? (
              <p className="mt-4 text-sm text-destructive">
                {extractErrorMessage(updateDetailsMutation.error, 'We could not save league details.')}
              </p>
            ) : null}

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="league-save-details"
                disabled={!canEditLeague || !detailsName.trim()}
                onClick={() => void updateDetailsMutation.mutateAsync()}
                type="button"
              >
                {updateDetailsMutation.isPending ? 'Saving...' : 'Save details'}
              </button>
            </div>
          </section>

          <section className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">League invitations</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Commissioners and root admins can reuse the live invite flows directly from League
              Home.
            </p>

            <div
              className="mt-6 rounded-[1.5rem] border border-border bg-background p-5"
              data-testid="league-invitations-section"
            >
              <h4 className="text-lg font-semibold">Commissioner invitations</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                Generate a shareable invite link or send invitation emails through the current
                backend invitation flow.
              </p>

              <div className="mt-5 rounded-2xl border border-border bg-card p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Join policy
                </div>
                <div className="mt-2 font-semibold text-foreground" data-testid="league-join-policy">
                  {leagueQuery.data.joinPolicy}
                </div>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="league-generate-invite-link"
                      disabled={inviteLinkMutation.isPending || isInactiveLeague}
                      onClick={() => void handleGenerateInviteLink()}
                      type="button"
                    >
                      {isInactiveLeague
                        ? 'League inactive'
                        : inviteLinkMutation.isPending
                          ? 'Generating...'
                          : 'Generate invite link'}
                    </button>
                    <button
                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60"
                      data-testid="league-copy-invite-link"
                      disabled={!inviteLink || isInactiveLeague}
                      onClick={() => void handleCopyInviteLink()}
                      type="button"
                    >
                      Copy link
                    </button>
                  </div>
                  <input
                    className="mt-3 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    data-testid="league-invite-link"
                    disabled={isInactiveLeague}
                    readOnly
                    value={inviteLink}
                  />
                </div>

                <div className="rounded-2xl border border-border bg-card p-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Invite by email</span>
                    <div className="flex gap-3">
                      <input
                        className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                        data-testid="league-invite-email"
                        disabled={isInactiveLeague}
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="member@example.com"
                        type="email"
                        value={inviteEmail}
                      />
                      <button
                        className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid="league-send-invite"
                        disabled={sendInviteMutation.isPending || !inviteEmail.trim() || isInactiveLeague}
                        onClick={() => void handleSendInvite()}
                        type="button"
                      >
                        {sendInviteMutation.isPending ? 'Sending...' : 'Send'}
                      </button>
                    </div>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <section
            className="rounded-[2rem] border border-border bg-card p-6 xl:col-span-2"
            data-testid="league-lifecycle-section"
          >
            <h3 className="text-xl font-semibold">League lifecycle</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Lifecycle stays inline on League Home: commissioners and root admins can inactivate,
              and root admins can permanently delete once the league is inactive.
            </p>

            <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-5">
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                Current status
              </div>
              <div className="mt-2 text-lg font-semibold text-foreground" data-testid="league-lifecycle-status">
                {leagueQuery.data.isActive ? 'Active' : 'Inactive'}
              </div>
            </div>

            <div className="mt-5 grid gap-6 lg:grid-cols-[1fr_1fr]">
              <div className="rounded-[1.5rem] border border-border bg-background p-5">
                <h4 className="text-lg font-semibold">Inactivate league</h4>
                <p className="mt-2 text-sm text-muted-foreground">
                  Inactivation is the normal reversible lifecycle action for a league that is no
                  longer active day to day.
                </p>
                <button
                  className="mt-5 rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="league-inactivate"
                  disabled={isInactiveLeague || inactivateLeagueMutation.isPending}
                  onClick={() => void inactivateLeagueMutation.mutateAsync()}
                  type="button"
                >
                  {isInactiveLeague
                    ? 'League inactive'
                    : inactivateLeagueMutation.isPending
                      ? 'Inactivating...'
                      : 'Inactivate league'}
                </button>
              </div>

              {leagueQuery.data.isRootAdmin ? (
                <div className="rounded-[1.5rem] border border-red-300 bg-red-50/80 p-5">
                  <h4 className="text-lg font-semibold text-red-950">Delete league</h4>
                  <p className="mt-2 text-sm text-red-900">
                    Root admins can permanently delete inactive leagues after confirming the league
                    code. This remains intentionally unavailable while the league is still active.
                  </p>

                  <label className="mt-4 block space-y-2">
                    <span className="text-sm font-medium text-red-950">Confirmation code</span>
                    <input
                      className="w-full rounded-2xl border border-red-200 bg-white px-4 py-3 font-mono text-sm uppercase outline-none transition focus:border-red-500"
                      data-testid="league-delete-confirmation"
                      disabled={!isInactiveLeague || deleteLeagueMutation.isPending}
                      onChange={(event) => setDeleteConfirmation(event.target.value)}
                      placeholder={leagueQuery.data.leagueCode}
                      type="text"
                      value={deleteConfirmation}
                    />
                  </label>

                  <button
                    className="mt-5 rounded-2xl bg-red-700 px-4 py-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-red-300"
                    data-testid="league-delete-submit"
                    disabled={!canDeleteLeague || deleteLeagueMutation.isPending}
                    onClick={() => void deleteLeagueMutation.mutateAsync()}
                    type="button"
                  >
                    {deleteLeagueMutation.isPending ? 'Deleting...' : 'Delete league'}
                  </button>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      {!leagueQuery.data.isRootAdmin ? (
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Membership actions</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Leaving the league removes your membership from the active roster. If you are the
                last commissioner, appoint another commissioner before leaving.
              </p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <button
              className="rounded-2xl border border-destructive/30 px-4 py-3 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-60"
              data-testid="league-leave"
              disabled={leaveLeagueMutation.isPending || isInactiveLeague}
              onClick={() => void handleLeaveLeague()}
              type="button"
            >
              {leaveLeagueMutation.isPending ? 'Leaving...' : 'Leave league'}
            </button>
            {leaveActionError ? (
              <p className="text-sm text-destructive" data-testid="league-leave-error">
                {leaveActionError}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      <Dialog.Root
        onOpenChange={(open) => {
          if (open) {
            handleOpenIconModal();
            return;
          }

          handleCloseIconModal();
        }}
        open={iconModalOpen}
      >
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
          <Dialog.Content
            aria-describedby="league-icon-modal-description"
            className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 rounded-[2rem] border border-border bg-card p-6 shadow-2xl"
            data-testid="league-icon-modal"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <Dialog.Title className="text-2xl font-semibold tracking-tight">
                  Change league icon
                </Dialog.Title>
                <Dialog.Description
                  className="mt-2 text-sm text-muted-foreground"
                  id="league-icon-modal-description"
                >
                  Pick a built-in icon and save it without leaving League Home.
                </Dialog.Description>
              </div>
              <button
                aria-label="Close league icon modal"
                className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-70"
                disabled={updateIconMutation.isPending}
                onClick={handleCloseIconModal}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="mt-5 rounded-[1.5rem] border border-border bg-background p-5">
              <div className="flex items-center gap-4 rounded-[1.25rem] border border-border bg-card px-4 py-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[1.25rem] bg-primary/10 text-primary">
                  <LeagueIcon iconKey={iconDraftKey} size="lg" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Selected icon
                  </div>
                  <div className="mt-1 text-base font-medium">{draftLeagueIcon.label}</div>
                </div>
              </div>

              <div className="mt-5 grid gap-3 sm:grid-cols-4">
                {LEAGUE_ICON_OPTIONS.map((icon) => {
                  const isSelected = iconDraftKey === icon.key;
                  return (
                    <button
                      className={`rounded-[1.25rem] border px-3 py-4 text-center transition ${
                        isSelected
                          ? 'border-primary bg-primary/10 text-foreground'
                          : 'border-border bg-card text-muted-foreground hover:bg-muted/40'
                      }`}
                      data-testid={`league-icon-${icon.key}`}
                      disabled={!canEditLeague}
                      key={icon.key}
                      onClick={() => setIconDraftKey(icon.key)}
                      type="button"
                    >
                      <div className="flex justify-center text-primary">
                        <LeagueIcon iconKey={icon.key} size="md" />
                      </div>
                      <div className="mt-3 text-xs font-medium">{icon.label}</div>
                    </button>
                  );
                })}
              </div>

              {updateIconMutation.isError ? (
                <p className="mt-4 text-sm text-destructive">
                  {extractErrorMessage(updateIconMutation.error, 'We could not save the league icon.')}
                </p>
              ) : null}

              <div className="mt-5 flex justify-end gap-3">
                <button
                  className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={updateIconMutation.isPending}
                  onClick={handleCloseIconModal}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  data-testid="league-save-icon"
                  disabled={!canEditLeague}
                  onClick={() => void updateIconMutation.mutateAsync(iconDraftKey)}
                  type="button"
                >
                  {updateIconMutation.isPending ? 'Saving...' : 'Save icon'}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <div className="rounded-[2rem] border border-border bg-card p-6" id="league-contests">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Contests</h3>
            <p className="text-sm text-muted-foreground">
              Open a contest to view its leaderboard, manage your entries, and see picks once
              the event has started.
            </p>
          </div>
          {canManageLeague && !isInactiveLeague ? (
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
              to={buildLeagueContestsManagePath(leagueQuery.data.leagueCode)}
            >
              Manage Contests
            </Link>
          ) : null}
        </div>

        <div className="mt-5 space-y-3">
          {contestsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading contests...</p>
          ) : contestsQuery.isError ? (
            <p className="text-sm text-muted-foreground">We couldn&apos;t load contests for this league.</p>
          ) : activeContests.length ? (
            activeContests.map((contest: ContestSummary) => (
              <Link
                className="block rounded-2xl border border-border bg-background px-4 py-4 transition hover:border-primary/40 hover:bg-card"
                data-testid={`league-contest-${contest.id}`}
                key={contest.id}
                state={{ leagueCode: leagueQuery.data.leagueCode }}
                to={buildLeagueContestPath(leagueQuery.data.leagueCode, contest.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{contest.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {contest.selectionType} · {contest.scoringEngine}
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{contest.status}</div>
                    <div>{contest.entryCount ?? 0} entries</div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No active contests are available for this league yet.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6" id="league-history">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-xl font-semibold">Completed contest history</h3>
            <p className="text-sm text-muted-foreground">
              Open a completed contest to view final standings and revealed picks.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {contestsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading completed contests...</p>
          ) : contestsQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load completed contests for this league.
            </p>
          ) : historicalContests.length ? (
            historicalContests.map((contest: ContestSummary) => (
              <Link
                className="block rounded-2xl border border-border bg-background px-4 py-4 transition hover:border-primary/40 hover:bg-card"
                data-testid={`league-history-contest-${contest.id}`}
                key={contest.id}
                state={{ leagueCode: leagueQuery.data.leagueCode }}
                to={buildLeagueContestPath(leagueQuery.data.leagueCode, contest.id)}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="font-medium">{contest.name}</div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {contest.sport} · {contest.selectionType} · {contest.status}
                    </div>
                  </div>
                  <div className="text-right text-sm text-muted-foreground">
                    <div>{contest.entryCount ?? 0} entries</div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              This league does not have any completed contests yet.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
