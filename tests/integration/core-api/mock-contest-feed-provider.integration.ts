import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { MockContestFeedAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
import {
  cleanupTestData,
  createTestUser,
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

async function cleanupMockProviderImportData(): Promise<void> {
  if (!integrationSetupComplete) {
    return;
  }

  const prisma = getPrisma();
  const providerMappings = await prisma.participantProviderMapping.findMany({
    where: {
      providerId,
    },
    select: {
      participantId: true,
    },
  });
  const participantIds = providerMappings.map((mapping) => mapping.participantId);

  await prisma.sportEventParticipantSourceData.deleteMany({
    where: { providerId },
  });
  await prisma.sportEventParticipantValuation.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: {
          providerId,
        },
      },
    },
  });
  await prisma.sportEventParticipant.deleteMany({
    where: {
      sportEvent: {
        providerId,
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
  await prisma.ingestionJob.deleteMany({
    where: {
      providerId,
    },
  });
  await prisma.sportEvent.deleteMany({
    where: {
      providerId,
    },
  });
  await prisma.participantProviderMapping.deleteMany({
    where: {
      providerId,
    },
  });
  if (participantIds.length > 0) {
    await prisma.participant.deleteMany({
      where: {
        id: { in: participantIds },
      },
    });
  }
  importedParticipantExternalIds = [];
}

beforeAll(async () => {
  await setupIntegrationTests();
  integrationSetupComplete = true;
  mockProvider = await startMockContestFeedProvider();
});

afterEach(async () => {
  await cleanupMockProviderImportData();
  await cleanupTestData();
});

afterAll(async () => {
  if (!integrationSetupComplete) {
    return;
  }

  await cleanupMockProviderImportData();
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

  it('keeps startup-style schedule sync shallow until manual re-ingest loads contest-ready event detail', async () => {
    const prisma = getPrisma();
    const provider = new MockContestFeedAdapter(mockProvider.baseUrl);
    const registry = new ProviderRegistry();
    const getUpcomingEventsSpy = jest.spyOn(provider, 'getUpcomingEvents').mockImplementation(async () =>
      new MockContestFeedAdapter(mockProvider.baseUrl).getUpcomingEvents(Sport.GOLF, {
        from: new Date('2026-04-01T00:00:00.000Z'),
        to: new Date('2026-04-30T23:59:59.999Z'),
      }));
    const getParticipantsSpy = jest.spyOn(provider, 'getParticipants').mockImplementation(async () =>
      new MockContestFeedAdapter(mockProvider.baseUrl).getParticipants(Sport.GOLF));
    const getRankingsSpy = jest.spyOn(provider, 'getRankings').mockImplementation(async (_sport: Sport, rankingType: string) =>
      new MockContestFeedAdapter(mockProvider.baseUrl).getRankings(Sport.GOLF, rankingType));
    const getEventDetailsSpy = jest.spyOn(provider, 'getEventDetails');
    registry.register(Sport.GOLF, provider, 'PRIMARY');

    const persistence = new IngestionPersistence(prisma);
    const scheduler = new IngestionScheduler(registry, {
      onEvents: async (events) => {
        await persistence.persistEvents(events);
      },
      onEventDetail: async (detail) => {
        await persistence.persistEventDetail(detail);
      },
      onRankings: async (rankings) => {
        await persistence.persistRankings(rankings);
      },
      onLiveScores: async () => undefined,
      onJobComplete: async () => undefined,
    });

    const scheduleJob = await scheduler.syncSport(Sport.GOLF);
    expect(scheduleJob.status).toBe('COMPLETED');

    const startupParticipants = await provider.getParticipants(Sport.GOLF);
    await persistence.persistParticipants(startupParticipants);
    const startupRankings = await provider.getRankings(Sport.GOLF, 'OWGR');
    await persistence.persistRankings(startupRankings);

    const shallowEvent = await prisma.sportEvent.findUniqueOrThrow({
      where: {
        providerId_externalId: {
          providerId,
          externalId: eventExternalId,
        },
      },
    });
    expect(shallowEvent.participantCount).toBeGreaterThan(0);

    const shallowEventParticipantCount = await prisma.sportEventParticipant.count({
      where: {
        sportEventId: shallowEvent.id,
      },
    });
    expect(shallowEventParticipantCount).toBe(0);
    expect(getUpcomingEventsSpy).toHaveBeenCalled();
    expect(getParticipantsSpy).toHaveBeenCalledWith(Sport.GOLF);
    expect(getRankingsSpy).toHaveBeenCalledWith(Sport.GOLF, 'OWGR');
    expect(getEventDetailsSpy).not.toHaveBeenCalled();

    const rootAdmin = await createTestUser({
      displayName: 'Mock Provider Root Admin',
      isRootAdmin: true,
    });
    const providerService = new ProviderService(prisma, registry);

    const reIngestJob = await providerService.reIngestEvent(
      providerId,
      eventExternalId,
      rootAdmin.user.id,
      rootAdmin.user.email,
    );

    expect(reIngestJob.status).toBe('COMPLETED');
    expect(getEventDetailsSpy).toHaveBeenCalledWith(eventExternalId);

    const hydratedEventParticipantCount = await prisma.sportEventParticipant.count({
      where: {
        sportEventId: shallowEvent.id,
      },
    });
    expect(hydratedEventParticipantCount).toBeGreaterThan(0);

    const latestJob = await prisma.ingestionJob.findFirstOrThrow({
      where: {
        providerId,
        eventExternalId,
        jobType: 'MANUAL_REINGEST',
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    expect(latestJob.status).toBe('COMPLETED');
  });

  it('pool-master-xw5.5: adapter observes manual relative event lifecycle through schedule detail live and results feeds', async () => {
    const anchor = new Date();
    let currentNow = anchor;
    const lifecycleProvider = await startMockContestFeedProvider({
      routes: {
        scenarioStoreOptions: {
          now: () => currentNow,
        },
      },
    });

    try {
      const adapter = new MockContestFeedAdapter(lifecycleProvider.baseUrl);
      const from = new Date(anchor.getTime() - 60_000);
      const to = new Date(anchor.getTime() + 2 * 60 * 60 * 1000);

      const openEvents = await adapter.getUpcomingEvents(Sport.GOLF, { from, to });
      const manualEvent = openEvents.find((event) =>
        event.name.startsWith('Manual Test Golf Tournament for '),
      );
      expect(manualEvent).toBeDefined();
      expect(manualEvent?.status).toBe('SCHEDULED');
      expect(manualEvent?.fieldLocked).toBe(false);

      const manualEventId = manualEvent?.externalId ?? '';
      const detail = await adapter.getEventDetails(manualEventId);
      expect(detail?.name).toBe(manualEvent?.name);
      expect(detail?.participants).toHaveLength(80);

      const openScores = await adapter.getLiveScores(manualEventId);
      expect(openScores).toHaveLength(0);

      currentNow = new Date(anchor.getTime() + 45 * 60 * 1000);
      const liveEvents = await adapter.getUpcomingEvents(Sport.GOLF, { from, to });
      const liveManualEvent = liveEvents.find((event) => event.externalId === manualEventId);
      expect(liveManualEvent?.status).toBe('IN_PROGRESS');

      const liveScores = await adapter.getLiveScores(manualEventId);
      expect(liveScores).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            eventExternalId: manualEventId,
            providerId,
            statKey: 'TOTAL_SCORE',
          }),
        ]),
      );

      currentNow = new Date(anchor.getTime() + 65 * 60 * 1000);
      const completedEvents = await adapter.getUpcomingEvents(Sport.GOLF, { from, to });
      const completedManualEvent = completedEvents.find((event) => event.externalId === manualEventId);
      expect(completedManualEvent?.status).toBe('COMPLETED');

      const results = await adapter.getEventResults(manualEventId);
      expect(results).toMatchObject({
        eventExternalId: manualEventId,
        providerId,
        status: 'OFFICIAL',
      });
      expect(results?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finishPosition: 1,
            totalScore: expect.any(Number),
          }),
        ]),
      );
    } finally {
      await lifecycleProvider.close();
    }
  });
});
