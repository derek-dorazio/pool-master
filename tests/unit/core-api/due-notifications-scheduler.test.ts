/**
 * The clock-driven emails (#845) each sweep on a timer and job lock of their own, so a slow kind
 * never holds up another or the event lifecycle sweep that puts contests live, and their sweeps
 * are spread over each interval. The sweep itself (overlap, failure, read memo, timer) is
 * `LockedSweep`'s, tested in locked-sweep.test.ts.
 */
import {
  DUE_NOTIFICATIONS_STAGGER_MS,
  DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS,
  DueNotificationKind,
  DueNotificationsScheduler,
  dueNotificationsLockKey,
  staggeredDueNotificationsSchedulers,
  type DueNotifications,
} from '../../../packages/core-api/src/modules/notifications';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

const SWEPT_AT = new Date('2026-06-01T13:00:00.000Z');

function scheduler(notifications: DueNotifications, options: { kind?: DueNotificationKind; jobLock?: ReturnType<typeof heldHere> } = {}) {
  return new DueNotificationsScheduler({
    kind: options.kind ?? DueNotificationKind.ENTRY_REMINDERS,
    notifications,
    jobLock: options.jobLock ?? heldHere(),
    logger: fakeLogger(),
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

  it('fits every kind\'s first sweep inside one interval after the lifecycle sweep\'s', () => {
    const kinds = Object.values(DueNotificationKind);

    expect(kinds.length * DUE_NOTIFICATIONS_STAGGER_MS).toBeLessThan(DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS);
  });

  describe('on its timer', () => {
    beforeEach(() => jest.useFakeTimers({ now: SWEPT_AT }));
    afterEach(() => jest.useRealTimers());

    it('sweeps at the time on the clock when given no clock of its own, every five minutes once started', async () => {
      const notifications = { queueDue: jest.fn(async () => undefined) };
      const due = new DueNotificationsScheduler({ kind: DueNotificationKind.ENTRY_REMINDERS, notifications, jobLock: heldHere() });

      due.start();
      await jest.advanceTimersByTimeAsync(5 * 60 * 1000);

      expect(notifications.queueDue).toHaveBeenCalledWith(new Date(SWEPT_AT.getTime() + 5 * 60 * 1000));
      due.stop();
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      expect(notifications.queueDue).toHaveBeenCalledTimes(1);
    });

    it('spreads the kinds\' sweeps thirty seconds apart, all after the lifecycle sweep\'s tick, then each every interval', async () => {
      const kinds = [DueNotificationKind.ENTRY_REMINDERS, DueNotificationKind.LIVE_STANDINGS, DueNotificationKind.COMMISSIONER_NOTICES]
        .map((kind) => ({ kind, notifications: { queueDue: jest.fn(async () => undefined) } }));
      const schedulers = staggeredDueNotificationsSchedulers(kinds, { jobLock: heldHere() });
      const swept = () => kinds.map(({ notifications }) => notifications.queueDue.mock.calls.length);

      schedulers.forEach((due) => due.start());
      await jest.advanceTimersByTimeAsync(DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS);
      expect(swept()).toEqual([0, 0, 0]);
      await jest.advanceTimersByTimeAsync(DUE_NOTIFICATIONS_STAGGER_MS);
      expect(swept()).toEqual([1, 0, 0]);
      await jest.advanceTimersByTimeAsync(DUE_NOTIFICATIONS_STAGGER_MS);
      expect(swept()).toEqual([1, 1, 0]);
      await jest.advanceTimersByTimeAsync(DUE_NOTIFICATIONS_STAGGER_MS);
      expect(swept()).toEqual([1, 1, 1]);
      await jest.advanceTimersByTimeAsync(DUE_NOTIFICATIONS_SWEEP_INTERVAL_MS);

      expect(swept()).toEqual([2, 2, 2]);
      schedulers.forEach((due) => due.stop());
    });
  });
});
