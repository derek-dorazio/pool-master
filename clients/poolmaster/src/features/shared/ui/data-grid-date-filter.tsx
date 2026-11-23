import { displayString } from "@poolmaster/shared/display-strings";
import { useState } from "react";
import { cn } from "./class-names";
import type { ColumnFilterProps } from "./data-grid-column-filter";
import {
  calendarPeriodLabel,
  calendarPeriods,
  describeSpan,
  parseSpanText,
  quickEntries,
  relativeLabel,
  towardLabel,
  unitWord,
  resolveSpan,
  type DateSpan,
  type QuickEntry,
  type SpanUnit,
} from "./data-grid-date-spans";
import { columnTypeOf, type DataGridFilter, type DateRangeMatch } from "./data-grid-filters";
import { DataGridFilterPopup } from "./data-grid-filter-popup";
import { dateTimeLocalValueToIso } from "./date-time-format";
import { useDisplayPreferences } from "./display-preferences";
import { Input, Select } from "./form-field";

/** The amount an "N" entry starts on, before the viewer types their own. */
const DEFAULT_AMOUNT: Record<SpanUnit, number> = { m: 30, h: 2, d: 3, w: 2 };

const RANGE_MATCHES = [
  { value: "overlaps", label: "word.overlaps" },
  { value: "startsWithin", label: "word.startsWithin" },
  { value: "endsWithin", label: "word.endsWithin" },
] as const satisfies readonly { value: DateRangeMatch; label: string }[];

function sameSpan(left: DateSpan | null, right: DateSpan): boolean {
  return left !== null && JSON.stringify(left) === JSON.stringify(right);
}


/**
 * A date, date and time, or date range column's filter (#1838): the chosen span in a chip, a
 * box that reads a typed span or range, the quick list (Past and Next, some with a number to
 * type), the calendar periods, and a custom range from the calendar. A date range column also
 * picks how a row's range meets the span: Overlaps, Starts within or Ends within.
 */
