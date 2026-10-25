/**
 * The day a scheduled league email counts in: US Eastern time, the zone every overnight email
 * (EMAIL_CONFIG.weeklyDigestHour, 3am by default) goes out in, so it follows daylight saving.
 */

const DAY_TIME_ZONE = 'America/New_York';

/** `instant`'s date in US Eastern time, as YYYY-MM-DD. */
export function easternDateOf(instant: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DAY_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

/** Today's date in US Eastern time, as YYYY-MM-DD, once `hour` has come there; otherwise null. */
export function easternDayOf(now: Date, hour: number): string | null {
  const easternHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: DAY_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return easternHour < hour ? null : easternDateOf(now);
}
