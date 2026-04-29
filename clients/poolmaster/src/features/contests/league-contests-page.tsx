import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  getMyContestEntry,
  getLeagueByCode,
  listContests,
  type GetLeagueByCodeResponses,
  type ListContestsResponses,
} from '@/lib/api';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { buildLeagueContestCreatePath, buildLeagueContestsManagePath, buildLeaguePath, setRecentLeagueCode } from '@/features/leagues/league-routing';
import { useLogger } from '@/lib/logger';
import { isHistoricalContest } from './contest-status';
import { ContestListCard } from './contest-list-card';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type ContestSummary = ListContestsResponses[200]['contests'][number];

export function LeagueContestsPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const [searchParams] = useSearchParams();
  const logger = useLogger().child({
    feature: 'league-contests-page',
  });
  const isMyEntriesFilter = searchParams.get('filter') === 'my-entries';

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
        action: 'leagueContests.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'League Contests page failed to load league context',
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

  const contests = contestsQuery.data ?? [];
  const activeContests = useMemo(
    () => contests.filter((contest) => !isHistoricalContest(contest.status)),
    [contests],
  );
  const activeContestIds = useMemo(
    () => activeContests.map((contest) => contest.id),
    [activeContests],
  );
  const myContestIdsQuery = useQuery({
    queryKey: ['poolmaster', 'league-contests', leagueId, 'my-entries', activeContestIds],
    queryFn: async (): Promise<Set<string>> => {
      const contestIds = await Promise.all(
        activeContestIds.map(async (contestId) => {
          const response = await getMyContestEntry({ path: { contestId } });
          return response.data?.entry ? contestId : null;
        }),
      );

      return new Set(contestIds.filter((contestId): contestId is string => Boolean(contestId)));
    },
    enabled: Boolean(leagueId && isMyEntriesFilter && activeContestIds.length),
    retry: false,
  });
  const visibleActiveContests = useMemo(() => {
    if (!isMyEntriesFilter) {
      return activeContests;
    }

    const myContestIds = myContestIdsQuery.data ?? new Set<string>();
    return activeContests.filter((contest) => myContestIds.has(contest.id));
  }, [activeContests, isMyEntriesFilter, myContestIdsQuery.data]);

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading league contests...</p>
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

  const league = leagueQuery.data;
  const canManageContests = league.leagueRelationship.commissioner || league.isRootAdmin;

  return (
    <section className="space-y-6" data-testid="league-contests-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={buildLeaguePath(league.leagueCode)}
        >
          Back to League Home
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              {isMyEntriesFilter ? 'My Contests' : 'Active Contests'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              {isMyEntriesFilter
                ? 'Open active contests where your team has an entry.'
                : 'Open active contests and jump into contest boards from one place.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            {canManageContests ? (
              <Link
                className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/40"
                to={buildLeagueContestsManagePath(league.leagueCode)}
              >
                Manage Contests
              </Link>
            ) : null}
            {canManageContests && league.isActive ? (
              <Link
                className="rounded-2xl bg-primary px-4 py-3 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                to={buildLeagueContestCreatePath(league.leagueCode)}
              >
                Create Contest
              </Link>
            ) : null}
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">League</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{league.name}</div>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Active</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{activeContests.length}</div>
          </div>
          <div className="rounded-2xl bg-background px-4 py-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Shown</div>
            <div className="mt-1 text-lg font-semibold text-foreground">{visibleActiveContests.length}</div>
          </div>
        </div>
      </div>

      {contestsQuery.isLoading ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Loading contests...</p>
        </section>
      ) : contestsQuery.isError ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load contests for this league.
          </p>
        </section>
      ) : (
        <section
          className="rounded-[2rem] border border-border bg-card p-6"
          data-testid="league-contests-active"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">
                {isMyEntriesFilter ? 'My active contests' : 'Active contests'}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a contest to view its leaderboard, manage entries, and see picks once the
                event has started.
              </p>
            </div>
            <div className="rounded-2xl bg-background px-4 py-2 text-sm font-medium text-foreground">
              {visibleActiveContests.length}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {isMyEntriesFilter && myContestIdsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading your contests...</p>
            ) : visibleActiveContests.length ? (
              visibleActiveContests.map((contest) => (
                <ContestListCard
                  contest={contest}
                  key={contest.id}
                  leagueCode={league.leagueCode}
                  testId={`league-contest-${contest.id}`}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                {isMyEntriesFilter
                  ? 'Your team does not have entries in any active contests yet.'
                  : 'No active contests are available for this league yet.'}
              </p>
            )}
          </div>
        </section>
      )}
    </section>
  );
}
