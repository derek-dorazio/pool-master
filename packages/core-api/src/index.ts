// PoolMaster API entry point for the active backend-first product surface.

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';

// Core plugins
import { healthPlugin } from './plugins/health';
import { swaggerPlugin } from './plugins/swagger';
import { authGuard } from './plugins/auth-guard';
import { etagPlugin } from './plugins/etag-support';
import { requestLoggingContext } from './plugins/request-logging-context';
import { FASTIFY_AJV_OPTIONS } from './plugins/string-transforms';
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
import { contestConfigTemplatesModule } from './modules/contest-config-templates/routes';
import { eventsModule } from './modules/events/routes';
import { sportsModule } from './modules/sports/routes';
import { sportLeaguesModule } from './modules/sport-leagues/routes';
import { participantsModule } from './modules/participants/routes';
import { usersModule } from './modules/users/routes';
import { platformModule } from './modules/platform/routes';
import { IngestionConfigService } from './modules/platform/ingestion-config-service';
import { AppSettingsService } from './modules/platform/app-settings-service';
import { SETTINGS_GROUPS } from './modules/platform/settings-groups';
import { PlatformSettingsService } from './modules/platform/platform-settings-service';
import { ingestionModule } from './modules/ingestion/routes';
import { IngestionService } from './modules/ingestion/ingestion-service';
import {
  PrismaParticipantProviderMappingRepository,
  PrismaPlatformRuntimeConfigRepository,
  PrismaProviderSyncRunRepository,
  PrismaUserRepository,
  PrismaSportEventRepository,
  PrismaSportEventRoundRepository,
} from './adapters';
import { clientLogsModule } from './modules/client-logs/routes';
import { versionModule } from './modules/version/routes';

// Draft module
import { draftsModule } from './modules/drafts/routes';

// Ingestion module
import { ProviderRegistry, IngestionScheduler, publishLiveScoreUpdate } from './modules/ingestion/core';
import type { IngestionCallbacks, SportEventDetail } from './modules/ingestion/core';
import type { LiveScoreResult } from '@poolmaster/shared/dto';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { createEventLifecycleService } from './modules/events/wiring';
import { EventLifecycleScheduler } from './modules/events/event-lifecycle-scheduler';
import { ProviderSyncRunLedger } from './modules/ingestion/persistence/provider-sync-run-ledger';
import { registerConfiguredProviders } from './modules/ingestion/core/provider-bindings';
import { createScheduledEventReader } from './modules/ingestion/core/scheduled-event-reader';
import { createGolfContestSettlementService } from './modules/contests/wiring';
import {
  EMAIL_SETTINGS,
  SettingsAwareMailDeliveryProvider,
  createMailDeliveryProvider,
  readApplicationBaseUrl,
  readMailDeliveryConfig,
} from './modules/email';

export function buildApp() {
  const app = Fastify({ logger: createFastifyLoggerOptions('core-api'), ajv: FASTIFY_AJV_OPTIONS });
  const prisma = new PrismaClient();
  const isOpenApiExport = process.env.OPENAPI_EXPORT === 'true';

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
  // One mail delivery for the whole app; EMAIL_CONFIG decides on every send whether it goes out.
  const mailDelivery = new SettingsAwareMailDeliveryProvider(
    createMailDeliveryProvider(readMailDeliveryConfig(process.env), app.log),
    () => appSettings.get(EMAIL_SETTINGS),
    app.log,
  );
  const appBaseUrl = readApplicationBaseUrl(process.env);
  const golfContestSettlement = createGolfContestSettlementService(prisma, app.log);
  const eventLifecycleService = createEventLifecycleService(prisma, {
    logger: app.log,
    mailDelivery,
    appBaseUrl,
    golfContestSettlement,
  });
  const ingestionPersistence = new IngestionPersistence(prisma, app.log);
  const eventLifecycleScheduler = new EventLifecycleScheduler(
    new PrismaSportEventRepository(prisma),
    new PrismaSportEventRoundRepository(prisma),
    eventLifecycleService,
    app.log,
  );
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
  app.register(authModule, { prefix: '/api/v1/auth' });
  app.register(usersModule, { prefix: '/api/v1/users' });
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
      });
    },
  };

  const providerSyncRuns = new PrismaProviderSyncRunRepository(prisma);
  const providerSyncRunLedger = new ProviderSyncRunLedger(providerSyncRuns, app.log);
  const ingestionScheduler = new IngestionScheduler(registry, ingestionCallbacks, app.log, {
    configReader: ingestionConfigService,
    eventReader: createScheduledEventReader({ prisma, registry, logger: app.log }),
    syncRunLedger: providerSyncRunLedger,
  });
  const ingestionService = new IngestionService({
    registry,
    sportEvents: new PrismaSportEventRepository(prisma),
    participantMappings: new PrismaParticipantProviderMappingRepository(prisma),
    syncRuns: providerSyncRuns,
    scheduler: ingestionScheduler,
    ingestionConfigReader: ingestionConfigService,
    syncRunLedger: providerSyncRunLedger,
    logger: app.log,
  });

  // =========================================================================
  // Domain modules (protected by auth-guard)
  // =========================================================================
  app.register(leaguesModule, { prefix: '/api/v1/leagues', mailDelivery });
  app.register(squadsModule, { prefix: '/api/v1/leagues/:id/squads' });
  app.register(invitationsModule, { prefix: '/api/v1/invitations', mailDelivery });
  app.register(teamInvitationsModule, { prefix: '/api/v1/team-invitations' });
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests', mailDelivery });
  app.register(contestManagementModule, {
    prefix: '/api/v1/leagues/:id/contest-management',
  });
  app.register(contestsByIdModule, { prefix: '/api/v1/contests', mailDelivery });
  app.register(contestConfigTemplatesModule, { prefix: '/api/v1/contest-config-templates' });
  app.register(eventsModule, {
    prefix: '/api/v1/events',
    eventLifecycleService,
    ingestionService,
    providerRegistry: registry,
  });
  app.register(sportsModule, { prefix: '/api/v1/sports' });
  app.register(sportLeaguesModule, { prefix: '/api/v1/sport-leagues' });
  app.register(participantsModule, { prefix: '/api/v1/participants', providerRegistry: registry });
  app.register(platformModule, { prefix: '/api/v1/platform', ingestionConfigService, platformSettingsService });
  app.register(ingestionModule, { prefix: '/api/v1/ingestion', ingestionService, providerRegistry: registry });
  app.register(clientLogsModule, { prefix: '/api/v1/client-logs' });

  // =========================================================================
  // Draft module
  // =========================================================================
  app.register(draftsModule, { prefix: '/api/v1/drafts', mailDelivery });

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
  });

  app.addHook('onClose', async () => {
    appSettings.stop();
    ingestionScheduler.stop();
    eventLifecycleScheduler.stop();
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
