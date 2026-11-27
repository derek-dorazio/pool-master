/**
 * Ingestion module — the operations over sports-data ingestion: providers, sync submissions
 * and their history, and the provider catalog browse. Mounted at /api/v1/ingestion. A
 * competitor the feed could not match is a sync finding (#1999), on its own routes under
 * /api/v1/ingestion/sync-findings.
 *
 * Every operation is root-admin (#205): `admin` is the permission, `ingestion` is what these
 * operations administer.
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers the named components this module's routes $ref (#192).
import '@poolmaster/shared/dto/ingestion.dto';
import '@poolmaster/shared/dto/activity.dto';
import type { LeagueEventsSyncRequest } from '@poolmaster/shared/dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { requireRootAdmin } from '../../core/root-admin-guard';
import type { ProviderRegistry } from './core/provider-registry';
import type { IngestionService } from './ingestion-service';
import type { ProviderSettingsService } from './provider-settings-service';
import { createIngestionHandlers } from './handler';
import { requireAuthUser } from '../../plugins/auth-guard';
import { toActivityJobDto } from '../../mappers';
import type { LeagueEventsSync } from '../events/league-events-sync';
import type { ActivityService } from '../activity/activity-service';

export interface IngestionModuleOptions {
  ingestionService: IngestionService;
  providerRegistry: ProviderRegistry;
  /** A sport league's events sync (#1819), for its Sync now. */
  leagueEventsSync: Pick<LeagueEventsSync, 'syncNow'>;
  /** Answers the queued job as its Activity row reads. */
  activity: Pick<ActivityService, 'present'>;
  /** The Providers page's edits (#1997). */
  providerSettings: ProviderSettingsService;
}


export function ingestionModule(fastify: FastifyInstance, opts: IngestionModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  fastify.addHook('onRequest', requireRootAdmin);

  const envelope = schemaRef('ErrorEnvelope');
  const errors = (...statuses: number[]) =>
    Object.fromEntries([401, 403, ...statuses].map((status) => [status, envelope]));

  const handler = createIngestionHandlers(
    opts.ingestionService,
    opts.providerSettings,
  );

  fastify.get('/providers', {
    schema: {
      tags: ['Ingestion'],
      summary: 'List sports-data providers with their live health and settings',
      description: 'Every provider with a Provider row or running in this task, each with a live health check made for this request (none for one not running), the sports its adapter covers, how many of its events are scheduled or in progress, and its settings and leagues (#1997).',
      operationId: 'listProviders',
      response: { 200: schemaRef('ProviderListResponse'), ...errors() },
    },
    handler: handler.listProviders,
  });

  fastify.patch('/provider-settings/:providerId', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Change a provider\'s settings',
      description: 'The Providers page\'s edit (#1997); omitted fields are left alone. The base URL, rate and poll intervals are taken by every task within a minute; enabling and the leagues read take effect when the server tasks next start. '
        + '404 PROVIDER_NOT_FOUND when there is no such Provider row. '
        + '422 PROVIDER_WEBHOOK_SECRET_MISSING when webhooksEnabled is true while the provider\'s signing secret is not set in this environment. Root admin only.',
      operationId: 'updateProviderSettings',
      params: { type: 'object', required: ['providerId'], properties: { providerId: { type: 'string', format: 'uuid', description: 'The Provider row (ProviderSettingsDto.id).' } } },
      body: schemaRef('UpdateProviderRequest'),
      response: { 200: schemaRef('ProviderSettingsResponse'), ...errors(400, 404, 409, 422) },
    },
    handler: handler.updateProvider,
  });

  fastify.patch('/provider-settings/:providerId/leagues/:providerLeagueId', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Change one of a provider\'s leagues',
      description: 'The Providers page\'s league edit (#1997); omitted fields are left alone. The quiet window and typical game length are taken by every task within a minute; enabling a league takes effect when the server tasks next start. '
        + '404 PROVIDER_LEAGUE_NOT_FOUND when the provider has no such league. Root admin only.',
      operationId: 'updateProviderLeague',
      params: {
        type: 'object',
        required: ['providerId', 'providerLeagueId'],
        properties: {
          providerId: { type: 'string', format: 'uuid', description: 'The Provider row (ProviderSettingsDto.id).' },
          providerLeagueId: { type: 'string', format: 'uuid', description: 'The provider league (ProviderLeagueDto.id).' },
        },
      },
      body: schemaRef('UpdateProviderLeagueRequest'),
      response: { 200: schemaRef('ProviderLeagueResponse'), ...errors(400, 404) },
    },
    handler: handler.updateProviderLeague,
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

  fastify.post('/events/:eventId/sync', {
    schema: {
      tags: ['Ingestion'],
      summary: 'Sync an event now',
      description: 'Queues one sync run per requested event-level feed for the event, read from its sport league\'s provider by the id the events sync gave it, and answers at once (202); the runs execute in a background job. '
        + '404 EVENT_NOT_FOUND, or SPORT_PROVIDER_NOT_FOUND when that provider is not running here; 409 EVENT_NOT_LINKED for a test event, which no provider syncs; 422 EVENT_SYNC_KIND_UNAVAILABLE for a kind outside the event\'s syncKinds (#2238).',
      operationId: 'submitEventSync',
      params: {
        type: 'object',
        required: ['eventId'],
        properties: { eventId: { type: 'string', format: 'uuid' } },
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
      description: 'Queues the sport league\'s events sync as a background job, the same job its schedule queues every six hours, and answers it at once (202): the provider\'s events for each Season it reads (the named one, or the current Season and every later one), asked for by the provider\'s own id for the Season, become its events in that Season, and the ones already linked take the provider\'s name, venue and dates. '
        + 'The job records an EVENTS sync run with what it created, updated and skipped; follow it on Activity. When the league\'s sync is already waiting to run, answers that job. '
        + '404 SPORT_LEAGUE_NOT_FOUND, or SPORT_LEAGUE_SEASON_NOT_FOUND for a Season that is not the league\'s; 422 SPORT_LEAGUE_NOT_SYNCED when no provider syncs the league\'s events, SPORT_LEAGUE_SEASON_NOT_MAPPED when the provider has no id for the named Season.',
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
        sportLeagueSeasonId: request.body.sportLeagueSeasonId,
        requestedByUserId: requireAuthUser(request).userId,
      });
      const [presented] = await opts.activity.present([job]);
      return reply.code(202).send({ job: toActivityJobDto(presented) });
    },
  });
}
