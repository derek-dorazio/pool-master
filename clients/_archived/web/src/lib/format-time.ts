import { usePreferencesStore } from '@/stores/preferences-store';

export type TimeFormat =
  | 'DATE_SHORT'
  | 'DATE_LONG'
  | 'TIME'
  | 'DATETIME_SHORT'
  | 'DATETIME_LONG'
  | 'RELATIVE'
  | 'COUNTDOWN';

function toDate(input: Date | string): Date {
  return typeof input === 'string' ? new Date(input) : input;
}

/**
 * Get Intl.DateTimeFormat options for a given TimeFormat code.
 */
function getFormatOptions(
  format: TimeFormat,
  timeFormat: '12H' | '24H',
  dateFormat: 'MDY' | 'DMY' | 'YMD',
): Intl.DateTimeFormatOptions {
  const hour12 = timeFormat === '12H';

  switch (format) {
    case 'DATE_SHORT':
      return dateFormat === 'YMD'
        ? { year: 'numeric', month: 'short', day: 'numeric' }
        : { month: 'short', day: 'numeric' };
    case 'DATE_LONG':
      return { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    case 'TIME':
      return { hour: 'numeric', minute: '2-digit', hour12 };
    case 'DATETIME_SHORT':
      return { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12 };
    case 'DATETIME_LONG':
      return {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12,
        timeZoneName: 'short',
      };
    default:
      return { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12 };
  }
}

/**
 * Format a UTC date for display using the user's preferences.
 * Reads timezone from the preferences store if not provided.
 */
export function formatTime(
  utcDate: Date | string,
  format: TimeFormat,
  timezone?: string,
): string {
  if (format === 'RELATIVE') return formatRelative(utcDate);
  if (format === 'COUNTDOWN') return formatCountdown(utcDate);

  const date = toDate(utcDate);
  const prefs = usePreferencesStore.getState();
  const tz = timezone ?? prefs.timezone;
  const options = getFormatOptions(format, prefs.timeFormat, prefs.dateFormat);

  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: tz }).format(date);
}

/**
 * Format with dual timezone display (user tz + league tz).
 * Output: "Sat, Mar 28 at 7:00 PM ET (4:00 PM PT)"
 * If both timezones are the same, shows only one.
 */
export function formatDualTimezone(
  utcDate: Date | string,
  userTz: string,
  leagueTz: string,
): string {
  const date = toDate(utcDate);
  const prefs = usePreferencesStore.getState();
  const hour12 = prefs.timeFormat === '12H';

  const primaryFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    timeZone: userTz,
  });
  const primaryStr = primaryFmt.format(date);
  const userAbbr = getTimezoneAbbr(userTz, date);

  if (userTz === leagueTz) {
    return `${primaryStr} ${userAbbr}`;
  }

  const secondaryFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12,
    timeZone: leagueTz,
  });
  const secondaryStr = secondaryFmt.format(date);
  const leagueAbbr = getTimezoneAbbr(leagueTz, date);

  return `${primaryStr} ${userAbbr} (${secondaryStr} ${leagueAbbr})`;
}

/**
 * Relative time display.
 * "just now" (<1m), "5m ago", "2h ago", "yesterday", "3 days ago", then full date.
 */
export function formatRelative(utcDate: Date | string): string {
  const date = toDate(utcDate);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const isFuture = diffMs < 0;
  const absDiff = Math.abs(diffMs);

  const seconds = Math.floor(absDiff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return isFuture ? 'in a moment' : 'just now';
  if (minutes < 60) return isFuture ? `in ${minutes}m` : `${minutes}m ago`;
  if (hours < 24) return isFuture ? `in ${hours}h` : `${hours}h ago`;
  if (days === 1) return isFuture ? 'tomorrow' : 'yesterday';
  if (days < 7) return isFuture ? `in ${days} days` : `${days} days ago`;

  // Beyond 7 days, show full date
  return formatTime(date, 'DATE_SHORT');
}

/**
 * Duration countdown display.
 * "2d 14h 32m", "45m 12s", "3s", "0s" (if past).
 */
export function formatCountdown(targetUtc: Date | string): string {
  const target = toDate(targetUtc);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();

  if (diffMs <= 0) return '0s';

  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0 || (days === 0 && hours === 0)) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
}

/**
 * Get a short timezone abbreviation from an IANA timezone name.
 * "America/New_York" -> "ET" (or "EST"/"EDT" depending on DST).
 */
export function getTimezoneAbbr(iana: string, date?: Date): string {
  const d = date ?? new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: iana,
    timeZoneName: 'short',
  });
  const parts = fmt.formatToParts(d);
  const tzPart = parts.find((p) => p.type === 'timeZoneName');
  return tzPart?.value ?? iana;
}
