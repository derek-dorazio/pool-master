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
import { DEFAULT_DISPLAY_TIME_ZONE, TimeFormat } from "@poolmaster/shared/domain";
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
  locale: "en-US",
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

export function toDateTimeLocalValue(value: Date | string | null | undefined) {
  const date = normalizeDate(value);

  if (!date) {
    return "";
  }

  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
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
