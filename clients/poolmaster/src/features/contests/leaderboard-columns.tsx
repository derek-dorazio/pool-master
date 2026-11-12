import type { ColumnDef } from '@tanstack/react-table';
import { Link } from 'react-router';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { EntryDetailsPeek } from './entry-details-peek';
import { MineMarker } from './mine-marker';
import { Text } from '@/features/shared/ui';

/** The columns every contest leaderboard shares (#1277), each test id under the board's prefix. */

/** Entries per page. A league can have hundreds; one page stays readable on a phone. */
export const LEADERBOARD_PAGE_SIZE = 25;

/** What a board says once its contest settles, unless it has words of its own. */
export const SETTLED_NOTE = 'Final result: these standings are frozen at settlement.';

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
      <Text data-testid={`${testIdPrefix}-place-${row.original.entryId}`} size="inherit" weight="semibold">
        {row.original.displayPosition ?? '—'}
      </Text>
    ),
  };
}

/** Whether a row is the viewer's on a board of squads' entries: any entry of the viewer's squad. */
export function isMySquadsEntry(mySquadId: string | null) {
  return (row: Pick<BoardRow, 'squadId'>) => mySquadId !== null && row.squadId === mySquadId;
}

/**
 * The entry: its name, linking to its page, then the (i) that says whose it is (#1564), and the
 * viewer's own marked (`isMine` says which those are). Searched by the entry's and team's names.
 */
export function entryColumn<Row extends BoardRow>(
  testIdPrefix: string,
  { contestId, isMine, leagueCode, leagueId }: { contestId: string; isMine: (row: NoInfer<Row>) => boolean; leagueCode: string; leagueId: string },
): ColumnDef<Row> {
  return {
    id: 'entry',
    header: 'Entry',
    accessorFn: (row) => [row.entryName, row.squadName].filter(Boolean).join(' '),
    cell: ({ row }) => (
      <span className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2">
        <Text asChild size="inherit" variant="strong">
          <Link
            className="hover:underline"
            data-testid={`${testIdPrefix}-entry-link-${row.original.entryId}`}
            to={buildLeagueContestEntryPath(leagueCode, contestId, row.original.entryId)}
          >
            {row.original.entryName}
          </Link>
        </Text>
        {row.original.squadId ? (
          <EntryDetailsPeek
            className="-my-2"
            entryName={row.original.entryName}
            leagueCode={leagueCode}
            leagueId={leagueId}
            squadId={row.original.squadId}
            testId={`${testIdPrefix}-entry-peek-${row.original.entryId}`}
          />
        ) : null}
        {isMine(row.original) ? <span className="ml-1"><MineMarker /></span> : null}
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
