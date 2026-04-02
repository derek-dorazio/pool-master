// Ingestion routes — extracted from ingestion-worker/src/index.ts
import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import { zodToJsonSchema, SuccessSchema } from '@poolmaster/shared/dto';
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

  app.get('/providers', {
    schema: {
      tags: ['Admin'],
      summary: 'List data ingestion providers',
      operationId: 'listIngestionProviders',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
  }, async () => {
    return {
      providers: registry.getAllProviders().map((p) => ({
        providerId: p.providerId,
        providerName: p.providerName,
        sportsCovered: p.sportsCovered,
      })),
    };
  });

  app.post<{ Params: { sport: string } }>('/sync/:sport', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger data sync for a sport',
      operationId: 'syncSportData',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
  }, async (request) => {
    const sport = request.params.sport as Sport;
    const job = await scheduler.syncSport(sport);
    return { job };
  });

  app.post<{ Params: { sport: string; eventId: string } }>(
    '/scores/:sport/:eventId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Ingest scores for a sport event',
        operationId: 'ingestEventScores',
        response: { 200: zodToJsonSchema(SuccessSchema) },
      },
    },
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
    {
      schema: {
        tags: ['Admin'],
        summary: 'Ingest results for a sport event',
        operationId: 'ingestEventResults',
        response: { 200: zodToJsonSchema(SuccessSchema) },
      },
    },
    async (request) => {
      const job = await scheduler.fetchEventResults(
        request.params.sport as Sport,
        request.params.eventId,
      );
      return { job };
    },
  );

  app.post<{ Params: { sport: string } }>('/odds/:sport', {
    schema: {
      tags: ['Admin'],
      summary: 'Ingest odds for a sport',
      operationId: 'ingestSportOdds',
      response: { 200: zodToJsonSchema(SuccessSchema) },
    },
  }, async (request) => {
    const sport = request.params.sport as Sport;
    const odds = await oddsAdapter.getOdds(sport);
    return { sport, eventsWithOdds: odds.length, odds };
  });
}
