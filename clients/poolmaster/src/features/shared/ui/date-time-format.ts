/**
 * Date formatting helpers, kept out of `date-time.tsx` so that file exports only
 * components.
 *
 * Split out for `react-refresh/only-export-components` (#345 Phase 0, from #167):
 * a module that exports both a component and a plain function breaks Vite's Fast
 * Refresh for that component -- an edit triggers a full reload instead of a hot
 * update, silently losing component state. These three were the non-component
 * exports; `DateDisplay` and `DateTimeField` stayed behind.
 *
 * `normalizeDate` moved with them because both sides need it; it stays private to
 * this module and `date-time.tsx` imports it.
 */

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

export function formatDateDisplay(
  value: Date | string | null | undefined,
  emptyLabel = "Unavailable",
  options?: Pick<Intl.DateTimeFormatOptions, "timeZone">,
) {
  const date = normalizeDate(value);
  return date ? date.toLocaleDateString(undefined, options) : emptyLabel;
}

export function formatDateTimeDisplay(
  value: Date | string | null | undefined,
  emptyLabel = "Unavailable",
  options?: Pick<Intl.DateTimeFormatOptions, "timeZone">,
) {
  const date = normalizeDate(value);
  return date ? date.toLocaleString(undefined, options) : emptyLabel;
}
