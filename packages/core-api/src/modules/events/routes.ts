/**
 * The SportEvent operation set and its children's — rounds, the field
 * (SportEventParticipant), tiers and valuations, the golf score corrections (#236), and a
 * race's finishing order (#622), and a bracket's matches (#698).
 *
 * Before #236 everything here past `listEvents` was a golf-named admin operation under
 * /admin/sports/golf, and the event browser's participant list was a third projection of
 * the field. Each now acts on the object it names. Reads need a signed-in user; every
 * write needs the root-admin claim (access rule A10). Admin-only fields on the DTOs are
 * annotated, not stripped (plans/145 rule 4).
 */
import type { FastifyInstance } from 'fastify';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
// Registers ErrorEnvelope, which this module's error responses $ref (#192).
import '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192). ingestion.dto holds the
// provider sync submission the field refresh returns.
import '@poolmaster/shared/dto/ingestion.dto';
import '@poolmaster/shared/dto/events.dto';
import '@poolmaster/shared/dto/golf-scores.dto';
import '@poolmaster/shared/dto/race-results.dto';
import '@poolmaster/shared/dto/bracket.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import type { IngestionService } from '../ingestion/ingestion-service';
import type { EventLifecycleService } from './event-lifecycle-service';
import { EventScoreSourceService } from './event-score-source-service';
import { createEventHandlers } from './handler';
import { createEventLifecycleService, createSportEventServices } from './wiring';

export interface EventsModuleOptions {
  eventLifecycleService?: EventLifecycleService;
  ingestionService: IngestionService;
  providerRegistry?: ProviderRegistry;
}

const TAGS = ['Events'];

function errors(...statuses: number[]) {
  const envelope = schemaRef('ErrorEnvelope');
  return Object.fromEntries(statuses.map((status) => [status, envelope]));
}

const uuid = { type: 'string', format: 'uuid' };
const EVENT_PARAMS = { type: 'object', required: ['eventId'], properties: { eventId: uuid } };
const ROUND_PARAMS = {
  type: 'object',
  required: ['eventId', 'roundNumber'],
  properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 } },
};
const NO_CONTENT = { 204: { type: 'null' } };

