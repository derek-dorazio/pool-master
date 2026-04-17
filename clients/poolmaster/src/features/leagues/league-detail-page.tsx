import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  changeMemberRole,
  generateInviteLink,
  getLeagueByCode,
  leaveLeague,
  listContests,
  listLeagueMembers,
  removeMember,
  sendLeagueInvitations,
  type ChangeMemberRoleResponses,
  type GetLeagueResponses,
  type LeaveLeagueResponses,
  type ListContestsResponses,
  type ListLeagueMembersResponses,
  type RemoveMemberResponses,
} from '@/lib/api';
import { formatUserName } from '@/features/account/user-name';
import { useAuth } from '@/features/auth/auth-provider';
import { LeagueIcon } from './league-icon';
import { buildInvitePath, buildLeagueTeamPath, buildLeagueTeamsPath, setRecentLeagueCode } from './league-routing';

type LeagueDetail = GetLeagueResponses[200]['league'];
type LeagueMember = ListLeagueMembersResponses[200]['members'][number];
type ContestSummary = ListContestsResponses[200]['contests'][number];
type ChangeRoleResponse = ChangeMemberRoleResponses[200]['membership'];
type RemoveMemberResponse = RemoveMemberResponses[200];
type LeaveLeagueResponse = LeaveLeagueResponses[200];

