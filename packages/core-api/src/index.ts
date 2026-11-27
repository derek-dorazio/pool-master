// PoolMaster API entry point for the active backend-first product surface.

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';

// Core plugins
import { healthPlugin } from './plugins/health';
import { swaggerPlugin } from './plugins/swagger';
import { authGuard } from './plugins/auth-guard';
import { etagPlugin } from './plugins/etag-support';
import { requestLoggingContext } from './plugins/request-logging-context';
import { requestReadMemo } from './plugins/request-read-memo';
import { requestJobStart } from './plugins/request-job-start';
import { requestQueryUsage } from './plugins/request-query-usage';
import { FASTIFY_AJV_OPTIONS } from './plugins/string-transforms';
import { FASTIFY_SCHEMA_CONTROLLER } from './plugins/serializer-cache';
import { globalErrorHandler } from './core/error-handler';
import { createFastifyLoggerOptions } from './core/logger';
import { readListenPort, readTrustProxy } from './core/config';
import { currentJobStart } from './core/job-start';
import { readTaskRole, taskRolePlan } from './core/task-role';
import { PostgresJobLock } from './core/job-lock';
import { NightlyCleanupScheduler } from './core/nightly-cleanup';
import { createCdnInvalidator } from './core/cdn-invalidator';
import { countingQueries } from './core/request-query-usage';

// Domain modules (core-api)
import { authModule } from './modules/auth/routes';
import { RefreshTokenRetention } from './modules/auth/refresh-token-retention';
import { AbandonedDraftRetention } from './modules/contests/abandoned-draft-retention';
import { leaguesModule } from './modules/leagues/routes';
import { squadsModule } from './modules/squads/routes';
import { invitationsModule } from './modules/invitations/routes';
import { teamInvitationsModule } from './modules/team-invitations/routes';
import { contestsModule, contestsByIdModule } from './modules/contests/routes';
import { cupsModule } from './modules/cups/routes';
import { championshipModule } from './modules/championship/routes';
import { historyModule } from './modules/history/routes';
import { contestManagementModule } from './modules/contest-management/routes';
import { contestConfigTemplatesModule } from './modules/contest-config-templates/routes';
import { eventsModule } from './modules/events/routes';
import { SlotTiebreakerService } from './modules/events/slot-tiebreaker-service';
import { PrismaSlotTiebreakerRepository } from './adapters/prisma-slot-tiebreaker-repository';
import { SlotStatusService } from './modules/events/slot-status-service';
import { PrismaSlotStatusRepository } from './adapters/prisma-slot-status-repository';
import { ChampionshipYearCloseService } from './modules/championship/year-close-service';
import { PrismaLeagueChampionshipYearRepository } from './adapters/prisma-league-championship-year-repository';
import { sportsModule } from './modules/sports/routes';
import { sportLeaguesModule } from './modules/sport-leagues/routes';
import { platformPricingProfilesModule, platformTierProfilesModule } from './modules/profiles/routes';
import { createProfileServices } from './modules/profiles/wiring';
import { eventPagesModule } from './modules/event-pages/routes';
import { participantsModule } from './modules/participants/routes';
import { usersModule } from './modules/users/routes';
import { platformModule } from './modules/platform/routes';
import { IngestionConfigService } from './modules/platform/ingestion-config-service';
import { AppSettingsService } from './modules/platform/app-settings-service';
import { SETTINGS_GROUPS } from './modules/platform/settings-groups';
import { PlatformSettingsService } from './modules/platform/platform-settings-service';
import { ingestionModule } from './modules/ingestion/routes';
import { providerWebhooksModule, readBalldontlieWebhookSecret } from './modules/ingestion/provider-webhook-routes';
import { ProviderNotificationService } from './modules/ingestion/provider-notifications';
import { ProviderCode, ProviderSyncKind } from '@poolmaster/shared/domain';
import { notifiedProviderCadenceOf, providerLeagueQuietAfterMs, providerLeagueSendsNotifications } from './modules/ingestion/notified-provider-cadence';
import { ProviderSettingsStore } from './modules/ingestion/provider-settings-store';
import { ProviderWebhookSwitch } from './modules/ingestion/provider-webhook-switch';
import { providerLookupOf } from './modules/ingestion/provider-lookup';
import { ProviderSettingsService } from './modules/ingestion/provider-settings-service';
import { PrismaProviderSettingsRepository } from './adapters/prisma-provider-settings-repository';
import { IngestionService } from './modules/ingestion/ingestion-service';
import { plansModule } from './modules/plans/routes';
import { PlanEntitlementsService } from './modules/plans/plan-entitlements-service';
import { PLAN_SETTINGS } from './modules/plans/plan-settings';
import { BILLING_SETTINGS } from './modules/billing/billing-settings';
import { billingModule } from './modules/billing/routes';
import {
  PrismaLeagueRepository,
  PrismaContestRepository,
  PrismaParticipantProviderMappingRepository,
  PrismaParticipantRepository,
  PrismaPlatformRuntimeConfigRepository,
  PrismaProviderSyncRunRepository,
  PrismaUserRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaBackgroundJobRepository,
  PrismaSportEventRoundMatchGameRepository,
  PrismaSportLeagueRepository,
  PrismaSquaresRepository,
} from './adapters';
import { clientLogsModule } from './modules/client-logs/routes';
import { versionModule } from './modules/version/routes';

