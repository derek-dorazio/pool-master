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
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import type { ApiErrorCode } from '@poolmaster/shared/dto/api-error-codes';
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
import '@poolmaster/shared/dto/sport-catalog.dto';
import { schemaComponentsPlugin } from '../../plugins/schema-components';
import { getAppPrisma } from '../../core/prisma-context';
import { requireRootAdmin } from '../../core/root-admin-guard';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import type { IngestionService } from '../ingestion/ingestion-service';
import type { EventLifecycleService } from './event-lifecycle-service';
import { createEventHandlers } from './handler';
import { PrismaSportLeaguePageReader } from '../../adapters/prisma-sport-league-page-reader';
import { SportLeaguePageService } from '../sport-catalog/sport-league-page';
import type { DomainEvents } from '../domain-events';
import { createSportEventServices, eventFieldCache, type SportEventServices } from './wiring';
import type { LeaderboardRebuilds } from '../contests/leaderboard-snapshots';
import type { CdnInvalidator } from '../../core/cdn-invalidator';
import { PublicReadPath } from '../../core/public-cache';
import type { SlotTiebreakerService } from './slot-tiebreaker-service';

export interface EventsModuleOptions {
  /** The app's one status-change path, with its follow-ups (#1946). */
  eventLifecycleService: EventLifecycleService;
  ingestionService: IngestionService;
  providerRegistry?: ProviderRegistry;
  cdn: CdnInvalidator;
  /** What follows each admin results, field or game write (#1946): the app's one map. */
  domainEvents: Pick<DomainEvents, 'collect'>;
  /** What the rebuild route asks for (#1466). */
  leaderboards: Pick<LeaderboardRebuilds, 'eventsChanged'>;
  /**
   * The app's one set of event services, shared with the synced event creation sweep so both
   * write through the same instances; omitted, the module builds its own.
   */
  services?: SportEventServices;
  /** The Event page's sync rows (#1889): which providers' webhooks drive their live scores. */
  /** The providers whose webhooks are on now. */
  webhookProviderIds: () => readonly string[];
  /** Each slot's tiebreaker game (#2048), built once with the app's findings and domain events. */
  slotTiebreakers: Pick<SlotTiebreakerService, 'listSlotTiebreakers' | 'chooseTiebreakerGame'>;
}

const TAGS = ['Events'];
/** The kept admin result writes refuse a real event (#2074, ADR 0013): results come only from the feed. */
const TEST_EVENT_ONLY = 'Test events only (#2074): an event that covers no test slot takes its results from the feed alone, 409 SPORT_EVENT_NOT_TEST_DATA.';

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

/**
 * Reads one address may make a minute on each root-admin-only event read (#1889). The Event page
 * makes a handful; a script hammering a route does not stay inside it. Per process, as the other
 * per-address limits.
 */
export const EVENT_ADMIN_READS_PER_MINUTE = 120;
const ADMIN_READ_LIMIT = { rateLimit: { max: EVENT_ADMIN_READS_PER_MINUTE, timeWindow: 60_000 } };

/** An address over its reads for the minute on a root-admin-only event read. */
export class EventAdminRateLimitError extends Error {
  readonly statusCode = 429;
  readonly code: ApiErrorCode = 'EVENT_ADMIN_RATE_LIMITED';

  constructor() {
    super('Too many event reads from this address; try again in a minute.');
    this.name = 'EventAdminRateLimitError';
  }
}

