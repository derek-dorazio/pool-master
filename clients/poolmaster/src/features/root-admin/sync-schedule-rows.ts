import { z } from 'zod';
import type { IngestionSchedule, IngestionScheduleConfigPatch, IngestionSyncSchedule } from '@/lib/api';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { assertNever, explicitOrderValues, ProviderSyncKind, ProviderSyncKindOrder, SyncSeasonState, SyncSeasonStateOrder } from '@poolmaster/shared/domain';

/** The schedule's syncs, one row each on the Providers page (#1873), keyed by sync kind (#1999) in the order they run for an event. */
const SYNC_SCHEDULE_KINDS = explicitOrderValues(ProviderSyncKindOrder);

/** The Season states each sync has an interval for (#2009), in their declared order. */
export const SYNC_SEASON_STATES = explicitOrderValues(SyncSeasonStateOrder);

/** One Season state's interval on a row. */
export type SyncScheduleInterval = {
  /** How often it runs in seconds, for sorting; null while the sync is off. */
  seconds: number | null;
  /** "6 h", or "Off" while the sync is off. */
  label: string;
  /** The interval in the row's unit, as the edit form starts from it. */
  value: number;
};

export type SyncScheduleRow = {
  key: ProviderSyncKind;
  sync: string;
  /** Whether it runs on its intervals, as the API says (#2086). */
  enabled: boolean;
  /** Whether it has a switch; a sync with none always runs (the API says which, #2086). */
  switchable: boolean;
  /** Its interval in each Season state: in season and off season (#2009). */
  intervals: Record<SyncSeasonState, SyncScheduleInterval>;
  whichEvents: string;
  /** The unit both of its intervals are set in. */
  unit: 'minutes' | 'seconds';
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

/** The unit a sync's intervals are set in: seconds when the schedule holds its in-season one in seconds, else minutes. */
function unitOf(policy: IngestionSyncSchedule): 'minutes' | 'seconds' {
  return policy.intervals[SyncSeasonState.IN_SEASON].intervalSeconds === undefined ? 'minutes' : 'seconds';
}

function secondsOf(interval: IngestionSyncSchedule['intervals'][SyncSeasonState]): number {
  return interval.intervalSeconds ?? (interval.intervalMinutes ?? 0) * 60;
}

/** Which events a run covers, in its kind's own words. Exhaustive, so a new sync kind must say what it covers. */
function whichEvents(kind: ProviderSyncKind): string {
  switch (kind) {
    case ProviderSyncKind.SCORES:
      return 'Events in progress; webhooks arrive between runs';
    case ProviderSyncKind.FIELD:
      return 'The events of each league\'s next slot';
    case ProviderSyncKind.EVENTS:
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
    const on = policy.runs;
    const intervalOf = (state: SyncSeasonState): SyncScheduleInterval => {
      const seconds = secondsOf(policy.intervals[state]);
      return {
        seconds: on ? seconds : null,
        label: on ? formatInterval(seconds) : 'Off',
        value: unit === 'seconds' ? seconds : Math.round(seconds / 60),
      };
    };
    return {
      key: kind,
      sync: enumLabel('ProviderSyncKind', kind),
      enabled: on,
      switchable: policy.switchable,
      intervals: {
        [SyncSeasonState.IN_SEASON]: intervalOf(SyncSeasonState.IN_SEASON),
        [SyncSeasonState.OFFSEASON]: intervalOf(SyncSeasonState.OFFSEASON),
      },
      whichEvents: whichEvents(kind),
      unit,
    };
  });
}

const wholeNumber = (min: number, message: string) => z.string().trim().refine(
  (value) => /^\d+$/.test(value) && Number(value) >= min,
  message,
);

const INTERVAL_MESSAGE = 'Enter a whole number, 1 or more';

/** The edit form: whether it runs, and its interval in each Season state in the row's unit. */
export const syncScheduleFormSchema = z.object({
  enabled: z.boolean(),
  [SyncSeasonState.IN_SEASON]: wholeNumber(1, INTERVAL_MESSAGE),
  [SyncSeasonState.OFFSEASON]: wholeNumber(1, INTERVAL_MESSAGE),
});
export type SyncScheduleFormValues = z.infer<typeof syncScheduleFormSchema>;

export function syncScheduleFormValues(row: SyncScheduleRow): SyncScheduleFormValues {
  return {
    enabled: row.enabled,
    [SyncSeasonState.IN_SEASON]: String(row.intervals.IN_SEASON.value),
    [SyncSeasonState.OFFSEASON]: String(row.intervals.OFFSEASON.value),
  };
}

/** The save for one row: only that sync's intervals, and its switch when it has one. */
export function syncSchedulePatch(row: SyncScheduleRow, values: SyncScheduleFormValues): IngestionScheduleConfigPatch {
  const interval = (value: string) => (row.unit === 'seconds' ? { intervalSeconds: Number(value) } : { intervalMinutes: Number(value) });
  return {
    [row.key]: {
      intervals: {
        [SyncSeasonState.IN_SEASON]: interval(values.IN_SEASON),
        [SyncSeasonState.OFFSEASON]: interval(values.OFFSEASON),
      },
      ...(row.switchable && { enabled: values.enabled }),
    },
  };
}
