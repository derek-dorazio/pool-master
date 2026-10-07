import { expect } from '@jest/globals';
import type { Prisma } from '@prisma/client';
import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import type {
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import { fakeLogger } from '../../support/fake-logger';
import { asPrismaClient } from '../../support/prisma-double';

function buildInProgressEvent(): SportEvent {
  return {
    externalId: 'provider-event-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    name: 'Manual Test Golf Tournament',
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    status: 'IN_PROGRESS',
    fieldLocked: true,
    metadata: {
      releaseAt: '2026-05-01T20:00:00.000Z',
      fieldLocksAt: '2026-05-02T19:00:00.000Z',
    },
  };
}

/** The sport_events row of an event already linked to the provider event (plans/147: sync only updates these). */
function linkedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sport-event-1',
    externalId: 'provider-event-1',
    providerId: 'mock-contest-feed',
    sport: Sport.GOLF,
    name: 'Manual Test Golf Tournament',
    venue: null,
    location: null,
    startDate: new Date('2026-05-02T20:00:00.000Z'),
    endDate: null,
    status: 'SCHEDULED',
    rounds: 4,
    participantCount: null,
    releaseAt: new Date('2026-05-01T20:00:00.000Z'),
    fieldLocksAt: new Date('2026-05-02T19:00:00.000Z'),
    fieldLocked: false,
    metadata: {},
    syncScope: 'SCORES_ONLY',
    ...overrides,
  };
}

