/**
 * The job that rebuilds stored live leaderboards (#1463): its payload and the request a write
 * makes when it changed what boards are computed from. One job covers one subject, an event (every
 * board of the contests on it) or a contest (its own boards), and its dedupe key holds one such job
 * waiting per subject. A burst of writes to one event therefore queues one rebuild; a write while
 * that rebuild runs queues one more, since claiming the job released its key. Its handler is
 * ContestService.rebuildLeaderboardSnapshots.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { LeaderboardChanges } from './leaderboard-snapshots';

/** What a rebuild job covers. */
export const LeaderboardRebuildSubject = {
  /** Every stored board of the contests on one event. */
  EVENT: 'EVENT',
  /** The stored boards of one contest. */
  CONTEST: 'CONTEST',
} as const;
export type LeaderboardRebuildSubject = (typeof LeaderboardRebuildSubject)[keyof typeof LeaderboardRebuildSubject];

export const RebuildLeaderboardsJobPayloadSchema = z.object({
  subject: z.enum([LeaderboardRebuildSubject.EVENT, LeaderboardRebuildSubject.CONTEST]),
  id: z.string().min(1),
});
export type RebuildLeaderboardsJobPayload = z.infer<typeof RebuildLeaderboardsJobPayloadSchema>;

/** The job rebuilding one subject's boards, due at once. */
export function rebuildLeaderboardsJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  subject: LeaderboardRebuildSubject,
  id: string,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.REBUILD_LEADERBOARDS, { subject, id }, {
    dedupeKey: `${BackgroundJobType.REBUILD_LEADERBOARDS}:${subject}:${id}`,
  });
}

/** What a rebuild job asks the contest service to rebuild. */
export function leaderboardChangesOf(payload: RebuildLeaderboardsJobPayload): LeaderboardChanges {
  return payload.subject === LeaderboardRebuildSubject.EVENT
    ? { sportEventIds: [payload.id], contestIds: [] }
    : { sportEventIds: [], contestIds: [payload.id] };
}
