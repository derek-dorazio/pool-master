// PoolMaster API entry point for the active backend-first product surface.

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';

// Core plugins
import { healthPlugin } from './plugins/health';
import { swaggerPlugin } from './plugins/swagger';
import { authGuard } from './plugins/auth-guard';
import { etagPlugin } from './plugins/etag-support';
import { pollConfigPlugin } from './plugins/poll-config';
import { globalErrorHandler } from './core/error-handler';

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
import { configModule } from './modules/config/routes';

// Draft module
import { draftsModule } from './modules/drafts/routes';

// Scoring module
import { eventBus } from '@poolmaster/shared/events/event-bus';
import { subscribeStatEventConsumer, ContestLookup } from './modules/scoring/consumer/stat-event-consumer';
import { StandingsRollup } from './modules/scoring/rollup/standings-rollup';
import { ScoringService } from './modules/scoring/service';
import { scoringRoutes } from './modules/scoring/routes';
import { ContestScoringRecalculationService } from './modules/contest-scoring';

// Notification module
import { notificationsModule } from './modules/notifications/routes';

// Ingestion module
import { ProviderRegistry, IngestionScheduler, publishStatEvents } from './modules/ingestion/core';
import type { IngestionCallbacks, IngestionJobRecord } from './modules/ingestion/core';
import type { SportEvent, ProviderParticipant, ProviderRanking, ProviderStatEvent } from './modules/ingestion/core';
import { OddsApiAdapter } from './modules/ingestion/adapters';
import { ingestionModule } from './modules/ingestion/routes';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';
import { registerConfiguredProviders } from './modules/ingestion/core/provider-bindings';

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();
  const isOpenApiExport = process.env.OPENAPI_EXPORT === 'true';

  app.decorate('prisma', prisma);

  const registry = new ProviderRegistry();
  registerConfiguredProviders(registry);
  const oddsAdapter = new OddsApiAdapter();
  const ingestionPersistence = new IngestionPersistence(prisma);

  // --- Scoring subsystem (Prisma-backed) ---
  const contestLookup = new ContestLookup(prisma);
  const standingsRollup = new StandingsRollup({ eventBus, prisma });
  const scoringService = new ScoringService({ standingsRollup, prisma });
  const contestScoringRecalculationService = new ContestScoringRecalculationService(prisma);

  // =========================================================================
  // Core plugins
  // =========================================================================
  app.register(swaggerPlugin);
  app.register(healthPlugin);
  app.register(etagPlugin);
  app.register(pollConfigPlugin);
  app.register(authGuard);
  app.setErrorHandler(globalErrorHandler);

  // =========================================================================
  // Auth (public routes — no JWT required)
  // =========================================================================
  app.register(authModule, { prefix: '/api/v1/auth' });

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
  app.register(adminModule, { prefix: '/api/v1/admin', providerRegistry: registry });
  app.register(configModule, { prefix: '/api/v1/config' });

  // =========================================================================
  // Draft module
  // =========================================================================
  app.register(draftsModule, { prefix: '/api/v1/drafts' });

  // =========================================================================
  // Scoring module
  // =========================================================================
  app.register(scoringRoutes, { prefix: '/api/v1', scoringService });

  // Subscribe stat event consumer + start periodic standings rollup
  if (!isOpenApiExport) {
    subscribeStatEventConsumer({
      eventBus,
      contestLookup,
      contestScoringRecalculationService,
    });
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
  const ingestionCallbacks: IngestionCallbacks = {
    async onEvents(events: SportEvent[]) {
      app.log.info({ count: events.length }, 'Ingested events');
      const persisted = await ingestionPersistence.persistEvents(events);
      app.log.info({ persisted }, 'Persisted sport events');
    },
    async onParticipants(participants: ProviderParticipant[]) {
      app.log.info({ count: participants.length }, 'Ingested participants');
      const persisted = await ingestionPersistence.persistParticipants(participants);
      app.log.info({ persisted }, 'Persisted participants');
    },
    async onRankings(rankings: ProviderRanking[]) {
      app.log.info({ count: rankings.length }, 'Ingested rankings');
      const persisted = await ingestionPersistence.persistRankings(rankings);
      app.log.info({ persisted }, 'Persisted rankings');
    },
    async onLiveScores(scores: ProviderStatEvent[]) {
      app.log.info({ count: scores.length }, 'Ingested live scores');
      await publishStatEvents(scores);
    },
    async onJobComplete(job: IngestionJobRecord) {
      app.log.info({ jobType: job.jobType, provider: job.providerId, status: job.status, records: job.recordsProcessed }, 'Job complete');
    },
  };

  const ingestionScheduler = new IngestionScheduler(registry, ingestionCallbacks);

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
