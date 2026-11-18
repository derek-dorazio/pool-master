import type { Table } from "@tanstack/react-table";
import { Funnel } from "lucide-react";
import { Button } from "./button";
import { columnOptions, columnTypeOf, describeFilter, type DataGridFilter } from "./data-grid-filters";
import { useDisplayPreferences } from "./display-preferences";

/**
 * The line above a filtered grid: every filter in force by its column's name, how many rows of
 * all of them show, and Clear all filters. Nothing while no filter is set.
 */
export function DataGridFilterSummary<TData>({
  labelOf,
  table,
  testId,
}: {
  /** A column's name, as its header and filter say it. */
  labelOf: (columnId: string) => string;
  table: Table<TData>;
  testId: string;
}) {
  const preferences = useDisplayPreferences();
  const filters = table.getState().columnFilters;
  if (filters.length === 0) {
    return null;
  }
  const named = filters.map(({ id, value }) => {
    const column = table.getColumn(id);
    const filter = value as DataGridFilter;
    const options = column && filter.kind === "enum" ? columnOptions(table, column) : [];
    return `${labelOf(id)} (${describeFilter(filter, options, preferences, column && columnTypeOf(column))})`;
  });

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground" data-testid={testId}>
      <Funnel aria-hidden="true" className="size-3.5 text-selected" fill="currentColor" />
      <span>
        <span className="font-semibold text-foreground">Filtered:</span> {named.join(" · ")}
      </span>
      <span data-testid={`${testId}-count`}>
        {table.getFilteredRowModel().rows.length} of {table.getCoreRowModel().rows.length}
      </span>
      <Button data-testid={`${testId}-clear-all`} onClick={() => table.resetColumnFilters(true)} size="sm" variant="link">
        Clear all filters
      </Button>
    </div>
  );
}
