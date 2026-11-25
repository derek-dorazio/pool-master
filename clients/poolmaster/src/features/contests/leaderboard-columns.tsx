import type { ColumnDef } from '@tanstack/react-table';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import type { ContestEntryStandingDto } from '@/lib/api';
import { buildLeagueContestEntryPath } from '@/features/leagues/league-routing';
import { EntryDetailsPeek } from './entry-details-peek';
import { MineMarker } from './mine-marker';
import { Text, cn } from '@/features/shared/ui';

/** The columns every contest leaderboard shares (#1277), each test id under the board's prefix. */

/** What a board says once its contest settles, unless it has words of its own. */
export const SETTLED_NOTE = 'Final result: these standings are frozen at settlement.';

/** A board row: one entry, placed, and the squad it belongs to where the board names one. */
export type BoardRow = Pick<ContestEntryStandingDto, 'displayPosition' | 'entryId' | 'entryName'>
  & Partial<Pick<ContestEntryStandingDto, 'position' | 'squadId' | 'squadName'>>;

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
  {
    className,
    contestId,
    isMine,
    leading,
    leagueCode,
    leagueId,
    truncateName = false,
  }: {
    /** The cell's own classes, such as a fixed width for a pinned column. */
    className?: string;
    contestId: string;
    isMine: (row: NoInfer<Row>) => boolean;
    /** Something before the name, such as the button that opens a bracket (#1753). */
    leading?: (row: NoInfer<Row>) => ReactNode;
    leagueCode: string;
    leagueId: string;
    /**
     * Cut a long name short, whole on hover, so it keeps its line with the (i): for a column of
     * fixed width, such as one pinned while the rest scroll (#1753).
     */
    truncateName?: boolean;
  },
): ColumnDef<Row> {
  return {
    id: 'entry',
    header: 'Entry',
    accessorFn: (row) => [row.entryName, row.squadName].filter(Boolean).join(' '),
    cell: ({ row }) => {
      const name = (
        <>
          <Text asChild size="inherit" variant="strong">
            <Link
              className={cn('hover:underline', truncateName && 'min-w-0 truncate')}
              data-testid={`${testIdPrefix}-entry-link-${row.original.entryId}`}
              title={truncateName ? row.original.entryName : undefined}
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
        </>
      );
      const mine = isMine(row.original) ? <span className={truncateName ? 'flex-none sm:ml-1' : 'ml-1'}><MineMarker /></span> : null;
      if (!truncateName) {
        return (
          <span className={cn('flex min-w-0 flex-wrap items-center gap-x-1 gap-y-2', className)}>
            {leading?.(row.original)}
            {name}
            {mine}
          </span>
        );
      }
      // A fixed width: the name is cut short to keep its line with the (i), and "Yours" drops
      // under it on a phone.
      return (
        <span className={cn('flex min-w-0 items-center gap-x-1', className)}>
          {leading?.(row.original)}
          <span className="flex min-w-0 flex-1 flex-col items-start gap-1 sm:flex-row sm:items-center">
            <span className="flex min-w-0 max-w-full items-center gap-x-1">{name}</span>
            {mine}
          </span>
        </span>
      );
    },
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
