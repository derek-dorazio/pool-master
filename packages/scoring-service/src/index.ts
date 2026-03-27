import Fastify from 'fastify';
import { eventBus } from '@poolmaster/shared/events/event-bus';
import { scoreStore } from './storage/score-store';
import { subscribeStatEventConsumer, ContestLookup } from './consumer/stat-event-consumer';
import { StandingsRollup } from './rollup/standings-rollup';
import { ScoringService } from './modules/scoring/service';
import { scoringRoutes } from './modules/scoring/routes';

/** Shared instances — exported for testing and external wiring. */
export const contestLookup = new ContestLookup();
export const standingsRollup = new StandingsRollup({ eventBus, scoreStore });
export const scoringService = new ScoringService({ scoreStore, standingsRollup });

export function buildApp() {
  const app = Fastify({ logger: true });

  app.get('/health', async () => {
    return { status: 'ok', service: 'scoring-service' };
  });

  // Register scoring routes (templates + leaderboard + rollup)
  app.register(scoringRoutes, { scoringService });

  // Subscribe stat event consumer to event bus
  subscribeStatEventConsumer({ eventBus, scoreStore, contestLookup });

  // Start periodic standings rollup
  standingsRollup.startPeriodicRollup();

  // Graceful shutdown
  app.addHook('onClose', async () => {
    standingsRollup.stopPeriodicRollup();
    eventBus.clear();
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3002);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
