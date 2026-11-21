/**
 * The released-edition seam a sport event's release calls (#714, #1318): the jobs that add the
 * edition to each contest made from a template covering its series. The release writes the jobs
 * with its own status change; each job's handler is ContestManagementService.addReleasedEditionToContest.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestRepository } from '@poolmaster/shared/db';
import type { BackgroundJobRequest, SportEvent } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { addReleasedEditionToContestJob } from './released-edition-job-requests';

export interface ReleasedEditionContests {
  releasedEditionJobs(
    sportEvent: Pick<SportEvent, 'id' | 'eventSeriesId' | 'eventYear'>,
    jobs: Pick<BackgroundJobQueue, 'request'>,
  ): Promise<BackgroundJobRequest[]>;
}

export interface ReleasedEditionContestsDeps {
  contests: Pick<ContestRepository, 'findJoinableByReleasedEdition'>;
  logger?: Pick<FastifyBaseLogger, 'info'>;
}

/**
 * A released edition joins the contests made from a template covering its series (#714): a
 * majors pool takes each major of its year as the major is released. A contest takes it while
 * it can change its events (not finished, not drawn), when its events are all of the edition's
 * year; a contest that already has it is left alone.
 *
 * A release can reach hundreds of pools across as many leagues, too many for its request, so it
 * only finds those contests: this answers one job per contest (#1318), for the release to write
 * with its own status change. It only reads, so the handler map can be built before the
 * services whose writes collect from it.
 */
export function releasedEditionContests({ contests, logger }: ReleasedEditionContestsDeps): ReleasedEditionContests {
  return {
    async releasedEditionJobs(sportEvent, jobs) {
      // The repository filters status, draw, the edition and the year in one query (#1179), so a
      // series' years of finished pools are never read back.
      const contestIds = (await contests.findJoinableByReleasedEdition(sportEvent)).map((contest) => contest.id);
      if (contestIds.length > 0) {
        logger?.info({ sportEventId: sportEvent.id, contestIds }, 'contest management queues a released edition for its template contests');
      }
      return contestIds.map((contestId) => addReleasedEditionToContestJob(jobs, contestId, sportEvent.id));
    },
  };
}
