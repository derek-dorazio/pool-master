/**
 * The SportLeague operation set and its roster: the participants that belong to it and their
 * ranks (#236, #1853). A sport league's events are reached through the event list,
 * filtered by sport league and event year (plans/147). Before #236 the same operations were reachable
 * only as `adminGetGolfLeagueRoster` and siblings, golf-named doors onto cross-sport
 * services. Reads need a signed-in user, except the list, which the public How to Play page reads;
 * writes need the root-admin claim (A10).
 */
import type { FastifyInstance } from 'fastify';
import type { SportLeagueListResponse } from '@poolmaster/shared/dto/sport-catalog.dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
import '@poolmaster/shared/dto/sport-catalog.dto';
import '@poolmaster/shared/dto/participants.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import type { CdnInvalidator } from '../../core/cdn-invalidator';
import { PublicReadPath, readPublicReadCacheTtlMs } from '../../core/public-cache';
import { ReadCache } from '../../core/read-cache';
import { createSportLeagueService, eventFieldCache } from '../events/wiring';
import { PrismaSportLeagueOverviewReader } from '../../adapters/prisma-sport-league-overview-reader';
import { SportLeagueOverviewService } from '../sport-catalog/sport-league-overview';
import { createSportLeagueHandlers } from './handler';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import { PrismaSportLeaguePageReader } from '../../adapters/prisma-sport-league-page-reader';
import { SportLeaguePageService, type SportLeaguePageServiceDeps } from '../sport-catalog/sport-league-page';

const TAGS = ['Sport leagues'];

function errors(...statuses: number[]) {
  const envelope = schemaRef('ErrorEnvelope');
  return Object.fromEntries(statuses.map((status) => [status, envelope]));
}

const SPORT_LEAGUE_PARAMS = {
  type: 'object',
  required: ['sportLeagueId'],
  properties: { sportLeagueId: { type: 'string', format: 'uuid' } },
};

export interface SportLeaguesModuleOptions {
  cdn: CdnInvalidator;
  /** The providers a sport league's event sync may name (ADR 0011). */
  providerRegistry: ProviderRegistry;
  /** The League page's syncs read (#1865): the one ingestion schedule, and which providers' webhooks drive their live scores. */
  schedule: SportLeaguePageServiceDeps['schedule'];
  webhookProviderIds: readonly string[];
}

