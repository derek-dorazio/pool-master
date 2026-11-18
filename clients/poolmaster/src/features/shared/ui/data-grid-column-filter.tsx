import type { Column, Table } from "@tanstack/react-table";
import { useState } from "react";
import { DataGridFilterPopup } from "./data-grid-filter-popup";
import { columnOptions, type DataGridFilter, type DataGridOption, type EnumMatch } from "./data-grid-filters";
import { Checkbox, Input, Select } from "./form-field";

type ColumnFilterProps<TData> = {
  column: Column<TData>;
  label: string;
  table: Table<TData>;
  testId: string;
};

/** A column's filter in its header: the enum list for an enumerated column, else a text match. */
export function DataGridColumnFilter<TData>(props: ColumnFilterProps<TData>) {
  return props.column.columnDef.meta?.options ? <EnumColumnFilter {...props} /> : <TextColumnFilter {...props} />;
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
  const manyPerCell = column.columnDef.meta?.options?.manyPerCell === true;
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
      {options.length > 8 ? (
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

/** A text column's filter: rows whose value contains what is typed, ignoring case. */
function TextColumnFilter<TData>({ column, label, testId }: ColumnFilterProps<TData>) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");

  const onOpenChange = (next: boolean) => {
    if (next) {
      const filter = currentFilter(column);
      setTerm(filter?.kind === "text" ? filter.term : "");
    }
    setOpen(next);
  };
  const apply = () => {
    column.setFilterValue(term.trim() ? { kind: "text", term: term.trim() } : undefined);
    setOpen(false);
  };
  const clear = () => {
    column.setFilterValue(undefined);
    setOpen(false);
  };

  return (
    <DataGridFilterPopup
      canApply
      help="Type to match. Rows whose value contains it show, ignoring case."
      isFiltered={currentFilter(column) !== undefined}
      label={label}
      onApply={apply}
      onClear={clear}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
    >
      <Input
        aria-label={`${label} contains`}
        className="h-9 text-sm"
        data-testid={`${testId}-term`}
        onChange={(event) => setTerm(event.target.value)}
        placeholder="Contains"
        value={term}
      />
    </DataGridFilterPopup>
  );
}
