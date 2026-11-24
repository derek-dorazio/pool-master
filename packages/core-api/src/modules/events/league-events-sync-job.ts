/**
 * The SYNC_LEAGUE_EVENTS job's payload (#1819): one sport league's events sync. The schedule
 * queues one per synced league, which reads the league's current Season and every later one
 * (#2003); an admin's Sync now queues one for the league they are on, for one Season or those.
 * What started it is the job's own (#1861), not the payload's.
 */

import { z } from 'zod';
import { BackgroundJobType } from '@poolmaster/shared/domain';
import type { BackgroundJobOptions, BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { BackgroundJobRequest } from '@poolmaster/shared/domain';

export const SyncLeagueEventsJobPayloadSchema = z.object({
  sportLeagueId: z.uuid(),
  /** The one Season to sync; absent, the league's current Season and every later one, as the job runs. */
  sportLeagueSeasonId: z.uuid().optional(),
});
export type SyncLeagueEventsJobPayload = z.infer<typeof SyncLeagueEventsJobPayloadSchema>;

/**
 * The job syncing one league's events. Its dedupe key holds one such job waiting per league and
 * Season asked for, so a schedule pass and an admin's press close together sync once, while an
 * admin asking for one Season (last season, say) gets a job of their own.
 */
export function syncLeagueEventsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  payload: SyncLeagueEventsJobPayload,
  options: Omit<BackgroundJobOptions, 'dedupeKey'>,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SYNC_LEAGUE_EVENTS, payload, {
    ...options,
    dedupeKey: `${BackgroundJobType.SYNC_LEAGUE_EVENTS}:${payload.sportLeagueId}:${payload.sportLeagueSeasonId ?? 'current'}`,
  });
}
