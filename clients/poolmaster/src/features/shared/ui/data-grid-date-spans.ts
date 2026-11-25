import { displayString } from "@poolmaster/shared/display-strings";
import {
  dateTimeLocalValueToIso,
  formatGridDate,
  startOfZonedDay,
  zonedDay,
  type DisplayPreferences,
} from "./date-time-format";

/**
 * The spans a DataGrid date filter offers (#1838, the "Grid component" mockup): a relative span
 * such as Past 2 hours, a calendar period such as Previous month, or a range typed or picked
 * from the calendar. A span is kept as chosen and resolved to instants when applied, so its
 * label still reads "Past 2 hours".
 */

/** Which way a date column's values lie: Last run is past, Expires future, Starts either. */
export type DateDirection = "past" | "future" | "both";

export type SpanUnit = "m" | "h" | "d" | "w";

export type CalendarPeriod =
  | "today"
  | "yesterday"
  | "weekToDate"
  | "previousWeek"
  | "monthToDate"
  | "previousMonth"
  | "yearToDate"
  | "previousYear"
  | "tomorrow"
  | "thisWeek"
  | "nextWeek"
  | "thisMonth"
  | "nextMonth";

export type DateSpan =
  | { kind: "relative"; toward: "past" | "next"; amount: number; unit: SpanUnit }
  | { kind: "calendar"; period: CalendarPeriod }
  /** Instants as ISO strings, both ends inclusive; null leaves that end open. */
  | { kind: "between"; from: string | null; to: string | null };

/** A span as instants, epoch milliseconds, both ends inclusive; null leaves that end open. */
export type ResolvedSpan = { from: number | null; to: number | null };

const UNIT_MS: Record<SpanUnit, number> = { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
/** The display-string noun for each unit: "minute" / "minutes". */
const UNIT_WORDS = {
  m: "word.minute",
  h: "word.hour",
  d: "word.day",
  w: "word.weekUnit",
} as const satisfies Record<SpanUnit, string>;

/** A unit as words, singular or plural by the amount: "hour", "minutes". */
export function unitWord(unit: SpanUnit, amount: number): string {
  return displayString(UNIT_WORDS[unit], { count: amount });
}

/** One entry of the quick list: a fixed span (1 hour), or one whose amount the viewer types (N hours). */
export type QuickEntry = { toward: "past" | "next"; unit: SpanUnit; amount: number | null };

const PAST_QUICK: QuickEntry[] = [
  { toward: "past", unit: "m", amount: null },
  { toward: "past", unit: "h", amount: 1 },
  { toward: "past", unit: "h", amount: null },
  { toward: "past", unit: "d", amount: 1 },
  { toward: "past", unit: "d", amount: null },
  { toward: "past", unit: "w", amount: 1 },
  { toward: "past", unit: "w", amount: null },
];
// Next has no minutes: nothing upcoming is minutes away often enough to list.
const NEXT_QUICK: QuickEntry[] = PAST_QUICK.filter((entry) => entry.unit !== "m").map((entry) => ({ ...entry, toward: "next" }));

/** The quick list for a column's direction; both lists Past first, then Next. */
export function quickEntries(direction: DateDirection): QuickEntry[] {
  return [...(direction === "future" ? [] : PAST_QUICK), ...(direction === "past" ? [] : NEXT_QUICK)];
}

const PAST_PERIODS: CalendarPeriod[] = [
  "today",
  "yesterday",
  "weekToDate",
  "previousWeek",
  "monthToDate",
  "previousMonth",
  "yearToDate",
  "previousYear",
];
const FUTURE_PERIODS: CalendarPeriod[] = ["today", "tomorrow", "thisWeek", "nextWeek", "thisMonth", "nextMonth"];

/** The calendar periods for a column's direction; both lists the past ones, then the future ones not already listed. */
export function calendarPeriods(direction: DateDirection): CalendarPeriod[] {
  if (direction === "past") return PAST_PERIODS;
  if (direction === "future") return FUTURE_PERIODS;
  return [...PAST_PERIODS, ...FUTURE_PERIODS.filter((period) => !PAST_PERIODS.includes(period))];
}

/** The display string each calendar period reads as: "Previous month". */
export const CALENDAR_PERIOD_WORDS = {
  today: "word.today",
  yesterday: "word.yesterday",
  weekToDate: "word.weekToDate",
  previousWeek: "word.previousWeek",
  monthToDate: "word.monthToDate",
  previousMonth: "word.previousMonth",
  yearToDate: "word.yearToDate",
  previousYear: "word.previousYear",
  tomorrow: "word.tomorrow",
  thisWeek: "word.thisWeek",
  nextWeek: "word.nextWeek",
  thisMonth: "word.thisMonth",
  nextMonth: "word.nextMonth",
} as const satisfies Record<CalendarPeriod, string>;

/** A calendar period as words: "Previous month". */
export function calendarPeriodLabel(period: CalendarPeriod): string {
  return displayString(CALENDAR_PERIOD_WORDS[period]);
}

/** "Past" or "Next", as a quick entry starts. */
export function towardLabel(toward: "past" | "next"): string {
  return displayString(toward === "past" ? "word.past" : "word.next");
}

/** "Past 2 hours", "Next 1 week". */
export function relativeLabel(toward: "past" | "next", amount: number, unit: SpanUnit): string {
  return displayString(toward === "past" ? "word.pastSpan" : "word.nextSpan", { amount, unit: unitWord(unit, amount) });
}

/** The first day of the week in the member's locale: 1 Monday ... 7 Sunday. */
export function firstDayOfWeek(locale: string): number {
  try {
    const info = (new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } });
    const firstDay = info.getWeekInfo?.().firstDay ?? info.weekInfo?.firstDay;
    if (firstDay !== undefined) return firstDay;
  } catch {
    // An unknown locale falls through to the region rule.
  }
  return /-(US|CA|MX|BR|JP|PH|IL|ZA|AU)$/i.test(locale) ? 7 : 1;
}

