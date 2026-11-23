import type { Column, ColumnFiltersState, SortingState } from "@tanstack/react-table";
import { CALENDAR_PERIOD_WORDS, resolveSpan, type CalendarPeriod, type DateSpan, type SpanUnit } from "./data-grid-date-spans";
import {
  columnTypeOf,
  type DataGridColumnType,
  type DataGridFilter,
  type DateRangeMatch,
  type EnumMatch,
  type NumberMatch,
  type TextMatch,
} from "./data-grid-filters";
import type { DisplayPreferences } from "./date-time-format";

/**
 * A grid's column filters and sort in the page link (#1842), one query parameter per grid, so a
 * filtered grid can be bookmarked or shared. The parameter is compact JSON:
 * `{"s":"-name","f":{"status":{...}}}`, `s` the sorted column with `-` for descending and `f`
 * each column's filter. A date filter keeps its span, not its instants, so "Past 2 hours" opened
 * tomorrow means the two hours before tomorrow's opening. Anything the grid can't use (an
 * unknown column, a column that no longer sorts or filters, a value of the wrong shape) is
 * dropped, never an error.
 */

/** What a grid keeps: its sort and its column filters, as TanStack holds them. */
export type GridUrlState = { sorting: SortingState; filters: ColumnFiltersState };

type StoredFilter =
  | Exclude<DataGridFilter, { kind: "date" }>
  | { kind: "date"; span: DateSpan; match: DateRangeMatch };

const TEXT_MATCHES: readonly TextMatch[] = ["contains", "startsWith"];
const ENUM_MATCHES: readonly EnumMatch[] = ["any", "all"];
const NUMBER_MATCHES: readonly NumberMatch[] = ["between", "equals", "notEqual", "blank", "notBlank"];
const RANGE_MATCHES: readonly DateRangeMatch[] = ["overlaps", "startsWithin", "endsWithin"];
const SPAN_UNITS: readonly SpanUnit[] = ["m", "h", "d", "w"];
const PERIODS = Object.keys(CALENDAR_PERIOD_WORDS) as CalendarPeriod[];

/** The grid's state as its link parameter; null when there is nothing to keep. */
export function encodeGridState(state: GridUrlState): string | null {
  const sorted = state.sorting.at(0);
  const filters = Object.fromEntries(state.filters.map(({ id, value }) => [id, storedFilter(value as DataGridFilter)]));
  const stored: { s?: string; f?: Record<string, StoredFilter> } = {};
  if (sorted) stored.s = `${sorted.desc ? "-" : ""}${sorted.id}`;
  if (state.filters.length > 0) stored.f = filters;
  return stored.s === undefined && stored.f === undefined ? null : JSON.stringify(stored);
}

function storedFilter(filter: DataGridFilter): StoredFilter {
  return filter.kind === "date" ? { kind: "date", span: filter.span, match: filter.match } : filter;
}

/** The kind of column a parameter's entry may name: its type, and whether it still sorts or filters. */
export type GridUrlColumn = { id: string; type: DataGridColumnType | undefined; canSort: boolean; canFilter: boolean };

/** The grid's columns as the link may name them; a grid that shows no filters takes none from it. */
export function gridUrlColumns<TData>(columns: Column<TData>[], showsFilters: boolean): GridUrlColumn[] {
  return columns.map((column) => ({
    id: column.id,
    type: columnTypeOf(column),
    canSort: column.getCanSort(),
    canFilter: showsFilters && column.getCanFilter(),
  }));
}

/**
 * A link parameter read back into the grid's state, keeping only what these columns can use;
 * null when the parameter is missing or unreadable. A date span is resolved against `now`.
 */
export function decodeGridState(
  raw: string | null,
  columns: readonly GridUrlColumn[],
  preferences: DisplayPreferences,
  now: number = Date.now(),
): GridUrlState | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const byId = new Map(columns.map((column) => [column.id, column]));

  const sorting: SortingState = [];
  if (typeof parsed.s === "string") {
    const desc = parsed.s.startsWith("-");
    const id = desc ? parsed.s.slice(1) : parsed.s;
    if (byId.get(id)?.canSort) sorting.push({ id, desc });
  }

  const filters: ColumnFiltersState = [];
  if (isRecord(parsed.f)) {
    for (const [id, value] of Object.entries(parsed.f)) {
      const column = byId.get(id);
      const filter = column?.canFilter && column.type ? readFilter(value, column.type, preferences, now) : null;
      if (filter) filters.push({ id, value: filter });
    }
  }
  return { sorting, filters };
}

function readFilter(value: unknown, type: DataGridColumnType, preferences: DisplayPreferences, now: number): DataGridFilter | null {
  if (!isRecord(value)) return null;
  switch (type.kind) {
    case "text":
      return value.kind === "text" && typeof value.term === "string" && value.term !== "" && oneOf(value.match, TEXT_MATCHES)
        ? { kind: "text", term: value.term, match: value.match }
        : null;
    case "enum":
    case "boolean":
      return value.kind === "enum" && isStringList(value.values) && value.values.length > 0 && oneOf(value.match, ENUM_MATCHES)
        ? { kind: "enum", values: value.values, match: value.match }
        : null;
    case "number":
      return value.kind === "number" && oneOf(value.match, NUMBER_MATCHES) && isBound(value.from) && isBound(value.to)
        ? { kind: "number", match: value.match, from: value.from, to: value.to }
        : null;
    case "date":
    case "datetime":
    case "dateRange": {
      const span = readSpan(value.span);
      if (value.kind !== "date" || span === null || !oneOf(value.match, RANGE_MATCHES)) return null;
      return { kind: "date", span, ...resolveSpan(span, now, preferences), timeZone: preferences.timeZone, match: value.match };
    }
  }
}

function readSpan(value: unknown): DateSpan | null {
  if (!isRecord(value)) return null;
  if (value.kind === "relative") {
    const { amount } = value;
    return oneOf(value.toward, ["past", "next"] as const) && oneOf(value.unit, SPAN_UNITS) && typeof amount === "number" && Number.isInteger(amount) && amount > 0
      ? { kind: "relative", toward: value.toward, amount, unit: value.unit }
      : null;
  }
  if (value.kind === "calendar") {
    return oneOf(value.period, PERIODS) ? { kind: "calendar", period: value.period } : null;
  }
  if (value.kind === "between") {
    const { from, to } = value;
    if (!isInstantOrOpen(from) || !isInstantOrOpen(to) || (from === null && to === null)) return null;
    return from !== null && to !== null && Date.parse(from) > Date.parse(to) ? null : { kind: "between", from, to };
  }
  return null;
}

/** A parsed object whose fields are still to be checked, by the names this link uses. */
type Unchecked = Partial<Record<"s" | "f" | "kind" | "term" | "match" | "values" | "from" | "to" | "span" | "toward" | "amount" | "unit" | "period", unknown>>;

function isRecord(value: unknown): value is Unchecked {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): value is T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value);
}

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isBound(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isInstantOrOpen(value: unknown): value is string | null {
  return value === null || (typeof value === "string" && !Number.isNaN(Date.parse(value)));
}
