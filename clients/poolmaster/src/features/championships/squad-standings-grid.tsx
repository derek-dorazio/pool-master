import { DataGrid } from '@/features/shared/ui';
import type { SquadStandingColumn, SquadStandingRow } from './squad-standing-columns';

const STANDINGS_PER_PAGE = 25;

/**
 * A league's squad standings: the scoreboard grid a page at a time, with search by squad and a
 * jump to the focused squad's row (rules/ux-rules.md §12 rule 7). Without search, as on a squad's
 * own page, there is no jump either: the one row is already there.
 */
export function SquadStandingsGrid<Row extends SquadStandingRow>({
  columns,
  focusSquadId,
  rows,
  searchable = true,
  testIdPrefix,
}: {
  columns: SquadStandingColumn<Row>[];
  focusSquadId: string | null;
  rows: Row[];
  searchable?: boolean;
  /** Names the grid's test ids: `<prefix>-standings` for the table, `<prefix>-standing-<squadId>` per row. */
  testIdPrefix: string;
}) {
  const focusRow = searchable ? rows.find((row) => row.squadId === focusSquadId) : undefined;

  return (
    <DataGrid
      headerTone="scoreboard"
      columns={columns}
      data={rows}
      emptyMessage={rows.length ? 'No squad matches that search.' : 'No squads in this league yet.'}
      getRowId={(row) => row.squadId}
      jumpToRow={focusRow ? { rowId: focusRow.squadId, label: `Jump to ${focusRow.squadName}`, testId: `${testIdPrefix}-standings-jump` } : undefined}
      pageSize={STANDINGS_PER_PAGE}
      rowTestId={(row) => `${testIdPrefix}-standing-${row.squadId}`}
      search={searchable ? { label: 'Find a squad', testId: `${testIdPrefix}-standings-search` } : undefined}
      showColumnFilters={false}
      tableTestId={`${testIdPrefix}-standings`}
    />
  );
}
