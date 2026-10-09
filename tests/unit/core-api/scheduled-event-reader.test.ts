import { expect } from '@jest/globals';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import type { Prisma } from '@prisma/client';
import type { Sport } from '@poolmaster/shared/domain';

describe('pool-master-jh8: Scheduled event reader provider scoping', () => {
  function createPrisma() {
    return {
      sportEvent: {
        findMany: jest.fn().mockResolvedValue([
          { externalId: 'golf-masters-2026-live' },
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
        syncScope: 'SCORES_ONLY',
      },
      orderBy: undefined,
      take: undefined,
      select: {
        externalId: true,
      },
    });
    expect(eventIds).toEqual(['golf-masters-2026-live']);
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

  it('pool-master-rop.68.1.2 asks only for draft or released events starting inside the configured window for participant hydration', async () => {
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
        status: { in: ['DRAFT', 'SCHEDULED'] },
        startDate: {
          gte: new Date('2026-04-26T22:30:00.000Z'),
          lte: new Date('2026-05-03T22:30:00.000Z'),
        },
        syncScope: 'SCORES_ONLY',
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

  it('offers draft and released events that have not started for participant hydration, never in-progress or completed ones', async () => {
    const now = new Date('2026-04-26T22:30:00.000Z');
    const from = new Date('2026-04-26T22:30:00.000Z');
    const to = new Date('2026-05-03T22:30:00.000Z');
    const rows = [
      { externalId: 'draft-event', status: 'DRAFT', startDate: new Date('2026-04-30T12:00:00.000Z') },
      { externalId: 'released-event', status: 'SCHEDULED', startDate: new Date('2026-05-02T12:00:00.000Z') },
      { externalId: 'third-event', status: 'SCHEDULED', startDate: new Date('2026-05-03T12:00:00.000Z') },
      { externalId: 'completed-event', status: 'COMPLETED', startDate: new Date('2026-04-27T12:00:00.000Z') },
      { externalId: 'in-progress-event', status: 'IN_PROGRESS', startDate: new Date('2026-04-27T12:00:00.000Z') },
      { externalId: 'already-started-event', status: 'SCHEDULED', startDate: new Date('2026-04-26T12:00:00.000Z') },
    ].map((row) => ({ ...row, sport: 'GOLF', providerId: 'mock-contest-feed' }));
    /** The slice of `sportEvent.findMany`'s argument this stand-in evaluates. */
    interface FieldHydrationQuery {
      where: {
        sport: string;
        providerId: string;
        status: { in: string[] };
        startDate: { gte: Date; lte: Date };
      };
    }
    const prisma = {
      sportEvent: {
        findMany: jest.fn(async ({ where }: FieldHydrationQuery) => rows
          .filter((row) => (
            row.sport === where.sport
            && row.providerId === where.providerId
            && where.status.in.includes(row.status)
            && row.startDate.getTime() >= where.startDate.gte.getTime()
            && row.startDate.getTime() <= where.startDate.lte.getTime()
          ))
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

    expect(eventIds).toEqual(['draft-event', 'released-event']);
  });
});

describe('pool-master-cgb: syncScope gating', () => {
  // A minimal in-memory Prisma standing in for the real query planner —
  // applies the actual where.syncScope clause toFeedWhere produces, rather
  // than trusting a mock to have been called with the "right" object.
  function createPrismaWithSyncScopeAwareFilter(rows: Array<{ externalId: string; syncScope: string }>) {
    return {
      sportEvent: {
        findMany: jest.fn(async ({ where }: { where: Prisma.SportEventWhereInput }) => rows
          .filter((row) => {
            const clause = where.syncScope as { in?: string[] } | string;
            return typeof clause === 'string'
              ? row.syncScope === clause
              : (clause?.in ?? []).includes(row.syncScope);
          })
          .map((row) => ({ externalId: row.externalId }))),
      },
    };
  }

  const rowsByScope = [
    { externalId: 'none-event', syncScope: 'NONE' },
    { externalId: 'scores-only-event', syncScope: 'SCORES_ONLY' },
  ];

  it('EVENTPARTICIPANTS returns only linked (SCORES_ONLY) events, never an unlinked NONE one', async () => {
    const prisma = createPrismaWithSyncScopeAwareFilter(rowsByScope);
    const registry = { getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }) };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTPARTICIPANTS',
      now: new Date('2026-04-26T22:30:00.000Z'),
    });

    expect(eventIds).toEqual(['scores-only-event']);
  });

  it('EVENTLIVESCORES returns only linked (SCORES_ONLY) events, never an unlinked NONE one', async () => {
    const prisma = createPrismaWithSyncScopeAwareFilter(rowsByScope);
    const registry = { getProvider: jest.fn().mockReturnValue({ providerId: 'mock-contest-feed' }) };
    const reader = createScheduledEventReader({ prisma: prisma as never, registry: registry as never });

    const eventIds = await reader.listEventIdsForFeed({
      sport: 'GOLF' as Sport,
      feed: 'EVENTLIVESCORES',
      now: new Date('2026-04-26T22:30:00.000Z'),
    });

    expect(eventIds).toEqual(['scores-only-event']);
  });
});
