import { useQuery } from '@tanstack/react-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { BracketLeaderboardResponse, ContestDto } from '@/lib/api';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { useLeagueContextById } from '@/features/leagues/use-league-context';
import { Chip, DataGrid, ErrorState, LoadingState, Tile } from '@/features/shared/ui';
import { ApiError, extractErrorMessage } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { QueryKeys } from '@/lib/query-keys';
import { formatPoints } from './bracket-layout';
import { ContestHeader, ContestSubMenu } from './contest-header';
import { LEADERBOARD_ERROR_MESSAGES } from './contest-leaderboard';
import { ContestStatusBadge } from './contest-status-badge';
import { fetchContestEntries } from './use-contest-entries';
import { useBracketLeaderboardQuery } from './use-contest-leaderboard';

type BracketRow = BracketLeaderboardResponse['entries'][number];

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
const PAGE_SIZE = 25;

/** The bracket board's columns. The entry's name links to its filled bracket when the league is known. */
function bracketColumns(contestId: string, leagueCode: string | null, mySquadId: string | null, gameCount: number): ColumnDef<BracketRow>[] {
  return [
    {
      id: 'place',
      header: 'Place',
      accessorFn: (row) => row.position,
      cell: ({ row }) => (
        <span className="font-semibold" data-testid={`bracket-leaderboard-place-${row.original.entryId}`}>
          {row.original.displayPosition}
        </span>
      ),
    },
    {
      id: 'entry',
      header: 'Entry',
      // Searched by the entry's name and its group's name.
      accessorFn: (row) => `${row.entryName} ${row.squadName}`,
      cell: ({ row }) => (
        <span className="block min-w-0">
          <span className="flex flex-wrap items-center gap-2">
            {leagueCode ? (
              <Link
                className="font-medium text-foreground hover:underline"
                data-testid={`bracket-leaderboard-entry-link-${row.original.entryId}`}
                state={{ leagueCode }}
                to={buildLeagueContestEntryPath(leagueCode, contestId, row.original.entryId)}
              >
                {row.original.entryName}
              </Link>
            ) : (
              <span className="font-medium">{row.original.entryName}</span>
            )}
            {mySquadId !== null && row.original.squadId === mySquadId ? <Chip tone="active">Yours</Chip> : null}
          </span>
          <span className="block text-xs text-muted-foreground">{row.original.squadName}</span>
        </span>
      ),
    },
    {
      id: 'points',
      header: 'Points',
      accessorFn: (row) => row.points,
      cell: ({ row }) => <span data-testid={`bracket-leaderboard-points-${row.original.entryId}`}>{formatPoints(row.original.points)}</span>,
    },
    {
      id: 'max-possible',
      header: 'Max possible',
      accessorFn: (row) => row.maxPossiblePoints,
      cell: ({ row }) => <span data-testid={`bracket-leaderboard-max-${row.original.entryId}`}>{formatPoints(row.original.maxPossiblePoints)}</span>,
    },
    {
      id: 'correct',
      header: 'Correct picks',
      accessorFn: (row) => row.correctPickCount,
      cell: ({ row }) => (
        <span data-testid={`bracket-leaderboard-correct-${row.original.entryId}`}>{`${row.original.correctPickCount} of ${gameCount}`}</span>
      ),
    },
    {
      id: 'tiebreaker',
      header: 'Tiebreaker',
      accessorFn: (row) => row.tiebreakerValue,
      cell: ({ row }) => (
        <span data-testid={`bracket-leaderboard-tiebreaker-${row.original.entryId}`}>
          {row.original.tiebreakerValue === null ? '—' : String(row.original.tiebreakerValue)}
        </span>
      ),
    },
  ];
}