export function sportLeaguesModule(fastify: FastifyInstance, opts: SportLeaguesModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  const sportLeagues = createSportLeagueService(getAppPrisma(fastify), fastify.log, opts.providerRegistry);
  const lists = new ReadCache<SportLeagueListResponse>(readPublicReadCacheTtlMs(process.env));
  const overviews = new SportLeagueOverviewService({ reader: new PrismaSportLeagueOverviewReader(getAppPrisma(fastify)) });
  const page = new SportLeaguePageService({
    reader: new PrismaSportLeaguePageReader(getAppPrisma(fastify)),
    schedule: opts.schedule,
    webhookProviderIds: opts.webhookProviderIds,
  });
  const handler = createSportLeagueHandlers(sportLeagues, lists, overviews, page);
  const write = { onRequest: requireRootAdmin };

  // A ranking write changes the participants every event of the sport league shows on its field
  // (#1163, #1853). Rare enough to forget every event field this container read. A write that
  // lands also changes the public list, and the event pages that name the sport league (#1181).
  fastify.addHook('onSend', async (request, reply, payload) => {
    // An upload preview resolves rows and writes nothing.
    if (request.method === 'GET' || request.method === 'HEAD' || request.routeOptions.url?.endsWith('/upload/preview')) return payload;
    eventFieldCache.clear();
    if (reply.statusCode < 400) {
      lists.clear();
      opts.cdn.invalidate([PublicReadPath.SPORT_LEAGUES, PublicReadPath.EVENT_PAGES]);
    }
    return payload;
  });

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List sport leagues',
      description: 'Every sport league, or one sport\'s, each with its participant and event counts. The one list that takes a sport: a sport league is where the sport is chosen. Anyone may read it, signed in or not: the public How to Play page names each sport\'s leagues from it.',
      operationId: 'listSportLeagues',
      querystring: schemaRef('SportLeagueListQuery'),
      response: { 200: schemaRef('SportLeagueListResponse'), ...errors(404) },
    },
    handler: handler.listSportLeagues,
  });

  fastify.get('/overview', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List every sport league with its health, issues and season',
      description: 'The root admin\'s Sports page (#1847): every sport league, on or off, never paged, by sport (most popular first) then name, '
        + 'each Clutch Card straight after its parent league. Each row carries its kind, provider, sync health from the latest run of each of its syncs, '
        + 'its issues (failed syncs, draft events held by the automatic release), its season, its next event and its event count. '
        + 'No contest counts. Read from a fixed number of grouped queries, however many leagues. Root admin only.',
      operationId: 'listSportLeagueOverviews',
      response: { 200: schemaRef('SportLeagueOverviewListResponse'), ...errors(401, 403) },
    },
    handler: handler.listSportLeagueOverviews,
  });

  fastify.get('/:sportLeagueId', {
    schema: {
      tags: TAGS,
      summary: 'Get a sport league',
      operationId: 'getSportLeague',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueResponse'), ...errors(404) },
    },
    handler: handler.getSportLeague,
  });

  fastify.post('/', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Create a sport league',
      description: 'Adding a tour is one call, not a migration. 422 SPORT_LEAGUE_NOT_BRACKET when bracketAdvancement is RESEED_BY_SEED for a sport not played as a bracket. Root admin only.',
      operationId: 'createSportLeague',
      body: schemaRef('CreateSportLeagueRequest'),
      response: { 201: schemaRef('SportLeagueResponse'), ...errors(403, 404, 409, 422) },
    },
    handler: handler.createSportLeague,
  });

  fastify.patch('/:sportLeagueId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport league',
      description: 'Setting currentEventYear is "set as current": one write, so the sport league never has two current years, '
        + 'and 422 EVENT_YEAR_HAS_NO_EVENTS for a year the sport league has no events in (plans/147 decision 6). '
        + '422 SPORT_LEAGUE_NOT_BRACKET when bracketAdvancement is RESEED_BY_SEED for a sport not played as a bracket. '
        + '409 SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED when bracketAdvancement changes while any event of the sport league has its bracket loaded: '
        + 'the loaded bracket\'s links were drawn for the rule it has. Sending the rule the league already has is allowed and changes nothing. '
        + 'eventSyncProviderId turns the league\'s event sync on (ADR 0011) or off with null: 404 PROVIDER_NOT_FOUND for a provider not registered, '
        + '422 PROVIDER_SPORT_MISMATCH for one not covering the league\'s sport, 422 SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD while a synced league has no match keyword. '
        + 'autoReleaseDaysBeforeStart sets how many days before its start a synced draft event is released on its own once its ready checks pass, or null for never (#1823). Root admin only.',
      operationId: 'updateSportLeague',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('UpdateSportLeagueRequest'),
      response: { 200: schemaRef('SportLeagueResponse'), ...errors(403, 404, 409, 422) },
    },
    handler: handler.updateSportLeague,
  });

  fastify.delete('/:sportLeagueId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Delete a sport league',
      description: 'Deletes a sport league nothing uses any more, with its event series that have no events, and takes it out of every league\'s muted sport leagues. '
        + '409 SPORT_LEAGUE_IN_USE, naming what still uses it, while it has an event in any year, a contest setup, an event page offer, a league\'s cup or a playoff round naming it as its season league: '
        + 'delete its events first; the others are reference data or league history, and the sport league stays. Root admin only.',
      operationId: 'deleteSportLeague',
      params: SPORT_LEAGUE_PARAMS,
      response: { 204: { type: 'null' }, ...errors(403, 404, 409) },
    },
    handler: handler.deleteSportLeague,
  });

  fastify.get('/:sportLeagueId/syncs', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List a sport league\'s syncs with their health, latest run and next run',
      description: 'The League page\'s Syncs card (#1865): one row per sync kind (event list, fields, live scores and results), always all three. '
        + 'A Clutch Card reports its parent league\'s event list sync, which creates its events. Health follows the Sports page\'s rule from that sync\'s latest run; '
        + 'the next run comes from the one ingestion schedule, or none while the webhook drives it. Root admin only.',
      operationId: 'listSportLeagueSyncs',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueSyncListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listSyncs,
  });

  fastify.get('/:sportLeagueId/events/overview', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List every event of a sport league with its release, field, issues and last sync',
      description: 'The League page\'s Events grid (#1865): every event of the sport league, every year, never paged, by start. '
        + 'Each carries its release mode and date, its latest automatic release check, its field size, its own issues (SYNC, RELEASE, OVERDUE) and when a sync last ran on it. '
        + 'Read from a fixed number of grouped queries, however many events. Root admin only.',
      operationId: 'listSportLeagueEventOverviews',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueEventOverviewListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listEventOverviews,
  });

  fastify.get('/:sportLeagueId/participants/overview', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List every participant of a sport league with its feed id and who added it',
      description: 'The League page\'s Participants grid (#1865): every participant of the sport league, never paged, by name, '
        + 'with its provider\'s feed id, when a sync last saw it in the feed, and whether the feed or a root admin added it. Read in a fixed number of queries. Root admin only.',
      operationId: 'listSportLeagueParticipantOverviews',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueParticipantOverviewListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listParticipantOverviews,
  });

  fastify.get('/:sportLeagueId/participants', {
    schema: {
      tags: TAGS,
      summary: 'List a sport league\'s participants',
      description: 'Who competes in the sport league (#1853), best rank first, unranked last, then by name. Never paged.',
      operationId: 'listSportLeagueParticipants',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('ParticipantListResponse'), ...errors(404) },
    },
    handler: handler.listParticipants,
  });

  fastify.patch('/:sportLeagueId/participants/rankings', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Re-rank a sport league\'s participants',
      description: 'Root admin only. All or none; every participant named must be the sport league\'s.',
      operationId: 'updateSportLeagueParticipantRankings',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('SportLeagueParticipantRankingsRequest'),
      response: { 200: schemaRef('ParticipantListResponse'), ...errors(403, 404) },
    },
    handler: handler.updateParticipantRankings,
  });

  fastify.post('/:sportLeagueId/participants/rankings/upload/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview a ranking upload',
      description: 'Resolves each row to a participant of the sport league and writes nothing. Root admin only.',
      operationId: 'previewSportLeagueRankingUpload',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('SportLeagueRankingUploadRequest'),
      response: { 200: schemaRef('SportLeagueRankingUploadPreviewResponse'), ...errors(403, 404) },
    },
    handler: handler.previewRankingUpload,
  });

  fastify.post('/:sportLeagueId/participants/rankings/upload', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply a ranking upload',
      description: 'Ranks every row\'s participant, all or none; 422 SPORT_LEAGUE_RANKING_UPLOAD_UNRESOLVED_ROWS when any row does not resolve. Root admin only.',
      operationId: 'applySportLeagueRankingUpload',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('SportLeagueRankingUploadRequest'),
      response: { 200: schemaRef('ParticipantListResponse'), ...errors(403, 404, 422) },
    },
    handler: handler.applyRankingUpload,
  });
}