export function DataGridDateFilter<TData>({ column, label, testId }: ColumnFilterProps<TData>) {
  const preferences = useDisplayPreferences();
  const type = columnTypeOf(column);
  const dates = type?.kind === "date" || type?.kind === "datetime" || type?.kind === "dateRange" ? type : null;
  const direction = dates?.direction ?? "both";
  const withTime = type?.kind !== "date";
  const [open, setOpen] = useState(false);
  const [span, setSpan] = useState<DateSpan | null>(null);
  const [typed, setTyped] = useState("");
  const [typedUnread, setTypedUnread] = useState(false);
  const [match, setMatch] = useState<DateRangeMatch>("overlaps");
  const [amounts, setAmounts] = useState<Record<SpanUnit, string>>(stringAmounts(DEFAULT_AMOUNT));
  const [picking, setPicking] = useState(false);
  const [pickFrom, setPickFrom] = useState("");
  const [pickTo, setPickTo] = useState("");

  const current = column.getFilterValue() as DataGridFilter | undefined;
  const onOpenChange = (next: boolean) => {
    if (next) {
      setSpan(current?.kind === "date" ? current.span : null);
      setMatch(current?.kind === "date" ? current.match : "overlaps");
      setTyped("");
      setTypedUnread(false);
      setPicking(false);
      setPickFrom("");
      setPickTo("");
    }
    setOpen(next);
  };
  const apply = () => {
    if (span === null) return;
    const resolved = resolveSpan(span, Date.now(), preferences);
    column.setFilterValue({ kind: "date", span, ...resolved, timeZone: preferences.timeZone, match });
    setOpen(false);
  };
  const clear = () => {
    column.setFilterValue(undefined);
    setOpen(false);
  };

  const onType = (text: string) => {
    setTyped(text);
    const read = text.trim() ? parseSpanText(text, direction, preferences) : null;
    setTypedUnread(text.trim() !== "" && read === null);
    if (read) setSpan(read);
  };

  const chooseEntry = (entry: QuickEntry) => {
    const amount = entry.amount ?? Number(amounts[entry.unit]);
    if (Number.isInteger(amount) && amount > 0) {
      setSpan({ kind: "relative", toward: entry.toward, amount, unit: entry.unit });
    }
  };
  const onPick = (from: string, to: string) => {
    setPickFrom(from);
    setPickTo(to);
    const boundOf = (value: string, end: boolean) => {
      if (!value) return null;
      const wall = withTime ? value : `${value}T${end ? "23:59" : "00:00"}`;
      const instant = dateTimeLocalValueToIso(wall, preferences.timeZone);
      return instant === undefined ? null : end ? new Date(Date.parse(instant) + 59_999).toISOString() : instant;
    };
    const fromIso = boundOf(from, false);
    const toIso = boundOf(to, true);
    if ((fromIso ?? toIso) !== null && (fromIso === null || toIso === null || fromIso <= toIso)) {
      setSpan({ kind: "between", from: fromIso, to: toIso });
    }
  };

  const listButton = (selected: boolean) =>
    cn(
      "w-full rounded px-2 py-1 text-left hover:bg-muted",
      selected && "bg-[var(--status-active-surface)] font-medium text-foreground",
    );

  return (
    <DataGridFilterPopup
      canApply={span !== null}
      help={
        <>
          Type a span such as 2h, 3d, 1w or 30m (m minutes, h hours, d days, w weeks)
          {direction === "both" ? "; it looks back, and next 2h or +2h looks ahead" : null}. Or type a date, a
          range (Nov 1 – Nov 30), or one bound (&gt; Nov 17 10:00 AM, &lt; Dec 1). In the list, type the number
          beside an N entry, then pick it.
        </>
      }
      isFiltered={current !== undefined}
      label={label}
      onApply={apply}
      onClear={clear}
      onOpenChange={onOpenChange}
      open={open}
      testId={testId}
    >
      <div className="flex items-center gap-2">
        <span
          className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
          data-testid={`${testId}-chip`}
        >
          {span ? describeSpan(span, preferences, withTime) : displayString("word.anyTime")}
        </span>
        {type?.kind === "dateRange" ? (
          <Select
            aria-label="Match"
            className="ml-auto h-8 w-auto py-1 text-xs"
            data-testid={`${testId}-match`}
            onChange={(event) => setMatch(RANGE_MATCHES.find((option) => option.value === event.target.value)?.value ?? "overlaps")}
            value={match}
          >
            {RANGE_MATCHES.map((option) => (
              <option key={option.value} value={option.value}>
                {displayString(option.label)}
              </option>
            ))}
          </Select>
        ) : null}
      </div>
      <Input
        aria-label={`${label} span or range`}
        className="h-9 text-sm"
        data-autofocus=""
        data-testid={`${testId}-typed`}
        onChange={(event) => onType(event.target.value)}
        placeholder={direction === "future" ? "2h, 3d, Dec 1 – Dec 31" : "2h, 3d, Nov 1 – Nov 30"}
        value={typed}
      />
      {typedUnread ? (
        <p className="text-xs text-danger" data-testid={`${testId}-typed-error`}>
          Not a span or a date yet.
        </p>
      ) : null}
      <div className="grid max-h-72 grid-cols-2 gap-x-2 overflow-y-auto">
        <ul className="grid content-start gap-0.5" data-testid={`${testId}-quick`}>
          {quickEntries(direction).map((entry) => {
            const key = `${entry.toward}-${entry.unit}-${entry.amount ?? "n"}`;
            if (entry.amount !== null) {
              const fixed: DateSpan = { kind: "relative", toward: entry.toward, amount: entry.amount, unit: entry.unit };
              return (
                <li key={key}>
                  <button
                    aria-pressed={sameSpan(span, fixed)}
                    className={listButton(sameSpan(span, fixed))}
                    data-testid={`${testId}-quick-${key}`}
                    onClick={() => chooseEntry(entry)}
                    type="button"
                  >
                    {relativeLabel(entry.toward, entry.amount, entry.unit)}
                  </button>
                </li>
              );
            }
            const typedAmount = Number(amounts[entry.unit]);
            const chosen = sameSpan(span, { kind: "relative", toward: entry.toward, amount: typedAmount, unit: entry.unit });
            return (
              <li className={cn("flex items-center gap-1", listButton(chosen))} key={key}>
                <button
                  aria-pressed={chosen}
                  className="shrink-0"
                  data-testid={`${testId}-quick-${key}`}
                  onClick={() => chooseEntry(entry)}
                  type="button"
                >
                  {towardLabel(entry.toward)}
                </button>
                <Input
                  aria-label={`${towardLabel(entry.toward)} how many ${unitWord(entry.unit, 2)}`}
                  className="h-6 w-10 px-1 py-0 text-xs sm:text-xs"
                  data-testid={`${testId}-amount-${key}`}
                  inputMode="numeric"
                  onChange={(event) => setAmounts((current) => ({ ...current, [entry.unit]: event.target.value }))}
                  onFocus={() => chooseEntry(entry)}
                  value={amounts[entry.unit]}
                />
                <span>{unitWord(entry.unit, 2)}</span>
              </li>
            );
          })}
        </ul>
        <ul className="grid content-start gap-0.5" data-testid={`${testId}-calendar`}>
          {calendarPeriods(direction).map((period) => {
            const periodSpan: DateSpan = { kind: "calendar", period };
            return (
              <li key={period}>
                <button
                  aria-pressed={sameSpan(span, periodSpan)}
                  className={listButton(sameSpan(span, periodSpan))}
                  data-testid={`${testId}-period-${period}`}
                  onClick={() => setSpan(periodSpan)}
                  type="button"
                >
                  {calendarPeriodLabel(period)}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      {picking ? (
        <div className="grid grid-cols-2 gap-2">
          <Input
            aria-label={`${label} from`}
            className="h-9 text-sm"
            data-testid={`${testId}-pick-from`}
            onChange={(event) => onPick(event.target.value, pickTo)}
            type={withTime ? "datetime-local" : "date"}
            value={pickFrom}
          />
          <Input
            aria-label={`${label} to`}
            className="h-9 text-sm"
            data-testid={`${testId}-pick-to`}
            onChange={(event) => onPick(pickFrom, event.target.value)}
            type={withTime ? "datetime-local" : "date"}
            value={pickTo}
          />
        </div>
      ) : (
        <button
          className="justify-self-start text-sm text-primary hover:underline"
          data-testid={`${testId}-pick`}
          onClick={() => setPicking(true)}
          type="button"
        >
          Select from calendar…
        </button>
      )}
    </DataGridFilterPopup>
  );
}

function stringAmounts(amounts: Record<SpanUnit, number>): Record<SpanUnit, string> {
  return { m: String(amounts.m), h: String(amounts.h), d: String(amounts.d), w: String(amounts.w) };
}
