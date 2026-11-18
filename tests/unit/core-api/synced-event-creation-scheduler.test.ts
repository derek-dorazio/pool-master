import { expect } from '@jest/globals';
import { SyncedEventCreationScheduler } from '../../../packages/core-api/src/modules/events/synced-event-creation-scheduler';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

// The sweep is the schedule trigger of each league's events sync (#1819): it only queues. What
// the queued jobs do is LeagueEventsSync's, in league-events-sync.test.ts.

describe('SyncedEventCreationScheduler', () => {
  it('queues each synced league\'s events sync on a task holding its job lock, and logs how many it queued', async () => {
    const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(3) };
    const logger = fakeLogger();
    const scheduler = new SyncedEventCreationScheduler({ leagueEventsSync, jobLock: heldHere(), logger });

    await scheduler.runSweep();

    expect(leagueEventsSync.queueScheduled).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith({ action: 'events.leagueSync.scheduled', data: { queuedCount: 3 } }, expect.any(String));
  });

  it('skips the sweep on a task that does not hold its job lock', async () => {
    const lock = heldElsewhere();
    const leagueEventsSync = { queueScheduled: jest.fn().mockResolvedValue(0) };
    const scheduler = new SyncedEventCreationScheduler({ leagueEventsSync, jobLock: lock });
    scheduler.start();
    scheduler.stop();

    await scheduler.runSweep();

    expect(lock.keys).toEqual(['synced-event-creation']);
    expect(leagueEventsSync.queueScheduled).not.toHaveBeenCalled();
  });
});
