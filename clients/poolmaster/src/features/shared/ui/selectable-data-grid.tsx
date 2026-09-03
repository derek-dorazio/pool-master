import { useMemo } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { createColumnHelper } from "@tanstack/react-table";
import { Checkbox } from "./form-field";
import { DataGrid } from "./data-grid";

export type SelectableDataGridProps<TData> = {
  columns: ColumnDef<TData, any>[];
  data: TData[];
  emptyMessage: string;
  getRowId: (row: TData, index: number) => string;
  /** Accessible name for a row's checkbox (defaults to the row id). */
  getRowLabel?: (row: TData) => string;
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], nextSelected: boolean) => void;
  rowTestId?: (row: TData, index: number) => string;
  tableTestId?: string;
  filterTestIdPrefix?: string;
  selectTestIdPrefix?: string;
};

type SelectionMeta<TData> = {
  selectedIds: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: (ids: string[], nextSelected: boolean) => void;
  selectTestIdPrefix: string;
  getRowLabel: (row: TData) => string;
};

const selectColumnHelper = createColumnHelper<{ readonly __selectable: true }>();

/**
 * plans/124 §6.4 — `DataGrid` with a leading checkbox column and a header
 * "select all" (with an indeterminate state for a partial selection). No
 * row-selection capability exists on the base `DataGrid` (`data-grid.tsx`), so
 * this is a new primitive, not a prop. First consumer is the golf Field
 * editor's "Add More Participants" league-browse grid (pool-master-za4).
 */
export function SelectableDataGrid<TData>({
  columns,
  data,
  emptyMessage,
  getRowId,
  getRowLabel,
  selectedIds,
  onToggle,
  onToggleAll,
  rowTestId,
  tableTestId,
  filterTestIdPrefix,
  selectTestIdPrefix = "selectable-data-grid-select",
}: SelectableDataGridProps<TData>) {
  const meta = useMemo<SelectionMeta<TData>>(
    () => ({
      selectedIds,
      onToggle,
      onToggleAll,
      selectTestIdPrefix,
      getRowLabel: getRowLabel ?? ((_row) => "row"),
    }),
    [getRowLabel, onToggle, onToggleAll, selectTestIdPrefix, selectedIds],
  );

  const allColumns = useMemo(() => {
    const selectColumn = selectColumnHelper.display({
      id: "__select",
      header: ({ table }) => {
        const selectionMeta = table.options.meta as SelectionMeta<TData>;
        const ids = table.getRowModel().rows.map((row) => row.id);
        const selectedCount = ids.filter((id) =>
          selectionMeta.selectedIds.has(id),
        ).length;
        const allSelected = ids.length > 0 && selectedCount === ids.length;
        return (
          <Checkbox
            aria-label="Select all rows"
            checked={allSelected}
            data-testid={`${selectionMeta.selectTestIdPrefix}-all`}
            indeterminate={selectedCount > 0 && !allSelected}
            onChange={() => selectionMeta.onToggleAll(ids, !allSelected)}
          />
        );
      },
      cell: ({ row, table }) => {
        const selectionMeta = table.options.meta as SelectionMeta<TData>;
        return (
          <Checkbox
            aria-label={`Select ${selectionMeta.getRowLabel(row.original as TData)}`}
            checked={selectionMeta.selectedIds.has(row.id)}
            data-testid={`${selectionMeta.selectTestIdPrefix}-${row.id}`}
            onChange={() => selectionMeta.onToggle(row.id)}
          />
        );
      },
      enableColumnFilter: false,
      enableSorting: false,
    }) as ColumnDef<TData, any>;

    return [selectColumn, ...columns];
  }, [columns]);

  return (
    <DataGrid
      columns={allColumns}
      data={data}
      emptyMessage={emptyMessage}
      filterTestIdPrefix={filterTestIdPrefix}
      getRowId={getRowId}
      meta={meta}
      rowTestId={rowTestId}
      tableTestId={tableTestId}
    />
  );
}