/**
 * A bracket contest's leaderboard (#721): place, the entry and its group, points, the most it can
 * still reach, correct picks and the tiebreaker, each entry linked to its filled bracket. It
 * opens when the event starts, like every contest board; before then the server refuses it and
 * the page says picks are not revealed yet. Polled while the contest is live, so places move
 * with the results; once the contest settles the same read serves the frozen standings.
 */
export function BracketLeaderboard({ contest, leagueCode: hintedLeagueCode }: { contest: ContestDto; leagueCode: string | null }) {
  const logger = getLogger().child({ feature: 'bracket-leaderboard' });
  const contestId = contest.id;
  const leaderboardQuery = useBracketLeaderboardQuery(contestId, contest.status);
  const contestEntriesQuery = useQuery({
    queryKey: QueryKeys.contestEntries.byContest(contestId),
    queryFn: () => fetchContestEntries(contestId),
    retry: false,
  });
  const { league, viewer } = useLeagueContextById(contest.leagueId);
  const leagueCode = hintedLeagueCode ?? league?.leagueCode ?? null;

  useEffect(() => {
    if (leaderboardQuery.isError) {
      logger.warn(
        { action: 'bracketLeaderboard.load.failed', data: { contestId }, err: leaderboardQuery.error },
        'Bracket leaderboard failed to load',
      );
    }
  }, [contestId, leaderboardQuery.error, leaderboardQuery.isError, logger]);

  if (leaderboardQuery.isLoading) {
    return <LoadingState body="Loading contest leaderboard..." />;
  }
  if (leaderboardQuery.isError || !leaderboardQuery.data) {
    const { error } = leaderboardQuery;
    return (
      <ErrorState
        body={extractErrorMessage(error, {
          codeMessages: LEADERBOARD_ERROR_MESSAGES,
          fallback: 'Try refreshing, or return to the contest board.',
        })}
        testId={error instanceof ApiError && error.code ? `contest-leaderboard-error-${error.code}` : 'contest-leaderboard-error'}
        title="We couldn't load this leaderboard."
      />
    );
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;
  // The server ranks best first, so the viewer's first row is their best placed entry.
  const myBest = mySquadId === null ? undefined : board.entries.find((entry) => entry.squadId === mySquadId);

  return (
    <section className="space-y-6" data-testid="contest-leaderboard">
      <ContestHeader
        badges={<ContestStatusBadge status={contest.status} />}
        menu={leagueCode ? (
          <ContestSubMenu
            contestId={contestId}
            current="leaderboard"
            leagueCode={leagueCode}
            myEntryId={contestEntriesQuery.data?.myEntryIds?.[0] ?? null}
            picksRevealed
          />
        ) : null}
        title={contest.name}
        titleTestId="contest-leaderboard-heading"
      >
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {myBest ? (
            <p data-testid="bracket-leaderboard-my-best">{`Your best: ${myBest.displayPosition} · ${myBest.entryName}, ${formatPoints(myBest.points)}`}</p>
          ) : null}
          {board.finalTotalPoints !== null ? (
            <p data-testid="bracket-leaderboard-final-total">
              {`The final scored ${board.finalTotalPoints} total points: tiebreakers are measured against it.`}
            </p>
          ) : null}
          {contest.status === ContestStatus.COMPLETED ? (
            <p data-testid="contest-leaderboard-settled-note">Final result: these standings are frozen at settlement.</p>
          ) : null}
        </div>
      </ContestHeader>

      <Tile>
        <DataGrid
          columns={bracketColumns(contestId, leagueCode, mySquadId, board.gameCount)}
          data={board.entries}
          emptyMessage="No brackets were submitted in this contest."
          getRowId={(row) => row.entryId}
          pageSize={PAGE_SIZE}
          rowTestId={(row) => `bracket-leaderboard-row-${row.entryId}`}
          search={{ label: 'Find an entry', placeholder: 'Find an entry', testId: 'contest-leaderboard-search' }}
          showColumnFilters={false}
          tableTestId="bracket-leaderboard-table"
        />
      </Tile>
    </section>
  );
}
