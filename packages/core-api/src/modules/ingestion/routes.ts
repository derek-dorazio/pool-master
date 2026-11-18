/**
 * Ingestion module — the operations over sports-data ingestion: providers, sync submissions
 * and their history, competitors a provider could not match, and the provider catalog
 * browse. Mounted at /api/v1/ingestion.
 *
 * Feed participants the sync could not link on its own wait here as "needs linking" (#1824).
 *
 * Every operation is root-admin (#205): `admin` is the permission, `ingestion` is what these
 * operations administer. Binding an unmatched competitor to a participant is an operation on
 * the participant's provider mappings, so it lives beside their read in the participants
 * module rather than here.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/ingestion.dto';
import '@poolmaster/shared/dto/activity.dto';
import type { LeagueEventsSyncRequest } from '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { EventScoreSourceService } from '../events/event-score-source-service';
import type { ProviderRegistry } from './core/provider-registry';
import type { IngestionService } from './ingestion-service';
import { createIngestionHandlers } from './handler';
import { getAppPrisma } from '../../core/prisma-context';
import { requireAuthUser } from '../../plugins/auth-guard';
import { toActivityJobDto } from '../../mappers';
import type { LeagueEventsSync } from '../events/league-events-sync';
import { PrismaAmbiguousFeedParticipantRepository, PrismaParticipantProviderMappingRepository } from '../../adapters';
import { FeedParticipantLinkService } from './feed-participant-links';
import type { IngestionPersistence } from './persistence/ingestion-persistence';

export interface IngestionModuleOptions {
  ingestionService: IngestionService;
  providerRegistry: ProviderRegistry;
  /** A sport league's events sync (#1819), for its Sync now. */
  leagueEventsSync: Pick<LeagueEventsSync, 'syncNow'>;
  /** Writes a resolved feed participant's mapping and field rows (#1824): the sync's own writer, so its caches and rebuilds follow. */
  ingestionPersistence: Pick<IngestionPersistence, 'resolveAmbiguousFeedParticipant'>;
}

const SPORT_PARAM = { type: 'string', enum: Object.values(Sport) };

