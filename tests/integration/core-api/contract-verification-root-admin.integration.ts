import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { testDomainEvents } from '../../support/domain-events';
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { FASTIFY_AJV_OPTIONS } from '../../../packages/core-api/src/plugins/string-transforms';
import type { FastifyInstance } from 'fastify';
import {
  UserResetPasswordResponseSchema,
  ContestConfigTemplateResponseSchema,
  ContestConfigTemplateListResponseSchema,
  IngestionScheduleConfigSchema,
  ProviderCatalogEventListResponseSchema,
  CustomerLeagueListResponseSchema,
  LeagueResponseSchema,
  ProviderLeagueResponseSchema,
  ProviderListResponseSchema,
  ProviderSettingsResponseSchema,
  ProviderManualSyncSubmissionResponseSchema,
  ProviderSyncRunDetailDtoSchema,
  ProviderSyncRunListResponseSchema,
  ParticipantProviderMappingResponseSchema,
  SuccessResponseSchema,
  UserResponseSchema,
  ParticipantListResponseSchema,
  ParticipantResponseSchema,
  SportEventListResponseSchema,
  SportEventParticipantListResponseSchema,
  SportEventParticipantUploadPreviewResponseSchema,
  RaceResultPreviewResponseSchema,
  SportEventResponseSchema,
  SportLeagueSeasonListResponseSchema,
  ActivityJobResponseSchema,
  ActivityListResponseSchema,
  SportEventRoundListResponseSchema,
  SportEventTierListResponseSchema,
  SportLeagueListResponseSchema,
  SportLeagueRankingUploadPreviewResponseSchema,
  SportLeagueOverviewListResponseSchema,
  SportLeagueSyncListResponseSchema,
  SportLeagueEventOverviewListResponseSchema,
  SportLeagueParticipantOverviewListResponseSchema,
  SportLeagueStructureResponseSchema,
  SportLeagueResponseSchema,
  SportListResponseSchema,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateListResponse,
  ContestConfigTemplateResponse,
  ErrorEnvelope,
  IngestionScheduleConfig,
  LeagueResponse,
  ParticipantListResponse,
  ParticipantProviderMappingResponse,
  ProviderCatalogEventListResponse,
  ProviderListResponse,
  ProviderManualSyncSubmissionResponse,
  ProviderSyncRunDetailDto,
  ProviderSyncRunListResponse,
  SportEventListResponse,
  SportEventResponse,
  SportEventRoundListResponse,
  SportEventTierListResponse,
  SportLeagueListResponse,
  SportLeagueResponse,
  SuccessResponse,
  UserResetPasswordResponse,
  UserResponse,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { standardEventPricing } from '../../support/budget-pricing';
import { ingestionModule } from '../../../packages/core-api/src/modules/ingestion/routes';
import { participantsModule } from '../../../packages/core-api/src/modules/participants/routes';
import { eventsModule } from '../../../packages/core-api/src/modules/events/routes';
import { IngestionService } from '../../../packages/core-api/src/modules/ingestion/ingestion-service';
import { globalErrorHandler } from '../../../packages/core-api/src/core/error-handler';
import { authGuard } from '../../../packages/core-api/src/plugins/auth-guard';
import {
  PrismaBackgroundJobRepository,
  PrismaProviderSyncRunRepository,
  PrismaSportEventRepository,
  PrismaSportLeagueRepository,
  PrismaSportRepository,
} from '../../../packages/core-api/src/adapters';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import { EventScoreSourceService } from '../../../packages/core-api/src/modules/events/event-score-source-service';
import { activityModule } from '../../../packages/core-api/src/modules/activity/routes';
import { ActivityService } from '../../../packages/core-api/src/modules/activity/activity-service';
import { ProviderRegistry } from '../../../packages/core-api/src/modules/ingestion/core/provider-registry';
import { IngestionScheduler } from '../../../packages/core-api/src/modules/ingestion/core/ingestion-scheduler';
import { emptySyncWriteDiagnostics } from '../../../packages/core-api/src/modules/ingestion/core/sync-write-diagnostics';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getAppPrisma,
  getPrisma,
  integrationBackgroundJobs,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders, integrationSportEventServices, integrationEventLifecycle, integrationProviderSettings, integrationSyncFindings } from '../helpers';
import type {
  ProviderParticipant,
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { freshEventEdition, withCurrentSeason } from '../../support/event-edition';
import type { z } from 'zod';
import { expectDefined } from '../../support/expect-defined';
import { RecordingLeaderboardRebuilds } from '../../support/recording-leaderboard-rebuilds';
import { RecordingCdnInvalidator } from '../../support/recording-cdn-invalidator';
import { participantLeagueId } from '../../support/participant-league';
import { leagueProfiles } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { Sport } from '@poolmaster/shared/domain';
import { sportPlay } from '../../support/sport-play';

// The shared package exports the participant response schema but not its inferred type.
type ParticipantResponse = z.infer<typeof ParticipantResponseSchema>;

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
  providerId = 'balldontlie';
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

  async getLiveScores(): Promise<LiveScoreResult> {
    return { category: 'GOLF', externalEventId: 'unused', rounds: [] };
  }
}

class EmptyDiagnosticsProvider extends OperationalContractProvider implements ProviderPayloadDiagnostics {
  override providerId = 'balldontlie';
  override providerName = 'Empty Diagnostics Provider';
  private payloads: ProviderPayloadCapture[] = [];

  clearProviderPayloads(): void {
    this.payloads = [];
  }

  consumeProviderPayloads(): ProviderPayloadCapture[] {
    const payloads = this.payloads;
    this.payloads = [];
    return payloads;
  }

  override async getLiveScores(): Promise<LiveScoreResult> {
    this.payloads.push({
      operation: 'test.scores',
      path: '/test/scores',
      capturedAt: '2026-04-05T12:00:00.000Z',
      raw: {
        contestants: [],
      },
    });
    return { category: 'GOLF', externalEventId: 'empty-diagnostics-event', rounds: [] };
  }
}

/**
 * An app carrying the ingestion module (and the participants module, whose provider-mapping
 * bind names a registered provider) over a registry holding one contract provider, so the
 * operations run against a provider the test controls. The auth guard is registered as the
 * application registers it: the sync handlers read the signed-in root admin from it.
 */
/** A contract provider whose slate carries a tour name, as the mock's tour seeds do (#385). */
/**
 * A provider whose slate is one PGA TOUR year, under BALLDONTLIE's id so a league synced from its
 * seeded PGA TOUR row reads it (#1997); the third event is another league's.
 */
class TourSlateContractProvider extends OperationalContractProvider {
  constructor(private readonly tour: string) {
    super();
    this.providerId = SYNCED_PROVIDER_ID;
  }

  override async getUpcomingEvents(): Promise<SportEvent[]> {
    const event = (externalId: string, name: string, providerLeagueCode: string, day: string): SportEvent => ({
      externalId,
      providerId: this.providerId,
      sport: 'GOLF',
      name,
      startDate: new Date(`${day}T12:00:00.000Z`),
      endDate: new Date(`${day.slice(0, 8)}${String(Number(day.slice(8)) + 3).padStart(2, '0')}T23:00:00.000Z`),
      status: 'SCHEDULED',
      fieldLocked: false,
      providerLeagueCode,
      metadata: {},
    });
    return [
      event(`${this.tour}-alpha`, `${this.tour} Alpha Open`, 'pga', '2085-03-05'),
      event(`${this.tour}-bravo`, `${this.tour} Bravo Classic`, 'pga', '2085-04-09'),
      event(`${this.tour}-other`, `${this.tour} Other Tour Event`, 'lpga', '2085-05-07'),
    ];
  }
}

async function buildIngestionApp(provider: SportDataProvider | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  const registry = new ProviderRegistry();
  if (provider) registry.register('GOLF', provider, 'PRIMARY');
  const scheduler = new IngestionScheduler(registry, {
    onEventDetail: async () => ({ writeDiagnostics: emptySyncWriteDiagnostics() }),
    onLiveScores: async () => emptyLiveScorePersistenceResult(),
  }, undefined, {
    now: () => new Date('2026-04-05T12:00:00.000Z'),
  });
  const prisma = getPrisma();
  const backgroundJobs = integrationBackgroundJobs();
  const providerRows = await integrationProviderSettings(getAppPrisma(), registry);
  const ingestionService = new IngestionService({
    registry,
    sportEvents: new PrismaSportEventRepository(getAppPrisma()),
    syncRuns: new PrismaProviderSyncRunRepository(getAppPrisma()),
    scheduler,
    sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
    providerSettings: providerRows.store,
    webhooks: providerRows.webhooks,
    jobHistory: new PrismaBackgroundJobRepository(getAppPrisma()),
    jobs: backgroundJobs.queue,
  });
  const leagueEventsSync = new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(getAppPrisma()),
    sports: new PrismaSportRepository(getAppPrisma()),
    scoreSource: new EventScoreSourceService(getAppPrisma(), registry),
    sportEvents: integrationSportEventServices(getAppPrisma(), providerRows.providers).sportEvents,
    syncRuns: new PrismaProviderSyncRunRepository(getAppPrisma()),
    jobs: backgroundJobs.queue,
    seasons: new PrismaSportLeagueSeasonRepository(getAppPrisma()),
    findings: integrationSyncFindings(getAppPrisma(), providerRows.store),
  });
  backgroundJobs.runWith({
    MANUAL_EVENT_SYNC: (payload, context) => ingestionService.runManualEventSync(payload, context),
    SYNC_LEAGUE_EVENTS: (payload, context) => leagueEventsSync.run(payload, context),
  });

  app.decorate('prisma', prisma);
  app.setErrorHandler(globalErrorHandler);
  await app.register(authGuard);
  const activity = new ActivityService({
    jobs: new PrismaBackgroundJobRepository(prisma),
    syncRuns: new PrismaProviderSyncRunRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
  });
  await app.register(ingestionModule, {
    prefix: '/api/v1/ingestion',
    ingestionService,
    providerRegistry: registry,
    leagueEventsSync,
    activity,
    providerSettings: providerRows.settingsService,
  });
  await app.register(activityModule, { prefix: '/api/v1/activity', activity });
  await app.register(participantsModule, { prefix: '/api/v1/participants', providerRegistry: registry });
  await app.register(eventsModule, {
    prefix: '/api/v1/events',
    eventLifecycleService: integrationEventLifecycle(prisma),
    ingestionService,
    providerRegistry: registry,
    cdn: new RecordingCdnInvalidator(),
    domainEvents: testDomainEvents(),
    leaderboards: new RecordingLeaderboardRebuilds(),
    webhookProviderIds: providerRows.webhookProviderIds,
  });
  await app.ready();

  return app;
}

