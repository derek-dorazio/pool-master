import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  IngestionJobResponseSchema,
  IngestionProvidersResponseSchema,
  IngestSportOddsResponseSchema,
  ProviderHealthCheckDtoSchema,
  ProviderIngestionJobDtoSchema,
  ProviderListResponseSchema,
  ProviderSportSyncPreparationResponseSchema,
  ProviderSyncRunListResponseSchema,
  UserDetailResponseSchema,
  UserListResponseSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { adminModule } from '../../../packages/core-api/src/modules/admin/routes';
import { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { ingestionModule } from '../../../packages/core-api/src/modules/ingestion/routes';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import type {
  ProviderEventResult,
  ProviderHealthStatus,
  ProviderParticipant,
  ProviderRanking,
  ProviderStatEvent,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';

class ContractProvider implements SportDataProvider {
  providerId = 'contract-provider';
  providerName = 'Contract Provider';
  sportsCovered: Sport[] = ['GOLF'];

  async getUpcomingEvents(): Promise<SportEvent[]> { return []; }
  async getEventDetails(): Promise<SportEventDetail | null> { return null; }
  async getParticipants(): Promise<ProviderParticipant[]> { return []; }
  async getRankings(): Promise<ProviderRanking[]> { return []; }
  async getLiveScores(): Promise<ProviderStatEvent[]> { return []; }
  async getEventResults(): Promise<ProviderEventResult | null> { return null; }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: this.providerId,
      status: 'HEALTHY',
      errorRateLastHour: 0,
      latencyMsP95: 5,
    };
  }
}

class OperationalContractProvider implements SportDataProvider {
  providerId = 'contract-provider';
  providerName = 'Contract Provider';
  sportsCovered: Sport[] = ['GOLF'];

  async getUpcomingEvents(): Promise<SportEvent[]> {
    return [
      {
        externalId: 'event-1',
        providerId: this.providerId,
        sport: 'GOLF',
        name: 'Contract Masters',
        venue: 'Contract National',
        location: 'Augusta, GA',
        startDate: new Date('2026-04-10T15:00:00.000Z'),
        endDate: new Date('2026-04-14T21:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 2,
        fieldLocked: false,
        metadata: {},
      },
    ];
  }

  async getEventDetails(eventId: string): Promise<SportEventDetail | null> {
    if (eventId !== 'event-1') {
      return null;
    }

    return {
      externalId: 'event-1',
      providerId: this.providerId,
      sport: 'GOLF',
      name: 'Contract Masters',
      venue: 'Contract National',
      location: 'Augusta, GA',
      startDate: new Date('2026-04-10T15:00:00.000Z'),
      endDate: new Date('2026-04-14T21:00:00.000Z'),
      status: 'SCHEDULED',
      rounds: 4,
      participantCount: 2,
      fieldLocked: false,
      metadata: {
        releaseRule: '3 days prior at noon',
      },
      participants: [
        {
          externalId: 'golfer-1',
          providerId: this.providerId,
          sport: 'GOLF',
          name: 'Avery Hart',
          firstName: 'Avery',
          lastName: 'Hart',
          nationality: 'US',
          active: true,
          metadata: {},
        },
        {
          externalId: 'golfer-2',
          providerId: this.providerId,
          sport: 'GOLF',
          name: 'Brooke Vale',
          firstName: 'Brooke',
          lastName: 'Vale',
          nationality: 'US',
          active: true,
          metadata: {},
        },
      ],
    };
  }

  async getParticipants(): Promise<ProviderParticipant[]> {
    return [
      {
        externalId: 'golfer-1',
        providerId: this.providerId,
        sport: 'GOLF',
        name: 'Avery Hart',
        active: true,
        metadata: {},
      },
    ];
  }

  async getRankings(): Promise<ProviderRanking[]> {
    return [
      {
        participantExternalId: 'golfer-1',
        rankingType: 'OWGR',
        rank: 1,
        points: 15.2,
        asOfDate: new Date('2026-04-08T00:00:00.000Z'),
      },
    ];
  }

  async getLiveScores(): Promise<ProviderStatEvent[]> {
    return [];
  }

  async getEventResults(): Promise<ProviderEventResult | null> {
    return null;
  }

  async healthCheck(): Promise<ProviderHealthStatus> {
    return {
      providerId: this.providerId,
      status: 'HEALTHY',
      errorRateLastHour: 0,
      latencyMsP95: 8,
      lastSuccessfulPoll: new Date('2026-04-09T09:59:00.000Z'),
      message: 'Provider responding normally.',
    };
  }
}

class EmptyCoverageProvider extends OperationalContractProvider {
  providerId = 'empty-coverage-provider';
  providerName = 'Empty Coverage Provider';
  sportsCovered: Sport[] = [];
}

async function buildOperationalAdminApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const registry = new ProviderRegistry();
  registry.register('GOLF', new OperationalContractProvider(), 'PRIMARY');
  const providerService = new ProviderService(getPrisma(), registry);

