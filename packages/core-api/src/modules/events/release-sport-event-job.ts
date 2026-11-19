/**
 * The job that tries one synced DRAFT event's automatic release (#1823): its payload, the request
 * the release sweep queues, and the result it reports. Its handler is
 * `SportEventService.autoReleaseEvent`, which judges the event's ready checks as it stands when
 * the job runs and releases it only when every one passes.
 */

import { z } from 'zod';
import {
  BackgroundJobType,
  JobErrorType,
  ReleaseAttemptOutcome,
  type BackgroundJobOutcome,
  ReleaseAttemptTrigger,
  type BackgroundJobRequest,
  type ReleaseAttemptResult,
} from '@poolmaster/shared/domain';
import type { ReleaseCheckDto } from '@poolmaster/shared/dto/events.dto';
import { mapReleaseCheckToDto } from '../../mappers/sport-events.mapper';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';

export const ReleaseSportEventJobPayloadSchema = z.object({
  sportEventId: z.string().min(1),
  trigger: z.enum(ReleaseAttemptTrigger),
});
export type ReleaseSportEventJobPayload = z.infer<typeof ReleaseSportEventJobPayloadSchema>;

/**
 * The job for one event in its release window. Its dedupe key holds one such job per event still
 * waiting for its first try, so a sweep that finds the event again before it runs queues nothing
 * more.
 */
export function releaseSportEventJob(jobs: Pick<BackgroundJobQueue, 'request'>, sportEventId: string): BackgroundJobRequest {
  return jobs.request(BackgroundJobType.RELEASE_SPORT_EVENT, { sportEventId, trigger: ReleaseAttemptTrigger.SCHEDULE }, {
    dedupeKey: `${BackgroundJobType.RELEASE_SPORT_EVENT}:${sportEventId}`,
  });
}

/**
 * What the job reports for the attempt, as its stored result: every check in its wire shape, or
 * why it was skipped. Activity reads it back (#1819).
 */
export type ReleaseAttemptResultJson =
  | { outcome: Exclude<ReleaseAttemptResult['outcome'], 'SKIPPED'>; checks: ReleaseCheckDto[] }
  | Extract<ReleaseAttemptResult, { outcome: 'SKIPPED' }>;

export function releaseAttemptResultToJson(result: ReleaseAttemptResult): ReleaseAttemptResultJson {
  return result.outcome === ReleaseAttemptOutcome.SKIPPED ? result : { outcome: result.outcome, checks: result.checks.map(mapReleaseCheckToDto) };
}

/**
 * What the job reports (#1861): a release changed the one event; a hold changed nothing and is
 * CHECK_FAILED, since a ready check failed; a skip changed nothing. The attempt is its result.
 */
export function releaseAttemptJobOutcome(result: ReleaseAttemptResult): BackgroundJobOutcome {
  return {
    changedCount: result.outcome === ReleaseAttemptOutcome.RELEASED ? 1 : 0,
    ...(result.outcome === ReleaseAttemptOutcome.HELD && { heldBack: JobErrorType.CHECK_FAILED }),
    result: releaseAttemptResultToJson(result),
  };
}
