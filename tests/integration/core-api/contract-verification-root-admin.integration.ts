import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  UserResetPasswordResponseSchema,
  AdminProviderEventCleanupResponseSchema,
  AdminContestConfigTemplateResponseSchema,
  ContestConfigTemplateListResponseSchema,
  IngestionScheduleConfigSchema,
  AdminListProviderCatalogEventsResponseSchema,
  LeagueListResponseSchema,
  LeagueResponseSchema,
  PollIntervalConfigSchema,
  ProviderHealthCheckDtoSchema,
  ProviderIngestionJobDtoSchema,
  ProviderListResponseSchema,
  ProviderManualSyncSubmissionResponseSchema,
  ProviderSyncRunListResponseSchema,
  SuccessSchema,
  UserResponseSchema,
  UserListResponseSchema,
  CloneSeasonResponseSchema,
  ParticipantListResponseSchema,
  ParticipantResponseSchema,
  SeasonListResponseSchema,
  SeasonResponseSchema,
  SportEventListResponseSchema,
  SportEventParticipantListResponseSchema,
  SportEventResponseSchema,
  SportEventRoundListResponseSchema,
  SportEventTierListResponseSchema,
  SportLeagueListResponseSchema,
  SportLeagueResponseSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { adminModule } from '../../../packages/core-api/src/modules/admin/routes';
import { ProviderService } from '../../../packages/core-api/src/modules/admin/provider-service';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
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
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  ProviderRanking,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { Sport } from '@poolmaster/shared/domain';
import type { LiveScoreResult } from '@poolmaster/shared/dto';

function emptyLiveScorePersistenceResult() {
  return {
    updatesReturned: 0,
    updatesPersisted: 0,
    updatesSkipped: 0,
    writeDiagnostics: {
      summary: {
        total: 0,
        unchanged: 0,
        created: 0,
        updated: 0,
        deleted: 0,
      },
      rows: [],
    },
  };
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
        providerId: this.providerId,
        participantExternalId: 'golfer-1',
        rankingType: 'OWGR',
        rank: 1,
        points: 15.2,
        asOfDate: new Date('2026-04-08T00:00:00.000Z'),
      },
    ];
  }

  async getLiveScores(): Promise<LiveScoreResult> {
    return { category: 'GOLF', externalEventId: 'unused', rounds: [] };
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

class EmptyDiagnosticsProvider extends OperationalContractProvider implements ProviderPayloadDiagnostics {
  providerId = 'empty-diagnostics-provider';
  providerName = 'Empty Diagnostics Provider';
  private payloads: ProviderPayloadCapture[] = [];

  clearProviderPayloads(): void {
    this.payloads = [];
  }

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    const payloads = this.payloads;
    this.payloads = [];
    return payloads;
  }

  override async getUpcomingEvents(): Promise<SportEvent[]> {
    this.payloads.push({
      operation: 'test.schedule',
      path: '/test/schedule',
      capturedAt: '2026-04-05T12:00:00.000Z',
      raw: {
        events: [],
      },
    });
    return [];
  }
}

/**
 * `exposeRegistry` also hands the admin module the provider registry, so the
 * golf score-source lane's EventScoreSourceService can resolve the registered
 * provider for adminListProviderCatalogEvents (pool-master-cs8). Off by default
 * — the operational-sync cases only exercise providerService.
 */
async function buildOperationalAdminApp(
  { exposeRegistry = false }: { exposeRegistry?: boolean } = {},
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const registry = new ProviderRegistry();
  registry.register('GOLF', new OperationalContractProvider(), 'PRIMARY');
  const scheduler = new IngestionScheduler(registry, {
    onEvents: async () => undefined,
    onEventDetail: async () => undefined,
    onRankings: async () => undefined,
    onLiveScores: async () => emptyLiveScorePersistenceResult(),
    onJobComplete: async () => undefined,
  }, undefined, {
    now: () => new Date('2026-04-05T12:00:00.000Z'),
  });
  const providerService = new ProviderService(getPrisma(), registry, scheduler);

  app.decorate('prisma', getPrisma());
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService,
    ...(exposeRegistry ? { providerRegistry: registry } : {}),
  });
  await app.ready();

  return app;
}

async function buildEmptyCoverageAdminApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const registry = new ProviderRegistry();
  registry.register('GOLF', new EmptyCoverageProvider(), 'PRIMARY');
  const scheduler = new IngestionScheduler(registry, {
    onEvents: async () => undefined,
    onEventDetail: async () => undefined,
    onRankings: async () => undefined,
    onLiveScores: async () => emptyLiveScorePersistenceResult(),
    onJobComplete: async () => undefined,
  }, undefined, {
    now: () => new Date('2026-04-05T12:00:00.000Z'),
  });
  const providerService = new ProviderService(getPrisma(), registry, scheduler);

  app.decorate('prisma', getPrisma());
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService,
  });
  await app.ready();

  return app;
}

async function buildEmptyDiagnosticsAdminApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const registry = new ProviderRegistry();
  registry.register('GOLF', new EmptyDiagnosticsProvider(), 'PRIMARY');
  const scheduler = new IngestionScheduler(registry, {
    onEvents: async () => undefined,
    onEventDetail: async () => undefined,
    onRankings: async () => undefined,
    onLiveScores: async () => emptyLiveScorePersistenceResult(),
    onJobComplete: async () => undefined,
  }, undefined, {
    now: () => new Date('2026-04-05T12:00:00.000Z'),
  });
  const providerService = new ProviderService(getPrisma(), registry, scheduler);

  app.decorate('prisma', getPrisma());
  app.setErrorHandler(globalErrorHandler);
  await app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerService,
  });
  await app.ready();

  return app;
}

async function waitForProviderSyncRun(
  syncRunId: string,
): Promise<{ status: string; payloadJson: unknown }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await getPrisma().providerSyncRun.findUnique({
      where: { id: syncRunId },
      select: { status: true, payloadJson: true },
    });
    if (row && row.status !== 'SUBMITTED' && row.status !== 'IN_PROGRESS') {
      return row;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 25);
    });
  }

  throw new Error(`Provider sync run ${syncRunId} did not finish in time.`);
}

describe('Contract verification (root admin)', () => {
  beforeAll(async () => {
    await setupIntegrationTests();
  });

  afterAll(async () => {
    await cleanupTestData();
    await teardownIntegrationTests();
  });

  // #202 step 3.4 — the user list moved out from under `/api/v1/admin`, so the two failures
  // are now distinguishable, which they were not before: an anonymous caller is not
  // authenticated, and an authenticated caller who is not a root admin is not authorized. The
  // old admin prefix answered ROOT_ADMIN_SESSION_REQUIRED to both.
  it('separates "not signed in" from "not a root admin" on the unscoped user list (A1)', async () => {
    const anonymous = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users',
    });
    expect(anonymous.statusCode).toBe(401);
    expect(ErrorEnvelopeSchema.safeParse(anonymous.json()).success).toBe(true);
    expect(anonymous.json().error.code).toBe('AUTH_SESSION_REQUIRED');

    const ordinaryUser = await createTestUser({ displayName: 'Contract Non Admin User' });
    const forbidden = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: ordinaryUser.headers,
    });
    expect(forbidden.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(forbidden.json()).success).toBe(true);
    expect(forbidden.json().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
  });

  it('root-admin user reads match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Happy Path User',
      isRootAdmin: true,
    });
    const targetUser = await createTestUser({
      displayName: 'Root Admin Managed User',
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
            runType: 'EVENT_SCHEDULE_SYNC',
            errorCount: 1,
            detail: 'Transient provider timeout',
          },
        },
      ],
    });

    const listRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(UserListResponseSchema.safeParse(listRes.json()).success).toBe(true);

    const detailRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/users/${rootAdmin.user.id}`,
      headers: rootAdmin.headers,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(detailRes.json()).success).toBe(true);
    // #202 step 3.4 — `{ user }`, and no `viewerAuthority` block (A8). Of its three flags two
    // were constants on a root-admin-only route, and `self` is `user.id === me.id`.
    expect(detailRes.json().user.id).toBe(rootAdmin.user.id);
    expect(detailRes.json()).not.toHaveProperty('viewerAuthority');

    const setRootAdminRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${targetUser.user.id}/root-admin`,
      headers: rootAdmin.headers,
      payload: {
        isRootAdmin: true,
        reason: 'Contract verification',
      },
    });
    expect(setRootAdminRes.statusCode).toBe(200);
    expect(SuccessSchema.safeParse(setRootAdminRes.json()).success).toBe(true);

    const resetPasswordRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${targetUser.user.id}/reset-password`,
      headers: rootAdmin.headers,
      payload: {
        reason: 'Contract verification',
      },
    });
    expect(resetPasswordRes.statusCode).toBe(200);
    expect(UserResetPasswordResponseSchema.safeParse(resetPasswordRes.json()).success).toBe(true);
    expect(typeof resetPasswordRes.json().temporaryPassword).toBe('string');

    await getPrisma().user.update({
      where: { id: targetUser.user.id },
      data: { isActive: false },
    });

    const deleteUserRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/users/${targetUser.user.id}`,
      headers: rootAdmin.headers,
      payload: {
        email: targetUser.user.email,
        reason: 'Contract verification cleanup',
      },
    });
    expect(deleteUserRes.statusCode).toBe(200);
    expect(SuccessSchema.safeParse(deleteUserRes.json()).success).toBe(true);
    expect(await getPrisma().user.findUnique({ where: { id: targetUser.user.id } })).toBeNull();

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

  it('root-admin platform-config and contest-template routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Config Contract User',
      isRootAdmin: true,
    });

    const pollReadRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/config/poll-intervals',
      headers: rootAdmin.headers,
    });
    expect(pollReadRes.statusCode).toBe(200);
    expect(PollIntervalConfigSchema.safeParse(pollReadRes.json()).success).toBe(true);

    const pollUpdateRes = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/admin/config/poll-intervals',
      headers: rootAdmin.headers,
      payload: {
        standings: 15000,
      },
    });
    expect(pollUpdateRes.statusCode).toBe(200);
    expect(PollIntervalConfigSchema.safeParse(pollUpdateRes.json()).success).toBe(true);
    expect(pollUpdateRes.json().standings).toBe(15000);

    const ingestionReadRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/config/ingestion-schedule',
      headers: rootAdmin.headers,
    });
    expect(ingestionReadRes.statusCode).toBe(200);
    expect(IngestionScheduleConfigSchema.safeParse(ingestionReadRes.json()).success).toBe(true);
    expect(ingestionReadRes.json().scheduledSports).toEqual(['GOLF']);

    const ingestionUpdateRes = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/admin/config/ingestion-schedule',
      headers: rootAdmin.headers,
      payload: {
        scheduledSports: ['GOLF', 'TENNIS'],
        eventLiveScores: {
          intervalSeconds: 45,
        },
      },
    });
    expect(ingestionUpdateRes.statusCode).toBe(200);
    expect(IngestionScheduleConfigSchema.safeParse(ingestionUpdateRes.json()).success).toBe(true);
    expect(ingestionUpdateRes.json().scheduledSports).toEqual(['GOLF', 'TENNIS']);
    expect(ingestionUpdateRes.json().eventLiveScores.intervalSeconds).toBe(45);

    const templateListRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/contest-config-templates?sport=GOLF',
      headers: rootAdmin.headers,
    });
    expect(templateListRes.statusCode).toBe(200);
    expect(ContestConfigTemplateListResponseSchema.safeParse(templateListRes.json()).success).toBe(true);
    const template = templateListRes.json().templates[0];
    const templateId = template?.id;
    expect(templateId).toBeDefined();
    if (!templateId || !template) {
      throw new Error('Expected at least one contest template');
    }

    try {
      const templateUpdateRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/admin/contest-config-templates/${templateId}`,
        headers: rootAdmin.headers,
        payload: {
          description: 'Updated through contract verification.',
        },
      });
      expect(templateUpdateRes.statusCode).toBe(200);
      expect(AdminContestConfigTemplateResponseSchema.safeParse(templateUpdateRes.json()).success).toBe(true);
      expect(templateUpdateRes.json().template.description).toBe('Updated through contract verification.');
    } finally {
      await getPrisma().contestConfigTemplate.update({
        where: { id: templateId },
        data: {
          name: template.name,
          description: template.description,
          sortOrder: template.sortOrder,
          isDefault: template.isDefault,
          active: template.active,
          configJson: template.configuration,
        },
      });
    }
  });

  it('root-admin league lifecycle routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin League Lifecycle User',
      isRootAdmin: true,
    });
    const league = await getPrisma().league.create({
      data: {
        leagueCode: 'ADMINLIFE1',
        name: 'Root Admin Lifecycle League',
        description: 'Managed through contract verification.',
        isActive: true,
        iconKey: 'TROPHY',
        joinPolicy: 'COMMISSIONER_ONLY',
      },
    });
    await getPrisma().leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: rootAdmin.user.id,
        role: 'COMMISSIONER',
        status: 'ACTIVE',
      },
    });

    const listRes = await getApp().inject({
      method: 'GET',
      // #202 — one league list, scope as a parameter. `scope=all` is access rule A1's
      // unscoped read; this replaced `GET /api/v1/admin/leagues`.
      url: '/api/v1/leagues?scope=all&search=Lifecycle',
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(LeagueListResponseSchema.safeParse(listRes.json()).success).toBe(true);
    expect(listRes.json().leagues.some((item: { id: string }) => item.id === league.id)).toBe(true);

    const inactivateRes = await getApp().inject({
      method: 'POST',
      // The league routes always served root admins — `requireCommissioner` grants them — so
      // the `/admin/leagues/*` duplicates are gone and these are the same operations.
      url: `/api/v1/leagues/${league.id}/inactivate`,
      headers: withoutJsonBodyHeaders(rootAdmin.headers),
    });
    expect(inactivateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);
    expect(inactivateRes.json().league.id).toBe(league.id);
    expect(inactivateRes.json().league.isActive).toBe(false);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${league.id}`,
      headers: rootAdmin.headers,
      payload: {
        leagueCode: 'ADMINLIFE1',
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
    expect(await getPrisma().league.findUnique({ where: { id: league.id } })).toBeNull();
  });


  it('pool-master-rop.68.1.2 root-admin provider operational routes match their DTOs on happy paths', async () => {
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
    await getPrisma().providerSyncRun.deleteMany({
      where: {
        providerId: 'contract-provider',
        id: {
          not: '33333333-3333-3333-3333-333333333333',
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
        payload: {
          feeds: ['EVENTSCHEDULE', 'PARTICIPANTRANKINGS'],
        },
      });
      expect(prepareSyncRes.statusCode).toBe(202);
      expect(prepareSyncRes.json().sport).toBe('GOLF');
      expect(prepareSyncRes.json().requestedFeeds).toEqual(['EVENTSCHEDULE', 'PARTICIPANTRANKINGS']);
      expect(typeof prepareSyncRes.json().submittedAt).toBe('string');
      expect(prepareSyncRes.json().syncRuns.length).toBeGreaterThanOrEqual(1);
      expect(prepareSyncRes.json().syncRuns[0]?.status).toBe('SUBMITTED');

      const cleanupDryRunRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/stale-events/cleanup',
        headers: rootAdmin.headers,
        payload: { mode: 'DRY_RUN' },
      });
      expect(cleanupDryRunRes.statusCode).toBe(200);
      expect(AdminProviderEventCleanupResponseSchema.safeParse(cleanupDryRunRes.json()).success).toBe(true);
      expect(cleanupDryRunRes.json().mode).toBe('DRY_RUN');
      expect(cleanupDryRunRes.json().executed).toBe(false);

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

  it('pool-master-ueu.1: manual zero-data syncs expose warning diagnostics and raw provider payload', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Sync Diagnostics Contract User',
      isRootAdmin: true,
    });
    await getPrisma().providerSyncRun.deleteMany({
      where: { providerId: 'empty-diagnostics-provider' },
    });
    const app = await buildEmptyDiagnosticsAdminApp();

    try {
      const prepareSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/sync/GOLF',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: {
          feeds: ['EVENTSCHEDULE'],
        },
      });
      expect(prepareSyncRes.statusCode).toBe(202);
      expect(ProviderManualSyncSubmissionResponseSchema.safeParse(prepareSyncRes.json()).success).toBe(true);
      const syncRunId = prepareSyncRes.json().syncRuns[0]?.id as string;

      const completedRun = await waitForProviderSyncRun(syncRunId);
      expect(completedRun.status).toBe('COMPLETED');
      expect(completedRun.payloadJson).toEqual(
        expect.objectContaining({
          jobPayload: expect.objectContaining({
            recordsProcessed: 0,
            status: 'COMPLETED',
          }),
          providerPayload: expect.objectContaining({
            rawCaptured: true,
            raw: [
              expect.objectContaining({
                path: '/test/schedule',
                raw: { events: [] },
              }),
            ],
          }),
          outcome: expect.objectContaining({
            severity: 'WARNING',
            warnings: [
              expect.objectContaining({
                code: 'NO_PROVIDER_EVENTS',
              }),
            ],
          }),
          stats: expect.objectContaining({
            providerRecordsReturned: 0,
            eventsFetched: 0,
          }),
        }),
      );
      expect((completedRun.payloadJson as Record<string, unknown>).responsePayload).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('pool-master-rop.68.1.6: root-admin routes expose stable not-found error codes', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Contract User',
      isRootAdmin: true,
    });

    const userRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
      headers: rootAdmin.headers,
    });
    expect(userRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(userRes.json()).success).toBe(true);
    expect(userRes.json().error.code).toBe('USER_NOT_FOUND');

    const missingRoleChangeRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000/root-admin',
      headers: rootAdmin.headers,
      payload: {
        isRootAdmin: true,
      },
    });
    expect(missingRoleChangeRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingRoleChangeRes.json()).success).toBe(true);
    expect(missingRoleChangeRes.json().error.code).toBe('USER_NOT_FOUND');

    const missingResetPasswordRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password',
      headers: rootAdmin.headers,
      payload: {},
    });
    expect(missingResetPasswordRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingResetPasswordRes.json()).success).toBe(true);
    expect(missingResetPasswordRes.json().error.code).toBe('USER_NOT_FOUND');

    const missingDeleteUserRes = await getApp().inject({
      method: 'DELETE',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000',
      headers: rootAdmin.headers,
      payload: {
        email: 'missing@example.com',
      },
    });
    expect(missingDeleteUserRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingDeleteUserRes.json()).success).toBe(true);
    expect(missingDeleteUserRes.json().error.code).toBe('USER_NOT_FOUND');

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
        payload: {
          feeds: ['EVENTSCHEDULE'],
        },
      });
      expect(missingSportProviderRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(missingSportProviderRes.json()).success).toBe(true);
      expect(missingSportProviderRes.json().error.code).toBe('SPORT_PROVIDER_NOT_FOUND');

      await getPrisma().ingestionJob.deleteMany({
        where: {
          providerId: 'contract-provider',
          eventExternalId: 'missing-event',
        },
      });
      const reIngestMissingEventRes = await app.inject({
        method: 'POST',
        url: '/api/v1/admin/providers/contract-provider/re-ingest/missing-event',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(reIngestMissingEventRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(reIngestMissingEventRes.json()).success).toBe(true);
      expect(reIngestMissingEventRes.json().error.code).toBe('PROVIDER_EVENT_NOT_FOUND');
      expect(await getPrisma().ingestionJob.count({
        where: {
          providerId: 'contract-provider',
          eventExternalId: 'missing-event',
        },
      })).toBe(0);

      const inactivateMissingLeagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/leagues/00000000-0000-0000-0000-000000000000/inactivate',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(inactivateMissingLeagueRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(inactivateMissingLeagueRes.json()).success).toBe(true);
      expect(inactivateMissingLeagueRes.json().error.code).toBe('LEAGUE_NOT_FOUND');

      const deleteMissingLeagueRes = await getApp().inject({
        method: 'DELETE',
        url: '/api/v1/leagues/00000000-0000-0000-0000-000000000000',
        headers: rootAdmin.headers,
        payload: {
          leagueCode: 'MISSING01',
        },
      });
      expect(deleteMissingLeagueRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(deleteMissingLeagueRes.json()).success).toBe(true);
      expect(deleteMissingLeagueRes.json().error.code).toBe('LEAGUE_NOT_FOUND');
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

  it('pool-master-z3l: the sport-league, season, participant and event operations golf administration uses match their DTOs on happy paths', async () => {
    // plans/124 §8 — a happy-path contract case per operation this epic adds to
    // the golf admin module. Drives one coherent authoring flow (tour -> season
    // -> players -> tournament -> field/tiers/rounds reads -> set-current ->
    // clone) through getApp().inject() and safeParses every response against its
    // published schema. Golf admin rows are not covered by cleanupTestData(), so
    // this test tears down everything it creates child-first in a finally block.
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Golf Contract User',
      isRootAdmin: true,
    });
    const stamp = Date.now().toString().slice(-8);

    await getPrisma().sport.upsert({
      where: { name: 'GOLF' },
      create: {
        name: 'GOLF',
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });

    const created = {
      sportLeagueId: '',
      seasonIds: [] as string[],
      eventIds: [] as string[],
      participantIds: [] as string[],
    };

    try {
      // --- createSportLeague (201: { sportLeague }) ----------------------------
      const leagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/sport-leagues',
        headers: rootAdmin.headers,
        payload: { sport: 'GOLF', name: `Z3L Contract Tour ${stamp}`, matchKeyword: `Z3L${stamp}` },
      });
      expect(leagueRes.statusCode).toBe(201);
      expect(SportLeagueResponseSchema.safeParse(leagueRes.json()).success).toBe(true);
      const leagueId = leagueRes.json().sportLeague.id as string;
      created.sportLeagueId = leagueId;

      // --- listSportLeagues (200) --------------------------------------------
      const leagueListRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/sport-leagues?sport=GOLF',
        headers: rootAdmin.headers,
      });
      expect(leagueListRes.statusCode).toBe(200);
      expect(SportLeagueListResponseSchema.safeParse(leagueListRes.json()).success).toBe(true);
      expect(
        leagueListRes.json().sportLeagues.some((l: { id: string }) => l.id === leagueId),
      ).toBe(true);

      // --- createSeason (201: { season }) -------------------------------------
      const seasonRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/sport-leagues/${leagueId}/seasons`,
        headers: rootAdmin.headers,
        payload: {
          name: `Z3L Contract Season ${stamp} 2081`,
          year: 2081,
          startDate: '2081-01-05T00:00:00.000Z',
          endDate: '2081-11-30T00:00:00.000Z',
        },
      });
      expect(seasonRes.statusCode).toBe(201);
      expect(SeasonResponseSchema.safeParse(seasonRes.json()).success).toBe(true);
      const seasonId = seasonRes.json().season.id as string;
      created.seasonIds.push(seasonId);

      // --- listSeasons (200) ------------------------------------------------
      const seasonListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/sport-leagues/${leagueId}/seasons`,
        headers: rootAdmin.headers,
      });
      expect(seasonListRes.statusCode).toBe(200);
      expect(SeasonListResponseSchema.safeParse(seasonListRes.json()).success).toBe(true);

      // --- getSeason (200: { season }) ---------------------------------------
      const seasonDetailRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/seasons/${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(seasonDetailRes.statusCode).toBe(200);
      expect(seasonDetailRes.json().season.isCurrent).toBe(false);

      // --- createParticipant (201) x3 — golf players are participants -------
      const golf = await getPrisma().sport.findUniqueOrThrow({ where: { name: 'GOLF' } });
      for (let i = 0; i < 3; i += 1) {
        const playerRes = await getApp().inject({
          method: 'POST',
          url: '/api/v1/participants',
          headers: rootAdmin.headers,
          payload: {
            sportId: golf.id,
            participantType: 'INDIVIDUAL',
            name: `Z3L Contract Golfer ${stamp}-${i}`,
            shortName: `Z${stamp}${i}`,
            nationality: 'USA',
            externalId: `z3l-contract-${stamp}-p${i}`,
          },
        });
        expect(playerRes.statusCode).toBe(201);
        if (i === 0) {
          expect(ParticipantResponseSchema.safeParse(playerRes.json()).success).toBe(true);
        }
        created.participantIds.push(playerRes.json().participant.id as string);
      }

      // --- listParticipants, the golf player list (200) ----------------------
      const playerListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants?sportId=${golf.id}&q=Z3L+Contract+Golfer+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(playerListRes.statusCode).toBe(200);
      expect(ParticipantListResponseSchema.safeParse(playerListRes.json()).success).toBe(true);
      expect(playerListRes.json().participants).toHaveLength(3);

      // --- createEvent (201: { event }) ---------------------------------------
      const tournamentRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: rootAdmin.headers,
        payload: {
          name: `Z3L Contract Open ${stamp}`,
          venue: 'Contract Links',
          location: 'Testshire',
          startDate: '2081-07-16T08:00:00.000Z',
          endDate: '2081-07-19T20:00:00.000Z',
          rounds: 4,
          releaseAt: '2081-07-01T00:00:00.000Z',
          fieldLocksAt: '2081-07-15T00:00:00.000Z',
          seasonId,
          autoLifecycleEnabled: false,
        },
      });
      expect(tournamentRes.statusCode).toBe(201);
      expect(SportEventResponseSchema.safeParse(tournamentRes.json()).success).toBe(true);
      const eventId = tournamentRes.json().event.id as string;
      created.eventIds.push(eventId);

      // pool-master-54u — the create response's counts must reflect the default
      // tiers/rounds seeded in the same request (not the pre-seed zero snapshot)
      // and must match what a subsequent GET returns.
      expect(tournamentRes.json().event.tierCount).toBe(6);
      expect(tournamentRes.json().event.loadedParticipantCount).toBe(0);
      const tournamentGetRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentGetRes.statusCode).toBe(200);
      expect(tournamentGetRes.json().event.tierCount).toBe(tournamentRes.json().event.tierCount);
      expect(tournamentGetRes.json().event.loadedParticipantCount).toBe(tournamentRes.json().event.loadedParticipantCount);

      // --- listEvents by season (200) ----------------------------------------
      const tournamentListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events?seasonId=${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentListRes.statusCode).toBe(200);
      expect(SportEventListResponseSchema.safeParse(tournamentListRes.json()).success).toBe(true);
      expect(tournamentListRes.json().events.map((e: { id: string }) => e.id)).toEqual([eventId]);

      // --- listEventParticipants / listEventTiers / listEventRounds (200) ----
      const fieldRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
      });
      expect(fieldRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(fieldRes.json()).success).toBe(true);

      const tiersRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/tiers`,
        headers: rootAdmin.headers,
      });
      expect(tiersRes.statusCode).toBe(200);
      expect(SportEventTierListResponseSchema.safeParse(tiersRes.json()).success).toBe(true);
      expect(tiersRes.json().tiers).toHaveLength(6);

      const roundsRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/rounds`,
        headers: rootAdmin.headers,
      });
      expect(roundsRes.statusCode).toBe(200);
      expect(SportEventRoundListResponseSchema.safeParse(roundsRes.json()).success).toBe(true);
      expect(roundsRes.json().rounds).toHaveLength(4);

      // --- setCurrentSeason (200: { sportLeague }) ----------------------------
      const setCurrentRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/seasons/${seasonId}/set-current`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(setCurrentRes.statusCode).toBe(200);
      expect(SportLeagueResponseSchema.safeParse(setCurrentRes.json()).success).toBe(true);
      expect(setCurrentRes.json().sportLeague.currentSeasonId).toBe(seasonId);

      // --- cloneSeason (201) -----------------------------------------------------
      const cloneRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/seasons/${seasonId}/clone`,
        headers: rootAdmin.headers,
        payload: {},
      });
      expect(cloneRes.statusCode).toBe(201);
      expect(CloneSeasonResponseSchema.safeParse(cloneRes.json()).success).toBe(true);
      expect(cloneRes.json().clonedEventCount).toBe(1);
      expect(cloneRes.json().season.year).toBe(2082);
      expect(cloneRes.json().season.isCurrent).toBe(false);
      const clonedSeasonId = cloneRes.json().season.id as string;
      created.seasonIds.push(clonedSeasonId);

      // Source season's current flag is unchanged by the clone (§4.2a).
      const sourceAfterRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/seasons/${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(sourceAfterRes.json().season.isCurrent).toBe(true);

      // Capture the cloned event id for teardown.
      const clonedListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events?seasonId=${clonedSeasonId}`,
        headers: rootAdmin.headers,
      });
      for (const e of clonedListRes.json().events as Array<{ id: string }>) {
        created.eventIds.push(e.id);
      }
    } finally {
      const prisma = getPrisma();
      if (created.eventIds.length) {
        const seps = await prisma.sportEventParticipant.findMany({
          where: { sportEventId: { in: created.eventIds } },
          select: { id: true },
        });
        const sepIds = seps.map((s) => s.id);
        if (sepIds.length) {
          await prisma.contestEntryPick.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipantGolfRound.deleteMany({ where: { participantRound: { sportEventParticipantId: { in: sepIds } } } });
          await prisma.sportEventParticipantRound.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipantGolfStanding.deleteMany({ where: { standing: { sportEventParticipantId: { in: sepIds } } } });
          await prisma.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipant.deleteMany({ where: { id: { in: sepIds } } });
        }
        await prisma.sportEventTier.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEvent.deleteMany({ where: { id: { in: created.eventIds } } });
      }
      if (created.sportLeagueId) {
        await prisma.sportLeague.updateMany({
          where: { id: created.sportLeagueId },
          data: { currentSeasonId: null },
        });
      }
      if (created.participantIds.length) {
        await prisma.participantLeagueAffiliation.deleteMany({
          where: { participantId: { in: created.participantIds } },
        });
        await prisma.participantProviderMapping.deleteMany({
          where: { participantId: { in: created.participantIds } },
        });
      }
      if (created.seasonIds.length || created.sportLeagueId) {
        await prisma.leagueEvent.deleteMany({
          where: { sportLeagueId: created.sportLeagueId || undefined },
        });
        await prisma.season.deleteMany({
          where: {
            OR: [
              { id: { in: created.seasonIds } },
              created.sportLeagueId ? { sportLeagueId: created.sportLeagueId } : { id: { in: created.seasonIds } },
            ],
          },
        });
      }
      if (created.participantIds.length) {
        await prisma.participant.deleteMany({ where: { id: { in: created.participantIds } } });
      }
      if (created.sportLeagueId) {
        await prisma.sportLeague.deleteMany({ where: { id: created.sportLeagueId } });
      }
    }
  });

  it('pool-master-cs8: provider-catalog browse and event score-source link/unlink match their DTOs on happy paths', async () => {
    // plans/124 §8 — a happy-path contract case for the three provider-linked
    // operations the epic's flagship FAPI scenario left uncovered:
    // adminListProviderCatalogEvents, linkEventScoreSource,
    // unlinkEventScoreSource. Drives one coherent flow through a
    // dedicated admin app with a registered provider and safeParses every
    // response against its published schema. Golf admin rows are not covered by
    // cleanupTestData(), so this test tears down child-first in a finally block.
    const app = await buildOperationalAdminApp({ exposeRegistry: true });
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Golf Score Source Contract User',
      isRootAdmin: true,
    });
    const stamp = Date.now().toString().slice(-8);

    await getPrisma().sport.upsert({
      where: { name: 'GOLF' },
      create: {
        name: 'GOLF',
        participantType: 'INDIVIDUAL',
        category: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });

    const created = {
      sportLeagueId: '',
      seasonId: '',
      eventIds: [] as string[],
    };

    try {
      // --- adminListProviderCatalogEvents (200) --------------------------
      const catalogRes = await app.inject({
        method: 'GET',
        url: '/api/v1/admin/providers/contract-provider/catalog-events?sport=GOLF&from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z',
        headers: rootAdmin.headers,
      });
      expect(catalogRes.statusCode).toBe(200);
      expect(AdminListProviderCatalogEventsResponseSchema.safeParse(catalogRes.json()).success).toBe(true);
      expect(
        catalogRes.json().events.some((e: { externalId: string }) => e.externalId === 'event-1'),
      ).toBe(true);

      // --- sport league -> season -> admin-authored event (syncScope NONE) ----
      const leagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/sport-leagues',
        headers: rootAdmin.headers,
        payload: { sport: 'GOLF', name: `CS8 Contract Tour ${stamp}`, matchKeyword: `CS8${stamp}` },
      });
      expect(leagueRes.statusCode).toBe(201);
      created.sportLeagueId = leagueRes.json().sportLeague.id as string;

      const seasonRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/sport-leagues/${created.sportLeagueId}/seasons`,
        headers: rootAdmin.headers,
        payload: {
          name: `CS8 Contract Season ${stamp} 2083`,
          year: 2083,
          startDate: '2083-01-05T00:00:00.000Z',
          endDate: '2083-11-30T00:00:00.000Z',
        },
      });
      expect(seasonRes.statusCode).toBe(201);
      created.seasonId = seasonRes.json().season.id as string;

      const tournamentRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: rootAdmin.headers,
        payload: {
          name: `CS8 Contract Open ${stamp}`,
          startDate: '2083-06-16T08:00:00.000Z',
          endDate: '2083-06-19T20:00:00.000Z',
          rounds: 4,
          releaseAt: '2083-06-01T00:00:00.000Z',
          fieldLocksAt: '2083-06-15T00:00:00.000Z',
          seasonId: created.seasonId,
          autoLifecycleEnabled: false,
        },
      });
      expect(tournamentRes.statusCode).toBe(201);
      const eventId = tournamentRes.json().event.id as string;
      created.eventIds.push(eventId);
      expect(tournamentRes.json().event.syncScope).toBe('NONE');

      // --- linkEventScoreSource (200) ------------------------------------------
      // A shape test: linkScoreSource only guards against an externalId already
      // held by another SportEvent (409 EXTERNAL_EVENT_ALREADY_LINKED), not
      // against provider-event existence — so a synthetic externalId links fine.
      const linkRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/score-source`,
        headers: rootAdmin.headers,
        payload: { providerId: 'contract-provider', externalId: `contract-cs8-${stamp}` },
      });
      expect(linkRes.statusCode).toBe(200);
      expect(SportEventResponseSchema.safeParse(linkRes.json()).success).toBe(true);
      expect(linkRes.json().event).toMatchObject({
        syncScope: 'SCORES_ONLY',
        providerId: 'contract-provider',
        externalId: `contract-cs8-${stamp}`,
      });

      // --- unlinkEventScoreSource (200) -----------------------------------------
      const unlinkRes = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/events/${eventId}/score-source`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(unlinkRes.statusCode).toBe(200);
      expect(SportEventResponseSchema.safeParse(unlinkRes.json()).success).toBe(true);
      expect(unlinkRes.json().event.syncScope).toBe('NONE');
      expect(unlinkRes.json().event.providerId).toBe('manual-admin');
    } finally {
      const prisma = getPrisma();
      if (created.eventIds.length) {
        await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEventTier.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEvent.deleteMany({ where: { id: { in: created.eventIds } } });
      }
      if (created.sportLeagueId) {
        await prisma.sportLeague.updateMany({
          where: { id: created.sportLeagueId },
          data: { currentSeasonId: null },
        });
        await prisma.leagueEvent.deleteMany({ where: { sportLeagueId: created.sportLeagueId } });
      }
      if (created.seasonId || created.sportLeagueId) {
        await prisma.season.deleteMany({
          where: created.sportLeagueId ? { sportLeagueId: created.sportLeagueId } : { id: created.seasonId },
        });
      }
      if (created.sportLeagueId) {
        await prisma.sportLeague.deleteMany({ where: { id: created.sportLeagueId } });
      }
      await app.close();
    }
  });
});
