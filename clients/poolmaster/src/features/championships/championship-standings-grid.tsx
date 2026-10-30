import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ChampionshipStandingRowDto } from '@/lib/api';
import { Button, cn } from '@/features/shared/ui';
import { formatOrdinalPlace } from './cup-view';
import { FINISH_MATRIX_PLACES, type ContestResultFilter } from './championship-view';
import { squadStandingColumns } from './squad-standing-columns';
import { SquadStandingsGrid } from './squad-standings-grid';

/**
 * The finish matrix: each squad's place and points, then how many counted contests it finished
 * 1st, 2nd ... 10th in, with search and paging (rules/ux-rules.md §12 rule 7). `focusSquadId`
 * marks one squad: the viewer's, or the squad whose page shows it, with a jump to its row. A count opens the contests
 * behind it (#837): a cell those the squad finished in that place, Played all it placed in. A
 * squad page shows its one row without the search (#872).
 */
export function ChampionshipStandingsGrid({
  filter,
  focusSquadId,
  onFilter,
  rows,
  searchable = true,
}: {
  filter: ContestResultFilter | null;
  focusSquadId: string | null;
  onFilter: (filter: ContestResultFilter) => void;
  rows: ChampionshipStandingRowDto[];
  searchable?: boolean;
}) {
  const columns = useMemo<ColumnDef<ChampionshipStandingRowDto, string | number>[]>(
    () => [
      ...squadStandingColumns<ChampionshipStandingRowDto>({ focusSquadId, testIdPrefix: 'championship' }),
      ...Array.from({ length: FINISH_MATRIX_PLACES }, (_, index): ColumnDef<ChampionshipStandingRowDto, string | number> => ({
        id: `finish-${index + 1}`,
        header: formatOrdinalPlace(index + 1),
        accessorFn: (row) => row.finishes[index] ?? 0,
        enableGlobalFilter: false,
        cell: ({ row }) => {
          const count = row.original.finishes[index] ?? 0;
          return count
            ? (
                <CountButton
                  count={count}
                  isActive={filter?.squadId === row.original.squadId && filter.place === index + 1}
                  label={`Show the contests ${row.original.squadName} finished ${formatOrdinalPlace(index + 1)}`}
                  onClick={() => onFilter({ squadId: row.original.squadId, place: index + 1 })}
                  testId={`championship-cell-${row.original.squadId}-${index + 1}`}
                />
              )
            : <span aria-label="None" className="text-muted-foreground">·</span>;
        },
      })),
      {
        id: 'played',
        header: 'Played',
        accessorFn: (row) => row.played,
        enableGlobalFilter: false,
        cell: ({ row }) => (row.original.played
          ? (
              <CountButton
                count={row.original.played}
                isActive={filter?.squadId === row.original.squadId && filter.place === null}
                label={`Show the contests ${row.original.squadName} played`}
                onClick={() => onFilter({ squadId: row.original.squadId, place: null })}
                testId={`championship-played-${row.original.squadId}`}
              />
            )
          : <span className="tabular-nums">0</span>),
      },
    ],
    [filter, focusSquadId, onFilter],
  );

  return (
    <SquadStandingsGrid
      columns={columns}
      focusSquadId={focusSquadId}
      rows={rows}
      searchable={searchable}
      testIdPrefix="championship"
    />
  );
}

/** A matrix count that opens the contests behind it; pressed while the list shows them. */
function CountButton({
  count,
  isActive,
  label,
  onClick,
  testId,
}: {
  count: number;
  isActive: boolean;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <Button
      aria-label={label}
      aria-pressed={isActive}
      className={cn('font-semibold tabular-nums', !isActive && 'text-primary underline-offset-2 hover:underline')}
      data-testid={testId}
      onClick={onClick}
      size="xs"
      variant={isActive ? 'primary' : 'ghost'}
    >
      {count}
    </Button>
  );
}