type Day = { year: number; month: number; day: number };

function addDays({ year, month, day }: Day, days: number): Day {
  const moved = new Date(Date.UTC(year, month - 1, day + days));
  // poolmaster-allow-clock-year: calendar arithmetic for the date filter, not a season
  return { year: moved.getUTCFullYear(), month: moved.getUTCMonth() + 1, day: moved.getUTCDate() };
}

/** The instants a calendar period covers in the member's zone, from its first instant to its last. */
function resolvePeriod(period: CalendarPeriod, now: number, preferences: DisplayPreferences): ResolvedSpan {
  const { timeZone } = preferences;
  const start = (day: Day) => startOfZonedDay(day.year, day.month, day.day, timeZone);
  const days = (first: Day, count: number): ResolvedSpan => ({ from: start(first), to: start(addDays(first, count)) - 1 });
  const today = zonedDay(now, timeZone);
  const weekday = new Date(Date.UTC(today.year, today.month - 1, today.day)).getUTCDay() || 7;
  const weekStart = addDays(today, -((weekday - firstDayOfWeek(preferences.locale) + 7) % 7));
  const monthStart = { ...today, day: 1 };
  const month = (offset: number): ResolvedSpan => {
    const first = { year: today.year, month: today.month + offset, day: 1 };
    return { from: start(first), to: start({ ...first, month: first.month + 1 }) - 1 };
  };
  switch (period) {
    case "today":
      return days(today, 1);
    case "yesterday":
      return days(addDays(today, -1), 1);
    case "tomorrow":
      return days(addDays(today, 1), 1);
    case "weekToDate":
      return { from: start(weekStart), to: now };
    case "previousWeek":
      return days(addDays(weekStart, -7), 7);
    case "thisWeek":
      return days(weekStart, 7);
    case "nextWeek":
      return days(addDays(weekStart, 7), 7);
    case "monthToDate":
      return { from: start(monthStart), to: now };
    case "previousMonth":
      return month(-1);
    case "thisMonth":
      return month(0);
    case "nextMonth":
      return month(1);
    case "yearToDate":
      return { from: start({ year: today.year, month: 1, day: 1 }), to: now };
    case "previousYear":
      return { from: start({ year: today.year - 1, month: 1, day: 1 }), to: start({ year: today.year, month: 1, day: 1 }) - 1 };
  }
}

