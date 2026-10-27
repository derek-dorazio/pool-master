/**
 * Display time zones (#1039). Every instant is stored in UTC; a member sees it in the IANA zone
 * on their account, picked at signup, or in US Eastern when they have none.
 */

/** The zone a member with no saved time zone sees dates and times in. */
export const DEFAULT_DISPLAY_TIME_ZONE = 'America/New_York';

/** The locale a member with no saved locale sees dates and times written in. */
export const DEFAULT_DISPLAY_LOCALE = 'en-US';

/** Whether the runtime knows `timeZone` as an IANA zone, e.g. "America/Chicago". */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Whether `locale` is a well-formed BCP 47 language tag, e.g. "en-US". */
export function isKnownLocale(locale: string): boolean {
  try {
    return Intl.getCanonicalLocales(locale).length === 1;
  } catch {
    return false;
  }
}

/** English for a region with no English locale of its own: day before month, 24-hour clock. */
const NON_US_ENGLISH_LOCALE = 'en-150';

/**
 * The locale a member's dates are written in (#1088): English words in the region of the locale
 * on their account, so "de-DE" writes "9 Apr 2026, 13:40 CEST" rather than German date words in
 * English copy. A region with no English locale of its own (Brazil, Japan) writes European English,
 * never US order. A locale with no region, none at all, or one that isn't a language tag writes en-US.
 */
export function englishLocaleFor(locale: string | null | undefined): string {
  if (!locale || !isKnownLocale(locale)) return DEFAULT_DISPLAY_LOCALE;
  const { region } = new Intl.Locale(locale);
  if (region === undefined) return DEFAULT_DISPLAY_LOCALE;
  const regional = `en-${region}`;
  return new Intl.DateTimeFormat(regional).resolvedOptions().locale === regional ? regional : NON_US_ENGLISH_LOCALE;
}