describe('IngestionPersistence', () => {
  // plans/147 — sync never creates a SportEvent: a provider event names no series or sport
  // league, so a created row would have to guess its tour. A linked event is updated; an
  // unlinked one is skipped and logged, and no row is written for it.
  it('pool-master-rop.68.1.4, plans/147: reports the update of a linked event and skips a provider event no event is linked to', async () => {
    const existingStartDate = new Date('2026-06-04T12:00:00.000Z');
    const existingReleaseAt = new Date('2026-05-21T12:00:00.000Z');
    const existingFieldLocksAt = new Date('2026-06-03T16:00:00.000Z');
    const prisma = {
      sportEvent: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'sport-event-1',
            externalId: 'golf-weekend-1',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Old Weekend 1 Name',
            venue: 'Old Links',
            location: null,
            startDate: existingStartDate,
            endDate: new Date('2026-06-07T22:00:00.000Z'),
            status: 'SCHEDULED',
            rounds: 4,
            participantCount: 72,
            releaseAt: existingReleaseAt,
            fieldLocksAt: existingFieldLocksAt,
            fieldLocked: false,
            metadata: {
              releaseAt: existingReleaseAt.toISOString(),
              fieldLocksAt: existingFieldLocksAt.toISOString(),
              eventType: 'stroke_play',
            },
            syncScope: 'SCORES_ONLY',
          })
          .mockResolvedValueOnce(null),
        update: jest.fn().mockResolvedValueOnce({ id: 'sport-event-1' }),
        create: jest.fn(),
        upsert: jest.fn(),
      },
    };
    const logger = fakeLogger();
    const persistence = new IngestionPersistence(asPrismaClient(prisma), logger);
    const events: SportEvent[] = [
      {
        externalId: 'golf-weekend-1',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Weekend 1 Championship',
        venue: 'PoolMaster QA Links',
        startDate: existingStartDate,
        endDate: new Date('2026-06-07T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: existingReleaseAt.toISOString(),
          fieldLocksAt: existingFieldLocksAt.toISOString(),
          eventType: 'stroke_play',
        },
      },
      {
        externalId: 'golf-weekend-2',
        providerId: 'mock-contest-feed',
        sport: Sport.GOLF,
        name: 'Weekend 2 Championship',
        venue: 'PoolMaster QA Links',
        startDate: new Date('2026-06-11T12:00:00.000Z'),
        endDate: new Date('2026-06-14T22:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 80,
        fieldLocked: false,
        metadata: {
          releaseAt: '2026-05-28T12:00:00.000Z',
          fieldLocksAt: '2026-06-10T16:00:00.000Z',
          eventType: 'stroke_play',
        },
      },
    ];

    const result = await persistence.persistEventsWithDiagnostics(events);

    expect(result).toMatchObject({
      count: 1,
      value: 1,
      writeDiagnostics: {
        summary: {
          total: 1,
          unchanged: 0,
          created: 0,
          updated: 1,
          deleted: 0,
        },
        rows: [
          expect.objectContaining({
            entityType: 'SportEvent',
            disposition: 'UPDATED',
            internalId: 'sport-event-1',
            before: expect.objectContaining({
              name: 'Old Weekend 1 Name',
              participantCount: 72,
            }),
            after: expect.objectContaining({
              name: 'Old Weekend 1 Name',
              participantCount: 80,
            }),
          }),
        ],
      },
    });
    expect(result.writeDiagnostics?.rows).toHaveLength(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledTimes(1);
    expect(prisma.sportEvent.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'sport-event-1' } }));
    expect(prisma.sportEvent.create).not.toHaveBeenCalled();
    expect(prisma.sportEvent.upsert).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ externalId: 'golf-weekend-2' }),
      'Skipped provider event with no linked sport event',
    );
  });

  it('pool-master-rop.68.1.3 hydrates event participants with seed, event-scoped odds, and the ranking the field carries', async () => {
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(linkedRow())
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          ranking: 7,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        isActive: true,
        inactiveReason: null,
        ranking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        isActive: true,
        inactiveReason: null,
        ranking: 7,
        oddsToWin: 8.5,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  it('pool-master-rop.68.1.4 reports before and after JSON for updated event participants', async () => {
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          ranking: 7,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'golf-open-2026',
          },
        },
      ],
    };
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: 'sport-event-1',
            externalId: 'golf-open-2026',
            providerId: 'mock-contest-feed',
            sport: Sport.GOLF,
            name: 'Manual Test Golf Tournament',
            venue: null,
            location: null,
            startDate: detail.startDate,
            endDate: null,
            status: 'SCHEDULED',
            rounds: null,
            participantCount: null,
            releaseAt: new Date('2026-05-01T20:00:00.000Z'),
            fieldLocksAt: new Date('2026-05-02T19:00:00.000Z'),
            fieldLocked: true,
            metadata: detail.metadata,
          })
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'sport-event-participant-1',
          isActive: true,
          inactiveReason: null,
          ranking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
          metadata: {
            seed: 3,
            odds: 11.25,
            oddsSourceEventId: 'golf-open-2026',
          },
        }),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistEventDetailWithDiagnostics(detail);

    expect(result.writeDiagnostics.summary).toEqual({
      total: 1,
      unchanged: 0,
      created: 0,
      updated: 1,
      deleted: 0,
    });
    expect(result.writeDiagnostics.rows).toEqual([
      expect.objectContaining({
        entityType: 'SportEventParticipant',
        disposition: 'UPDATED',
        name: 'Scottie Scheffler',
        before: expect.objectContaining({
          ranking: 12,
          oddsToWin: 11.25,
          seedNumber: 3,
        }),
        after: expect.objectContaining({
          ranking: 7,
          oddsToWin: 8.5,
          seedNumber: 1,
        }),
      }),
    ]);
  });

  it('pool-master-rop.68.1.3 does not bleed mismatched event odds onto event participants, and leaves the ranking empty when the field carries none', async () => {
    const prisma = {
      sportEvent: {
        update: jest.fn().mockResolvedValue({ id: 'sport-event-1' }),
        findUnique: jest.fn()
          .mockResolvedValueOnce(linkedRow())
          .mockResolvedValueOnce({ id: 'sport-event-1' }),
      },
      contest: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      participantProviderMapping: {
        findUnique: jest.fn().mockResolvedValue({ participantId: 'participant-1' }),
      },
      participant: {
        update: jest.fn().mockResolvedValue({ id: 'participant-1' }),
      },
      sportEventParticipant: {
        findUnique: jest.fn().mockResolvedValue(null),
        upsert: jest.fn().mockResolvedValue({ id: 'sport-event-participant-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());
    const detail: SportEventDetail = {
      ...buildInProgressEvent(),
      externalId: 'golf-open-2026',
      status: 'SCHEDULED',
      participants: [
        {
          externalId: 'golfer-01',
          providerId: 'mock-contest-feed',
          sport: Sport.GOLF,
          name: 'Scottie Scheffler',
          active: true,
          metadata: {
            seed: 1,
            odds: 8.5,
            oddsSourceEventId: 'different-provider-event',
          },
        },
      ],
    };

    await expect(persistence.persistEventDetail(detail)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: 1,
      sportEventParticipantsPersisted: 1,
    });

    expect(prisma.sportEventParticipant.upsert).toHaveBeenCalledWith({
      where: {
        sportEventId_participantId: {
          sportEventId: 'sport-event-1',
          participantId: 'participant-1',
        },
      },
      create: {
        sportEventId: 'sport-event-1',
        participantId: 'participant-1',
        isActive: true,
        inactiveReason: null,
        ranking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
      update: {
        isActive: true,
        inactiveReason: null,
        ranking: null,
        oddsToWin: null,
        seedNumber: 1,
        metadata: detail.participants[0].metadata,
      },
    });
  });

  // #118, #435 — an admin owns the header, rounds and status of every event, linked for
  // scores (SCORES_ONLY) or not (NONE). Sync may refresh the field size, and nothing else.
  it.each(['SCORES_ONLY', 'NONE'])('leaves a %s event\'s admin-owned header and status unchanged and writes only participantCount', async (syncScope) => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow({ syncScope, name: 'Admin Open', rounds: 4, participantCount: 60 })),
        update: jest.fn<Promise<{ id: string }>, [Prisma.SportEventUpdateArgs]>().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    const result = await persistence.persistEventsWithDiagnostics([
      { ...buildInProgressEvent(), name: 'Provider Open', rounds: 5, participantCount: 80, startDate: new Date('2026-07-01T12:00:00.000Z') },
    ]);

    expect(prisma.sportEvent.update).toHaveBeenCalledWith({ where: { id: 'sport-event-1' }, data: { participantCount: 80 } });
    expect(result.writeDiagnostics.rows[0]).toMatchObject({
      disposition: 'UPDATED',
      before: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 60 }),
      after: expect.objectContaining({ name: 'Admin Open', rounds: 4, participantCount: 80 }),
    });
  });

  it('never writes SportEvent.status from a provider event, so an in-progress feed cannot move an event', async () => {
    const prisma = {
      sportEvent: {
        findUnique: jest.fn().mockResolvedValue(linkedRow()),
        update: jest.fn<Promise<{ id: string }>, [Prisma.SportEventUpdateArgs]>().mockResolvedValue({ id: 'sport-event-1' }),
      },
    };
    const persistence = new IngestionPersistence(asPrismaClient(prisma), fakeLogger());

    await persistence.persistEvents([buildInProgressEvent()]);

    const [updateArg] = prisma.sportEvent.update.mock.calls[0];
    expect(updateArg.data).not.toHaveProperty('status');
  });
});
