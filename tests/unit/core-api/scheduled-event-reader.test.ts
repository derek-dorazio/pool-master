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
      },
      select: {
        externalId: true,
      },
    });
    expect(eventIds).toEqual(['golf-relative-live-now']);
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
