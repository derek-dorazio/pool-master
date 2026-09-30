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
 *   - SCHEDULED -> IN_PROGRESS fires once the earliest SportEventRound.
 *     scheduledDate (or SportEvent.startDate when no rounds exist) has
 *     passed, with actor { type: 'SYSTEM' }.
 *   - IN_PROGRESS -> COMPLETED fires once the latest SportEventRound.
 *     scheduledEndAt (or SportEvent.endDate) has passed.
 *   - No transition fires before the due date.
 *   - One event's failure does not stop the sweep from processing the rest.
 */
import type { SportEvent } from '@poolmaster/shared/domain';
import { EventLifecycleScheduler } from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';
import { InMemorySportEvents } from '../../support/in-memory-sport-events';

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

interface Candidate {
  event: Partial<SportEvent>;
  rounds?: Array<{ scheduledDate: Date; scheduledEndAt: Date | null }>;
}

/** An in-memory store holding the given candidates, and the two ports over it. */
function storeWith(candidates: Candidate[]) {
  const store = new InMemorySportEvents();
  for (const candidate of candidates) {
    const event = store.addEvent(candidate.event);
    store.roundRows.push(...(candidate.rounds ?? []).map((round, index) => ({
      id: store.id('round'),
      sportEventId: event.id,
      roundNumber: index + 1,
      ...round,
      createdAt: event.createdAt,
      updatedAt: event.updatedAt,
    })));
  }
  return { sportEvents: store.sportEventRepo(), rounds: store.roundRepo() };
}

describe('pool-master-k6q — EventLifecycleScheduler.runSweep', () => {
  it('pool-master-k6q transitions a SCHEDULED event to IN_PROGRESS once the first round\'s scheduledDate has passed', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-1',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [
          { scheduledDate: new Date('2026-06-02T00:00:00.000Z'), scheduledEndAt: null },
          { scheduledDate: new Date('2026-06-01T12:00:00.000Z'), scheduledEndAt: null },
        ],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-1',
      toStatus: 'IN_PROGRESS',
      actor: { type: 'SYSTEM' },
    });
  });

  it('pool-master-k6q does not transition a SCHEDULED event before the earliest round date has passed', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-1',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [
          { scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: null },
        ],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('pool-master-k6q falls back to SportEvent.startDate when no SportEventRound rows are populated', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-1',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-01T00:00:01.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-1', toStatus: 'IN_PROGRESS' }),
    );
  });

  it('pool-master-k6q transitions an IN_PROGRESS event to COMPLETED once the last round\'s scheduledEndAt has passed', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-2',
          status: 'IN_PROGRESS',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [
          { scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-01T20:00:00.000Z') },
          { scheduledDate: new Date('2026-06-02T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-02T20:00:00.000Z') },
        ],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-2',
      toStatus: 'COMPLETED',
      actor: { type: 'SYSTEM' },
    });
  });

  it('pool-master-k6q falls back to SportEvent.endDate for completion when no round has a scheduledEndAt', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-2',
          status: 'IN_PROGRESS',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
          endDate: new Date('2026-06-02T20:00:00.000Z'),
        },
        rounds: [
          { scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: null },
        ],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-2', toStatus: 'COMPLETED' }),
    );
  });

  it('pool-master-k6q does not transition an IN_PROGRESS event before the due end date, and does not double-count a null endDate as due', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-2',
          status: 'IN_PROGRESS',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [],
      },
    ]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('pool-master-k6q logs and continues past one event\'s transition failure so the rest of the sweep still runs', async () => {
    const { sportEvents, rounds } = storeWith([
      {
        event: {
          id: 'evt-fails',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [],
      },
      {
        event: {
          id: 'evt-succeeds',
          status: 'SCHEDULED',
          startDate: new Date('2026-06-01T00:00:00.000Z'),
        },
        rounds: [],
      },
    ]);
    const eventLifecycleService = {
      applySportEventStatusTransition: jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    };
    const logger = createLogger();
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, logger as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-fails', error: 'boom' }),
      expect.stringContaining('failed to apply a due transition'),
    );
  });

  it('pool-master-k6q start() and stop() are idempotent and clear the interval timer', () => {
    jest.useFakeTimers();
    const { sportEvents, rounds } = storeWith([]);
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const scheduler = new EventLifecycleScheduler(sportEvents, rounds, eventLifecycleService as any, createLogger() as any);

    scheduler.start();
    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.stop();
    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