export function ingestionModule(fastify: FastifyInstance, opts: IngestionModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');
  const errors = (...statuses: number[]) =>
    Object.fromEntries([401, 403, ...statuses].map((status) => [status, envelope]));

  const prisma = getAppPrisma(fastify);
  const handler = createIngestionHandlers(
    opts.ingestionService,
    new EventScoreSourceService(prisma, opts.providerRegistry, fastify.log),
    new FeedParticipantLinkService({
      ambiguous: new PrismaAmbiguousFeedParticipantRepository(prisma),
      mappings: new PrismaParticipantProviderMappingRepository(prisma),
      persistence: opts.ingestionPersistence,
      logger: fastify.log.child({ module: 'ingestion.feed-participant-links' }),
    }),
  );

  fastify.get('/providers', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List sports-data providers with their live health',
      description: 'Every registered provider, each with a live health check made for this request, the sports ingestion is scheduled for, and how many of its events are scheduled or in progress.',
      operationId: 'listProviders',
      response: { 200: schemaRef('ProviderListResponse'), ...errors() },
    },
    handler: handler.listProviders,
  });

  fastify.get('/sync-runs', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List provider sync runs inside a time window',
      description: 'The sync-run history, filtered by provider, sport and status and bounded by a submission-time window. `to` defaults to now and `from` to 6 hours before `to`; nothing pages the result. Newest submission first. Each run carries its summary only; read one run\'s detailed diagnostics with getProviderSyncRun.',
      operationId: 'listProviderSyncRuns',
      querystring: schemaRef('ProviderSyncRunListQuery'),
      response: { 200: schemaRef('ProviderSyncRunListResponse'), ...errors() },
    },
    handler: handler.listSyncRuns,
  });

  fastify.get('/sync-runs/:syncRunId', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Read one provider sync run with its detailed diagnostics',
      description: 'One sync run\'s summary plus its detailed diagnostics: the rows the sync changed, the ingestion job record, and the raw provider payload. The diagnostics are null before the run starts and once they are cleared, 30 days after submission; the run itself is kept a year. 404 when there is no such run.',
      operationId: 'getProviderSyncRun',
      params: {
        type: 'object',
        required: ['syncRunId'],
        properties: { syncRunId: { type: 'string', format: 'uuid' } },
      },
      response: { 200: schemaRef('ProviderSyncRunDetailDto'), ...errors(404) },
    },
    handler: handler.getSyncRun,
  });

  fastify.post('/sports/:sport/events/:eventId/sync', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Submit a manual event sync',
      description: 'Submits one sync run per requested event-level feed for the provider event `eventId` of the provider `providerId` names, which must serve `sport` (404 otherwise). Refused with 409 when a feed is not allowed by the event\'s syncScope. The runs execute asynchronously after acceptance.',
      operationId: 'submitEventSync',
      params: {
        type: 'object',
        required: ['sport', 'eventId'],
        properties: { sport: SPORT_PARAM, eventId: { type: 'string' } },
      },
      body: schemaRef('EventSyncRequest'),
      response: { 202: schemaRef('ProviderManualSyncSubmissionResponse'), ...errors(404, 409, 422) },
    },
    handler: handler.submitEventSync,
  });

  fastify.post('/sport-leagues/:sportLeagueId/events-sync', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Sync a sport league\'s events now',
      description: 'Queues the sport league\'s events sync as a background job, the same job its schedule queues every six hours, and answers it at once (202): the provider\'s events for the league\'s tour become its events, and the ones already linked take the provider\'s name, venue and dates. '
        + 'The job records an EVENTS sync run with what it created, updated and skipped; follow it on Activity. When the league\'s sync is already waiting to run, answers that job. '
        + '404 SPORT_LEAGUE_NOT_FOUND; 422 SPORT_LEAGUE_NOT_SYNCED when no provider syncs the league\'s events.',
      operationId: 'syncLeagueEvents',
      params: {
        type: 'object',
        required: ['sportLeagueId'],
        properties: { sportLeagueId: { type: 'string', format: 'uuid' } },
      },
      body: schemaRef('LeagueEventsSyncRequest'),
      response: { 202: schemaRef('ActivityJobResponse'), ...errors(404, 422) },
    },
    handler: async (request: FastifyRequest<{ Params: { sportLeagueId: string }; Body: LeagueEventsSyncRequest }>, reply: FastifyReply) => {
      const job = await opts.leagueEventsSync.syncNow({
        sportLeagueId: request.params.sportLeagueId,
        eventYear: request.body.eventYear,
        requestedByUserId: requireAuthUser(request).userId,
      });
      return reply.code(202).send({ job: toActivityJobDto(job, []) });
    },
  });

  fastify.get('/unmapped-participants', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List competitors a provider could not match',
      description: 'Every competitor a provider reports, across its scheduled sports, that no participant is mapped to. Their synced data has nowhere to land until one is: bind each with bindParticipantProviderMapping. '
        + '`providerId` asks only that provider, and `externalId` keeps only that competitor, so one competitor\'s page reads one row (#1251).',
      operationId: 'listUnmappedProviderParticipants',
      querystring: schemaRef('UnmappedProviderParticipantListQuery'),
      response: { 200: schemaRef('UnmappedProviderParticipantListResponse'), ...errors() },
    },
    handler: handler.listUnmappedParticipants,
  });

  fastify.get('/ambiguous-participants', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List feed participants that need linking',
      description: 'Every feed participant the sync could not link on its own because its name matches two or more of the site\'s participants, still open, oldest first; never paged. '
        + '`sportLeagueId` keeps one sport league\'s. Each names its candidates and the events whose fields sent it; it is on none of those fields until resolved with resolveAmbiguousFeedParticipant.',
      operationId: 'listAmbiguousFeedParticipants',
      querystring: schemaRef('AmbiguousFeedParticipantListQuery'),
      response: { 200: schemaRef('AmbiguousFeedParticipantListResponse'), ...errors() },
    },
    handler: handler.listAmbiguousFeedParticipants,
  });

  fastify.post('/ambiguous-participants/:id/resolve', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Resolve a feed participant that needs linking',
      description: 'Links the feed participant to one of its candidates (LINK, with MANUAL confidence) or creates it as a new participant from the feed\'s latest copy (CREATE), affiliated with the sport leagues its tour names as a sync would. '
        + 'Either maps its feed id, so the next sync links it on its own, and writes its field row in every event that sent it at once. Answers the row, resolved. '
        + '404 FEED_PARTICIPANT_LINK_NOT_FOUND; 409 FEED_PARTICIPANT_LINK_RESOLVED when it was resolved already, FEED_PARTICIPANT_ALREADY_MAPPED when its feed id was bound some other way since; 422 FEED_PARTICIPANT_NOT_A_CANDIDATE when the pick is not a candidate, or the provider maps it since.',
      operationId: 'resolveAmbiguousFeedParticipant',
      params: {
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', format: 'uuid' } },
      },
      body: schemaRef('ResolveAmbiguousFeedParticipantRequest'),
      response: { 200: schemaRef('AmbiguousFeedParticipantDto'), ...errors(404, 409, 422) },
    },
    handler: handler.resolveAmbiguousFeedParticipant,
  });

  fastify.get('/providers/:providerId/catalog-events', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Browse a provider\'s live event catalog',
      description: 'Calls the provider live — no dependency on any persisted SportEvent row or on schedule/field sync being enabled. Serves the tournament-creation browse mode and the score-source linking picker: a plain filtered list with no scoring or ranking.',
      operationId: 'listProviderCatalogEvents',
      params: { type: 'object', required: ['providerId'], properties: { providerId: { type: 'string' } } },
      querystring: schemaRef('ProviderCatalogEventListQuery'),
      response: { 200: schemaRef('ProviderCatalogEventListResponse'), ...errors(404) },
    },
    handler: handler.listProviderCatalogEvents,
  });
}