// Draft module
import { selectionsModule } from './modules/selections/routes';
import { pickPreviewModule } from './modules/selections/preview-routes';
import { createDrawReceipts, createSquaresService } from './modules/selections/wiring';

// Ingestion module
import { ProviderRegistry, EventFeedSync, publishLiveScoreUpdate } from './modules/ingestion/core';
import type { IngestionCallbacks, SportEventDetail } from './modules/ingestion/core';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { createEventLifecycleService, createSportEventServices, eventFieldCache } from './modules/events/wiring';
import { DomainEvents } from './modules/domain-events';
import { EventLifecycleScheduler } from './modules/events/event-lifecycle-scheduler';
import { SquaresAutoDrawScheduler } from './modules/selections/squares-auto-draw-scheduler';
import { SportEventAutoReleaseScheduler } from './modules/events/sport-event-auto-release-scheduler';
import { releaseSportEventJobHandler } from './modules/events/release-sport-event-job';
import { ProviderSeasonScheduleReader } from './modules/events/provider-season-schedule-reader';
import { SyncTick } from './modules/ingestion/sync-tick';
import { EventSyncJobs } from './modules/ingestion/event-sync-jobs';
import { PrismaSyncDueWorkReader } from './adapters/prisma-sync-due-work-reader';
import { LeagueEventsSync } from './modules/events/league-events-sync';
import { LeagueRosterSync } from './modules/ingestion/roster/league-roster-sync';
import { PrismaSportLeagueRosterRepository } from './adapters/prisma-sport-league-roster-repository';
import { activityModule } from './modules/activity/routes';
import { ActivityService } from './modules/activity/activity-service';
import { customersModule } from './modules/customers/routes';
import { CustomerService } from './modules/customers/customer-service';
import { PrismaCustomerReader } from './adapters/prisma-customer-reader';
import { SyncedFieldValuationService } from './modules/events/synced-field-valuation';
import { SyncedFieldFollowUps } from './modules/events/synced-field-follow-ups';
import {
  createContestEmailJobs,
  createContestExpandedNotices,
  createContestNotices,
  createDueNotifications,
  createMemberJoinedNotices,
  DueNotificationKind,
  staggeredDueNotificationsSchedulers,
} from './modules/notifications';
import { ProviderSyncRunLedger } from './modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncRunDetailsRetention, SyncRunRetention } from './modules/ingestion/persistence/sync-run-retention';
import { ProviderSyncFindingService } from './modules/ingestion/findings/provider-sync-finding-service';
import { SyncFindingRetention } from './modules/ingestion/findings/sync-finding-retention';
import { CurrentSeasonRecompute } from './modules/sport-catalog/current-season-recompute';
import { PrismaSportLeagueSeasonRepository } from './adapters/prisma-sport-league-season-repository';
import { syncFindingsModule } from './modules/ingestion/findings/routes';
import { resolveMappedParticipantFindingsJobHandler } from './modules/ingestion/findings/mapped-participant-findings-job';
import { ProviderRateLimitWatch } from './modules/ingestion/findings/provider-rate-limit-watch';
import { PrismaSlotNamePatternRepository } from './adapters/prisma-slot-name-pattern-repository';
import { PrismaProviderSyncFindingRepository } from './adapters/prisma-provider-sync-finding-repository';
import { ParticipantService } from './modules/participants/service';
import { registerConfiguredProviders, type SportDataProviderFactory } from './modules/ingestion/core/provider-bindings';
import { createContestService, createContestSettlementService } from './modules/contests/wiring';
import { JobLeaderboardRebuilds, leaderboardChangesOf } from './modules/contests/leaderboard-rebuild-job-requests';
import { scoringFamilyForEvent } from './modules/scoring-families';
import {
  EMAIL_SETTINGS,
  createEmailOutbox,
  SnsMessageVerifier,
  readApplicationBaseUrl,
  readSesEventsTopicArn,
} from './modules/email';
import { emailEventsModule } from './modules/email/email-events-routes';
import { emailUnsubscribeModule } from './modules/email/email-unsubscribe-routes';
import { emailTestModule } from './modules/email/email-test-routes';
import { systemEmailModule } from './modules/email/system-email-routes';
import {
  BackgroundJobQueue,
  BackgroundJobRetention,
  BackgroundJobRunner,
  readBackgroundJobPollMs,
} from './modules/background-jobs';

