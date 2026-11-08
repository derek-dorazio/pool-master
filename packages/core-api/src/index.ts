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
import { requestQueryUsage } from './plugins/request-query-usage';
import { FASTIFY_AJV_OPTIONS } from './plugins/string-transforms';
import { FASTIFY_SCHEMA_CONTROLLER } from './plugins/serializer-cache';
import { globalErrorHandler } from './core/error-handler';
import { createFastifyLoggerOptions } from './core/logger';
import { readTrustProxy } from './core/config';
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
import { sportsModule } from './modules/sports/routes';
import { sportLeaguesModule } from './modules/sport-leagues/routes';
import { eventPagesModule } from './modules/event-pages/routes';
import { participantsModule } from './modules/participants/routes';
import { usersModule } from './modules/users/routes';
import { platformModule } from './modules/platform/routes';
import { IngestionConfigService } from './modules/platform/ingestion-config-service';
import { AppSettingsService } from './modules/platform/app-settings-service';
import { SETTINGS_GROUPS } from './modules/platform/settings-groups';
import { PlatformSettingsService } from './modules/platform/platform-settings-service';
import { ingestionModule } from './modules/ingestion/routes';
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
  PrismaPlatformRuntimeConfigRepository,
  PrismaProviderSyncRunRepository,
  PrismaUserRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
  PrismaBackgroundJobRepository,
} from './adapters';
import { clientLogsModule } from './modules/client-logs/routes';
import { versionModule } from './modules/version/routes';

// Draft module
import { selectionsModule } from './modules/selections/routes';
import { createDrawReceipts } from './modules/selections/wiring';

// Ingestion module
import { ProviderRegistry, IngestionScheduler, publishLiveScoreUpdate } from './modules/ingestion/core';
import type { IngestionCallbacks, SportEventDetail } from './modules/ingestion/core';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { createEventLifecycleService, eventFieldCache } from './modules/events/wiring';
import { EventLifecycleScheduler } from './modules/events/event-lifecycle-scheduler';
import {
  createContestEmailJobs,
  createContestExpandedNotices,
  createContestNotices,
  createDueNotifications,
  createMemberJoinedNotices,
  DueNotificationKind,
  DueNotificationsScheduler,
} from './modules/notifications';
import { ProviderSyncRunLedger } from './modules/ingestion/persistence/provider-sync-run-ledger';
import { SyncRunDetailsRetention, SyncRunRetention } from './modules/ingestion/persistence/sync-run-retention';
import { registerConfiguredProviders } from './modules/ingestion/core/provider-bindings';
import { createScheduledEventReader } from './modules/ingestion/core/scheduled-event-reader';
import { createContestService, createContestSettlementService } from './modules/contests/wiring';
import { JobLeaderboardRebuilds } from './modules/contests/leaderboard-snapshots';
import { leaderboardChangesOf } from './modules/contests/leaderboard-rebuild-job-requests';
import { createContestManagementService } from './modules/contest-management/wiring';
import { scoringFamilyForEvent } from './modules/scoring-families';
import {
  EMAIL_SETTINGS,
  createEmailOutbox,
  SnsMessageVerifier,
  readApplicationBaseUrl,
} from './modules/email';
import { emailEventsModule } from './modules/email/email-events-routes';
import { emailUnsubscribeModule } from './modules/email/email-unsubscribe-routes';
import { emailTestModule } from './modules/email/email-test-routes';
import {
  BackgroundJobQueue,
  BackgroundJobRetention,
  BackgroundJobRunner,
  readBackgroundJobPollMs,
} from './modules/background-jobs';

