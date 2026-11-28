/**
 * The contest email jobs: "Contest is live" and "Final results" as a contest's move writes them
 * (#1387), and the event moved and cancelled emails one job per contest on the event
 * (#1458), and "Event postponed, picks are open again" as a postponement reopens a contest (#1808). Their payloads
 * and the requests that build them; the handlers are in contest-email-jobs.
 */

import { z } from 'zod';
import { BackgroundJobType, ContestStatus, SportEventStatus, type BackgroundJobRequest } from '@poolmaster/shared/domain';
import type { BackgroundJobQueue } from '../background-jobs/background-job-queue';
import type { ContestStatusChanged, DomainEventType } from '../domain-events/domain-event';
import type { DomainEventHandler } from '../domain-events/domain-event-handler';
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
  z.object({ kind: z.literal(ContestEventChangeKind.RESCHEDULED), startsAt: isoInstant, previousStart: isoInstant }),
  z.object({ kind: z.literal(ContestEventChangeKind.CANCELLED), startsAt: isoInstant }),
]);

export const ContestEventChangedEmailsJobPayloadSchema = z.object({
  contestId: z.string().min(1),
  sportEventId: z.string().min(1),
  change: ContestEventChangedEmailsChangeSchema,
});
export type ContestEventChangedEmailsJobPayload = z.infer<typeof ContestEventChangedEmailsJobPayloadSchema>;

export const ContestReopenedEmailsJobPayloadSchema = z.object({
  contestId: z.string().min(1),
  /** The postponed event whose later start reopened the contest. */
  sportEventId: z.string().min(1),
  /** The contest's start the reopen set, when its picks close again. */
  startsAt: isoInstant,
});
export type ContestReopenedEmailsJobPayload = z.infer<typeof ContestReopenedEmailsJobPayloadSchema>;

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
 * starts, so a move back to an earlier new date is told again.
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

/**
 * The outbox `about` of a reopen: the contest, the event and the start it reopened to, so a
 * second postponement to a later start tells the league again and a retry does not.
 */
export function contestReopenedAbout(payload: ContestReopenedEmailsJobPayload): string {
  return `${payload.contestId}:${payload.sportEventId}:reopened-${payload.startsAt}`;
}

/**
 * "Event postponed, picks are open again" for one contest a postponement took back to open (#1808), written with
 * its move. Its dedupe key is the reopen itself, so the same reopen told twice queues one job.
 */
export function contestReopenedEmailsJob(
  jobs: ContestEmailJobRequests,
  contestId: string,
  sportEventId: string,
  startsAt: Date,
): BackgroundJobRequest {
  const payload: ContestReopenedEmailsJobPayload = { contestId, sportEventId, startsAt: startsAt.toISOString() };
  return jobs.request(BackgroundJobType.CONTEST_REOPENED_EMAILS, payload, {
    dedupeKey: `${BackgroundJobType.CONTEST_REOPENED_EMAILS}:${contestReopenedAbout(payload)}`,
  });
}

/**
 * A cancellation tells the leagues on the event (C7) by one job per contest written with the
 * status, while the contests are still open: its settle job finishes them after. A contest the
 * cancellation leaves no event to play gets its no-scores result (F2) instead, so no job.
 */
export const tellLeaguesEventCancelledHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_STATUS_CHANGED> = {
  key: 'tell-leagues-event-cancelled',
  queues: [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS],
  when: (event) => event.to === SportEventStatus.CANCELLED && event.from !== SportEventStatus.CANCELLED,
  jobs: (event, { sportEventChanged }) => sportEventChanged.sportEventChangedJobs(event.sportEvent, { kind: ContestEventChangeKind.CANCELLED }),
};

/**
 * The statuses whose moved start is told to the leagues on the event: a draft's commissioners
 * can't see it yet, and a started event's picks are closed.
 */
const RESCHEDULE_TOLD: readonly SportEventStatus[] = [SportEventStatus.SCHEDULED];

/** C6 for a released event whose start moved: one job per contest on it, written with the new start (#1464). */
export const tellLeaguesEventRescheduledHandler: DomainEventHandler<typeof DomainEventType.SPORT_EVENT_RESCHEDULED> = {
  key: 'tell-leagues-event-rescheduled',
  queues: [BackgroundJobType.CONTEST_EVENT_CHANGED_EMAILS],
  when: (event) => RESCHEDULE_TOLD.includes(event.sportEvent.status),
  jobs: (event, { sportEventChanged }) => sportEventChanged.sportEventChangedJobs(
    { id: event.sportEvent.id, startDate: event.sportEvent.startDate },
    { kind: ContestEventChangeKind.RESCHEDULED, previousStart: event.previousStart },
    { reopening: event.reopeningContestIds },
  ),
};

/**
 * The event a contest's move names as its cause. A contest goes live, or reopens, only because
 * its event started or was postponed, so a move without one is a caller's mistake: it fails the
 * write rather than queue an email that names no event.
 */
function causingSportEventId(event: ContestStatusChanged): string {
  if (event.sportEventId === undefined) {
    throw new Error(`Contest ${event.contest.id} moved from ${event.from.join('/')} to ${event.to} without the sport event that moved it`);
  }
  return event.sportEventId;
}

/** E1, "Contest is live": an open contest its event's start took live, written with the move (#1387). */
export const tellLeagueContestStartedHandler: DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> = {
  key: 'tell-league-contest-started',
  queues: [BackgroundJobType.CONTEST_STARTED_EMAILS],
  when: (event) => event.to === ContestStatus.ACTIVE && event.from.includes(ContestStatus.OPEN),
  jobs: (event, { queue }) => [contestStartedEmailsJob(queue, event.contest.id, causingSportEventId(event))],
};

/**
 * "Event postponed, picks are open again" (#1808, #1910): a live contest a postponement took back
 * to open, told the start its picks close at again.
 */
export const tellLeagueContestReopenedHandler: DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> = {
  key: 'tell-league-contest-reopened',
  queues: [BackgroundJobType.CONTEST_REOPENED_EMAILS],
  when: (event) => event.to === ContestStatus.OPEN && event.from.includes(ContestStatus.ACTIVE),
  jobs: (event, { queue }) => {
    if (event.startsAt === undefined) {
      throw new Error(`Contest ${event.contest.id} reopened without the start its picks close at again`);
    }
    return [contestReopenedEmailsJob(queue, event.contest.id, causingSportEventId(event), event.startsAt)];
  },
};

/** F1 or F2, the final results: a contest settlement completed (#1387). */
export const tellLeagueContestSettledHandler: DomainEventHandler<typeof DomainEventType.CONTEST_STATUS_CHANGED> = {
  key: 'tell-league-contest-settled',
  queues: [BackgroundJobType.CONTEST_SETTLED_EMAILS],
  when: (event) => event.to === ContestStatus.COMPLETED,
  jobs: (event, { queue }) => [contestSettledEmailsJob(queue, event.contest.id)],
};
