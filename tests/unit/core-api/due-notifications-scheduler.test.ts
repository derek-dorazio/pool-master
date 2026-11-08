/**
 * The clock-driven emails (#845) each sweep on a timer and job lock of their own, so a slow kind
 * never holds up another or the event lifecycle sweep that puts contests live.
 */
import type { PrismaClient } from '@prisma/client';
import { memoizedRead, ReadMemoKey } from '../../../packages/core-api/src/core/request-read-memo';
import {
  DueNotificationKind,
  DueNotificationsScheduler,
  dueNotificationsLockKey,
  type DueNotifications,
} from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

const SWEPT_AT = new Date('2026-06-01T13:00:00.000Z');

function scheduler(notifications: DueNotifications, options: { kind?: DueNotificationKind; jobLock?: ReturnType<typeof heldHere>; logger?: ReturnType<typeof fakeLogger> } = {}) {
  return new DueNotificationsScheduler({
    kind: options.kind ?? DueNotificationKind.ENTRY_REMINDERS,
    notifications,
    jobLock: options.jobLock ?? heldHere(),
    logger: options.logger ?? fakeLogger(),
    now: () => SWEPT_AT,
  });
}

describe('DueNotificationsScheduler', () => {
  it('asks its kind to queue what is due at the sweep time, under a lock named for that kind', async () => {
    const keys: string[] = [];
    const notifications = { queueDue: jest.fn(async () => undefined) };
    const jobLock = { runExclusive: async (key: string, work: () => Promise<void>) => { keys.push(key); await work(); return true; } };

    await scheduler(notifications, { kind: DueNotificationKind.LIVE_STANDINGS, jobLock }).runSweep();

    expect(notifications.queueDue).toHaveBeenCalledWith(SWEPT_AT);
    expect(keys).toEqual(['notifications-due:LIVE_STANDINGS']);
  });

  it('gives every kind a lock of its own, so two kinds can sweep on different server tasks at once', () => {
    const keys = Object.values(DueNotificationKind).map(dueNotificationsLockKey);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain('event-lifecycle-sweep');
  });

  it('lets a slow kind run while another kind sweeps and finishes, rather than holding it up', async () => {
    let finishDigests!: () => void;
    const digests = { queueDue: jest.fn(() => new Promise<void>((resolve) => { finishDigests = resolve; })) };
    const reminders = { queueDue: jest.fn(async () => undefined) };

    const slow = scheduler(digests, { kind: DueNotificationKind.COMMISSIONER_NOTICES }).runSweep();
    await scheduler(reminders, { kind: DueNotificationKind.ENTRY_REMINDERS }).runSweep();

    expect(reminders.queueDue).toHaveBeenCalledTimes(1);
    finishDigests();
    await slow;
    expect(digests.queueDue).toHaveBeenCalledTimes(1);
  });

  it('queues nothing when another server task holds the kind\'s lock', async () => {
    const notifications = { queueDue: jest.fn(async () => undefined) };
    const jobLock = heldElsewhere();

    await scheduler(notifications, { jobLock }).runSweep();

    expect(jobLock.keys).toEqual(['notifications-due:ENTRY_REMINDERS']);
    expect(notifications.queueDue).not.toHaveBeenCalled();
  });

  it('skips a sweep that comes due while its kind\'s last sweep is still running, and sweeps again after it ends', async () => {
    let finishFirst!: () => void;
    const notifications = { queueDue: jest.fn<Promise<void>, [Date]>().mockImplementationOnce(() => new Promise<void>((resolve) => { finishFirst = resolve; })).mockResolvedValue(undefined) };
    const logger = fakeLogger();
    const due = scheduler(notifications, { logger });

    const first = due.runSweep();
    await new Promise((resolve) => setImmediate(resolve));
    await due.runSweep();

    expect(notifications.queueDue).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ action: 'notificationsDue.overlap', data: { kind: 'ENTRY_REMINDERS' } }, expect.any(String));
    finishFirst();
    await first;
    await due.runSweep();
    expect(notifications.queueDue).toHaveBeenCalledTimes(2);
  });

  it('logs a failed sweep with its kind rather than leaving the timer an unhandled rejection, and sweeps again next time', async () => {
    const notifications = { queueDue: jest.fn<Promise<void>, [Date]>().mockRejectedValueOnce(new Error('outbox down')).mockResolvedValue(undefined) };
    const logger = fakeLogger();
    const due = scheduler(notifications, { logger });

    await expect(due.runSweep()).resolves.toBeUndefined();
    await due.runSweep();

    expect(logger.error).toHaveBeenCalledWith({ action: 'notificationsDue.failed', data: { kind: 'ENTRY_REMINDERS', error: 'outbox down' } }, expect.any(String));
    expect(notifications.queueDue).toHaveBeenCalledTimes(2);
  });

  it('gives each sweep its own read memo, so a read the sweep repeats is made once per sweep', async () => {
    // Stands in for the root Prisma client, the only one whose reads are remembered.
    const root = { $transaction: jest.fn() } as unknown as PrismaClient;
    const load = jest.fn(async () => ({ name: 'NFL' }));
    const read = () => memoizedRead(root, `${ReadMemoKey.sportLeague}nfl`, load);
    const due = scheduler({ queueDue: async () => { await read(); await read(); } });

    await due.runSweep();
    expect(load).toHaveBeenCalledTimes(1);
    await due.runSweep();

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('sweeps on its timer once started, and no more once stopped', () => {
    jest.useFakeTimers();
    try {
      const notifications = { queueDue: jest.fn(async () => undefined) };
      const due = scheduler(notifications);

      due.start();
      jest.advanceTimersByTime(5 * 60 * 1000);
      expect(notifications.queueDue).toHaveBeenCalledTimes(1);
      due.stop();
      jest.advanceTimersByTime(10 * 60 * 1000);
      expect(notifications.queueDue).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
