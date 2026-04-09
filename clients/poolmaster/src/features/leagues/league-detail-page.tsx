import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getLeague, listLeagueMembers } from '@/lib/api';
import { useSessionStore } from '@/features/auth/session-store';

type LeagueDetail = {
  id: string;
  name: string;
  description?: string | null;
  visibility: string;
  memberCount: number;
  activeContestCount: number;
  role?: string;
  invitePolicy?: string;
};

type LeagueMember = {
  id: string;
  userId: string;
  displayName: string;
  role: string;
};

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
  const { leagueId = '' } = useParams<{ leagueId: string }>();
  const tokens = useSessionStore((state) => state.tokens);

  const leagueQuery = useQuery({
    queryKey: ['poolmaster', 'league', leagueId, tokens?.accessToken],
    queryFn: async (): Promise<LeagueDetail> => {
      const response = await getLeague({
        path: { id: leagueId },
        headers: tokens?.accessToken
          ? {
              Authorization: `Bearer ${tokens.accessToken}`,
            }
          : undefined,
      });

      if (!response.data?.league) {
        throw response.error ?? new Error('League detail response is missing data.');
      }

      return response.data.league as LeagueDetail;
    },
    enabled: Boolean(leagueId && tokens?.accessToken),
    retry: false,
  });

  const membersQuery = useQuery({
    queryKey: ['poolmaster', 'league-members', leagueId, tokens?.accessToken],
    queryFn: async (): Promise<LeagueMember[]> => {
      const response = await listLeagueMembers({
        path: { id: leagueId },
        headers: tokens?.accessToken
          ? {
              Authorization: `Bearer ${tokens.accessToken}`,
            }
          : undefined,
      });

      if (!response.data?.members) {
        throw response.error ?? new Error('League members response is missing data.');
      }

      return response.data.members as LeagueMember[];
    },
    enabled: Boolean(leagueId && tokens?.accessToken),
    retry: false,
  });

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
          This page is wired to the current backend contract, so errors here usually mean the
          session expired or the league id is invalid.
        </p>
        <Link className="mt-4 inline-flex text-sm font-medium text-primary hover:underline" to="/leagues">
          Back to leagues
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
            <Link className="text-sm font-medium text-primary hover:underline" to="/leagues">
              All leagues
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
        </div>
      </div>
    </section>
  );
}
