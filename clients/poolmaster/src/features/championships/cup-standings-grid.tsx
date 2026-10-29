import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { CupProjectedStandingDto, CupStandingRowDto } from '@/lib/api';
import { cn, DataGrid } from '@/features/shared/ui';
import { TeamName } from '@/features/teams/team-name';
import { describeMovement, formatCupPoints, formatProjectedStanding } from './cup-view';

const STANDINGS_PER_PAGE = 25;

const MOVEMENT_CLASS = {
  up: 'text-foreground',
  down: 'text-destructive',
  none: 'text-muted-foreground',
} as const;

/**
 * A cup's standings: place, movement since the latest counted contest, squad, points, wins and
 * contests counted, with search and paging (rules/ux-rules.md §12 rule 7). A season that is over
 * shows no movement. A squad opens its
 * points contest by contest. `focusSquadId` marks one squad: the viewer's, or the squad whose page
 * shows it, with a jump to its row. With a projection, a greyed "If it ended now" column shows each squad's place and
 * points if the live contests ended now.
 */
export function CupStandingsGrid({
  focusSquadId,
  projection,
  rows,
  showMovement = true,
  squadPath,
}: {
  focusSquadId: string | null;
  /** Each squad's projected standing, by squad id, while a contest is live. */
  projection?: ReadonlyMap<string, CupProjectedStandingDto>;
  rows: CupStandingRowDto[];
  showMovement?: boolean;
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
      ...(showMovement ? [{
        id: 'movement',
        header: 'Move',
        accessorFn: (row: CupStandingRowDto) => row.movement ?? 0,
        enableGlobalFilter: false,
        enableSorting: false,
        cell: ({ row }: { row: { original: CupStandingRowDto } }) => {
          const movement = describeMovement(row.original.movement);
          return (
            <span aria-label={movement.description} className={cn('text-xs font-bold', MOVEMENT_CLASS[movement.direction])}>
              {movement.label}
            </span>
          );
        },
      }] : []),
      {
        id: 'squad',
        header: 'Squad',
        accessorFn: (row) => row.squadName,
        cell: ({ row }) => (
          <TeamName
            iconKey={row.original.squadIconKey}
            isActive={row.original.squadIsActive}
            isMine={row.original.squadId === focusSquadId}
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
        cell: ({ row }) => <span className="score-total">{formatCupPoints(row.original.points)}</span>,
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
      ...(projection ? [{
        id: 'projected',
        header: 'If it ended now',
        accessorFn: (row: CupStandingRowDto) => projection.get(row.squadId)?.position ?? Number.MAX_SAFE_INTEGER,
        enableGlobalFilter: false,
        cell: ({ row }: { row: { original: CupStandingRowDto } }) => {
          const projected = projection.get(row.original.squadId);
          return projected ? (
            <span className="tabular-nums text-muted-foreground" data-testid={`cup-projected-${row.original.squadId}`}>
              {formatProjectedStanding(projected)}
            </span>
          ) : null;
        },
      }] : []),
    ],
    [focusSquadId, projection, showMovement, squadPath],
  );

  const focusRow = rows.find((row) => row.squadId === focusSquadId);

  return (
    <DataGrid
      headerTone="scoreboard"
      columns={columns}
      data={rows}
      emptyMessage={rows.length ? 'No squad matches that search.' : 'No squads in this league yet.'}
      getRowId={(row) => row.squadId}
      jumpToRow={focusRow ? { rowId: focusRow.squadId, label: `Jump to ${focusRow.squadName}`, testId: 'cup-standings-jump' } : undefined}
      pageSize={STANDINGS_PER_PAGE}
      rowTestId={(row) => `cup-standing-${row.squadId}`}
      search={{ label: 'Find a squad', testId: 'cup-standings-search' }}
      showColumnFilters={false}
      tableTestId="cup-standings"
    />
  );
}