/** The instants a span covers at `now`. */
export function resolveSpan(span: DateSpan, now: number, preferences: DisplayPreferences): ResolvedSpan {
  switch (span.kind) {
    case "relative": {
      const length = span.amount * UNIT_MS[span.unit];
      return span.toward === "past" ? { from: now - length, to: now } : { from: now, to: now + length };
    }
    case "calendar":
      return resolvePeriod(span.period, now, preferences);
    case "between":
      return {
        from: span.from === null ? null : Date.parse(span.from),
        to: span.to === null ? null : Date.parse(span.to),
      };
  }
}

/** How the filter's chip and the "Filtered:" line name a span. */
export function describeSpan(span: DateSpan, preferences: DisplayPreferences, withTime: boolean): string {
  if (span.kind === "relative") return relativeLabel(span.toward, span.amount, span.unit);
  if (span.kind === "calendar") return calendarPeriodLabel(span.period);
  const write = (iso: string) => formatGridDate(iso, { format: "words", withTime }, preferences);
  if (span.from !== null && span.to !== null) return `${write(span.from)} – ${write(span.to)}`;
  if (span.from !== null) return `From ${write(span.from)}`;
  return span.to !== null ? `Through ${write(span.to)}` : displayString("word.anyTime");
}

const SPAN_TEXT = /^(?:(past|last|next|-|\+)\s*)?(\d+)\s*(m|mins?|minutes?|h|hrs?|hours?|d|days?|w|wks?|weeks?)$/i;
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const TIME = /(?:,?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)$/i;

/** A match's groups, an optional one that did not take part being undefined (TypeScript types them all as strings). */
function groupsOf(match: RegExpExecArray | null): (string | undefined)[] | null {
  return match ? [...match] : null;
}

/** A typed day, and the time when one was typed; the year defaults to the current one. */
type TypedDate = { day: Day; minutes: number | null };

function parseTypedDate(text: string, preferences: DisplayPreferences, thisYear: number): TypedDate | null {
  let rest = text.trim().replace(/\s+/g, " ");
  let minutes: number | null = null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?$/.exec(rest);
  if (iso) {
    const day = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
    return validDay(day) ? { day, minutes: iso[4] ? Number(iso[4]) * 60 + Number(iso[5]) : null } : null;
  }
  const time = groupsOf(TIME.exec(rest));
  const timeAt = TIME.exec(rest)?.index ?? rest.length;
  // A bare number after a day ("Nov 17 2026") is a year, not a time.
  if (time && (time[2] !== undefined || time[3] !== undefined)) {
    let hour = Number(time[1]);
    const meridiem = time[3]?.toLowerCase();
    if (hour > 23 || (meridiem && (hour < 1 || hour > 12))) return null;
    if (meridiem === "pm" && hour < 12) hour += 12;
    if (meridiem === "am" && hour === 12) hour = 0;
    minutes = hour * 60 + Number(time[2] ?? 0);
    rest = rest.slice(0, timeAt).trim();
  }
  const day = parseDay(rest, preferences, thisYear);
  return day ? { day, minutes } : null;
}

function validDay({ year, month, day }: Day): boolean {
  const check = new Date(Date.UTC(year, month - 1, day));
  // poolmaster-allow-clock-year: checks a typed date is a real calendar day, not a season
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day;
}

