import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { ContestStatus } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { DataGrid, Tile } from '@/features/shared/ui';
import { ContestPageFrame } from './contest-header';
import { LEADERBOARD_PAGE_SIZE, SETTLED_NOTE, type BoardRow } from './leaderboard-columns';

/**
 * The pieces every contest leaderboard is built from (#1277): the frame with its notes and the
 * scoreboard grid, with the Place, Entry and total columns in `leaderboard-columns` and the
 * marker on the viewer's own rows in `mine-marker`. A scoring family's board defines only its
 * own columns and notes.
 */


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
  /** The settled line: `SETTLED_NOTE` unless the board has words of its own, or null where a note of its own stands instead. */
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

