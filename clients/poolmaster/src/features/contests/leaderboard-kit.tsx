import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { Chip, DataGrid, Tile } from '@/features/shared/ui';
import { ContestPageFrame } from './contest-header';
import type { BoardRow } from './leaderboard-columns';

/**
 * The pieces every contest leaderboard is built from (#1277): the frame with its notes, the
 * scoreboard grid and the marker on the viewer's own rows, with the Place, Entry and total
 * columns in `leaderboard-columns`. A scoring family's board defines only its own columns and
 * notes.
 */

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
const LEADERBOARD_PAGE_SIZE = 25;

/** What a board says once its contest settles, unless it has words of its own. */
const SETTLED_NOTE = 'Final result: these standings are frozen at settlement.';

/** The one mark for "this is yours", on every board, cup table and league home list. */
export function MineMarker() {
  return <Chip tone="active">Yours</Chip>;
}

/** A board's standings: the scoreboard grid in a tile, searchable by entry, a page at a time. */
export function ScoreboardGrid<Row extends BoardRow>({
  columns,
  data,
  emptyMessage,
  rowTestIdPrefix,
  tableTestId,
}: {
  columns: ColumnDef<Row>[];
  data: Row[];
  emptyMessage: string;
  rowTestIdPrefix: string;
  tableTestId: string;
}) {
  return (
    <Tile>
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
    </Tile>
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
  leagueCode: string | null;
  /** The board's own lines under the title, such as the viewer's best place. */
  notes?: ReactNode;
  /** The settled line, in the board's words; null where a note of its own stands instead. */
  settledNote?: ReactNode;
  summary?: ReactNode;
}) {
  return (
    <ContestPageFrame
      contest={contest}
      current="leaderboard"
      details={(
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {notes}
          {contest.status === ContestStatus.COMPLETED && settledNote ? (
            <p data-testid="contest-leaderboard-settled-note">{settledNote}</p>
          ) : null}
        </div>
      )}
      leagueCode={leagueCode}
      picksRevealed
      summary={summary}
      testId="contest-leaderboard"
      titleTestId="contest-leaderboard-heading"
    >
      {children}
    </ContestPageFrame>
  );
}

