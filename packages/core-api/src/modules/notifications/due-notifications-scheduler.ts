/**
 * The emails that come due on the clock rather than on an action (#845): entry reminders, live
 * standings, commissioner digests and the rest. Each kind sweeps on a timer of its own, behind a
 * job lock of its own, so a slow kind (a Monday morning's digests across every league) never
 * holds up another, nor the event lifecycle sweep that puts contests live. Their sweeps are
 * staggered within each interval so they don't all reach the database on the same tick.
 *
 * Every server task that runs the background work starts one of these per kind, and each kind's
 * sweep runs on one of them (#1159): the task holding that kind's lock. The outbox's idempotency
 * key keeps a second sweep, or a second task, from sending an email twice.
 */

import type { FastifyBaseLogger } from 'fastify';
import type { JobLock } from '../../core/job-lock';
import { LockedSweep } from '../../core/locked-sweep';

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

/**
 * How far apart the kinds' sweeps fall within each interval. Started together, every kind would
 * otherwise sweep on the same tick as the others and the lifecycle sweep, all sharing one task's
 * connection pool.
 */
export const DUE_NOTIFICATIONS_STAGGER_MS = 30 * 1000;

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
  /** How long after `start` the kind first sweeps; a full interval unless staggered. */
  firstSweepAfterMs?: number;
}

export class DueNotificationsScheduler {
  private readonly sweep: LockedSweep;

  constructor(options: DueNotificationsSchedulerOptions) {
    const now = options.now ?? (() => new Date());
    const intervalMs = options.intervalMs ?? DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS;
    this.sweep = new LockedSweep({
      lockKey: dueNotificationsLockKey(options.kind),
      jobLock: options.jobLock,
      intervalMs,
      firstRunAfterMs: options.firstSweepAfterMs,
      label: `${options.kind} notifications sweep`,
      logger: options.logger,
    }, () => options.notifications.queueDue(now()));
  }

  start(): void {
    this.sweep.start();
  }

  stop(): void {
    this.sweep.stop();
  }

  /** One sweep of the kind, when this task holds its lock and its last sweep here has ended. */
  runSweep(): Promise<void> {
    return this.sweep.run();
  }
}

/**
 * One scheduler per kind, their sweeps spread `DUE_NOTIFICATIONS_STAGGER_MS` apart within each
 * interval and all after the lifecycle sweep's, which comes at the interval itself.
 */
export function staggeredDueNotificationsSchedulers(
  kinds: readonly NamedDueNotifications[],
  options: { jobLock: JobLock; logger?: FastifyBaseLogger },
): DueNotificationsScheduler[] {
  return kinds.map((due, index) => new DueNotificationsScheduler({
    ...due,
    ...options,
    firstSweepAfterMs: DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS + (index + 1) * DUE_NOTIFICATIONS_STAGGER_MS,
  }));
}
