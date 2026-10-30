import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { CupProjectedStandingDto, CupStandingRowDto } from '@/lib/api';
import { cn } from '@/features/shared/ui';
import { describeMovement, formatProjectedStanding } from './cup-view';
import { squadStandingColumns } from './squad-standing-columns';
import { SquadStandingsGrid } from './squad-standings-grid';

const MOVEMENT_CLASS = {
  up: 'text-foreground',
  down: 'text-destructive',
  none: 'text-muted-foreground',
} as const;

/** How far a squad moved since the latest counted contest. */
const MOVEMENT_COLUMN: ColumnDef<CupStandingRowDto, string | number> = {
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
};

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
      ...squadStandingColumns<CupStandingRowDto>({
        afterPlace: showMovement ? [MOVEMENT_COLUMN] : [],
        focusSquadId,
        squadPath,
        testIdPrefix: 'cup',
      }),
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

  return <SquadStandingsGrid columns={columns} focusSquadId={focusSquadId} rows={rows} testIdPrefix="cup" />;
}
