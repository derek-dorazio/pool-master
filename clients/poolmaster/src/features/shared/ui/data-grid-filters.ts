import { filterFns, type Column, type ColumnDef, type Row, type SortingFn, type Table } from "@tanstack/react-table";

/**
 * The filters a DataGrid column can hold, and how each matches a row (rules/ux-rules.md §12
 * rule 7). The grid owns the filter UI; TanStack Table holds the state and runs the match.
 */

/** One value an enumerated column can hold, and the words its filter shows for it. */
export type DataGridOption = { value: string; label: string };

/**
 * A column whose values come from a fixed set, such as a sport, a kind or a status: its filter
 * lists one checkbox per value. Its values sort in the order the set gives.
 */
export type DataGridColumnOptions = {
  /**
   * Every value the column can hold, in their natural order (the filter's list and the column's
   * sort follow it). Omitted, the values found in the rows, A to Z by their words.
   */
  values?: readonly DataGridOption[];
  /** The words for a value found in the rows, when `values` is omitted; omitted, the value itself. */
  label?: (value: string) => string;
  /** The values ticked when the grid opens, such as a Status that starts on On; omitted, no filter. */
  initial?: readonly string[];
  /**
   * The cell holds a list of values (an Issues cell holding several types): the filter offers
   * Match any or Match all, and "(None)" for a cell holding none.
   */
  manyPerCell?: boolean;
};

/** An enumerated column's values from a map of each value to its words, in the map's order. */
export function optionsFromLabels(labels: Readonly<Record<string, string>>): DataGridOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** The value "(None)" stands for: a several-per-cell cell holding no value. */
export const NO_VALUE = "\u0000none";

export type EnumMatch = "any" | "all";

/** An enumerated column's filter: the ticked values, never empty. */
export type EnumFilter = { kind: "enum"; values: readonly string[]; match: EnumMatch };
/** A text column's filter: rows whose value contains the term, ignoring case. */
export type TextFilter = { kind: "text"; term: string };
export type DataGridFilter = EnumFilter | TextFilter;

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

function cellValues(value: unknown): string[] {
  if (value === null || value === undefined || value === "") {
    return [];
  }
  return Array.isArray(value) ? value.map(asText) : [asText(value)];
}

/**
 * Whether a row passes a column's filter. An enum matches exactly: TanStack's `arrIncludesSome`
 * would match a part of a word ("COMPLETED" inside "COMPLETED WITH WARNINGS"). Text uses
 * TanStack's own `includesString`.
 */
export function matchesFilter<TData>(row: Row<TData>, columnId: string, filter: DataGridFilter): boolean {
  if (filter.kind === "text") {
    return filterFns.includesString(row, columnId, filter.term, () => undefined);
  }
  const values = cellValues(row.getValue(columnId));
  const holds = (ticked: string) => (ticked === NO_VALUE ? values.length === 0 : values.includes(ticked));
  return filter.match === "all" ? filter.values.every(holds) : filter.values.some(holds);
}

/** The values a column's list offers: the ones it declares, else the ones in the rows. */
export function columnOptions<TData>(table: Table<TData>, column: Column<TData>): readonly DataGridOption[] {
  const options = column.columnDef.meta?.options;
  const declared = options?.values ?? foundOptions(table, column, options?.label);
  return options?.manyPerCell ? [...declared, { value: NO_VALUE, label: "(None)" }] : declared;
}

function foundOptions<TData>(table: Table<TData>, column: Column<TData>, label = (value: string) => value): DataGridOption[] {
  const found = new Set(table.getCoreRowModel().rows.flatMap((row) => cellValues(row.getValue(column.id))));
  return [...found]
    .map((value) => ({ value, label: label(value) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

/**
 * The grid's columns, each filterable one matching through `matchesFilter`, and each enumerated
 * one sorting in its values' order. A column naming its own filter or sort keeps it.
 */
// `any` as in DataGrid's own `columns`: TanStack's ColumnDef is invariant in its value type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function withGridFilters<TData>(columns: ColumnDef<TData, any>[]): ColumnDef<TData, any>[] {
  return columns.map((column) => {
    const values = column.meta?.options?.values;
    return {
      ...column,
      filterFn: column.filterFn ?? matchesFilter,
      ...(values && column.sortingFn === undefined ? { sortingFn: byDeclaredOrder<TData>(values) } : {}),
    };
  });
}

/** Sorts an enumerated column by where each value sits in its declared set; one not in it sorts last. */
function byDeclaredOrder<TData>(values: readonly DataGridOption[]): SortingFn<TData> {
  const rank = new Map(values.map((option, index) => [option.value, index]));
  const rankOf = (value: unknown) => {
    const first = cellValues(value).at(0);
    return first === undefined ? values.length : (rank.get(first) ?? values.length);
  };
  return (left, right, columnId) => rankOf(left.getValue(columnId)) - rankOf(right.getValue(columnId));
}

/** The column filters the grid opens with: each enumerated column that starts on some values. */
export function initialFilters<TData>(table: Table<TData>): { id: string; value: EnumFilter }[] {
  return table.getAllLeafColumns().flatMap((column) => {
    const initial = column.columnDef.meta?.options?.initial;
    return initial && initial.length > 0
      ? [{ id: column.id, value: { kind: "enum" as const, values: initial, match: "any" as const } }]
      : [];
  });
}

/** How the "Filtered:" line names a column's filter: "2 of 5", "Any 2 of 5", "All 2 of 5", or the term. */
export function describeFilter(filter: DataGridFilter, optionCount: number): string {
  if (filter.kind === "text") {
    return `“${filter.term}”`;
  }
  const count = `${filter.values.length} of ${optionCount}`;
  return filter.match === "all" ? `all ${count}` : count;
}
