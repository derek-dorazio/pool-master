/**
 * The SportEvent operation set and its children's — rounds, the field
 * (SportEventParticipant), tiers and valuations, and the golf score corrections (#236).
 *
 * Before #236 everything here past `listEvents` was a golf-named admin operation under
 * /admin/sports/golf, and the event browser's participant list was a third projection of
 * the field. Each now acts on the object it names. Reads need a signed-in user; every
 * write needs the root-admin claim (access rule A10). Admin-only fields on the DTOs are
 * annotated, not stripped (plans/145 rule 4).
 */
import type { FastifyInstance } from 'fastify';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import { schemaRef } from '@poolmaster/shared/dto/schema-registry';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
// Registers the named components this module's routes $ref (#192). ingestion.dto holds the
// provider sync submission the field refresh returns.
import '@poolmaster/shared/dto/ingestion.dto';
import '@poolmaster/shared/dto/events.dto';
import '@poolmaster/shared/dto/golf-scores.dto';
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
  const envelope = zodToJsonSchema(ErrorEnvelopeSchema);
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
  const handler = createEventHandlers({
    services: createSportEventServices(prisma, fastify.log.child({ module: 'events.service' })),
    eventLifecycle: opts.eventLifecycleService ?? createEventLifecycleService(prisma, { logger: fastify.log }),
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
        + 'size, contest-setup readiness, and its tier and contest counts.',
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
        + 'The sport comes from the sport league; only golf is supported so far (422 SPORT_NOT_SUPPORTED otherwise). Root admin only.',
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
      description: '409 EVENT_NOT_ADMIN_MANAGED for an event a provider owns in full. Root admin only.',
      operationId: 'updateEvent',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409) },
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

  fastify.post('/:eventId/transition', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Move a sport event to its next status',
      description: 'Only to one of the event\'s allowedTransitions. Activates or settles its contests as the new status requires. Root admin only.',
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
      description: 'Root admin only.',
      operationId: 'linkEventScoreSource',
      params: EVENT_PARAMS,
      body: schemaRef('LinkSportEventScoreSourceRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409) },
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
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409) },
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
      description: 'Patches field rows and their manual prices, all or none. Root admin only.',
      operationId: 'updateEventParticipants',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventParticipantsRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404) },
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
        + 'A later field refresh from the provider replaces these values as it does grid edits. Returns the field. Root admin only.',
      operationId: 'applyEventParticipantUpload',
      params: EVENT_PARAMS,
      body: schemaRef('SportEventParticipantUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 422) },
    },
    handler: handler.applyEventParticipantUpload,
  });

  fastify.delete('/:eventId/participants/:sportEventParticipantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Remove a participant from a sport event\'s field',
      description: '409 EVENT_PARTICIPANT_HAS_PICKS once a contest entry has picked it — withdraw it instead. Root admin only.',
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
      description: 'Returns the field with its new valuations. Root admin only.',
      operationId: 'autoAssignEventTiers',
      params: EVENT_PARAMS,
      body: schemaRef('AutoAssignSportEventTiersRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.autoAssignEventTiers,
  });

  fastify.put('/:eventId/tiers/assignments', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Replace a sport event\'s tier assignments',
      description: 'The drag-and-drop save, all or none. Returns the field with its new valuations. Root admin only.',
      operationId: 'replaceEventTierAssignments',
      params: EVENT_PARAMS,
      body: schemaRef('ReplaceSportEventTierAssignmentsRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.replaceEventTierAssignments,
  });

  fastify.post('/:eventId/prices/auto-assign', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Price a sport event\'s seeded field',
      description: 'Returns the field with its new valuations. Root admin only.',
      operationId: 'autoAssignEventPrices',
      params: EVENT_PARAMS,
      body: schemaRef('AutoAssignSportEventPricesRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.autoAssignEventPrices,
  });

  // --- Golf score corrections: the operations that write golf extension rows ---------------

  fastify.post('/:eventId/rounds/:roundNumber/golf-scores/preview', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Preview a round of golf scores',
      description: 'Resolves each row against the event\'s field and reports what it would change. Writes nothing. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. Root admin only.',
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
      description: 'All or none; 422 ROUND_SCORE_ROWS_UNRESOLVED when any row does not resolve. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. Refreshes standings. Returns the field. Root admin only.',
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
      description: 'Stores each value exactly as sent and derives none from another; omitted values keep what is stored. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. Refreshes standings. Root admin only.',
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
}
