import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import {
  getContest,
  getGolfContestLeaderboard,
  type ContestDto,
  type ContestLeaderboardResponse,
} from '@/lib/api';
import { ApiError, extractErrorMessage, throwApiError } from '@/lib/errors';
import { buildLeagueContestPath } from '@/features/leagues/league-routing';
import { getLogger } from '@/lib/logger';
import { parseRouteState } from '@/routes/route-state';
import {
  Chip,
  EmptyState,
  ErrorState,
  LinkButton,
  LoadingState,
  Tile,
  cn,
  formatDateTimeDisplay,
} from '@/features/shared/ui';
import { QueryKeys } from '@/lib/query-keys';
import {
  CONTEST_POLL_INTERVAL_MS,
  contestRefetchInterval,
  refreshOnContestStatusChange,
  shouldPollContestEntries,
} from './contest-status';
import { buildLeaderboardView, type LeaderboardEntryRow } from './contest-leaderboard';

/**
 * The member-facing contest leaderboard (#110, #111, #112).
 *
 * Its own route, deliberately not folded into the contest board: that page is entry and
 * update, pre-live, and this one is live and post-settlement results. Nothing about how an
 * entry was drafted appears here — no tier, price, rank, odds or category — which is what
 * makes the view format-agnostic: a tiered pool and a budget pool render identically,
 * because "N golfers, M counting" is all a leaderboard is about.
 *
 * Once the contest is COMPLETED the same endpoint serves the standings frozen at settlement,
 * so there is no separate final mode to render.
 */

const LEADERBOARD_ERROR_MESSAGES: Record<string, string> = {
  CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN:
    'Scores appear once picks are revealed. Until then, the contest board shows who has entered.',
  LEAGUE_MEMBERSHIP_REQUIRED: 'Only members of this league can see its contest leaderboards.',
  LEAGUE_MEMBERSHIP_INACTIVE:
    'Your league membership is inactive, so this contest leaderboard is not available to you.',
};

/** An unscored cell. A golfer with no round posted is not a zero. */
const NO_SCORE = '—';

