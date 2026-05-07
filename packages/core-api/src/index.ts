// PoolMaster API entry point for the active backend-first product surface.

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';

// Core plugins
import { healthPlugin } from './plugins/health';
import { swaggerPlugin } from './plugins/swagger';
import { authGuard } from './plugins/auth-guard';
import { etagPlugin } from './plugins/etag-support';
import { pollConfigPlugin } from './plugins/poll-config';
import { requestLoggingContext } from './plugins/request-logging-context';
import { globalErrorHandler } from './core/error-handler';
import { createFastifyLoggerOptions } from './core/logger';

// Domain modules (core-api)
import { authModule } from './modules/auth/routes';
import { leaguesModule } from './modules/leagues/routes';
import { squadsModule } from './modules/squads/routes';
import { invitationsModule } from './modules/invitations/routes';
import { teamInvitationsModule } from './modules/team-invitations/routes';
import { contestsModule, contestsByIdModule } from './modules/contests/routes';
import { contestManagementModule } from './modules/contest-management/routes';
import { eventsModule } from './modules/events/routes';
import { participantsModule } from './modules/participants/routes';
import { standingsModule } from './modules/standings/routes';
import { historyModule } from './modules/history/routes';
import { accountConsentModule } from './modules/account-consent/routes';
import { accountModule } from './modules/account/routes';
import { adminModule } from './modules/admin/routes';
import { IngestionConfigService } from './modules/admin/ingestion-config-service';
import { PollConfigService } from './modules/admin/poll-config-service';
import { PrismaPlatformRuntimeConfigRepository } from './modules/admin/platform-runtime-config-repository';
import { ProviderService } from './modules/admin/provider-service';
import { configModule } from './modules/config/routes';
import { clientLogsModule } from './modules/client-logs/routes';
import { versionModule } from './modules/version/routes';

// Draft module
import { draftsModule } from './modules/drafts/routes';

// Scoring module
import { eventBus } from '@poolmaster/shared/events/event-bus';
import { StandingsRollup } from './modules/scoring/rollup/standings-rollup';
import { ScoringService } from './modules/scoring/service';
import { scoringRoutes } from './modules/scoring/routes';
import { ContestScoringRecalculationService } from './modules/contest-scoring';
import { LiveScoreConsumer } from './modules/scoring/consumer/live-score-consumer';

// Notification module
import { notificationsModule } from './modules/notifications/routes';

