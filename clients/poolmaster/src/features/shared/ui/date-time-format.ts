/**
 * Date formatting helpers, kept out of `date-time.tsx` so that file exports only
 * components.
 *
 * Split out for `react-refresh/only-export-components` (#345 Phase 0, from #167):
 * a module that exports both a component and a plain function breaks Vite's Fast
 * Refresh for that component -- an edit triggers a full reload instead of a hot
 * update, silently losing component state.
 *
 * Every date is shown in the member's own time zone, locale and clock (#1041): the
 * ones on their account, or US Eastern, en-US and the locale's clock when they have
 * none. Components read them with `useDisplayPreferences`.
 */
import { DEFAULT_DISPLAY_LOCALE, DEFAULT_DISPLAY_TIME_ZONE, TimeFormat } from "@poolmaster/shared/domain";
import type { UserDto } from "@/lib/api";

export type DisplayPreferences = {
  /** IANA zone, e.g. "America/Chicago". */
  timeZone: string;
  /** BCP 47 locale, e.g. "en-US". */
  locale: string;
  /** True for a 12-hour clock, false for 24-hour, undefined for the locale's own. */
  hour12: boolean | undefined;
};

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  timeZone: DEFAULT_DISPLAY_TIME_ZONE,
  locale: DEFAULT_DISPLAY_LOCALE,
  hour12: undefined,
};

/** The display preferences on a member's account, with the defaults for what they haven't set. */
export function displayPreferencesOf(user: UserDto | null | undefined): DisplayPreferences {
  return {
    timeZone: user?.timezone ?? DEFAULT_DISPLAY_PREFERENCES.timeZone,
    locale: user?.locale ?? DEFAULT_DISPLAY_PREFERENCES.locale,
    hour12: user?.timeFormat === undefined ? undefined : user.timeFormat === TimeFormat.TWELVE_HOUR,
  };
}

export function normalizeDate(value: Date | string | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const WALL_CLOCK = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** The wall clock in `timeZone` at `date`, field by field. */
function wallClockParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  return {
    year: field("year"),
    month: field("month"),
    day: field("day"),
    hour: field("hour"),
    minute: field("minute"),
    second: field("second"),
  };
}

/** How far `timeZone`'s wall clock is ahead of UTC at `date`, in milliseconds. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const wall = wallClockParts(date, timeZone);
  const wallAsUtc = Date.UTC(
    Number(wall.year),
    Number(wall.month) - 1,
    Number(wall.day),
    Number(wall.hour),
    Number(wall.minute),
    Number(wall.second),
  );
  return wallAsUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * `value` as a `datetime-local` input holds it: the wall clock in the member's zone (#1061),
 * e.g. "2026-03-12T13:00"; '' for none.
 */
export function toDateTimeLocalValue(value: Date | string | null | undefined, timeZone: string) {
  const date = normalizeDate(value);
  if (!date) {
    return "";
  }
  const wall = wallClockParts(date, timeZone);
  return `${wall.year}-${wall.month}-${wall.day}T${wall.hour}:${wall.minute}`;
}

/**
 * A `datetime-local` value, read as the wall clock in the member's zone (#1061), as the ISO
 * instant the API takes; undefined when blank or not a date and time. A time a daylight saving
 * change repeats is its first occurrence, and one the change skips moves forward by the gap
 * (2:30 on a spring-forward night is 3:30), as the browser's own entry box does.
 */
export function dateTimeLocalValueToIso(value: string | null | undefined, timeZone: string): string | undefined {
  const match = value ? WALL_CLOCK.exec(value) : null;
  if (!value || !match) {
    return undefined;
  }
  const [, year, month, day, hour, minute, second = "0"] = match;
  const wallAsUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(wallAsUtc)) {
    return undefined;
  }
  // The offsets a day either side are the zone's before and after any change near this time.
  const before = new Date(wallAsUtc - zoneOffsetMs(new Date(wallAsUtc - DAY_MS), timeZone));
  const after = new Date(wallAsUtc - zoneOffsetMs(new Date(wallAsUtc + DAY_MS), timeZone));
  const wall = value.slice(0, 16);
  const instant = toDateTimeLocalValue(before, timeZone) === wall || toDateTimeLocalValue(after, timeZone) !== wall
    ? before
    : after;
  return instant.toISOString();
}

/** The zone's everyday name in the member's locale, e.g. "ET" or "Germany Time", for an entry box. */
export function timeZoneGenericName(preferences: DisplayPreferences) {
  return (
    new Intl.DateTimeFormat(preferences.locale, {
      timeZone: preferences.timeZone,
      timeZoneName: "shortGeneric",
    })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value ?? preferences.timeZone
  );
}

/** The day `value` falls on in the member's zone, e.g. "10/26/2026". */
export function formatDateDisplay(
  value: Date | string | null | undefined,
  preferences: DisplayPreferences,
  emptyLabel = "Unavailable",
) {
  const date = normalizeDate(value);
  return date
    ? date.toLocaleDateString(preferences.locale, { timeZone: preferences.timeZone })
    : emptyLabel;
}

/** `value` in the member's zone with the zone named, e.g. "10/26/2026, 3:04 PM EDT". */
export function formatDateTimeDisplay(
  value: Date | string | null | undefined,
  preferences: DisplayPreferences,
  emptyLabel = "Unavailable",
) {
  const date = normalizeDate(value);
  return date
    ? date.toLocaleString(preferences.locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        hour12: preferences.hour12,
        timeZone: preferences.timeZone,
        timeZoneName: "short",
      })
    : emptyLabel;
}

/** The zone's short name at `date` in the member's locale, e.g. "EDT" or "GMT+2". */
export function timeZoneAbbreviation(date: Date, preferences: DisplayPreferences) {
  return (
    new Intl.DateTimeFormat(preferences.locale, {
      timeZone: preferences.timeZone,
      timeZoneName: "short",
    })
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value ?? preferences.timeZone
  );
}
