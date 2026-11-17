import type { ColumnDef } from '@tanstack/react-table';
import { SelectionType } from '@poolmaster/shared/domain';
import { useState } from 'react';
import type { ContestDto } from '@/lib/api';
import { Button, TeamLine } from '@/features/shared/ui';
import { BracketEntryDialog, type BracketBoardRow } from './bracket-entry-dialog';
import { contestScoreUnit } from './contest-sport';
import { SETTLED_NOTE, entryColumn, isMySquadsEntry, placeColumn, totalColumn } from './leaderboard-columns';
import { LeaderboardFrame, ScoreboardGrid, YourBestNote } from './leaderboard-kit';
import { SELECTION_TYPE_ICONS } from './selection-type-icons';
import { useLeaderboardFallback } from './use-leaderboard-fallback';
import { useContestLeague } from './use-contest-league';
import { useBracketLeaderboardQuery } from './use-contest-leaderboard';

/** The prefix of the board's test ids. */
const TEST_ID = 'bracket-leaderboard';

const BracketIcon = SELECTION_TYPE_ICONS[SelectionType.BRACKET];

/** A plain figure column: right picks, most possible. */
function figureColumn(id: string, header: string, value: (row: BracketBoardRow) => number): ColumnDef<BracketBoardRow> {
  return {
    id,
    header,
    accessorFn: value,
    cell: ({ row }) => <span data-testid={`${TEST_ID}-${id}-${row.original.entryId}`}>{value(row.original)}</span>,
  };
}

/**
 * The bracket board's columns (#1753): the entry, with the bracket icon that opens its bracket
 * and pinned while the rest scroll sideways on a phone; its champion, struck through once out;
 * points, right picks and the most it can still reach.
 */
function bracketColumns({
  contestId,
  leagueCode,
  leagueId,
  mySquadId,
  onOpen,
}: {
  contestId: string;
  leagueCode: string;
  leagueId: string;
  mySquadId: string | null;
  onOpen: (row: BracketBoardRow) => void;
}): ColumnDef<BracketBoardRow>[] {
  const entry = entryColumn<BracketBoardRow>(TEST_ID, {
    contestId,
    isMine: isMySquadsEntry(mySquadId),
    leading: (row) => (
      <Button
        aria-label={`View bracket: ${row.entryName}`}
        className="-my-2"
        data-testid={`${TEST_ID}-open-${row.entryId}`}
        onClick={() => onOpen(row)}
        size="xs"
        title="View bracket"
        type="button"
        variant="icon"
      >
        <BracketIcon aria-hidden size={16} />
      </Button>
    ),
    leagueCode,
    leagueId,
    truncateName: true,
  });
  return [
    placeColumn(TEST_ID),
    {
      ...entry,
      // Wide enough to keep the icon, the name and its (i) on a line while the rest scroll under it.
      cell: (context) => <span className="block w-56">{typeof entry.cell === 'function' ? entry.cell(context) : null}</span>,
      meta: { pinned: 'start' },
    },
    {
      id: 'champion',
      header: 'Champion',
      accessorFn: (row) => row.champion?.name ?? '',
      cell: ({ row }) => {
        const { champion, entryId } = row.original;
        return champion ? (
          <span className="block w-36">
            <TeamLine
              mark={champion.outcome === 'BUSTED' ? 'wrong' : 'none'}
              name={champion.name}
              seed={champion.seedNumber}
              testId={`${TEST_ID}-champion-${entryId}`}
            />
          </span>
        ) : <span data-testid={`${TEST_ID}-champion-${entryId}`}>—</span>;
      },
    },
    totalColumn(TEST_ID, { header: 'Pts', id: 'points', value: (row) => row.points }),
    figureColumn('right', 'Right', (row) => row.correctPickCount),
    figureColumn('max', 'Max', (row) => row.maxPossiblePoints),
  ];
}

/**
 * A bracket contest's leaderboard (#721, #1753): place, the entry, its champion, points, right
 * picks and the most it can still reach. Each entry's bracket icon opens its whole bracket in a
 * dialog; the tiebreaker is there too. It opens when the event starts, like every contest board;
 * before then the server refuses it and the page says picks are not revealed yet. Polled while
 * the contest is live, so places move with the results; once the contest settles the same read
 * serves the frozen standings.
 */
export function BracketLeaderboard({ contest }: { contest: ContestDto }) {
  const contestId = contest.id;
  const leaderboardQuery = useBracketLeaderboardQuery(contestId, contest.status);
  const { leagueCode, viewer } = useContestLeague(contest.leagueId);
  const fallback = useLeaderboardFallback(leaderboardQuery, { action: 'bracketLeaderboard.load.failed', contestId });
  const [openEntryId, setOpenEntryId] = useState<string | null>(null);

  if (fallback || !leaderboardQuery.data) {
    return fallback;
  }

  const board = leaderboardQuery.data;
  const mySquadId = viewer.mySquadId;
  // The row is read from the board each poll, so the dialog's line moves with the results.
  const openRow = board.entries.find((entry) => entry.entryId === openEntryId) ?? null;

  return (
    <LeaderboardFrame
      contest={contest}
      leagueCode={leagueCode}
      notes={(
        <>
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
        trailing={<YourBestNote entries={board.entries} mySquadId={mySquadId} points={(entry) => entry.points} testId="bracket-leaderboard-my-best" />}
        columns={bracketColumns({ contestId, leagueCode, leagueId: contest.leagueId, mySquadId, onOpen: (row) => setOpenEntryId(row.entryId) })}
        data={board.entries}
        isMine={isMySquadsEntry(mySquadId)}
        emptyMessage="No brackets were submitted in this contest."
        rowTestIdPrefix="bracket-leaderboard-row"
        tableTestId="bracket-leaderboard-table"
      />
      <BracketEntryDialog
        contest={contest}
        isMine={openRow !== null && isMySquadsEntry(mySquadId)(openRow)}
        onClose={() => setOpenEntryId(null)}
        row={openRow}
        sportEventId={board.sportEventId}
      />
    </LeaderboardFrame>
  );
}
