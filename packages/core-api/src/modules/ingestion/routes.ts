// Ingestion routes for provider sync, score refresh, and odds refresh operations.
import type { FastifyInstance } from 'fastify';
import type { Sport } from '@poolmaster/shared/domain';
import {
  ErrorEnvelopeSchema,
  IngestionJobResponseSchema,
  IngestionProvidersResponseSchema,
  IngestSportOddsResponseSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import {
  EventSyncRequestSchema,
  IngestionJobsResponseSchema,
  SportSyncRequestSchema,
} from '@poolmaster/shared/dto/ingestion.dto';
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
      description:
        'Returns the configured ingestion providers and their current metadata for admin and diagnostics surfaces.',
      operationId: 'listIngestionProviders',
      response: {
        200: zodToJsonSchema(IngestionProvidersResponseSchema),
        500: zodToJsonSchema(ErrorEnvelopeSchema),
      },
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

  app.post<{
    Params: { sport: string };
    Body: {
      feeds: Array<'EVENTSCHEDULE' | 'EVENTPARTICIPANTS' | 'PARTICIPANTRANKINGS'>;
      from?: string;
      to?: string;
    };
  }>('/sync/:sport', {
    schema: {
      tags: ['Admin'],
      summary: 'Trigger data sync for a sport',
      description:
        'Triggers a provider sync for the requested sport so ingestion jobs can be run manually from operational tools.',
      operationId: 'syncSportData',
      body: zodToJsonSchema(SportSyncRequestSchema),
      response: {
        200: zodToJsonSchema(IngestionJobsResponseSchema),
        500: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
  }, async (request) => {
    const sport = request.params.sport as Sport;
    const logger = request.contextLogger ?? request.log;
    logger.info({
      sport,
      feeds: request.body.feeds,
      from: request.body.from ?? null,
      to: request.body.to ?? null,
    }, 'Direct ingestion sport sync route requested');
    const jobs = await scheduler.runSportSync({
      sport,
      feeds: request.body.feeds,
      from: request.body.from ? new Date(request.body.from) : undefined,
      to: request.body.to ? new Date(request.body.to) : undefined,
    });
    logger.info({
      sport,
      feeds: request.body.feeds,
      jobs: jobs.map((job) => ({
        jobType: job.jobType,
        providerId: job.providerId,
        status: job.status,
        recordsProcessed: job.recordsProcessed,
        errors: job.errors,
      })),
    }, 'Direct ingestion sport sync route completed');
    return { jobs };
  });

  app.post<{
    Params: { sport: string; eventId: string };
    Body: {
      feeds: Array<'EVENTPARTICIPANTS' | 'EVENTLIVESCORES' | 'EVENTRESULTS'>;
    };
  }>(
    '/events/:sport/:eventId/sync',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Trigger feed-aware sync for a specific sport event',
        description:
          'Triggers explicit feed sync work for a single sport event such as participant hydration, live score polling, or final results.',
        operationId: 'syncEventData',
        body: zodToJsonSchema(EventSyncRequestSchema),
        response: {
          200: zodToJsonSchema(IngestionJobsResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
      },
    },
    async (request) => {
      const logger = request.contextLogger ?? request.log;
      logger.info({
        sport: request.params.sport,
        eventId: request.params.eventId,
        feeds: request.body.feeds,
      }, 'Direct ingestion event sync route requested');
      const jobs = await scheduler.runEventSync({
        sport: request.params.sport as Sport,
        eventId: request.params.eventId,
        feeds: request.body.feeds,
      });
      logger.info({
        sport: request.params.sport,
        eventId: request.params.eventId,
        feeds: request.body.feeds,
        jobs: jobs.map((job) => ({
          jobType: job.jobType,
          providerId: job.providerId,
          status: job.status,
          recordsProcessed: job.recordsProcessed,
          errors: job.errors,
        })),
      }, 'Direct ingestion event sync route completed');
      return { jobs };
    },
  );

  app.post<{ Params: { sport: string; eventId: string } }>(
    '/scores/:sport/:eventId',
    {
      schema: {
        tags: ['Admin'],
        summary: 'Ingest scores for a sport event',
        description:
          'Triggers score ingestion for a specific sport event when manual or ad hoc score refresh is required.',
        operationId: 'ingestEventScores',
        response: {
          200: zodToJsonSchema(IngestionJobResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
        description:
          'Triggers result ingestion for a specific sport event when final or corrected event outcomes need to be pulled in.',
        operationId: 'ingestEventResults',
        response: {
          200: zodToJsonSchema(IngestionJobResponseSchema),
          500: zodToJsonSchema(ErrorEnvelopeSchema),
        },
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
      description:
        'Triggers odds ingestion for the requested sport so odds-driven contest flows can refresh market data.',
      operationId: 'ingestSportOdds',
      response: {
        200: zodToJsonSchema(IngestSportOddsResponseSchema),
        500: zodToJsonSchema(ErrorEnvelopeSchema),
      },
    },
  }, async (request) => {
    const sport = request.params.sport as Sport;
    const odds = await oddsAdapter.getOdds(sport);
    return { sport, eventsWithOdds: odds.length, odds };
  });
}
