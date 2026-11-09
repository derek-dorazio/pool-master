/**
 * The contest email jobs: "Contest is live" and "Final results" as a contest's move writes them
 * (#1387), and the event postponed, moved and cancelled emails one job per contest on the event
 * (#1458). Their payloads and the requests that build them; the handlers are in contest-email-jobs.
 */

import { z } from 'zod';
import { BackgroundJobType, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import { ContestEventChangeKind } from '../email/system-email-templates';
import type { SportEventChange } from './contest-notices';

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

const isoInstant = z.iso.datetime();

/**
 * What happened to the event, as the job carries it: the change and the event's start as the
 * change left it, so the email and its outbox key say what was true when it happened even if the
 * event moves again before the job runs (that move queues a job of its own).
 */
export const ContestEventChangedEmailsChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal(ContestEventChangeKind.POSTPONED), startsAt: isoInstant }),
  z.object({ kind: z.literal(ContestEventChangeKind.RESCHEDULED), startsAt: isoInstant, previousStart: isoInstant }),
  z.object({ kind: z.literal(ContestEventChangeKind.CANCELLED), startsAt: isoInstant }),
]);

export const ContestEventChangedEmailsJobPayloadSchema = z.object({
  contestId: z.string().min(1),
  sportEventId: z.string().min(1),
  change: ContestEventChangedEmailsChangeSchema,
});
export type ContestEventChangedEmailsJobPayload = z.infer<typeof ContestEventChangedEmailsJobPayloadSchema>;

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

/**
 * The outbox `about` of an event change: the change and the start it leaves, and a move both
 * starts, so a second postponement or a move back to an earlier new date is told again.
 */
export function sportEventChangeAbout(sportEventId: string, change: ContestEventChangedEmailsJobPayload['change']): string {
  return change.kind === ContestEventChangeKind.RESCHEDULED
    ? `${sportEventId}:moved-${change.previousStart}-to-${change.startsAt}`
    : `${sportEventId}:${change.kind.toLowerCase()}-${change.startsAt}`;
}

/**
 * C6 or C7's job for one contest on the event. Its dedupe key is the contest and the change, so
 * the same change told twice before the job runs queues one job, and a different change its own.
 */
export function contestEventChangedEmailsJob(
  jobs: ContestEmailJobRequests,
  contestId: string,
  sportEvent: { id: string; startDate: Date },
  change: SportEventChange,
): BackgroundJobRequest {
  const startsAt = sportEvent.startDate.toISOString();
  const carried: ContestEventChangedEmailsJobPayload['change'] = change.kind === ContestEventChangeKind.RESCHEDULED
    ? { kind: change.kind, startsAt, previousStart: change.previousStart.toISOString() }
    : { kind: change.kind, startsAt };
  return jobs.request(BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS, { contestId, sportEventId: sportEvent.id, change: carried }, {
    dedupeKey: `${BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS}:${contestId}:${sportEventChangeAbout(sportEvent.id, carried)}`,
  });
}
