/**
 * The contest started and final results email jobs as a contest's move writes them (#1387): their
 * payloads and the requests the move hands its adapter. The handlers are in contest-email-jobs.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

export const ContestStartedEmailsJobPayloadSchema = z.object({
  contestId: z.string().min(1),
  /** The event whose start took the contest live. */
  sportEventId: z.string().min(1),
});
export type ContestStartedEmailsJobPayload = z.infer<typeof ContestStartedEmailsJobPayloadSchema>;

export const ContestSettledEmailsJobPayloadSchema = z.object({
  contestId: z.string().min(1),
});
export type ContestSettledEmailsJobPayload = z.infer<typeof ContestSettledEmailsJobPayloadSchema>;

/** Builds the jobs a contest's move writes in its transaction. */
export type ContestEmailJobRequests = Pick<BackgroundJobQueue, 'request'>;

/**
 * E1's job for one contest that went live for one event. Its dedupe key holds one such job per
 * contest still waiting for its first try, so a second move before it runs queues nothing more.
 */
export function contestStartedEmailsJob(jobs: ContestEmailJobRequests, contestId: string, sportEventId: string): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.CONTEST_STARTED_EMAILS, { contestId, sportEventId }, {
    dedupeKey: `${BackgroundJobType.CONTEST_STARTED_EMAILS}:${contestId}`,
  });
}

/** F1's job for one contest that completed, with a dedupe key as E1's. */
export function contestSettledEmailsJob(jobs: ContestEmailJobRequests, contestId: string): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.CONTEST_SETTLED_EMAILS, { contestId }, {
    dedupeKey: `${BackgroundJobType.CONTEST_SETTLED_EMAILS}:${contestId}`,
  });
}
