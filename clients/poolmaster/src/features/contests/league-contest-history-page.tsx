import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useEffect, useMemo } from 'react';
import {
  getLeagueByCode,
  listContests,
  type GetLeagueByCodeResponses,
  type ListContestsResponses,
} from '@/lib/api';
import { getLeagueLoadErrorCopy } from '@/features/leagues/league-load-error';
import { buildLeagueContestsPath, buildLeaguePath, setRecentLeagueCode } from '@/features/leagues/league-routing';
import { ListStack } from '@/features/shared/ui';
import { useLogger } from '@/lib/logger';
import { isHistoricalContest } from './contest-status';
import { ContestListCard } from './contest-list-card';

type LeagueDetail = GetLeagueByCodeResponses[200]['league'];
type ContestSummary = ListContestsResponses[200]['contests'][number];

export function LeagueContestHistoryPage() {
  const { leagueCode = '' } = useParams<{ leagueCode: string }>();
  const logger = useLogger().child({
    feature: 'league-contest-history-page',
  });

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
        action: 'leagueContestHistory.league.failed',
        data: {
          leagueCode,
        },
        err: leagueQuery.error,
      },
      'League Contest History page failed to load league context',
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

  const historicalContests = useMemo(
    () => (contestsQuery.data ?? []).filter((contest) => isHistoricalContest(contest.status)),
    [contestsQuery.data],
  );

  if (leagueQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <p className="text-sm text-muted-foreground">Loading contest history...</p>
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

  return (
    <section className="space-y-6" data-testid="league-contest-history-page">
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to={buildLeagueContestsPath(league.leagueCode)}
        >
          Back to Active Contests
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Contest History
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Review completed contests, final standings, and revealed picks.
            </p>
          </div>
          <Link
            className="rounded-2xl border border-border px-4 py-3 text-sm font-medium text-foreground transition hover:bg-muted/40"
            to={buildLeaguePath(league.leagueCode)}
          >
            League Details
          </Link>
        </div>
      </div>

      {contestsQuery.isLoading ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">Loading contest history...</p>
        </section>
      ) : contestsQuery.isError ? (
        <section className="rounded-[2rem] border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            We couldn&apos;t load contest history for this league.
          </p>
        </section>
      ) : (
        <section
          className="rounded-[2rem] border border-border bg-card p-6"
          data-testid="league-contests-history"
        >
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-foreground">Completed contests</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Open a completed contest to view final standings and revealed picks.
              </p>
            </div>
            <div className="rounded-2xl bg-background px-4 py-2 text-sm font-medium text-foreground">
              {historicalContests.length}
            </div>
          </div>

          <ListStack className="mt-5">
            {historicalContests.length ? (
              historicalContests.map((contest) => (
                <ContestListCard
                  contest={contest}
                  key={contest.id}
                  leagueCode={league.leagueCode}
                  testId={`league-history-contest-${contest.id}`}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                This league does not have any completed contests yet.
              </p>
            )}
          </ListStack>
        </section>
      )}
    </section>
  );
}
