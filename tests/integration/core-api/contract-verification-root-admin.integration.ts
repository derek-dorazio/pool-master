import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  AdminResetUserPasswordResponseSchema,
  AdminProviderEventCleanupResponseSchema,
  AdminContestConfigTemplateResponseSchema,
  ContestConfigTemplateListResponseSchema,
  IngestionScheduleConfigSchema,
  AdminTeamListResponseSchema,
  AdminCloneGolfSeasonResponseSchema,
  AdminGolfLeagueDtoSchema,
  AdminGolfLeagueListResponseSchema,
  AdminGolfPlayerDetailResponseSchema,
  AdminGolfPlayerListResponseSchema,
  AdminGolfSeasonDtoSchema,
  AdminGolfSeasonListResponseSchema,
  AdminGolfTournamentDetailResponseSchema,
  AdminGolfTournamentFieldResponseSchema,
  AdminGolfTournamentListResponseSchema,
  AdminGolfTournamentRoundsResponseSchema,
  AdminGolfTournamentTiersResponseSchema,
  AdminSetCurrentGolfSeasonResponseSchema,
  LeagueListResponseSchema,
  LeagueResponseSchema,
  PollIntervalConfigSchema,
  ProviderHealthCheckDtoSchema,
  ProviderIngestionJobDtoSchema,
  ProviderListResponseSchema,
  ProviderManualSyncSubmissionResponseSchema,
  ProviderSyncRunListResponseSchema,
  SuccessSchema,
  UserDetailResponseSchema,
  UserListResponseSchema,
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