export function buildApp() {
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

  const registry = new ProviderRegistry();
  registerConfiguredProviders(registry, process.env, app.log);
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
  const { email, sender: emailSender, deliveryEvents, preferences: emailPreferences, test: emailTest, retention: emailRetention } = createEmailOutbox({
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
  const backgroundJobs = new BackgroundJobQueue({ jobs: backgroundJobRepository });
  const contestNotices = createContestNotices(prisma, { email, jobs: backgroundJobs, appBaseUrl, logger: app.log });
  // A contest going live or completing queues its league's email as a job (#1387).
  const contestEmailJobs = createContestEmailJobs(prisma, { notices: contestNotices, logger: app.log });
  // Live leaderboards are computed once per score write (#1435): every write that changes what a
  // board is computed from tells this, which queues one rebuild job per event or contest (#1463).
  const leaderboards = new JobLeaderboardRebuilds(backgroundJobs);
  const leaderboardRebuilder = createContestService(prisma, app.log, { planEntitlements });
  const contestSettlement = createContestSettlementService(prisma, app.log, { jobs: backgroundJobs, leaderboards });
  // A released edition joins its template contests by a job per contest (#1318).
  const releasedEditionContests = createContestManagementService(prisma, app.log, planEntitlements);
  const eventLifecycleService = createEventLifecycleService(prisma, {
    logger: app.log,
    jobs: backgroundJobs,
    sportEventChanged: contestNotices,
    contestSettlement,
    releasedEditionContests,
  });
  const memberJoined = createMemberJoinedNotices(prisma, { email, readConfig: () => appSettings.get(EMAIL_SETTINGS), appBaseUrl, logger: app.log });
  // Admin saves, and provider syncs that load an event's field, clear the public reads CloudFront keeps (#1181).
  const cdn = createCdnInvalidator(process.env, app.log);
  const ingestionPersistence = new IngestionPersistence(prisma, app.log, eventFieldCache, cdn, leaderboards);
  const jobLock = new PostgresJobLock(process.env.DATABASE_URL, app.log);
  const eventLifecycleScheduler = new EventLifecycleScheduler({
    sportEvents: new PrismaSportEventRepository(prisma),
    rounds: new PrismaSportEventRoundRepository(prisma),
    eventLifecycleService,
    jobLock,
    logger: app.log,
  });
  // The emails that come due on the clock (#845), each kind on a timer and lock of its own so a
  // slow one never holds up another or the lifecycle sweep.
  const dueNotificationsSchedulers = [
    ...createDueNotifications(prisma, {
      email,
      readConfig: () => appSettings.get(EMAIL_SETTINGS),
      appBaseUrl,
      logger: app.log,
      planEntitlements,
      memberJoined,
    }),
    // A quick pick draw's receipts, queued by the draw for the sweep (#1171).
    { kind: DueNotificationKind.DRAW_RECEIPTS, notifications: createDrawReceipts(prisma, app.log, { email, appBaseUrl, planEntitlements }) },
  ].map((due) => new DueNotificationsScheduler({ ...due, jobLock, logger: app.log }));
  const providerSyncRuns = new PrismaProviderSyncRunRepository(prisma);
  // #1175: tables that grow without end are trimmed to their retention periods once a night.
  const nightlyCleanupScheduler = new NightlyCleanupScheduler({
    steps: [
      new RefreshTokenRetention(prisma),
      emailRetention,
      new SyncRunDetailsRetention(providerSyncRuns),
      new SyncRunRetention(providerSyncRuns),
      new AbandonedDraftRetention(new PrismaContestRepository(prisma), app.log),
      new BackgroundJobRetention(backgroundJobRepository),
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
      return persisted.writeDiagnostics;
    },
    async onLiveScores(result: LiveScoreResult, providerId: string) {
      app.log.info({
        category: result.category,
        providerId,
      }, 'Ingested live scores (typed LiveScoreResult)');
      return publishLiveScoreUpdate(result, {
        prisma,
        providerId,
        logger: app.log,
        scoringFamilyForEvent,
        fieldCache: eventFieldCache,
        leaderboards,
      });
    },
  };

  const providerSyncRunLedger = new ProviderSyncRunLedger(providerSyncRuns, app.log);
  const ingestionScheduler = new IngestionScheduler(registry, ingestionCallbacks, app.log, {
    configReader: ingestionConfigService,
    eventReader: createScheduledEventReader({ prisma, registry, logger: app.log }),
    syncRunLedger: providerSyncRunLedger,
    jobLock,
  });
  const ingestionService = new IngestionService({
    registry,
    sportEvents: new PrismaSportEventRepository(prisma),
    participantMappings: new PrismaParticipantProviderMappingRepository(prisma),
    syncRuns: providerSyncRuns,
    scheduler: ingestionScheduler,
    ingestionConfigReader: ingestionConfigService,
    syncRunLedger: providerSyncRunLedger,
    jobs: backgroundJobs,
    logger: app.log,
  });
  // The task that runs the background work runs the job runner (#1186); a job it queues itself wakes
  // it, and one an API-only task queued is found by its poll.
  const backgroundJobRunner = new BackgroundJobRunner({
    jobs: backgroundJobRepository,
    handlers: {
      MANUAL_EVENT_SYNC: (payload, context) => ingestionService.runManualEventSync(payload, context),
      CONTEST_STARTED_EMAILS: (payload) => contestEmailJobs.contestStarted(payload),
      CONTEST_SETTLED_EMAILS: (payload) => contestEmailJobs.contestSettled(payload),
      CONTEST_EVENT_CHANGED_EMAILS: (payload) => contestEmailJobs.contestEventChanged(payload),
      SETTLE_SPORT_EVENT_CONTESTS: (payload) => eventLifecycleService.settleFinishedEventContests(payload),
      SETTLE_GAME_CONTESTS: (payload) => eventLifecycleService.settleFinishedGameContests(payload),
      REBUILD_LEADERBOARDS: (payload) => leaderboardRebuilder.rebuildLeaderboardSnapshots(leaderboardChangesOf(payload)),
      ADD_RELEASED_EDITION_TO_CONTEST: (payload) => releasedEditionContests.addReleasedEditionToContest(payload),
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
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests', email, planEntitlements });
  app.register(contestManagementModule, {
    prefix: '/api/v1/leagues/:id/contest-management',
    email,
    planEntitlements,
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
    leaderboards,
  });
  app.register(sportsModule, { prefix: '/api/v1/sports' });
  app.register(sportLeaguesModule, { prefix: '/api/v1/sport-leagues', cdn });
  app.register(eventPagesModule, { prefix: '/api/v1/event-pages' });
  app.register(participantsModule, { prefix: '/api/v1/participants', providerRegistry: registry });
  app.register(platformModule, { prefix: '/api/v1/platform', ingestionConfigService, platformSettingsService, cdn });
  app.register(emailTestModule, { prefix: '/api/v1/platform/email', emailTest });
  app.register(ingestionModule, { prefix: '/api/v1/ingestion', ingestionService, providerRegistry: registry });
  app.register(clientLogsModule, { prefix: '/api/v1/client-logs' });
  app.register(emailEventsModule, {
    prefix: '/api/v1/email',
    deliveryEvents,
    verifier: new SnsMessageVerifier(),
    topicArn: process.env.SES_EVENTS_TOPIC_ARN?.trim() || undefined,
  });
  app.register(emailUnsubscribeModule, { prefix: '/api/v1/email', preferences: emailPreferences });

  // =========================================================================
  // Draft module
  // =========================================================================
  app.register(selectionsModule, { prefix: '/api/v1/selections', email, planEntitlements, leaderboards });

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

    // An API-only task (#1186) serves requests and leaves everything below to the worker.
    if (!role.runsBackgroundWork) {
      app.log.info({ action: 'taskRole.apiOnly' }, 'Serving requests only; the worker runs the background work');
      return;
    }

    // Ingestion
    if (process.env.AUTO_START_SCHEDULER !== 'false') {
      ingestionScheduler.start();
      app.log.info('Ingestion scheduler started');
    }

    // Admin-managed event lifecycle (plans/124 §3.6) — always runs; it is
    // platform-wide and not gated by AUTO_START_SCHEDULER, which controls
    // only provider-sync loops.
    eventLifecycleScheduler.start();
    app.log.info('Event lifecycle scheduler started');

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
    ingestionScheduler.stop();
    eventLifecycleScheduler.stop();
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
  const port = Number(process.env.PORT ?? 3000);

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
