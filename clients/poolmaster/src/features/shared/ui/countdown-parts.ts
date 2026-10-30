export type CountdownParts = { days: number; hours: number; minutes: number };

/** Whole days, hours and minutes from `now` until `until`, never negative. */
export function countdownUntil(until: string, now: Date): CountdownParts {
  const totalMinutes = Math.max(0, Math.floor((Date.parse(until) - now.getTime()) / 60_000));
  return {
    days: Math.floor(totalMinutes / (24 * 60)),
    hours: Math.floor((totalMinutes % (24 * 60)) / 60),
    minutes: totalMinutes % 60,
  };
}
