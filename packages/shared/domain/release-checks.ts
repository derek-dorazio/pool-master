/**
 * The ready checks a DRAFT sport event must pass before it is released for contests (#1823).
 * One server-side evaluation answers the manual "Release for contests", the automatic release
 * sweep and the event read alike; each check carries the value it was judged on, so a held
 * release can say what held it and the log can show it later.
 */

/** Which ready check: each is passed or failed on the value it carries. */
export const ReleaseCheckKey = {
  /** Its start is still ahead: a started event can no longer be released. Value: the start. */
  NOT_STARTED: 'NOT_STARTED',
  /** Its rounds are scheduled. Value: how many rounds it has. */
  ROUNDS_SCHEDULED: 'ROUNDS_SCHEDULED',
  /** Its field is loaded. Value: how many participants are in it. */
  FIELD_LOADED: 'FIELD_LOADED',
  /** Every active field participant is in a tier. Value: how many are not. */
  TIERS_ASSIGNED: 'TIERS_ASSIGNED',
  /** No tier is empty: no entry could pick from one. Value: the empty tiers' labels. */
  TIERS_FILLED: 'TIERS_FILLED',
  /** Prices are assigned and every active field participant has one. Value: how many have none, or null before prices are assigned. */
  PRICES_ASSIGNED: 'PRICES_ASSIGNED',
  /** Its bracket is complete. Only an event played as matches has it. Value: what is missing, in words. */
  BRACKET_COMPLETE: 'BRACKET_COMPLETE',
  /** Its sport league offers at least one active contest setup, so a contest can be made on it. Value: how many. */
  CONTEST_SETUPS_ON: 'CONTEST_SETUPS_ON',
} as const;
export type ReleaseCheckKey = (typeof ReleaseCheckKey)[keyof typeof ReleaseCheckKey];

/**
 * The checks only the automatic release waits for (#1823). A root admin's "Release for contests"
 * is refused by the others alone, as it was before the automatic release: the admin judges an
 * event whose rounds or league setups are not in place yet, which the sweep never
 * does on its own.
 */
const AUTOMATIC_RELEASE_ONLY_CHECKS: ReadonlySet<ReleaseCheckKey> = new Set([
  ReleaseCheckKey.ROUNDS_SCHEDULED,
  ReleaseCheckKey.CONTEST_SETUPS_ON,
]);

/** Whether a failing check of this key refuses a root admin's manual release, not only the automatic one. */
export function blocksManualRelease(key: ReleaseCheckKey): boolean {
  return !AUTOMATIC_RELEASE_ONLY_CHECKS.has(key);
}

/** One ready check's verdict and the value it was judged on, typed by the check. */
export type ReleaseCheck =
  | { key: typeof ReleaseCheckKey.NOT_STARTED; passed: boolean; value: Date }
  | { key: typeof ReleaseCheckKey.ROUNDS_SCHEDULED; passed: boolean; value: number }
  | { key: typeof ReleaseCheckKey.FIELD_LOADED; passed: boolean; value: number }
  | { key: typeof ReleaseCheckKey.TIERS_ASSIGNED; passed: boolean; value: number }
  | { key: typeof ReleaseCheckKey.TIERS_FILLED; passed: boolean; value: string[] }
  | { key: typeof ReleaseCheckKey.PRICES_ASSIGNED; passed: boolean; value: number | null }
  | { key: typeof ReleaseCheckKey.BRACKET_COMPLETE; passed: boolean; value: string[] }
  | { key: typeof ReleaseCheckKey.CONTEST_SETUPS_ON; passed: boolean; value: number };

/** How one automatic release attempt ended (#1823). */
export const ReleaseAttemptOutcome = {
  /** Every check passed and the event was released. */
  RELEASED: 'RELEASED',
  /** A check failed; the event stays DRAFT and the next sweep tries again. */
  HELD: 'HELD',
  /** By the time the attempt ran the event was no longer one to release on its own: released already, unsynced, or out of its window. */
  SKIPPED: 'SKIPPED',
} as const;
export type ReleaseAttemptOutcome = (typeof ReleaseAttemptOutcome)[keyof typeof ReleaseAttemptOutcome];

/** What started a release attempt. Only the hourly sweep queues one today; a root admin's button releases at once. */
export const ReleaseAttemptTrigger = {
  SCHEDULE: 'SCHEDULE',
} as const;
export type ReleaseAttemptTrigger = (typeof ReleaseAttemptTrigger)[keyof typeof ReleaseAttemptTrigger];

/** Why a release attempt was skipped. */
export const ReleaseAttemptSkipReason = {
  NOT_DRAFT: 'NOT_DRAFT',
  NOT_SYNCED: 'NOT_SYNCED',
  AUTO_RELEASE_OFF: 'AUTO_RELEASE_OFF',
  OUTSIDE_WINDOW: 'OUTSIDE_WINDOW',
} as const;
export type ReleaseAttemptSkipReason = (typeof ReleaseAttemptSkipReason)[keyof typeof ReleaseAttemptSkipReason];

/** One automatic release attempt's result: what the release job reports and Activity shows. */
export type ReleaseAttemptResult =
  | { outcome: typeof ReleaseAttemptOutcome.RELEASED | typeof ReleaseAttemptOutcome.HELD; checks: ReleaseCheck[] }
  | { outcome: typeof ReleaseAttemptOutcome.SKIPPED; reason: ReleaseAttemptSkipReason };

/** The longest automatic release window a sport league may set, in days; the database checks the same bound (#1823). */
export const AUTO_RELEASE_DAYS_MAX = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whether an event starting at `startDate` is inside an automatic release window of `days` days: still ahead, and no more than that far away. */
export function isWithinAutoReleaseWindow(startDate: Date, days: number, now: Date): boolean {
  const msToStart = startDate.getTime() - now.getTime();
  return msToStart > 0 && msToStart <= days * DAY_MS;
}

/** The latest start any sport league's automatic release window reaches from `now`. */
export function autoReleaseHorizon(now: Date): Date {
  return new Date(now.getTime() + AUTO_RELEASE_DAYS_MAX * DAY_MS);
}
