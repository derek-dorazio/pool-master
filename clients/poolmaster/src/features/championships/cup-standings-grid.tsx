import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { CupStandingRowDto } from '@/lib/api';
import { cn, DataGrid } from '@/features/shared/ui';
import { CupSquadName } from './cup-squad-name';
import { describeMovement, formatCupPoints } from './cup-view';

const STANDINGS_PER_PAGE = 25;

const MOVEMENT_CLASS = {
  up: 'text-foreground',
  down: 'text-destructive',
  none: 'text-muted-foreground',
} as const;

/**
 * A cup's standings: place, movement since the latest counted contest, squad, points, wins and
 * contests counted, with search and paging (rules/ux-rules.md §12 rule 7). A squad opens its
 * points contest by contest. `focusSquadId` marks one squad: the viewer's, or the squad whose page
 * shows it.
 */
export function CupStandingsGrid({
  focusSquadId,
  rows,
  squadPath,
}: {
  focusSquadId: string | null;
  rows: CupStandingRowDto[];
  squadPath: (squadId: string) => string;
}) {
  const columns = useMemo<ColumnDef<CupStandingRowDto, string | number>[]>(
    () => [
      {
        id: 'place',
        header: 'Place',
        accessorFn: (row) => row.position,
        enableGlobalFilter: false,
        cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.displayPosition}</span>,
      },
      {
        id: 'movement',
        header: 'Move',
        accessorFn: (row) => row.movement ?? 0,
        enableGlobalFilter: false,
        enableSorting: false,
        cell: ({ row }) => {
          const movement = describeMovement(row.original.movement);
          return (
            <span aria-label={movement.description} className={cn('text-xs font-bold', MOVEMENT_CLASS[movement.direction])}>
              {movement.label}
            </span>
          );
        },
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
            testId={`cup-standing-squad-${row.original.squadId}`}
            to={squadPath(row.original.squadId)}
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
      {
        id: 'wins',
        header: 'Wins',
        accessorFn: (row) => row.wins,
        enableGlobalFilter: false,
      },
      {
        id: 'contests',
        header: 'Contests',
        accessorFn: (row) => row.contestsCounted,
        enableGlobalFilter: false,
      },
    ],
    [focusSquadId, squadPath],
  );

  return (
    <DataGrid
      columns={columns}
      data={rows}
      emptyMessage={rows.length ? 'No squad matches that search.' : 'No squads in this league yet.'}
      getRowId={(row) => row.squadId}
      pageSize={STANDINGS_PER_PAGE}
      rowTestId={(row) => `cup-standing-${row.squadId}`}
      search={{ label: 'Find a squad', testId: 'cup-standings-search' }}
      showColumnFilters={false}
      tableTestId="cup-standings"
    />
  );
}
