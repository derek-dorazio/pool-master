import type { ColumnDef } from '@tanstack/react-table';
import type { TeamIconKey } from '@poolmaster/shared/domain';
import { TeamName } from '@/features/teams/team-name';
import { formatCupPoints } from './cup-view';

/** A standings row: one squad, placed, with its points. */
export type SquadStandingRow = {
  displayPosition: string;
  points: number;
  position: number;
  squadIconKey?: TeamIconKey;
  squadId: string;
  squadIsActive: boolean;
  squadName: string;
};

export type SquadStandingColumn<Row> = ColumnDef<Row, string | number>;

/**
 * The columns every squad standings grid starts with: Place, the squad (the focused one marked,
 * linked when `squadPath` says where) and Points. A grid's own columns go after them, or
 * between Place and the squad with `afterPlace`.
 */
export function squadStandingColumns<Row extends SquadStandingRow>({
  afterPlace = [],
  focusSquadId,
  squadPath,
  testIdPrefix,
}: {
  afterPlace?: SquadStandingColumn<Row>[];
  focusSquadId: string | null;
  squadPath?: (squadId: string) => string;
  /** As the grid's: the squad's link is `<prefix>-standing-squad-<squadId>`. */
  testIdPrefix: string;
}): SquadStandingColumn<Row>[] {
  return [
    {
      id: 'place',
      header: 'Place',
      accessorFn: (row) => row.position,
      enableGlobalFilter: false,
      cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.displayPosition}</span>,
    },
    ...afterPlace,
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
          testId={`${testIdPrefix}-standing-squad-${row.original.squadId}`}
          to={squadPath?.(row.original.squadId)}
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
  ];
}
