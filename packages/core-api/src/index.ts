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

// Notification module
import { notificationsModule } from './modules/notifications/routes';

// Ingestion module
import { ProviderRegistry, IngestionScheduler, publishLiveScoreUpdate } from './modules/ingestion/core';
import type { IngestionCallbacks, IngestionJobRecord } from './modules/ingestion/core';
import type { ProviderRanking, SportEvent, SportEventDetail } from './modules/ingestion/core';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { ProviderSyncRunLedger } from './modules/ingestion/persistence/provider-sync-run-ledger';
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
      const persisted = await ingestionPersistence.persistEventsWithDiagnostics(events);
      app.log.info({ persisted: persisted.count }, 'Persisted sport events');
      return persisted.writeDiagnostics;
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
      const persisted = await ingestionPersistence.persistEventDetailWithDiagnostics(detail);
      app.log.info({ persisted: persisted.value }, 'Persisted event detail');
      return persisted.writeDiagnostics;
    },
    async onRankings(rankings: ProviderRanking[]) {
      app.log.info({
        count: rankings.length,
      }, 'Ingested participant ranking snapshots');
      const persisted = await ingestionPersistence.persistRankingsWithDiagnostics(rankings);
      app.log.info({ persisted: persisted.count }, 'Persisted participant ranking snapshots');
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

  const providerSyncRunLedger = new ProviderSyncRunLedger(prisma, app.log);
  const ingestionScheduler = new IngestionScheduler(registry, ingestionCallbacks, app.log, {
    configReader: ingestionConfigService,
    eventReader: createScheduledEventReader({ prisma, registry, logger: app.log }),
    syncRunLedger: providerSyncRunLedger,
  });
  const providerService = new ProviderService(
    prisma,
    registry,
    ingestionScheduler,
    app.log,
    ingestionConfigService,
    mailDelivery,
    appBaseUrl,
    undefined,
    providerSyncRunLedger,
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
  // Notification module
  // =========================================================================
  app.register(notificationsModule, {
    prefix: '/api/v1',
    prisma,
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
    ingestionScheduler.stop();
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
