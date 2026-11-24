import { enumLabel } from '@poolmaster/shared/display-strings';
import { SportLeagueSyncMode } from '@poolmaster/shared/domain';
import { formatDateTimeDisplay, type DisplayPreferences } from '@/features/shared/ui';
import type { SportLeagueSyncDto } from '@/lib/api';

/** A sync's last run as one line: when it was queued, how it ended, and what it changed or said. */
export function lastRunText(sync: Pick<SportLeagueSyncDto, 'lastRun'>, preferences: DisplayPreferences): string {
  const run = sync.lastRun;
  if (run === null) return 'Never run';
  const changed = run.changedCount === null ? null : `${String(run.changedCount)} changed`;
  return [`Last run ${formatDateTimeDisplay(run.createdAt, preferences)}`, enumLabel('ProviderSyncRunStatus', run.status), changed ?? run.summary]
    .filter((part): part is string => part !== null && part !== '')
    .join(' · ');
}

/** When the sync runs next: a time, the webhook, or nothing scheduled. */
export function nextRunText(sync: Pick<SportLeagueSyncDto, 'mode' | 'nextRunAt'>, preferences: DisplayPreferences): string {
  if (sync.mode === SportLeagueSyncMode.WEBHOOK) return 'Follows the webhook, with a poll while an event is live';
  return sync.nextRunAt === null ? 'Not scheduled' : `Next run ${formatDateTimeDisplay(sync.nextRunAt, preferences)}`;
}
