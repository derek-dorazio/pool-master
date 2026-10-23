import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ChampionshipStandingRowDto } from '@/lib/api';
import { DataGrid } from '@/features/shared/ui';
import { CupSquadName } from './cup-squad-name';
import { formatCupPoints, formatOrdinalPlace } from './cup-view';
import { FINISH_MATRIX_PLACES } from './championship-view';

const STANDINGS_PER_PAGE = 25;

/**
 * The finish matrix: each squad's place and points, then how many counted contests it finished
 * 1st, 2nd ... 10th in, with search and paging (rules/ux-rules.md §12 rule 7). `focusSquadId`
 * marks one squad: the viewer's, or the squad whose page shows it.
 */
export function ChampionshipStandingsGrid({
  focusSquadId,
  rows,
}: {
  focusSquadId: string | null;
  rows: ChampionshipStandingRowDto[];
}) {
  const columns = useMemo<ColumnDef<ChampionshipStandingRowDto, string | number>[]>(
    () => [
      {
        id: 'place',
        header: 'Place',
        accessorFn: (row) => row.position,
        enableGlobalFilter: false,
        cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.displayPosition}</span>,
      },
      {
        id: 'squad',
        header: 'Squad',
        accessorFn: (row) => row.squadName,
        cell: ({ row }) => (
          <CupSquadName
            iconKey={row.original.squadIconKey}
            isActive={row.original.squadIsActive}
            isFocus={row.original.squadId === focusSquadId}
            name={row.original.squadName}
            testId={`championship-standing-squad-${row.original.squadId}`}
          />
        ),
      },
      {
        id: 'points',
        header: 'Points',
        accessorFn: (row) => row.points,
        enableGlobalFilter: false,
        cell: ({ row }) => <span className="font-semibold tabular-nums">{formatCupPoints(row.original.points)}</span>,
      },
      ...Array.from({ length: FINISH_MATRIX_PLACES }, (_, index): ColumnDef<ChampionshipStandingRowDto, string | number> => ({
        id: `finish-${index + 1}`,
        header: formatOrdinalPlace(index + 1),
        accessorFn: (row) => row.finishes[index] ?? 0,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const count = row.original.finishes[index] ?? 0;
          return count
            ? <span className="tabular-nums">{count}</span>
            : <span aria-label="None" className="text-muted-foreground">·</span>;
        },
      })),
      {
        id: 'played',
        header: 'Played',
        accessorFn: (row) => row.played,
        enableGlobalFilter: false,
      },
    ],
    [focusSquadId],
  );

  return (
    <DataGrid
      columns={columns}
      data={rows}
      emptyMessage={rows.length ? 'No squad matches that search.' : 'No squads in this league yet.'}
      getRowId={(row) => row.squadId}
      pageSize={STANDINGS_PER_PAGE}
      rowTestId={(row) => `championship-standing-${row.squadId}`}
      search={{ label: 'Find a squad', testId: 'championship-standings-search' }}
      showColumnFilters={false}
      tableTestId="championship-standings"
    />
  );
}