export function eventsModule(fastify: FastifyInstance, opts: EventsModuleOptions): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const eventLifecycle = opts.eventLifecycleService ?? createEventLifecycleService(prisma, { logger: fastify.log });
  const handler = createEventHandlers({
    services: createSportEventServices(prisma, fastify.log.child({ module: 'events.service' }), eventLifecycle),
    eventLifecycle,
    scoreSource: new EventScoreSourceService(prisma, opts.providerRegistry, fastify.log),
    ingestion: opts.ingestionService,
  });
  const write = { onRequest: requireRootAdmin };

  // --- SportEvent --------------------------------------------------------------------

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List sport events',
      description:
        'The sport-event catalog, narrowed by sport, status, sport league, event year and name and never paged. Any signed-in user may read it: '
        + 'contest setup picks an event from it, and a root admin browses it. Each event carries its loaded field '
        + 'size, contest-setup readiness, and its tier and contest counts. DRAFT events (not yet released for contests) are listed for a root admin only.',
      operationId: 'listEvents',
      querystring: schemaRef('SportEventListQuery'),
      response: { 200: schemaRef('SportEventListResponse'), ...errors(401) },
    },
    handler: handler.listEvents,
  });

  fastify.get('/:eventId', {
    schema: {
      tags: TAGS,
      summary: 'Get a sport event',
      description: '404 EVENT_NOT_FOUND for a DRAFT event unless the caller is a root admin.',
      operationId: 'getEvent',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 404) },
    },
    handler: handler.getEvent,
  });

  fastify.post('/', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Create a sport event',
      description:
        'An admin-authored edition of a series in an event year, SCHEDULED, accepting no provider data, with its default rounds and tiers. '
        + 'The series is found or created in the sport league by the event\'s name; 409 EVENT_EDITION_ALREADY_EXISTS when it already has an edition that year. '
        + 'The sport comes from the sport league. Root admin only.',
      operationId: 'createEvent',
      body: schemaRef('CreateSportEventRequest'),
      response: { 201: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.createEvent,
  });

  fastify.post('/clone-year', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Clone a sport league\'s event year forward',
      description:
        'Re-creates each of a sport league\'s events in one event year as a fresh event in another (default: the next), '
        + 'dates shifted by the year difference and in the same series (plans/124 §4.2a, plans/147). Fields, tiers, prices, scores and provider links are never copied, '
        + 'and the current event year does not change. 422 EVENT_YEAR_HAS_NO_EVENTS for an empty source year; 409 EVENT_YEAR_NOT_EMPTY when the target year already has events. Root admin only.',
      operationId: 'cloneEventYear',
      body: schemaRef('CloneSportEventYearRequest'),
      response: { 201: schemaRef('SportEventListResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.cloneEventYear,
  });

  fastify.post('/import-year-from-provider', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Import a tour\'s event year from a provider',
      description:
        'Creates each provider event for the sport league\'s tour starting in eventYear that PoolMaster does not have yet, each linked to it for scores (SCORES_ONLY) '
        + 'exactly as createEventFromProviderEvent would (#385). A provider event belongs to the tour when its metadata.tour equals the sport league\'s matchKeyword, ignoring case. '
        + 'Events already linked, and series that already have an edition that year, are skipped and reported, so the import can be re-run. Fields are not loaded. '
        + '404 PROVIDER_NOT_FOUND or SPORT_LEAGUE_NOT_FOUND; 422 SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD. Root admin only.',
      operationId: 'importEventYearFromProvider',
      body: schemaRef('ImportSportEventYearFromProviderRequest'),
      response: { 201: schemaRef('ImportSportEventYearFromProviderResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.importEventYearFromProvider,
  });

  fastify.post('/from-provider-event', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Create a sport event from a provider event',
      description:
        'An event named and dated by a browsed provider event, linked to it for scores (SCORES_ONLY). The field is not loaded; '
        + 'refreshEventParticipants does that. 409 EXTERNAL_EVENT_ALREADY_LINKED when another event holds the identity, '
        + 'EVENT_EDITION_ALREADY_EXISTS when the series already has an edition that year. Root admin only.',
      operationId: 'createEventFromProviderEvent',
      body: schemaRef('CreateSportEventFromProviderEventRequest'),
      response: { 201: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.createEventFromProviderEvent,
  });

  fastify.patch('/:eventId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport event',
      description: 'Edits any event, linked to a provider or not; a provider never overwrites these fields. A new startDate moves every round by the same amount; a higher rounds count adds rounds, each a day after the one before. Root admin only.',
      operationId: 'updateEvent',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.updateEvent,
  });

  fastify.delete('/:eventId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Delete a sport event',
      description: 'Deletes the event with its rounds, tiers and field. 409 EVENT_HAS_CONTESTS while any contest runs on it. Root admin only.',
      operationId: 'deleteEvent',
      params: EVENT_PARAMS,
      response: { ...NO_CONTENT, ...errors(401, 403, 404, 409) },
    },
    handler: handler.deleteEvent,
  });

  fastify.post('/:eventId/release', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Release a draft sport event for contests',
      description: 'DRAFT → SCHEDULED. Commissioners can then see the event and build contests on it, and its tiers and prices are locked for good. '
        + 'Refused unless the field is loaded, every active participant has a tier, every tier has an active participant, and the start time has not passed. '
        + 'An event whose sport plays a bracket also needs its bracket complete (every side of every match named or filled by an earlier winner, every active field member in it, nobody withdrawn left in it), and its seeds lock at release. Root admin only.',
      operationId: 'releaseEvent',
      params: EVENT_PARAMS,
      response: {
        200: schemaRef('SportEventResponse'),
        ...errors(401, 403, 404),
        409: { ...schemaRef('ErrorEnvelope'), description: 'SPORT_EVENT_NOT_DRAFT: the event has already been released. SPORT_EVENT_ALREADY_STARTED: its start time has passed.' },
        422: { ...schemaRef('ErrorEnvelope'), description: 'SPORT_EVENT_NOT_READY: the field is not loaded, an active participant has no tier, a tier has no active participant, prices are not assigned or miss an active participant, or a bracket event\'s bracket is incomplete.' },
      },
    },
    handler: handler.releaseEvent,
  });

  fastify.post('/:eventId/transition', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Move a sport event to its next status',
      description: 'Only to one of the event\'s allowedTransitions. Activates or settles its contests as the new status requires. '
        + 'A DRAFT event is refused SCHEDULED with 409 SPORT_EVENT_RELEASE_REQUIRED: releasing it is its own action (releaseEvent). Root admin only.',
      operationId: 'transitionEvent',
      params: EVENT_PARAMS,
      body: schemaRef('TransitionSportEventRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409) },
    },
    handler: handler.transitionEvent,
  });

  fastify.put('/:eventId/score-source', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Link a sport event to a provider event for scores',
      description: '404 PROVIDER_NOT_FOUND when no provider is registered under the id; 422 PROVIDER_SPORT_MISMATCH when the provider does not cover the event\'s sport; 409 EXTERNAL_EVENT_ALREADY_LINKED when another event holds the identity. Root admin only.',
      operationId: 'linkEventScoreSource',
      params: EVENT_PARAMS,
      body: schemaRef('LinkSportEventScoreSourceRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.linkScoreSource,
  });

  fastify.delete('/:eventId/score-source', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Unlink a sport event from its provider',
      description: 'Root admin only.',
      operationId: 'unlinkEventScoreSource',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.unlinkScoreSource,
  });

  fastify.get('/:eventId/live-simulation', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'Get the simulated live scoring running for an event',
      description: 'Root admin only. The simulation started by startEventLiveSimulation, with its current round; poll it to watch the simulation advance. 404 LIVE_SIMULATION_NOT_RUNNING when none is running: never started, or the provider restarted and forgot it.',
      operationId: 'getEventLiveSimulation',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventLiveSimulationResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.getLiveSimulation,
  });

  fastify.post('/:eventId/live-simulation', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Start simulated live scoring from the event\'s score source',
      description: 'Root admin only. For testing a live contest: asks the linked provider to play the event\'s four rounds forward on its own clock, hole by hole; calling again restarts from round 1. Scores reach PoolMaster through the normal live-score sync, which polls only while the event is IN_PROGRESS. Only providers whose summary has supportsLiveSimulation (the QA mock feed) accept it.',
      operationId: 'startEventLiveSimulation',
      params: EVENT_PARAMS,
      body: schemaRef('StartSportEventLiveSimulationRequest'),
      response: { 200: schemaRef('SportEventLiveSimulationResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.startLiveSimulation,
  });

  // --- Rounds --------------------------------------------------------------------------

  fastify.get('/:eventId/rounds', {
    schema: {
      tags: TAGS,
      summary: 'List a sport event\'s rounds',
      operationId: 'listEventRounds',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventRoundListResponse'), ...errors(401, 404) },
    },
    handler: handler.listEventRounds,
  });

  fastify.patch('/:eventId/rounds', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Reschedule a sport event\'s rounds',
      description: 'Moves existing rounds, all or none; 404 ROUND_NOT_FOUND for a round the event lacks. Root admin only.',
      operationId: 'updateEventRounds',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventRoundsRequest'),
      response: { 200: schemaRef('SportEventRoundListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.updateEventRounds,
  });

  // --- The field (SportEventParticipant) -----------------------------------------------

  fastify.get('/:eventId/participants', {
    schema: {
      tags: TAGS,
      summary: 'List a sport event\'s field',
      description: 'Every participant on the field with its canonical participant, valuation, standing and rounds, in seed order.',
      operationId: 'listEventParticipants',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 404) },
    },
    handler: handler.listEventParticipants,
  });

  fastify.post('/:eventId/participants', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Add participants to a sport event\'s field',
      description: 'Any participants; ones already on the field are skipped. Root admin only.',
      operationId: 'addEventParticipants',
      params: EVENT_PARAMS,
      body: schemaRef('AddSportEventParticipantsRequest'),
      response: { 200: schemaRef('AddSportEventParticipantsResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.addEventParticipants,
  });

  fastify.patch('/:eventId/participants', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport event\'s field',
      description: 'Patches field rows and their manual prices, all or none. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED when a released event\'s price would change: its tiers and prices are locked. '
        + '409 SPORT_EVENT_SEEDS_LOCKED when a released bracket event\'s seed would change: the upset bonus reads the seeds as they stood at release.',
      operationId: 'updateEventParticipants',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventParticipantsRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409) },
    },
    handler: handler.updateEventParticipants,
  });

  fastify.post('/:eventId/participants/seed', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Seed a sport event\'s field from its sport league',
      description: 'Adds the sport league\'s active affiliations with derived seeds and odds; ones already on the field are skipped. Root admin only.',
      operationId: 'seedEventParticipants',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SeedSportEventParticipantsResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.seedEventParticipants,
  });

  fastify.post('/:eventId/participants/refresh', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Reload a sport event\'s field from its provider',
      description: 'Queues a provider sync of the field and returns at once; reload the field once the sync runs complete. 409 EVENT_NOT_LINKED for an event with no provider. Root admin only.',
      operationId: 'refreshEventParticipants',
      params: EVENT_PARAMS,
      response: { 202: schemaRef('ProviderManualSyncSubmissionResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.refreshEventParticipants,
  });

  fastify.post('/:eventId/participants/upload/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview a field upload',
      description:
        'Resolves each row against the event\'s field — participantId, then externalId, then an exact case-insensitive playerName, '
        + 'with no fallback — and reports what applying it would change to ranking, oddsToWin, seedNumber, isActive and inactiveReason. '
        + 'A participant not on the field is UNRESOLVED: the upload never adds one, so the field is loaded from the provider first. '
        + 'A participant named by two rows is a DUPLICATE_PARTICIPANT row error. Writes nothing. Root admin only.',
      operationId: 'previewEventParticipantUpload',
      params: EVENT_PARAMS,
      body: schemaRef('SportEventParticipantUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantUploadPreviewResponse'), ...errors(400, 401, 403, 404) },
    },
    handler: handler.previewEventParticipantUpload,
  });

  fastify.post('/:eventId/participants/upload', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply a field upload',
      description:
        'Re-runs the preview, then patches every changed row in one transaction, all or none. 422 EVENT_PARTICIPANT_UPLOAD_ROWS_UNRESOLVED, '
        + 'with nothing written, when any row is not MATCHED or is a duplicate. Omitted values are left alone; null clears. '
        + 'A later field refresh from the provider replaces these values as it does grid edits, except a released bracket event\'s seeds. '
        + '409 SPORT_EVENT_SEEDS_LOCKED when a released bracket event\'s seed would change. Returns the field. Root admin only.',
      operationId: 'applyEventParticipantUpload',
      params: EVENT_PARAMS,
      body: schemaRef('SportEventParticipantUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.applyEventParticipantUpload,
  });

  fastify.delete('/:eventId/participants/:sportEventParticipantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Remove a participant from a sport event\'s field',
      description: '409 EVENT_PARTICIPANT_HAS_PICKS once a contest entry has picked it — withdraw it instead. 409 EVENT_PARTICIPANT_IN_BRACKET while a bracket match names it. Root admin only.',
      operationId: 'removeEventParticipant',
      params: {
        type: 'object',
        required: ['eventId', 'sportEventParticipantId'],
        properties: { eventId: uuid, sportEventParticipantId: uuid },
      },
      response: { ...NO_CONTENT, ...errors(401, 403, 404, 409) },
    },
    handler: handler.removeEventParticipant,
  });

  // --- Tiers and valuations ------------------------------------------------------------

  fastify.get('/:eventId/tiers', {
    schema: {
      tags: TAGS,
      summary: 'List a sport event\'s tiers',
      description: 'Who is in each tier is on each field row\'s valuation (listEventParticipants).',
      operationId: 'listEventTiers',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventTierListResponse'), ...errors(401, 404) },
    },
    handler: handler.listEventTiers,
  });

  fastify.put('/:eventId/tiers', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Replace a sport event\'s tiers',
      description: '409 TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS when a removed tier still has participants and no reassignOrphansTo is given. Root admin only.',
      operationId: 'replaceEventTiers',
      params: EVENT_PARAMS,
      body: schemaRef('ReplaceSportEventTiersRequest'),
      response: { 200: schemaRef('SportEventTierListResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.replaceEventTiers,
  });

  fastify.post('/:eventId/tiers/auto-assign', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Fill a sport event\'s tiers from its active field',
      description: 'Returns the field with its new valuations. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED once the event is released: its tiers and prices are locked.',
      operationId: 'autoAssignEventTiers',
      params: EVENT_PARAMS,
      body: schemaRef('AutoAssignSportEventTiersRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409) },
    },
    handler: handler.autoAssignEventTiers,
  });

  fastify.put('/:eventId/tiers/assignments', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Replace a sport event\'s tier assignments',
      description: 'The drag-and-drop save, all or none. Returns the field with its new valuations. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED once the event is released: its tiers and prices are locked.',
      operationId: 'replaceEventTierAssignments',
      params: EVENT_PARAMS,
      body: schemaRef('ReplaceSportEventTierAssignmentsRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.replaceEventTierAssignments,
  });

  fastify.post('/:eventId/prices/auto-assign', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Price a sport event\'s seeded field',
      description: 'Prices the active field on the budget curve with the values sent, best seed first and golfers with no seed last, and stores the values as the event\'s pricing. Repeatable until release. Returns the field with its new valuations. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED once the event is released: its tiers and prices are locked. 422 PRICING_CONFIG_INVALID when the floor share is above the top share or the rounding unit is above the worst golfer\'s price (salaryCap × floorSharePercent / 100), which could round prices to $0.',
      operationId: 'autoAssignEventPrices',
      params: EVENT_PARAMS,
      body: schemaRef('AutoAssignSportEventPricesRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.autoAssignEventPrices,
  });

  // --- Golf score corrections: the operations that write golf extension rows ---------------

  fastify.post('/:eventId/rounds/:roundNumber/golf-scores/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview a round of golf scores',
      description: 'Resolves each row against the event\'s field and reports what it would change. Writes nothing. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by golf rounds (its scoring family is not stroke play). Root admin only.',
      operationId: 'previewEventGolfRoundScores',
      params: ROUND_PARAMS,
      body: schemaRef('GolfRoundScoreUploadRequest'),
      response: { 200: schemaRef('GolfRoundScorePreviewResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.previewGolfRoundScores,
  });

  fastify.post('/:eventId/rounds/:roundNumber/golf-scores', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply a round of golf scores',
      description: 'All or none; 422 ROUND_SCORE_ROWS_UNRESOLVED when any row does not resolve. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by golf rounds (its scoring family is not stroke play). Refreshes standings. Returns the field. Root admin only.',
      operationId: 'applyEventGolfRoundScores',
      params: ROUND_PARAMS,
      body: schemaRef('GolfRoundScoreUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.applyGolfRoundScores,
  });

  fastify.patch('/:eventId/rounds/:roundNumber/golf-scores/:sportEventParticipantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Correct one golfer\'s round',
      description: 'Stores each value exactly as sent and derives none from another; omitted values keep what is stored. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. 422 ROUND_VALUES_REQUIRED when the golfer has no stored round and the body omits strokes or scoreToPar; the server fills in neither. 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by golf rounds (its scoring family is not stroke play). Refreshes standings. Root admin only.',
      operationId: 'updateEventParticipantGolfRoundScore',
      params: {
        type: 'object',
        required: ['eventId', 'roundNumber', 'sportEventParticipantId'],
        properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, sportEventParticipantId: uuid },
      },
      body: schemaRef('UpdateGolfRoundScoreRequest'),
      response: { 200: schemaRef('SportEventParticipantResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.updateGolfRoundScore,
  });

  // --- Race results: the finishing order, which writes finish-position extension rows (#622) ---

  fastify.post('/:eventId/race-results/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview a race result',
      description: 'Resolves each row against the event\'s field and reports what applying it would change, with each row\'s error and the order\'s as a whole. Writes nothing. '
        + '422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by finishing place (its scoring family is not finish position). Root admin only.',
      operationId: 'previewEventRaceResults',
      params: EVENT_PARAMS,
      body: schemaRef('RaceResultUploadRequest'),
      response: { 200: schemaRef('RaceResultPreviewResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.previewRaceResults,
  });

  fastify.put('/:eventId/race-results', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply a race result',
      description: 'Stores each runner\'s result exactly as sent, all or none; runners not named keep theirs. The official flag is set on every result of the race. '
        + 'Writes each runner\'s standing: its place (a dead heat sharing one, shown "T2"), COMPLETE once it started, WITHDRAWN when it did not start. '
        + '422 RACE_RESULT_ROWS_INVALID when a row does not resolve to one runner or carries a row error; 422 RACE_RESULT_POSITIONS_INVALID when the places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next); '
        + '422 RACE_RESULT_FIELD_INCOMPLETE when an official result leaves an active runner without a result or a finisher without a place; 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by finishing place. '
        + 'Returns the field. Root admin only.',
      operationId: 'applyEventRaceResults',
      params: EVENT_PARAMS,
      body: schemaRef('RaceResultUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.applyRaceResults,
  });

  // --- Bracket: an event's matches, for a sport that plays a bracket (#698) ---------------

  const BRACKET_NOT_A_BRACKET = 'SPORT_EVENT_NOT_BRACKET when the event\'s sport is not played as a bracket.';

  fastify.get('/:eventId/bracket', {
    schema: {
      tags: TAGS,
      summary: 'Get a sport event\'s bracket',
      description: 'Every match of the event in match-number order, empty until the bracket is loaded. Any signed-in user may read a released event\'s bracket; a DRAFT event\'s is a root admin\'s only. '
        + `422 ${BRACKET_NOT_A_BRACKET}`,
      operationId: 'getEventBracket',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(401, 404, 422) },
    },
    handler: handler.getEventBracket,
  });

  fastify.put('/:eventId/bracket', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Load a sport event\'s bracket',
      description: 'Replaces every match of the event with the matches sent, all or none. A side may be left empty while its team is not known; release needs the bracket complete. '
        + '409 SPORT_EVENT_BRACKET_LOCKED once the event is released. 422 BRACKET_INVALID, naming every problem, when a match number repeats, a round is not the event\'s, a side names a field row the event lacks or one already named, '
        + 'a winner advances to a match that is missing or not in a later round or to a side that names a team or that another match fills, or there is not exactly one final in the last round. '
        + `422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'loadEventBracket',
      params: EVENT_PARAMS,
      body: schemaRef('LoadSportEventBracketRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.loadEventBracket,
  });

  fastify.patch('/:eventId/bracket/matches/:matchNumber', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Edit one match of a sport event\'s bracket',
      description: 'Values left out keep what is stored. The time and site can change at any point; the sides only until release (409 SPORT_EVENT_BRACKET_LOCKED). '
        + 'The home spread can change until release, and after it only while no entry has picked the game (409 MATCH_SPREAD_LOCKED), and never cleared (422 MATCH_SPREAD_REQUIRED). '
        + '422 BRACKET_INVALID when a side would name a field row the event lacks or one another match names, a side an earlier match\'s winner fills, or both sides one team. '
        + `404 BRACKET_MATCH_NOT_FOUND for a match number the bracket lacks. 422 ${BRACKET_NOT_A_BRACKET} Root admin only.`,
      operationId: 'updateEventBracketMatch',
      params: {
        type: 'object',
        required: ['eventId', 'matchNumber'],
        properties: { eventId: uuid, matchNumber: { type: 'integer', minimum: 1 } },
      },
      body: schemaRef('UpdateSportEventMatchRequest'),
      response: { 200: schemaRef('SportEventMatchResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.updateEventBracketMatch,
  });

  const MATCH_PARAMS = {
    type: 'object',
    required: ['eventId', 'matchNumber'],
    properties: { eventId: uuid, matchNumber: { type: 'integer', minimum: 1 } },
  } as const;
  const MATCH_RESULT_LOCKED = '409 SPORT_EVENT_MATCH_RESULT_LOCKED once the match its winner advanced to has a result: clear that result first.';

  fastify.put('/:eventId/bracket/matches/:matchNumber/result', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Enter a match\'s result',
      description: 'Completes the match with its winner and scores, puts the winner on the side of the match it advances to, and rewrites every team\'s event standing from the bracket (the champion 1, a team that lost ELIMINATED). A week of games that forms no bracket ranks no team: a team is COMPLETE once its game is played or cancelled. '
        + 'Re-sending a match\'s result changes it. 409 SPORT_EVENT_NOT_RELEASED for a draft. 404 BRACKET_MATCH_NOT_FOUND. 422 MATCH_SIDES_NOT_SET while a side waits for an earlier winner. '
        + '422 MATCH_RESULT_INVALID for one score without the other, or a winner without the higher score. '
        + `${MATCH_RESULT_LOCKED} 422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'recordEventMatchResult',
      params: MATCH_PARAMS,
      body: schemaRef('RecordSportEventMatchResultRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.recordEventMatchResult,
  });

  fastify.delete('/:eventId/bracket/matches/:matchNumber/result', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Clear a match\'s result',
      description: 'The match is scheduled again, the side its winner filled is emptied and the standings are rewritten. Clearing a match with no result changes nothing. '
        + `409 SPORT_EVENT_NOT_RELEASED for a draft. 404 BRACKET_MATCH_NOT_FOUND. ${MATCH_RESULT_LOCKED} 422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'clearEventMatchResult',
      params: MATCH_PARAMS,
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.clearEventMatchResult,
  });

  fastify.post('/:eventId/bracket/matches/:matchNumber/cancel', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Cancel a game',
      description: 'Calls off an unplayed game of a released week whose games form no bracket, such as a postponed NFL game: it counts for nothing in any contest, and is added to the week it moves to while that week is a draft. '
        + 'Cancelling a cancelled game changes nothing. 409 SPORT_EVENT_NOT_RELEASED for a draft, whose games are edited freely. 404 BRACKET_MATCH_NOT_FOUND. '
        + '409 MATCH_ALREADY_PLAYED for a game with a result (clear it first). 422 MATCH_IN_BRACKET for a game of a bracket, which cannot lose one. Returns the games. Root admin only.',
      operationId: 'cancelEventMatch',
      params: MATCH_PARAMS,
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.cancelEventMatch,
  });

  const ROUND_REFUSALS = '422 BRACKET_NOT_RESEEDED when the event\'s league does not reseed or the round is not one placed by seed. 409 SPORT_EVENT_NOT_RELEASED for a draft. '
    + '409 BRACKET_ROUND_NOT_FINISHED while a match of the round before has no result; 409 BRACKET_ROUND_ALREADY_PLAYED once a match of the round has started.';

  fastify.get('/:eventId/bracket/rounds/:roundNumber/reseed', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Propose a reseeded round\'s matchups',
      description: 'For a league that reseeds (the NFL after Wild Card weekend): in each region the best seed left hosts the worst and the second best the second worst; a bye or a linked winner keeps its place. Saves nothing. '
        + `${ROUND_REFUSALS} 422 BRACKET_INVALID when the teams left do not fit the round. 422 ${BRACKET_NOT_A_BRACKET} Root admin only.`,
      operationId: 'proposeEventRoundMatchups',
      params: ROUND_PARAMS,
      response: { 200: schemaRef('SportEventRoundMatchupsResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.proposeEventRoundMatchups,
  });

  fastify.put('/:eventId/bracket/rounds/:roundNumber/matchups', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Set a reseeded round\'s matchups',
      description: 'Places both sides of every match of the round, all or none; it can be set again until the round starts. '
        + `${ROUND_REFUSALS} 422 BRACKET_INVALID, naming every problem, when a match is left out or set twice, a team is not one left in the round or plays twice, a team leaves its region, or a bye or linked winner is moved. `
        + `422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'setEventRoundMatchups',
      params: ROUND_PARAMS,
      body: schemaRef('SetSportEventRoundMatchupsRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.setEventRoundMatchups,
  });

  fastify.put('/:eventId/participants/:sportEventParticipantId/play-in-winner', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Set the winner of a play-in place',
      description: 'For a field row that stands for a play-in pairing ("Texas / Xavier"): the row then names the team that won, keeping its seed, tier, price and every pick of it, and the pairing\'s participant is inactivated. '
        + '404 EVENT_PARTICIPANT_NOT_FOUND for a row not on the event; 404 PARTICIPANT_NOT_FOUND when the winner is not an active participant of the event\'s sport; '
        + '409 EVENT_PARTICIPANT_ALREADY_ON_FIELD when the winner already has a field row; 409 PLAY_IN_SLOT_ALREADY_PLAYED once the place has started or played a bracket match. '
        + `422 ${BRACKET_NOT_A_BRACKET} Returns the field row. Root admin only.`,
      operationId: 'setEventPlayInWinner',
      params: {
        type: 'object',
        required: ['eventId', 'sportEventParticipantId'],
        properties: { eventId: uuid, sportEventParticipantId: uuid },
      },
      body: schemaRef('FillPlayInSlotRequest'),
      response: { 200: schemaRef('SportEventParticipantResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.setEventPlayInWinner,
  });
}
