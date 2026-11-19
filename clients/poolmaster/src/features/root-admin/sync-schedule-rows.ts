import { z } from 'zod';
import type { IngestionScheduleConfig, IngestionScheduleConfigPatch } from '@/lib/api';
import { plural } from '@/lib/plural';

/** The schedule's four syncs, one row each on the Providers page (#1873), in the order they run for an event. */
export const SYNC_SCHEDULE_KEYS = ['healthCheck', 'eventList', 'eventParticipants', 'eventLiveScores'] as const;
export type SyncScheduleKey = (typeof SYNC_SCHEDULE_KEYS)[number];

/** Each sync's name in the domain's words, and the unit its interval is set in. */
const SYNCS: Record<SyncScheduleKey, { label: string; unit: 'minutes' | 'seconds' }> = {
  healthCheck: { label: 'Health check', unit: 'minutes' },
  eventList: { label: 'Event list', unit: 'minutes' },
  eventParticipants: { label: 'Field', unit: 'minutes' },
  eventLiveScores: { label: 'Live scores', unit: 'seconds' },
};

export type SyncScheduleRow = {
  key: SyncScheduleKey;
  sync: string;
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

function intervalOf(key: SyncScheduleKey, config: IngestionScheduleConfig): number {
  const policy = config[key];
  return (SYNCS[key].unit === 'seconds' ? policy.intervalSeconds : policy.intervalMinutes) ?? 0;
}

/**
 * Whether the sync runs on its interval. The field sync runs for synced sport leagues whatever its
 * switch says (ADR 0011), so its row always shows its interval.
 */
function runs(key: SyncScheduleKey, config: IngestionScheduleConfig): boolean {
  return key === 'eventParticipants' || config[key].enabled;
}

function whichEvents(key: SyncScheduleKey, config: IngestionScheduleConfig): string {
  switch (key) {
    case 'eventParticipants':
      return `Events starting in the next ${plural(config.eventParticipants.lookaheadDays ?? 0, 'day')}`;
    case 'eventLiveScores':
      return 'Events in progress; webhooks arrive between runs';
    case 'healthCheck':
    case 'eventList':
      return '—';
  }
}

/** The four rows the Sync schedules grid shows, from the one schedule every sport league follows. */
export function syncScheduleRows(config: IngestionScheduleConfig): SyncScheduleRow[] {
  return SYNC_SCHEDULE_KEYS.map((key) => {
    const interval = intervalOf(key, config);
    const seconds = SYNCS[key].unit === 'seconds' ? interval : interval * 60;
    const on = runs(key, config);
    return {
      key,
      sync: SYNCS[key].label,
      everySeconds: on ? seconds : null,
      every: on ? formatInterval(seconds) : 'Off',
      whichEvents: whichEvents(key, config),
      unit: SYNCS[key].unit,
      interval,
      lookaheadDays: key === 'eventParticipants' ? config.eventParticipants.lookaheadDays ?? 0 : null,
    };
  });
}

const wholeNumber = (min: number, message: string) => z.string().trim().refine(
  (value) => /^\d+$/.test(value) && Number(value) >= min,
  message,
);

/** The edit form: the interval in the row's unit, and Field's days ahead. */
export const syncScheduleFormSchema = z.object({
  interval: wholeNumber(1, 'Enter a whole number, 1 or more'),
  lookaheadDays: wholeNumber(0, 'Enter a whole number of days, 0 or more'),
});
export type SyncScheduleFormValues = z.infer<typeof syncScheduleFormSchema>;

export function syncScheduleFormValues(row: SyncScheduleRow): SyncScheduleFormValues {
  return { interval: String(row.interval), lookaheadDays: String(row.lookaheadDays ?? 0) };
}

/** The save for one row: only that sync's interval, and Field's days ahead. */
export function syncSchedulePatch(row: SyncScheduleRow, values: SyncScheduleFormValues): IngestionScheduleConfigPatch {
  const interval = Number(values.interval);
  if (row.key === 'eventParticipants') {
    return { eventParticipants: { intervalMinutes: interval, lookaheadDays: Number(values.lookaheadDays) } };
  }
  return { [row.key]: row.unit === 'seconds' ? { intervalSeconds: interval } : { intervalMinutes: interval } };
}
