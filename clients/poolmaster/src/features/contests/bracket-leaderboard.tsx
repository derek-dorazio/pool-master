import type { ColumnDef } from '@tanstack/react-table';
import type { BracketLeaderboardResponse, ContestDto } from '@/lib/api';
import { formatPoints } from './bracket-layout';
import { contestScoreUnit } from './contest-sport';
import { SETTLED_NOTE, entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid, YourBestNote } from './leaderboard-kit';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { useContestLeague } from './use-contest-league';
import { useBracketLeaderboardQuery } from './use-contest-leaderboard';

type BracketRow = BracketLeaderboardResponse['entries'][number];

/** The prefix of the board's test ids. */
const TEST_ID = 'bracket-leaderboard';

/** The bracket board's columns: its points, the most it can still reach, correct picks and the tiebreaker. */
function bracketColumns(contestId: string, leagueCode: string | null, mySquadId: string | null, gameCount: number): ColumnDef<BracketRow>[] {
  return [
    placeColumn(TEST_ID),
    entryColumn(TEST_ID, { contestId, isMine: isMySquadsEntry(mySquadId), leagueCode }),
    totalColumn(TEST_ID, { format: formatPoints, header: 'Points', id: 'points', value: (row) => row.points }),
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
  const contestId = contest.id;
  const leaderboardQuery = useBracketLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId, hintedLeagueCode);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'bracketLeaderboard.load.failed', contestId });

  if (fallback || !leaderboardQuery.data) {
    return fallback;
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      notes={(
        <>
          <YourBestNote entries={board.entries} mySquadId={mySquadId} points={(entry) => entry.points} testId="bracket-leaderboard-my-best" />
          {board.finalTotalPoints !== null ? (
            <p data-testid="bracket-leaderboard-final-total">
              {`The final scored ${board.finalTotalPoints} total ${contestScoreUnit(contest.sport)}: tiebreakers are measured against it.`}
            </p>
          ) : null}
          {board.eventCancelled ? (
            <p data-testid="bracket-leaderboard-cancelled-note">This event was cancelled, so no bracket scores any points.</p>
          ) : null}
        </>
      )}
      // A cancelled event's note stands in for the settled one: nothing was scored to freeze.
      settledNote={board.eventCancelled ? null : SETTLED_NOTE}
    >
      <ScoreboardGrid
        columns={bracketColumns(contestId, leagueCode, mySquadId, board.gameCount)}
        data={board.entries}
        emptyMessage="No brackets were submitted in this contest."
        rowTestIdPrefix="bracket-leaderboard-row"
        tableTestId="bracket-leaderboard-table"
      />
    </LeaderboardFrame>
  );
}
