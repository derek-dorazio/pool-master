/**
 * The time zones a member picks from (#1041): the US zones first, by their everyday names, then
 * every other zone the browser knows.
 */
import { DEFAULT_DISPLAY_TIME_ZONE } from "@poolmaster/shared/domain";

export type TimeZoneOption = { value: string; label: string };

const US_TIME_ZONES: readonly TimeZoneOption[] = [
  { value: "America/New_York", label: "Eastern (New York)" },
  { value: "America/Chicago", label: "Central (Chicago)" },
  { value: "America/Denver", label: "Mountain (Denver)" },
  { value: "America/Phoenix", label: "Arizona (Phoenix)" },
  { value: "America/Los_Angeles", label: "Pacific (Los Angeles)" },
  { value: "America/Anchorage", label: "Alaska (Anchorage)" },
  { value: "Pacific/Honolulu", label: "Hawaii (Honolulu)" },
];

/** The US zones, then the rest A to Z, and `current` too when it is a zone neither list names. */
export function timeZoneOptions(current?: string | null): { us: TimeZoneOption[]; other: TimeZoneOption[] } {
  const usValues = new Set(US_TIME_ZONES.map((option) => option.value));
  const others = Intl.supportedValuesOf("timeZone").filter((zone) => !usValues.has(zone));
  if (current && !usValues.has(current) && !others.includes(current)) {
    others.push(current);
    others.sort();
  }
  return {
    us: [...US_TIME_ZONES],
    other: others.map((zone) => ({ value: zone, label: zone.replaceAll("_", " ") })),
  };
}

/** The zone this browser is set to, for a signup form to start from; US Eastern if it reports none. */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_DISPLAY_TIME_ZONE;
}

/** The locale this browser formats in, e.g. "en-US", sent at signup. */
export function browserLocale(): string {
  return Intl.DateTimeFormat().resolvedOptions().locale;
}
