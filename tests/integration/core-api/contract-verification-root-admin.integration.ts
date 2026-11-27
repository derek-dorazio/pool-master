import { PrismaSlotTiebreakerRepository } from '../../../packages/core-api/src/adapters/prisma-slot-tiebreaker-repository';
import { SlotTiebreakerService } from '../../../packages/core-api/src/modules/events/slot-tiebreaker-service';
import { BALLDONTLIE_TEST_PROVIDER_ID } from '../../support/balldontlie-provider-rows';
import { deleteTestSportLeagues, linkTestSlot, testSlotDefinitionId, testSlotId } from '../../support/test-slots';
import { syncSlotsFor } from '../../support/sync-slots';
import { createRoundRows } from '../../support/sport-event-rows';
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
  IngestionScheduleSchema,
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
  RaceResultPreviewResponseSchema,
  SportEventResponseSchema,
  SportLeagueSeasonSlotDtoSchema,
  SportLeagueSeasonListResponseSchema,
  ActivityJobResponseSchema,
  ActivityListResponseSchema,
  SportEventRoundListResponseSchema,
  SportEventTierListResponseSchema,
  SportLeagueListResponseSchema,
  SportLeagueResponseSchema,
  SportLeagueOverviewListResponseSchema,
  SportLeagueSyncListResponseSchema,
  SportLeagueEventOverviewListResponseSchema,
  SportLeagueParticipantOverviewListResponseSchema,
  SportLeagueStructureResponseSchema,
  SportListResponseSchema,
} from '@poolmaster/shared/dto';
import type {
  ContestConfigTemplateListResponse,
  ContestConfigTemplateResponse,
  ErrorEnvelope,
  IngestionSchedule,
  LeagueResponse,
  ParticipantListResponse,
  ParticipantProviderMappingResponse,
  ProviderListResponse,
  ProviderManualSyncSubmissionResponse,
  ProviderSyncRunDetailDto,
  ProviderSyncRunListResponse,
  SportEventListResponse,
  SportEventResponse,
  SportLeagueSeasonSlotResponse,
  SportEventRoundListResponse,
  SportEventTierListResponse,
  SportLeagueListResponse,
  SuccessResponse,
  UserResetPasswordResponse,
  UserResponse,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { standardPricingIn } from '../../support/budget-pricing';
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
  PrismaSportEventRoundRepository,
  PrismaSportLeagueRepository,
} from '../../../packages/core-api/src/adapters';
import { LeagueEventsSync } from '../../../packages/core-api/src/modules/events/league-events-sync';
import { ProviderSeasonScheduleReader } from '../../../packages/core-api/src/modules/events/provider-season-schedule-reader';
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
  withoutJsonBodyHeaders, integrationSportEventServices, integrationEventLifecycle, integrationProviderSettings, integrationSyncFindings,
} from '../helpers';
import type {
  ProviderParticipant,
  ProviderPayloadCapture,
  ProviderPayloadDiagnostics,
  SportDataProvider,
  SportEvent,
  SportEventDetail,
} from '../../../packages/core-api/src/modules/ingestion/core/provider-interface';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { fixtureTourId, freshEventEdition, mapEventToProvider, withCurrentSeason } from '../../support/event-edition';
import type { z } from 'zod';
import { expectDefined } from '../../support/expect-defined';
import { RecordingLeaderboardRebuilds } from '../../support/recording-leaderboard-rebuilds';
import { RecordingCdnInvalidator } from '../../support/recording-cdn-invalidator';
import { participantLeagueId } from '../../support/participant-league';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { SYNCED_PROVIDER_ID, syncLeagueTo, syncSeasonsTo } from '../../support/league-sync';
import { sportRowKeys } from '../../support/sport-rows';
import { PrismaSportLeagueSeasonRepository } from '../../../packages/core-api/src/adapters/prisma-sport-league-season-repository';
import { ProviderCode, Sport, SportEventParticipantStatus, SportEventStatus } from '@poolmaster/shared/domain';
import { sportPlay } from '../../support/sport-play';
import { insertTestSportLeague } from '../../support/test-sport-league';

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
  readonly providerCode = ProviderCode.BALLDONTLIE;

  servesLeague(): boolean {
    return true;
  }

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
        fieldLocked: false,
        providerSlots: [],
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
      fieldLocked: false,
      providerSlots: [],
      participants: [
        {
          externalId: 'golfer-1',
          providerId: this.providerId,
          sport: 'GOLF',
          name: 'Avery Hart',
          firstName: 'Avery',
          lastName: 'Hart',
          nationality: 'US',
          status: SportEventParticipantStatus.ACTIVE,
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
          status: SportEventParticipantStatus.ACTIVE,
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
        status: SportEventParticipantStatus.ACTIVE,
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
    const event = (externalId: string, name: string, providerLeagueCode: string, day: string): SportEvent => {
      const startDate = new Date(`${day}T12:00:00.000Z`);
      const endDate = new Date(`${day.slice(0, 8)}${String(Number(day.slice(8)) + 3).padStart(2, '0')}T23:00:00.000Z`);
      // A tournament's code is its own id, which the test league's slots map (#2005).
      return { externalId, providerId: this.providerId, sport: 'GOLF', name, startDate, endDate, status: 'SCHEDULED', fieldLocked: false, providerSlots: [{ code: externalId, startsAt: startDate, endsAt: endDate }], providerLeagueCode };
    };
    return [
      event(`${this.tour}-alpha`, `${this.tour} Alpha Open`, 'pga', '2085-03-05'),
      event(`${this.tour}-bravo`, `${this.tour} Bravo Classic`, 'pga', '2085-04-09'),
      event(`${this.tour}-other`, `${this.tour} Other Tour Event`, 'lpga', '2085-05-07'),
    ];
  }
}

