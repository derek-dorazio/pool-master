import { Sport } from '@poolmaster/shared/domain';
import { IngestionPersistence } from '../../../packages/core-api/src/modules/ingestion/persistence/ingestion-persistence';
import { MockContestFeedAdapter } from '../../../packages/core-api/src/modules/ingestion/adapters/mock-contest-feed-adapter';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import type { IngestionScheduleConfig } from '../../../packages/shared/dto/config.dto';
import { createScheduledEventReader } from '../../../packages/core-api/src/modules/ingestion/core/scheduled-event-reader';
import { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
import { ProviderSyncRunLedger } from '../../../packages/core-api/src/modules/ingestion/persistence/provider-sync-run-ledger';
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
const syncVerificationNow = new Date('2026-05-30T12:00:00.000Z');
const syncVerificationConfig: IngestionScheduleConfig = {
  scheduledSports: [Sport.GOLF],
  healthCheck: { enabled: true, intervalMinutes: 5 },
  eventSchedule: { enabled: true, intervalMinutes: 1440, lookaheadDays: 365 },
  eventParticipants: { enabled: true, intervalMinutes: 360, lookaheadDays: 14 },
  participantRankings: { enabled: true, intervalMinutes: 1440 },
  eventLiveScores: { enabled: false, intervalSeconds: 30 },
  eventResults: { enabled: false, intervalMinutes: 30 },
  perSportOverrides: {},
};

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

  await prisma.sportEventParticipantValuation.deleteMany({
    where: {
      sportEventParticipant: {
        sportEvent: {
          providerId,
        },
      },
    },
  });
  await prisma.sportEventParticipantGolfStanding.deleteMany({
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
  await prisma.participantRankingSnapshot.deleteMany({
    where: {
      providerId,
      participantId: { in: participantIds },
    },
  });
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

async function waitForProviderSyncRuns(ids: string[]) {
  const idOrder = new Map(ids.map((id, index) => [id, index]));
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rows = await getPrisma().providerSyncRun.findMany({
      where: { id: { in: ids } },
    });
    const terminalRows = rows.filter((row) => row.status === 'COMPLETED' || row.status === 'FAILED');
    if (rows.length === ids.length && terminalRows.length === ids.length) {
      const failedRun = rows.find((row) => row.status === 'FAILED');
      if (failedRun) {
        throw new Error(`Provider sync run ${failedRun.id} failed: ${JSON.stringify(failedRun.payloadJson)}`);
      }
      return rows.sort((left, right) => (idOrder.get(left.id) ?? 0) - (idOrder.get(right.id) ?? 0));
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for provider sync runs: ${ids.join(', ')}`);
}

async function waitForScheduledProviderSyncRuns(providerIdToFind: string, expectedRunCount: number) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const rows = await getPrisma().providerSyncRun.findMany({
      where: { providerId: providerIdToFind },
    });
    const scheduledRows = rows.filter((run) =>
      toRecord(toRecord(run.payloadJson)?.requestPayload)?.source === 'SCHEDULED',
    );
    const terminalRows = scheduledRows.filter((row) => row.status === 'COMPLETED' || row.status === 'FAILED');
    if (scheduledRows.length >= expectedRunCount && terminalRows.length >= expectedRunCount) {
      const failedRun = scheduledRows.find((row) => row.status === 'FAILED');
      if (failedRun) {
        throw new Error(`Scheduled provider sync run ${failedRun.id} failed: ${JSON.stringify(failedRun.payloadJson)}`);
      }
      return scheduledRows;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Timed out waiting for ${expectedRunCount} scheduled provider sync runs for ${providerIdToFind}`);
}

function providerPayloadPaths(payloadJson: unknown): string[] {
  const payload = toRecord(payloadJson);
  const providerPayload = toRecord(payload?.providerPayload);
  const rawItems = Array.isArray(providerPayload?.raw) ? providerPayload.raw : [];
  return rawItems.flatMap((item) => {
    const path = toRecord(item)?.path;
    return typeof path === 'string' ? [path] : [];
  });
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function expectNumberGreaterThan(value: unknown, min: number): void {
  expect(typeof value).toBe('number');
  if (typeof value === 'number') {
    expect(value).toBeGreaterThan(min);
  }
}

async function findEventParticipantByExternalIds(input: {
  providerId: string;
  eventExternalId: string;
  participantExternalId: string;
}) {
  const prisma = getPrisma();
  const persistedEvent = await prisma.sportEvent.findUniqueOrThrow({
    where: {
      providerId_externalId: {
        providerId: input.providerId,
        externalId: input.eventExternalId,
      },
    },
  });
  const participantMapping = await prisma.participantProviderMapping.findUniqueOrThrow({
    where: {
      providerId_externalId: {
        providerId: input.providerId,
        externalId: input.participantExternalId,
      },
    },
  });

  return prisma.sportEventParticipant.findUniqueOrThrow({
    where: {
      sportEventId_participantId: {
        sportEventId: persistedEvent.id,
        participantId: participantMapping.participantId,
      },
    },
  });
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

  it('pool-master-rop.68.1.3 bridges the real mock provider into adapter ingestion persistence and ranking persistence', async () => {
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

    // pool-master-rop.78.3 + pool-master-33l.8.8 — typed LiveScoreResult contract
    // per plans/117 §10.2, now driven through explicit mock live-state control.
    const liveScores = await adapter.getLiveScores(eventExternalId, { mockEventState: 'live' });
    expect(liveScores.category).toBe('GOLF');
    if (liveScores.category === 'GOLF') {
      expect(liveScores.rounds.length).toBeGreaterThan(0);
      expect(liveScores.rounds[0]).toEqual(
        expect.objectContaining({
          participantExternalId: expect.any(String),
          round: expect.any(Number),
          status: expect.stringMatching(/IN_PROGRESS|COMPLETED|DNF|DSQ/),
        }),
      );
    }

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

    await expect(persistence.persistRankings(rankings)).resolves.toBe(rankings.length);
    await expect(persistence.persistEventDetail(detail!)).resolves.toEqual({
      eventsPersisted: 1,
      participantsPersisted: detail?.participants.length,
      sportEventParticipantsPersisted: detail?.participants.length,
    });

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

    const scottieMapping = participantMappings.find(
      (mapping) => mapping.externalId === 'golfer-01',
    );
    expect(scottieMapping).toBeDefined();
    const scottieEventParticipant = await prisma.sportEventParticipant.findUniqueOrThrow({
      where: {
        sportEventId_participantId: {
          sportEventId: persistedEvent.id,
          participantId: scottieMapping!.participantId,
        },
      },
    });
    expect(scottieEventParticipant.worldRanking).toBe(1);
    expect(scottieEventParticipant.seedNumber).toBe(1);
    expect(scottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);
  });

  it('pool-master-rop.68.1.7 verifies manual and scheduled Golf sync workflow with scoped payload diagnostics', async () => {
    const prisma = getPrisma();
    const provider = new MockContestFeedAdapter(mockProvider.baseUrl);
    const registry = new ProviderRegistry();
    registry.register(Sport.GOLF, provider, 'PRIMARY');
    const persistence = new IngestionPersistence(prisma);
    const syncRunLedger = new ProviderSyncRunLedger(prisma);
    const eventReader = createScheduledEventReader({ prisma, registry });
    const configReader = {
      getConfig: async () => syncVerificationConfig,
      getPerSportConfig: async () => syncVerificationConfig,
    };
    const completedJobs: Array<{ jobType: string; eventExternalId?: string }> = [];
    const scheduler = new IngestionScheduler(registry, {
      onEvents: async (events) => (await persistence.persistEventsWithDiagnostics(events)).writeDiagnostics,
      onEventDetail: async (detail) => (await persistence.persistEventDetailWithDiagnostics(detail)).writeDiagnostics,
      onRankings: async (rankings) => (await persistence.persistRankingsWithDiagnostics(rankings)).writeDiagnostics,
      onLiveScores: async () => undefined,
      onJobComplete: async (job) => {
        completedJobs.push({
          jobType: job.jobType,
          eventExternalId: job.eventExternalId,
        });
      },
    }, undefined, {
      configReader,
      eventReader,
      now: () => syncVerificationNow,
      syncRunLedger,
    });
    const rootAdmin = await createTestUser({
      displayName: 'Golf Sync Verification Root Admin',
      isRootAdmin: true,
    });
    const providerService = new ProviderService(
      prisma,
      registry,
      scheduler,
      undefined,
      configReader,
      undefined,
      undefined,
      undefined,
      syncRunLedger,
    );

    const manualSchedule = await providerService.prepareSportSync(
      {
        sport: Sport.GOLF,
        feeds: ['EVENTSCHEDULE'],
        from: new Date('2026-04-01T00:00:00.000Z'),
        to: new Date('2026-06-30T23:59:59.999Z'),
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    const manualScheduleRuns = await waitForProviderSyncRuns(manualSchedule.syncRuns.map((run) => run.id));
    expect(manualScheduleRuns).toHaveLength(1);
    const manualSchedulePayload = toRecord(manualScheduleRuns[0].payloadJson);
    const manualScheduleSummary = toRecord(toRecord(manualSchedulePayload?.writeDiagnostics)?.summary);
    expect(manualScheduleRuns[0].payloadJson).toEqual(expect.objectContaining({
      requestedFeed: 'EVENTSCHEDULE',
      jobPayload: expect.objectContaining({ status: 'COMPLETED' }),
      writeDiagnostics: expect.objectContaining({
        summary: expect.objectContaining({
          created: expect.any(Number),
        }),
      }),
    }));
    expectNumberGreaterThan(manualScheduleSummary?.created, 0);

    const eligibleEventIds = await eventReader.listEventIdsForFeed({
      sport: Sport.GOLF,
      feed: 'EVENTPARTICIPANTS',
      from: syncVerificationNow,
      to: new Date(syncVerificationNow.getTime() + 14 * 24 * 60 * 60 * 1000),
      now: syncVerificationNow,
    });
    expect(eligibleEventIds).toEqual([
      'golf-genesis-scottish-open-2026',
      'golf-relative-weekend-20260604',
    ]);

    const manualField = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(manualField.syncRuns.map((run) => run.id));

    const manualRankings = await providerService.prepareSportSync(
      {
        sport: Sport.GOLF,
        feeds: ['PARTICIPANTRANKINGS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    await waitForProviderSyncRuns(manualRankings.syncRuns.map((run) => run.id));

    const manualFieldAfterRankings = await providerService.syncEventData(
      {
        sport: Sport.GOLF,
        eventId: eventExternalId,
        feeds: ['EVENTPARTICIPANTS'],
      },
      rootAdmin.user.id,
      rootAdmin.user.email,
    );
    const fieldRuns = await waitForProviderSyncRuns(manualFieldAfterRankings.syncRuns.map((run) => run.id));
    expect(fieldRuns[0].payloadJson).toEqual(expect.objectContaining({
      requestedFeed: 'EVENTPARTICIPANTS',
      jobPayload: expect.objectContaining({ status: 'COMPLETED' }),
      writeDiagnostics: expect.objectContaining({
        summary: expect.objectContaining({
          total: 80,
        }),
        rows: expect.arrayContaining([
          expect.objectContaining({
            entityType: 'SportEventParticipant',
            externalId: eventExternalId,
            participantExternalId: 'golfer-01',
          }),
        ]),
      }),
    }));

    scheduler.start();
    let scheduledRuns: Awaited<ReturnType<typeof waitForScheduledProviderSyncRuns>>;
    try {
      scheduledRuns = await waitForScheduledProviderSyncRuns(providerId, 4);
    } finally {
      scheduler.stop();
    }

    const scottieEventParticipant = await findEventParticipantByExternalIds({
      providerId,
      eventExternalId,
      participantExternalId: 'golfer-01',
    });
    expect(scottieEventParticipant.worldRanking).toBe(1);
    expect(scottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);
    const scheduledScottieEventParticipant = await findEventParticipantByExternalIds({
      providerId,
      eventExternalId: 'golf-genesis-scottish-open-2026',
      participantExternalId: 'golfer-01',
    });
    expect(scheduledScottieEventParticipant.worldRanking).toBe(1);
    expect(scheduledScottieEventParticipant.oddsToWin?.toNumber()).toBeGreaterThan(0);

    const scheduledRunPayloads = scheduledRuns.map((run) => toRecord(run.payloadJson));
    expect(scheduledRuns.map((run) => run.eventId).filter(Boolean).sort()).toEqual([
      'golf-genesis-scottish-open-2026',
      'golf-relative-weekend-20260604',
    ].sort());
    expect(scheduledRunPayloads.map((payload) => payload?.requestedFeed).sort()).toEqual([
      'EVENTSCHEDULE',
      'EVENTPARTICIPANTS',
      'EVENTPARTICIPANTS',
      'PARTICIPANTRANKINGS',
    ].sort());

    const scheduledPayloadPaths = scheduledRuns
      .flatMap((run) => providerPayloadPaths(run.payloadJson));
    expect(scheduledPayloadPaths).toEqual(expect.arrayContaining([
      '/v1/scenarios',
      '/v1/scenarios/golf-major-2026/events',
      '/v1/scenarios/golf-major-2026/events/golf-masters-2026/detail',
      '/v1/scenarios/golf-major-2026/events/golf-genesis-scottish-open-2026/detail',
      '/v1/scenarios/golf-relative-today/events/golf-relative-weekend-20260604/detail',
    ]));
    expect(scheduledPayloadPaths).not.toContain('/v1/scenarios/tennis-grand-slam-2026/events');
    expect(scheduledPayloadPaths).not.toContain('/v1/scenarios/ncaa-team-tournament-2026/events');

    const persistedProviderSports = await prisma.sportEvent.findMany({
      where: { providerId },
      distinct: ['sport'],
      select: { sport: true },
    });
    expect(persistedProviderSports.map((row) => row.sport)).toEqual(['GOLF']);
    expect(completedJobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ jobType: 'EVENT_SCHEDULE_SYNC' }),
      expect.objectContaining({ jobType: 'PARTICIPANT_RANKINGS_SYNC' }),
      expect.objectContaining({ jobType: 'EVENT_PARTICIPANTS_SYNC', eventExternalId }),
    ]));
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
      onRankings: async () => undefined,
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

  it('pool-master-33l.8.8: adapter applies explicit mock event states through detail live and results feeds', async () => {
    const anchor = new Date('2026-04-26T21:00:00.000Z');
    const lifecycleProvider = await startMockContestFeedProvider({
      routes: {
        scenarioStoreOptions: {
          now: () => anchor,
        },
      },
    });

    try {
      const adapter = new MockContestFeedAdapter(lifecycleProvider.baseUrl);
      const from = anchor;
      const to = new Date(anchor.getTime() + 14 * 24 * 60 * 60 * 1000);

      const openEvents = await adapter.getUpcomingEvents(Sport.GOLF, { from, to });
      const event = openEvents.find((item) =>
        item.externalId.startsWith('golf-relative-weekend-'),
      );
      expect(event).toBeDefined();
      expect(event?.status).toBe('SCHEDULED');
      expect(event?.fieldLocked).toBe(false);

      const eventId = event?.externalId ?? '';
      const detail = await adapter.getEventDetails(eventId, { mockEventState: 'locked' });
      expect(detail?.name).toBe(event?.name);
      expect(detail?.fieldLocked).toBe(true);
      expect(detail?.participants).toHaveLength(80);

      const openScores = await adapter.getLiveScores(eventId, { mockEventState: 'open' });
      expect(openScores.category).toBe('GOLF');
      if (openScores.category === 'GOLF') {
        expect(openScores.rounds).toHaveLength(0);
      }

      const liveScores = await adapter.getLiveScores(eventId, { mockEventState: 'live' });
      expect(liveScores.category).toBe('GOLF');
      if (liveScores.category === 'GOLF') {
        expect(liveScores.rounds.length).toBeGreaterThan(0);
        expect(liveScores.rounds[0]).toEqual(
          expect.objectContaining({
            participantExternalId: expect.any(String),
            round: expect.any(Number),
            strokes: expect.any(Number),
            scoreToPar: expect.any(Number),
          }),
        );
      }

      const results = await adapter.getEventResults(eventId, { mockEventState: 'completed' });
      expect(results).toMatchObject({
        eventExternalId: eventId,
        providerId,
        status: 'OFFICIAL',
      });
      expect(results?.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            finishPosition: 1,
            totalScore: expect.any(Number),
            totalStrokes: expect.any(Number),
          }),
        ]),
      );
    } finally {
      await lifecycleProvider.close();
    }
  });
});
