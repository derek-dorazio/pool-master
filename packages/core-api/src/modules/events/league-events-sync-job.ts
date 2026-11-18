/**
 * The SYNC_LEAGUE_EVENTS job's payload (#1819): one sport league's events sync, for the years it
 * names, and what started it. The schedule queues one per synced league; an admin's Sync now
 * queues one for the league they are on.
 */

import { z } from 'zod';
import { BackgroundJobType, ProviderSyncTrigger } from '@poolmaster/shared/domain';
import type { BackgroundJobOptions, BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { BackgroundJobRequest } from '@poolmaster/shared/domain';

export const SyncLeagueEventsJobPayloadSchema = z.object({
  sportLeagueId: z.uuid(),
  /** The event years to sync, each a calendar year of start dates. */
  eventYears: z.array(z.number().int().min(1900).max(9999)).min(1),
  trigger: z.enum(ProviderSyncTrigger),
  /** The root admin who pressed Sync now; absent for the schedule. */
  requestedByUserId: z.uuid().optional(),
});
export type SyncLeagueEventsJobPayload = z.infer<typeof SyncLeagueEventsJobPayloadSchema>;

/**
 * The job syncing one league's events. Its dedupe key holds one such job waiting per league and
 * set of years, so a schedule pass and an admin's press close together sync once, while an admin
 * asking for another year (last season, say) gets a job of their own.
 */
export function syncLeagueEventsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  payload: SyncLeagueEventsJobPayload,
  options: Omit<BackgroundJobOptions, 'dedupeKey'> = {},
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SYNC_LEAGUE_EVENTS, payload, {
    ...options,
    dedupeKey: `${BackgroundJobType.SYNC_LEAGUE_EVENTS}:${payload.sportLeagueId}:${[...payload.eventYears].sort((a, b) => a - b).join(',')}`,
  });
}
