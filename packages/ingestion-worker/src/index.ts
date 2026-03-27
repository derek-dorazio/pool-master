import Fastify from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
import { ProviderRegistry, IngestionScheduler, publishStatEvents } from './core';
import type { IngestionCallbacks, IngestionJobRecord } from './core';
import type { SportEvent, ProviderParticipant, ProviderRanking, ProviderStatEvent } from './core';
import { OpenF1Adapter, OddsApiAdapter, EspnAdapter, PgaTourAdapter } from './adapters';

export function buildApp() {
  const app = Fastify({ logger: true });

  // --- Provider Registry ---

  const registry = new ProviderRegistry();

  // Golf — PGA Tour primary (schedule, leaderboard, field), ESPN fallback via PGA adapter
  registry.register(Sport.GOLF, new PgaTourAdapter(), 'PRIMARY');

  // F1 — OpenF1 primary (free, live timing)
  registry.register(Sport.F1, new OpenF1Adapter(), 'PRIMARY');

  // NFL — ESPN primary (free, scores, teams)
  registry.register(Sport.NFL, new EspnAdapter(), 'PRIMARY');

  // NBA, MLB, NHL, NCAA — ESPN covers all (free)
  registry.register(Sport.NBA, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.MLB, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NHL, new EspnAdapter(), 'PRIMARY');
  registry.register(Sport.NCAA_BASKETBALL, new EspnAdapter(), 'PRIMARY');

  // Odds — available for all sports (supplementary data for pricing)
  const oddsAdapter = new OddsApiAdapter();

  // --- Ingestion Callbacks (placeholder — wire to database in production) ---

  const callbacks: IngestionCallbacks = {
    async onEvents(events: SportEvent[]) {
      app.log.info({ count: events.length }, 'Ingested events');
    },
    async onParticipants(participants: ProviderParticipant[]) {
      app.log.info({ count: participants.length }, 'Ingested participants');
    },
    async onRankings(rankings: ProviderRanking[]) {
      app.log.info({ count: rankings.length }, 'Ingested rankings');
    },
    async onLiveScores(scores: ProviderStatEvent[]) {
      app.log.info({ count: scores.length }, 'Ingested live scores');
      await publishStatEvents(scores);
    },
    async onJobComplete(job: IngestionJobRecord) {
      app.log.info({ jobType: job.jobType, provider: job.providerId, status: job.status, records: job.recordsProcessed }, 'Job complete');
    },
  };

  const scheduler = new IngestionScheduler(registry, callbacks);

  // --- Health & Status Routes ---

  app.get('/health', async () => {
    return {
      status: 'ok',
      service: 'ingestion-worker',
      providers: registry.getHealthReport(),
      supportedSports: registry.getSupportedSports(),
    };
  });

  app.get('/providers', async () => {
    return {
      providers: registry.getAllProviders().map((p) => ({
        providerId: p.providerId,
        providerName: p.providerName,
        sportsCovered: p.sportsCovered,
      })),
    };
  });

  // --- Manual Trigger Routes ---

  app.post<{ Params: { sport: string } }>('/sync/:sport', async (request) => {
    const sport = request.params.sport as Sport;
    const job = await scheduler.syncSport(sport);
    return { job };
  });

  app.post<{ Params: { sport: string; eventId: string } }>(
    '/scores/:sport/:eventId',
    async (request) => {
      const job = await scheduler.pollLiveScores(
        request.params.sport as Sport,
        request.params.eventId,
      );
      return { job };
    },
  );

  app.post<{ Params: { sport: string; eventId: string } }>(
    '/results/:sport/:eventId',
    async (request) => {
      const job = await scheduler.fetchEventResults(
        request.params.sport as Sport,
        request.params.eventId,
      );
      return { job };
    },
  );

  app.post<{ Params: { sport: string } }>('/odds/:sport', async (request) => {
    const sport = request.params.sport as Sport;
    const odds = await oddsAdapter.getOdds(sport);
    return { sport, eventsWithOdds: odds.length, odds };
  });

  // --- Lifecycle ---

  app.addHook('onReady', async () => {
    if (process.env.AUTO_START_SCHEDULER !== 'false') {
      scheduler.start();
      app.log.info('Ingestion scheduler started');
    }
  });

  app.addHook('onClose', async () => {
    scheduler.stop();
    app.log.info('Ingestion scheduler stopped');
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3003);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
