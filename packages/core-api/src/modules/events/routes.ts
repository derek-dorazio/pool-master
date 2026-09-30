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
// Registers the named components this module's routes $ref (#192). admin.dto holds the
// provider sync submission the field refresh returns.
import '@poolmaster/shared/dto/admin.dto';
import '@poolmaster/shared/dto/events.dto';
import '@poolmaster/shared/dto/golf-scores.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import { ProviderService } from '../admin/provider-service';
import { EventLifecycleService } from './event-lifecycle-service';
import { EventScoreSourceService } from './event-score-source-service';
import { createEventHandlers } from './handler';
import { createSportEventServices } from './wiring';
import { PrismaSportEventRepository } from '../../adapters';

export interface EventsModuleOptions {
  eventLifecycleService?: EventLifecycleService;
  providerService?: ProviderService;
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

export function eventsModule(fastify: FastifyInstance, opts: EventsModuleOptions = {}): void {
  void fastify.register(schemaComponentsPlugin);

  const prisma = getAppPrisma(fastify);
  const handler = createEventHandlers({
    services: createSportEventServices(prisma, fastify.log.child({ module: 'events.service' })),
    eventLifecycle: opts.eventLifecycleService ?? new EventLifecycleService(prisma, new PrismaSportEventRepository(prisma), fastify.log),
    scoreSource: new EventScoreSourceService(prisma, opts.providerRegistry, fastify.log),
    providers: opts.providerService ?? new ProviderService(prisma, opts.providerRegistry, undefined, fastify.log),
  });
  const write = { onRequest: requireRootAdmin };

  // --- SportEvent --------------------------------------------------------------------

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List sport events',
      description:
        'The sport-event catalog, narrowed by sport, status, season and name and never paged. Any signed-in user may read it: '
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
        'An admin-authored event in a season, SCHEDULED, accepting no provider data, with its default rounds and tiers. '
        + 'The sport comes from the season\'s sport league; only golf is supported so far (422 SPORT_NOT_SUPPORTED otherwise). Root admin only.',
      operationId: 'createEvent',
      body: schemaRef('CreateSportEventRequest'),
      response: { 201: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.createEvent,
  });

  fastify.post('/from-provider-event', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Create a sport event from a provider event',
      description:
        'An event named and dated by a browsed provider event, linked to it for scores (SCORES_ONLY). The field is not loaded; '
        + 'refreshEventParticipants does that. 409 EXTERNAL_EVENT_ALREADY_LINKED when another event holds the identity. Root admin only.',
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
      description: 'Resolves each row against the event\'s field and reports what it would change. Writes nothing. Root admin only.',
      operationId: 'previewEventGolfRoundScores',
      params: ROUND_PARAMS,
      body: schemaRef('GolfRoundScoreUploadRequest'),
      response: { 200: schemaRef('GolfRoundScorePreviewResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.previewGolfRoundScores,
  });

  fastify.post('/:eventId/rounds/:roundNumber/golf-scores', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Apply a round of golf scores',
      description: 'All or none; 422 ROUND_SCORE_ROWS_UNRESOLVED when any row does not resolve. Refreshes standings. Returns the field. Root admin only.',
      operationId: 'applyEventGolfRoundScores',
      params: ROUND_PARAMS,
      body: schemaRef('GolfRoundScoreUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.applyGolfRoundScores,
  });

  fastify.patch('/:eventId/rounds/:roundNumber/golf-scores/:sportEventParticipantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Correct one golfer\'s round',
      description: 'Omitted values keep what is stored. Refreshes the golfer\'s standing. Root admin only.',
      operationId: 'updateEventParticipantGolfRoundScore',
      params: {
        type: 'object',
        required: ['eventId', 'roundNumber', 'sportEventParticipantId'],
        properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, sportEventParticipantId: uuid },
      },
      body: schemaRef('UpdateGolfRoundScoreRequest'),
      response: { 200: schemaRef('SportEventParticipantResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.updateGolfRoundScore,
  });
}