/**
 * A golf event on a tour of its own synced from BALLDONTLIE's PGA TOUR, kept under `externalId`,
 * BALLDONTLIE's id for it, as the tour's sync leaves it (#2004): what an event sync names by its
 * own id.
 */
/** An event its league's provider syncs, in play by default so it can run both sync kinds (#2238). */
async function syncedEvent(externalId: string, status: SportEventStatus = SportEventStatus.IN_PROGRESS) {
  const prisma = getPrisma();
  const sport = await prisma.sport.findUniqueOrThrow({ where: { sport: Sport.GOLF } });
  const tour = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(Sport.GOLF), sportId: sport.id, name: `Contract Sync Tour ${randomUUID()}` } });
  await syncLeagueTo(prisma, tour.id, 'pga');
  const event = await prisma.sportEvent.create({
    data: { ...(await freshEventEdition(prisma, { sportLeagueId: tour.id })), name: `Contract Sync ${externalId}`, status, startDate: new Date('2026-04-10T15:00:00.000Z') },
  });
  await mapEventToProvider(prisma, event.id, { providerId: 'balldontlie', externalId });
  return event;
}

async function buildIngestionApp(provider: SportDataProvider | null): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, ajv: FASTIFY_AJV_OPTIONS });
  const registry = new ProviderRegistry();
  if (provider) registry.register(provider);
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
    seasonSchedule: new ProviderSeasonScheduleReader(getAppPrisma(), registry),
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
  await app.register(participantsModule, { prefix: '/api/v1/participants', domainEvents: testDomainEvents({ queue: backgroundJobs.queue }) });
  await app.register(eventsModule, {
    prefix: '/api/v1/events',
    eventLifecycleService: integrationEventLifecycle(prisma),
    ingestionService,
    providerRegistry: registry,
    cdn: new RecordingCdnInvalidator(),
    domainEvents: testDomainEvents(),
    leaderboards: new RecordingLeaderboardRebuilds(),
    webhookProviderIds: providerRows.webhookProviderIds,
    slotTiebreakers: new SlotTiebreakerService({ slots: new PrismaSlotTiebreakerRepository(prisma), findings: integrationSyncFindings(prisma), domainEvents: testDomainEvents() }),
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
        status: 'COMPLETED',
        summary: 'Completed event participants sync.',
        detailsJson: { providerPayload: { rawCaptured: true, rawTruncated: false, raw: [] } },
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
    // A run's sport is its sport league's (#2042).
    const golfLeagueId = await fixtureTourId(getPrisma());
    await getPrisma().providerSyncRun.createMany({
      data: [
        {
          kind: 'SCORES',
          trigger: 'SCHEDULE',
          id: '11111111-1111-1111-1111-111111111111',
          providerId: BALLDONTLIE_TEST_PROVIDER_ID,
          sportLeagueId: golfLeagueId,
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
          sportLeagueId: golfLeagueId,
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
    expect(IngestionScheduleSchema.safeParse(ingestionReadRes.json()).success).toBe(true);
    // One schedule for every sport a running provider covers (#1997): the policies, with no sports list.
    expect(ingestionReadRes.json<IngestionSchedule>()).not.toHaveProperty('scheduledSports');
    // Each sync says whether it runs and has a switch (#2086): the field sync has none and always runs.
    const read = ingestionReadRes.json<IngestionSchedule>();
    expect(read.FIELD).toEqual(expect.objectContaining({ runs: true, switchable: false }));
    expect(read.FIELD).not.toHaveProperty('enabled');
    expect(read.SCORES).toEqual(expect.objectContaining({ enabled: read.SCORES.runs, switchable: true }));

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
    expect(IngestionScheduleSchema.safeParse(ingestionUpdateRes.json()).success).toBe(true);
    expect(ingestionUpdateRes.json<IngestionSchedule>().SCORES.intervalSeconds).toBe(45);

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


  it('pool-master-rop.68.1.2 root-admin provider operational routes match their DTOs on happy paths, and every retired provider route answers 404', async () => {
    const rootAdmin = await createTestUser({
      displayName: 'Root Admin Provider Ops User',
      isRootAdmin: true,
    });

    const contractEvent = await getPrisma().sportEvent.create({
      data: {
        ...(await freshEventEdition(getPrisma())),
        name: 'Contract Masters',
        venue: 'Contract National',
        location: 'Augusta, GA',
        startDate: new Date('2026-04-10T15:00:00.000Z'),
        endDate: new Date('2026-04-14T21:00:00.000Z'),
        status: 'SCHEDULED',
        rounds: 4,
      },
    });
    await mapEventToProvider(getPrisma(), contractEvent.id, { providerId: 'balldontlie', externalId: 'event-1' });

    await getPrisma().providerSyncRun.upsert({
      where: {
        id: '33333333-3333-3333-3333-333333333333',
      },
      create: {
        kind: 'SCORES',
        trigger: 'SCHEDULE',
        id: '33333333-3333-3333-3333-333333333333',
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        sportEventId: contractEvent.id,
        // The event's own league: a run on an event records it (#2042 reads the run's sport there).
        sportLeagueId: await fixtureTourId(getPrisma()),
        status: 'COMPLETED',
        startedAt: new Date('2026-04-09T10:00:00.000Z'),
        completedAt: new Date('2026-04-09T10:02:00.000Z'),
        summary: 'Imported event and participant field.',
        stats: { recordsProcessed: 12 },
      },
      update: {
        providerId: BALLDONTLIE_TEST_PROVIDER_ID,
        sportEventId: contractEvent.id,
        // The event's own league: a run on an event records it (#2042 reads the run's sport there).
        sportLeagueId: await fixtureTourId(getPrisma()),
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

      const syncTarget = await syncedEvent('contract-sync-event');
      const eventSyncRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/events/${syncTarget.id}/sync`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: { kinds: ['SCORES'] },
      });
      expect(eventSyncRes.statusCode).toBe(202);
      expect(ProviderManualSyncSubmissionResponseSchema.safeParse(eventSyncRes.json()).success).toBe(true);
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().sport).toBe('GOLF');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().eventId).toBe('contract-sync-event');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().requestedKinds).toEqual(['SCORES']);
      expect(typeof eventSyncRes.json<ProviderManualSyncSubmissionResponse>().submittedAt).toBe('string');
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns.length).toBeGreaterThanOrEqual(1);
      expect(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns[0]?.status).toBe('SUBMITTED');
      await waitForProviderSyncRun(eventSyncRes.json<ProviderManualSyncSubmissionResponse>().syncRuns[0]?.id);

      // An event sync takes the event's FIELD or SCORES kind (#2093): a league's EVENTS, the old
      // feed names (#125, #126, #2093) and the old `feeds` list are all refused.
      const oldFeedsRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/events/${syncTarget.id}/sync`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: { feeds: ['EVENTPARTICIPANTS'] },
      });
      expect(oldFeedsRes.statusCode).toBe(400);
      // EVENTS is the one ProviderSyncKind an event sync leaves out: a league syncs its events.
      const leagueKindRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/events/${syncTarget.id}/sync`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: { kinds: ['EVENTS'] },
      });
      expect(leagueKindRes.statusCode).toBe(400);
      for (const retiredFeed of ['EVENTPARTICIPANTS', 'EVENTLIVESCORES', 'PARTICIPANTRANKINGS', 'EVENTSCHEDULE', 'EVENTRESULTS']) {
        const retiredFeedRes = await app.inject({
          method: 'POST',
          url: `/api/v1/ingestion/events/${syncTarget.id}/sync`,
          headers: withoutJsonBodyHeaders(rootAdmin.headers),
          payload: { kinds: [retiredFeed] },
        });
        expect(retiredFeedRes.statusCode).toBe(400);
      }

      // #126 — with every feed event-scoped, the sport-level sync route is gone.
      const sportSyncRes = await app.inject({
        method: 'POST',
        url: '/api/v1/ingestion/sports/GOLF/sync',
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: {
          kinds: ['EVENTSCHEDULE'],
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

      // #2004 — only the sync gives an event its provider id: the catalog browse, the create from
      // a provider event, the score-source link and unlink, and the sport-scoped event sync are gone.
      const someId = '00000000-0000-4000-8000-0000000000e1';
      const retired = await Promise.all([
        app.inject({ method: 'GET', url: `/api/v1/ingestion/providers/${someId}/catalog-events`, headers: withoutJsonBodyHeaders(rootAdmin.headers) }),
        app.inject({ method: 'POST', url: '/api/v1/events/from-provider-event', headers: rootAdmin.headers, payload: {} }),
        app.inject({ method: 'PUT', url: `/api/v1/events/${someId}/score-source`, headers: rootAdmin.headers, payload: {} }),
        app.inject({ method: 'DELETE', url: `/api/v1/events/${someId}/score-source`, headers: withoutJsonBodyHeaders(rootAdmin.headers) }),
        app.inject({ method: 'POST', url: `/api/v1/ingestion/sports/GOLF/events/${someId}/sync`, headers: rootAdmin.headers, payload: { kinds: ['SCORES'] } }),
      ]);
      expect(retired.map((res) => res.statusCode)).toEqual([404, 404, 404, 404, 404]);
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
      const target = await syncedEvent('empty-diagnostics-event');
      const prepareSyncRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/events/${target.id}/sync`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: { kinds: ['SCORES'] },
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
      // An event sync names the event by its own id (#2004): one no event has is not found, and a
      // test event, which its provider has no id for, is not linked.
      const syncOf = (eventId: string) => app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/events/${eventId}/sync`,
        headers: withoutJsonBodyHeaders(rootAdmin.headers),
        payload: { kinds: ['SCORES'] },
      });
      const testEvent = await getPrisma().sportEvent.create({
        data: { ...(await freshEventEdition(getPrisma())), name: 'Contract Test Event', startDate: new Date('2026-04-10T15:00:00.000Z') },
      });
      const missingEventRes = await syncOf(randomUUID());
      const unlinkedEventRes = await syncOf(testEvent.id);
      expect([missingEventRes.statusCode, unlinkedEventRes.statusCode]).toEqual([404, 409]);
      expect(ErrorEnvelopeSchema.parse(missingEventRes.json()).error.code).toBe('EVENT_NOT_FOUND');
      expect(ErrorEnvelopeSchema.parse(unlinkedEventRes.json()).error.code).toBe('EVENT_NOT_LINKED');

      // A linked event asked for a kind it cannot run now (#2238): live scores before play starts.
      const scheduledEvent = await syncedEvent('contract-scheduled-event', SportEventStatus.SCHEDULED);
      const notYetRes = await syncOf(scheduledEvent.id);
      expect(notYetRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.parse(notYetRes.json()).error.code).toBe('EVENT_SYNC_KIND_UNAVAILABLE');

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
        ...sportRowKeys('GOLF'),
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
        ...sportRowKeys('GOLF'),
      },
      update: {},
    });

    const created = {
      sportLeagueId: '',
      eventIds: [] as string[],
      participantIds: [] as string[],
    };

    try {
      // --- POST /sport-leagues (404) — removed (#2075): a sport league comes only from a migration ---
      const removedCreateRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/sport-leagues',
        headers: rootAdmin.headers,
        payload: { ...sportPlay(Sport.GOLF), timeZone: 'UTC', sport: 'GOLF', name: `Z3L Contract Tour ${stamp}` },
      });
      expect(removedCreateRes.statusCode).toBe(404);
      const leagueId = (await insertTestSportLeague(getPrisma(), { sport: Sport.GOLF, name: `Z3L Contract Tour ${stamp}`, championshipYear: 2081 })).id;
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

      // --- getSportLeague (200: { sportLeague }) ----------------------------------
      const leagueRes = await getApp().inject({ method: 'GET', url: `/api/v1/sport-leagues/${leagueId}`, headers: rootAdmin.headers });
      expect(leagueRes.statusCode).toBe(200);
      expect(SportLeagueResponseSchema.safeParse(leagueRes.json()).success).toBe(true);

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

      // The sport league's ranking upload is gone: rankings come from the feed (#2008).
      for (const url of [`/api/v1/sport-leagues/${leagueId}/participants/rankings/upload/preview`, `/api/v1/sport-leagues/${leagueId}/participants/rankings/upload`]) {
        // poolmaster-allow-query-in-loop: two removed routes, each asked once
        const removed = await getApp().inject({ method: 'POST', url, headers: rootAdmin.headers, payload: { rows: [{ participantId: created.participantIds[0], ranking: 2 }] } });
        expect(removed.statusCode).toBe(404);
      }

      // #1180 — the search is trimmed before it reaches the repository: a leading space still
      // finds names that start with the term, without a sport.
      const paddedSearchRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/participants?q=%20Z3L+Contract+Golfer+${stamp}`,
        headers: rootAdmin.headers,
      });
      expect(paddedSearchRes.statusCode).toBe(200);
      expect(paddedSearchRes.json<ParticipantListResponse>().participants).toHaveLength(3);

      // --- createTestSlot (201: { slot }) ------------------------------------
      const testSlotRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/sport-leagues/${leagueId}/test-slots`,
        headers: rootAdmin.headers,
        payload: {
          slotDefinitionId: await testSlotDefinitionId(getPrisma(), leagueId, currentSeasonId),
          label: `Z3L ${stamp}`,
          startsAt: '2081-07-16T08:00:00.000Z',
          endsAt: '2081-07-19T20:00:00.000Z',
        },
      });
      expect(testSlotRes.statusCode).toBe(201);
      // The response is { slot }: the slot validated against its DTO.
      expect(SportLeagueSeasonSlotDtoSchema.safeParse(testSlotRes.json<{ slot: unknown }>().slot).success).toBe(true);

      // --- createEvent (201: { event }) ---------------------------------------
      const tournamentRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: rootAdmin.headers,
        payload: {
          seasonSlotIds: [testSlotRes.json<SportLeagueSeasonSlotResponse>().slot.id],
          name: `Z3L Contract Open ${stamp}`,
          venue: 'Contract Links',
          location: 'Testshire',
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
      expect(tournamentRes.json<SportEventResponse>().event.participantCount).toBe(0);
      const tournamentGetRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}`,
        headers: rootAdmin.headers,
      });
      expect(tournamentGetRes.statusCode).toBe(200);
      expect(tournamentGetRes.json<SportEventResponse>().event.tierCount).toBe(tournamentRes.json<SportEventResponse>().event.tierCount);
      expect(tournamentGetRes.json<SportEventResponse>().event.participantCount).toBe(tournamentRes.json<SportEventResponse>().event.participantCount);

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

      // The field upload is gone: a field's rankings, seeds and withdrawals come from the feed (#2008).
      const addRes = await getApp().inject({
        method: 'POST',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participantIds: created.participantIds.slice(0, 2) },
      });
      expect(addRes.statusCode).toBe(200);
      for (const url of [`/api/v1/events/${eventId}/participants/upload/preview`, `/api/v1/events/${eventId}/participants/upload`]) {
        // poolmaster-allow-query-in-loop: two removed routes, each asked once
        const removed = await getApp().inject({ method: 'POST', url, headers: rootAdmin.headers, payload: { rows: [{ participantId: created.participantIds[0], ranking: 3 }] } });
        expect(removed.statusCode).toBe(404);
      }

      // A ranking or seed past a 32-bit integer is refused by the grid save as validation (400),
      // not a 500 from the database.
      const loadedFieldRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
      });
      const loadedField = loadedFieldRes.json<{ participants: Array<{ id: string; participantId: string }> }>().participants;
      const fieldRowId = loadedField[0].id;
      const oversizedSaveRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, seedNumber: 2 ** 31 }] },
      });
      expect(oversizedSaveRes.statusCode).toBe(400);
      expect(ErrorEnvelopeSchema.safeParse(oversizedSaveRes.json()).success).toBe(true);

      // updateEventParticipants (200): a withdrawn golfer reinstated with status ACTIVE is back
      // in the field.
      const withdrawRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, status: 'WITHDRAWN' }] },
      });
      expect(withdrawRes.statusCode).toBe(200);
      const reinstateRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: fieldRowId, status: 'ACTIVE' }] },
      });
      expect(reinstateRes.statusCode).toBe(200);
      const reinstated = SportEventParticipantListResponseSchema.safeParse(reinstateRes.json());
      expect(reinstated.success).toBe(true);
      expect(reinstated.data?.participants.find((row) => row.id === fieldRowId)).toMatchObject({ status: 'ACTIVE' });

      const firstGolferRowId = loadedField.find((row) => row.participantId === created.participantIds[0])?.id;
      const rankSaveRes = await getApp().inject({
        method: 'PATCH',
        url: `/api/v1/events/${eventId}/participants`,
        headers: rootAdmin.headers,
        payload: { participants: [{ sportEventParticipantId: firstGolferRowId, ranking: 3 }] },
      });
      expect(rankSaveRes.statusCode).toBe(200);
      expect(SportEventParticipantListResponseSchema.safeParse(rankSaveRes.json()).success).toBe(true);

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
      // A tiered setup over the event's slot: its tiers and prices are what such a contest picks from.
      const { seasonSlot } = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { seasonSlot: { select: { sportLeagueCompetitionSlotId: true } } } });
      const tieredSetup = await getPrisma().contestConfigTemplate.create({
        data: { sportLeagueId: leagueId, templateKey: `z3l-tiered-${stamp}`, coverageMode: 'ONE_SLOT', contestFormat: 'ROSTER', selectionType: 'TIERED', name: 'Tiered', description: 'Tiered', sortOrder: 1, configJson: {} },
      });
      await getPrisma().contestConfigTemplateSlot.create({ data: { sportLeagueId: leagueId, templateId: tieredSetup.id, sportLeagueCompetitionSlotId: seasonSlot.sportLeagueCompetitionSlotId } });
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
            { tierKey: 'tier-1', tierNumber: 1 },
            { tierKey: 'tier-2', tierNumber: 2 },
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
        payload: await standardPricingIn(getPrisma()),
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

      // --- the slot tier routes (#2044): reads 200, every write 409 once the tier-set slot is released ---
      const { sportLeagueSeasonCompetitionSlotId: seasonSlotId } = await getPrisma().sportEventSlot.findFirstOrThrow({ where: { sportEventId: eventId }, select: { sportLeagueSeasonCompetitionSlotId: true } });
      const slotRoute = (path: string) => `/api/v1/events/${eventId}/slots/${seasonSlotId}/${path}`;
      const slotTiersRes = await getApp().inject({ method: 'GET', url: slotRoute('tiers'), headers: rootAdmin.headers });
      expect(slotTiersRes.statusCode).toBe(200);
      expect(SportEventTierListResponseSchema.safeParse(slotTiersRes.json()).success).toBe(true);
      const slotFieldRes = await getApp().inject({ method: 'GET', url: slotRoute('participants'), headers: rootAdmin.headers });
      expect(slotFieldRes.statusCode).toBe(200);
      const slotField = SportEventParticipantListResponseSchema.safeParse(slotFieldRes.json());
      expect(slotField.success).toBe(true);
      const someEntryId = slotField.data?.participants[0]?.id ?? randomUUID();
      const slotWrites = [
        { method: 'PUT', path: 'tiers', payload: { tiers: [{ tierKey: 'tier-1', tierNumber: 1 }] } },
        { method: 'POST', path: 'tiers/auto-assign', payload: {} },
        { method: 'PUT', path: 'tiers/assignments', payload: { assignments: [{ sportEventParticipantId: someEntryId, tierKey: 'tier-1', tierOrderIndex: 1 }] } },
        { method: 'POST', path: 'prices/auto-assign', payload: await standardPricingIn(getPrisma()) },
      ] as const;
      for (const write of slotWrites) {
        // poolmaster-allow-query-in-loop: four routes, one request each
        const lockedRes = await getApp().inject({ method: write.method, url: slotRoute(write.path), headers: rootAdmin.headers, payload: write.payload });
        expect([write.path, lockedRes.statusCode, ErrorEnvelopeSchema.safeParse(lockedRes.json()).success, lockedRes.json<ErrorEnvelope>().error.code]).toEqual([write.path, 409, true, 'SPORT_EVENT_TIERS_LOCKED']);
      }

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
      // The league's one Season, the 2081 Season the test made current.
      expect(seasons.data?.seasons.map((season) => [season.championshipYear, season.isCurrent])).toEqual([[2081, true]]);
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
          // The rounds' FIELD matches name the golfers as sides (#2008).
          await prisma.sportEventRoundMatch.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
          await prisma.sportEventParticipantStanding.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventSlotParticipantValuation.deleteMany({ where: { sportEventParticipantId: { in: sepIds } } });
          await prisma.sportEventParticipant.deleteMany({ where: { id: { in: sepIds } } });
        }
        await prisma.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: created.eventIds } } } });
        await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: created.eventIds } } });
        await prisma.sportEvent.deleteMany({ where: { id: { in: created.eventIds } } });
      }
      if (created.participantIds.length) {
        await prisma.participantProviderMapping.deleteMany({
          where: { participantId: { in: created.participantIds } },
        });
      }
      if (created.participantIds.length) {
        await prisma.participant.deleteMany({ where: { id: { in: created.participantIds } } });
      }
      if (created.sportLeagueId) {
        await prisma.contestConfigTemplate.deleteMany({ where: { sportLeagueId: created.sportLeagueId } });
        await deleteTestSportLeagues(prisma, [created.sportLeagueId]);
      }
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
      create: { sport: 'GOLF', ...sportRowKeys('GOLF') },
      update: {},
    });
    const synced = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Sync Now Tour ${stamp}` } });
    // A migration's league has its Seasons mapped to the provider's, one of them current (#2003).
    const sportLeagueProviderMappingId = await syncLeagueTo(prisma, synced.id, 'pga');
    const [seasonId] = await syncSeasonsTo(prisma, synced.id, sportLeagueProviderMappingId, [2085]);
    // Each tournament plays a slot of the Season a template lists, so the sync creates its event.
    for (const code of [`${tour}-alpha`, `${tour}-bravo`]) await syncSlotsFor(prisma, { sportLeagueId: synced.id, sportLeagueProviderMappingId, code, seasonIds: [seasonId] });
    const unsynced = await prisma.sportLeague.create({ data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Sync Now Manual Tour ${stamp}` } });

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
      expect(await prisma.sportEvent.count({ where: { sportLeagueId: synced.id, sportLeagueSeasonId: seasonId } })).toBe(2);

      const refusedRes = await app.inject({
        method: 'POST',
        url: `/api/v1/ingestion/sport-leagues/${unsynced.id}/events-sync`,
        headers: rootAdmin.headers,
        payload: {},
      });
      expect(refusedRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.parse(refusedRes.json()).error.code).toBe('SPORT_LEAGUE_NOT_SYNCED');
    } finally {
      const eventIds = (await prisma.sportEvent.findMany({ where: { sportLeagueId: { in: [synced.id, unsynced.id] } }, select: { id: true } }))
        .map((event) => event.id);
      await prisma.sportEventRound.deleteMany({ where: { sportEventId: { in: eventIds } } });
      await prisma.sportEventSlotTier.deleteMany({ where: { slot: { sportEventId: { in: eventIds } } } });
      await prisma.sportEvent.deleteMany({ where: { id: { in: eventIds } } });
      await prisma.contestConfigTemplate.deleteMany({ where: { sportLeagueId: synced.id } });
      await deleteTestSportLeagues(prisma, [synced.id, unsynced.id]);
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
      create: { sport: 'HORSE_RACING', ...sportRowKeys('HORSE_RACING') },
      update: {},
    });
    const golf = await prisma.sport.upsert({
      where: { sport: 'GOLF' },
      create: { sport: 'GOLF', ...sportRowKeys('GOLF') },
      update: {},
    });
    // A result row names its runner by id (#2114); a name no runner has stands for one not in the field.
    const participantIdByName = new Map<string, string>();
    const createEvent = async (sport: 'HORSE_RACING' | 'GOLF', sportId: string, names: string[], { testEvent = true } = {}) => {
      const event = await prisma.sportEvent.create({
        data: {
          ...(await freshEventEdition(prisma, { sport })),
          name: `Race Contract ${sport} ${stamp}`,
          startDate: new Date('2026-05-02T22:00:00.000Z'),
          status: 'SCHEDULED',
        },
      });
      // The admin result routes write only on a test event (#2074).
      if (testEvent) {
        await linkTestSlot(prisma, event);
        // A race is a FIELD match in the event's first round (#2008).
        await createRoundRows(prisma, new PrismaSportEventRoundRepository(getAppPrisma()), event, [{ roundNumber: 1, scheduledDate: event.startDate }]);
      }
      for (const name of names) {
        const participant = await prisma.participant.create({ data: { sportLeagueId: await participantLeagueId(prisma, sportId), name: `${name} ${stamp}`, participantType: 'INDIVIDUAL' } });
        participantIdByName.set(name, participant.id);
        await prisma.sportEventParticipant.create({ data: { sportEventId: event.id, participantId: participant.id } });
      }
      return event;
    };
    const race = await createEvent('HORSE_RACING', horseRacing.id, ['Arrow', 'Bolt']);
    const golfEvent = await createEvent('GOLF', golf.id, ['Golfer']);
    const finisher = (name: string, finishPosition: number | null) => ({
      participantId: participantIdByName.get(name) ?? randomUUID(), resultStatus: 'FINISHED', finishPosition, startPosition: null,
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
    const fedRace = await createEvent('HORSE_RACING', horseRacing.id, ['Comet'], { testEvent: false });
    await expectRefusal(await send('PUT', fedRace.id, { isOfficial: false, rows: [finisher('Comet', 1)] }), 409, 'SPORT_EVENT_NOT_TEST_DATA');
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
        // A Provider has no priority (#2073): neither its listed settings nor the page's ranges carry one.
        const listedBody = listRes.json<{ providers: Array<{ settings: Record<string, unknown> | null }>; settingRanges: Record<string, unknown> }>();
        expect(listedBody.providers.find((summary) => summary.settings?.['code'] === 'BALLDONTLIE')?.settings).not.toHaveProperty('priority');
        expect(listedBody.settingRanges).not.toHaveProperty('priority');

        const savedRes = await patch(`/api/v1/ingestion/provider-settings/${before.id}`, { requestsPerMinute: 600, webhookPollMinutes: 20 });
        expect(savedRes.statusCode).toBe(200);
        expect(ProviderSettingsResponseSchema.parse(savedRes.json()).provider).toMatchObject({ code: 'BALLDONTLIE', requestsPerMinute: 600, webhookPollMinutes: 20, webhookSecretSet: true });
        expect(savedRes.json<{ provider: Record<string, unknown> }>().provider).not.toHaveProperty('priority');

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

  it('createParticipant in a synced league answers 201 with a feed id and 409 PARTICIPANT_FEED_ID_REQUIRED without one, and deleteTestSlot answers 204 for a test slot and 422 SEASON_SLOT_NOT_TEST for a synced one', async () => {
    const prisma = getPrisma();
    const rootAdmin = await createTestUser({ displayName: 'Root Admin Synced Participants Contract User', isRootAdmin: true });
    const { id: leagueId } = await insertTestSportLeague(prisma, { sport: Sport.GOLF, name: `Synced Contract Tour ${randomUUID()}` });
    try {
      await syncLeagueTo(prisma, leagueId, 'pga');
      const create = (payload: Record<string, unknown>) => getApp().inject({
        method: 'POST', url: '/api/v1/participants', headers: rootAdmin.headers, payload: { sportLeagueId: leagueId, participantType: 'INDIVIDUAL', ...payload },
      });

      const mappedRes = await create({ name: 'Synced Contract Golfer', feedId: `contract-${randomUUID()}` });
      const testRes = await create({ name: 'Synced Contract Test Golfer', isTestData: true });
      const unmappedRes = await create({ name: 'Synced Contract Unmapped Golfer' });

      expect(mappedRes.statusCode).toBe(201);
      expect(ParticipantResponseSchema.safeParse(mappedRes.json()).success).toBe(true);
      expect(testRes.statusCode).toBe(201);
      expect(ParticipantResponseSchema.safeParse(testRes.json()).success).toBe(true);
      expect(unmappedRes.statusCode).toBe(409);
      expect(ErrorEnvelopeSchema.parse(unmappedRes.json()).error.code).toBe('PARTICIPANT_FEED_ID_REQUIRED');

      const slotId = await testSlotId(prisma, leagueId, new Date('2086-05-01T12:00:00.000Z'));
      const syncedSlotId = await testSlotId(prisma, leagueId, new Date('2086-06-01T12:00:00.000Z'));
      await prisma.sportLeagueSeasonCompetitionSlot.update({ where: { id: syncedSlotId }, data: { isTestData: false, label: null } });
      const deleteSlot = (id: string) => getApp().inject({
        method: 'DELETE', url: `/api/v1/sport-leagues/${leagueId}/test-slots/${id}`, headers: withoutJsonBodyHeaders(rootAdmin.headers),
      });

      const deletedRes = await deleteSlot(slotId);
      const refusedRes = await deleteSlot(syncedSlotId);

      expect(deletedRes.statusCode).toBe(204);
      expect(deletedRes.body).toBe('');
      expect(refusedRes.statusCode).toBe(422);
      expect(ErrorEnvelopeSchema.parse(refusedRes.json()).error.code).toBe('SEASON_SLOT_NOT_TEST');
    } finally {
      await prisma.participantProviderMapping.deleteMany({ where: { sportLeagueId: leagueId } });
      await prisma.participant.deleteMany({ where: { sportLeagueId: leagueId } });
      await deleteTestSportLeagues(prisma, [leagueId]);
    }
  });
});
