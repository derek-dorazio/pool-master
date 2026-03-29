// Ingestion routes — extracted from ingestion-worker/src/index.ts
import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import type { ProviderRegistry } from './core/provider-registry';
import type { IngestionScheduler } from './core/ingestion-scheduler';
import type { OddsApiAdapter } from './adapters/odds-api-adapter';

export interface IngestionModuleOpts {
  registry: ProviderRegistry;
  scheduler: IngestionScheduler;
  oddsAdapter: OddsApiAdapter;
}

export async function ingestionModule(
  app: FastifyInstance,
  opts: IngestionModuleOpts,
): Promise<void> {
  const { registry, scheduler, oddsAdapter } = opts;

  app.get('/providers', async () => {
    return {
      providers: registry.getAllProviders().map((p) => ({
        providerId: p.providerId,
        providerName: p.providerName,
        sportsCovered: p.sportsCovered,
      })),
    };
  });

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
}
