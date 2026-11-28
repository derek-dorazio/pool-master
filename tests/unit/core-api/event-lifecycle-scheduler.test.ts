/**
 * Unit tests for EventLifecycleScheduler (pool-master-k6q / plans/124 §3.6) —
 * the automatic, second caller of
 * EventLifecycleService.applySportEventStatusTransition.
 *
 * Coverage:
 *   - The sweep reads its candidates from the port. Which events are candidates
 *     (admin-managed, auto-lifecycle-enabled, SCHEDULED/IN_PROGRESS) is the
 *     port's contract, asserted against Postgres in
 *     sport-event-repositories.integration.ts.
 *   - An event covering a slot never moves on the clock: it starts and completes when its slots
 *     do (#2013, slot-status-service.test.ts). The clock takes its contests live at their cutoffs.
 *   - An event covering no slot starts at its start date and completes at its end date, with
 *     actor { type: 'SYSTEM' }.
 *   - No transition fires before the due date.
 *   - A POSTPONED event's contests follow its start, each sweep.
 *   - One event's failure does not stop the sweep from processing the rest.
 */
import type { SportEvent } from '@poolmaster/shared/domain';
import { EventLifecycleScheduler } from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';
import { fakeLogger } from '../../support/fake-logger';
import { heldElsewhere, heldHere } from '../../support/job-locks';

interface Candidate {
  event: Partial<SportEvent>;
}

/** An in-memory store holding the given candidates, and the port over it. */
function storeWith(candidates: Candidate[]) {
  const store = new InMemorySportEvents();
  for (const candidate of candidates) store.addEvent(candidate.event);
  return { store, sportEvents: store.sportEventRepo() };
}

/** An event covering no slot, which has no slot to move it: it moves on the clock. */
const NO_SLOT: Pick<SportEvent, 'slotDefinitions'> = { slotDefinitions: [] };

