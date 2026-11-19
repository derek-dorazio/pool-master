import { ProviderSyncKind, ProviderSyncRunStatus, SportLeagueSyncMode } from '@poolmaster/shared/domain';
import { formatDateTimeDisplay, type DisplayPreferences } from '@/features/shared/ui';
import type { SportLeagueSyncDto } from '@/lib/api';

/** Each sync's name on its row (the League page spec), in domain words. */
export const LEAGUE_SYNC_NAMES: Record<ProviderSyncKind, string> = {
  [ProviderSyncKind.EVENTS]: 'Event list',
  [ProviderSyncKind.FIELD]: 'Fields',
  [ProviderSyncKind.SCORES]: 'Live scores and results',
};

const RUN_STATUS_WORDS: Record<ProviderSyncRunStatus, string> = {
  [ProviderSyncRunStatus.SUBMITTED]: 'waiting',
  [ProviderSyncRunStatus.IN_PROGRESS]: 'running',
  [ProviderSyncRunStatus.COMPLETED]: 'done',
  [ProviderSyncRunStatus.FAILED]: 'failed',
  [ProviderSyncRunStatus.CANCELLED]: 'cancelled',
};

/** A sync's last run as one line: when it was queued, how it ended, and what it changed or said. */
export function lastRunText(sync: Pick<SportLeagueSyncDto, 'lastRun'>, preferences: DisplayPreferences): string {
  const run = sync.lastRun;
  if (run === null) return 'Never run';
  const changed = run.changedCount === null ? null : `${String(run.changedCount)} changed`;
  return [`Last run ${formatDateTimeDisplay(run.createdAt, preferences)}`, RUN_STATUS_WORDS[run.status], changed ?? run.summary]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** When the sync runs next: a time, the webhook, or nothing scheduled. */
export function nextRunText(sync: Pick<SportLeagueSyncDto, 'mode' | 'nextRunAt'>, preferences: DisplayPreferences): string {
  if (sync.mode === SportLeagueSyncMode.WEBHOOK) return 'Follows the webhook, with a poll while an event is live';
  return sync.nextRunAt === null ? 'Not scheduled' : `Next run ${formatDateTimeDisplay(sync.nextRunAt, preferences)}`;
}
