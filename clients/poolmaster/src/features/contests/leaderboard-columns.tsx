import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { MineMarker } from './leaderboard-kit';

/** The columns every contest leaderboard shares (#1277), each test id under the board's prefix. */

/** A board row: one entry, placed, and the squad it belongs to where the board names one. */
export type BoardRow = {
  entryId: string;
  entryName: string;
  displayPosition: string | null;
  position?: number | null;
  squadId?: string;
  squadName?: string;
};

/** Place, as the server shows it ("T2" when shared), a dash until the entry is placed. */
export function placeColumn<Row extends BoardRow>(testIdPrefix: string): ColumnDef<Row> {
  return {
    id: 'place',
    header: 'Place',
    accessorFn: (row) => row.position ?? row.displayPosition,
    cell: ({ row }) => (
      <span className="font-semibold" data-testid={`${testIdPrefix}-place-${row.original.entryId}`}>
        {row.original.displayPosition ?? '—'}
      </span>
    ),
  };
}

/**
 * The entry: its name, linking to its page when the league is known, the viewer's own marked,
 * and its squad's name underneath. Searched by both names.
 */
export function entryColumn<Row extends BoardRow>(
  testIdPrefix: string,
  { contestId, leagueCode, mySquadId }: { contestId: string; leagueCode: string | null; mySquadId: string | null },
): ColumnDef<Row> {
  return {
    id: 'entry',
    header: 'Entry',
    accessorFn: (row) => [row.entryName, row.squadName].filter(Boolean).join(' '),
    cell: ({ row }) => (
      <span className="block min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          {leagueCode ? (
            <Link
              className="font-medium text-foreground hover:underline"
              data-testid={`${testIdPrefix}-entry-link-${row.original.entryId}`}
              state={{ leagueCode }}
              to={buildLeagueContestEntryPath(leagueCode, contestId, row.original.entryId)}
            >
              {row.original.entryName}
            </Link>
          ) : (
            <span className="font-medium">{row.original.entryName}</span>
          )}
          {mySquadId !== null && row.original.squadId === mySquadId ? <MineMarker /> : null}
        </span>
        {row.original.squadName ? <span className="block text-xs text-muted-foreground">{row.original.squadName}</span> : null}
      </span>
    ),
  };
}

/** The figure a board ranks by, in the scoreboard's total style. */
export function totalColumn<Row extends BoardRow>(
  testIdPrefix: string,
  { format = String, header, id, value }: { format?: (value: number) => string; header: string; id: string; value: (row: Row) => number },
): ColumnDef<Row> {
  return {
    id,
    header,
    accessorFn: value,
    cell: ({ row }) => (
      <span className="score-total" data-testid={`${testIdPrefix}-${id}-${row.original.entryId}`}>
        {format(value(row.original))}
      </span>
    ),
  };
}