async function buildOperationalAdminApp(): Promise<FastifyInstance> {
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
    expect(detailRes.json().viewerAuthority).toEqual({
      self: true,
      rootAdmin: true,
      viewer: false,
    });

    const setRootAdminRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${targetUser.user.id}/root-admin`,
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
      url: `/api/v1/admin/users/${targetUser.user.id}/reset-password`,
      headers: rootAdmin.headers,
      payload: {
        reason: 'Contract verification',
      },
    });
    expect(resetPasswordRes.statusCode).toBe(200);
    expect(AdminResetUserPasswordResponseSchema.safeParse(resetPasswordRes.json()).success).toBe(true);
    expect(typeof resetPasswordRes.json().temporaryPassword).toBe('string');

    await getPrisma().user.update({
      where: { id: targetUser.user.id },
      data: { isActive: false },
    });

    const deleteUserRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/admin/users/${targetUser.user.id}`,
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
        createdBy: rootAdmin.user.id,
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
      url: '/api/v1/admin/leagues?search=Lifecycle',
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(LeagueListResponseSchema.safeParse(listRes.json()).success).toBe(true);
    expect(listRes.json().leagues.some((item: { id: string }) => item.id === league.id)).toBe(true);

    const inactivateRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/admin/leagues/${league.id}/inactivate`,
      headers: withoutJsonBodyHeaders(rootAdmin.headers),
    });
    expect(inactivateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);
    expect(inactivateRes.json().league.id).toBe(league.id);
    expect(inactivateRes.json().league.isActive).toBe(false);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/admin/leagues/${league.id}`,
      headers: rootAdmin.headers,
      payload: {
        leagueCode: 'ADMINLIFE1',
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json().success).toBe(true);
    expect(await getPrisma().league.findUnique({ where: { id: league.id } })).toBeNull();
  });

  it('root-admin team search routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Team Contract User',
      isRootAdmin: true,
    });
    const commissioner = await createTestUser({
      displayName: 'Root Admin Team Commissioner',
    });

    const league = await getPrisma().league.create({
      data: {
        leagueCode: 'ADMINTEAM1',
        name: 'Root Admin Team Contract League',
        description: 'Managed through contract verification.',
        createdBy: commissioner.user.id,
        isActive: true,
        iconKey: 'TROPHY',
        joinPolicy: 'COMMISSIONER_ONLY',
      },
    });
    await getPrisma().leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: commissioner.user.id,
        role: 'COMMISSIONER',
        status: 'ACTIVE',
      },
    });
    const squad = await getPrisma().squad.create({
      data: {
        leagueId: league.id,
        createdBy: commissioner.user.id,
        name: 'Contract Tigers',
        iconKey: 'CAPTAIN_SMILE_FIELD',
        isActive: true,
      },
    });
    await getPrisma().squadMembership.create({
      data: {
        squadId: squad.id,
        leagueId: league.id,
        userId: commissioner.user.id,
        status: 'ACTIVE',
      },
    });

    const listRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/admin/teams?search=Contract&leagueCode=${league.leagueCode}&isActive=true`,
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(AdminTeamListResponseSchema.safeParse(listRes.json()).success).toBe(true);
    expect(listRes.json().teams.some((item: { id: string }) => item.id === squad.id)).toBe(true);
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
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
      headers: rootAdmin.headers,
    });
    expect(userRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(userRes.json()).success).toBe(true);
    expect(userRes.json().error.code).toBe('USER_NOT_FOUND');

    const missingRoleChangeRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/root-admin',
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
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000/reset-password',
      headers: rootAdmin.headers,
      payload: {},
    });
    expect(missingResetPasswordRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingResetPasswordRes.json()).success).toBe(true);
    expect(missingResetPasswordRes.json().error.code).toBe('USER_NOT_FOUND');

    const missingDeleteUserRes = await getApp().inject({
      method: 'DELETE',
      url: '/api/v1/admin/users/00000000-0000-0000-0000-000000000000',
      headers: rootAdmin.headers,
      payload: {
        email: 'missing@example.com',
      },
    });
    expect(missingDeleteUserRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingDeleteUserRes.json()).success).toBe(true);
    expect(missingDeleteUserRes.json().error.code).toBe('USER_NOT_FOUND');

    const selfRoleChangeRes = await getApp().inject({
      method: 'POST',
      url: `/api/v1/admin/users/${rootAdmin.user.id}/root-admin`,
      headers: rootAdmin.headers,
      payload: {
        isRootAdmin: false,
      },
    });
    expect(selfRoleChangeRes.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.safeParse(selfRoleChangeRes.json()).success).toBe(true);
    expect(selfRoleChangeRes.json().error.code).toBe('SELF_ROOT_ADMIN_CHANGE');

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
        url: '/api/v1/admin/leagues/00000000-0000-0000-0000-000000000000/inactivate',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(inactivateMissingLeagueRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(inactivateMissingLeagueRes.json()).success).toBe(true);
      expect(inactivateMissingLeagueRes.json().error.code).toBe('LEAGUE_NOT_FOUND');

      const deleteMissingLeagueRes = await getApp().inject({
        method: 'DELETE',
        url: '/api/v1/admin/leagues/00000000-0000-0000-0000-000000000000',
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

  it('pool-master-z3l: root-admin golf tournament-admin routes match their DTOs on happy paths', async () => {
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
      // --- adminCreateGolfLeague (201: { league }) --------------------------
      const leagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/admin/sports/golf/leagues',
        headers: rootAdmin.headers,
        payload: { name: `Z3L Contract Tour ${stamp}`, matchKeyword: `Z3L${stamp}` },
      });
      expect(leagueRes.statusCode).toBe(201);
      expect(AdminGolfLeagueDtoSchema.safeParse(leagueRes.json().league).success).toBe(true);
      const leagueId = leagueRes.json().league.id as string;
      created.sportLeagueId = leagueId;

      // --- adminListGolfLeagues (200) -------------------------------------
      const leagueListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/leagues?search=Z3L+Contract+Tour+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(leagueListRes.statusCode).toBe(200);
      expect(AdminGolfLeagueListResponseSchema.safeParse(leagueListRes.json()).success).toBe(true);
      expect(
        leagueListRes.json().leagues.some((l: { id: string }) => l.id === leagueId),
      ).toBe(true);

      // --- adminCreateGolfSeason (201: { season }) ------------------------
      const seasonRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/admin/sports/golf/seasons',
        headers: rootAdmin.headers,
        payload: {
          sportLeagueId: leagueId,
          name: `Z3L Contract Season ${stamp} 2081`,
          year: 2081,
          startDate: '2081-01-05T00:00:00.000Z',
          endDate: '2081-11-30T00:00:00.000Z',
        },
      });
      expect(seasonRes.statusCode).toBe(201);
      expect(AdminGolfSeasonDtoSchema.safeParse(seasonRes.json().season).success).toBe(true);
      const seasonId = seasonRes.json().season.id as string;
      created.seasonIds.push(seasonId);

      // --- adminListGolfSeasons (200) -----------------------------------
      const seasonListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/seasons?sportLeagueId=${leagueId}`,
        headers: rootAdmin.headers,
      });
      expect(seasonListRes.statusCode).toBe(200);
      expect(AdminGolfSeasonListResponseSchema.safeParse(seasonListRes.json()).success).toBe(true);

      // --- adminGetGolfSeason (200: { season }) ------------------------
      const seasonDetailRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/seasons/${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(seasonDetailRes.statusCode).toBe(200);
      expect(seasonDetailRes.json().season.isCurrent).toBe(false);

      // --- adminCreateGolfPlayer (201) x3 -----------------------------
      for (let i = 0; i < 3; i += 1) {
        const playerRes = await getApp().inject({
          method: 'POST',
          url: '/api/v1/admin/sports/golf/players',
          headers: rootAdmin.headers,
          payload: {
            name: `Z3L Contract Golfer ${stamp}-${i}`,
            shortName: `Z${stamp}${i}`,
            nationality: 'USA',
            externalId: `z3l-contract-${stamp}-p${i}`,
          },
        });
        expect(playerRes.statusCode).toBe(201);
        if (i === 0) {
          expect(AdminGolfPlayerDetailResponseSchema.safeParse(playerRes.json()).success).toBe(true);
        }
        created.participantIds.push(playerRes.json().player.id as string);
      }

      // --- adminListGolfPlayers (200) --------------------------------
      const playerListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/players?search=Z3L+Contract+Golfer+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(playerListRes.statusCode).toBe(200);
      expect(AdminGolfPlayerListResponseSchema.safeParse(playerListRes.json()).success).toBe(true);

      // --- adminCreateGolfTournament (201: detail) ------------------
      const tournamentRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/admin/sports/golf/tournaments',
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
      expect(AdminGolfTournamentDetailResponseSchema.safeParse(tournamentRes.json()).success).toBe(true);
      const eventId = tournamentRes.json().tournament.id as string;
      created.eventIds.push(eventId);

      // pool-master-54u — the create response's counts must reflect the default
      // tiers/rounds seeded in the same request (not the pre-seed zero snapshot)
      // and must match what a subsequent GET returns.
      expect(tournamentRes.json().tournament.tierCount).toBe(6);
      expect(tournamentRes.json().tournament.fieldCount).toBe(0);
      const tournamentGetRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments/${eventId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentGetRes.statusCode).toBe(200);
      expect(tournamentGetRes.json().tournament.tierCount).toBe(
        tournamentRes.json().tournament.tierCount,
      );
      expect(tournamentGetRes.json().tournament.fieldCount).toBe(
        tournamentRes.json().tournament.fieldCount,
      );

      // --- adminListGolfTournaments (200) -------------------------
      const tournamentListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments?seasonId=${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentListRes.statusCode).toBe(200);
      expect(AdminGolfTournamentListResponseSchema.safeParse(tournamentListRes.json()).success).toBe(true);

      // --- adminGetGolfTournamentField / Tiers / Rounds (200) ----
      const fieldRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments/${eventId}/field`,
        headers: rootAdmin.headers,
      });
      expect(fieldRes.statusCode).toBe(200);
      expect(AdminGolfTournamentFieldResponseSchema.safeParse(fieldRes.json()).success).toBe(true);

      const tiersRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments/${eventId}/tiers`,
        headers: rootAdmin.headers,
      });
      expect(tiersRes.statusCode).toBe(200);
      expect(AdminGolfTournamentTiersResponseSchema.safeParse(tiersRes.json()).success).toBe(true);
      expect(tiersRes.json().tiers).toHaveLength(6);

      const roundsRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments/${eventId}/rounds`,
        headers: rootAdmin.headers,
      });
      expect(roundsRes.statusCode).toBe(200);
      expect(AdminGolfTournamentRoundsResponseSchema.safeParse(roundsRes.json()).success).toBe(true);
      expect(roundsRes.json().rounds).toHaveLength(4);

      // --- adminSetCurrentGolfSeason (200) ---------------------
      const setCurrentRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/admin/sports/golf/seasons/${seasonId}/set-current`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(setCurrentRes.statusCode).toBe(200);
      expect(AdminSetCurrentGolfSeasonResponseSchema.safeParse(setCurrentRes.json()).success).toBe(true);

      // --- adminCloneGolfSeason (201) — the operation this branch adds ---
      const cloneRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/admin/sports/golf/seasons/${seasonId}/clone`,
        headers: rootAdmin.headers,
        payload: {},
      });
      expect(cloneRes.statusCode).toBe(201);
      expect(AdminCloneGolfSeasonResponseSchema.safeParse(cloneRes.json()).success).toBe(true);
      expect(cloneRes.json().tournamentsCloned).toBe(1);
      expect(cloneRes.json().season.year).toBe(2082);
      expect(cloneRes.json().season.isCurrent).toBe(false);
      const clonedSeasonId = cloneRes.json().season.id as string;
      created.seasonIds.push(clonedSeasonId);

      // Source season's current flag is unchanged by the clone (§4.2a).
      const sourceAfterRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/seasons/${seasonId}`,
        headers: rootAdmin.headers,
      });
      expect(sourceAfterRes.json().season.isCurrent).toBe(true);

      // Capture the cloned tournament id for teardown.
      const clonedListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/admin/sports/golf/tournaments?seasonId=${clonedSeasonId}`,
        headers: rootAdmin.headers,
      });
      for (const t of clonedListRes.json().tournaments as Array<{ id: string }>) {
        created.eventIds.push(t.id);
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
          await prisma.sportEventParticipantGolfRound.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipantGolfStanding.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipantGolfValuation.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipant.deleteMany({ where: { id: { in: sepIds } } });
        }
        await prisma.sportEventGolfTier.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
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
});