export interface BuildAppOptions {
  /** Builds the sport data providers from the Provider rows; a test passes its own fake (#2039). */
  readonly buildSportDataProviders?: SportDataProviderFactory;
}

export function buildApp(options: BuildAppOptions = {}) {
  const app = Fastify({
    logger: createFastifyLoggerOptions('core-api'),
    trustProxy: readTrustProxy(),
    ajv: FASTIFY_AJV_OPTIONS,
    schemaController: FASTIFY_SCHEMA_CONTROLLER,
  });
  // Counts each request's queries against its budget (#1244).
  const prisma = countingQueries(new PrismaClient());
  const isOpenApiExport = process.env.OPENAPI_EXPORT === 'true';
  // Whether this task serves requests, runs the background work, or both (#1186).
  const role = taskRolePlan(readTaskRole(process.env));

  app.decorate('prisma', prisma);

  // The providers come from their rows (#1997): read, and their adapters registered, when the app is ready.
  const registry = new ProviderRegistry();
  const providerSettingsRepository = new PrismaProviderSettingsRepository(prisma);
  const providerSettings = new ProviderSettingsStore(providerSettingsRepository, app.log);
  const balldontlieWebhookSecret = readBalldontlieWebhookSecret(process.env);
  const providerWebhooks = new ProviderWebhookSwitch(providerSettings, {
    ...(balldontlieWebhookSecret !== undefined && { [ProviderCode.BALLDONTLIE]: balldontlieWebhookSecret }),
  });
  const providers = providerLookupOf(providerSettings, registry);
  const webhookProviderIds = () => providerWebhooks.onProviderIds();
  const runtimeConfigRepository = new PrismaPlatformRuntimeConfigRepository(prisma);
  const appSettings = new AppSettingsService({
    repository: runtimeConfigRepository,
    groups: SETTINGS_GROUPS,
    env: process.env,
    logger: app.log,
  });
  // The one reader of PLAN_CONFIG: what each league's plan allows (#944).
  const planEntitlements = new PlanEntitlementsService({
    leagues: new PrismaLeagueRepository(prisma),
    readConfig: () => appSettings.get(PLAN_SETTINGS),
  });
  // One email outbox for the whole app; EMAIL_CONFIG and the league's plan decide on every email whether it is queued.
  const { email, sender: emailSender, deliveryEvents, preferences: emailPreferences, test: emailTest, retention: emailRetention, systemEmails } = createEmailOutbox({
    prisma,
    readConfig: () => appSettings.get(EMAIL_SETTINGS),
    planEntitlements,
    env: process.env,
    logger: app.log,
    wakesSender: role.runsBackgroundWork,
    senderTickMs: role.emailSenderTickMs,
  });
  const appBaseUrl = readApplicationBaseUrl(process.env);
  // Work a request hands off rather than waits for (#1439): queued here, run by the runner below.
  const backgroundJobRepository = new PrismaBackgroundJobRepository(prisma);
  // Each job records what started it: the request, sweep or job's handler under way (#1861).
  // A sync job is keyed to its Provider row from the settings the task holds (#2040).
  const backgroundJobs = new BackgroundJobQueue({ jobs: backgroundJobRepository, currentStart: currentJobStart, providerIdOf: (code) => providerSettings.byCode(code)?.id });
  const contestNotices = createContestNotices(prisma, { email, jobs: backgroundJobs, appBaseUrl, logger: app.log });
  // A contest going live or completing queues its league's email as a job (#1387).
  const contestEmailJobs = createContestEmailJobs(prisma, { notices: contestNotices, logger: app.log });
  // Live leaderboards are computed once per score write (#1435): every write that changes what a
  // board is computed from tells this, which queues one rebuild job per event or contest (#1463).
  const leaderboards = new JobLeaderboardRebuilds(backgroundJobs);
  const leaderboardRebuilder = createContestService(prisma, app.log, { planEntitlements });
  // What follows each change (#1946): built once, with every dependency its handlers need.
  const domainEvents = new DomainEvents({
    queue: backgroundJobs,
    sportEventChanged: contestNotices,
  });
  // The one list of problems the sync found (#1999); the sync raises them, Findings lists them.
  const syncFindingRepository = new PrismaProviderSyncFindingRepository(prisma);
  const syncFindings = new ProviderSyncFindingService({
    repository: syncFindingRepository,
    providers: providerSettings,
    participants: new ParticipantService(new PrismaParticipantRepository(prisma), new PrismaParticipantProviderMappingRepository(prisma), domainEvents, app.log),
    slotNamePatterns: new PrismaSlotNamePatternRepository(prisma),
    logger: app.log,
  });
  // Each event slot's tiebreaker game (#2048): the rule's job and the Slots tab both write through it.
  const slotTiebreakers = new SlotTiebreakerService({
    slots: new PrismaSlotTiebreakerRepository(prisma),
    findings: syncFindings,
    domainEvents,
    logger: app.log,
  });
  // A Provider that keeps rate limiting raises a finding on each league it syncs (#2038).
  const providerRateLimits = new ProviderRateLimitWatch({
    findings: syncFindings,
    providers: providerSettings,
    syncedLeagues: () => new PrismaSportLeagueRepository(prisma).findEventSynced(),
    logger: app.log,
  });
  const contestSettlement = createContestSettlementService(prisma, app.log, { domainEvents });
  const eventLifecycleService = createEventLifecycleService(prisma, {
    domainEvents,
    logger: app.log,
    contestSettlement,
  });
  // Status bubbles up from Matches to slots to the event (#2013), on the refresh jobs' handlers.
  const slotStatuses = new SlotStatusService({
    slots: new PrismaSlotStatusRepository(prisma),
    sportEvents: new PrismaSportEventRepository(prisma),
    eventLifecycle: eventLifecycleService,
    domainEvents,
    logger: app.log,
  });
  // A league's championship year closes once nothing in it is unfinished (#2021), on the close jobs' handlers.
  const championshipYears = new ChampionshipYearCloseService({ years: new PrismaLeagueChampionshipYearRepository(prisma), logger: app.log });
  // One set of event services for the admin routes, the synced event creation sweep and the draft event notices.
  const sportEventServices = createSportEventServices(prisma, app.log.child({ module: 'events.service' }), eventLifecycleService, domainEvents, providers);
  const memberJoined = createMemberJoinedNotices(prisma, { email, readConfig: () => appSettings.get(EMAIL_SETTINGS), appBaseUrl, logger: app.log });
  // Admin saves, and provider syncs that load an event's field, clear the public reads CloudFront keeps (#1181).
  const cdn = createCdnInvalidator(process.env, app.log);
  const ingestionPersistence = new IngestionPersistence(prisma, domainEvents, app.log, eventFieldCache, cdn, syncFindings);
  const jobLock = new PostgresJobLock(process.env.DATABASE_URL, app.log);
  const eventLifecycleScheduler = new EventLifecycleScheduler({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    eventLifecycleService,
    jobLock,
    logger: app.log,
  });
  // A squares board nobody has drawn draws its numbers five minutes before kickoff (#1760).
  const squaresAutoDrawScheduler = new SquaresAutoDrawScheduler({
    squares: new PrismaSquaresRepository(prisma),
    service: createSquaresService(prisma, app.log.child({ module: 'squares.autoDraw' }), { email, appBaseUrl }),
    jobLock,
    logger: app.log,
  });
  // The emails that come due on the clock (#845), each kind on a timer and lock of its own so a
  // slow one never holds up another or the lifecycle sweep, their ticks spread over the interval.
  const dueNotificationsSchedulers = staggeredDueNotificationsSchedulers([
    ...createDueNotifications(prisma, {
      email,
      readConfig: () => appSettings.get(EMAIL_SETTINGS),
      appBaseUrl,
      logger: app.log,
      planEntitlements,
      memberJoined,
      releaseReadiness: sportEventServices.sportEvents,
    }),
    // A sweepstakes draw's receipts, queued by the draw for the sweep (#1171).
    { kind: DueNotificationKind.DRAW_RECEIPTS, notifications: createDrawReceipts(prisma, app.log, { email, appBaseUrl, planEntitlements }) },
  ], { jobLock, logger: app.log });
  const providerSyncRuns = new PrismaProviderSyncRunRepository(prisma);
  // #1175: tables that grow without end are trimmed to their retention periods once a night.
  const nightlyCleanupScheduler = new NightlyCleanupScheduler({
    steps: [
      new RefreshTokenRetention(prisma),
      emailRetention,
      new SyncRunDetailsRetention(providerSyncRuns),
      new SyncRunRetention(providerSyncRuns),
      new SyncFindingRetention(syncFindingRepository),
      new AbandonedDraftRetention(new PrismaContestRepository(prisma), app.log),
      new BackgroundJobRetention(backgroundJobRepository),
      new CurrentSeasonRecompute(new PrismaSportLeagueSeasonRepository(prisma), app.log),
    ],
    jobLock,
    logger: app.log,
  });
  const ingestionConfigService = new IngestionConfigService(appSettings, app.log);
  const platformSettingsService = new PlatformSettingsService({
    settings: appSettings,
    runtimeConfigs: runtimeConfigRepository,
    users: new PrismaUserRepository(prisma),
    logger: app.log,
  });

  // =========================================================================
  // Core plugins
  // =========================================================================
  app.register(requestReadMemo);
  app.register(requestJobStart);
  app.register(requestQueryUsage);
  app.register(swaggerPlugin);
  app.register(healthPlugin);
  app.register(versionModule, { prefix: '/version', operationId: 'getRootVersion' });
  app.register(etagPlugin);
  app.register(authGuard);
  app.register(requestLoggingContext);
  app.setErrorHandler(globalErrorHandler);

  // =========================================================================
  // Auth (public routes — no JWT required)
  // =========================================================================
  app.register(authModule, { prefix: '/api/v1/auth', email });
  app.register(usersModule, { prefix: '/api/v1/users', email, emailPreferences });
  app.register(versionModule, { prefix: '/api/v1/version', operationId: 'getVersion' });

  const ingestionCallbacks: IngestionCallbacks = {
    async onEventDetail(detail: SportEventDetail) {
      app.log.info({
        providerId: detail.providerId,
        eventExternalId: detail.externalId,
        sport: detail.sport,
        name: detail.name,
        startDate: detail.startDate.toISOString(),
        participantCount: detail.participants.length,
      }, 'Ingested event detail');
      const persisted = await ingestionPersistence.persistEventDetailWithDiagnostics(detail);
      app.log.info({ persisted: persisted.value }, 'Persisted event detail');
      // Its games and then its tiers and prices follow in a job written with the field (#1952).
      return persisted;
    },
    async onLiveScores(result: LiveScoreResult, providerId: string) {
      app.log.info({
        category: result.category,
        providerId,
      }, 'Ingested live scores (typed LiveScoreResult)');
      return publishLiveScoreUpdate(result, {
        prisma,
        providerId,
        domainEvents,
        contestActivation: eventLifecycleService,
        findings: syncFindings,
        logger: app.log,
        scoringFamilyForEvent,
        fieldCache: eventFieldCache,
      });
    },
  };

  const providerSyncRunLedger = new ProviderSyncRunLedger(providerSyncRuns, app.log, syncFindings);
  // A synced draft event is released on its own once its ready checks pass, in its league's window (#1823).
  const sportEventAutoReleaseScheduler = new SportEventAutoReleaseScheduler({
    sportEvents: new PrismaSportEventRepository(prisma),
    jobs: backgroundJobs,
    jobLock,
    logger: app.log,
  });
  const syncedFieldValuation = new SyncedFieldValuationService({
    sportEvents: new PrismaSportEventRepository(prisma),
    tiers: sportEventServices.tiers,
    logger: app.log.child({ module: 'events.syncedFieldValuation' }),
  });
  // A field sync's follow-ups, in its job: a synced league's event takes its games once its field
  // is in (ADR 0011, #1728), then its tiers and prices from that field (#1822, #1952).
  const syncedFieldFollowUps = new SyncedFieldFollowUps({
    providerGames: sportEventServices.providerGames,
    valuation: syncedFieldValuation,
    sportEvents: new PrismaSportEventRepository(prisma),
    findings: syncFindings,
  });
  // A sport league's events sync (#1819): the schedule and an admin's Sync now queue the same job.
  const leagueEventsSync = new LeagueEventsSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    seasonSchedule: new ProviderSeasonScheduleReader(prisma, registry),
    sportEvents: sportEventServices.sportEvents,
    findings: syncFindings,
    syncRuns: providerSyncRuns,
    jobs: backgroundJobs,
    logger: app.log,
  });
  // Each synced league's roster for its current Season (#2025), queued by the sync tick.
  const leagueRosterSync = new LeagueRosterSync({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    seasons: new PrismaSportLeagueSeasonRepository(prisma),
    rosterSource: new ProviderSeasonScheduleReader(prisma, registry),
    rosters: new PrismaSportLeagueRosterRepository(prisma),
    findings: syncFindings,
    syncRuns: providerSyncRuns,
    domainEvents,
    logger: app.log,
  });
  // The one scheduler of provider syncs (#2009): each minute it queues the due syncs as jobs.
  const syncTick = new SyncTick({
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    dueWork: new PrismaSyncDueWorkReader(prisma),
    jobHistory: backgroundJobRepository,
    jobs: backgroundJobs,
    registry,
    schedule: ingestionConfigService,
    notifiedProviderCadence: () => notifiedProviderCadenceOf(providerSettings, providerWebhooks),
    quietAfterMs: providerLeagueQuietAfterMs(providerSettings),
    leagueSendsNotifications: providerLeagueSendsNotifications(providerSettings),
    findings: syncFindings,
    jobLock,
    logger: app.log,
  });
  // An event's field and scores syncs, whoever queued them: the tick, a webhook or Sync now.
  const eventSyncJobs = new EventSyncJobs({
    sportEvents: new PrismaSportEventRepository(prisma),
    feeds: new EventFeedSync(registry, ingestionCallbacks, app.log),
    syncRuns: providerSyncRuns,
    syncRunLedger: providerSyncRunLedger,
    registry,
    schedule: ingestionConfigService,
    logger: app.log,
  });
  const ingestionService = new IngestionService({
    registry,
    sportEvents: new PrismaSportEventRepository(prisma),
    syncRuns: providerSyncRuns,
    sportLeagues: new PrismaSportLeagueRepository(prisma),
    providerSettings,
    webhooks: providerWebhooks,
    jobHistory: backgroundJobRepository,
    syncRunLedger: providerSyncRunLedger,
    jobs: backgroundJobs,
    logger: app.log,
  });
  // The task that runs the background work runs the job runner (#1186); a job it queues itself wakes
  // it, and one an API-only task queued is found by its poll.
  const backgroundJobRunner = new BackgroundJobRunner({
    jobs: backgroundJobRepository,
    handlers: {
      SYNC_EVENT_FIELD: (payload, context) => eventSyncJobs.run(ProviderSyncKind.FIELD, payload, context),
      SYNC_EVENT_SCORES: (payload, context) => eventSyncJobs.run(ProviderSyncKind.SCORES, payload, context),
      CONTEST_STARTED_EMAILS: (payload) => contestEmailJobs.contestStarted(payload),
      CONTEST_SETTLED_EMAILS: (payload) => contestEmailJobs.contestSettled(payload),
      CONTEST_EVENT_CHANGED_EMAILS: (payload) => contestEmailJobs.contestEventChanged(payload),
      CONTEST_REOPENED_EMAILS: (payload) => contestEmailJobs.contestReopened(payload),
      SETTLE_SPORT_EVENT_CONTESTS: (payload) => eventLifecycleService.settleFinishedEventContests(payload),
      SETTLE_GAME_CONTESTS: (payload) => eventLifecycleService.settleFinishedGameContests(payload),
      REBUILD_LEADERBOARDS: async (payload) => ({ changedCount: await leaderboardRebuilder.rebuildLeaderboardSnapshots(leaderboardChangesOf(payload)) }),
      SYNC_LEAGUE_EVENTS: (payload, context) => leagueEventsSync.run(payload, context),
      RELEASE_SPORT_EVENT: releaseSportEventJobHandler(sportEventServices.sportEvents),
      SYNC_EVENT_GAMES_AND_TIERS: (payload) => syncedFieldFollowUps.run(payload),
      ACTIVATE_EVENT_CONTESTS: (payload) => eventLifecycleService.activateEventContests(payload),
      FOLLOW_POSTPONED_EVENT_CONTESTS: (payload) => eventLifecycleService.followPostponedEventContests(payload),
      RESOLVE_MAPPED_PARTICIPANT_FINDINGS: resolveMappedParticipantFindingsJobHandler(syncFindings),
      REFRESH_SLOT_TIEBREAKERS: (payload) => slotTiebreakers.refresh(payload.sportEventId),
      SYNC_LEAGUE_ROSTER: (payload, context) => leagueRosterSync.run(payload, context),
      REFRESH_SLOT_STATUS: (payload) => slotStatuses.refreshSlots(payload.sportEventId),
      REFRESH_EVENT_STATUS: (payload) => slotStatuses.refreshEvent(payload.sportEventId),
      CLOSE_LEAGUE_CHAMPIONSHIP_YEAR: (payload) => championshipYears.closeContestYear(payload.contestId),
      CLOSE_SEASON_CHAMPIONSHIP_YEARS: (payload) => championshipYears.closeSeasonYears(payload.seasonSlotId),
    },
    pollMs: readBackgroundJobPollMs(process.env),
    logger: app.log,
  });
  if (role.runsBackgroundWork) backgroundJobs.wakes(backgroundJobRunner);

  // =========================================================================
  // Domain modules (protected by auth-guard)
  // =========================================================================
  app.register(leaguesModule, { prefix: '/api/v1/leagues', email, planEntitlements, memberJoined });
  app.register(plansModule, {
    prefix: '/api/v1/plans',
    planEntitlements,
    readBillingConfig: () => appSettings.get(BILLING_SETTINGS),
  });
  app.register(billingModule, {
    prefix: '/api/v1/leagues/:id/billing',
    planEntitlements,
    readBillingConfig: () => appSettings.get(BILLING_SETTINGS),
    contestExpanded: createContestExpandedNotices(prisma, { email, appBaseUrl, logger: app.log }),
  });
  app.register(squadsModule, { prefix: '/api/v1/leagues/:id/squads', email, memberJoined });
  app.register(invitationsModule, { prefix: '/api/v1/invitations', email, memberJoined });
  app.register(teamInvitationsModule, { prefix: '/api/v1/team-invitations', email, memberJoined });
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests', email, planEntitlements, domainEvents });
  app.register(contestManagementModule, {
    prefix: '/api/v1/leagues/:id/contest-management',
    email,
    planEntitlements,
    domainEvents,
  });
  app.register(contestsByIdModule, { prefix: '/api/v1/contests', email, planEntitlements });
  app.register(cupsModule, { prefix: '/api/v1/leagues/:id/cups', planEntitlements });
  app.register(championshipModule, { prefix: '/api/v1/leagues/:id/championship', planEntitlements });
  app.register(historyModule, { prefix: '/api/v1/leagues/:id/history', email, planEntitlements });
  app.register(contestConfigTemplatesModule, { prefix: '/api/v1/contest-config-templates', cdn });
  app.register(eventsModule, {
    prefix: '/api/v1/events',
    eventLifecycleService,
    ingestionService,
    providerRegistry: registry,
    cdn,
    domainEvents,
    leaderboards,
    services: sportEventServices,
    webhookProviderIds,
    slotTiebreakers,
  });
  app.register(sportsModule, { prefix: '/api/v1/sports' });
  app.register(sportLeaguesModule, {
    prefix: '/api/v1/sport-leagues',
    cdn,
    providers,
    webhookProviderIds,
  });
  const profiles = createProfileServices(prisma, app.log);
  app.register(platformTierProfilesModule, { prefix: '/api/v1/tier-profiles', platformTierProfiles: profiles.platformTierProfiles });
  app.register(platformPricingProfilesModule, { prefix: '/api/v1/pricing-profiles', platformPricingProfiles: profiles.platformPricingProfiles });
  app.register(eventPagesModule, { prefix: '/api/v1/event-pages' });
  app.register(participantsModule, { prefix: '/api/v1/participants', domainEvents });
  app.register(platformModule, { prefix: '/api/v1/platform', ingestionConfigService, platformSettingsService, cdn });
  app.register(emailTestModule, { prefix: '/api/v1/platform/email', emailTest });
  app.register(systemEmailModule, { prefix: '/api/v1/platform/emails', systemEmails });
  const activity = new ActivityService({
    jobs: backgroundJobRepository,
    syncRuns: providerSyncRuns,
    sportEvents: new PrismaSportEventRepository(prisma),
    sportLeagues: new PrismaSportLeagueRepository(prisma),
  });
  app.register(ingestionModule, {
    prefix: '/api/v1/ingestion',
    ingestionService,
    providerRegistry: registry,
    leagueEventsSync,
    activity,
    providerSettings: new ProviderSettingsService({ repository: providerSettingsRepository, store: providerSettings, webhooks: providerWebhooks, logger: app.log }),
  });
  app.register(syncFindingsModule, { prefix: '/api/v1/ingestion/sync-findings', syncFindings });
  app.register(activityModule, { prefix: '/api/v1/activity', activity });
  app.register(customersModule, {
    prefix: '/api/v1/customers',
    customers: new CustomerService({ reader: new PrismaCustomerReader(prisma), logger: app.log }),
  });
  app.register(clientLogsModule, { prefix: '/api/v1/client-logs' });
  app.register(providerWebhooksModule, {
    prefix: '/api/v1/provider-webhooks',
    notifications: new ProviderNotificationService({
      sportEvents: new PrismaSportEventRepository(prisma),
      games: new PrismaSportEventRoundMatchGameRepository(prisma),
      sportLeagues: new PrismaSportLeagueRepository(prisma),
      findings: syncFindings,
      jobs: backgroundJobs,
      logger: app.log,
    }),
    webhooks: providerWebhooks,
    providerSettings,
  });
  app.register(emailEventsModule, {
    prefix: '/api/v1/email',
    deliveryEvents,
    verifier: new SnsMessageVerifier(),
    topicArn: readSesEventsTopicArn(),
  });
  app.register(emailUnsubscribeModule, { prefix: '/api/v1/email', preferences: emailPreferences });

  // =========================================================================
  // Draft module
  // =========================================================================
  app.register(selectionsModule, { prefix: '/api/v1/selections', email, planEntitlements, domainEvents });
  app.register(pickPreviewModule, { prefix: '/api/v1/leagues/:id/pick-preview', planEntitlements, domainEvents });

  // =========================================================================
  // Lifecycle hooks
  // =========================================================================
  app.addHook('onReady', async () => {
    if (isOpenApiExport) {
      return;
    }

    // Settings load before the server reports ready, so nothing serves the code defaults in
    // place of a stored value; the background refresh then carries other tasks' saves here.
    await appSettings.load();
    appSettings.start();
    // The provider rows load before any provider is called; a change of enable or the
    // leagues read takes effect when the task next starts, the rest on the next read (#1997).
    await providerSettings.load();
    providerSettings.start();
    registerConfiguredProviders(registry, providerSettings, process.env, app.log, options.buildSportDataProviders, (code) => providerRateLimits.observerFor(code));
    providerWebhooks.warnFlagsWithoutSecret(app.log);

    // An API-only task (#1186) serves requests and leaves everything below to the worker.
    if (!role.runsBackgroundWork) {
      app.log.info({ action: 'taskRole.apiOnly' }, 'Serving requests only; the worker runs the background work');
      return;
    }

    // A Provider's webhooks switched on with no signing secret here is an ERROR finding on each
    // league it syncs (#1999); setting the secret resolves it on the next start.
    // Not essential to starting: a failure is logged, and the schedulers below still start.
    try {
      await syncFindings.checkWebhookSecrets({
        syncedLeagues: await new PrismaSportLeagueRepository(prisma).findEventSynced(),
        isMissingSecret: (provider) => providerWebhooks.isFlagWithoutSecret(provider),
      });
    } catch (err) {
      app.log.error({ action: 'ingestion.syncFinding.webhookCheckFailed', err }, 'Checking provider webhook secrets for sync findings failed');
    }

    // Ingestion
    if (process.env.AUTO_START_SCHEDULER !== 'false') {
      syncTick.start();
    }

    // Admin-managed event lifecycle (plans/124 §3.6) — always runs; it is
    // platform-wide and not gated by AUTO_START_SCHEDULER, which controls
    // only provider-sync loops.
    eventLifecycleScheduler.start();
    app.log.info('Event lifecycle scheduler started');

    // The automatic squares draw always runs, like the lifecycle sweep: it follows game times, not a provider.
    squaresAutoDrawScheduler.start();

    // The automatic event release always runs, like the lifecycle sweep: each league's window turns it on or off.
    sportEventAutoReleaseScheduler.start();

    // The clock-driven emails always run, each on its own timer, as the lifecycle sweep does.
    for (const scheduler of dueNotificationsSchedulers) scheduler.start();

    // The email outbox's sender always runs: every email waits in the outbox for it.
    emailSender.start();

    // Retention always runs, like the lifecycle sweep: nothing about it depends on a provider.
    nightlyCleanupScheduler.start();

    // The job runner always runs: every queued job waits for it.
    backgroundJobRunner.start();
  });

  app.addHook('onClose', async () => {
    appSettings.stop();
    providerSettings.stop();
    syncTick.stop();
    eventLifecycleScheduler.stop();
    squaresAutoDrawScheduler.stop();
    sportEventAutoReleaseScheduler.stop();
    for (const scheduler of dueNotificationsSchedulers) scheduler.stop();
    emailSender.stop();
    nightlyCleanupScheduler.stop();
    // Stops claiming and lets the jobs in flight finish briefly; a lapsed lease re-runs the rest.
    await backgroundJobRunner.stop();
    // Closing the lock connection releases this task's job locks for another task to take.
    await jobLock.close();
    await prisma.$disconnect();
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = readListenPort();

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

if (
  process.env.OPENAPI_EXPORT !== 'true'
  && process.env.POOLMASTER_DISABLE_AUTO_START !== 'true'
) {
  void start();
}
