import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import {
  generateInviteLink,
  getLeagueByCode,
  listContests,
  listLeagueMembers,
  sendLeagueInvitations,
  type GetLeagueResponses,
  type ListContestsResponses,
  type ListLeagueMembersResponses,
} from '@/lib/api';
import { buildInvitePath, setRecentLeagueCode } from './league-routing';

type LeagueDetail = GetLeagueResponses[200]['league'];
type LeagueMember = ListLeagueMembersResponses[200]['members'][number];
type ContestSummary = ListContestsResponses[200]['contests'][number];

function formatRole(role: string | undefined) {
  if (!role) {
    return 'Member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function LeagueDetailPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');

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

  const isCommissioner = leagueQuery.data?.role === 'COMMISSIONER';

  async function handleGenerateInviteLink() {
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
    if (!email) {
      return;
    }

    await sendInviteMutation.mutateAsync(email);
    setInviteEmail('');
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
          This league is no longer active. Use the league selector in the header to switch to one
          of your other active leagues.
        </p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/welcome">
          Back to welcome
        </Link>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {formatRole(leagueQuery.data.role)}
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{leagueQuery.data.name}</h2>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                {leagueQuery.data.description?.trim() ||
                  'This league is ready for contests, squads, standings, and commissioner workflows in the rebuilt PoolMaster app.'}
              </p>
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
              <div>Visibility</div>
              <div className="mt-1 font-semibold text-foreground">{leagueQuery.data.visibility}</div>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <div>Invite policy</div>
              <div className="mt-1 font-semibold text-foreground">
                {leagueQuery.data.invitePolicy || 'Not set'}
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
            <Link className="text-sm font-medium text-primary hover:underline" to="/welcome">
              Welcome
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
              membersQuery.data?.map((member) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-4"
                  key={member.id}
                >
                  <div>
                    <div className="font-medium">{member.displayName}</div>
                    <div className="text-sm text-muted-foreground">{member.userId}</div>
                  </div>
                  <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                    {formatRole(member.role)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-6">
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
                Generate a shareable invite link or send an invitation email through the current
                backend invitation flow.
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-border bg-background p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                      disabled={inviteLinkMutation.isPending}
                      onClick={() => void handleGenerateInviteLink()}
                      type="button"
                    >
                      {inviteLinkMutation.isPending ? 'Generating...' : 'Generate invite link'}
                    </button>
                    <button
                      className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                      disabled={!inviteLink}
                      onClick={() => void handleCopyInviteLink()}
                      type="button"
                    >
                      Copy link
                    </button>
                  </div>
                  <input
                    className="mt-3 w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm"
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
                        className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm"
                        onChange={(event) => setInviteEmail(event.target.value)}
                        placeholder="member@example.com"
                        type="email"
                        value={inviteEmail}
                      />
                      <button
                        className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
                        disabled={sendInviteMutation.isPending || !inviteEmail.trim()}
                        onClick={() => void handleSendInvite()}
                        type="button"
                      >
                        {sendInviteMutation.isPending ? 'Sending...' : 'Send'}
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