function parseDay(text: string, preferences: DisplayPreferences, thisYear: number): Day | null {
  const monthOf = (word: string | undefined) => MONTHS.indexOf((word ?? "").slice(0, 3).toLowerCase()) + 1;
  const named = groupsOf(/^([a-z]+)\.? (\d{1,2})(?:,? (\d{4}))?$/i.exec(text));
  const dayFirst = groupsOf(/^(\d{1,2}) ([a-z]+)\.?(?:,? (\d{4}))?$/i.exec(text));
  const numeric = groupsOf(/^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}))?$/.exec(text));
  let day: Day | null = null;
  if (named && monthOf(named[1]) > 0) {
    day = { year: Number(named[3] ?? thisYear), month: monthOf(named[1]), day: Number(named[2]) };
  } else if (dayFirst && monthOf(dayFirst[2]) > 0) {
    day = { year: Number(dayFirst[3] ?? thisYear), month: monthOf(dayFirst[2]), day: Number(dayFirst[1]) };
  } else if (numeric) {
    // The member's locale decides which number is the month: en-US writes it first. That covers
    // the locales englishLocaleFor gives today; a new month-first locale (en-CA, en-PH) belongs here.
    const monthFirst = /-US$/i.test(preferences.locale);
    const [first, second] = [Number(numeric[1]), Number(numeric[2])];
    day = { year: Number(numeric[3] ?? thisYear), month: monthFirst ? first : second, day: monthFirst ? second : first };
  }
  return day && validDay(day) ? day : null;
}

/** The first and last instant a typed date covers: its minute when a time was typed, else its whole day. */
function typedInstants(typed: TypedDate, timeZone: string): { first: number; last: number } {
  const { day, minutes } = typed;
  if (minutes === null) {
    const next = addDays(day, 1);
    return {
      first: startOfZonedDay(day.year, day.month, day.day, timeZone),
      last: startOfZonedDay(next.year, next.month, next.day, timeZone) - 1,
    };
  }
  const pad = (value: number) => String(value).padStart(2, "0");
  const wall = `${day.year}-${pad(day.month)}-${pad(day.day)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  const first = Date.parse(dateTimeLocalValueToIso(wall, timeZone) ?? `${wall}:00Z`);
  return { first, last: first + 59_999 };
}

const iso = (instant: number) => new Date(instant).toISOString();

const UNITS: readonly SpanUnit[] = ["m", "h", "d", "w"];

function unitOf(word: string | undefined): SpanUnit {
  return UNITS.find((unit) => unit === word?.charAt(0).toLowerCase()) ?? "h";
}

/**
 * What the viewer typed in the filter's box, as a span; null when it reads as none. `2h`, `3d`,
 * `1w` and `30m` are a relative span: Next on a future column, else Past, and "next 2h" or
 * "+2h" asks for Next on a column that lies both ways. A date is its whole day ("Nov 17") or
 * its minute ("Nov 17 10:00 AM"); `> date` and `< date` leave one end open; `date – date`
 * (or "to") is a range.
 */
export function parseSpanText(
  text: string,
  direction: DateDirection,
  preferences: DisplayPreferences,
  now: number = Date.now(),
): DateSpan | null {
  const typed = text.trim();
  const span = groupsOf(SPAN_TEXT.exec(typed));
  if (span) {
    const amount = Number(span[2]);
    const word = span[1]?.toLowerCase();
    const asked = word === "next" || word === "+" ? "next" : word === undefined ? null : "past";
    const toward = asked ?? (direction === "future" ? "next" : "past");
    if (amount < 1 || (toward === "next" && direction === "past") || (toward === "past" && direction === "future")) {
      return null;
    }
    return { kind: "relative", toward, amount, unit: unitOf(span[3]) };
  }
  const thisYear = zonedDay(now, preferences.timeZone).year;
  const read = (part: string) => {
    const date = parseTypedDate(part, preferences, thisYear);
    return date ? typedInstants(date, preferences.timeZone) : null;
  };
  const bound = /^([<>])(=?)\s*(.+)$/.exec(typed);
  if (bound) {
    const date = read(bound[3]);
    if (!date) return null;
    const inclusive = bound[2] === "=";
    return bound[1] === ">"
      ? { kind: "between", from: iso(inclusive ? date.first : date.last + 1), to: null }
      : { kind: "between", from: null, to: iso(inclusive ? date.last : date.first - 1) };
  }
  const range = typed.split(/\s+(?:-|–|—|to)\s+/i);
  if (range.length === 2) {
    const [from, to] = range.map(read);
    return from && to && from.first <= to.last ? { kind: "between", from: iso(from.first), to: iso(to.last) } : null;
  }
  const date = read(typed);
  return date ? { kind: "between", from: iso(date.first), to: iso(date.last) } : null;
}
