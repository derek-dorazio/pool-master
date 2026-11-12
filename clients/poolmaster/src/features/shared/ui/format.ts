/**
 * The one home for how the app writes a value on screen (#1587): places, points, counts,
 * money and dates. Pages import from here (or from the shared UI index, which re-exports
 * it) rather than calling `toLocaleString`, `toFixed` or `Intl` themselves; the
 * `poolmaster/no-inline-display-format` lint rule keeps it that way.
 *
 * Numbers follow the viewer's locale, as dates already do: the `locale` on their display
 * preferences (`useDisplayPreferences().locale`), which is en-US when they haven't set one.
 * A UK viewer sees "1,000"; a German one "1.000". Places stay English ordinals ("1st",
 * "T2"), because the app is written in English.
 */
export {
  formatDateDisplay,
  formatDateTimeDisplay,
  timeZoneAbbreviation,
  timeZoneGenericName,
  type DisplayPreferences,
} from "./date-time-format";

/** The number formats the app uses, one `Intl.NumberFormat` per kind and locale. */
const NUMBER_FORMAT_OPTIONS = {
  /** Counts and limits: whole numbers, grouped. */
  whole: { maximumFractionDigits: 0 },
  /** Points to one decimal place when there is one: "612.5", "600". */
  tenths: { minimumFractionDigits: 0, maximumFractionDigits: 1 },
  /** Whole US dollars: "$49". */
  dollars: { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 },
  /** US dollars and cents, both digits: "$12.50". */
  dollarsAndCents: { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 },
} as const satisfies Record<string, Intl.NumberFormatOptions>;

type NumberKind = keyof typeof NUMBER_FORMAT_OPTIONS;

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(kind: NumberKind, locale: string): Intl.NumberFormat {
  const key = `${kind}|${locale}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, NUMBER_FORMAT_OPTIONS[kind]);
    numberFormats.set(key, format);
  }
  return format;
}

/** A whole number in the viewer's locale: "1,000" (en-US), "1.000" (en-DE). */
export function formatNumber(value: number, locale: string): string {
  return numberFormat("whole", locale).format(value);
}

/**
 * A count with its noun, the count in the viewer's locale: "1 entry", "1,000 entries". Screens use
 * this one; `pluralize` in `@poolmaster/shared/domain` is the locale-free twin for server text
 * such as emails and rules copy. Don't add a third.
 */
export function formatCount(count: number, singular: string, locale: string, plural = `${singular}s`): string {
  return `${formatNumber(count, locale)} ${count === 1 ? singular : plural}`;
}

/** Cup points arrive in tenths of a point: 6125 reads "612.5", 6000 reads "600". */
export function formatCupPoints(tenths: number, locale: string): string {
  return numberFormat("tenths", locale).format(tenths / 10);
}

/** Cup points with their noun: "1 point", "612.5 points". */
export function formatCupPointsCount(tenths: number, locale: string): string {
  return `${formatCupPoints(tenths, locale)} ${tenths === 10 ? "point" : "points"}`;
}

/** A price in US cents, in the viewer's locale: "$10", "$12.50" (en-US), "US$10" (en-GB). */
export function formatMoneyCents(cents: number, locale: string): string {
  return numberFormat(cents % 100 === 0 ? "dollars" : "dollarsAndCents", locale).format(cents / 100);
}

/**
 * Numbers as a comma-separated list, digits only: "10, 6, 3". For a value a member types
 * back into a form box, so it is never grouped ("1000", not "1,000") and reads back the same.
 */
export function formatNumberList(values: readonly number[]): string {
  return values.join(", ");
}

/** A place as an ordinal: "1st", "2nd", "3rd", "11th", "22nd". */
export function formatOrdinal(place: number): string {
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) {
    return `${place}th`;
  }
  const suffix: Readonly<Record<number, string>> = { 1: "st", 2: "nd", 3: "rd" };
  return `${place}${suffix[place % 10] ?? "th"}`;
}

/** A ranked row's place as the server sends it: its number, and "T2" for a shared 2nd. */
export type PlaceRow = { position: number; displayPosition: string };

/** A place as a sentence reads it: "6th", or "T2" for a shared 2nd. */
export function formatPlace(row: PlaceRow): string {
  return row.displayPosition.startsWith("T") ? row.displayPosition : formatOrdinal(row.position);
}
