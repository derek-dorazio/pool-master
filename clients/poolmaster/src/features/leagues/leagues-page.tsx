import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { listLeagues } from '@/lib/api';
import { useSessionStore } from '@/features/auth/session-store';

type LeagueSummary = {
  id: string;
  name: string;
  role?: string;
  memberCount: number;
  activeContestCount: number;
  visibility: string;
};

function roleLabel(role: string | undefined) {
  if (!role) {
    return 'Member';
  }

  return role
    .split('_')
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

export function LeaguesPage() {
  const tokens = useSessionStore((state) => state.tokens);
  const leaguesQuery = useQuery({
    queryKey: ['poolmaster', 'leagues', tokens?.accessToken],
    queryFn: async (): Promise<LeagueSummary[]> => {
      const response = await listLeagues({
        headers: tokens?.accessToken
          ? {
              Authorization: `Bearer ${tokens.accessToken}`,
            }
          : undefined,
      });
      if (!response.data) {
        throw response.error ?? new Error('League list response is missing data.');
      }
      return response.data.leagues as LeagueSummary[];
    },
    enabled: Boolean(tokens?.accessToken),
  });

  if (leaguesQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading your leagues...</p>
      </section>
    );
  }

  if (leaguesQuery.isError) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-xl font-semibold">We couldn&apos;t load your leagues.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is wired to the generated SDK and current backend contracts. Try refreshing
          after signing in again.
        </p>
      </section>
    );
  }

  if (!leaguesQuery.data?.length) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">You&apos;re not in any leagues yet.</h2>
        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
          The first PoolMaster member flow starts here: join leagues, accept invitations, and move
          into contest and squad workflows from a single authenticated shell.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-5">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Member
          </span>
          <div>
            <h2 className="text-3xl font-semibold tracking-tight">Your leagues</h2>
            <p className="text-sm text-muted-foreground">
              This first real route reads directly through the generated SDK against the rebuilt
              backend.
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {leaguesQuery.data.map((league) => (
          <article
            className="rounded-[1.75rem] border border-border bg-card p-5 shadow-sm"
            key={league.id}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {roleLabel(league.role)}
              </span>
              <span className="text-xs text-muted-foreground">{league.visibility}</span>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{league.name}</h3>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm text-muted-foreground">
              <div className="rounded-2xl bg-background px-3 py-3">
                <dt>Members</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">{league.memberCount}</dd>
              </div>
              <div className="rounded-2xl bg-background px-3 py-3">
                <dt>Active contests</dt>
                <dd className="mt-1 text-lg font-semibold text-foreground">
                  {league.activeContestCount}
                </dd>
              </div>
            </dl>
            <Link
              className="mt-5 inline-flex text-sm font-medium text-primary hover:underline"
              to={`/leagues/${league.id}`}
            >
              Open league
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
}
