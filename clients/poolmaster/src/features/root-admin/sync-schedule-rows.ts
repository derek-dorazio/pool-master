import { z } from 'zod';
import type { IngestionScheduleConfig, IngestionScheduleConfigPatch } from '@/lib/api';
import { enumLabel } from '@poolmaster/shared/display-strings';
import { assertNever, explicitOrderValues, ProviderSyncKind, ProviderSyncKindOrder } from '@poolmaster/shared/domain';
import { plural } from '@/lib/plural';

/** The schedule's syncs, one row each on the Providers page (#1873), keyed by sync kind (#1999) in the order they run for an event. */
const SYNC_SCHEDULE_KINDS = explicitOrderValues(ProviderSyncKindOrder);

export type SyncScheduleRow = {
  key: ProviderSyncKind;
  sync: string;
  /** Whether it runs on its interval. Field always does, so it has no switch. */
  enabled: boolean;
  /** How often it runs in seconds, for sorting; null while it is off. */
  everySeconds: number | null;
  every: string;
  whichEvents: string;
  unit: 'minutes' | 'seconds';
  /** The interval in its own unit, as the edit form starts from it. */
  interval: number;
  /** Field only: how many days ahead a run looks. */
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
function unitOf(policy: IngestionScheduleConfig[ProviderSyncKind]): 'minutes' | 'seconds' {
  return policy.intervalSeconds === undefined ? 'minutes' : 'seconds';
}

function intervalOf(policy: IngestionScheduleConfig[ProviderSyncKind]): number {
  return (unitOf(policy) === 'seconds' ? policy.intervalSeconds : policy.intervalMinutes) ?? 0;
}

/**
 * Whether the sync runs on its interval. The field sync runs for synced sport leagues whatever its
 * switch says (ADR 0011), so its row always shows its interval.
 */
function runs(kind: ProviderSyncKind, config: IngestionScheduleConfig): boolean {
  return kind === ProviderSyncKind.FIELD || config[kind].enabled;
}

function whichEvents(kind: ProviderSyncKind, config: IngestionScheduleConfig): string {
  switch (kind) {
    case ProviderSyncKind.FIELD:
      return `Events starting in the next ${plural(config.FIELD.lookaheadDays ?? 0, 'day')}`;
    case ProviderSyncKind.SCORES:
      return 'Events in progress; webhooks arrive between runs';
    case ProviderSyncKind.EVENTS:
      return '—';
    default:
      return assertNever(kind);
  }
}

/** One row per sync kind for the Sync schedules grid, from the one schedule every sport league follows. */
export function syncScheduleRows(config: IngestionScheduleConfig): SyncScheduleRow[] {
  return SYNC_SCHEDULE_KINDS.map((kind) => {
    const policy = config[kind];
    const unit = unitOf(policy);
    const interval = intervalOf(policy);
    const seconds = unit === 'seconds' ? interval : interval * 60;
    const on = runs(kind, config);
    return {
      key: kind,
      sync: enumLabel('ProviderSyncKind', kind),
      enabled: on,
      everySeconds: on ? seconds : null,
      every: on ? formatInterval(seconds) : 'Off',
      whichEvents: whichEvents(kind, config),
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

/** The edit form: whether it runs, the interval in the row's unit, and Field's days ahead. */
export const syncScheduleFormSchema = z.object({
  enabled: z.boolean(),
  interval: wholeNumber(1, 'Enter a whole number, 1 or more'),
  lookaheadDays: wholeNumber(0, 'Enter a whole number of days, 0 or more'),
});
export type SyncScheduleFormValues = z.infer<typeof syncScheduleFormSchema>;

export function syncScheduleFormValues(row: SyncScheduleRow): SyncScheduleFormValues {
  return { enabled: row.enabled, interval: String(row.interval), lookaheadDays: String(row.lookaheadDays ?? 0) };
}

/** The save for one row: only that sync's switch and interval, and Field's days ahead (Field has no switch). */
export function syncSchedulePatch(row: SyncScheduleRow, values: SyncScheduleFormValues): IngestionScheduleConfigPatch {
  const interval = Number(values.interval);
  if (row.key === ProviderSyncKind.FIELD) {
    return { FIELD: { intervalMinutes: interval, lookaheadDays: Number(values.lookaheadDays) } };
  }
  const every = row.unit === 'seconds' ? { intervalSeconds: interval } : { intervalMinutes: interval };
  return { [row.key]: { enabled: values.enabled, ...every } };
}
