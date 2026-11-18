import type { Column, Table } from "@tanstack/react-table";
import { useState } from "react";
import { DataGridDateFilter } from "./data-grid-date-filter";
import { DataGridFilterPopup } from "./data-grid-filter-popup";
import {
  columnOptions,
  columnTypeOf,
  type DataGridFilter,
  type DataGridOption,
  type EnumMatch,
  type NumberMatch,
  type TextMatch,
} from "./data-grid-filters";
import { Checkbox, Input, Select } from "./form-field";

export type ColumnFilterProps<TData> = {
  column: Column<TData>;
  label: string;
  table: Table<TData>;
  testId: string;
};

/** An enum list longer than this gets a search box; a shorter one is read at a glance. */
const SEARCH_ABOVE = 8;

/** A column's filter in its header, by the column's type: a checkbox list, a text match, a number match or a date span. */
export function DataGridColumnFilter<TData>(props: ColumnFilterProps<TData>) {
  switch (columnTypeOf(props.column)?.kind) {
    case "enum":
    case "boolean":
      return <EnumColumnFilter {...props} />;
    case "text":
      return <TextColumnFilter {...props} />;
    case "number":
      return <NumberColumnFilter {...props} />;
    case "date":
    case "datetime":
    case "dateRange":
      return <DataGridDateFilter {...props} />;
    case undefined:
      return null;
  }
}

function currentFilter<TData>(column: Column<TData>): DataGridFilter | undefined {
  return column.getFilterValue() as DataGridFilter | undefined;
}

/**
 * An enumerated column's filter: a checkbox per value, Select all, a search box for a long list,
 * and Match any or Match all for a column holding several values per cell. Nothing ticked can't be
 * applied; Clear is how the filter goes.
 */
function EnumColumnFilter<TData>({ column, label, table, testId }: ColumnFilterProps<TData>) {
  const options = columnOptions(table, column);
  const type = columnTypeOf(column);
  const manyPerCell = type?.kind === "enum" && type.manyPerCell === true;
  const [open, setOpen] = useState(false);
  const [ticked, setTicked] = useState<readonly string[]>([]);
  const [match, setMatch] = useState<EnumMatch>("any");
  const [search, setSearch] = useState("");

  const onOpenChange = (next: boolean) => {
    if (next) {
      const filter = currentFilter(column);
      // No filter in force reads as every value ticked.
      setTicked(filter?.kind === "enum" ? filter.values : options.map((option) => option.value));
      setMatch(filter?.kind === "enum" ? filter.match : "any");
      setSearch("");
    }
    setOpen(next);
  };
  const apply = () => {
    const everyValue = ticked.length === options.length && match === "any";
    column.setFilterValue(everyValue ? undefined : { kind: "enum", values: ticked, match });
    setOpen(false);
  };
  const clear = () => {
    column.setFilterValue(undefined);
    setOpen(false);
  };

  const term = search.trim().toLowerCase();
  const shown = term ? options.filter((option) => option.label.toLowerCase().includes(term)) : options;
  const shownTicked = shown.filter((option) => ticked.includes(option.value)).length;
  const toggle = (option: DataGridOption, checked: boolean) =>
    setTicked((current) =>
      options
        .map(({ value }) => value)
        .filter((value) => (value === option.value ? checked : current.includes(value))),
    );
  // Select all ticks or unticks the values the search shows, leaving the others as they are.
  const selectAll = (checked: boolean) => {
    const shownValues = new Set(shown.map((option) => option.value));
    setTicked((current) =>
      options.map(({ value }) => value).filter((value) => (shownValues.has(value) ? checked : current.includes(value))),
    );
  };

  return (
    <DataGridFilterPopup
      canApply={ticked.length > 0}
      help={
        manyPerCell
          ? "Tick the values to show. Match any shows a row holding any ticked value; Match all, only rows holding every one. With nothing ticked, Apply is off: Clear removes the filter."
          : "Tick the values to show. With nothing ticked, Apply is off: Clear removes the filter."
      }
      isFiltered={currentFilter(column) !== undefined}
      label={label}
      onApply={apply}
      onClear={clear}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
    >
      {manyPerCell ? (
        <Select
          aria-label="Match"
          className="h-8 py-1 text-xs"
          data-testid={`${testId}-match`}
          onChange={(event) => setMatch(event.target.value === "all" ? "all" : "any")}
          value={match}
        >
          <option value="any">Match any</option>
          <option value="all">Match all</option>
        </Select>
      ) : null}
      {options.length > SEARCH_ABOVE ? (
        <Input
          aria-label={`Search ${label} values`}
          className="h-8 py-1 text-xs sm:text-xs"
          data-testid={`${testId}-search`}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search values"
          type="search"
          value={search}
        />
      ) : null}
      <label className="flex items-center gap-2 font-medium">
        <Checkbox
          checked={shown.length > 0 && shownTicked === shown.length}
          data-testid={`${testId}-all`}
          indeterminate={shownTicked > 0 && shownTicked < shown.length}
          onChange={(event) => selectAll(event.target.checked)}
        />
        Select all
      </label>
      <div className="grid max-h-60 gap-1.5 overflow-y-auto">
        {shown.map((option) => (
          <label className="flex items-center gap-2" key={option.value}>
            <Checkbox
              checked={ticked.includes(option.value)}
              data-testid={`${testId}-option-${option.value}`}
              onChange={(event) => toggle(option, event.target.checked)}
            />
            <span className="min-w-0 truncate">{option.label}</span>
          </label>
        ))}
      </div>
    </DataGridFilterPopup>
  );
}

