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
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';
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

/** A sport event's status shows on its contests' boards, so they are rebuilt by a job written with it (#1466). */
export const rebuildEventLeaderboardsHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> = {
  key: 'rebuild-event-leaderboards',
  queues: [BackgroundJobType.REBUILD_LEADERBOARDS],
  jobs: (event, { queue }) => [rebuildLeaderboardsJob(queue, LeaderboardRebuildSubject.EVENT, event.sportEvent.id)],
};

/**
 * A score, result, standing, field or game of an event is what its contests' boards are computed
 * from, so every write changing one carries the job rebuilding them (#1466): a write that fails
 * queues no rebuild.
 */
export const rebuildChangedResultsLeaderboardsHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_RESULTS_CHANGED> = {
  key: 'rebuild-leaderboards-for-changed-results',
  queues: [BackgroundJobType.REBUILD_LEADERBOARDS],
  jobs: (event, { queue }) => [rebuildLeaderboardsJob(queue, LeaderboardRebuildSubject.EVENT, event.sportEventId)],
};

/** A decided game changes its event's boards, as any result does. */
export const rebuildDecidedGameLeaderboardsHandler: DomainEventHandler<typeof DomainEventType.GAME_DECIDED> = {
  key: 'rebuild-leaderboards-for-decided-game',
  queues: [BackgroundJobType.REBUILD_LEADERBOARDS],
  jobs: (event, { queue }) => [rebuildLeaderboardsJob(queue, LeaderboardRebuildSubject.EVENT, event.sportEventId)],
};