function formatRole(role: string | undefined) {
  if (!role) {
    return 'Member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

function formatJoinedAt(value: string | undefined) {
  if (!value) {
    return 'Joined recently';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Joined recently';
  }

  return `Joined ${parsed.toLocaleDateString()}`;
}

function extractErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    code?: unknown;
    error?: { code?: unknown; message?: unknown };
    message?: unknown;
  };

  if (
    candidate.code === 'LEAGUE_LAST_COMMISSIONER_REQUIRED' ||
    candidate.error?.code === 'LEAGUE_LAST_COMMISSIONER_REQUIRED'
  ) {
    return 'Appoint another commissioner before the last commissioner leaves or steps down.';
  }

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

export function LeagueDetailPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const auth = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [memberActionError, setMemberActionError] = useState<string | null>(null);
  const [leaveActionError, setLeaveActionError] = useState<string | null>(null);

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

  const leagueId = leagueQuery.data?.id ?? '';

  const membersQuery = useQuery({
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

  const changeRoleMutation = useMutation({
    mutationFn: async ({
      targetUserId,
      role,
    }: {
      targetUserId: string;
      role: 'COMMISSIONER' | 'MEMBER';
    }): Promise<ChangeRoleResponse> => {
      const response = await changeMemberRole({
        path: { id: leagueId, uid: targetUserId },
        body: { role },
      });

      if (!response.data?.membership) {
        throw response.error ?? new Error('Role update response is missing data.');
      }

      return response.data.membership;
    },
    onSuccess: async () => {
      setMemberActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-members', leagueId] });
    },
    onError: (error) => {
      setMemberActionError(
        extractErrorMessage(error, 'We could not update that league role right now.'),
      );
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (targetUserId: string): Promise<RemoveMemberResponse> => {
      const response = await removeMember({
        path: { id: leagueId, uid: targetUserId },
      });

      if (!response.data) {
        throw response.error ?? new Error('Member removal response is missing data.');
      }

      return response.data;
    },
    onSuccess: async () => {
      setMemberActionError(null);
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league', leagueCode] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-members', leagueId] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
    },
    onError: (error) => {
      setMemberActionError(
        extractErrorMessage(error, 'We could not remove that member right now.'),
      );
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
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'leagues'] });
      await queryClient.invalidateQueries({ queryKey: ['poolmaster', 'league-members', leagueId] });
      void navigate('/welcome');
    },
    onError: (error) => {
      setLeaveActionError(
        extractErrorMessage(error, 'We could not complete that leave request right now.'),
      );
    },
  });

  const isCommissioner = leagueQuery.data?.role === 'COMMISSIONER';
  const isInactiveLeague = leagueQuery.data?.isActive === false;
  const currentUserId = auth.user?.id;
  const activeCommissionerCount =
    membersQuery.data?.filter((member) => member.role === 'COMMISSIONER').length ?? 0;

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

  async function handlePromoteMember(member: LeagueMember) {
    setMemberActionError(null);
    try {
      await changeRoleMutation.mutateAsync({
        targetUserId: member.userId,
        role: 'COMMISSIONER',
      });
    } catch {
      // Error state is handled by the mutation onError callback.
    }
  }

  async function handleDemoteMember(member: LeagueMember) {
    setMemberActionError(null);
    try {
      await changeRoleMutation.mutateAsync({
        targetUserId: member.userId,
        role: 'MEMBER',
      });
    } catch {
      // Error state is handled by the mutation onError callback.
    }
  }

  async function handleRemoveMember(member: LeagueMember) {
    setMemberActionError(null);
    try {
      await removeMemberMutation.mutateAsync(member.userId);
    } catch {
      // Error state is handled by the mutation onError callback.
    }
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
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">We couldn&apos;t load this league.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Use the league selector in the header to switch to one of your active leagues, or return
          to your welcome page and try again.
        </p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/welcome">
          Back to welcome
        </Link>
      </section>
    );
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
            The league home stays available in read-only mode so members can still review the
            league context. Commissioner actions are disabled while this league remains inactive.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {isCommissioner ? (
              <button
                className="rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="league-reactivate"
                disabled
                title="Reactivation and renewal tools will be added in a later slice."
                type="button"
              >
                Reactivate league
              </button>
            ) : (
              <button
                className="rounded-2xl border border-amber-300 bg-white px-4 py-3 text-sm font-medium text-amber-950 disabled:cursor-not-allowed disabled:opacity-70"
                data-testid="league-message-commissioner"
                disabled
                title="Commissioner messaging will be added in a later slice."
                type="button"
              >
                Message commissioner
              </button>
            )}
            <p className="text-xs text-amber-900/80">
              Renewal, reactivation, and notification flows are planned separately.
            </p>
          </div>
        </div>
      ) : null}

      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {formatRole(leagueQuery.data.role)}
            </span>
            <div className="flex items-start gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[1.5rem] bg-primary/10 text-primary">
                <LeagueIcon iconKey={leagueQuery.data.iconKey} size="lg" />
              </div>
              <div>
              <h2 className="text-3xl font-semibold tracking-tight">{leagueQuery.data.name}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {leagueQuery.data.description?.trim() ||
                  'This league is ready for contests, squads, standings, and commissioner workflows in the rebuilt PoolMaster app.'}
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
            <div className="rounded-2xl bg-background px-4 py-4">
              <div>Join policy</div>
              <div className="mt-1 font-semibold text-foreground">{leagueQuery.data.joinPolicy}</div>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <div>Lifecycle</div>
              <div className="mt-1 font-semibold text-foreground">
                {leagueQuery.data.isActive ? 'Active' : 'Inactive'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="text-xl font-semibold">Members</h3>
              <p className="text-sm text-muted-foreground">
                The rebuilt member area stays connected to current membership roles and lifecycle
                state from the backend.
              </p>
            </div>
            <Link className="text-sm font-medium text-primary hover:underline" to="/my-leagues">
              My leagues
            </Link>
          </div>

          <div className="mt-5 space-y-3">
            {membersQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading members...</p>
            ) : membersQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load members for this league.
              </p>
            ) : (
              <>
                {memberActionError ? (
                  <div
                    className="rounded-2xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
                    data-testid="league-member-action-error"
                  >
                    {memberActionError}
                  </div>
                ) : null}
                {membersQuery.data?.map((member) => {
                  const isCurrentMember = member.userId === currentUserId;
                  const canManageMember =
                    isCommissioner && !isCurrentMember && !isInactiveLeague && !changeRoleMutation.isPending && !removeMemberMutation.isPending;

                  return (
                    <div
                      className="flex flex-col gap-4 rounded-2xl border border-border bg-background px-4 py-4 lg:flex-row lg:items-center lg:justify-between"
                      data-testid={`league-member-${member.id}`}
                      key={member.id}
                    >
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="font-medium">
                            {formatUserName(member.firstName, member.lastName)}
                          </div>
                          {isCurrentMember ? (
                            <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                              You
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-sm text-muted-foreground">{member.email}</div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {formatJoinedAt(member.joinedAt)}
                        </div>
                      </div>
                      <div className="flex flex-col items-start gap-3 lg:items-end">
                        <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                          {formatRole(member.role)}
                        </span>
                        {canManageMember ? (
                          <div className="flex flex-wrap gap-2">
                            {member.role === 'MEMBER' ? (
                              <button
                                className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid={`league-member-promote-${member.id}`}
                                disabled={changeRoleMutation.isPending}
                                onClick={() => void handlePromoteMember(member)}
                                type="button"
                              >
                                Make commissioner
                              </button>
                            ) : (
                              <button
                                className="rounded-2xl border border-border px-3 py-2 text-sm font-medium text-foreground hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
                                data-testid={`league-member-demote-${member.id}`}
                                disabled={changeRoleMutation.isPending}
                                onClick={() => void handleDemoteMember(member)}
                                type="button"
                              >
                                Change to member
                              </button>
                            )}
                            <button
                              className="rounded-2xl border border-destructive/30 px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/5 disabled:cursor-not-allowed disabled:opacity-60"
                              data-testid={`league-member-remove-${member.id}`}
                              disabled={removeMemberMutation.isPending}
                              onClick={() => void handleRemoveMember(member)}
                              type="button"
                            >
                              Remove member
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">My Team</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Team identity lives in league context. Create or manage your team here before
                  icons and ownership controls expand in the next slice.
                </p>
              </div>
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                to={buildLeagueTeamPath(leagueQuery.data.leagueCode)}
              >
                Manage team
              </Link>
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Teams</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  Browse every team in the league and review pending owner invites from one place.
                </p>
              </div>
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground hover:bg-muted/40"
                to={buildLeagueTeamsPath(leagueQuery.data.leagueCode)}
              >
                View teams
              </Link>
            </div>
          </div>

          {!auth.isRootAdmin ? (
            <div className="rounded-[2rem] border border-border bg-card p-6">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-xl font-semibold">Membership actions</h3>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Leaving the league also removes your team from the active league roster. If you are the last commissioner, appoint another commissioner before leaving.
                  </p>
                </div>
                {isCommissioner ? (
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {activeCommissionerCount} commissioner{activeCommissionerCount === 1 ? '' : 's'}
                  </span>
                ) : null}
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
                  <p
                    className="text-sm text-destructive"
                    data-testid="league-leave-error"
                  >
                    {leaveActionError}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <h3 className="text-xl font-semibold">Next build steps</h3>
            <ul className="mt-4 space-y-3 text-sm text-muted-foreground">
              <li>Contest list/detail and standings will hang off this league surface next.</li>
              <li>Commissioner tools will stay in-app with role-aware navigation.</li>
              <li>Invite acceptance already routes through the same member-session model.</li>
            </ul>
          </div>

          {isCommissioner ? (
            <div className="rounded-[2rem] border border-border bg-card p-6">
              <h3 className="text-xl font-semibold">Commissioner invitations</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                {isInactiveLeague
                  ? 'This league is inactive, so invitation actions stay visible but disabled until the league is reactivated.'
                  : 'Generate a shareable invite link or send an invitation email through the current backend invitation flow.'}
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-border bg-background p-4">
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
                  {inviteLinkMutation.isError ? (
                    <p className="mt-2 text-sm text-destructive">
                      We couldn&apos;t generate an invite link right now.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-2xl border border-border bg-background p-4">
                  <label className="block space-y-2">
                    <span className="text-sm font-medium">Invite by email</span>
                    <div className="flex gap-3">
                      <input
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
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
                        {isInactiveLeague
                          ? 'League inactive'
                          : sendInviteMutation.isPending
                            ? 'Sending...'
                            : 'Send'}
                      </button>
                    </div>
                  </label>
                  {sendInviteMutation.isSuccess ? (
                    <p className="mt-2 text-sm text-emerald-700">
                      Invitation sent successfully.
                    </p>
                  ) : null}
                  {sendInviteMutation.isError ? (
                    <p className="mt-2 text-sm text-destructive">
                      We couldn&apos;t send that invitation right now.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          <div className="rounded-[2rem] border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 className="text-xl font-semibold">Contests</h3>
                <p className="text-sm text-muted-foreground">
                  League contests now route into the rebuilt contest detail surface instead of the
                  old frontend stack.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {contestsQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading contests...</p>
              ) : contestsQuery.isError ? (
                <p className="text-sm text-muted-foreground">
                  We couldn&apos;t load contests for this league.
                </p>
              ) : contestsQuery.data?.length ? (
                contestsQuery.data.map((contest) => (
                  <Link
                    className="block rounded-2xl border border-border bg-background px-4 py-4 transition hover:border-primary/40"
                    key={contest.id}
                    state={{ leagueCode: leagueQuery.data.leagueCode }}
                    to={`/contests/${contest.id}`}
                  >
                    <div className="flex items-center justify-between gap-4">
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
                  No contests exist for this league yet.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
