/**
 * The emails that come due on the clock rather than on an action (#845): entry reminders, live
 * standings, commissioner digests and the rest. Each kind sweeps on a timer of its own, behind a
 * job lock of its own, so a slow kind (a Monday morning's digests across every league) never
 * holds up another, nor the event lifecycle sweep that puts contests live.
 *
 * Every server task that runs the background work starts one of these per kind, and each kind's
 * sweep runs on one of them (#1159): the task holding that kind's lock. The outbox's idempotency
 * key keeps a second sweep, or a second task, from sending an email twice.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { JobLock } from '../../core/job-lock';
import { runWithReadMemo } from '../../core/request-read-memo';

/** One kind of email that comes due on the clock: each sweep asks it to queue what is due. */
export interface DueNotifications {
  queueDue(now: Date): Promise<void>;
}

/** Each kind of email that comes due on the clock; a kind's sweep takes its lock by this name. */
export const DueNotificationKind = {
  ENTRY_REMINDERS: 'ENTRY_REMINDERS',
  LIVE_STANDINGS: 'LIVE_STANDINGS',
  COMMISSIONER_NOTICES: 'COMMISSIONER_NOTICES',
  DRAFT_EVENT_NOTICES: 'DRAFT_EVENT_NOTICES',
  MEMBER_JOINED_NOTICES: 'MEMBER_JOINED_NOTICES',
  PLAN_PREVIEW_NOTICES: 'PLAN_PREVIEW_NOTICES',
  DRAW_RECEIPTS: 'DRAW_RECEIPTS',
} as const;
export type DueNotificationKind = (typeof DueNotificationKind)[keyof typeof DueNotificationKind];

/** One kind's notifications, with the kind they sweep as. */
export interface NamedDueNotifications {
  kind: DueNotificationKind;
  notifications: DueNotifications;
}

/** As often as the event lifecycle sweep, which the kinds once ran inside. */
export const DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

/** The job lock a kind's sweep holds. */
export function dueNotificationsLockKey(kind: DueNotificationKind): string {
  return `notifications-due:${kind}`;
}

export interface DueNotificationsSchedulerOptions extends NamedDueNotifications {
  /** Keeps the kind's sweep to one server task. */
  jobLock: JobLock;
  logger?: FastifyBaseLogger;
  now?: () => Date;
  intervalMs?: number;
}

export class DueNotificationsScheduler {
  private timer?: ReturnType<typeof setInterval>;
  private sweeping = false;
  private readonly now: () => Date;

  constructor(private readonly options: DueNotificationsSchedulerOptions) {
    this.now = options.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.runSweep();
    }, this.options.intervalMs ?? DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /**
   * One sweep of the kind, when this task holds its lock and its last sweep here has ended.
   * Each sweep has a read memo of its own, as a request has. A failure is logged, never thrown,
   * so the timer carries on and the next sweep tries again.
   */
  async runSweep(): Promise<void> {
    const { kind, notifications, jobLock, logger } = this.options;
    if (this.sweeping) {
      logger?.warn({ action: 'notificationsDue.overlap', data: { kind } }, 'Skipped a notifications sweep because the previous one is still running');
      return;
    }
    this.sweeping = true;
    try {
      const ran = await jobLock.runExclusive(dueNotificationsLockKey(kind), () => runWithReadMemo(() => notifications.queueDue(this.now())));
      if (!ran) {
        logger?.debug({ action: 'notificationsDue.heldElsewhere', data: { kind } }, 'Skipped a notifications sweep because another server task runs it');
      }
    } catch (error) {
      logger?.error({
        action: 'notificationsDue.failed',
        data: { kind, error: error instanceof Error ? error.message : String(error) },
      }, 'A notifications sweep failed to queue the emails due');
    } finally {
      this.sweeping = false;
    }
  }
}