  app.decorate('prisma', getPrisma());
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService,
  });
  await app.ready();

  return app;
}

async function buildEmptyCoverageAdminApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const registry = new ProviderRegistry();
  registry.register('GOLF', new EmptyCoverageProvider(), 'PRIMARY');
  const providerService = new ProviderService(getPrisma(), registry);

  app.decorate('prisma', getPrisma());
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService,
  });
  await app.ready();

  return app;
}

describe('Contract verification (root admin)', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownIntegrationTests();
  });

  it('ingestion root-admin routes match their DTOs', async () => {
    const app = Fastify({ logger: false });
    const registry = new ProviderRegistry();
    registry.register('GOLF', new ContractProvider(), 'PRIMARY');
    app.setErrorHandler(globalErrorHandler);

    await app.register(ingestionModule, {
      prefix: '/api/v1/admin/ingestion',
      registry,
      scheduler: {
        async syncSport() {
          return {
            jobType: 'SCHEDULE_SYNC',
            providerId: 'contract-provider',
            sport: 'GOLF',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 2,
            errors: 0,
            errorLog: [],
          };
        },
        async pollLiveScores() {
          return {
            jobType: 'LIVE_SCORES',
            providerId: 'contract-provider',
            sport: 'GOLF',
            eventExternalId: 'event-1',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 1,
            errors: 0,
            errorLog: [],
          };
        },
        async fetchEventResults() {
          return {
            jobType: 'EVENT_RESULTS',
            providerId: 'contract-provider',
            sport: 'GOLF',
            eventExternalId: 'event-1',
            status: 'COMPLETED',
            startedAt: new Date('2026-04-09T10:00:00.000Z'),
            completedAt: new Date('2026-04-09T10:00:01.000Z'),
            recordsProcessed: 1,
            errors: 0,
            errorLog: [],
          };
        },
      } as any,
      oddsAdapter: {
        async getOdds() {
          return [{
            eventId: 'event-1',
            sport: 'GOLF',
            homeTeam: 'Player A',
            awayTeam: 'Player B',
            commenceTime: new Date('2026-04-09T12:00:00.000Z'),
            odds: [],
          }];
        },
      } as any,
    });

    await app.ready();

    const providersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/ingestion/providers',
    });
    expect(providersRes.statusCode).toBe(200);
    expect(IngestionProvidersResponseSchema.safeParse(providersRes.json()).success).toBe(true);

    const syncRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion/sync/GOLF',
    });
    expect(syncRes.statusCode).toBe(200);
    expect(IngestionJobResponseSchema.safeParse(syncRes.json()).success).toBe(true);

    const oddsRes = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingestion/odds/GOLF',
    });
    expect(oddsRes.statusCode).toBe(200);
    expect(IngestSportOddsResponseSchema.safeParse(oddsRes.json()).success).toBe(true);

    await app.close();
  });

  it('admin routes reject missing root-admin identity with ErrorEnvelopeSchema', async () => {
    const res = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
    });

    expect(res.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
    expect(res.json().error.code).toBe('ROOT_ADMIN_SESSION_REQUIRED');
  });

  it('root-admin user reads match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Happy Path User',
      isRootAdmin: true,
    });

    await getPrisma().providerSyncRun.createMany({
      data: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          providerId: 'integration-test',
          sport: 'GOLF',
          eventId: 'golf-masters-2026',
          status: 'COMPLETED',
          startedAt: new Date('2026-04-09T10:00:00.000Z'),
          completedAt: new Date('2026-04-09T10:01:00.000Z'),
          payloadJson: {
            runType: 'EVENT_SYNC',
            recordsProcessed: 42,
            detail: 'Initial event and field import',
          },
        },
        {
          id: '22222222-2222-2222-2222-222222222222',
          providerId: 'integration-test',
          sport: 'GOLF',
          eventId: null,
          status: 'FAILED',
          startedAt: new Date('2026-04-08T10:00:00.000Z'),
          completedAt: new Date('2026-04-08T10:00:30.000Z'),
          payloadJson: {
            runType: 'SCHEDULE_SYNC',
            errorCount: 1,
            detail: 'Transient provider timeout',
          },
        },
      ],
    });

    const listRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(UserListResponseSchema.safeParse(listRes.json()).success).toBe(true);

    const detailRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/admin/users/${rootAdmin.user.id}`,
      headers: rootAdmin.headers,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(UserDetailResponseSchema.safeParse(detailRes.json()).success).toBe(true);

    const syncRunsRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/providers/sync-runs?providerId=integration-test&sport=GOLF&limit=10',
      headers: rootAdmin.headers,
    });
    expect(syncRunsRes.statusCode).toBe(200);
    expect(ProviderSyncRunListResponseSchema.safeParse(syncRunsRes.json()).success).toBe(true);
    expect(syncRunsRes.json().items).toHaveLength(2);
    expect(syncRunsRes.json().items[0].providerId).toBe('integration-test');
    expect(syncRunsRes.json().items[0].payload.runType).toBeDefined();
  });

  it('root-admin provider operational routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Provider Ops User',
      isRootAdmin: true,
    });

    await getPrisma().sportEvent.upsert({
      where: {
        providerId_externalId: {
          providerId: 'contract-provider',
          externalId: 'event-1',
        },
      },
      create: {
        externalId: 'event-1',
        providerId: 'contract-provider',
        sport: 'GOLF',
        name: 'Contract Masters',
        venue: 'Contract National',
        location: 'Augusta, GA',
        startDate: new Date('2026-04-10T15:00:00.000Z'),
        endDate: new Date('2026-04-14T21:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 2,
        releaseAt: new Date('2026-04-07T16:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-09T16:00:00.000Z'),
        fieldLocked: false,
        metadata: {},
      },
      update: {
        sport: 'GOLF',
        name: 'Contract Masters',
        venue: 'Contract National',
        location: 'Augusta, GA',
        startDate: new Date('2026-04-10T15:00:00.000Z'),
        endDate: new Date('2026-04-14T21:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 2,
        releaseAt: new Date('2026-04-07T16:00:00.000Z'),
        fieldLocksAt: new Date('2026-04-09T16:00:00.000Z'),
        fieldLocked: false,
        metadata: {},
      },
    });

    await getPrisma().providerSyncRun.upsert({
      where: {
        id: '33333333-3333-3333-3333-333333333333',
      },
      create: {
        id: '33333333-3333-3333-3333-333333333333',
        providerId: 'contract-provider',
        sport: 'GOLF',
        eventId: 'event-1',
        status: 'COMPLETED',
        startedAt: new Date('2026-04-09T10:00:00.000Z'),
        completedAt: new Date('2026-04-09T10:02:00.000Z'),
        payloadJson: {
          runType: 'MANUAL_SYNC',
          recordsProcessed: 12,
          detail: 'Imported event and participant field.',
        },
      },
      update: {
        providerId: 'contract-provider',
        sport: 'GOLF',
        eventId: 'event-1',
        status: 'COMPLETED',
        startedAt: new Date('2026-04-09T10:00:00.000Z'),
        completedAt: new Date('2026-04-09T10:02:00.000Z'),
        payloadJson: {
          runType: 'MANUAL_SYNC',
          recordsProcessed: 12,
          detail: 'Imported event and participant field.',
        },
      },
    });

    const app = await buildOperationalAdminApp();

    try {
      const providersRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/providers/health',
        headers: rootAdmin.headers,
      });
      expect(providersRes.statusCode).toBe(200);
      expect(ProviderListResponseSchema.safeParse(providersRes.json()).success).toBe(true);
      expect(providersRes.json().items[0].providerId).toBe('contract-provider');

      const syncRunsRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/providers/sync-runs?providerId=contract-provider&sport=GOLF&status=COMPLETED&limit=10',
        headers: rootAdmin.headers,
      });
      expect(syncRunsRes.statusCode).toBe(200);
      expect(ProviderSyncRunListResponseSchema.safeParse(syncRunsRes.json()).success).toBe(true);
      expect(syncRunsRes.json().items.length).toBeGreaterThanOrEqual(1);
      expect(
        syncRunsRes.json().items.some(
          (item: { eventId: string | null; payload: { detail?: string } }) =>
            item.eventId === 'event-1'
            && item.payload.detail === 'Imported event and participant field.',
        ),
      ).toBe(true);

      const healthRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/contract-provider/health-check',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(healthRes.statusCode).toBe(200);
      expect(ProviderHealthCheckDtoSchema.safeParse(healthRes.json()).success).toBe(true);
      expect(healthRes.json().providerId).toBe('contract-provider');

      const prepareSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/sync/GOLF',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(prepareSyncRes.statusCode).toBe(201);
      expect(ProviderSportSyncPreparationResponseSchema.safeParse(prepareSyncRes.json()).success).toBe(true);
      expect(prepareSyncRes.json().sport).toBe('GOLF');
      expect(prepareSyncRes.json().eventsHydrated).toBe(1);
      expect(prepareSyncRes.json().providerIds).toContain('contract-provider');

      const reIngestRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/contract-provider/re-ingest/event-1',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(reIngestRes.statusCode).toBe(201);
      expect(ProviderIngestionJobDtoSchema.safeParse(reIngestRes.json()).success).toBe(true);
      expect(reIngestRes.json().providerId).toBe('contract-provider');
      expect(reIngestRes.json().eventId).toBe('event-1');
    } finally {
      await app.close();
    }
  });

  it('root-admin routes expose stable not-found error codes', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Contract User',
      isRootAdmin: true,
    });

    const userRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
      headers: rootAdmin.headers,
    });
    expect(userRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(userRes.json()).success).toBe(true);
    expect(userRes.json().error.code).toBe('USER_NOT_FOUND');

    const providerRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/providers/missing-provider',
      headers: rootAdmin.headers,
    });
    expect(providerRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(providerRes.json()).success).toBe(true);
    expect(providerRes.json().error.code).toBe('PROVIDER_NOT_FOUND');

    const app = await buildOperationalAdminApp();

    try {
      const healthCheckRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/missing-provider/health-check',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(healthCheckRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(healthCheckRes.json()).success).toBe(true);
      expect(healthCheckRes.json().error.code).toBe('PROVIDER_NOT_FOUND');

      const reIngestMissingProviderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/missing-provider/re-ingest/event-1',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(reIngestMissingProviderRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(reIngestMissingProviderRes.json()).success).toBe(true);
      expect(reIngestMissingProviderRes.json().error.code).toBe('PROVIDER_NOT_FOUND');

      const missingSportProviderRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/sync/UFC',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(missingSportProviderRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(missingSportProviderRes.json()).success).toBe(true);
      expect(missingSportProviderRes.json().error.code).toBe('SPORT_PROVIDER_NOT_FOUND');

      const reIngestMissingEventRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/contract-provider/re-ingest/missing-event',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(reIngestMissingEventRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(reIngestMissingEventRes.json()).success).toBe(true);
      expect(reIngestMissingEventRes.json().error.code).toBe('PROVIDER_EVENT_NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('root-admin provider re-ingest exposes typed provider coverage errors', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Provider Coverage User',
      isRootAdmin: true,
    });
    const app = await buildEmptyCoverageAdminApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/empty-coverage-provider/re-ingest/event-1',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });

      expect(response.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json().error.code).toBe('PROVIDER_SPORT_COVERAGE_REQUIRED');
    } finally {
      await app.close();
    }
  });
});