// Ingestion module
import { ProviderRegistry, IngestionScheduler, publishLiveScoreUpdate } from './modules/ingestion/core';
import type { IngestionCallbacks, IngestionJobRecord } from './modules/ingestion/core';
import type { ProviderRanking, SportEvent, SportEventDetail } from './modules/ingestion/core';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { OddsApiAdapter } from './modules/ingestion/adapters';
import { ingestionModule } from './modules/ingestion/routes';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { registerConfiguredProviders } from './modules/ingestion/core/provider-bindings';
import { createScheduledEventReader } from './modules/ingestion/core/scheduled-event-reader';
import {
  createMailDeliveryProvider,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from './modules/email';

export function buildApp() {
  const app = Fastify({ logger: createFastifyLoggerOptions('core-api') });
  const prisma = new PrismaClient();
  const isOpenApiExport = process.env.OPENAPI_EXPORT === 'true';

  app.decorate('prisma', prisma);

  const registry = new ProviderRegistry();
  registerConfiguredProviders(registry, process.env, app.log);
  const oddsAdapter = new OddsApiAdapter();
  const mailDelivery = createMailDeliveryProvider(
    readMailDeliveryConfig(process.env),
    app.log,
  );
  const appBaseUrl = readApplicationBaseUrl(process.env);
  const ingestionPersistence = new IngestionPersistence(
    prisma,
    app.log,
    mailDelivery,
    appBaseUrl,
  );
  const runtimeConfigRepository = new PrismaPlatformRuntimeConfigRepository(prisma);
  const pollConfigService = new PollConfigService(runtimeConfigRepository, app.log);
  const ingestionConfigService = new IngestionConfigService(runtimeConfigRepository, app.log);

  // --- Scoring subsystem (Prisma-backed) ---
  // pool-master-rop.78.3 — the legacy ContestLookup + stat-event consumer
  // path was retired with the ProviderStatEvent contract.
  // pool-master-rop.78.7 — the typed live_score.persisted consumer is
  // wired below; it dispatches to per-(category × contestFormat) scoring
  // functions (Phase 4 ships golf-roster only) and reranks via the
  // existing standingsRollup.
  const standingsRollup = new StandingsRollup({ eventBus, prisma, logger: app.log });
  const scoringService = new ScoringService({ standingsRollup, prisma, logger: app.log });
  const contestScoringRecalculationService = new ContestScoringRecalculationService(prisma, app.log);
  void contestScoringRecalculationService;
  const liveScoreConsumer = new LiveScoreConsumer({
    prisma,
    eventBus,
    standingsRollup,
    logger: app.log,
  });

  // =========================================================================
  // Core plugins
  // =========================================================================
  app.register(swaggerPlugin);
  app.register(healthPlugin);
  app.register(versionModule, { prefix: '/version', operationId: 'getRootVersion' });
  app.register(etagPlugin);
  app.register(pollConfigPlugin);
  app.register(authGuard);
  app.register(requestLoggingContext);
  app.setErrorHandler(globalErrorHandler);

  // =========================================================================
  // Auth (public routes — no JWT required)
  // =========================================================================
  app.register(authModule, { prefix: '/api/v1/auth' });
  app.register(versionModule, { prefix: '/api/v1/version', operationId: 'getVersion' });

  const ingestionCallbacks: IngestionCallbacks = {
    async onEvents(events: SportEvent[]) {
      app.log.info({
        count: events.length,
        events: events.slice(0, 10).map((event) => ({
          providerId: event.providerId,
          externalId: event.externalId,
          sport: event.sport,
          name: event.name,
          status: event.status,
          startDate: event.startDate.toISOString(),
          participantCount: event.participantCount ?? null,
        })),
      }, 'Ingested events');
      const persisted = await ingestionPersistence.persistEvents(events);
      app.log.info({ persisted }, 'Persisted sport events');
    },
    async onEventDetail(detail: SportEventDetail) {
      app.log.info({
        providerId: detail.providerId,
        eventExternalId: detail.externalId,
        sport: detail.sport,
        name: detail.name,
        startDate: detail.startDate.toISOString(),
        participantCount: detail.participants.length,
      }, 'Ingested event detail');
      const persisted = await ingestionPersistence.persistEventDetail(detail);
      app.log.info({ persisted }, 'Persisted event detail');
    },
    async onRankings(rankings: ProviderRanking[]) {
      // Per plans/117 §13.2 the season-record persistence path was dropped.
      // Per-event ranking will move onto SportEventParticipant in rop.78.5.
      app.log.info({
        count: rankings.length,
      }, 'Received rankings (persistence deferred to rop.78.5)');
    },
    async onLiveScores(result: LiveScoreResult, providerId: string) {
      app.log.info({
        category: result.category,
        providerId,
      }, 'Ingested live scores (typed LiveScoreResult)');
      await publishLiveScoreUpdate(result, {
        prisma,
        providerId,
        logger: app.log,
      });
    },
    async onJobComplete(job: IngestionJobRecord) {
      app.log.info({
        jobType: job.jobType,
        providerId: job.providerId,
        sport: job.sport,
        eventExternalId: job.eventExternalId ?? null,
        status: job.status,
        recordsProcessed: job.recordsProcessed,
        errors: job.errors,
        startedAt: job.startedAt?.toISOString() ?? null,
        completedAt: job.completedAt?.toISOString() ?? null,
      }, 'Job complete');
      try {
        await ingestionPersistence.persistIngestionJob(job);
      } catch (error) {
        app.log.error({
          error,
          jobType: job.jobType,
          providerId: job.providerId,
          sport: job.sport,
          eventExternalId: job.eventExternalId ?? null,
        }, 'Failed to persist ingestion job completion');
      }
    },
  };

  const ingestionScheduler = new IngestionScheduler(registry, ingestionCallbacks, app.log, {
    configReader: ingestionConfigService,
    eventReader: createScheduledEventReader({ prisma, registry, logger: app.log }),
  });
  const providerService = new ProviderService(
    prisma,
    registry,
    ingestionScheduler,
    app.log,
    ingestionConfigService,
    mailDelivery,
    appBaseUrl,
  );

  // =========================================================================
  // Domain modules (protected by auth-guard)
  // =========================================================================
  app.register(leaguesModule, { prefix: '/api/v1/leagues' });
  app.register(squadsModule, { prefix: '/api/v1/leagues/:id/squads' });
  app.register(invitationsModule, { prefix: '/api/v1/invitations' });
  app.register(teamInvitationsModule, { prefix: '/api/v1/team-invitations' });
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
  app.register(contestManagementModule, {
    prefix: '/api/v1/leagues/:id/contest-management',
  });
  app.register(contestsByIdModule, { prefix: '/api/v1/contests' });
  app.register(eventsModule, { prefix: '/api/v1/events' });
  app.register(participantsModule, { prefix: '/api/v1/participants' });
  app.register(standingsModule, { prefix: '/api/v1/contests/:contestId/standings' });
  app.register(historyModule, { prefix: '/api/v1' });
  app.register(accountModule, { prefix: '/api/v1/account' });
  app.register(accountConsentModule, { prefix: '/api/v1/account' });
  app.register(adminModule, {
    prefix: '/api/v1/admin',
    providerRegistry: registry,
    providerService,
    pollConfigService,
    ingestionConfigService,
  });
  app.register(configModule, { prefix: '/api/v1/config' });
  app.register(clientLogsModule, { prefix: '/api/v1/client-logs' });

  // =========================================================================
  // Draft module
  // =========================================================================
  app.register(draftsModule, { prefix: '/api/v1/drafts' });

  // =========================================================================
  // Scoring module
  // =========================================================================
  app.register(scoringRoutes, { prefix: '/api/v1', scoringService });

  // pool-master-rop.78.7 — typed live_score.persisted consumer subscribed
  // here. It dispatches per (event.category × pick.contestFormat) and runs
  // the scoring → contributions → totalScore → rerank pipeline under a
  // per-contest advisory lock (plans/117 §11.3, §11.4, §11.5).
  // Periodic standings rollup continues to run as a defensive backstop;
  // rop.78.8 will retire it once the event-driven path is the canonical
  // single write path.
  if (!isOpenApiExport) {
    liveScoreConsumer.subscribe();
    standingsRollup.startPeriodicRollup();
  }

  // =========================================================================
  // Notification module
  // =========================================================================
  app.register(notificationsModule, {
    prefix: '/api/v1',
    prisma,
  });

  // =========================================================================
  // Ingestion module
  // =========================================================================

  app.register(ingestionModule, {
    prefix: '/api/v1/ingestion',
    registry,
    scheduler: ingestionScheduler,
    oddsAdapter,
  });

  // =========================================================================
  // Lifecycle hooks
  // =========================================================================
  app.addHook('onReady', async () => {
    if (isOpenApiExport) {
      return;
    }

    await pollConfigService.bootstrap();
    await ingestionConfigService.bootstrap();

    // Ingestion
    if (process.env.AUTO_START_SCHEDULER !== 'false') {
      ingestionScheduler.start();
      app.log.info('Ingestion scheduler started');
    }
  });

  app.addHook('onClose', async () => {
    standingsRollup.stopPeriodicRollup();
    ingestionScheduler.stop();
    eventBus.clear();
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
