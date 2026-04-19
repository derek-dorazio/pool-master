import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { MockContestFeedAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter';
import {
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { startMockContestFeedProvider } from '../mock-contest-feed-provider-helper';

const providerId = 'mock-contest-feed';
const eventExternalId = 'golf-masters-2026';

let mockProvider: Awaited<ReturnType<typeof startMockContestFeedProvider>>;
let importedParticipantExternalIds: string[] = [];
let integrationSetupComplete = false;

beforeAll(async () => {
  await setupIntegrationTests();
  integrationSetupComplete = true;
  mockProvider = await startMockContestFeedProvider();
});

afterAll(async () => {
  if (!integrationSetupComplete) {
    return;
  }

  const prisma = getPrisma();

  const participants = importedParticipantExternalIds.length === 0
    ? []
    : await prisma.participant.findMany({
        where: {
          externalId: { in: importedParticipantExternalIds },
        },
        select: { id: true },
      });
  const participantIds = participants.map((participant) => participant.id);

  await prisma.sportEventParticipantSourceData.deleteMany({
    where: { providerId },
  });
  await prisma.sportEventParticipantValuation.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: {
          providerId,
          externalId: eventExternalId,
        },
      },
    },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: {
        providerId,
        externalId: eventExternalId,
      },
    },
  });
  if (participantIds.length > 0) {
    await prisma.participantSeasonRecord.deleteMany({
      where: {
        participantId: { in: participantIds },
      },
    });
  }
  await prisma.sportEvent.deleteMany({
    where: {
      providerId,
      externalId: eventExternalId,
    },
  });
  await prisma.participantProviderMapping.deleteMany({
    where: {
      providerId,
      externalId: { in: importedParticipantExternalIds },
    },
  });
  await prisma.participant.deleteMany({
    where: {
      externalId: { in: importedParticipantExternalIds },
    },
  });

  await mockProvider.close();
  await teardownIntegrationTests();
});

describe('mock contest feed provider event-first verification', () => {
  it('serves event detail and feed endpoints with schedule, field, and update data', async () => {
    const app = mockProvider.app;

    const eventListResponse = await app.inject({
      method: 'GET',
      url: '/v1/scenarios/golf-major-2026/events',
    });
    expect(eventListResponse.statusCode).toBe(200);
    expect(eventListResponse.json()).toMatchObject({
      scenarioId: 'golf-major-2026',
      events: expect.arrayContaining([
        expect.objectContaining({
          eventId: eventExternalId,
          releaseAt: expect.any(String),
          fieldLocksAt: expect.any(String),
          fieldStatus: expect.any(String),
          contestantCount: expect.any(Number),
        }),
      ]),
    });

    const detailResponse = await app.inject({
      method: 'GET',
      url: `/v1/scenarios/golf-major-2026/events/${eventExternalId}/detail`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toMatchObject({
      scenarioId: 'golf-major-2026',
      sport: 'GOLF',
      season: expect.objectContaining({
        seasonId: expect.any(String),
        year: expect.any(Number),
      }),
      event: expect.objectContaining({
        eventId: eventExternalId,
        schedule: expect.objectContaining({
          startsAt: expect.any(String),
          releaseAt: expect.any(String),
          fieldLocksAt: expect.any(String),
        }),
        field: expect.objectContaining({
          asOf: expect.any(String),
          status: expect.any(String),
          contestants: expect.arrayContaining([
            expect.objectContaining({
              contestantId: expect.any(String),
              name: expect.any(String),
            }),
          ]),
        }),
        feeds: expect.objectContaining({
          odds: expect.objectContaining({
            asOf: expect.any(String),
            contestants: expect.any(Array),
          }),
          rankings: expect.objectContaining({
            asOf: expect.any(String),
            contestants: expect.any(Array),
          }),
          results: expect.objectContaining({
            asOf: expect.any(String),
            contestants: expect.any(Array),
          }),
        }),
      }),
    });

    const updatesResponse = await app.inject({
      method: 'GET',
      url: `/v1/scenarios/golf-major-2026/events/${eventExternalId}/updates`,
    });
    expect(updatesResponse.statusCode).toBe(200);
    expect(updatesResponse.json()).toMatchObject({
      scenarioId: 'golf-major-2026',
      eventId: eventExternalId,
      updates: expect.arrayContaining([
        expect.objectContaining({
          feedKind: expect.any(String),
          updateType: expect.any(String),
          contestants: expect.any(Array),
        }),
      ]),
    });
  });

  it('bridges the real mock provider into adapter ingestion persistence and ranking persistence', async () => {
    const prisma = getPrisma();
    const adapter = new MockContestFeedAdapter(mockProvider.baseUrl);
    const persistence = new IngestionPersistence(prisma);

    const events = await adapter.getUpcomingEvents(Sport.GOLF, {
      from: new Date('2026-04-01T00:00:00.000Z'),
      to: new Date('2026-04-30T23:59:59.999Z'),
    });
    const mastersEvent = events.find((event) => event.externalId === eventExternalId);

    expect(mastersEvent).toBeDefined();
    expect(mastersEvent?.metadata).toMatchObject({
      eventType: expect.any(String),
      releaseAt: expect.any(String),
      fieldLocksAt: expect.any(String),
    });

    const detail = await adapter.getEventDetails(eventExternalId);
    expect(detail).not.toBeNull();
    expect(detail?.participants.length).toBeGreaterThan(0);

    importedParticipantExternalIds = detail?.participants.map((participant) => participant.externalId) ?? [];

    const rankings = await adapter.getRankings(Sport.GOLF, 'OWGR');
    expect(rankings.length).toBeGreaterThan(0);

    const liveScores = await adapter.getLiveScores(eventExternalId);
    expect(liveScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventExternalId,
          providerId,
          statKey: 'TOTAL_SCORE',
        }),
      ]),
    );

    const results = await adapter.getEventResults(eventExternalId);
    expect(results).toMatchObject({
      eventExternalId,
      providerId,
      results: expect.any(Array),
    });

    const persistDetailResult = await persistence.persistEventDetail(detail!);
    expect(persistDetailResult.eventsPersisted).toBe(1);
    expect(persistDetailResult.participantsPersisted).toBe(detail?.participants.length);
    expect(persistDetailResult.sportEventParticipantsPersisted).toBe(detail?.participants.length);

    const persistedRankings = await persistence.persistRankings(
      rankings.filter((ranking) => importedParticipantExternalIds.includes(ranking.participantExternalId)),
    );
    expect(persistedRankings).toBeGreaterThan(0);

    const persistedEvent = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
    });
    expect(persistedEvent.metadata).toMatchObject({
      eventType: expect.any(String),
      releaseAt: expect.any(String),
      fieldLocksAt: expect.any(String),
    });
    expect(persistedEvent.participantCount).toBe(detail?.participants.length);

    const participantMappings = await prisma.participantProviderMapping.findMany({
      where: {
        providerId,
        externalId: {
          in: importedParticipantExternalIds,
        },
      },
      select: {
        participantId: true,
        externalId: true,
      },
    });
    expect(participantMappings.length).toBe(detail?.participants.length);

    const participantSeasonRecords = await prisma.participantSeasonRecord.findMany({
      where: {
        participantId: {
          in: participantMappings.map((mapping) => mapping.participantId),
        },
      },
    });
    expect(participantSeasonRecords.length).toBeGreaterThan(0);
    expect(participantSeasonRecords[0]?.rankings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'OWGR',
          rank: expect.any(Number),
        }),
      ]),
    );
  });
});
