import {
  filterFns,
  getSortedRowModel,
  type Column,
  type ColumnDef,
  type Row,
  type RowModel,
  type SortingFn,
  type Table,
} from "@tanstack/react-table";
import {
  describeSpan,
  type DateDirection,
  type DateSpan,
} from "./data-grid-date-spans";
import {
  formatGridDate,
  isDateOnly,
  startOfZonedDay,
  type DateDisplayFormat,
  type DisplayPreferences,
} from "./date-time-format";

/**
 * The column types a DataGrid knows and the filters each holds (rules/ux-rules.md §12 rule 7).
 * A column declares its type in `meta.type`; the grid then supplies the filter popup, the match,
 * the sort and, for numbers and dates, the cell's look. TanStack Table holds the state and runs
 * its own sorting and filter functions where one fits.
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

/** A date column's direction (required: it decides the quick list) and how its cells write dates. */
export type DataGridDates = {
  /** Which way the values lie: `past` (Last run), `future` (Expires) or `both` (Starts). */
  direction: DateDirection;
  /** Month as a word, "Mar 05, 2027" (the default), or as a number, "03/05/2027". */
  format?: DateDisplayFormat;
  /** The words a blank cell shows, such as "Never" for an invite that does not expire; omitted, nothing. */
  blank?: string;
};

/**
 * What a column holds. A column with no type (row actions, an editable input) neither sorts
 * nor filters.
 * - `text`: Contains or Starts with, ignoring case; sorts A to Z.
 * - `enum`: a checkbox per value (`DataGridColumnOptions`); sorts in the declared order.
 * - `boolean`: Yes and No, and (Blank) when `nullable`; sorts Yes first.
 * - `number`: Between, Equals, Not equal, Is blank, Is not blank; sorts by size, right-aligned.
 * - `date`, `datetime`: a span (Past 2 hours, Previous month, a typed or picked range); sorts by
 *   the instant. The value is the stored date, never a formatted one: the grid writes the cell.
 * - `dateRange`: `{ start, end }`, matched by Overlaps, Starts within or Ends within; sorts by
 *   start, then end.
 */
export type DataGridColumnType =
  | { kind: "text" }
  | ({ kind: "enum" } & DataGridColumnOptions)
  | { kind: "boolean"; nullable?: boolean }
  | { kind: "number" }
  | ({ kind: "date" | "datetime" | "dateRange" } & DataGridDates);

export type DataGridColumnKind = DataGridColumnType["kind"];

/** A dateRange column's value: either end may be blank, leaving that side open. */
export type DateRangeValue = { start: string | null; end: string | null };

/** An enumerated column's values from a map of each value to its words, in the map's order. */
export function optionsFromLabels(labels: Readonly<Record<string, string>>): DataGridOption[] {
  return Object.entries(labels).map(([value, label]) => ({ value, label }));
}

/** The value "(None)" and "(Blank)" stand for: a cell holding no value. */
export const NO_VALUE = "\u0000none";

export type EnumMatch = "any" | "all";
export type TextMatch = "contains" | "startsWith";
export type NumberMatch = "between" | "equals" | "notEqual" | "blank" | "notBlank";
export type DateRangeMatch = "overlaps" | "startsWithin" | "endsWithin";

/** An enumerated or yes/no column's filter: the ticked values, never empty. */
export type EnumFilter = { kind: "enum"; values: readonly string[]; match: EnumMatch };
/** A text column's filter: rows whose value contains, or starts with, the term, ignoring case. */
export type TextFilter = { kind: "text"; term: string; match: TextMatch };
/**
 * A number column's filter. Between takes either bound or both (only From is "at least", only
 * To "at most"); Equals and Not equal take `from`; the blank tests take neither.
 */
export type NumberFilter = { kind: "number"; match: NumberMatch; from: number | null; to: number | null };
/**
 * A date column's filter: the span as chosen, and the instants it covered when applied, so a
 * relative span keeps its name. `timeZone` places a calendar date ("2027-03-05") on the timeline.
 */
