import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { getContest, getContestLeaderboard } from '@/lib/api';

type ContestDetail = {
  id: string;
  name: string;
  status: string;
  contestType: string;
  selectionType: string;
  scoringEngine: string;
  leagueId: string;
  sport?: string | null;
  entryCount?: number;
};

type LeaderboardEntry = {
  entryId: string;
  rank: number;
  totalScore: number;
  isTied: boolean;
};

export function ContestDetailPage() {
  const { contestId = '' } = useParams<{ contestId: string }>();

  const contestQuery = useQuery({
    queryKey: ['poolmaster', 'contest', contestId],
    queryFn: async (): Promise<ContestDetail> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throw response.error ?? new Error('Contest detail response is missing data.');
      }

      return response.data.contest as ContestDetail;
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

      return response.data.leaderboard as LeaderboardEntry[];
    },
    enabled: Boolean(contestId),
    retry: false,
  });

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
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium"
            to={`/leagues/${contestQuery.data.leagueId}`}
          >
            Back to league
          </Link>
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
          <div className="mt-5 space-y-3">
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
                  key={entry.entryId}
                >
                  <div>
                    <div className="font-medium">Entry {entry.entryId.slice(0, 8)}</div>
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
    </section>
  );
}
