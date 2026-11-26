/**
 * The SportLeague operation set and its roster: the participants that belong to it and their
 * ranks (#236, #1853), and its Seasons (#2003). A sport league's events are reached through the
 * event list, filtered by sport league and Season. Before #236 the same operations were reachable
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
import { buildSportLeagueService, eventFieldCache } from '../events/wiring';
import { PrismaSportLeagueOverviewReader } from '../../adapters/prisma-sport-league-overview-reader';
import { SportLeagueOverviewService } from '../sport-catalog/sport-league-overview';
import { buildSportLeagueHandlers } from './handler';
import type { SportDataProviderLookup } from '../sport-catalog/sport-league-service';
import { PrismaSportLeaguePageReader } from '../../adapters/prisma-sport-league-page-reader';
import { SportLeaguePageService } from '../sport-catalog/sport-league-page';

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
  /** The provider leagues a sport league's event sync may name (ADR 0011, #1997). */
  providers: SportDataProviderLookup;
  /** The League page's syncs read (#1865): which providers' webhooks drive their live scores. */
  /** The providers whose webhooks are on now. */
  webhookProviderIds: () => readonly string[];
}

export function sportLeaguesModule(fastify: FastifyInstance, opts: SportLeaguesModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);
  const sportLeagues = buildSportLeagueService(getAppPrisma(fastify), fastify.log, opts.providers);
  const lists = new ReadCache<SportLeagueListResponse>(readPublicReadCacheTtlMs(process.env));
  const overviews = new SportLeagueOverviewService({ reader: new PrismaSportLeagueOverviewReader(getAppPrisma(fastify)) });
  const page = new SportLeaguePageService({
    reader: new PrismaSportLeaguePageReader(getAppPrisma(fastify)),
    webhookProviderIds: opts.webhookProviderIds,
  });
  const handler = buildSportLeagueHandlers(sportLeagues, lists, overviews, page);
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
      description: 'The root admin\'s Sports page (#1847): every sport league, on or off, never paged, by sport (most popular first) then name. '
        + 'Each row carries its provider, sync health from the latest run of each of its syncs, '
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

  fastify.post('/:sportLeagueId/test-slots', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Add a test slot to the current Season',
      description: 'A labelled test slot of one of the league\'s slot definitions, in its current Season (QA only, #2004): the sync never reads or writes it, and a test event is made on it (createEvent). '
        + 'It copies the definition\'s series format and pairing, and its dates are the test event\'s. '
        + '404 SPORT_LEAGUE_NOT_FOUND, SLOT_DEFINITION_NOT_FOUND; 422 SPORT_LEAGUE_HAS_NO_SEASON, TEST_SLOT_ENDS_BEFORE_START, SLOT_COMPETITION_NOT_IN_SEASON when the current Season lacks the competition of the definition; 409 TEST_SLOT_LABEL_TAKEN. Root admin only.',
      operationId: 'createTestSlot',
      params: SPORT_LEAGUE_PARAMS,
      body: schemaRef('CreateTestSlotRequest'),
      response: { 201: schemaRef('SportLeagueSeasonSlotResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.createTestSlot,
  });

  fastify.delete('/:sportLeagueId/test-slots/:seasonSlotId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Remove a test slot',
      description: 'Removes a test slot (QA only, #2075), all or nothing: the test event on it, the slot, and each test participant on that event\'s field that no other field holds; no other participant of the league. How a browser journey cleans up after itself. '
        + '404 SEASON_SLOT_NOT_FOUND for a slot that is not the league\'s; 422 SEASON_SLOT_NOT_TEST for a slot the sync keeps; 409 EVENT_HAS_CONTESTS while a contest covers its event. Root admin only.',
      operationId: 'deleteTestSlot',
      params: {
        type: 'object',
        required: ['sportLeagueId', 'seasonSlotId'],
        properties: { sportLeagueId: { type: 'string', format: 'uuid' }, seasonSlotId: { type: 'string', format: 'uuid' } },
      },
      response: { 204: { type: 'null' }, ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.deleteTestSlot,
  });

  fastify.patch('/:sportLeagueId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport league',
      description: 'The current Season is never set here: the daily recompute sets it (#2003). '
        + '422 SPORT_LEAGUE_NOT_BRACKET when bracketAdvancement is RESEED_BY_SEED for a sport not played as a bracket. '
        + '409 SPORT_LEAGUE_BRACKET_ADVANCEMENT_LOCKED when bracketAdvancement changes while any event of the sport league has its bracket loaded: '
        + 'the loaded bracket\'s links were drawn for the rule it has. Sending the rule the league already has is allowed and changes nothing. '
        + 'syncProviderLeagueId turns the league\'s event sync on with a provider league (ADR 0011, #1997), mapping the league to it when it is not yet, or off with null: '
        + '404 PROVIDER_LEAGUE_NOT_FOUND for one that does not exist, 422 PROVIDER_SPORT_MISMATCH for one of another sport, 422 PROVIDER_NOT_FOUND while it or its provider is switched off or not running. '
        + 'autoReleaseDaysBeforeStart sets how many days before its start a synced draft event is released on its own once its ready checks pass, or null for never (#1823). '
        + '422 PROFILE_FIRST_SOURCES_DIFFER when the league\'s tier and pricing profiles, as the update leaves them, start with different sources (#2160). Root admin only.',
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
      description: 'Deletes a sport league nothing uses any more and takes it out of every league\'s muted sport leagues. '
        + '409 SPORT_LEAGUE_IN_USE, naming what still uses it, while it has an event in any year, a contest setup, an event page offer, a league\'s cup or a participant: '
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
      summary: 'List a sport league\'s syncs with their health, latest run and what drives them',
      description: 'The League page\'s Syncs card (#1865): one row per sync kind (event list, fields, live scores and results), always all three. '
        + 'Health follows the Sports page\'s rule from that sync\'s latest run; '
        + 'live scores follow the webhook while the provider\'s webhooks are on, and every other sync runs on the one ingestion schedule. Root admin only.',
      operationId: 'listSportLeagueSyncs',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueSyncListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listSyncs,
  });

  fastify.get('/:sportLeagueId/positions', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List a sport league\'s positions with their provider codes',
      description: 'The League page\'s Structure tab (#2001): every playing position of the sport league, by display order, never paged, '
        + 'with whether its players can be picked into a field and each provider\'s codes for it. Set by migration; read-only. '
        + 'Read in a fixed number of queries. Root admin only.',
      operationId: 'listSportLeaguePositions',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeaguePositionListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listPositions,
  });

  fastify.get('/:sportLeagueId/structure', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'Get a sport league\'s phases, competitions and slot definitions with their provider mappings',
      description: 'The League page\'s Structure tab (#2002): the sport league\'s timeless phases, in the order a Season plays them, '
        + 'each with its competitions in order (#2153) and each competition\'s slot definitions in play order with their provider mappings. Set by migration, so there is no write. '
        + 'Read from a fixed number of queries, however many slots. Root admin only.',
      operationId: 'getSportLeagueStructure',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueStructureResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.getStructure,
  });

  fastify.get('/:sportLeagueId/seasons', {
    schema: {
      tags: TAGS,
      summary: 'List a sport league\'s Seasons with their provider ids, phases, competitions and slots',
      description: 'Every Season of the sport league (#2003), latest first, each with whether it is current, each provider\'s id for it, '
        + 'and its phases with their status, each phase\'s competitions with their status and champion (#2153), and each competition\'s slots in play order, test slots included. Seasons are added by migration, so there is no write. '
        + 'What the Structure tab lists and every Season picker offers, labelled by name. Read from a fixed number of queries, however many Seasons and slots. '
        + 'Any signed-in user may read it.',
      operationId: 'listSportLeagueSeasons',
      params: SPORT_LEAGUE_PARAMS,
      response: { 200: schemaRef('SportLeagueSeasonListResponse'), ...errors(401, 404) },
    },
    handler: handler.listSeasons,
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
      description: 'Who competes in the sport league (#1853), best rank first, unranked last, then by name. Never paged. A test participant is on no roster; testData=true lists only the test participants, which a test event\'s field takes (#2096).',
      operationId: 'listSportLeagueParticipants',
      params: SPORT_LEAGUE_PARAMS,
      querystring: schemaRef('SportLeagueParticipantListQuery'),
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
