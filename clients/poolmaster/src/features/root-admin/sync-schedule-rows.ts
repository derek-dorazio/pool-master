import { z } from 'zod';
import type { IngestionSchedule, IngestionScheduleConfigPatch, IngestionSyncSchedule } from '@/lib/api';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { assertNever, explicitOrderValues, ProviderSyncKind, ProviderSyncKindOrder } from '@poolmaster/shared/domain';
import { plural } from '@/lib/plural';

/** The schedule's syncs, one row each on the Providers page (#1873), keyed by sync kind (#1999) in the order they run for an event. */
const SYNC_SCHEDULE_KINDS = explicitOrderValues(ProviderSyncKindOrder);

export type SyncScheduleRow = {
  key: ProviderSyncKind;
  sync: string;
  /** Whether it runs on its interval, as the API says (#2086). */
  enabled: boolean;
  /** Whether it has a switch; a sync with none always runs (the API says which, #2086). */
  switchable: boolean;
  /** How often it runs in seconds, for sorting; null while it is off. */
  everySeconds: number | null;
  every: string;
  whichEvents: string;
  unit: 'minutes' | 'seconds';
  /** The interval in its own unit, as the edit form starts from it. */
  interval: number;
  /** How many days ahead a run looks, for a sync that looks ahead; null for one that does not. */
  lookaheadDays: number | null;
};

/** "30 s", "5 min", "6 h", "1 h 30 min": the shortest words for an interval. */
export function formatInterval(seconds: number): string {
  if (seconds < 60) return `${String(seconds)} s`;
  if (seconds % 60 !== 0) return `${String(Math.floor(seconds / 60))} min ${String(seconds % 60)} s`;
  const minutes = seconds / 60;
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${String(hours)} h` : `${String(hours)} h ${String(rest)} min`;
}

/** The unit a sync's interval is set in: seconds when the schedule holds it in seconds, else minutes. */
function unitOf(policy: IngestionSyncSchedule): 'minutes' | 'seconds' {
  return policy.intervalSeconds === undefined ? 'minutes' : 'seconds';
}

function intervalOf(policy: IngestionSyncSchedule): number {
  return (unitOf(policy) === 'seconds' ? policy.intervalSeconds : policy.intervalMinutes) ?? 0;
}

/**
 * Which events a run covers: the days ahead for a sync that looks ahead, else its kind's own
 * words. Exhaustive, so a new sync kind must say what it covers.
 */
function whichEvents(kind: ProviderSyncKind, policy: IngestionSyncSchedule): string {
  if (policy.lookaheadDays !== undefined) return `Events starting in the next ${plural(policy.lookaheadDays, 'day')}`;
  switch (kind) {
    case ProviderSyncKind.SCORES:
      return 'Events in progress; webhooks arrive between runs';
    case ProviderSyncKind.EVENTS:
    case ProviderSyncKind.FIELD:
      return '—';
    default:
      return assertNever(kind);
  }
}

/** One row per sync kind for the Sync schedules grid, from the one schedule every sport league follows. */
export function syncScheduleRows(schedule: IngestionSchedule): SyncScheduleRow[] {
  return SYNC_SCHEDULE_KINDS.map((kind) => {
    const policy = schedule[kind];
    const unit = unitOf(policy);
    const interval = intervalOf(policy);
    const seconds = unit === 'seconds' ? interval : interval * 60;
    const on = policy.runs;
    return {
      key: kind,
      sync: enumLabel('ProviderSyncKind', kind),
      enabled: on,
      switchable: policy.switchable,
      everySeconds: on ? seconds : null,
      every: on ? formatInterval(seconds) : 'Off',
      whichEvents: whichEvents(kind, policy),
      unit,
      interval,
      lookaheadDays: policy.lookaheadDays ?? null,
    };
  });
}

const wholeNumber = (min: number, message: string) => z.string().trim().refine(
  (value) => /^\d+$/.test(value) && Number(value) >= min,
  message,
);

/** The edit form: whether it runs, the interval in the row's unit, and the days ahead of a sync that looks ahead. */
export const syncScheduleFormSchema = z.object({
  enabled: z.boolean(),
  interval: wholeNumber(1, 'Enter a whole number, 1 or more'),
  lookaheadDays: wholeNumber(0, 'Enter a whole number of days, 0 or more'),
});
export type SyncScheduleFormValues = z.infer<typeof syncScheduleFormSchema>;

export function syncScheduleFormValues(row: SyncScheduleRow): SyncScheduleFormValues {
  return { enabled: row.enabled, interval: String(row.interval), lookaheadDays: String(row.lookaheadDays ?? 0) };
}

/**
 * The save for one row: only that sync's interval, its switch when it has one, and its days ahead
 * when it looks ahead.
 */
export function syncSchedulePatch(row: SyncScheduleRow, values: SyncScheduleFormValues): IngestionScheduleConfigPatch {
  const interval = Number(values.interval);
  return {
    [row.key]: {
      ...(row.unit === 'seconds' ? { intervalSeconds: interval } : { intervalMinutes: interval }),
      ...(row.switchable && { enabled: values.enabled }),
      ...(row.lookaheadDays !== null && { lookaheadDays: Number(values.lookaheadDays) }),
    },
  };
}
