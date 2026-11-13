import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { DataGrid, SectionCard, Text } from '@/features/shared/ui';
import { formatPoints } from './bracket-layout';
import { ContestPageFrame } from './contest-header';
import { LEADERBOARD_PAGE_SIZE, SETTLED_NOTE, type BoardRow } from './leaderboard-columns';

/**
 * The pieces every contest leaderboard is built from (#1277): the frame with its notes and the
 * scoreboard grid, with the Place, Entry and total columns in `leaderboard-columns` and the
 * marker on the viewer's own rows in `mine-marker`. A scoring family's board defines only its
 * own columns and notes.
 */

/**
 * The one frame every leaderboard format's standings sit in (#1578): a section titled
 * Standings (the page's tab already says Leaderboard), with the viewer's best place in its title
 * bar. It is bare, a title and rule with no box, because the board is the page's long content:
 * a box's padding would cost a phone's board 32px of its width.
 */
export function LeaderboardSection({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <SectionCard bare testId="contest-leaderboard-card" title="Standings" trailing={trailing}>
      {children}
    </SectionCard>
  );
}

/** A board's standings: the scoreboard grid in the Leaderboard section, searchable by entry, a page at a time. */
export function ScoreboardGrid<Row extends BoardRow>({
  columns,
  data,
  emptyMessage,
  rowTestIdPrefix,
  tableTestId,
  trailing,
}: {
  columns: ColumnDef<Row>[];
  data: Row[];
  emptyMessage: string;
  rowTestIdPrefix: string;
  tableTestId: string;
  /** The title bar's trailing slot: the viewer's best place (`YourBestNote`). */
  trailing?: ReactNode;
}) {
  return (
    <LeaderboardSection trailing={trailing}>
      <DataGrid
        headerTone="scoreboard"
        columns={columns}
        data={data}
        emptyMessage={emptyMessage}
        getRowId={(row) => row.entryId}
        pageSize={LEADERBOARD_PAGE_SIZE}
        rowTestId={(row) => `${rowTestIdPrefix}-${row.entryId}`}
        search={{ label: 'Find an entry', placeholder: 'Find an entry', testId: 'contest-leaderboard-search' }}
        showColumnFilters={false}
        tableTestId={tableTestId}
      />
    </LeaderboardSection>
  );
}

/**
 * A leaderboard page: the contest's frame on its Leaderboard option, the board's own notes under
 * the title, then the settled note once the contest is final, and the board underneath.
 */
export function LeaderboardFrame({
  children,
  contest,
  leagueCode,
  notes,
  settledNote = SETTLED_NOTE,
  summary,
}: {
  children: ReactNode;
  contest: ContestDto;
  leagueCode: string;
  /** The board's own lines under the title, such as the viewer's best place. */
  notes?: ReactNode;
  /** The settled line: `SETTLED_NOTE` unless the board has words of its own, or null where a note of its own stands instead. */
  settledNote?: ReactNode;
  summary?: ReactNode;
}) {
  const isSettled = contest.status === ContestStatus.COMPLETED && Boolean(settledNote);
  return (
    <ContestPageFrame
      contest={contest}
      current="leaderboard"
      headerTestId="contest-leaderboard-header"
      leagueCode={leagueCode}
      notes={notes || isSettled ? (
        <>
          {notes}
          {isSettled ? <p data-testid="contest-leaderboard-settled-note">{settledNote}</p> : null}
        </>
      ) : undefined}
      picksRevealed
      summary={summary}
      testId="contest-leaderboard"
    >
      {children}
    </ContestPageFrame>
  );
}

/**
 * The viewer's best placed entry, for the Standings title bar: the first of their squad's placed rows, since
 * the server ranks best first. Nothing when the viewer has no placed entry on the board.
 */
export function YourBestNote<Row extends BoardRow>({
  entries,
  mySquadId,
  points,
  testId,
}: {
  entries: Row[];
  mySquadId: string | null;
  /** The points the board ranks by. */
  points: (row: Row) => number;
  testId: string;
}) {
  const myBest = mySquadId === null
    ? undefined
    : entries.find((entry) => entry.squadId === mySquadId && entry.displayPosition !== null);
  if (!myBest) {
    return null;
  }
  return <Text data-testid={testId} variant="meta">{`Your best: ${myBest.displayPosition} · ${myBest.entryName}, ${formatPoints(points(myBest))}`}</Text>;
}
