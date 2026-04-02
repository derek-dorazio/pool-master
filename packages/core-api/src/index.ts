// PoolMaster API — monolith entry point
// Merges core-api + draft-service + scoring-service + notification-service + ingestion-worker

import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import crypto from 'node:crypto';

// Core plugins
import { healthPlugin } from './plugins/health';
import { swaggerPlugin } from './plugins/swagger';
import { authGuard } from './plugins/auth-guard';
import { tenantPlugin } from './core/tenant-context';
import { etagPlugin } from './plugins/etag-support';
import { pollConfigPlugin } from './plugins/poll-config';

// Domain modules (core-api)
import { authModule } from './modules/auth/routes';
import { leaguesModule } from './modules/leagues/routes';
import { invitationsModule } from './modules/invitations/routes';
import { contestsModule, contestsByIdModule } from './modules/contests/routes';
import { templatesModule } from './modules/templates/routes';
import { participantsModule } from './modules/participants/routes';
import { contestPoolModule } from './modules/participants/pool-routes';
import { standingsModule } from './modules/standings/routes';
import { historyModule } from './modules/history/routes';
import { searchModule } from './modules/search/routes';
import { complianceModule } from './modules/compliance/routes';
import { adminModule } from './modules/admin/routes';
import { configModule } from './modules/config/routes';
import { billingModule } from './modules/billing/routes';
import { webhookModule } from './modules/billing/webhook-handler';

// Draft module
import { draftsModule } from './modules/drafts/routes';

// Social module
import { socialModule } from './modules/social/routes';

// Scoring module
import { eventBus } from '@poolmaster/shared/events/event-bus';
import { ScoreStore } from './modules/scoring/storage/score-store';
import { subscribeStatEventConsumer, ContestLookup } from './modules/scoring/consumer/stat-event-consumer';
import { StandingsRollup } from './modules/scoring/rollup/standings-rollup';
import { ScoringService } from './modules/scoring/service';
import { scoringRoutes } from './modules/scoring/routes';

// Notification module
import { loadConfig as loadNotifConfig } from './modules/notifications/core/config';
import { createChannels } from './modules/notifications/channels/channel-factory';
import { NotificationDispatcher } from './modules/notifications/core/dispatcher';
import { InMemoryRateLimiter } from './modules/notifications/core/rate-limiter';
import { EventGrouper } from './modules/notifications/core/event-grouper';
import { ScheduledRunner } from './modules/notifications/core/scheduled-runner';
import { WeeklyDigestService } from './modules/notifications/core/weekly-digest';
import { registerPushTriggers } from './modules/notifications/triggers/push-triggers';
import { notificationsModule } from './modules/notifications/routes';