export async function eventsModule(fastify: FastifyInstance, opts: EventsModuleOptions): Promise<void> {
  void fastify.register(schemaComponentsPlugin);
  // Only the routes that ask for a limit get one (`config.rateLimit`); keyed by `request.ip`.
  // Awaited, so its route hook is in place before the routes below are declared.
  await fastify.register(rateLimit, { global: false, errorResponseBuilder: () => new EventAdminRateLimitError() });

  const prisma = getAppPrisma(fastify);
  const eventLifecycle = opts.eventLifecycleService;
  const handler = createEventHandlers({
    services: opts.services ?? createSportEventServices(prisma, fastify.log.child({ module: 'events.service' }), eventLifecycle, opts.domainEvents),
    eventLifecycle,
    ingestion: opts.ingestionService,
    leaderboards: opts.leaderboards,
    eventOverviews: new SportLeaguePageService({
      reader: new PrismaSportLeaguePageReader(prisma),
        webhookProviderIds: opts.webhookProviderIds,
    }),
    slotTiebreakers: opts.slotTiebreakers,
  });
  const write = { onRequest: requireRootAdmin };

  // A write to an event forgets the field this container last read of it (#1163) before the
  // write answers, so the admin's next read, and every contest's on the event, is current.
  // A write that lands can change which edition an event page offers, and whether it opens now
  // (#1181), so the public event pages are cleared at the CDN too. The leaderboard rebuild is not
  // here: each write that changes a board writes its rebuild job with it (#1466).
  fastify.addHook('onSend', async (request, reply, payload) => {
    if (request.method === 'GET' || request.method === 'HEAD') return payload;
    const { eventId } = request.params as { eventId?: string };
    if (eventId !== undefined) eventFieldCache.forget(eventId);
    if (reply.statusCode < 400) {
      opts.cdn.invalidate([PublicReadPath.EVENT_PAGES]);
    }
    return payload;
  });

  // --- SportEvent --------------------------------------------------------------------

  fastify.get('/', {
    schema: {
      tags: TAGS,
      summary: 'List sport events',
      description:
        'The sport-event catalog, narrowed by sport, statuses, sport league, Season and name and never paged. At least one of `sport`, `sportLeagueId` and `sportLeagueSeasonId` is required, so the list never reads every event: 400 SPORT_EVENT_FILTER_REQUIRED otherwise. A root admin browses the whole catalog. Any other signed-in user, for contest setup, may list only events in the statuses that can still take a contest (SCHEDULED, POSTPONED, IN_PROGRESS) or one Season\'s (`sportLeagueSeasonId`): 403 ROOT_ADMIN_ACCESS_REQUIRED otherwise (#1348). '
        + 'Each event carries its loaded field '
        + 'size, contest-setup readiness and tier count; a root admin\'s list also carries each event\'s adminCounts. '
        + 'DRAFT events (not yet released for contests) are listed for a root admin only.',
      operationId: 'listEvents',
      querystring: schemaRef('SportEventListQuery'),
      response: { 200: schemaRef('SportEventListResponse'), ...errors(400, 401, 403) },
    },
    handler: handler.listEvents,
  });

  fastify.get('/:eventId', {
    schema: {
      tags: TAGS,
      summary: 'Get a sport event',
      description: '404 EVENT_NOT_FOUND for a DRAFT event unless the caller is a root admin, whose read alone carries adminCounts.',
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
      summary: 'Create a test event on a test slot',
      description:
        'A test event (QA only, #2004), DRAFT, on a free test slot of its league\'s current Season: the sync makes every other event. '
        + 'Its league, Season and dates are the slot\'s, with its league\'s default rounds and tiers. '
        + '404 SEASON_SLOT_NOT_FOUND; 422 SEASON_SLOT_NOT_TEST for a slot the sync keeps, SEASON_SLOT_NOT_CURRENT outside the current Season; 409 SEASON_SLOT_TAKEN when it has an event. '
        + 'Root admin only.',
      operationId: 'createEvent',
      body: schemaRef('CreateSportEventRequest'),
      response: { 201: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.createEvent,
  });

  fastify.patch('/:eventId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport event',
      description: 'Edits any event, linked to a provider or not; a provider never overwrites these fields. A new startDate moves every round by the same amount; a higher rounds count adds rounds, each a day after the one before. '
        + '400 SPORT_EVENT_START_NOT_PLACEHOLDER when tellMembers is false and the start being moved is not the noon-UTC date-only placeholder. '
        + '422 EVENT_DATES_FROM_SLOTS when startDate or endDate is sent for an event with Season slots, whose dates are its slots\'. Root admin only.',
      operationId: 'updateEvent',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(400, 401, 403, 404, 422) },
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
        422: { ...schemaRef('ErrorEnvelope'), description: 'SPORT_EVENT_NOT_READY: the field is not loaded, an active participant has no tier, a tier has no active participant, prices are not assigned or miss an active participant, or a bracket event\'s bracket is incomplete. The rounds, provider-link and contest-setup ready checks hold only the automatic release (#1823).' },
      },
    },
    handler: handler.releaseEvent,
  });

  fastify.post('/:eventId/transition', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Move a sport event to its next status',
      description: 'Only to one of the event\'s allowedTransitions. Starting it activates its contests in the request; finishing or cancelling it queues a background job that settles them, so they reach COMPLETED shortly after this answers. '
        + 'A DRAFT event is refused SCHEDULED with 409 SPORT_EVENT_RELEASE_REQUIRED: releasing it is its own action (releaseEvent). '
        + '409 SPORT_EVENT_INVALID_TRANSITION when the event\'s status changed elsewhere while this request ran (the lifecycle scheduler, another admin) and it did not end in the status asked for. Root admin only.',
      operationId: 'transitionEvent',
      params: EVENT_PARAMS,
      body: schemaRef('TransitionSportEventRequest'),
      response: { 200: schemaRef('SportEventResponse'), ...errors(401, 403, 404, 409) },
    },
    handler: handler.transitionEvent,
  });

  // --- Rounds --------------------------------------------------------------------------

  fastify.get('/:eventId/rounds', {
    schema: {
      tags: TAGS,
      summary: 'List a sport event\'s rounds',
      description: 'Every round by number, each with where it stands (status, result count, completion time) read off the results recorded in it, in a fixed number of reads.',
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

  // --- The contests on the event (#1889) ---------------------------------------------

  fastify.get('/:eventId/contests', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'List the contests on a sport event',
      description: 'Every customer contest run on the event, across every league, newest first and never paged, with its league, contest template, status and entry count. The root admin\'s Event page reads it; one read however many contests. Root admin only: 403 ROOT_ADMIN_ACCESS_REQUIRED otherwise. 404 EVENT_NOT_FOUND for an unknown event. '
        + `More than ${EVENT_ADMIN_READS_PER_MINUTE} reads a minute from one address answer 429 EVENT_ADMIN_RATE_LIMITED.`,
      operationId: 'listEventContests',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventContestListResponse'), ...errors(401, 403, 404, 429) },
    },
    config: ADMIN_READ_LIMIT,
    handler: handler.listEventContests,
  });

  fastify.get('/:eventId/overview', {
    onRequest: requireRootAdmin,
    schema: {
      tags: TAGS,
      summary: 'Get an event\'s syncs, health, issues, release and tier order',
      description: 'The root admin\'s Event page header and sync rows (#1889), by the League page\'s rules applied to one event: its field and scores syncs from its own latest runs, '
        + 'its sync health, its issues (SYNC, RELEASE, OVERDUE), its release mode and date, the value its active field is ordered by for tiers and prices, '
        + 'and each field row\'s feed id and when a sync last saw it. A fixed number of reads however large the field. Root admin only: 403 ROOT_ADMIN_ACCESS_REQUIRED otherwise. '
        + `404 EVENT_NOT_FOUND for an unknown event. More than ${EVENT_ADMIN_READS_PER_MINUTE} reads a minute from one address answer 429 EVENT_ADMIN_RATE_LIMITED.`,
      operationId: 'getEventOverview',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventOverviewResponse'), ...errors(401, 403, 404, 429) },
    },
    config: ADMIN_READ_LIMIT,
    handler: handler.getEventOverview,
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
      description: 'Any participants; ones already on the field are skipped. 422 TEST_PARTICIPANT_NOT_ON_TEST_SLOT for a test participant on an event the sync keeps: one joins only a test slot\'s event. Root admin only.',
      operationId: 'addEventParticipants',
      params: EVENT_PARAMS,
      body: schemaRef('AddSportEventParticipantsRequest'),
      response: { 200: schemaRef('AddSportEventParticipantsResponse'), ...errors(401, 403, 404, 422) },
    },
    handler: handler.addEventParticipants,
  });

  fastify.patch('/:eventId/participants', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Update a sport event\'s field',
      description: 'Patches field rows, their manual prices and their moves into another tier, all or none. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED when a released event\'s price or tier would change: its tiers and prices are locked. '
        + '409 SPORT_EVENT_SEEDS_LOCKED when a released bracket event\'s seed would change: the upset bonus reads the seeds as they stood at release. '
        + '422 UNKNOWN_TIER_KEY for a tierKey the event has no tier for; 422 SPORT_EVENT_NOT_BRACKET for a play-in place on an event that plays no bracket.',
      operationId: 'updateEventParticipants',
      params: EVENT_PARAMS,
      body: schemaRef('UpdateSportEventParticipantsRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.updateEventParticipants,
  });

  fastify.post('/:eventId/leaderboards/rebuild', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Settle an event\'s contests again',
      description: 'Queues a rebuild of every leaderboard on the event\'s contests from the results stored now, and returns at once; '
        + 'the job shows in Activity. Changes no result. For a rebuild that failed or never ran, or after a scoring fix. Root admin only.',
      operationId: 'rebuildEventLeaderboards',
      params: EVENT_PARAMS,
      response: { ...NO_CONTENT, ...errors(401, 403, 404) },
    },
    handler: handler.rebuildEventLeaderboards,
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
        + 'with no fallback — and reports what applying it would change to ranking, seedNumber and status (odds come only from the feed). '
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
      description: 'The event\'s optional override of the tiers it copied from its sport league\'s tier profile. While no tier was placed by hand, the field is placed in the new tiers at once, as auto-assign does. Once one was (MANUAL), places are kept and '
        + '409 TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS answers a removal that would strand participants with no reassignOrphansTo. 409 SPORT_EVENT_TIERS_LOCKED once released. Root admin only.',
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
      description: 'Returns the field with its new valuations. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED once the event is released: its tiers and prices are locked. 409 FIELD_HAS_NO_ORDER when no active participant has a value for any source the league\'s tier profile lists: a field is never ordered by name. 422 TIER_SIZE_NOT_FOR_RANGES when a tier size is sent for a league whose tier profile is RANGES.',
      operationId: 'autoAssignEventTiers',
      params: EVENT_PARAMS,
      body: schemaRef('AutoAssignSportEventTiersRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(401, 403, 404, 409, 422) },
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
      description: 'Prices the active field on the budget curve with the values sent, in the order of the league\'s pricing profile\'s sources, and stores the values as the event\'s pricing. Repeatable until release. Returns the field with its new valuations. Root admin only. 409 SPORT_EVENT_TIERS_LOCKED once the event is released: its tiers and prices are locked. 422 PRICING_CONFIG_INVALID when the floor share is above the top share or the rounding unit is above the worst golfer\'s price (salaryCap × floorSharePercent / 100), which could round prices to $0. 409 FIELD_HAS_NO_ORDER when no active participant has a value for any source the league\'s pricing profile lists: a field is never ordered by name.',
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
      description: `${TEST_EVENT_ONLY} ` + 'All or none; 422 ROUND_SCORE_ROWS_UNRESOLVED when any row does not resolve. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by golf rounds (its scoring family is not stroke play). Refreshes standings. Returns the field. Root admin only.',
      operationId: 'applyEventGolfRoundScores',
      params: ROUND_PARAMS,
      body: schemaRef('GolfRoundScoreUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.applyGolfRoundScores,
  });

  fastify.patch('/:eventId/rounds/:roundNumber/golf-scores/:sportEventParticipantId', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Correct one golfer\'s round',
      description: `${TEST_EVENT_ONLY} ` + 'Stores each value exactly as sent and derives none from another; omitted values keep what is stored. 422 ROUND_BEYOND_SCHEDULE when the round is beyond the event\'s scheduled rounds. 422 ROUND_VALUES_REQUIRED when the golfer has no stored round and the body omits strokes or scoreToPar; the server fills in neither. 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by golf rounds (its scoring family is not stroke play). Refreshes standings. Root admin only.',
      operationId: 'updateEventParticipantGolfRoundScore',
      params: {
        type: 'object',
        required: ['eventId', 'roundNumber', 'sportEventParticipantId'],
        properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, sportEventParticipantId: uuid },
      },
      body: schemaRef('UpdateGolfRoundScoreRequest'),
      response: { 200: schemaRef('SportEventParticipantResponse'), ...errors(400, 401, 403, 404, 409, 422) },
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
      description: `${TEST_EVENT_ONLY} ` + 'Stores each runner\'s result exactly as sent, all or none; runners not named keep theirs. The official flag is set on every result of the race. '
        + 'Writes each runner\'s standing: its place (a dead heat sharing one, shown "T2"), COMPLETE once it started, WITHDRAWN when it did not start. '
        + '422 RACE_RESULT_ROWS_INVALID when a row does not resolve to one runner or carries a row error; 422 RACE_RESULT_POSITIONS_INVALID when the places do not run 1, 2, 3 ... (a dead heat repeats a place and skips the next); '
        + '422 RACE_RESULT_FIELD_INCOMPLETE when an official result leaves an active runner without a result or a finisher without a place; 422 EVENT_SCORING_FAMILY_MISMATCH when the event\'s sport is not scored by finishing place. '
        + 'Returns the field. Root admin only.',
      operationId: 'applyEventRaceResults',
      params: EVENT_PARAMS,
      body: schemaRef('RaceResultUploadRequest'),
      response: { 200: schemaRef('SportEventParticipantListResponse'), ...errors(400, 401, 403, 404, 409, 422) },
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
      description: `${TEST_EVENT_ONLY} ` + 'Replaces every match of the event with the matches sent, all or none. A side may be left empty while its team is not known; release needs the bracket complete. '
        + '409 SPORT_EVENT_BRACKET_LOCKED once the event is released. 422 BRACKET_INVALID, naming every problem, when a match number repeats within a round, a round is not the event\'s, a side names a field row the event lacks or one already named, '
        + 'a winner advances to a match that is missing or not in a later round or to a side that names a team or that another match fills, or there is not exactly one final in the last round. '
        + `422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'loadEventBracket',
      params: EVENT_PARAMS,
      body: schemaRef('LoadSportEventBracketRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.loadEventBracket,
  });

  fastify.get('/:eventId/slots/tiebreakers', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'List a sport event\'s slot tiebreaker games',
      description: 'Each slot the event covers, with its tiebreaker game (#2048): the one Game whose combined score every contest covering the slot guesses, '
        + 'chosen by the rule (the latest scheduled start, ties to the lower Game id) or by a root admin, and every Game played in the slot with whether it can be chosen now. '
        + 'A fixed number of reads however many slots and Games. 404 EVENT_NOT_FOUND. Root admin only.',
      operationId: 'listEventSlotTiebreakers',
      params: EVENT_PARAMS,
      response: { 200: schemaRef('SportEventSlotTiebreakersResponse'), ...errors(401, 403, 404) },
    },
    handler: handler.listEventSlotTiebreakers,
  });

  fastify.put('/:eventId/slots/:seasonSlotId/tiebreaker-game', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Choose a slot\'s tiebreaker game',
      description: 'A root admin chooses which of the slot\'s Games every contest covering it guesses the combined score of (#2048), on a synced or a test event alike. '
        + 'The choice and who made it are kept and logged, and the rule leaves it alone until it starts; a cancelled or moved game is replaced by the rule\'s choice with a finding. '
        + 'Choosing the game already chosen records the choice. 404 EVENT_NOT_FOUND, and SEASON_SLOT_NOT_FOUND for a slot the event does not cover. '
        + '422 TIEBREAKER_GAME_NOT_IN_SLOT for a Game played elsewhere, TIEBREAKER_GAME_NOT_ELIGIBLE for one cancelled, moved or with no start. '
        + '409 TIEBREAKER_GAME_STARTED once the slot\'s game, or the one asked for, has started. Root admin only.',
      operationId: 'chooseEventSlotTiebreakerGame',
      params: {
        type: 'object',
        required: ['eventId', 'seasonSlotId'],
        properties: { eventId: uuid, seasonSlotId: uuid },
      },
      body: schemaRef('ChooseSlotTiebreakerGameRequest'),
      response: { 200: schemaRef('SportEventSlotTiebreakerResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.chooseEventSlotTiebreakerGame,
  });

  fastify.patch('/:eventId/bracket/rounds/:roundNumber/matches/:matchNumber', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Edit one match of a sport event\'s bracket',
      description: `${TEST_EVENT_ONLY} ` + 'Values left out keep what is stored. The time and site can change at any point; the sides only until release (409 SPORT_EVENT_BRACKET_LOCKED). '
        + 'The home spread can change until release, and after it only while no entry has picked the game (409 MATCH_SPREAD_LOCKED), and never cleared (422 MATCH_SPREAD_REQUIRED). '
        + '422 BRACKET_INVALID when a side would name a field row the event lacks or one another match names, a side an earlier match\'s winner fills, or both sides one team. '
        + `404 BRACKET_MATCH_NOT_FOUND for a round and match number the bracket lacks. 422 ${BRACKET_NOT_A_BRACKET} Root admin only.`,
      operationId: 'updateEventBracketMatch',
      params: {
        type: 'object',
        required: ['eventId', 'roundNumber', 'matchNumber'],
        properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, matchNumber: { type: 'integer', minimum: 1 } },
      },
      body: schemaRef('UpdateSportEventRoundMatchRequest'),
      response: { 200: schemaRef('SportEventRoundMatchResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.updateEventBracketMatch,
  });

  const MATCH_PARAMS = {
    type: 'object',
    required: ['eventId', 'roundNumber', 'matchNumber'],
    properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, matchNumber: { type: 'integer', minimum: 1 } },
  } as const;
  const MATCH_RESULT_LOCKED = '409 SPORT_EVENT_ROUND_MATCH_RESULT_LOCKED once the match its winner advanced to has a result or a period score.';

  fastify.put('/:eventId/bracket/rounds/:roundNumber/matches/:matchNumber/result', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Enter a match\'s result',
      description: `${TEST_EVENT_ONLY} ` + 'Completes the match with its winner and scores, puts the winner on the side of the match it advances to, and rewrites every team\'s event standing from the bracket (the champion 1, a team that lost ELIMINATED). A week of games that forms no bracket ranks no team: a team is COMPLETE once its game is played or cancelled. A game of such a week can end in a tie (#792): a null winnerSide with both scores level. '
        + 'Re-sending a match\'s result changes it. 409 SPORT_EVENT_NOT_RELEASED for a draft. 404 BRACKET_MATCH_NOT_FOUND. 422 MATCH_SIDES_NOT_SET while a side waits for an earlier winner. '
        + 'A bracket match level after extra time, in a sport settled by shoot-out, takes both shoot-out scores and the winner\'s is the higher; they are kept apart from the match score. '
        + 'A match that ended early says how (ending): after a RETIREMENT or DEFAULT the winner\'s score may be the lower, and a WALKOVER has no scores; its winner wins in full. '
        + '422 MATCH_RESULT_INVALID for one score without the other, a winner without the higher score in a match played to its end, a tie without level scores, a tie in a bracket match, shoot-out scores on a match that is not a level bracket match of such a sport, a tie or shoot-out that ended early, or a walkover with scores or period scores. '
        + `${MATCH_RESULT_LOCKED} 422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'recordEventMatchResult',
      params: MATCH_PARAMS,
      body: schemaRef('RecordSportEventRoundMatchResultRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.recordEventMatchResult,
  });

  const PERIOD_PARAMS = {
    type: 'object',
    required: ['eventId', 'roundNumber', 'matchNumber', 'periodNumber'],
    properties: { eventId: uuid, roundNumber: { type: 'integer', minimum: 1 }, matchNumber: { type: 'integer', minimum: 1 }, periodNumber: { type: 'integer', minimum: 1 } },
  } as const;
  const PERIOD_REFUSALS = '409 SPORT_EVENT_NOT_RELEASED for a draft. 404 BRACKET_MATCH_NOT_FOUND. 409 MATCH_CANCELLED for a cancelled game. '
    + '422 MATCH_PERIOD_INVALID when the event\'s sport keeps no score by period, or for the last period or past it, whose score is the final result.';

  fastify.put('/:eventId/bracket/rounds/:roundNumber/matches/:matchNumber/periods/:periodNumber', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Enter a game\'s score at the end of a period',
      description: `${TEST_EVENT_ONLY} ` + 'Both sides\' score at the end of one period before the last (the end of the first, second or third quarter in American football), as the scoreboard shows it. '
        + 'It can be entered while the game is played and corrected after it; re-sending it changes it. Squares pools read it. '
        + `${PERIOD_REFUSALS} 422 MATCH_SIDES_NOT_SET while a side waits for its team. 422 MATCH_PERIOD_SCORE_INVALID when a side's score is below its score at an earlier period's end, or above its score at a later one's or its final score, and for a game that was a walkover. `
        + `422 ${BRACKET_NOT_A_BRACKET} Returns the bracket. Root admin only.`,
      operationId: 'recordEventMatchPeriodScore',
      params: PERIOD_PARAMS,
      body: schemaRef('RecordSportEventMatchPeriodScoreRequest'),
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(400, 401, 403, 404, 409, 422) },
    },
    handler: handler.recordEventMatchPeriodScore,
  });

  fastify.post('/:eventId/bracket/rounds/:roundNumber/matches/:matchNumber/cancel', {
    ...write,
    schema: {
      tags: TAGS,
      summary: 'Cancel a game',
      description: `${TEST_EVENT_ONLY} ` + 'Calls off an unplayed game of a released week whose games form no bracket, such as a postponed NFL game: it counts for nothing in any contest, and is added to the week it moves to while that week is a draft. '
        + 'Cancelling a cancelled game changes nothing. 409 SPORT_EVENT_NOT_RELEASED for a draft, whose games are edited freely. 404 BRACKET_MATCH_NOT_FOUND. '
        + '409 MATCH_ALREADY_PLAYED for a game with a result. 422 MATCH_IN_BRACKET for a game of a bracket, which cannot lose one. Returns the games. Root admin only.',
      operationId: 'cancelEventMatch',
      params: MATCH_PARAMS,
      response: { 200: schemaRef('SportEventBracketResponse'), ...errors(401, 403, 404, 409, 422) },
    },
    handler: handler.cancelEventMatch,
  });

  const ROUND_REFUSALS = '422 BRACKET_NOT_RESEEDED when the event\'s league does not reseed or the round is not one placed by seed. 409 SPORT_EVENT_NOT_RELEASED for a draft. '
    + '409 BRACKET_ROUND_NOT_FINISHED while a match of the round before has no result; 409 BRACKET_ROUND_ALREADY_PLAYED once a match of the round has started or has a period score.';

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
      description: `${TEST_EVENT_ONLY} ` + 'Places both sides of every match of the round, all or none; it can be set again until the round starts. '
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
      description: `${TEST_EVENT_ONLY} ` + 'For a field row that stands for a play-in pairing ("Texas / Xavier"): the row then names the team that won, keeping its seed, tier, price and every pick of it, and the pairing\'s participant is inactivated. '
        + '404 EVENT_PARTICIPANT_NOT_FOUND for a row not on the event; 404 PARTICIPANT_NOT_FOUND when the winner is not an active participant of the event\'s sport; '
        + '409 PARTICIPANT_NOT_IN_SPORT_LEAGUE when the event\'s sport league has a roster and the winner is not on it; '
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
