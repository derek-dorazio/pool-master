import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import type { Sport } from '@poolmaster/shared/domain';

describe('pool-master-jh8: Scheduled event reader provider scoping', () => {
  function createPrisma() {
    return {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          { externalId: 'golf-relative-live-now' },
        ]),
      },
    };
  }

  it('queries scheduled live-score candidates only for the active sport provider', async () => {
    const prisma = createPrisma();
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTLIVESCORES',
      now: new Date('2026-04-26T22:30:00.000Z'),
    });

    expect(registry.getProvider).toHaveBeenCalledWith('GOLF');
    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: {
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        externalId: { not: '' },
        status: { in: ['IN_PROGRESS'] },
        sportEventParticipants: { some: {} },
      },
      orderBy: undefined,
      take: undefined,
      select: {
        externalId: true,
      },
    });
    expect(eventIds).toEqual(['golf-relative-live-now']);
  });

  it('pool-master-eux.3 requires hydrated event participants before scheduled live-score polling', async () => {
    const prisma = createPrisma();
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTLIVESCORES',
      now: new Date('2026-04-26T22:30:00.000Z'),
    });

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['IN_PROGRESS'] },
          sportEventParticipants: { some: {} },
        }),
      }),
    );
  });

  it('skips scheduled event candidates when no provider is registered for the sport', async () => {
    const prisma = createPrisma();
    const registry = {
      getProvider: jest.fn().mockReturnValue(null),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTLIVESCORES',
      now: new Date('2026-04-26T22:30:00.000Z'),
    });

    expect(eventIds).toEqual([]);
    expect(prisma.sportEvent.findMany).not.toHaveBeenCalled();
  });

  it('keeps result polling constrained to the active provider and recent completed events', async () => {
    const prisma = createPrisma();
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });
    const now = new Date('2026-04-26T22:30:00.000Z');

    await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTRESULTS',
      now,
    });

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: {
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        externalId: { not: '' },
        status: { in: ['COMPLETED', 'OFFICIAL'] },
        updatedAt: { gte: new Date('2026-04-25T22:30:00.000Z') },
      },
      orderBy: undefined,
      take: undefined,
      select: {
        externalId: true,
      },
    });
  });

  it('pool-master-rop.68.1.2 lists only field-available scheduled events inside the configured window for participant hydration', async () => {
    const prisma = createPrisma();
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTPARTICIPANTS',
      now: new Date('2026-04-26T22:30:00.000Z'),
      from: new Date('2026-04-26T22:30:00.000Z'),
      to: new Date('2026-05-03T22:30:00.000Z'),
    });

    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: {
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        externalId: { not: '' },
        status: 'SCHEDULED',
        releaseAt: { lte: new Date('2026-04-26T22:30:00.000Z') },
        fieldLocked: false,
        fieldLocksAt: { gt: new Date('2026-04-26T22:30:00.000Z') },
        startDate: {
          gte: new Date('2026-04-26T22:30:00.000Z'),
          lte: new Date('2026-05-03T22:30:00.000Z'),
        },
      },
      orderBy: [
        { startDate: 'asc' },
        { externalId: 'asc' },
      ],
      take: 2,
      select: {
        externalId: true,
      },
    });
  });

  it('pool-master-rop.68.1.5 excludes unreleased, locked, in-progress, and completed events from participant hydration candidates', async () => {
    const now = new Date('2026-04-26T22:30:00.000Z');
    const from = new Date('2026-04-26T22:30:00.000Z');
    const to = new Date('2026-05-03T22:30:00.000Z');
    const rows = [
      {
        externalId: 'released-field-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'SCHEDULED',
        releaseAt: new Date('2026-04-26T22:00:00.000Z'),
        fieldLocked: false,
        fieldLocksAt: new Date('2026-04-29T16:00:00.000Z'),
        startDate: new Date('2026-04-30T12:00:00.000Z'),
      },
      {
        externalId: 'second-released-field-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'SCHEDULED',
        releaseAt: new Date('2026-04-26T22:00:00.000Z'),
        fieldLocked: false,
        fieldLocksAt: new Date('2026-05-01T16:00:00.000Z'),
        startDate: new Date('2026-05-02T12:00:00.000Z'),
      },
      {
        externalId: 'third-released-field-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'SCHEDULED',
        releaseAt: new Date('2026-04-26T22:00:00.000Z'),
        fieldLocked: false,
        fieldLocksAt: new Date('2026-05-02T16:00:00.000Z'),
        startDate: new Date('2026-05-03T12:00:00.000Z'),
      },
      {
        externalId: 'unreleased-field-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'SCHEDULED',
        releaseAt: new Date('2026-04-27T22:00:00.000Z'),
        fieldLocked: false,
        fieldLocksAt: new Date('2026-04-29T16:00:00.000Z'),
        startDate: new Date('2026-04-30T12:00:00.000Z'),
      },
      {
        externalId: 'locked-field-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'SCHEDULED',
        releaseAt: new Date('2026-04-20T22:00:00.000Z'),
        fieldLocked: true,
        fieldLocksAt: new Date('2026-04-25T16:00:00.000Z'),
        startDate: new Date('2026-04-30T12:00:00.000Z'),
      },
      {
        externalId: 'completed-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'COMPLETED',
        releaseAt: new Date('2026-04-20T22:00:00.000Z'),
        fieldLocked: true,
        fieldLocksAt: new Date('2026-04-23T16:00:00.000Z'),
        startDate: new Date('2026-04-24T12:00:00.000Z'),
      },
      {
        externalId: 'in-progress-event',
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        status: 'IN_PROGRESS',
        releaseAt: new Date('2026-04-20T22:00:00.000Z'),
        fieldLocked: true,
        fieldLocksAt: new Date('2026-04-23T16:00:00.000Z'),
        startDate: new Date('2026-04-24T12:00:00.000Z'),
      },
    ];
    const prisma = {
      sportEvent: {
        findMany: jest.fn(async ({ where }) => rows
          .filter((row) => {
            return (
              row.sport === where.sport
              && row.providerId === where.providerId
              && row.externalId !== ''
              && row.status === where.status
              && row.releaseAt.getTime() <= where.releaseAt.lte.getTime()
              && row.fieldLocked === where.fieldLocked
              && row.fieldLocksAt.getTime() > where.fieldLocksAt.gt.getTime()
              && row.startDate.getTime() >= where.startDate.gte.getTime()
              && row.startDate.getTime() <= where.startDate.lte.getTime()
            );
          })
          .sort((left, right) => left.startDate.getTime() - right.startDate.getTime()
            || left.externalId.localeCompare(right.externalId))
          .slice(0, 2)
          .map((row) => ({ externalId: row.externalId }))),
      },
    };
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTPARTICIPANTS',
      now,
      from,
      to,
    });

    expect(eventIds).toEqual(['released-field-event', 'second-released-field-event']);
  });
});