async function waitForProviderSyncRun(
  syncRunId: string,
): Promise<{ status: string; summary: string; stats: unknown; errorCount: number; detailsJson: unknown }> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const row = await getPrisma().providerSyncRun.findUnique({
      where: { id: syncRunId },
      select: { status: true, summary: true, stats: true, errorCount: true, detailsJson: true },
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

  it('refuses one sync run\'s details, raw provider payload included, to a non-root-admin with 403', async () => {
    const run = await getPrisma().providerSyncRun.create({
      data: {
        kind: 'SCORES',
        trigger: 'SCHEDULE',
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        sport: 'GOLF',
        status: 'COMPLETED',
        summary: 'Completed event participants sync.',
        detailsJson: { providerPayload: { operation: 'EVENTPARTICIPANTS', rawCaptured: true, rawTruncated: false, raw: [] } },
      },
    });
    const ordinaryUser = await createTestUser({ displayName: 'Contract Non Admin Sync Run Reader' });

    const forbidden = await getApp().inject({
      method: 'GET',
      url: `/api/v1/ingestion/sync-runs/${run.id}`,
      headers: ordinaryUser.headers,
    });

    expect(forbidden.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(forbidden.json()).success).toBe(true);
    expect(forbidden.json<ErrorEnvelope>().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
    expect(forbidden.body).not.toContain('providerPayload');
    await getPrisma().providerSyncRun.delete({ where: { id: run.id } });
  });

  // #1180 — no searched platform list reads every row: events take a sport, sport league or
  // year, and participants a sport or a search. Customers reads every user and league whole.
  it('refuses the platform lists a root admin asks for without a filter, with stable 400 codes', async () => {
    const rootAdmin = await createTestUser({ displayName: 'Root Admin Filter Required', isRootAdmin: true });
    const refusals: Array<{ url: string; code: string }> = [
      { url: '/api/v1/events', code: 'SPORT_EVENT_FILTER_REQUIRED' },
      { url: '/api/v1/participants', code: 'SEARCH_TERM_REQUIRED' },
      { url: '/api/v1/participants?q=ab', code: 'SEARCH_TERM_REQUIRED' },
    ];

    for (const refusal of refusals) {
      const response = await getApp().inject({ method: 'GET', url: refusal.url, headers: rootAdmin.headers });
      expect({ url: refusal.url, status: response.statusCode }).toEqual({ url: refusal.url, status: 400 });
      expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
      expect({ url: refusal.url, code: response.json<ErrorEnvelope>().error.code }).toEqual(refusal);
    }
  });

  // #1348 — the participant catalog and a sport's events across every year are the root admin's
  // reads. A league lists only events that can still take a contest, or one Season's (#2003).
  it('refuses the catalog lists to a non-root-admin with 403 and answers only the bounded event lists', async () => {
    const member = await createTestUser({ displayName: 'Contract Non Admin Catalog Reader' });
    const sportLeagueId = randomUUID();
    const refused = [
      `/api/v1/participants?sportLeagueId=${sportLeagueId}`,
      '/api/v1/participants?q=scheffler',
      `/api/v1/participants/${randomUUID()}/provider-mappings`,
      '/api/v1/events?sport=GOLF',
      '/api/v1/events?sport=GOLF&status=SCHEDULED&status=COMPLETED',
      `/api/v1/events?sportLeagueId=${sportLeagueId}`,
    ];
    for (const url of refused) {
      const response = await getApp().inject({ method: 'GET', url, headers: member.headers });
      expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
      expect({ url, status: response.statusCode, code: response.json<ErrorEnvelope>().error.code })
        .toEqual({ url, status: 403, code: 'ROOT_ADMIN_ACCESS_REQUIRED' });
    }

    // The same event lists stay open to a root admin: the catalog screens ask for them.
    const rootAdmin = await createTestUser({ displayName: 'Contract Root Admin Catalog Reader', isRootAdmin: true });
    for (const url of refused.filter((refusedUrl) => refusedUrl.startsWith('/api/v1/events'))) {
      const response = await getApp().inject({ method: 'GET', url, headers: rootAdmin.headers });
      expect({ url, status: response.statusCode }).toEqual({ url, status: 200 });
      expect(SportEventListResponseSchema.safeParse(response.json()).success).toBe(true);
    }

    const answered = [
      '/api/v1/events?sport=GOLF&status=SCHEDULED&status=POSTPONED&status=IN_PROGRESS',
      `/api/v1/events?sportLeagueSeasonId=${randomUUID()}`,
    ];
    for (const url of answered) {
      const response = await getApp().inject({ method: 'GET', url, headers: member.headers });
      expect({ url, status: response.statusCode }).toEqual({ url, status: 200 });
      expect(SportEventListResponseSchema.safeParse(response.json()).success).toBe(true);
    }
  });

  it('root-admin user reads match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Happy Path User',
      isRootAdmin: true,
    });
    const targetUser = await createTestUser({
      displayName: 'Root Admin Managed User',
    });

    // The completed run was submitted after the failed one but started before it: the list
    // orders by submission, newest first (#1174).
    const submittedAt = Date.now();
    await getPrisma().providerSyncRun.createMany({
      data: [
        {
          kind: 'SCORES',
          trigger: 'SCHEDULE',
          id: '11111111-1111-1111-1111-111111111111',
          providerId: BALLDONTLIE_TEST_PROVIDER_ID,
          sport: 'GOLF',
          status: 'COMPLETED',
          startedAt: new Date('2026-04-09T10:00:00.000Z'),
          completedAt: new Date('2026-04-09T10:01:00.000Z'),
          createdAt: new Date(submittedAt - 60_000),
          summary: 'Initial event and field import',
          stats: { recordsProcessed: 42 },
          changedCount: 1,
          detailsJson: {
            jobPayload: {
              jobType: 'EVENT_PARTICIPANTS_SYNC', providerId: 'balldontlie', sport: 'GOLF',
              status: 'COMPLETED', recordsProcessed: 42, errors: 0, errorLog: [],
            },
            writeDiagnostics: {
              summary: { total: 42, unchanged: 41, created: 1, updated: 0, deleted: 0 },
              rows: [{ id: 'row-1', entityType: 'SportEventParticipant', disposition: 'CREATED' }],
            },
          },
        },
        {
          kind: 'SCORES',
          trigger: 'SCHEDULE',
          id: '22222222-2222-2222-2222-222222222222',
          providerId: BALLDONTLIE_TEST_PROVIDER_ID,
          sport: 'GOLF',
          status: 'FAILED',
          startedAt: new Date('2026-04-10T10:00:00.000Z'),
          completedAt: new Date('2026-04-10T10:00:30.000Z'),
          createdAt: new Date(submittedAt - 120_000),
          summary: 'Transient provider timeout',
          errorCount: 1,
        },
      ],
    });

    const detailRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/users/${rootAdmin.user.id}`,
      headers: rootAdmin.headers,
    });
    expect(detailRes.statusCode).toBe(200);
    expect(UserResponseSchema.safeParse(detailRes.json()).success).toBe(true);
    // #202 step 3.4 — `{ user }`, and no `viewerAuthority` block (A8). Of its three flags two
    // were constants on a root-admin-only route, and `self` is `user.id === me.id`.
    expect(detailRes.json<UserResponse>().user.id).toBe(rootAdmin.user.id);
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
    expect(SuccessResponseSchema.safeParse(setRootAdminRes.json()).success).toBe(true);

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
    expect(typeof resetPasswordRes.json<UserResetPasswordResponse>().temporaryPassword).toBe('string');

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
    expect(SuccessResponseSchema.safeParse(deleteUserRes.json()).success).toBe(true);
    expect(await getPrisma().user.findUnique({ where: { id: targetUser.user.id } })).toBeNull();

    const syncRunsRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/ingestion/sync-runs?providerId=${BALLDONTLIE_TEST_PROVIDER_ID}&sport=GOLF`,
      headers: rootAdmin.headers,
    });
    expect(syncRunsRes.statusCode).toBe(200);
    expect(ProviderSyncRunListResponseSchema.safeParse(syncRunsRes.json()).success).toBe(true);
    // #205 — both rows were submitted just now, inside the default 6-hour window.
    expect(syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns).toHaveLength(2);
    expect(syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns[0]).toMatchObject({ providerId: BALLDONTLIE_TEST_PROVIDER_ID, providerName: 'BALLDONTLIE' });
    expect(syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns[0]).toMatchObject({ summary: 'Initial event and field import', stats: { recordsProcessed: 42 }, changedCount: 1, errorCount: 0 });
    expect(syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns.map((run) => run.id)).toEqual([
      '11111111-1111-1111-1111-111111111111',
      '22222222-2222-2222-2222-222222222222',
    ]);
    // The list carries each run's summary only; its detailed diagnostics are read one run at a time.
    for (const run of syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns) {
      expect(run).not.toHaveProperty('details');
    }

    const syncRunRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/ingestion/sync-runs/11111111-1111-1111-1111-111111111111',
      headers: rootAdmin.headers,
    });
    expect(syncRunRes.statusCode).toBe(200);
    expect(ProviderSyncRunDetailDtoSchema.safeParse(syncRunRes.json()).success).toBe(true);
    expect(syncRunRes.json<ProviderSyncRunDetailDto>()).toMatchObject({
      id: '11111111-1111-1111-1111-111111111111',
      summary: 'Initial event and field import',
      details: {
        jobPayload: { recordsProcessed: 42 },
        writeDiagnostics: { summary: { total: 42, created: 1 }, rows: [{ id: 'row-1', disposition: 'CREATED' }] },
      },
    });

    const noDetailsRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/ingestion/sync-runs/22222222-2222-2222-2222-222222222222',
      headers: rootAdmin.headers,
    });
    expect(noDetailsRes.statusCode).toBe(200);
    expect(ProviderSyncRunDetailDtoSchema.safeParse(noDetailsRes.json()).success).toBe(true);
    expect(noDetailsRes.json<ProviderSyncRunDetailDto>().details).toBeNull();

    const missingRunRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/ingestion/sync-runs/ffffffff-ffff-4fff-8fff-ffffffffffff',
      headers: rootAdmin.headers,
    });
    expect(missingRunRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingRunRes.json()).success).toBe(true);
    expect(missingRunRes.json<ErrorEnvelope>().error.code).toBe('SYNC_RUN_NOT_FOUND');

    // A window that ends before they were submitted excludes them.
    const earlierRes = await getApp().inject({
      method: 'GET',
      url: `/api/v1/ingestion/sync-runs?providerId=${BALLDONTLIE_TEST_PROVIDER_ID}&sport=GOLF&from=2020-01-01T00:00:00.000Z&to=2020-01-02T00:00:00.000Z`,
      headers: rootAdmin.headers,
    });
    expect(earlierRes.statusCode).toBe(200);
    expect(earlierRes.json<ProviderSyncRunListResponse>().syncRuns).toEqual([]);
  });

  it('root-admin platform-config and contest-template routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Config Contract User',
      isRootAdmin: true,
    });

    const ingestionReadRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/platform/ingestion-schedule',
      headers: rootAdmin.headers,
    });
    expect(ingestionReadRes.statusCode).toBe(200);
    expect(IngestionScheduleConfigSchema.safeParse(ingestionReadRes.json()).success).toBe(true);
    // One schedule for every sport a running provider covers (#1997): the policies, with no sports list.
    expect(ingestionReadRes.json<IngestionScheduleConfig>()).not.toHaveProperty('scheduledSports');

    const ingestionUpdateRes = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/platform/ingestion-schedule',
      headers: rootAdmin.headers,
      payload: {
        SCORES: {
          intervalSeconds: 45,
        },
      },
    });
    expect(ingestionUpdateRes.statusCode).toBe(200);
    expect(IngestionScheduleConfigSchema.safeParse(ingestionUpdateRes.json()).success).toBe(true);
    expect(ingestionUpdateRes.json<IngestionScheduleConfig>().SCORES.intervalSeconds).toBe(45);

    const templateListRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/contest-config-templates/?sport=GOLF',
      headers: rootAdmin.headers,
    });
    expect(templateListRes.statusCode).toBe(200);
    expect(ContestConfigTemplateListResponseSchema.safeParse(templateListRes.json()).success).toBe(true);
    const template = expectDefined(templateListRes.json<ContestConfigTemplateListResponse>().templates.at(0), 'a contest template');
    const templateId = template.id;

    // #248 — the write left /api/v1/admin and the admin-auth plugin, and stays root-admin only.
    const member = await createTestUser({ displayName: 'Template Write Non Admin' });
    const forbiddenRes = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/contest-config-templates/${templateId}`,
      headers: member.headers,
      payload: { description: 'Must not land.' },
    });
    expect(forbiddenRes.statusCode).toBe(403);
    expect(forbiddenRes.json<ErrorEnvelope>().error.code).toBe('ROOT_ADMIN_ACCESS_REQUIRED');

    try {
      const templateUpdateRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/contest-config-templates/${templateId}`,
        headers: rootAdmin.headers,
        payload: {
          description: 'Updated through contract verification.',
        },
      });
      expect(templateUpdateRes.statusCode).toBe(200);
      expect(ContestConfigTemplateResponseSchema.safeParse(templateUpdateRes.json()).success).toBe(true);
      expect(templateUpdateRes.json<ContestConfigTemplateResponse>().template.description).toBe('Updated through contract verification.');
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
        cupName: 'Test Cup', leagueCode: 'ADMINLIFE1',
        name: 'Root Admin Lifecycle League',
        description: 'Managed through contract verification.',
        isActive: true,
        iconKey: 'TROPHY',
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
      // Customers is the root admin's read of every league (#1896).
      url: '/api/v1/customers/leagues',
      headers: rootAdmin.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(CustomerLeagueListResponseSchema.parse(listRes.json()).leagues.some((item) => item.id === league.id)).toBe(true);

    const inactivateRes = await getApp().inject({
      method: 'POST',
      // The league routes always served root admins — `requireCommissioner` grants them — so
      // the `/admin/leagues/*` duplicates are gone and these are the same operations.
      url: `/api/v1/leagues/${league.id}/inactivate`,
      headers: withoutJsonBodyHeaders(rootAdmin.headers),
    });
    expect(inactivateRes.statusCode).toBe(200);
    expect(LeagueResponseSchema.safeParse(inactivateRes.json()).success).toBe(true);
    expect(inactivateRes.json<LeagueResponse>().league.id).toBe(league.id);
    expect(inactivateRes.json<LeagueResponse>().league.isActive).toBe(false);

    const deleteRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/leagues/${league.id}`,
      headers: rootAdmin.headers,
      payload: {
        leagueCode: 'ADMINLIFE1',
      },
    });
    expect(deleteRes.statusCode).toBe(200);
    expect(deleteRes.json<SuccessResponse>().success).toBe(true);
    expect(await getPrisma().league.findUnique({ where: { id: league.id } })).toBeNull();
  });


  it('pool-master-rop.68.1.2 root-admin provider operational routes match their DTOs on happy paths', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Provider Ops User',
      isRootAdmin: true,
    });

    const contractEvent = await getPrisma().sportEvent.upsert({
      where: {
        providerId_externalId: {
          providerId: 'balldontlie',
          externalId: 'event-1',
        },
      },
      create: {
        ...(await freshEventEdition(getPrisma())),
        externalId: 'event-1',
        providerId: 'balldontlie',
        sport: 'GOLF',
        name: 'Contract Masters',
        venue: 'Contract National',
        location: 'Augusta, GA',
        startDate: new Date('2026-04-10T15:00:00.000Z'),
        endDate: new Date('2026-04-14T21:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
        participantCount: 2,
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
        metadata: {},
      },
    });

    await getPrisma().providerSyncRun.upsert({
      where: {
        id: '33333333-3333-3333-3333-333333333333',
      },
      create: {
        kind: 'SCORES',
        trigger: 'SCHEDULE',
        id: '33333333-3333-3333-3333-333333333333',
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        sport: 'GOLF',
        sportEventId: contractEvent.id,
        status: 'COMPLETED',
        startedAt: new Date('2026-04-09T10:00:00.000Z'),
        completedAt: new Date('2026-04-09T10:02:00.000Z'),
        summary: 'Imported event and participant field.',
        stats: { recordsProcessed: 12 },
      },
      update: {
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        sport: 'GOLF',
        sportEventId: contractEvent.id,
        status: 'COMPLETED',
        startedAt: new Date('2026-04-09T10:00:00.000Z'),
        completedAt: new Date('2026-04-09T10:02:00.000Z'),
        summary: 'Imported event and participant field.',
        stats: { recordsProcessed: 12 },
      },
    });
    await getPrisma().providerSyncRun.deleteMany({
      where: {
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        id: {
          not: '33333333-3333-3333-3333-333333333333',
        },
      },
    });

    const app = await buildIngestionApp(new OperationalContractProvider());

    try {
      const providersRes = await app.inject({
        method: 'GET',
        url: '/api/v1/ingestion/providers',
        headers: rootAdmin.headers,
      });
      expect(providersRes.statusCode).toBe(200);
      expect(ProviderListResponseSchema.safeParse(providersRes.json()).success).toBe(true);
      // BALLDONTLIE's row lists too, not running here (#1997): the registered provider is found by its id.
      expect(providersRes.json<ProviderListResponse>().providers.find((summary) => summary.providerId === 'balldontlie')).toMatchObject({
        providerId: 'balldontlie',
        status: 'HEALTHY',
        activeEventCount: 1,
        // requestsPerMinute and webhooksEnabled are the BALLDONTLIE Provider row's (#1997), checked where it is.
        syncedSportLeagueCount: 0,
        rateLimitedJobsLast24h: 0,
      });

      const syncRunsRes = await app.inject({
        method: 'GET',
        url: `/api/v1/ingestion/sync-runs?providerId=${BALLDONTLIE_TEST_PROVIDER_ID}&sport=GOLF&status=COMPLETED`,
        headers: rootAdmin.headers,
      });
      expect(syncRunsRes.statusCode).toBe(200);
      expect(ProviderSyncRunListResponseSchema.safeParse(syncRunsRes.json()).success).toBe(true);
      expect(syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns.length).toBeGreaterThanOrEqual(1);
      expect(
        syncRunsRes.json<ProviderSyncRunListResponse>().syncRuns.some(
          (item) =>
            item.eventId === 'event-1'
            && item.summary === 'Imported event and participant field.',
        ),
      ).toBe(true);

      const eventSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/sports/GOLF/events/contract-sync-event/sync',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: {
          providerId: 'balldontlie',
          feeds: ['EVENTLIVESCORES'],
        },
      });
      expect(eventSyncRes.statusCode).toBe(202);
      expect(ProviderManualSyncSubmissionResponseSchema.safeParse(eventSyncRes.json()).success).toBe(true);
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().sport).toBe('GOLF');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().eventId).toBe('contract-sync-event');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().requestedFeeds).toEqual(['EVENTLIVESCORES']);
      expect(typeof eventSyncRes.json<ProviderManualSyncSubmissionResponse>().submittedAt).toBe('string');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns.length).toBeGreaterThanOrEqual(1);
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns[0]?.status).toBe('SUBMITTED');
      await waitForProviderSyncRun(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns[0]?.id);

      // #125 / #126 — PARTICIPANTRANKINGS, EVENTSCHEDULE and EVENTRESULTS are retired, not
      // demoted: the event sync contract refuses each of them.
      for (const retiredFeed of ['PARTICIPANTRANKINGS', 'EVENTSCHEDULE', 'EVENTRESULTS']) {
        const retiredFeedRes = await app.inject({
          method: 'POST',
          url: '/api/v1/ingestion/sports/GOLF/events/contract-sync-event/sync',
          headers: withoutJsonBodyHeaders(rootAdmin.headers),
          payload: {
            providerId: 'balldontlie',
            feeds: [retiredFeed],
          },
        });
        expect(retiredFeedRes.statusCode).toBe(400);
      }

      // #126 — with every feed event-scoped, the sport-level sync route is gone.
      const sportSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/sports/GOLF/sync',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: {
          feeds: ['EVENTSCHEDULE'],
        },
      });
      expect(sportSyncRes.statusCode).toBe(404);

      // ADR-0009 — the stale provider event cleanup is retired with the sync that made stale events.
      const cleanupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/stale-events/cleanup',
        headers: rootAdmin.headers,
        payload: { mode: 'DRY_RUN' },
      });
      expect(cleanupRes.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });

  it('records a manual zero-data sync COMPLETED with its counts and the raw provider payload', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Sync Diagnostics Contract User',
      isRootAdmin: true,
    });
    await getPrisma().providerSyncRun.deleteMany({
      where: { providerId: BALLDONTLIE_TEST_PROVIDER_ID },
    });
    const app = await buildIngestionApp(new EmptyDiagnosticsProvider());

    try {
      const prepareSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/sports/GOLF/events/empty-diagnostics-event/sync',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: {
          providerId: 'balldontlie',
          feeds: ['EVENTLIVESCORES'],
        },
      });
      expect(prepareSyncRes.statusCode).toBe(202);
      expect(ProviderManualSyncSubmissionResponseSchema.safeParse(prepareSyncRes.json()).success).toBe(true);
      const syncRunId = prepareSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns[0]?.id;

      const completedRun = await waitForProviderSyncRun(syncRunId);
      expect(completedRun.status).toBe('COMPLETED');
      expect(completedRun.detailsJson).toEqual(
        expect.objectContaining({
          jobPayload: expect.objectContaining({
            recordsProcessed: 0,
            status: 'COMPLETED',
          }),
          providerPayload: expect.objectContaining({
            rawCaptured: true,
            raw: [
              expect.objectContaining({
                path: '/test/scores',
                raw: { contestants: [] },
              }),
            ],
          }),
          writeDiagnostics: { summary: { total: 0, unchanged: 0, created: 0, updated: 0, deleted: 0 }, rows: [] },
        }),
      );
      expect(completedRun).toMatchObject({
        errorCount: 0,
        stats: expect.objectContaining({
          providerRecordsReturned: 0,
          liveScoreUpdatesReturned: 0,
        }),
      });
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
    expect(userRes.json<ErrorEnvelope>().error.code).toBe('USER_NOT_FOUND');

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
    expect(missingRoleChangeRes.json<ErrorEnvelope>().error.code).toBe('USER_NOT_FOUND');

    const missingResetPasswordRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/00000000-0000-0000-0000-000000000000/reset-password',
      headers: rootAdmin.headers,
      payload: {},
    });
    expect(missingResetPasswordRes.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.safeParse(missingResetPasswordRes.json()).success).toBe(true);
    expect(missingResetPasswordRes.json<ErrorEnvelope>().error.code).toBe('USER_NOT_FOUND');

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
    expect(missingDeleteUserRes.json<ErrorEnvelope>().error.code).toBe('USER_NOT_FOUND');

    const app = await buildIngestionApp(new OperationalContractProvider());

    try {
      const missingProviderCatalogRes = await app.inject({
        method: 'GET',
        url: '/api/v1/ingestion/providers/missing-provider/catalog-events?sport=GOLF',
        headers: rootAdmin.headers,
      });
      expect(missingProviderCatalogRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(missingProviderCatalogRes.json()).success).toBe(true);
      expect(missingProviderCatalogRes.json<ErrorEnvelope>().error.code).toBe('PROVIDER_NOT_FOUND');

      const noProviderApp = await buildIngestionApp(null);
      try {
        const missingSportProviderRes = await noProviderApp.inject({
          method: 'POST',
          url: '/api/v1/ingestion/sports/GOLF/events/missing-300/sync',
          headers: withoutJsonBodyHeaders(rootAdmin.headers),
          payload: {
            providerId: 'balldontlie',
            feeds: ['EVENTLIVESCORES'],
          },
        });
        expect(missingSportProviderRes.statusCode).toBe(404);
        expect(ErrorEnvelopeSchema.safeParse(missingSportProviderRes.json()).success).toBe(true);
        expect(missingSportProviderRes.json<ErrorEnvelope>().error.code).toBe('SPORT_PROVIDER_NOT_FOUND');
      } finally {
        await noProviderApp.close();
      }

      const inactivateMissingLeagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/leagues/00000000-0000-0000-0000-000000000000/inactivate',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(inactivateMissingLeagueRes.statusCode).toBe(404);
      expect(ErrorEnvelopeSchema.safeParse(inactivateMissingLeagueRes.json()).success).toBe(true);
      expect(inactivateMissingLeagueRes.json<ErrorEnvelope>().error.code).toBe('LEAGUE_NOT_FOUND');

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
      expect(deleteMissingLeagueRes.json<ErrorEnvelope>().error.code).toBe('LEAGUE_NOT_FOUND');
    } finally {
      await app.close();
    }
  });

  it('binding a participant to a provider competitor answers the mapping, and an unknown provider is PROVIDER_NOT_FOUND', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Competitor Binding User',
      isRootAdmin: true,
    });
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: 'GOLF' },
      create: {
        sport: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });
    await prisma.participantProviderMapping.deleteMany({
      where: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'golfer-1' },
    });
    const participant = await prisma.participant.create({
      data: {
        sportLeagueId: await participantLeagueId(prisma, sport.id),
        name: `Avery Hart ${Date.now()}`,
        participantType: 'INDIVIDUAL',
        status: 'ACTIVE',
        injuryStatus: { status: 'HEALTHY' },
      },
    });
    const app = await buildIngestionApp(new OperationalContractProvider());

    try {
      const bindRes = await app.inject({
        method: 'POST',
        url: `/api/v1/participants/${participant.id}/provider-mappings`,
        headers: rootAdmin.headers,
        payload: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: 'golfer-1' },
      });
      expect(bindRes.statusCode).toBe(200);
      expect(ParticipantProviderMappingResponseSchema.safeParse(bindRes.json()).success).toBe(true);
      expect(bindRes.json<ParticipantProviderMappingResponse>().providerMapping).toMatchObject({
        participantId: participant.id,
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        providerName: 'BALLDONTLIE',
        participantType: 'INDIVIDUAL',
        externalId: 'golfer-1',
      });

      const unknownProviderRes = await app.inject({
        method: 'POST',
        url: `/api/v1/participants/${participant.id}/provider-mappings`,
        headers: rootAdmin.headers,
        payload: { providerId: randomUUID(), externalId: 'golfer-1' },
      });
      expect(unknownProviderRes.statusCode).toBe(404);
      expect(unknownProviderRes.json<ErrorEnvelope>().error.code).toBe('PROVIDER_NOT_FOUND');
    } finally {
      await app.close();
      await prisma.participantProviderMapping.deleteMany({ where: { participantId: participant.id } });
      await prisma.participant.delete({ where: { id: participant.id } });
    }
  });

  it('pool-master-z3l, plans/147: the sport-league, participant and event operations golf administration uses match their DTOs on happy paths', async () => {
    // plans/124 §8 — a happy-path contract case per operation this epic adds to
    // the golf admin module. Drives one coherent authoring flow (tour -> players
    // -> tournament in the current Season -> field/tiers/rounds reads -> the league's
    // Seasons) through getApp().inject() and safeParses every response against its
    // published schema. Golf admin rows are not covered by cleanupTestData(), so
    // this test tears down everything it creates child-first in a finally block.
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Golf Contract User',
      isRootAdmin: true,
    });
    const stamp = Date.now().toString().slice(-8);

    await getPrisma().sport.upsert({
      where: { sport: 'GOLF' },
      create: {
        sport: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });

    const created = {
      sportLeagueId: '',
      eventIds: [] as string[],
      participantIds: [] as string[],
    };

    try {
      // --- createSportLeague (201: { sportLeague }) ----------------------------
      const leagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/sport-leagues',
        headers: rootAdmin.headers,
        payload: { ...(await leagueProfiles(getPrisma())), ...sportPlay(Sport.GOLF), timeZone: 'UTC', sport: 'GOLF', name: `Z3L Contract Tour ${stamp}` },
      });
      expect(leagueRes.statusCode).toBe(201);
      expect(SportLeagueResponseSchema.safeParse(leagueRes.json()).success).toBe(true);
      const leagueId = leagueRes.json<SportLeagueResponse>().sportLeague.id;
      created.sportLeagueId = leagueId;
      // A migration adds a league's Seasons and the daily recompute makes one current; the test's own league stands in.
      const currentSeasonId = await withCurrentSeason(getPrisma(), leagueId, 2081);

      // --- listSportLeagues (200) --------------------------------------------
      const leagueListRes = await getApp().inject({
        method: 'GET',
        url: '/api/v1/sport-leagues?sport=GOLF',
        headers: rootAdmin.headers,
      });
      expect(leagueListRes.statusCode).toBe(200);
      expect(SportLeagueListResponseSchema.safeParse(leagueListRes.json()).success).toBe(true);
      expect(
        leagueListRes.json<SportLeagueListResponse>().sportLeagues.some((l) => l.id === leagueId),
      ).toBe(true);

      // --- listSports (200) ------------------------------------------------------
      const sportListRes = await getApp().inject({ method: 'GET', url: '/api/v1/sports', headers: rootAdmin.headers });
      expect(sportListRes.statusCode).toBe(200);
      expect(SportListResponseSchema.safeParse(sportListRes.json()).success).toBe(true);

      // --- listSportLeagueOverviews (200) — the Sports page (#1847) -----------
      const overviewRes = await getApp().inject({ method: 'GET', url: '/api/v1/sport-leagues/overview', headers: rootAdmin.headers });
      expect(overviewRes.statusCode).toBe(200);
      const overview = SportLeagueOverviewListResponseSchema.safeParse(overviewRes.json());
      expect(overview.success).toBe(true);
      expect(overview.data?.sportLeagues.some((row) => row.id === leagueId)).toBe(true);

      // --- createParticipant (201) x3 — golf players are participants of the tour (#1853) ---
      for (let i = 0; i < 3; i += 1) {
        const playerRes = await getApp().inject({
          method: 'POST',
          url: '/api/v1/participants',
          headers: rootAdmin.headers,
          payload: {
            sportLeagueId: leagueId,
            participantType: 'INDIVIDUAL',
            name: `Z3L Contract Golfer ${stamp}-${i}`,
            shortName: `Z${stamp}${i}`,
            nationality: 'USA',
          },
        });
        expect(playerRes.statusCode).toBe(201);
        if (i === 0) {
          expect(ParticipantResponseSchema.safeParse(playerRes.json()).success).toBe(true);
        }
        created.participantIds.push(playerRes.json<ParticipantResponse>().participant.id);
        // A feed id is bound as a provider mapping, never sent on the participant (#2040).
        const bindRes = await getApp().inject({
          method: 'POST',
          url: `/api/v1/participants/${playerRes.json<ParticipantResponse>().participant.id}/provider-mappings`,
          headers: rootAdmin.headers,
          payload: { providerId: BALLDONTLIE_TEST_PROVIDER_ID, externalId: `z3l-contract-${stamp}-p${i}` },
        });
        expect(bindRes.statusCode).toBe(200);
      }

      // --- listParticipants, the golf player list (200) ----------------------
      const playerListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants?sportLeagueId=${leagueId}&q=Z3L+Contract+Golfer+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(playerListRes.statusCode).toBe(200);
      expect(ParticipantListResponseSchema.safeParse(playerListRes.json()).success).toBe(true);
      expect(playerListRes.json<ParticipantListResponse>().participants).toHaveLength(3);

      // --- listSportLeagueParticipants: the tour's roster (200) -----------------
      const rosterRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/sport-leagues/${leagueId}/participants`,
        headers: rootAdmin.headers,
      });
      expect(rosterRes.statusCode).toBe(200);
      expect(ParticipantListResponseSchema.safeParse(rosterRes.json()).success).toBe(true);
      expect(rosterRes.json<ParticipantListResponse>().participants.map((p) => p.id).sort((a, b) => a.localeCompare(b)))
        .toEqual([...created.participantIds].sort((a, b) => a.localeCompare(b)));

      // --- updateSportLeagueParticipantRankings (200) ---------------------------
      const rankRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/sport-leagues/${leagueId}/participants/rankings`,
        headers: rootAdmin.headers,
        payload: { rankings: [{ participantId: created.participantIds[0], ranking: 1 }] },
      });
      expect(rankRes.statusCode).toBe(200);
      expect(ParticipantListResponseSchema.safeParse(rankRes.json()).success).toBe(true);
      expect(rankRes.json<ParticipantListResponse>().participants.find((p) => p.id === created.participantIds[0])?.ranking).toBe(1);

      // --- previewSportLeagueRankingUpload (200), then apply (200) ---------------
      const rankUpload = { rows: [{ externalId: `z3l-contract-${stamp}-p1`, ranking: 2 }, { playerName: 'Nobody Of This Tour', ranking: 3 }] };
      const rankPreviewRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/sport-leagues/${leagueId}/participants/rankings/upload/preview`,
        headers: rootAdmin.headers,
        payload: rankUpload,
      });
      expect(rankPreviewRes.statusCode).toBe(200);
      expect(SportLeagueRankingUploadPreviewResponseSchema.safeParse(rankPreviewRes.json()).success).toBe(true);
      expect(rankPreviewRes.json<{ rows: { resolution: string }[] }>().rows.map((row) => row.resolution)).toEqual(['MATCHED', 'UNRESOLVED']);
      const rankApplyRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/sport-leagues/${leagueId}/participants/rankings/upload`,
        headers: rootAdmin.headers,
        payload: { rows: [rankUpload.rows[0]] },
      });
      expect(rankApplyRes.statusCode).toBe(200);
      expect(ParticipantListResponseSchema.safeParse(rankApplyRes.json()).success).toBe(true);

      // #1180 — the search is trimmed before it reaches the repository: a leading space still
      // finds names that start with the term, without a sport.
      const paddedSearchRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants?q=%20Z3L+Contract+Golfer+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(paddedSearchRes.statusCode).toBe(200);
      expect(paddedSearchRes.json<ParticipantListResponse>().participants).toHaveLength(3);

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
          sportLeagueId: leagueId,
          autoLifecycleEnabled: false,
        },
      });
      expect(tournamentRes.statusCode).toBe(201);
      expect(SportEventResponseSchema.safeParse(tournamentRes.json()).success).toBe(true);
      const eventId = tournamentRes.json<SportEventResponse>().event.id;
      created.eventIds.push(eventId);
      // A new event goes in the league's current Season (#2003).
      expect(tournamentRes.json<SportEventResponse>().event).toMatchObject({ sportLeagueId: leagueId, sportLeagueSeasonId: currentSeasonId, championshipYear: 2081 });

      // pool-master-54u — the create response's counts must reflect the default
      // tiers/rounds seeded in the same request (not the pre-seed zero snapshot)
      // and must match what a subsequent GET returns.
      expect(tournamentRes.json<SportEventResponse>().event.tierCount).toBe(6);
      expect(tournamentRes.json<SportEventResponse>().event.loadedParticipantCount).toBe(0);
      const tournamentGetRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentGetRes.statusCode).toBe(200);
      expect(tournamentGetRes.json<SportEventResponse>().event.tierCount).toBe(tournamentRes.json<SportEventResponse>().event.tierCount);
      expect(tournamentGetRes.json<SportEventResponse>().event.loadedParticipantCount).toBe(tournamentRes.json<SportEventResponse>().event.loadedParticipantCount);

      // --- listEvents by Season (200) -----------------------------------------
      const tournamentListRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events?sportLeagueSeasonId=${currentSeasonId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentListRes.statusCode).toBe(200);
      expect(SportEventListResponseSchema.safeParse(tournamentListRes.json()).success).toBe(true);
      expect(tournamentListRes.json<SportEventListResponse>().events.map((e) => e.id)).toEqual([eventId]);
      // A root admin's read carries the admin counts a member's never does (#1198).
      expect(tournamentListRes.json<SportEventListResponse>().events[0]?.adminCounts).toMatchObject({ contestCount: 0 });

      // --- listEventParticipants / listEventTiers / listEventRounds (200) ----
      const fieldRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
      });
      expect(fieldRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(fieldRes.json()).success).toBe(true);

      // --- previewEventParticipantUpload (200) / applyEventParticipantUpload (200, 422) ---
      // Two golfers on the field, the third only in the catalog: the upload adjusts the field
      // and refuses a golfer not on it.
      const addRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participantIds: created.participantIds.slice(0, 2) },
      });
      expect(addRes.statusCode).toBe(200);
      const uploadPreviewRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants/upload/preview`,
        headers: rootAdmin.headers,
        payload: {
          rows: [
            { participantId: created.participantIds[0], ranking: 3, oddsToWin: 7.5 },
            { externalId: `z3l-contract-${stamp}-p1`, isActive: false, inactiveReason: 'WITHDRAWN' },
            { externalId: `z3l-contract-${stamp}-p2`, ranking: 1 },
          ],
        },
      });
      expect(uploadPreviewRes.statusCode).toBe(200);
      const uploadPreview = SportEventParticipantUploadPreviewResponseSchema.safeParse(uploadPreviewRes.json());
      expect(uploadPreview.success).toBe(true);
      expect(uploadPreview.data?.rollup).toMatchObject({ total: 3, matched: 2, unresolved: 1, update: 2 });

      const uploadRefusedRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants/upload`,
        headers: rootAdmin.headers,
        payload: { rows: [{ externalId: `z3l-contract-${stamp}-p2`, ranking: 1 }] },
      });
      expect(uploadRefusedRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.safeParse(uploadRefusedRes.json()).success).toBe(true);
      expect(uploadRefusedRes.json<ErrorEnvelope>().error.code).toBe('EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED');

      // A ranking or seed past a 32-bit integer is refused as validation (400), not a 500 from
      // the database, on both the upload preview and the grid save.
      const oversizedPreviewRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants/upload/preview`,
        headers: rootAdmin.headers,
        payload: { rows: [{ participantId: created.participantIds[0], ranking: 2 ** 31 }] },
      });
      expect(oversizedPreviewRes.statusCode).toBe(400);
      expect(ErrorEnvelopeSchema.safeParse(oversizedPreviewRes.json()).success).toBe(true);
      const loadedFieldRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
      });
      const fieldRowId = loadedFieldRes.json<{ participants: Array<{ id: string }> }>().participants[0].id;
      const oversizedSaveRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, seedNumber: 2 ** 31 }] },
      });
      expect(oversizedSaveRes.statusCode).toBe(400);
      expect(ErrorEnvelopeSchema.safeParse(oversizedSaveRes.json()).success).toBe(true);

      // updateEventParticipants (200): a withdrawn golfer reinstated with `inactiveReason: null`
      // clears the reason, as the contract says null does, rather than being refused with a 400.
      const withdrawRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, isActive: false, inactiveReason: 'WITHDRAWN' }] },
      });
      expect(withdrawRes.statusCode).toBe(200);
      const reinstateRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, isActive: true, inactiveReason: null }] },
      });
      expect(reinstateRes.statusCode).toBe(200);
      const reinstated = SportEventParticipantListResponseSchema.safeParse(reinstateRes.json());
      expect(reinstated.success).toBe(true);
      expect(reinstated.data?.participants.find((row) => row.id === fieldRowId)).toMatchObject({ isActive: true, inactiveReason: null });

      const uploadApplyRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants/upload`,
        headers: rootAdmin.headers,
        payload: { rows: [{ participantId: created.participantIds[0], ranking: 3, oddsToWin: 7.5 }] },
      });
      expect(uploadApplyRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(uploadApplyRes.json()).success).toBe(true);

      const tiersRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/tiers`,
        headers: rootAdmin.headers,
      });
      expect(tiersRes.statusCode).toBe(200);
      expect(SportEventTierListResponseSchema.safeParse(tiersRes.json()).success).toBe(true);
      expect(tiersRes.json<SportEventTierListResponse>().tiers).toHaveLength(6);

      const roundsRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/rounds`,
        headers: rootAdmin.headers,
      });
      expect(roundsRes.statusCode).toBe(200);
      expect(SportEventRoundListResponseSchema.safeParse(roundsRes.json()).success).toBe(true);
      expect(roundsRes.json<SportEventRoundListResponse>().rounds).toHaveLength(4);

      // --- releaseEvent (422 while golfers lack a tier, then 200 once tiered and priced) -
      const releaseRefusedRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(releaseRefusedRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.safeParse(releaseRefusedRes.json()).success).toBe(true);
      expect(releaseRefusedRes.json<ErrorEnvelope>().error.code).toBe('SPORT_EVENT_NOT_READY');

      // Two golfers can't fill six tiers, and release refuses an empty tier: play two.
      const twoTiersRes = await getApp().inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/tiers`,
        headers: rootAdmin.headers,
        payload: {
          tiers: [
            { tierKey: 'tier-1', label: 'Tier 1', tierNumber: 1 },
            { tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 },
          ],
        },
      });
      expect(twoTiersRes.statusCode).toBe(200);

      const autoTierRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/tiers/auto-assign`,
        headers: rootAdmin.headers,
        payload: {},
      });
      expect(autoTierRes.statusCode).toBe(200);

      // --- autoAssignEventPrices: release also needs every active golfer priced (#93) ---
      const autoPriceRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/prices/auto-assign`,
        headers: rootAdmin.headers,
        payload: standardEventPricing(),
      });
      expect(autoPriceRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(autoPriceRes.json()).success).toBe(true);

      const releaseRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/release`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });
      expect(releaseRes.statusCode).toBe(200);
      expect(SportEventResponseSchema.safeParse(releaseRes.json()).success).toBe(true);
      expect(releaseRes.json<SportEventResponse>().event.status).toBe('SCHEDULED');

      // --- the League page reads (200) (#1865): syncs, events, participants -----
      const leagueSyncsRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}/syncs`, headers: rootAdmin.headers });
      expect(leagueSyncsRes.statusCode).toBe(200);
      expect(SportLeagueSyncListResponseSchema.safeParse(leagueSyncsRes.json()).success).toBe(true);
      const leagueEventsRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}/events/overview`, headers: rootAdmin.headers });
      expect(leagueEventsRes.statusCode).toBe(200);
      const leagueEvents = SportLeagueEventOverviewListResponseSchema.safeParse(leagueEventsRes.json());
      expect(leagueEvents.success).toBe(true);
      expect(leagueEvents.data?.events.find((row) => row.id === eventId)).toMatchObject({ status: 'SCHEDULED', releaseAtKind: 'ACTUAL', fieldSize: expect.any(Number) });
      const leagueParticipantsRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}/participants/overview`, headers: rootAdmin.headers });
      expect(leagueParticipantsRes.statusCode).toBe(200);
      const leagueParticipants = SportLeagueParticipantOverviewListResponseSchema.safeParse(leagueParticipantsRes.json());
      expect(leagueParticipants.success).toBe(true);
      expect(leagueParticipants.data?.participants.length).toBeGreaterThanOrEqual(3);
      const leagueStructureRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}/structure`, headers: rootAdmin.headers });
      expect(leagueStructureRes.statusCode).toBe(200);
      expect(SportLeagueStructureResponseSchema.safeParse(leagueStructureRes.json()).success).toBe(true);

      // --- listSportLeagueSeasons (200: { seasons }) — the Structure tab and every Season picker (#2003) ---
      const seasonsRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}/seasons`, headers: rootAdmin.headers });
      expect(seasonsRes.statusCode).toBe(200);
      const seasons = SportLeagueSeasonListResponseSchema.safeParse(seasonsRes.json());
      expect(seasons.success).toBe(true);
      // Latest first: the 2081 Season the test made current, then the calendar year's the create began with.
      expect(seasons.data?.seasons.map((season) => [season.championshipYear, season.isCurrent])).toEqual([[2081, true], [new Date().getUTCFullYear(), false]]);
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
      if (created.participantIds.length) {
        await prisma.participantProviderMapping.deleteMany({
          where: { participantId: { in: created.participantIds } },
        });
      }
      if (created.sportLeagueId) {
        await prisma.eventSeries.deleteMany({ where: { sportLeagueId: created.sportLeagueId } });
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
    // listProviderCatalogEvents, linkEventScoreSource,
    // unlinkEventScoreSource. Drives one coherent flow through a
    // dedicated admin app with a registered provider and safeParses every
    // response against its published schema. Golf admin rows are not covered by
    // cleanupTestData(), so this test tears down child-first in a finally block.
    const app = await buildIngestionApp(new OperationalContractProvider());
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Golf Score Source Contract User',
      isRootAdmin: true,
    });
    const stamp = Date.now().toString().slice(-8);

    await getPrisma().sport.upsert({
      where: { sport: 'GOLF' },
      create: {
        sport: 'GOLF',
        tournamentFormat: 'STROKE_PLAY_TOURNAMENT',
      },
      update: {},
    });

    const created = {
      sportLeagueId: '',
      eventIds: [] as string[],
    };

    try {
      // --- listProviderCatalogEvents (200) --------------------------------
      const catalogRes = await app.inject({
        method: 'GET',
        url: '/api/v1/ingestion/providers/balldontlie/catalog-events?sport=GOLF&from=2026-04-01T00:00:00.000Z&to=2026-04-30T00:00:00.000Z',
        headers: rootAdmin.headers,
      });
      expect(catalogRes.statusCode).toBe(200);
      expect(ProviderCatalogEventListResponseSchema.safeParse(catalogRes.json()).success).toBe(true);
      // #205 — each result is a provider event, provider and sport included.
      expect(catalogRes.json<ProviderCatalogEventListResponse>().events).toContainEqual(expect.objectContaining({
        externalId: 'event-1',
        providerId: 'balldontlie',
        sport: 'GOLF',
        venue: 'Contract National',
      }));

      // --- sport league -> admin-authored event (syncScope NONE) -------------
      const leagueRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/sport-leagues',
        headers: rootAdmin.headers,
        payload: { ...(await leagueProfiles(getPrisma())), ...sportPlay(Sport.GOLF), timeZone: 'UTC', sport: 'GOLF', name: `CS8 Contract Tour ${stamp}` },
      });
      expect(leagueRes.statusCode).toBe(201);
      created.sportLeagueId = leagueRes.json<SportLeagueResponse>().sportLeague.id;
      await withCurrentSeason(getPrisma(), created.sportLeagueId, 2083);

      const tournamentRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: rootAdmin.headers,
        payload: {
          name: `CS8 Contract Open ${stamp}`,
          startDate: '2083-06-16T08:00:00.000Z',
          endDate: '2083-06-19T20:00:00.000Z',
          rounds: 4,
          sportLeagueId: created.sportLeagueId,
          autoLifecycleEnabled: false,
        },
      });
      expect(tournamentRes.statusCode).toBe(201);
      const eventId = tournamentRes.json<SportEventResponse>().event.id;
      created.eventIds.push(eventId);
      expect(tournamentRes.json<SportEventResponse>().event.syncScope).toBe('NONE');

      // --- linkEventScoreSource (200) ------------------------------------------
      // A shape test: linkScoreSource checks the provider is registered for the event's
      // sport, so the link goes through the app that registers the contract provider. It does
      // not check the provider event exists, so a synthetic externalId links fine.
      const linkRes = await app.inject({
        method: 'PUT',
        url: `/api/v1/events/${eventId}/score-source`,
        headers: rootAdmin.headers,
        payload: { providerId: 'balldontlie', externalId: `contract-cs8-${stamp}` },
      });
      expect(linkRes.statusCode).toBe(200);
      expect(SportEventResponseSchema.safeParse(linkRes.json()).success).toBe(true);
      expect(linkRes.json<SportEventResponse>().event).toMatchObject({
        syncScope: 'SCORES_ONLY',
        providerId: 'balldontlie',
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
      expect(unlinkRes.json<SportEventResponse>().event.syncScope).toBe('NONE');
      expect(unlinkRes.json<SportEventResponse>().event.providerId).toBe('manual-admin');
    } finally {
      const prisma = getPrisma();
      if (created.eventIds.length) {
        await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEventTier.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEvent.deleteMany({ where: { id: { in: created.eventIds } } });
      }
      if (created.sportLeagueId) {
        await prisma.eventSeries.deleteMany({ where: { sportLeagueId: created.sportLeagueId } });
        await prisma.sportLeague.deleteMany({ where: { id: created.sportLeagueId } });
      }
      await app.close();
    }
  });
  it('syncLeagueEvents queues the league\'s events sync (202), whose job creates the tour\'s events and shows on listActivity with its EVENTS run; a league no provider syncs is refused with 422', async () => {
    const stamp = Date.now().toString().slice(-8);
    const tour = `SNOW${stamp}`;
    const app = await buildIngestionApp(new TourSlateContractProvider(tour));
    const rootAdmin = await createTestUser({ displayName: 'Root Admin League Sync Contract User', isRootAdmin: true });
    const prisma = getPrisma();
    const sport = await prisma.sport.upsert({
      where: { sport: 'GOLF' },
      create: { sport: 'GOLF', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const synced = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await leagueProfiles(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Sync Now Tour ${stamp}` } });
    // A migration's league has its Seasons mapped to the provider's, one of them current (#2003).
    const [seasonId] = await syncSeasonsTo(prisma, synced.id, await syncLeagueTo(prisma, synced.id, 'pga'), [2085]);
    const unsynced = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await leagueProfiles(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Sync Now Manual Tour ${stamp}` } });

    try {
      const syncRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/sport-leagues/${synced.id}/events-sync`,
        headers: rootAdmin.headers,
        payload: { sportLeagueSeasonId: seasonId },
      });
      expect(syncRes.statusCode).toBe(202);
      const queued = ActivityJobResponseSchema.parse(syncRes.json()).job;
      expect(queued).toMatchObject({
        type: 'SYNC_LEAGUE_EVENTS', kind: 'SYNC', sportLeagueId: synced.id, sportEventId: null,
        sportLeague: { id: synced.id, name: synced.name }, sportEvent: null,
      });

      const readActivity = async () => {
        const res = await app.inject({ method: 'GET', url: `/api/v1/activity?sportLeagueId=${synced.id}`, headers: rootAdmin.headers });
        expect(res.statusCode).toBe(200);
        return ActivityListResponseSchema.parse(res.json()).jobs;
      };
      let jobs = await readActivity();
      for (let tries = 0; jobs[0]?.status !== 'SUCCEEDED' && tries < 50; tries += 1) {
        await new Promise((resolve) => { setTimeout(resolve, 100); });
        jobs = await readActivity();
      }
      expect(jobs).toHaveLength(1);
      const [job] = jobs;
      expect(job).toMatchObject({ id: queued.id, status: 'SUCCEEDED', result: { sportLeagueSeasonIds: [seasonId], created: 2, updated: 0, skipped: 0 } });
      expect(job.syncRunIds).toHaveLength(1);
      // #1861: the admin who asked, what the job changed, and how long its try took.
      expect(queued).toMatchObject({ trigger: 'ADMIN', startedBy: { id: rootAdmin.user.id, displayName: rootAdmin.user.displayName }, startedAt: null, durationSeconds: null });
      expect(job).toMatchObject({
        trigger: 'ADMIN', startedBy: { id: rootAdmin.user.id, displayName: rootAdmin.user.displayName }, changedCount: 2, errorType: null,
        sportLeague: { id: synced.id, name: synced.name },
        startedAt: expect.any(String), durationSeconds: expect.any(Number),
      });

      const runRes = await app.inject({ method: 'GET', url: `/api/v1/ingestion/sync-runs/${job.syncRunIds[0]}`, headers: rootAdmin.headers });
      expect(runRes.statusCode).toBe(200);
      expect(ProviderSyncRunDetailDtoSchema.parse(runRes.json())).toMatchObject({
        kind: 'EVENTS', trigger: 'ADMIN', sportLeagueId: synced.id, backgroundJobId: queued.id, status: 'COMPLETED',
      });
      expect(await prisma.sportEvent.count({ where: { eventSeries: { sportLeagueId: synced.id }, sportLeagueSeasonId: seasonId } })).toBe(2);

      const refusedRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/sport-leagues/${unsynced.id}/events-sync`,
        headers: rootAdmin.headers,
        payload: {},
      });
      expect(refusedRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.parse(refusedRes.json()).error.code).toBe('SPORT_LEAGUE_NOT_SYNCED');
    } finally {
      const eventIds = (await prisma.sportEvent.findMany({ where: { eventSeries: { sportLeagueId: { in: [synced.id, unsynced.id] } } }, select: { id: true } }))
        .map((event) => event.id);
      await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
      await prisma.sportEventTier.deleteMany({ where: { sportEventId: { in: eventIds } } });
      await prisma.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.eventSeries.deleteMany({ where: { sportLeagueId: { in: [synced.id, unsynced.id] } } });
      await prisma.sportLeague.deleteMany({ where: { id: { in: [synced.id, unsynced.id] } } });
      await app.close();
    }
  });

  it('previewEventRaceResults and applyEventRaceResults match their DTOs, and refuse with their stable error codes', async () => {
    // #622 — the admin's finishing order for a horse race: a happy path for each operation, then
    // every refusal the routes document, each as an error envelope with its code.
    const prisma = getPrisma();
    const rootAdmin = await createTestUser({ displayName: 'Root Admin Race Contract User', isRootAdmin: true });
    const member = await createTestUser({ displayName: 'Race Contract Member' });
    const stamp = Date.now().toString().slice(-8);
    const horseRacing = await prisma.sport.upsert({
      where: { sport: 'HORSE_RACING' },
      create: { sport: 'HORSE_RACING', tournamentFormat: 'RACE' },
      update: {},
    });
    const golf = await prisma.sport.upsert({
      where: { sport: 'GOLF' },
      create: { sport: 'GOLF', tournamentFormat: 'STROKE_PLAY_TOURNAMENT' },
      update: {},
    });
    const createEvent = async (sport: 'HORSE_RACING' | 'GOLF', sportId: string, names: string[]) => {
      const event = await prisma.sportEvent.create({
        data: {
          ...(await freshEventEdition(prisma, { sport })),
          externalId: `race-contract-${sport}-${stamp}`,
          providerId: 'manual-admin',
          sport,
          name: `Race Contract ${sport} ${stamp}`,
          startDate: new Date('2026-05-02T22:00:00.000Z'),
          status: 'SCHEDULED',
        },
      });
      for (const name of names) {
        const participant = await prisma.participant.create({ data: { sportLeagueId: await participantLeagueId(prisma, sportId), name: `${name} ${stamp}`, participantType: 'INDIVIDUAL' } });
        await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } });
      }
      return event;
    };
    const race = await createEvent('HORSE_RACING', horseRacing.id, ['Arrow', 'Bolt']);
    const golfEvent = await createEvent('GOLF', golf.id, ['Golfer']);
    const finisher = (name: string, finishPosition: number | null) => ({
      playerName: `${name} ${stamp}`, resultStatus: 'FINISHED', finishPosition, startPosition: null, riderName: null,
    });
    const send = (method: 'POST' | 'PUT', eventId: string, payload: object, headers = rootAdmin.headers) => getApp().inject({
      method,
      url: method === 'POST' ? `/api/v1/events/${eventId}/race-results/preview` : `/api/v1/events/${eventId}/race-results`,
      headers,
      payload,
    });
    const expectRefusal = async (response: Awaited<ReturnType<typeof send>>, statusCode: number, code?: string) => {
      expect(response.statusCode).toBe(statusCode);
      expect(ErrorEnvelopeSchema.safeParse(response.json()).success).toBe(true);
      if (code) expect(response.json<ErrorEnvelope>().error.code).toBe(code);
    };

    // --- previewEventRaceResults (200: RaceResultPreviewResponse) ---------------------------
    const previewRes = await send('POST', race.id, {
      isOfficial: true,
      rows: [finisher('Arrow', 1), finisher('Nobody', 2)],
    });
    expect(previewRes.statusCode).toBe(200);
    const preview = RaceResultPreviewResponseSchema.parse(previewRes.json());
    expect(preview.rollup).toMatchObject({ total: 2, matched: 1, unresolved: 1 });
    expect(preview.orderErrors).toEqual(['FIELD_INCOMPLETE']);

    // --- applyEventRaceResults (200: SportEventParticipantListResponse) ---------------------
    const applyRes = await send('PUT', race.id, { isOfficial: true, rows: [finisher('Arrow', 1), finisher('Bolt', 2)] });
    expect(applyRes.statusCode).toBe(200);
    const field = SportEventParticipantListResponseSchema.parse(applyRes.json());
    expect(field.participants.map((row) => [row.race?.finishPosition, row.race?.isOfficial, row.standing?.displayPosition]))
      .toEqual(expect.arrayContaining([[1, true, '1'], [2, true, '2']]));

    // --- refusals ---------------------------------------------------------------------------
    await expectRefusal(await send('PUT', race.id, { isOfficial: false, rows: [finisher('Nobody', 1)] }), 422, 'RACE_RESULT_ROWS_INVALID');
    await expectRefusal(await send('PUT', race.id, { isOfficial: false, rows: [finisher('Bolt', 3)] }), 422, 'RACE_RESULT_POSITIONS_INVALID');
    await expectRefusal(await send('PUT', race.id, { isOfficial: true, rows: [finisher('Bolt', null)] }), 422, 'RACE_RESULT_ROWS_INVALID');
    await prisma.sportEventParticipant.create({
      data: {
        sportEventId: race.id,
        participantId: (await prisma.participant.create({ data: { sportLeagueId: await participantLeagueId(prisma, horseRacing.id), name: `Late ${stamp}`, participantType: 'INDIVIDUAL' } })).id,
      },
    });
    await expectRefusal(await send('PUT', race.id, { isOfficial: true, rows: [finisher('Arrow', 1)] }), 422, 'RACE_RESULT_FIELD_INCOMPLETE');
    await expectRefusal(await send('POST', golfEvent.id, { isOfficial: false, rows: [finisher('Golfer', 1)] }), 422, 'EVENT_SCORING_FAMILY_MISMATCH');
    await expectRefusal(await send('PUT', golfEvent.id, { isOfficial: false, rows: [finisher('Golfer', 1)] }), 422, 'EVENT_SCORING_FAMILY_MISMATCH');
    await expectRefusal(await send('PUT', '00000000-0000-4000-8000-000000000000', { isOfficial: false, rows: [finisher('Arrow', 1)] }), 404);
    await expectRefusal(await send('PUT', race.id, { isOfficial: false, rows: [{ ...finisher('Arrow', 0) }] }), 400);
    await expectRefusal(await send('PUT', race.id, { isOfficial: false, rows: [finisher('Arrow', 1)] }, member.headers), 403);
  });

  // #1997: the Providers page's saves, against the shared app and the BALLDONTLIE row the migration seeds.
  describe('provider settings contract (#1997)', () => {
    it('updateProviderSettings saves a provider\'s settings and answers its row; updateProviderLeague saves a league\'s; each is refused as documented', async () => {
      const rootAdmin = await createTestUser({ displayName: 'Root Admin Provider Settings Contract User', isRootAdmin: true });
      const member = await createTestUser({ displayName: 'Member Provider Settings Contract User' });
      const prisma = getPrisma();
      const before = await prisma.provider.findUniqueOrThrow({ where: { code: 'BALLDONTLIE' }, include: { leagues: { where: { code: 'mlb' } } } });
      const [mlb] = before.leagues;
      const patch = (url: string, payload: Record<string, unknown>, headers = rootAdmin.headers) => getApp().inject({ method: 'PATCH', url, headers, payload });

      try {
        const listRes = await getApp().inject({ method: 'GET', url: '/api/v1/ingestion/providers', headers: rootAdmin.headers });
        expect(listRes.statusCode).toBe(200);
        const listed = ProviderListResponseSchema.parse(listRes.json()).providers.find((summary) => summary.settings?.code === 'BALLDONTLIE');
        expect(listed?.settings).toMatchObject({ id: before.id, name: 'BALLDONTLIE', webhookSecretSet: true });
        expect(listed?.settings?.leagues.map((league) => league.code)).toContain('mlb');

        const savedRes = await patch(`/api/v1/ingestion/provider-settings/${before.id}`, { requestsPerMinute: 600, webhookPollMinutes: 20 });
        expect(savedRes.statusCode).toBe(200);
        expect(ProviderSettingsResponseSchema.parse(savedRes.json()).provider).toMatchObject({ code: 'BALLDONTLIE', requestsPerMinute: 600, webhookPollMinutes: 20, webhookSecretSet: true });

        const leagueRes = await patch(`/api/v1/ingestion/provider-settings/${before.id}/leagues/${mlb.id}`, { typicalGameMinutes: 200, quietAfterMinutes: 120 });
        expect(leagueRes.statusCode).toBe(200);
        expect(ProviderLeagueResponseSchema.parse(leagueRes.json()).league).toMatchObject({ id: mlb.id, code: 'mlb', typicalGameMinutes: 200, quietAfterMinutes: 120 });

        const refusals = await Promise.all([
          patch(`/api/v1/ingestion/provider-settings/${randomUUID()}`, { requestsPerMinute: 10 }),
          patch(`/api/v1/ingestion/provider-settings/${before.id}/leagues/${randomUUID()}`, { typicalGameMinutes: 10 }),
          patch(`/api/v1/ingestion/provider-settings/${before.id}`, { requestsPerMinute: 0 }),
          patch(`/api/v1/ingestion/provider-settings/${before.id}`, { requestsPerMinute: 10 }, member.headers),
        ]);
        expect(refusals.map((res) => res.statusCode)).toEqual([404, 404, 400, 403]);
        for (const res of refusals) expect(ErrorEnvelopeSchema.safeParse(res.json()).success).toBe(true);
        expect(refusals.slice(0, 2).map((res) => ErrorEnvelopeSchema.parse(res.json()).error.code)).toEqual(['PROVIDER_NOT_FOUND', 'PROVIDER_LEAGUE_NOT_FOUND']);
      } finally {
        // Put the seeded row back as it was, for every test after this one.
        await patch(`/api/v1/ingestion/provider-settings/${before.id}`, { requestsPerMinute: before.requestsPerMinute, webhookPollMinutes: before.webhookPollMinutes });
        await patch(`/api/v1/ingestion/provider-settings/${before.id}/leagues/${mlb.id}`, { typicalGameMinutes: mlb.typicalGameMinutes, quietAfterMinutes: mlb.quietAfterMinutes });
      }
    });
  });
});
