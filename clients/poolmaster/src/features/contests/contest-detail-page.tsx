import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'react-router-dom';
import {
  getContest,
  getContestLeaderboard,
  getLeague,
  type GetContestLeaderboardResponses,
  type GetContestResponses,
} from '@/lib/api';
import { useAuth } from '@/features/auth/auth-provider';
import { buildLeagueContestManagePath, buildLeaguePath } from '@/features/leagues/league-routing';
import { parseRouteState } from '@/routes/route-state';

type ContestDetail = GetContestResponses[200]['contest'];
type LeaderboardEntry = GetContestLeaderboardResponses[200]['leaderboard'][number];

export function ContestDetailPage() {
  const { contestId = '' } = useParams<{ contestId: string }>();
  const location = useLocation();
  const auth = useAuth();
  const hintedLeagueCode = parseRouteState(location.state).leagueCode ?? null;

  const contestQuery = useQuery({
    queryKey: ['poolmaster', 'contest', contestId],
    queryFn: async (): Promise<ContestDetail> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throw response.error ?? new Error('Contest detail response is missing data.');
      }

      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const leaderboardQuery = useQuery({
    queryKey: ['poolmaster', 'contest-leaderboard', contestId],
    queryFn: async (): Promise<LeaderboardEntry[]> => {
      const response = await getContestLeaderboard({ path: { contestId } });

      if (!response.data?.leaderboard) {
        throw response.error ?? new Error('Contest leaderboard response is missing data.');
      }

      return response.data.leaderboard;
    },
    enabled: Boolean(contestId),
    retry: false,
  });

  const leagueCodeQuery = useQuery({
    queryKey: ['poolmaster', 'contest-league-code', contestQuery.data?.leagueId],
    queryFn: async () => {
      const response = await getLeague({ path: { id: contestQuery.data!.leagueId } });

      if (!response.data?.league) {
        throw response.error ?? new Error('League response is missing league data.');
      }

      return response.data.league;
    },
    enabled: Boolean(contestQuery.data?.leagueId),
    retry: false,
  });
  const backToLeaguePath = hintedLeagueCode
    ? buildLeaguePath(hintedLeagueCode)
    : leagueCodeQuery.data?.leagueCode
      ? buildLeaguePath(leagueCodeQuery.data.leagueCode)
      : '/welcome';
  const manageContestPath =
    hintedLeagueCode || leagueCodeQuery.data?.leagueCode
      ? buildLeagueContestManagePath(
          hintedLeagueCode ?? leagueCodeQuery.data!.leagueCode,
          contestId,
        )
      : null;
  const canManageContest =
    (leagueCodeQuery.data?.role === 'COMMISSIONER' || Boolean(auth.user?.isRootAdmin))
    && contestQuery.data?.status === 'DRAFT';

  if (contestQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading contest detail...</p>
      </section>
    );
  }

  if (contestQuery.isError || !contestQuery.data) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <h2 className="text-2xl font-semibold">We couldn&apos;t load this contest.</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This route is already reading from the generated SDK and current service contract.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-3">
            <span className="inline-flex rounded-full border border-border px-3 py-1 text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
              {contestQuery.data.status}
            </span>
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">{contestQuery.data.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {contestQuery.data.selectionType} · {contestQuery.data.scoringEngine}
                {contestQuery.data.sport ? ` · ${contestQuery.data.sport}` : ''}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {canManageContest && manageContestPath ? (
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
                data-testid="contest-manage-link"
                to={manageContestPath}
              >
                Manage contest
              </Link>
            ) : null}
            <Link
              className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
              data-testid="contest-back-to-league"
              to={backToLeaguePath}
            >
              Back to league
            </Link>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">Contest snapshot</h3>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 text-sm text-muted-foreground">
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Contest type</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.contestType}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Selection type</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.selectionType}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Scoring engine</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.scoringEngine}</dd>
            </div>
            <div className="rounded-2xl bg-background px-4 py-4">
              <dt>Entries</dt>
              <dd className="mt-1 font-semibold text-foreground">{contestQuery.data.entryCount ?? 0}</dd>
            </div>
          </dl>
        </div>

        <div className="rounded-[2rem] border border-border bg-card p-6">
          <h3 className="text-xl font-semibold">Leaderboard</h3>
          <div className="mt-5 space-y-3" data-testid="contest-leaderboard">
            {leaderboardQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading leaderboard...</p>
            ) : leaderboardQuery.isError ? (
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load the leaderboard for this contest.
              </p>
            ) : leaderboardQuery.data?.length ? (
              leaderboardQuery.data.map((entry) => (
                <div
                  className="flex items-center justify-between rounded-2xl border border-border bg-background px-4 py-4"
                  data-testid={`contest-leaderboard-entry-${entry.entryId}`}
                  key={entry.entryId}
                >
                  <div>
                    <div className="font-medium" title={entry.entryId}>
                      Entry {entry.entryId.slice(0, 8)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {entry.isTied ? 'Tied' : 'Solo'} leaderboard position
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-semibold text-foreground">#{entry.rank}</div>
                    <div className="text-sm text-muted-foreground">{entry.totalScore} pts</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-muted-foreground">No leaderboard entries yet.</p>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-[2rem] border border-border bg-card p-6">
        <h3 className="text-xl font-semibold">Lifecycle</h3>
        <p className="mt-3 text-sm text-muted-foreground">
          Contest status should follow the real golf event and scoring feed automatically. Commissioners
          can manage draft setup before the event begins, but PoolMaster should handle lock,
          in-progress, and completed transitions from event timing and feed updates rather than
          manual status controls.
        </p>
      </div>
    </section>
  );
}
