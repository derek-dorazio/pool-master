/**
 * The job that adds a released edition to one contest made from a template covering its series
 * (#1318): a majors pool takes each major as it is released. A release can reach hundreds of
 * such contests across as many leagues, so each is its own job, never the release request's
 * work. Its handler is ContestManagementService.addReleasedEditionToContest.
 */

import { z } from 'zod';
import { BackgroundJobType, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';

export const AddReleasedEditionToContestJobPayloadSchema = z.object({
  contestId: z.string().min(1),
  /** The edition just released. */
  sportEventId: z.string().min(1),
});
export type AddReleasedEditionToContestJobPayload = z.infer<typeof AddReleasedEditionToContestJobPayloadSchema>;

/**
 * The job for one contest and one released edition. Its dedupe key holds one such job per
 * contest and edition still waiting for its first try, so a second release before it runs
 * queues nothing more.
 */
export function addReleasedEditionToContestJob(
  jobs: Pick<BackgroundJobQueue, 'request'>,
  contestId: string,
  sportEventId: string,
): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST, { contestId, sportEventId }, {
    dedupeKey: `${BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST}:${contestId}:${sportEventId}`,
  });
}

/**
 * A released edition joins the contests made to cover its series, a majors pool's major (#714),
 * by one job per contest written with the release (#1318): a release that loses a race queues
 * nothing, and one that lands always has its contests' jobs.
 */
export const releaseIntoTemplateContestsHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> = {
  key: 'release-into-template-contests',
  queues: [BackgroundJobType.ADD_RELEASED_EDITION_TO_CONTEST],
  when: (event) => event.from === SportEventStatus.DRAFT && event.to === SportEventStatus.SCHEDULED,
  jobs: (event, { queue, releasedEditionContests }) => releasedEditionContests.releasedEditionJobs(event.sportEvent, queue),
};
