/**
 * The contest emails built by background jobs rather than in the request that caused them:
 * "Contest is live" (E1) as a contest goes live and "Final results" (F1 to F3) as it completes
 * (#1387), and an event on the contest postponed, moved or cancelled (C6, C7; #1458). The move writes the job in its own transaction; the job reads what it
 * needs again and queues the emails exactly as the request once did.
 *
 * A job that throws is retried. Each email's outbox idempotency key is the contest (and for E1
 * the event) and the person, so a retry queues only what the failed try did not.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { ContestRepository, SportEventRepository } from '@poolmaster/shared/db';
import { ContestStatus } from '@poolmaster/shared/domain';
import { readFinalStandings, type FinalStandingsReadDeps } from '../contests/final-standings';
import type { ContestNotices } from './contest-notices';
import type {
  ContestEventChangedEmailsJobPayload,
  ContestSettledEmailsJobPayload,
  ContestStartedEmailsJobPayload,
} from './contest-email-job-requests';

export interface ContestEmailJobDeps {
  contests: Pick<ContestRepository, 'findById'>;
  sportEvents: Pick<SportEventRepository, 'findById'>;
  finalStandings: FinalStandingsReadDeps;
  notices: Pick<ContestNotices, 'contestStarted' | 'contestSettled' | 'contestEventChanged'>;
  logger?: FastifyBaseLogger;
}

export class ContestEmailJobs {
  constructor(private readonly deps: ContestEmailJobDeps) {}

  /** E1 for one contest that went live for one event. */
  async contestStarted(payload: ContestStartedEmailsJobPayload): Promise<void> {
    const [contest, sportEvent] = await Promise.all([
      this.deps.contests.findById(payload.contestId),
      this.deps.sportEvents.findById(payload.sportEventId),
    ]);
    if (!contest || !sportEvent) {
      this.skipped('email.contestStarted.skipped', payload.contestId, 'Skipped the contest is live email because its contest or event is gone');
      return;
    }
    await this.deps.notices.contestStarted(contest, sportEvent);
  }

  /**
   * F1 or F2 for one contest that completed, from the final places frozen at settlement. A
   * contest no longer completed by the time the job runs is being settled again, and that
   * settlement queues its own job.
   */
  async contestSettled(payload: ContestSettledEmailsJobPayload): Promise<void> {
    const contest = await this.deps.contests.findById(payload.contestId);
    if (contest?.status !== ContestStatus.COMPLETED) {
      this.skipped('email.contestSettled.skipped', payload.contestId, 'Skipped the final results email because the contest is gone or no longer completed');
      return;
    }
    await this.deps.notices.contestSettled(contest, await readFinalStandings(this.deps.finalStandings, contest));
  }

  /**
   * C6 or C7 for one contest on the event. The event is read again for its name and details, at
   * the start the change left it (a later move queues its own job). The contest's status is not
   * checked: a cancellation's job may run after settlement finished a contest that went on.
   */
  async contestEventChanged(payload: ContestEventChangedEmailsJobPayload): Promise<void> {
    const [contest, sportEvent] = await Promise.all([
      this.deps.contests.findById(payload.contestId),
      this.deps.sportEvents.findById(payload.sportEventId),
    ]);
    if (!contest || !sportEvent) {
      this.skipped('email.sportEventChanged.skipped', payload.contestId, 'Skipped the event changed email because its contest or event is gone');
      return;
    }
    await this.deps.notices.contestEventChanged(contest, { ...sportEvent, startDate: new Date(payload.change.startsAt) }, payload.change);
  }

  private skipped(action: string, contestId: string, message: string): void {
    this.deps.logger?.warn({ action, data: { contestId } }, message);
  }
}
