/**
 * The released-edition seam a sport event's release calls (#714, #1318): the jobs that add the
 * edition to each contest made from a template covering its series. ContestManagementService
 * implements it; the release writes the jobs with its own status change.
 */

import type { BackgroundJobRequest, SportEvent } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

export interface ReleasedEditionContests {
  releasedEditionJobs(
    sportEvent: Pick<SportEvent, 'id' | 'eventSeriesId' | 'eventYear'>,
    jobs: Pick<BackgroundJobQueue, 'request'>,
  ): Promise<BackgroundJobRequest[]>;
}
