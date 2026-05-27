import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import type { Sport } from '@poolmaster/shared/domain';

describe('pool-master-jh8: Scheduled event reader provider scoping', () => {
  type ScheduledEventRow = {
    externalId: string;
    providerId: string;
    sport: string;
    status: string;
  };

  function createPrisma() {
    return {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          { externalId: 'golf-relative-live-now' },
        ]),
      },
    };
  }

  function createFilteringPrisma(rows: ScheduledEventRow[]) {
    return {
      sportEvent: {
        findMany: jest.fn((query: {
          where: {
            sport?: string;
            providerId?: string;
            externalId?: { not?: string };
            status?: { in?: string[] };
          };
        }) => Promise.resolve(
          rows
            .filter((row) => !query.where.sport || row.sport === query.where.sport)
            .filter((row) => !query.where.providerId || row.providerId === query.where.providerId)
            .filter((row) => query.where.externalId?.not === undefined
              || row.externalId !== query.where.externalId.not)
            .filter((row) => !query.where.status?.in || query.where.status.in.includes(row.status))
            .map((row) => ({ externalId: row.externalId })),
        )),
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
      },
      select: {
        externalId: true,
      },
    });
    expect(eventIds).toEqual(['golf-relative-live-now']);
  });

  it('pool-master-33l.8.11 excludes completed, cancelled, and not-started events from scheduled live-score candidates', async () => {
    const prisma = createFilteringPrisma([
      {
        externalId: 'golf-live-now',
        providerId: 'mock-contest-feed',
        sport: 'GOLF',
        status: 'IN_PROGRESS',
      },
      {
        externalId: 'golf-not-started',
        providerId: 'mock-contest-feed',
        sport: 'GOLF',
        status: 'SCHEDULED',
      },
      {
        externalId: 'golf-completed',
        providerId: 'mock-contest-feed',
        sport: 'GOLF',
        status: 'COMPLETED',
      },
      {
        externalId: 'golf-cancelled',
        providerId: 'mock-contest-feed',
        sport: 'GOLF',
        status: 'CANCELLED',
      },
      {
        externalId: '',
        providerId: 'mock-contest-feed',
        sport: 'GOLF',
        status: 'IN_PROGRESS',
      },
      {
        externalId: 'tennis-live-now',
        providerId: 'mock-contest-feed',
        sport: 'TENNIS',
        status: 'IN_PROGRESS',
      },
      {
        externalId: 'golf-other-provider-live',
        providerId: 'other-provider',
        sport: 'GOLF',
        status: 'IN_PROGRESS',
      },
    ]);
    const registry = {
      getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }),
    };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTLIVESCORES',
      now: new Date('2026-05-27T12:30:00.000Z'),
    });

    expect(eventIds).toEqual(['golf-live-now']);
    expect(prisma.sportEvent.findMany).toHaveBeenCalledWith({
      where: {
        sport: 'GOLF',
        providerId: 'mock-contest-feed',
        externalId: { not: '' },
        status: { in: ['IN_PROGRESS'] },
      },
      select: {
        externalId: true,
      },
    });
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
      select: {
        externalId: true,
      },
    });
  });

  it('pool-master-rop.13 lists scheduled events inside the configured window for participant hydration', async () => {
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
        OR: [
          {
            status: 'SCHEDULED',
            startDate: {
              gte: new Date('2026-04-26T22:30:00.000Z'),
              lte: new Date('2026-05-03T22:30:00.000Z'),
            },
          },
          { status: 'IN_PROGRESS' },
        ],
      },
      select: {
        externalId: true,
      },
    });
  });
});