function EntryBlock({
  entry,
  gridTemplateColumns,
  roundNumbers,
}: {
  entry: LeaderboardEntryRow;
  gridTemplateColumns: string;
  roundNumbers: readonly number[];
}) {
  return (
    <Tile
      data-testid={`contest-leaderboard-entry-${entry.entryId}`}
      padding="none"
      radius="lg"
      variant="subtle"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <span
              className="text-sm font-semibold text-muted-foreground"
              data-testid={`contest-leaderboard-position-${entry.entryId}`}
            >
              {entry.displayPosition ?? NO_SCORE}
            </span>
            <span className="font-medium text-foreground">{entry.entryName}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {entry.squadName} · best {entry.countingPickLimit} of {entry.picks.length} count ·{' '}
            {entry.scoredPickCount} scored
          </div>
        </div>
        <span
          className="text-lg font-semibold text-foreground"
          data-testid={`contest-leaderboard-total-${entry.entryId}`}
        >
          {entry.total ?? NO_SCORE}
        </span>
      </div>

      {entry.picks.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">
          This entry has no scored picks yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {entry.picks.map((pick) => (
            <div
              className="grid gap-2 px-4 py-2 text-sm"
              data-testid={`contest-leaderboard-pick-${entry.entryId}-${pick.pickId}`}
              key={pick.pickId}
              style={{ gridTemplateColumns }}
            >
              <span
                className={cn(
                  'min-w-0 truncate',
                  // The worst M - N picks: visibly present, visibly excluded from the total.
                  pick.isDropped ? 'text-muted-foreground line-through' : 'text-foreground',
                )}
              >
                {pick.participantName}
              </span>
              <span className={cn('text-right font-medium', pick.isDropped ? 'text-muted-foreground line-through' : 'text-foreground')}>
                {pick.total ?? NO_SCORE}
              </span>
              {pick.rounds.map((round, index) => (
                <span
                  className="text-right text-muted-foreground"
                  data-testid={`contest-leaderboard-pick-round-${entry.entryId}-${pick.pickId}-${roundNumbers[index]}`}
                  key={roundNumbers[index]}
                >
                  {round ?? NO_SCORE}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </Tile>
  );
}

export function ContestLeaderboardPage() {
  const logger = getLogger().child({ feature: 'contest-leaderboard' });
  const { contestId = '', leagueCode: routeLeagueCode } = useParams<{
    contestId: string;
    leagueCode?: string;
  }>();
  const location = useLocation();
  const hintedLeagueCode = routeLeagueCode ?? parseRouteState(location.state).leagueCode ?? null;

  const queryClient = useQueryClient();
  const contestQuery = useQuery({
    queryKey: QueryKeys.contests.detail(contestId),
    queryFn: async (): Promise<ContestDto> => {
      const response = await getContest({ path: { contestId } });

      if (!response.data?.contest) {
        throwApiError(response.error, 'Contest detail response is missing data.');
      }

      refreshOnContestStatusChange(
        queryClient,
        QueryKeys.contests.detail(contestId),
        response.data.contest.status,
        QueryKeys.contests.leaderboard(contestId),
      );
      return response.data.contest;
    },
    enabled: Boolean(contestId),
    retry: false,
    refetchInterval: (query) => contestRefetchInterval(query.state.data?.status),
  });

  const leaderboardQuery = useQuery({
    queryKey: QueryKeys.contests.leaderboard(contestId),
    queryFn: async (): Promise<ContestLeaderboardResponse> => {
      const response = await getGolfContestLeaderboard({ path: { contestId } });

      if (!response.data) {
        throwApiError(response.error, 'Contest leaderboard response is missing data.');
      }

      return response.data;
    },
    enabled: Boolean(contestId),
    retry: false,
    // #112 — the same cadence the contest board polls entries on, driven by the same
    // predicate. The contest read above refreshes until settlement (#362), so this starts
    // when play starts and stops when the contest settles, and each status change it sees
    // reads the leaderboard once more, which is how the final standings land.
    refetchInterval: shouldPollContestEntries(contestQuery.data?.status) ? CONTEST_POLL_INTERVAL_MS : false,
  });

  useEffect(() => {
    if (!leaderboardQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'contestLeaderboard.load.failed',
        data: { contestId, leagueCode: hintedLeagueCode ?? null },
        err: leaderboardQuery.error,
      },
      'Contest leaderboard failed to load',
    );
  }, [contestId, hintedLeagueCode, leaderboardQuery.error, leaderboardQuery.isError, logger]);

  const backPath = hintedLeagueCode
    ? buildLeagueContestPath(hintedLeagueCode, contestId)
    : '/welcome';

  if (contestQuery.isLoading || leaderboardQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }

  if (leaderboardQuery.isError) {
    return (
      <ErrorState
        body={extractErrorMessage(leaderboardQuery.error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={
          // The refusal's code is in the test id, so a browser test can tell picks-hidden from
          // a membership refusal or a server failure.
          leaderboardQuery.error instanceof ApiError && leaderboardQuery.error.code
            ? `contest-leaderboard-error-${leaderboardQuery.error.code}`
            : 'contest-leaderboard-error'
        }
        title="We couldn't load this leaderboard."
      />
    );
  }

  if (contestQuery.isError || !contestQuery.data || !leaderboardQuery.data) {
    return (
      <ErrorState
        body="Try refreshing or return to League Home."
        title="We couldn't load this contest."
      />
    );
  }

  const contest = contestQuery.data;
  const view = buildLeaderboardView(leaderboardQuery.data);
  // Golfer name takes the slack; the total and each round get a fixed, right-aligned column.
  const gridTemplateColumns = `minmax(0,1.5fr) minmax(56px,0.4fr) ${view.roundNumbers
    .map(() => 'minmax(44px,0.3fr)')
    .join(' ')}`;

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <Tile padding="lg">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h2
              className="text-3xl font-semibold tracking-tight"
              data-testid="contest-leaderboard-heading"
            >
              {contest.name}
            </h2>
            <p className="text-sm text-muted-foreground">Leaderboard</p>
            {view.currentRoundLabel ? (
              <Chip data-testid="contest-leaderboard-round-cue" tone="info">
                {view.currentRoundLabel}
              </Chip>
            ) : null}
            {contest.status === 'COMPLETED' ? (
              // #246 — an entry's standing is frozen at settlement while each golfer's own
              // score stays live, so a late correction can make the two disagree on this very
              // page. Say so rather than let it read as a bug.
              <p className="text-sm text-muted-foreground" data-testid="contest-leaderboard-settled-note">
                {`Final result, settled ${formatDateTimeDisplay(contest.endsAt, 'at the end of the event')}. Entry standings are frozen at settlement; golfer scores show current event data and can differ after a late score correction.`}
              </p>
            ) : null}
          </div>
          <LinkButton data-testid="contest-leaderboard-back" to={backPath} variant="secondary">
            Back to contest
          </LinkButton>
        </div>
      </Tile>

      <Tile>
        <div
          className="grid gap-2 px-4 pb-2 text-xs font-medium uppercase text-muted-foreground"
          style={{ gridTemplateColumns }}
        >
          <span>Golfer</span>
          <span className="text-right">Total</span>
          {view.roundNumbers.map((roundNumber) => (
            <span
              className="text-right"
              data-testid={`contest-leaderboard-round-header-${roundNumber}`}
              key={roundNumber}
            >
              R{roundNumber}
            </span>
          ))}
        </div>

        <div className="space-y-3" data-testid="contest-leaderboard-entries">
          {view.entries.length === 0 ? (
            <EmptyState body="No entries have been scored in this contest yet." />
          ) : (
            view.entries.map((entry) => (
              <EntryBlock
                entry={entry}
                gridTemplateColumns={gridTemplateColumns}
                key={entry.entryId}
                roundNumbers={view.roundNumbers}
              />
            ))
          )}
        </div>
      </Tile>
    </section>
  );
}
