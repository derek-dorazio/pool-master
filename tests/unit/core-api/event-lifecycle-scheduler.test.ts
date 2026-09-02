/**
 * Unit tests for EventLifecycleScheduler (pool-master-k6q / plans/124 §3.6) —
 * the automatic, second caller of
 * EventLifecycleService.applySportEventStatusTransition.
 *
 * Coverage:
 *   - The sweep query scopes to admin-managed, auto-lifecycle-enabled events
 *     in SCHEDULED/IN_PROGRESS status only (the policy is enforced in the
 *     query, not just in application code).
 *   - SCHEDULED -> IN_PROGRESS fires once the earliest SportEventRound.
 *     scheduledDate (or SportEvent.startDate when no rounds exist) has
 *     passed, with actor { type: 'SYSTEM', reason: 'SCHEDULED_LIFECYCLE' }.
 *   - IN_PROGRESS -> COMPLETED fires once the latest SportEventRound.
 *     scheduledEndAt (or SportEvent.endDate) has passed.
 *   - No transition fires before the due date.
 *   - One event's failure does not stop the sweep from processing the rest.
 */
import {
  EventLifecycleScheduler,
  SCHEDULED_LIFECYCLE_REASON,
} from '../../../packages/core-api/src/modules/events/event-lifecycle-scheduler';

function createLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    fatal: jest.fn(),
  };
}

describe('pool-master-k6q — EventLifecycleScheduler.runSweep', () => {
  it('pool-master-k6q scopes the sweep query to auto-lifecycle-enabled, non-FULL-sync, SCHEDULED/IN_PROGRESS events', async () => {
    const prisma = { sportEvent: { findMany: jest.fn().mockResolvedValue([]) } };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any);

    await scheduler.runSweep();

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          autoLifecycleEnabled: true,
          syncScope: { not: 'FULL' },
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      }),
    );
  });

  it('pool-master-k6q transitions a SCHEDULED event to IN_PROGRESS once the first round\'s scheduledDate has passed', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-1',
            status: 'SCHEDULED',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [
              { scheduledDate: new Date('2026-06-02T00:00:00.000Z'), scheduledEndAt: null },
              { scheduledDate: new Date('2026-06-01T12:00:00.000Z'), scheduledEndAt: null },
            ],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-1',
      toStatus: 'IN_PROGRESS',
      actor: { type: 'SYSTEM', reason: SCHEDULED_LIFECYCLE_REASON },
    });
  });

  it('pool-master-k6q does not transition a SCHEDULED event before the earliest round date has passed', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-1',
            status: 'SCHEDULED',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [
              { scheduledDate: new Date('2026-06-05T00:00:00.000Z'), scheduledEndAt: null },
            ],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('pool-master-k6q falls back to SportEvent.startDate when no SportEventRound rows are populated', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-1',
            status: 'SCHEDULED',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-01T00:00:01.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-1', toStatus: 'IN_PROGRESS' }),
    );
  });

  it('pool-master-k6q transitions an IN_PROGRESS event to COMPLETED once the last round\'s scheduledEndAt has passed', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-2',
            status: 'IN_PROGRESS',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [
              { scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-01T20:00:00.000Z') },
              { scheduledDate: new Date('2026-06-02T00:00:00.000Z'), scheduledEndAt: new Date('2026-06-02T20:00:00.000Z') },
            ],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith({
      sportEventId: 'evt-2',
      toStatus: 'COMPLETED',
      actor: { type: 'SYSTEM', reason: SCHEDULED_LIFECYCLE_REASON },
    });
  });

  it('pool-master-k6q falls back to SportEvent.endDate for completion when no round has a scheduledEndAt', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-2',
            status: 'IN_PROGRESS',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: new Date('2026-06-02T20:00:00.000Z'),
            roundSchedule: [
              { scheduledDate: new Date('2026-06-01T00:00:00.000Z'), scheduledEndAt: null },
            ],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn().mockResolvedValue(undefined) };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-2', toStatus: 'COMPLETED' }),
    );
  });

  it('pool-master-k6q does not transition an IN_PROGRESS event before the due end date, and does not double-count a null endDate as due', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-2',
            status: 'IN_PROGRESS',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [],
          },
        ]),
      },
    };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const now = () => new Date('2026-06-02T21:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).not.toHaveBeenCalled();
  });

  it('pool-master-k6q logs and continues past one event\'s transition failure so the rest of the sweep still runs', async () => {
    const prisma = {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'evt-fails',
            status: 'SCHEDULED',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [],
          },
          {
            id: 'evt-succeeds',
            status: 'SCHEDULED',
            startDate: new Date('2026-06-01T00:00:00.000Z'),
            endDate: null,
            roundSchedule: [],
          },
        ]),
      },
    };
    const eventLifecycleService = {
      applySportEventStatusTransition: jest.fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce(undefined),
    };
    const logger = createLogger();
    const now = () => new Date('2026-06-01T13:00:00.000Z');
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, logger as any, now);

    await scheduler.runSweep();

    expect(eventLifecycleService.applySportEventStatusTransition).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ sportEventId: 'evt-fails', error: 'boom' }),
      expect.stringContaining('failed to apply a due transition'),
    );
  });

  it('pool-master-k6q start() and stop() are idempotent and clear the interval timer', () => {
    jest.useFakeTimers();
    const prisma = { sportEvent: { findMany: jest.fn().mockResolvedValue([]) } };
    const eventLifecycleService = { applySportEventStatusTransition: jest.fn() };
    const scheduler = new EventLifecycleScheduler(prisma as any, eventLifecycleService as any, createLogger() as any);

    scheduler.start();
    scheduler.start();
    expect(jest.getTimerCount()).toBe(1);

    scheduler.stop();
    scheduler.stop();
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });
});
