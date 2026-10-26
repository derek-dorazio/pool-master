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