describe('pool-master-k6q — EventLifecycleScheduler.runSweep', () => {
  it('starts an event covering no slot once its start date has passed, as it has no slot to start it', async () => {
    const { sportEvents } = storeWith([{ event: { id: 'evt-1', status: 'SCHEDULED', startDate: new Date('2026-06-01T00:00:00.000Z'), ...NO_SLOT } }]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => new Date('2026-06-01T00:00:01.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-1',
      toStatus: 'IN_PROGRESS',
      actor: { type: 'SYSTEM' },
      fromStatus: 'SCHEDULED',
    });
  });

  it('does not start an event covering no slot before its start date', async () => {
    const { sportEvents } = storeWith([{ event: { id: 'evt-1', status: 'SCHEDULED', startDate: new Date('2026-06-05T00:00:00.000Z'), ...NO_SLOT } }]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn() };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => new Date('2026-06-01T13:00:00.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('never starts a scheduled event covering a slot on the clock, however far past its start: it starts when its slots do, and the sweep takes its contests past their cutoff live instead (#2013)', async () => {
    const { sportEvents } = storeWith([{ event: { id: 'evt-1', status: 'SCHEDULED', startDate: new Date('2026-06-01T00:00:00.000Z') } }]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(1), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn() };
    const sweptAt = new Date('2026-06-08T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => sweptAt });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
    expect(eventLifecycleService.activateContestsPastCutoff).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-1' }), sweptAt);
  });

  it('never completes an IN_PROGRESS event that covers a slot, however far past its own end date: it completes when its slots do', async () => {
    const { sportEvents } = storeWith([
      {
        event: { id: 'evt-2', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z'), endDate: new Date('2026-06-02T20:00:00.000Z') },
      },
    ]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => new Date('2026-07-01T00:00:00.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('completes an IN_PROGRESS event that covers no slot once its end date has passed, as it has no slot to complete it', async () => {
    const { sportEvents } = storeWith([
      { event: { id: 'evt-slotless', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z'), endDate: new Date('2026-06-02T20:00:00.000Z'), slotDefinitions: [] } },
      { event: { id: 'evt-slotless-later', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z'), endDate: new Date('2026-06-09T20:00:00.000Z'), slotDefinitions: [] } },
    ]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => new Date('2026-06-03T00:00:00.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(1);
    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-slotless', toStatus: 'COMPLETED', actor: { type: 'SYSTEM' }, fromStatus: 'IN_PROGRESS',
    });
  });

  it('does not complete an IN_PROGRESS event covering no slot that has no end date', async () => {
    const { sportEvents } = storeWith([
      {
        event: {
          id: 'evt-2',
          status: 'IN_PROGRESS',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          ...NO_SLOT,
        },
      },
    ]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn() };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('pool-master-k6q logs and continues past one event\'s transition failure so the rest of the sweep still runs', async () => {
    const { sportEvents } = storeWith([
      {
        event: {
          id: 'evt-fails',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          ...NO_SLOT,
        },
      },
      {
        event: {
          id: 'evt-succeeds',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          ...NO_SLOT,
        },
      },
    ]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0),
      applySportEventStatusTransition: jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    };
    const logger = fakeLogger();
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger, now });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-fails', error: 'boom' }),
      expect.stringContaining('failed to apply a due transition'),
    );
  });

  it('pool-master-k6q start() and stop() are idempotent and clear the interval timer', () => {
    jest.useFakeTimers();
    const { sportEvents } = storeWith([]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0), applySportEventStatusTransition: jest.fn() };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger() });

    scheduler.start();
    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.stop();
    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});

describe('EventLifecycleScheduler and a contest whose cutoff comes mid-event (#721)', () => {
  it('asks the lifecycle to start the contests past their cutoff on every sweep of a scheduled or in-progress event covering a slot, with the sweep\'s clock, and moves neither event', async () => {
    const { sportEvents } = storeWith([
      { event: { id: 'evt-live', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z') } },
      { event: { id: 'evt-ahead', status: 'SCHEDULED', startDate: new Date('2026-06-09T00:00:00.000Z') } },
    ]);
    const eventLifecycleService = {
      activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0),
      applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined),
    };
    const sweptAt = new Date('2026-06-02T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => sweptAt });

    await scheduler.runSweep();
    await scheduler.runSweep();

    // Each contest's window decides: one on a scheduled event's slot can be past its first game (#2013).
    expect(eventLifecycleService.activateContestsPastCutoff).toHaveBeenCalledTimes(4);
    expect(eventLifecycleService.activateContestsPastCutoff).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-live' }), sweptAt);
    expect(eventLifecycleService.activateContestsPastCutoff).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-ahead' }), sweptAt);
    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('asks a postponed event\'s contests to follow its start on each sweep, and moves the event itself nowhere', async () => {
    const { sportEvents } = storeWith([
      { event: { id: 'evt-postponed', status: 'POSTPONED', startDate: new Date('2026-06-09T00:00:00.000Z') } },
    ]);
    const eventLifecycleService = {
      activateContestsPastCutoff: jest.fn(),
      followPostponedStart: jest.fn().mockResolvedValue(undefined),
      applySportEventStatusTransition: jest.fn(),
    };
    const sweptAt = new Date('2026-06-02T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger: fakeLogger(), now: () => sweptAt });

    await scheduler.runSweep();

    expect(eventLifecycleService.followPostponedStart).toHaveBeenCalledWith(expect.objectContaining({ id: 'evt-postponed' }), sweptAt);
    expect(eventLifecycleService.activateContestsPastCutoff).not.toHaveBeenCalled();
    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('logs a failed activation and still sweeps the next event', async () => {
    const { sportEvents } = storeWith([
      { event: { id: 'evt-fails', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z') } },
      { event: { id: 'evt-next', status: 'IN_PROGRESS', startDate: new Date('2026-06-01T00:00:00.000Z') } },
    ]);
    const eventLifecycleService = {
      activateContestsPastCutoff: jest.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(undefined),
      followPostponedStart: jest.fn(),
      applySportEventStatusTransition: jest.fn(),
    };
    const logger = fakeLogger();
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger, now: () => new Date('2026-06-02T13:00:00.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.activateContestsPastCutoff).toHaveBeenNthCalledWith(2, expect.objectContaining({ id: 'evt-next' }), expect.any(Date));
    expect(logger.error).toHaveBeenCalledWith(expect.objectContaining({ sportEventId: 'evt-fails', error: 'boom' }), expect.any(String));
  });

  it('queues no email: the clock-driven emails sweep on timers of their own, so a sweep only moves events and contests', async () => {
    const { sportEvents } = storeWith([
      { event: { id: 'evt-1', status: 'SCHEDULED', startDate: new Date('2026-06-01T00:00:00.000Z'), ...NO_SLOT } },
    ]);
    const eventLifecycleService = { activateContestsPastCutoff: jest.fn(), followPostponedStart: jest.fn().mockResolvedValue(undefined), applySportEventStatusTransition: jest.fn() };
    const keys: string[] = [];
    const jobLock = { runExclusive: async (key: string, work: () => Promise<void>) => { keys.push(key); await work(); return true; } };
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock, logger: fakeLogger(), now: () => new Date('2026-06-01T13:00:00.000Z') });

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(1);
    expect(keys).toEqual(['event-lifecycle-sweep']);
  });
});

describe('EventLifecycleScheduler.runSweep across server tasks (#1159)', () => {
  const due = (): Candidate[] => [{
    event: { id: 'evt-1', status: 'SCHEDULED', startDate: new Date('2026-06-01T00:00:00.000Z'), ...NO_SLOT },
  }];
  const now = () => new Date('2026-06-01T13:00:00.000Z');
  const lifecycle = () => ({
    activateContestsPastCutoff: jest.fn().mockResolvedValue(0), followPostponedStart: jest.fn().mockResolvedValue(0),
    applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined),
  });

  it('moves no event when another server task holds the sweep lock', async () => {
    const { sportEvents } = storeWith(due());
    const eventLifecycleService = lifecycle();
    const jobLock = heldElsewhere();
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock, logger: fakeLogger(), now });

    await scheduler.runSweep();

    expect(jobLock.keys).toEqual(['event-lifecycle-sweep']);
    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('skips a sweep that comes due while the previous sweep is still running, and sweeps again after it ends', async () => {
    const { sportEvents } = storeWith(due());
    let finishFirst!: () => void;
    const eventLifecycleService = lifecycle();
    eventLifecycleService.applySportEventStatusTransition.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishFirst = resolve; }),
    );
    const logger = fakeLogger();
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService, jobLock: heldHere(), logger, now });

    const first = scheduler.runSweep();
    await new Promise((resolve) => setImmediate(resolve));
    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith({ action: 'lockedSweep.overlap', data: { lockKey: 'event-lifecycle-sweep' } }, expect.stringContaining('previous one is still running'));

    finishFirst();
    await first;
    await scheduler.runSweep();
    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(2);
  });

  it('logs a sweep whose candidate read fails rather than leaving the timer an unhandled rejection', async () => {
    const sportEvents = { findAutoLifecycleCandidates: jest.fn().mockRejectedValue(new Error('db down')) };
    const logger = fakeLogger();
    const scheduler = new EventLifecycleScheduler({ sportEvents, eventLifecycleService: lifecycle(), jobLock: heldHere(), logger, now });

    await expect(scheduler.runSweep()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith({ action: 'lockedSweep.failed', data: { lockKey: 'event-lifecycle-sweep', error: 'db down' } }, 'The event lifecycle sweep failed');
  });
});