export type DateFilter = {
  kind: "date";
  span: DateSpan;
  from: number | null;
  to: number | null;
  timeZone: string;
  /** dateRange columns only: how a row's range must meet the span. */
  match: DateRangeMatch;
};
export type DataGridFilter = EnumFilter | TextFilter | NumberFilter | DateFilter;

export function columnTypeOf<TData>(column: Column<TData>): DataGridColumnType | undefined {
  return column.columnDef.meta?.type;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
}

/** True for a cell holding nothing: no value, null, "", an empty list, or a range with neither end. */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object" && !(value instanceof Date)) {
    return Object.values(value).every((part) => part === null || part === undefined || part === "");
  }
  return false;
}

function cellValues(value: unknown): string[] {
  if (isBlankValue(value)) {
    return [];
  }
  return Array.isArray(value) ? value.map(asText) : [asText(value)];
}

/** The first and last instant a stored date covers: its instant, or a calendar date's whole day. */
function instantsOf(value: unknown, timeZone: string): { first: number; last: number } | null {
  if (isDateOnly(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return { first: startOfZonedDay(year, month, day, timeZone), last: startOfZonedDay(year, month, day + 1, timeZone) - 1 };
  }
  const instant = value instanceof Date ? value.getTime() : typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(instant) ? null : { first: instant, last: instant };
}

function within(instants: { first: number; last: number } | null, filter: DateFilter): boolean {
  return (
    instants !== null &&
    (filter.from === null || instants.last >= filter.from) &&
    (filter.to === null || instants.first <= filter.to)
  );
}

function matchesDate(value: unknown, filter: DateFilter): boolean {
  if (isBlankValue(value)) {
    return false;
  }
  if (typeof value !== "object" || value instanceof Date) {
    return within(instantsOf(value, filter.timeZone), filter);
  }
  const { start, end } = value as DateRangeValue;
  const first = start === null ? null : instantsOf(start, filter.timeZone);
  const last = end === null ? null : instantsOf(end, filter.timeZone);
  if (filter.match === "startsWithin") return within(first, filter);
  if (filter.match === "endsWithin") return within(last, filter);
  // Overlaps: an open end reaches as far as it needs to.
  return (
    (filter.to === null || first === null || first.first <= filter.to) &&
    (filter.from === null || last === null || last.last >= filter.from)
  );
}

function matchesNumber(value: unknown, filter: NumberFilter): boolean {
  const blank = typeof value !== "number" || Number.isNaN(value);
  if (filter.match === "blank") return blank;
  if (filter.match === "notBlank") return !blank;
  if (blank) return false;
  if (filter.match === "equals") return value === filter.from;
  if (filter.match === "notEqual") return value !== filter.from;
  return value >= (filter.from ?? -Infinity) && value <= (filter.to ?? Infinity);
}

/**
 * Whether a row passes a column's filter. Text uses TanStack's own `includesString` for
 * Contains. An enum matches exactly: TanStack's `arrIncludesSome` would match a part of a word
 * ("COMPLETED" inside "COMPLETED WITH WARNINGS") and reads an empty list as no filter.
 */
export function matchesFilter<TData>(row: Row<TData>, columnId: string, filter: DataGridFilter): boolean {
  const value = row.getValue(columnId);
  switch (filter.kind) {
    case "text":
      return filter.match === "startsWith"
        ? !isBlankValue(value) && asText(value).toLowerCase().startsWith(filter.term.toLowerCase())
        : filterFns.includesString(row, columnId, filter.term, () => undefined);
    case "number":
      return matchesNumber(value, filter);
    case "date":
      return matchesDate(value, filter);
    case "enum": {
      const values = cellValues(value);
      const holds = (ticked: string) => (ticked === NO_VALUE ? values.length === 0 : values.includes(ticked));
      return filter.match === "all" ? filter.values.every(holds) : filter.values.some(holds);
    }
  }
}

const YES_NO: DataGridOption[] = [
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

/** The values a list filter offers: an enum's declared ones, else those in the rows; Yes and No for a yes/no column. */
export function columnOptions<TData>(table: Table<TData>, column: Column<TData>): readonly DataGridOption[] {
  const type = columnTypeOf(column);
  if (type?.kind === "boolean") {
    return type.nullable ? [...YES_NO, { value: NO_VALUE, label: "(Blank)" }] : YES_NO;
  }
  const options = type?.kind === "enum" ? type : undefined;
  const declared = options?.values ?? foundOptions(table, column, options?.label);
  return options?.manyPerCell ? [...declared, { value: NO_VALUE, label: "(None)" }] : declared;
}

function foundOptions<TData>(table: Table<TData>, column: Column<TData>, label = (value: string) => value): DataGridOption[] {
  const found = new Set(table.getCoreRowModel().rows.flatMap((row) => cellValues(row.getValue(column.id))));
  return [...found]
    .map((value) => ({ value, label: label(value) }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

// TanStack's built-in sorts where one fits: `text` for words, `basic` for numbers and yes/no
// (inverted, so Yes comes first), `datetime` for stored dates, which compare as written.
const BUILT_IN_SORT: Partial<Record<DataGridColumnKind, "text" | "basic" | "datetime">> = {
  text: "text",
  number: "basic",
  boolean: "basic",
  date: "datetime",
  datetime: "datetime",
};

/**
 * The grid's columns, each typed one sorting and filtering as its type says, and each untyped
 * one doing neither. A column naming its own filter or sort keeps it.
 */
// `any` as in DataGrid's own `columns`: TanStack's ColumnDef is invariant in its value type.
export function withGridFilters<TData>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  columns: ColumnDef<TData, any>[],
  preferences: DisplayPreferences,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ColumnDef<TData, any>[] {
  return columns.map((column) => {
    const type = column.meta?.type;
    if (type === undefined) {
      return { enableSorting: false, enableColumnFilter: false, ...column };
    }
    const write = cellWriter(type, preferences);
    return {
      ...column,
      ...(write && column.cell === undefined ? { cell: ({ getValue }: { getValue: () => unknown }) => write(getValue()) } : {}),
      filterFn: column.filterFn ?? matchesFilter,
      sortingFn: column.sortingFn ?? sortingFnFor<TData>(type),
      ...(type.kind === "boolean" && column.invertSorting === undefined ? { invertSorting: true } : {}),
    };
  });
}

/**
 * How the grid writes a typed cell the column leaves to it: dates in the member's locale, zone
 * and clock, padded (`formatGridDate`); a range as both ends in full; yes/no as Yes or No.
 */
function cellWriter(type: DataGridColumnType, preferences: DisplayPreferences): ((value: unknown) => string) | null {
  if (type.kind === "boolean") {
    return (value) => (value === true ? "Yes" : value === false ? "No" : "");
  }
  if (type.kind !== "date" && type.kind !== "datetime" && type.kind !== "dateRange") {
    return null;
  }
  const options = { format: type.format ?? "words", withTime: type.kind === "datetime" };
  const date = (value: unknown) =>
    typeof value === "string" || value instanceof Date ? formatGridDate(value, options, preferences) : "";
  if (type.kind !== "dateRange") {
    return (value) => date(value) || (type.blank ?? "");
  }
  return (value) => {
    const range = value as DateRangeValue | null | undefined;
    if (!range || isBlankValue(range)) return type.blank ?? "";
    return `${date(range.start) || "…"} – ${date(range.end) || "…"}`;
  };
}

/** The cell look a column type sets: numbers right-aligned, numbers and dates in even-width figures on one line. */
export function columnTypeClassName(type: DataGridColumnType | undefined): string | undefined {
  if (type?.kind === "number") return "text-right tabular-nums";
  if (type?.kind === "date" || type?.kind === "datetime" || type?.kind === "dateRange") return "whitespace-nowrap tabular-nums";
  return undefined;
}

function sortingFnFor<TData>(type: DataGridColumnType): SortingFn<TData> | "text" | "basic" | "datetime" | "auto" {
  if (type.kind === "enum") return type.values ? byDeclaredOrder<TData>(type.values) : "text";
  if (type.kind === "dateRange") return byStartThenEnd;
  return BUILT_IN_SORT[type.kind] ?? "auto";
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

/** A dateRange column sorts by start, then by end; a missing end sorts after any date. */
function byStartThenEnd<TData>(left: Row<TData>, right: Row<TData>, columnId: string): number {
  const a = left.getValue<DateRangeValue | null>(columnId);
  const b = right.getValue<DateRangeValue | null>(columnId);
  const compare = (x: string | null | undefined, y: string | null | undefined) =>
    x === y ? 0 : x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1;
  return compare(a?.start, b?.start) || compare(a?.end, b?.end);
}

/**
 * TanStack's sorted rows, with the rows whose sorted cell is blank (nothing, null, "", an empty
 * list or a range with neither end) moved to the end in the data's order, whichever way the
 * column sorts. TanStack's own `sortUndefined: "last"` only knows `undefined`: its sorts read
 * null and "" as 0 or the empty word, which sorts first ascending, and a descending sort turns a
 * blank ranked last into first. The grid sorts one column at a time, so the sorted column
 * decides what is blank.
 */
export function getBlanksLastSortedRowModel<TData>(): (table: Table<TData>) => () => RowModel<TData> {
  return (table) => {
    const sorted = getSortedRowModel<TData>()(table);
    let last: { input: RowModel<TData>; output: RowModel<TData> } | undefined;
    return () => {
      const input = sorted();
      const columnId = table.getState().sorting.at(0)?.id;
      if (columnId === undefined) {
        return input;
      }
      if (last?.input !== input) {
        last = { input, output: blanksLast(input, columnId) };
      }
      return last.output;
    };
  };
}

function blanksLast<TData>(model: RowModel<TData>, columnId: string): RowModel<TData> {
  const isBlank = (row: Row<TData>) => isBlankValue(row.getValue(columnId));
  const blanks = model.rows.filter(isBlank).sort((left, right) => left.index - right.index);
  const rows = [...model.rows.filter((row) => !isBlank(row)), ...blanks];
  const flatRows = rows.flatMap((row) => [row, ...row.getLeafRows()]);
  return { rows, flatRows, rowsById: model.rowsById };
}

/** The column filters the grid opens with: each enumerated column that starts on some values. */
export function initialFilters<TData>(table: Table<TData>): { id: string; value: EnumFilter }[] {
  return table.getAllLeafColumns().flatMap((column) => {
    const type = columnTypeOf(column);
    const initial = type?.kind === "enum" ? type.initial : undefined;
    return initial && initial.length > 0
      ? [{ id: column.id, value: { kind: "enum" as const, values: initial, match: "any" as const } }]
      : [];
  });
}

const NUMBER_WORDS: Record<NumberMatch, string> = {
  between: "between",
  equals: "=",
  notEqual: "≠",
  blank: "blank",
  notBlank: "not blank",
};

const DATE_RANGE_WORDS: Record<DateRangeMatch, string> = {
  overlaps: "",
  startsWithin: "starts ",
  endsWithin: "ends ",
};

/**
 * How the "Filtered:" line names a column's filter: "2 of 5" (or the ticked words for a yes/no
 * column), "all 2 of 5", "contains “rav”", "≥ 10", "Past 2 hours".
 */
export function describeFilter(
  filter: DataGridFilter,
  options: readonly DataGridOption[],
  preferences: DisplayPreferences,
  type: DataGridColumnType | undefined,
): string {
  switch (filter.kind) {
    case "text":
      return `${filter.match === "startsWith" ? "starts with" : "contains"} “${filter.term}”`;
    case "number": {
      const { from, to, match } = filter;
      if (match === "between") {
        if (from !== null && to !== null) return `${from} to ${to}`;
        return from !== null ? `≥ ${from}` : `≤ ${to ?? ""}`;
      }
      return match === "equals" || match === "notEqual" ? `${NUMBER_WORDS[match]} ${from ?? ""}` : NUMBER_WORDS[match];
    }
    case "date":
      return `${type?.kind === "dateRange" ? DATE_RANGE_WORDS[filter.match] : ""}${describeSpan(
        filter.span,
        preferences,
        type?.kind !== "date",
      )}`;
    case "enum": {
      if (type?.kind === "boolean") {
        return options.filter((option) => filter.values.includes(option.value)).map((option) => option.label).join(" or ");
      }
      const count = `${filter.values.length} of ${options.length}`;
      return filter.match === "all" ? `all ${count}` : count;
    }
  }
}