/** A text column's filter: rows whose value contains, or starts with, what is typed, ignoring case. */
function TextColumnFilter<TData>({ column, label, testId }: ColumnFilterProps<TData>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [match, setMatch] = useState<TextMatch>("contains");

  const onOpenChange = (next: boolean) => {
    if (next) {
      const filter = currentFilter(column);
      setTerm(filter?.kind === "text" ? filter.term : "");
      setMatch(filter?.kind === "text" ? filter.match : "contains");
    }
    setOpen(next);
  };
  const apply = () => {
    column.setFilterValue(term.trim() ? { kind: "text", term: term.trim(), match } : undefined);
    setOpen(false);
  };
  const clear = () => {
    column.setFilterValue(undefined);
    setOpen(false);
  };

  return (
    <DataGridFilterPopup
      canApply
      help="Type to match. Contains shows rows holding it anywhere; Starts with, only rows beginning with it. Case is ignored."
      isFiltered={currentFilter(column) !== undefined}
      label={label}
      onApply={apply}
      onClear={clear}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
    >
      <div className="flex gap-2">
        <Input
          aria-label={`${label} ${match === "startsWith" ? "starts with" : "contains"}`}
          className="h-9 min-w-0 flex-1 text-sm"
          data-autofocus=""
          data-testid={`${testId}-term`}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={match === "startsWith" ? "Starts with" : "Contains"}
          value={term}
        />
        <MatchSelect
          onChange={(value) => setMatch(value === "startsWith" ? "startsWith" : "contains")}
          options={TEXT_MATCHES}
          symbol="≈"
          testId={testId}
          value={match}
        />
      </div>
    </DataGridFilterPopup>
  );
}

const TEXT_MATCHES: readonly DataGridOption[] = [
  { value: "contains", label: "Contains" },
  { value: "startsWith", label: "Starts with" },
];

const NUMBER_MATCHES: readonly DataGridOption[] = [
  { value: "between", label: "Between" },
  { value: "equals", label: "Equals" },
  { value: "notEqual", label: "Not equal" },
  { value: "blank", label: "Is blank" },
  { value: "notBlank", label: "Is not blank" },
];

/**
 * The small match button beside a filter's input: a compact list of the ways the input can
 * match, marked with the type's symbol (≈ for text, ↔ for numbers).
 */
export function MatchSelect({
  onChange,
  options,
  symbol,
  testId,
  value,
}: {
  onChange: (value: string) => void;
  options: readonly DataGridOption[];
  symbol: string;
  testId: string;
  value: string;
}) {
  return (
    <label className="relative flex shrink-0 items-center">
      <span aria-hidden="true" className="pointer-events-none absolute left-2 text-xs text-muted-foreground">
        {symbol}
      </span>
      <Select
        aria-label="Match"
        className="h-9 w-auto py-1 pl-6 text-xs"
        data-testid={`${testId}-match`}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </label>
  );
}

function isNumberMatch(value: string): value is NumberMatch {
  return NUMBER_MATCHES.some((option) => option.value === value);
}

/** A number typed in a box: null when blank or not a number. */
function numberOf(text: string): number | null {
  const trimmed = text.trim();
  const value = trimmed === "" ? Number.NaN : Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * A number column's filter: From and To for Between (either or both), one value for Equals and
 * Not equal, nothing for the blank tests.
 */
function NumberColumnFilter<TData>({ column, label, testId }: ColumnFilterProps<TData>) {
  const [open, setOpen] = useState(false);
  const [match, setMatch] = useState<NumberMatch>("between");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const onOpenChange = (next: boolean) => {
    if (next) {
      const filter = currentFilter(column);
      setMatch(filter?.kind === "number" ? filter.match : "between");
      setFrom(filter?.kind === "number" && filter.from !== null ? String(filter.from) : "");
      setTo(filter?.kind === "number" && filter.to !== null ? String(filter.to) : "");
    }
    setOpen(next);
  };
  const needsValue = match === "equals" || match === "notEqual";
  const fromValue = numberOf(from);
  const toValue = numberOf(to);
  const canApply =
    match === "between" ? fromValue !== null || toValue !== null : needsValue ? fromValue !== null : true;
  const apply = () => {
    column.setFilterValue({
      kind: "number",
      match,
      from: match === "between" || needsValue ? fromValue : null,
      to: match === "between" ? toValue : null,
    });
    setOpen(false);
  };
  const clear = () => {
    column.setFilterValue(undefined);
    setOpen(false);
  };

  return (
    <DataGridFilterPopup
      canApply={canApply}
      help="Between shows rows from the first number to the second, both included; fill only From for at least, only To for at most. Blank rows show only for Is blank."
      isFiltered={currentFilter(column) !== undefined}
      label={label}
      onApply={apply}
      onClear={clear}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
    >
      <div className="flex items-center gap-2">
        {match === "between" || needsValue ? (
          <Input
            aria-label={match === "between" ? `${label} from` : `${label} value`}
            className="h-9 min-w-0 flex-1 text-sm"
            data-autofocus=""
            data-testid={`${testId}-from`}
            inputMode="decimal"
            onChange={(event) => setFrom(event.target.value)}
            placeholder={match === "between" ? "From" : "Value"}
            value={from}
          />
        ) : null}
        {match === "between" ? (
          <Input
            aria-label={`${label} to`}
            className="h-9 min-w-0 flex-1 text-sm"
            data-testid={`${testId}-to`}
            inputMode="decimal"
            onChange={(event) => setTo(event.target.value)}
            placeholder="To"
            value={to}
          />
        ) : null}
        <MatchSelect
          onChange={(value) => setMatch(isNumberMatch(value) ? value : "between")}
          options={NUMBER_MATCHES}
          symbol="↔"
          testId={testId}
          value={match}
        />
      </div>
    </DataGridFilterPopup>
  );
}
