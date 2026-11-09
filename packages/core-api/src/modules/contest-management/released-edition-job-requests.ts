/**
 * The job that adds a released edition to one contest made from a template covering its series
 * (#1318): a majors pool takes each major as it is released. A release can reach hundreds of
 * such contests across as many leagues, so each is its own job, never the release request's
 * work. Its handler is ContestManagementService.addReleasedEditionToContest.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

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
