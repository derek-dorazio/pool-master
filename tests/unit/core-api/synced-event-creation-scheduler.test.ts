import { expect } from '@jest/globals';
import type { IngestionScheduleConfig } from '../../../packages/shared/dto/config.dto';
import { SyncedEventCreationScheduler } from '../../../packages/core-api/src/modules/events/synced-event-creation-scheduler';
import { INGESTION_SCHEDULE_SETTINGS } from '../../../packages/core-api/src/modules/platform/ingestion-config-service';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

// The sweep is the schedule trigger of each league's events sync (#1819): it only queues. What
// the queued jobs do is LeagueEventsSync's, in league-events-sync.test.ts. How often it runs is
// the ingestion schedule's Event list policy (#1871).

const MINUTE = 60 * 1000;

function scheduleWith(eventList: IngestionScheduleConfig['EVENTS']) {
  const config = { ...INGESTION_SCHEDULE_SETTINGS.defaults({}), EVENTS: eventList };
  return { getConfig: jest.fn(() => Promise.resolve(config)) };
}

describe('SyncedEventCreationScheduler', () => {
  it('queues each synced league\'s events sync on a task holding its job lock, and logs how many it queued', async () => {
    const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(3) };
    const logger = fakeLogger();
    const scheduler = new SyncedEventCreationScheduler({
      leagueEventsSync, schedule: scheduleWith({ enabled: true, intervalMinutes: 360 }), jobLock: heldHere(), logger,
    });

    await scheduler.runSweep();

    expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ action: 'events.leagueSync.scheduled', data: { queuedCount: 3 } }, expect.any(String));
  });

  it('queues nothing while the Event list schedule is off', async () => {
    const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(3) };
    const scheduler = new SyncedEventCreationScheduler({
      leagueEventsSync, schedule: scheduleWith({ enabled: false, intervalMinutes: 360 }), jobLock: heldHere(),
    });

    await scheduler.runSweep();

    expect(leagueEventsSync.queueScheduled).not.toHaveBeenCalled();
  });

  it('skips the sweep on a task that does not hold its job lock', async () => {
    const lock = heldElsewhere();
    const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(0) };
    const scheduler = new SyncedEventCreationScheduler({
      leagueEventsSync, schedule: scheduleWith({ enabled: true, intervalMinutes: 360 }), jobLock: lock,
    });
    scheduler.start();
    scheduler.stop();

    await scheduler.runSweep();

    expect(lock.keys).toEqual(['synced-event-creation']);
    expect(leagueEventsSync.queueScheduled).not.toHaveBeenCalled();
  });

  describe('on its timer', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('first sweeps ten minutes after starting, then every Event list interval the schedule names', async () => {
      const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(0) };
      const scheduler = new SyncedEventCreationScheduler({
        leagueEventsSync, schedule: scheduleWith({ enabled: true, intervalMinutes: 90 }), jobLock: heldHere(),
      });

      scheduler.start();
      await jest.advanceTimersByTimeAsync(10 * MINUTE);
      expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(90 * MINUTE - 1);
      expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(2);
      scheduler.stop();
    });

    it('rechecks the schedule every minute while the Event list schedule is off, so turning it on takes effect within a minute', async () => {
      const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(0) };
      const schedule = scheduleWith({ enabled: false, intervalMinutes: 360 });
      const scheduler = new SyncedEventCreationScheduler({ leagueEventsSync, schedule, jobLock: heldHere() });

      scheduler.start();
      await jest.advanceTimersByTimeAsync(10 * MINUTE);
      expect(leagueEventsSync.queueScheduled).not.toHaveBeenCalled();
      schedule.getConfig.mockResolvedValue({ ...INGESTION_SCHEDULE_SETTINGS.defaults({}), EVENTS: { enabled: true, intervalMinutes: 360 } });
      await jest.advanceTimersByTimeAsync(MINUTE);

      expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(1);
      scheduler.stop();
    });
  });
});
