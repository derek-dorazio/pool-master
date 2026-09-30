/**
 * Ingestion module — the operations over sports-data ingestion: providers, sync submissions
 * and their history, competitors a provider could not match, the stale-event cleanup, and the
 * provider catalog browse. Mounted at /api/v1/ingestion.
 *
 * Every operation is root-admin (#205): `admin` is the permission, `ingestion` is what these
 * operations administer. Binding an unmatched competitor to a participant is an operation on
 * the participant's provider mappings, so it lives beside their read in the participants
 * module rather than here.
 */

import type { FastifyInstance } from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/ingestion.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import { EventScoreSourceService } from '../events/event-score-source-service';
import type { ProviderRegistry } from './core/provider-registry';
import type { IngestionService } from './ingestion-service';
import { createIngestionHandlers } from './handler';
import { getAppPrisma } from '../../core/prisma-context';

export interface IngestionModuleOptions {
  ingestionService: IngestionService;
  providerRegistry: ProviderRegistry;
}

const SPORT_PARAM = { type: 'string', enum: Object.values(Sport) };

export function ingestionModule(fastify: FastifyInstance, opts: IngestionModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);
  const errors = (...statuses: number[]) =>
    Object.fromEntries([401, 403, ...statuses].map((status) => [status, envelope]));

  const handler = createIngestionHandlers(
    opts.ingestionService,
    new EventScoreSourceService(getAppPrisma(fastify), opts.providerRegistry, fastify.log),
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
      description: 'The sync-run history, filtered by provider, sport and status and bounded by a submission-time window. `to` defaults to now and `from` to 6 hours before `to`; nothing pages the result. Runs not yet started come first, then newest start.',
      operationId: 'listProviderSyncRuns',
      querystring: schemaRef('ProviderSyncRunListQuery'),
      response: { 200: schemaRef('ProviderSyncRunListResponse'), ...errors() },
    },
    handler: handler.listSyncRuns,
  });

  fastify.post('/sports/:sport/sync', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Submit a manual sport sync',
      description: 'Submits one sync run per requested sport-level feed. The runs execute asynchronously after acceptance; follow them in the sync-run history.',
      operationId: 'submitSportSync',
      params: { type: 'object', required: ['sport'], properties: { sport: SPORT_PARAM } },
      body: schemaRef('SportSyncRequest'),
      response: { 202: schemaRef('ProviderManualSyncSubmissionResponse'), ...errors(404, 422) },
    },
    handler: handler.submitSportSync,
  });

  fastify.post('/sports/:sport/events/:eventId/sync', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Submit a manual event sync',
      description: 'Submits one sync run per requested event-level feed for the provider event `eventId`. Refused with 409 when a feed is not allowed by the event\'s syncScope. The runs execute asynchronously after acceptance.',
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

  fastify.get('/unmapped-participants', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List competitors a provider could not match',
      description: 'Every competitor a provider reports, across its scheduled sports, that no participant is mapped to. Their synced data has nowhere to land until one is: bind each with bindParticipantProviderMapping.',
      operationId: 'listUnmappedProviderParticipants',
      response: { 200: schemaRef('UnmappedProviderParticipantListResponse'), ...errors() },
    },
    handler: handler.listUnmappedParticipants,
  });

  fastify.post('/stale-events/cleanup', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Inventory or delete stale provider events',
      description: 'Inventories stale provider SportEvent rows and, in EXECUTE mode, deletes the eligible ones. Non-Golf events are stale because the current provider workflow is Golf-only; Golf events are stale once their end time has passed. A contest on the event, or a pick on one of its participants, protects it from deletion. Each event is deleted in its own transaction, and one that cannot be deleted is left in place and reported as not deleted.',
      operationId: 'cleanupStaleProviderEvents',
      body: schemaRef('ProviderEventCleanupRequest'),
      response: { 200: schemaRef('ProviderEventCleanupResponse'), ...errors() },
    },
    handler: handler.cleanupStaleProviderEvents,
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