// Ingestion module
import { Sport } from '@poolmaster/shared/domain';
import { ProviderRegistry, IngestionScheduler, publishStatEvents } from './modules/ingestion/core';
import type { IngestionCallbacks, IngestionJobRecord } from './modules/ingestion/core';
import type { SportEvent, ProviderParticipant, ProviderRanking, ProviderStatEvent } from './modules/ingestion/core';
import { OpenF1Adapter, OddsApiAdapter, EspnAdapter, PgaTourAdapter } from './modules/ingestion/adapters';
import { ingestionModule } from './modules/ingestion/routes';
import { IngestionPersistence } from './modules/ingestion/persistence/ingestion-persistence';

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();

  // --- Scoring subsystem (Prisma-backed) ---
  const scoreStore = new ScoreStore(prisma);
  const contestLookup = new ContestLookup(prisma);
  const standingsRollup = new StandingsRollup({ eventBus, scoreStore, prisma });
  const scoringService = new ScoringService({ scoreStore, standingsRollup });

  // =========================================================================
  // Core plugins
  // =========================================================================
  app.register(swaggerPlugin);
  app.register(healthPlugin);
  app.register(etagPlugin);
  app.register(pollConfigPlugin);
  app.register(authGuard);
  app.register(tenantPlugin);

  // =========================================================================
  // Auth (public routes — no JWT required)
  // =========================================================================
  app.register(authModule, { prefix: '/api/v1/auth' });

  // =========================================================================
  // Domain modules (protected by auth-guard)
  // =========================================================================
  app.register(leaguesModule, { prefix: '/api/v1/leagues' });
  app.register(invitationsModule, { prefix: '/api/v1/invitations' });
  app.register(contestsModule, { prefix: '/api/v1/leagues/:id/contests' });
  app.register(contestsByIdModule, { prefix: '/api/v1/contests' });
  app.register(templatesModule, { prefix: '/api/v1/templates' });
  app.register(participantsModule, { prefix: '/api/v1/participants' });
  app.register(contestPoolModule, { prefix: '/api/v1/contests/:contestId/pool' });
  app.register(standingsModule, { prefix: '/api/v1/contests/:contestId/standings' });
  app.register(historyModule, { prefix: '/api/v1' });
  app.register(searchModule, { prefix: '/api/v1/search' });
  app.register(complianceModule, { prefix: '/api/v1/account' });
  app.register(adminModule, { prefix: '/api/v1/admin' });
  app.register(configModule, { prefix: '/api/v1/config' });
  app.register(billingModule, { prefix: '/api/v1/billing' });
  app.register(webhookModule, { prefix: '/api/v1' });

  // =========================================================================
  // Social module (from social/communication layer)
  // =========================================================================
  app.register(socialModule, { prefix: '/api/v1' });

  // =========================================================================
  // Draft module (from draft-service)
  // =========================================================================
  app.register(draftsModule, { prefix: '/api/v1/drafts' });

  // =========================================================================
  // Scoring module (from scoring-service)
  // =========================================================================
  app.register(scoringRoutes, { prefix: '/api/v1', scoringService });

  // Subscribe stat event consumer + start periodic standings rollup
  subscribeStatEventConsumer({ eventBus, scoreStore, contestLookup });
  standingsRollup.startPeriodicRollup();

  // =========================================================================
  // Notification module (from notification-service)
  // =========================================================================
  const notifConfig = loadNotifConfig();
  const notifChannels = createChannels(notifConfig, prisma);
  const rateLimiter = new InMemoryRateLimiter();
  const dispatcher = new NotificationDispatcher(prisma, notifChannels, rateLimiter);
  const eventGrouper = new EventGrouper();
  const scheduledRunner = new ScheduledRunner(prisma, dispatcher);
  const digestService = new WeeklyDigestService(prisma, notifChannels);

  app.register(notificationsModule, {
    prefix: '/api/v1',
    prisma,
    channels: notifChannels,
    dispatcher,
    rateLimiter,
    eventGrouper,
    scheduledRunner,
    digestService,
  });

  // =========================================================================
  // Ingestion module (from ingestion-worker)
  // =========================================================================
  const registry = new ProviderRegistry();
  registry.register(Sport.GOLF, new PgaTourAdapter(), 'PRIMARY');
  registry.register(Sport.F1, new OpenF1Adapter(), 'PRIMARY');
  registry.register(Sport.NFL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NBA, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.MLB, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NHL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NCAA_BASKETBALL, new EspnAdapter(), 'PRIMARY');
  const oddsAdapter = new OddsApiAdapter();

  const ingestionPersistence = new IngestionPersistence(prisma);

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
    // Notifications
    scheduledRunner.start();
    app.log.info('Scheduled notification runner started');
    registerPushTriggers(dispatcher);
    app.log.info('Push notification triggers registered');

    // Event grouper flush
    setInterval(() => {
      const grouped = eventGrouper.flushExpired();
      for (const g of grouped) {
        dispatcher.dispatch({
          id: crypto.randomUUID(),
          type: g.eventType,
          sourceService: 'event-grouper',
          timestamp: new Date().toISOString(),
          tenantId: '',
          recipientUserIds: [g.userId],
          data: { ...g.latestData, count: g.count },
          priority: 'NORMAL' as any,
          action: { type: 'NAVIGATE', screen: 'home', params: {} },
        });
      }
    }, 30_000);

    // Ingestion
    if (process.env.AUTO_START_SCHEDULER !== 'false') {
      ingestionScheduler.start();
      app.log.info('Ingestion scheduler started');
    }
  });

  app.addHook('onClose', async () => {
    standingsRollup.stopPeriodicRollup();
    scheduledRunner.stop();
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

start();
