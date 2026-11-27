/**
 * The SYNC_LEAGUE_ROSTER job's payload (#2025): one sport league's roster sync, for its current
 * Season. The sync tick queues one per synced league with a roster, on the ROSTER interval. What
 * started it is the job's own (#1861), not the payload's.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobOptions, BackgroundJobQueue } from '../../background-jobs/background-job-queue';

export const SyncLeagueRosterJobPayloadSchema = z.object({
  sportLeagueId: z.uuid(),
});
export type SyncLeagueRosterJobPayload = z.infer<typeof SyncLeagueRosterJobPayloadSchema>;

/** The job syncing one league's roster. Its dedupe key holds one such job waiting per league. */
export function syncLeagueRosterJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  payload: SyncLeagueRosterJobPayload,
  options: Omit<BackgroundJobOptions, 'dedupeKey'>,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.SYNC_LEAGUE_ROSTER, payload, {
    ...options,
    dedupeKey: `${BackgroundJobType.SYNC_LEAGUE_ROSTER}:${payload.sportLeagueId}`,
  });
}
