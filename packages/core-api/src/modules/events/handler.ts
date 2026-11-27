import type { FastifyReply, FastifyRequest } from 'fastify';
import type { LeaderboardRebuilds } from '../contests/leaderboard-snapshots';
import type {
  AddSportEventParticipantsRequest,
  AddSportEventParticipantsResponse,
  AutoAssignSportEventPricesRequest,
  AutoAssignSportEventTiersRequest,
  CreateSportEventRequest,
  ReplaceSportEventTierAssignmentsRequest,
  ReplaceSportEventTiersRequest,
  SportEventListQuery,
  SportEventListResponse,
  SportEventParticipantListResponse,
  SportEventParticipantResponse,
  SportEventResponse,
  SportEventContestListResponse,
  SportEventRoundListResponse,
  SportEventTierListResponse,
  TransitionSportEventRequest,
  UpdateSportEventParticipantsRequest,
  UpdateSportEventRequest,
  UpdateSportEventRoundsRequest,
} from '@poolmaster/shared/dto/events.dto';
import type {
  GolfRoundScorePreviewResponse,
  GolfRoundScoreUploadRequest,
  UpdateGolfRoundScoreRequest,
} from '@poolmaster/shared/dto/golf-scores.dto';
import type {
  RaceResultPreviewResponse,
  RaceResultUploadRequest,
} from '@poolmaster/shared/dto/race-results.dto';
import type {
  LoadSportEventBracketRequest,
  RecordSportEventMatchPeriodScoreRequest,
  RecordSportEventRoundMatchResultRequest,
  SetSportEventRoundMatchupsRequest,
  SportEventBracketResponse,
  SportEventRoundMatchResponse,
  SportEventRoundMatchupsResponse,
  UpdateSportEventRoundMatchRequest,
} from '@poolmaster/shared/dto/bracket.dto';
import { eventFeedRef, ProviderSyncKind, matchPlaceOf, OFFERABLE_SPORT_EVENT_STATUSES, type MatchPlace } from '@poolmaster/shared/domain';
import { sendError } from '../../core/error-handler';
import {
  mapGolfRoundScorePreviewToDto,
  mapRaceResultPreviewToDto,
  mapSportEventRoundMatchToDto,
  mapSportEventParticipantToDto,
  mapSportEventContestsToResponse,
  mapSportEventRoundToDto,
  mapSportEventTierToDto,
  mapSportEventToDto,
  toProviderManualSyncSubmissionResponse,
} from '../../mappers';
import type { IngestionService } from '../ingestion/ingestion-service';
import { SportProviderNotFoundError } from '../ingestion/ingestion-service';
import type { EventLifecycleService } from './event-lifecycle-service';
import { SportEventError } from './errors';
import type { SportEventServices } from './wiring';
import type { SlotTiebreakerService } from './slot-tiebreaker-service';
import type { ChooseSlotTiebreakerGameRequest, SportEventSlotTiebreakerResponse, SportEventSlotTiebreakersResponse } from '@poolmaster/shared/dto';
import { toSportEventSlotTiebreakerDto } from '../../mappers/slot-tiebreaker.mapper';
import type { SportLeaguePageService } from '../sport-catalog/sport-league-page';
import type { SportEventOverviewResponse } from '@poolmaster/shared/dto/sport-catalog.dto';
import { mapSportEventOverviewToDto } from '../../mappers/sport-catalog.mapper';

type EventParams = { Params: { eventId: string } };
/** An event and one Season slot it is played in, whose tier set a slot route reads or writes (#2044). */
type SlotParams = { Params: { eventId: string; seasonSlotId: string } };
type RoundParams = { Params: { eventId: string; roundNumber: number } };

/** Only a root admin sees drafts (#431) and reads an event's admin counts (#1198). */
function isRootAdmin(request: FastifyRequest): boolean {
  return request.authUser?.isRootAdmin === true;
}

/**
 * The event lists a caller other than a root admin may read (#1348): events that can still take a
 * contest, or one Season's (#2003). Both stay small; a sport across every Season is the root
 * admin's catalog alone.
 */
function isMemberEventList(query: SportEventListQuery): boolean {
  const oneSeason = query.sportLeagueSeasonId !== undefined;
  return isOfferableEventList(query) || oneSeason;
}

/** The events that can still take a contest: what Create contest chooses from. */
function isOfferableEventList(query: SportEventListQuery): boolean {
  return query.status !== undefined && query.status.length > 0
    && query.status.every((status) => OFFERABLE_SPORT_EVENT_STATUSES.includes(status));
}

export interface EventHandlerDeps {
  services: SportEventServices;
  eventLifecycle: EventLifecycleService;
  ingestion: IngestionService;
  /** Settle again (#1890): the event's contests' boards rebuilt from the results stored now. */
  leaderboards: Pick<LeaderboardRebuilds, 'eventsChanged'>;
  /** The Event page's header and sync rows (#1889), by the League page's rules. */
  eventOverviews: Pick<SportLeaguePageService, 'getEventOverview'>;
  /** Each slot's tiebreaker game (#2048): the Slots tab reads it and a root admin chooses it. */
  slotTiebreakers: Pick<SlotTiebreakerService, 'listSlotTiebreakers' | 'chooseTiebreakerGame'>;
}

/**
 * The SportEvent operation set and its children's (#236). Every service error carries its
 * contract code and status and reaches the caller through the global error handler; only
 * the provider-sync errors, which carry neither, are mapped here.
 */
export function createEventHandlers({ services, eventLifecycle, ingestion, leaderboards, eventOverviews, slotTiebreakers }: EventHandlerDeps) {
  const { sportEvents, rounds, field, tiers, strokePlayResults, raceResults, matchResults, bracket, contests } = services;

  /** An admin action's answer: the event with the root admin's counts. */
  async function eventResponse(eventId: string): Promise<SportEventResponse> {
    return { event: mapSportEventToDto(await sportEvents.requireAdminSummary(eventId)) };
  }

  /** 404 EVENT_NOT_FOUND for an unknown event, in one read. */
  async function requireEvent(eventId: string): Promise<void> {
    await sportEvents.requireEvent(eventId);
  }

  /** The field read now: what a write to it answers with. */
  /** The field read now; each row's valuation in the set of the slot played in `seasonSlotId`, else the tier-set slot's (#2044). */
  async function fieldResponse(eventId: string, seasonSlotId?: string): Promise<SportEventParticipantListResponse> {
    return { participants: (await field.listEventParticipants(eventId, seasonSlotId)).map(mapSportEventParticipantToDto) };
  }

  /** One field row read now: what a write to that row answers with, rather than the whole field (#1163). */
  async function fieldRowResponse(eventId: string, sportEventParticipantId: string): Promise<SportEventParticipantResponse> {
    return { participant: mapSportEventParticipantToDto(await field.getEventParticipant(eventId, sportEventParticipantId)) };
  }

  return {
    listEvents: async (request: FastifyRequest<{ Querystring: SportEventListQuery }>): Promise<SportEventListResponse> => {
      const logger = request.contextLogger ?? request.log;
      const { status, ...filters } = request.query;
      // A DRAFT event is the admin's work in progress: only a root admin sees it (#431), and only
      // a root admin's list counts its readiness (#1198).
      const rootAdmin = isRootAdmin(request);
      if (!rootAdmin && !isMemberEventList(request.query)) {
        logger.warn({ action: 'events.route.list.forbidden', data: { ...request.query } }, 'Rejected an unbounded sport event list from a caller without the root-admin claim');
        throw new SportEventError('Only a root admin may list events beyond those open for contests or one sport league season.', 'ROOT_ADMIN_ACCESS_REQUIRED', 403);
      }
      const events = (await sportEvents.listEvents(
        // A switched-off sport league (#1812) takes no new contest, so a member is offered none
        // of its events; its season still reads for the contests already made on it.
        { ...filters, statuses: status, releasedOnly: !rootAdmin, activeSportLeaguesOnly: !rootAdmin && isOfferableEventList(request.query) },
        { adminCounts: rootAdmin },
      )).map(mapSportEventToDto);
      logger.info({
        action: 'events.route.list.success',
        data: { count: events.length, contestEligibleCount: events.filter((event) => event.contestEligible).length },
      }, 'Listed sport events');
      return { events };
    },

    getEvent: async (request: FastifyRequest<EventParams>): Promise<SportEventResponse> => {
      // As in listEvents: a draft is a 404 to anyone but a root admin, whose read alone counts readiness.
      const rootAdmin = isRootAdmin(request);
      const summary = await sportEvents.requireSummary(request.params.eventId, { releasedOnly: !rootAdmin, adminCounts: rootAdmin });
      return { event: mapSportEventToDto(summary) };
    },

    createEvent: async (request: FastifyRequest<{ Body: CreateSportEventRequest }>, reply: FastifyReply) => {
      const created = await sportEvents.createEvent(request.body);
      return reply.status(201).send({ event: mapSportEventToDto(created) } satisfies SportEventResponse);
    },

    updateEvent: async (request: FastifyRequest<EventParams & { Body: UpdateSportEventRequest }>): Promise<SportEventResponse> => {
      const { startDate, endDate, tellMembers, ...rest } = request.body;
      const updated = await sportEvents.updateEvent(request.params.eventId, {
        ...rest,
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate === null ? null : new Date(endDate) }),
      }, { tellMembers: tellMembers ?? true });
      return { event: mapSportEventToDto(updated) };
    },

    deleteEvent: async (request: FastifyRequest<EventParams>, reply: FastifyReply) => {
      await sportEvents.deleteEvent(request.params.eventId);
      return reply.status(204).send();
    },

    /** "Release for contests" (#431): the one way out of DRAFT, after its readiness checks. */
    releaseEvent: async (request: FastifyRequest<EventParams>): Promise<SportEventResponse> => {
      return { event: mapSportEventToDto(await sportEvents.releaseEvent(request.params.eventId)) };
    },

    /** Status changes go through the lifecycle service, the one path that also activates and settles contests. */
    transitionEvent: async (request: FastifyRequest<EventParams & { Body: TransitionSportEventRequest }>): Promise<SportEventResponse> => {
      await requireEvent(request.params.eventId);
      await eventLifecycle.applySportEventStatusTransition({
        sportEventId: request.params.eventId,
        toStatus: request.body.toStatus,
        actor: { type: 'ROOT_ADMIN' },
      });
      return eventResponse(request.params.eventId);
    },

    /** Settle again (#1890): queues one rebuild of the event's contests' boards from the results stored now; 204. */
    rebuildEventLeaderboards: async (request: FastifyRequest<EventParams>, reply: FastifyReply) => {
      const { eventId } = request.params;
      await requireEvent(eventId);
      // poolmaster-allow-direct-job: a root admin's Settle again route starts the rebuild
      await leaderboards.eventsChanged([eventId]);
      (request.contextLogger ?? request.log).info({ action: 'events.route.leaderboards.rebuild.queued', data: { eventId } }, 'Queued a rebuild of the event\'s leaderboards');
      return reply.status(204).send();
    },

    /** Queues a provider sync of the event's field. 409 EVENT_NOT_LINKED for an event with no provider link. */
    refreshEventParticipants: async (request: FastifyRequest<EventParams>, reply: FastifyReply) => {
      const event = await sportEvents.requireEvent(request.params.eventId);
      const feedRef = eventFeedRef(event);
      if (feedRef === undefined) {
        return sendError(reply, 409, 'EVENT_NOT_LINKED', `Sport event ${event.id} has no id at its league's provider.`);
      }
      try {
        const result = await ingestion.syncEventData(
          { sport: event.sport, providerId: feedRef.providerId, eventId: feedRef.externalId, kinds: [ProviderSyncKind.FIELD] },
          request.authUser?.userId ?? '',
          request.authUser?.email ?? '',
        );
        return reply.status(202).send(toProviderManualSyncSubmissionResponse(result));
      } catch (err) {
        if (err instanceof SportProviderNotFoundError) return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
        throw err;
      }
    },

    listEventRounds: async (request: FastifyRequest<EventParams>): Promise<SportEventRoundListResponse> => {
      await requireEvent(request.params.eventId);
      return { rounds: (await rounds.listRoundViews(request.params.eventId)).map(mapSportEventRoundToDto) };
    },

    getEventOverview: async (request: FastifyRequest<EventParams>): Promise<SportEventOverviewResponse> => {
      const overview = await eventOverviews.getEventOverview(request.params.eventId);
      if (overview === null) throw new SportEventError(`Sport event ${request.params.eventId} was not found.`, 'EVENT_NOT_FOUND', 404);
      return { overview: mapSportEventOverviewToDto(overview) };
    },

    listEventContests: async (request: FastifyRequest<EventParams>): Promise<SportEventContestListResponse> => {
      return mapSportEventContestsToResponse(await contests.listContests(request.params.eventId));
    },

    updateEventRounds: async (
      request: FastifyRequest<EventParams & { Body: UpdateSportEventRoundsRequest }>,
    ): Promise<SportEventRoundListResponse> => {
      await rounds.reschedule(request.params.eventId, request.body.rounds.map((round) => ({
        roundNumber: round.roundNumber,
        scheduledDate: new Date(round.scheduledDate),
        ...(round.scheduledEndAt !== undefined && {
          scheduledEndAt: round.scheduledEndAt === null ? null : new Date(round.scheduledEndAt),
        }),
      })));
      return { rounds: (await rounds.listRoundViews(request.params.eventId)).map(mapSportEventRoundToDto) };
    },

    // Every contest's pick screens poll it: the field read in the last 30 seconds answers (#1163).
    listEventParticipants: async (request: FastifyRequest<EventParams>): Promise<SportEventParticipantListResponse> => {
      return { participants: (await field.listCachedEventParticipants(request.params.eventId)).map(mapSportEventParticipantToDto) };
    },

    addEventParticipants: async (
      request: FastifyRequest<EventParams & { Body: AddSportEventParticipantsRequest }>,
    ): Promise<AddSportEventParticipantsResponse> => {
      return field.addParticipants(request.params.eventId, request.body.participantIds);
    },

    updateEventParticipants: async (
      request: FastifyRequest<EventParams & { Body: UpdateSportEventParticipantsRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      const updated = await field.updateParticipants(request.params.eventId, request.body.participants);
      return { participants: updated.map(mapSportEventParticipantToDto) };
    },

    removeEventParticipant: async (
      request: FastifyRequest<{ Params: { eventId: string; sportEventParticipantId: string } }>,
      reply: FastifyReply,
    ) => {
      await field.removeParticipant(request.params.eventId, request.params.sportEventParticipantId);
      return reply.status(204).send();
    },

    listEventTiers: async (request: FastifyRequest<EventParams>): Promise<SportEventTierListResponse> => {
      await requireEvent(request.params.eventId);
      return { tiers: (await tiers.listTiers(request.params.eventId)).map(mapSportEventTierToDto) };
    },

    replaceEventTiers: async (
      request: FastifyRequest<EventParams & { Body: ReplaceSportEventTiersRequest }>,
    ): Promise<SportEventTierListResponse> => {
      await requireEvent(request.params.eventId);
      const groups = await tiers.replaceTiers({ sportEventId: request.params.eventId, ...request.body });
      return { tiers: groups.map(mapSportEventTierToDto) };
    },

    autoAssignEventTiers: async (
      request: FastifyRequest<EventParams & { Body: AutoAssignSportEventTiersRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await requireEvent(request.params.eventId);
      await tiers.autoAssignTiers({ sportEventId: request.params.eventId, ...request.body });
      return fieldResponse(request.params.eventId);
    },

    replaceEventTierAssignments: async (
      request: FastifyRequest<EventParams & { Body: ReplaceSportEventTierAssignmentsRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await requireEvent(request.params.eventId);
      await tiers.replaceTierAssignments({ sportEventId: request.params.eventId, assignments: request.body.assignments });
      return fieldResponse(request.params.eventId);
    },

    autoAssignEventPrices: async (
      request: FastifyRequest<EventParams & { Body: AutoAssignSportEventPricesRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await requireEvent(request.params.eventId);
      await tiers.autoAssignPrices({ sportEventId: request.params.eventId, pricing: request.body });
      return fieldResponse(request.params.eventId);
    },

    // The same reads and writes on the set of the slot played in a Season slot (#2044).
    listEventSlotParticipants: async (request: FastifyRequest<SlotParams>): Promise<SportEventParticipantListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      await tiers.listTiers(eventId, { seasonSlotId });
      return fieldResponse(eventId, seasonSlotId);
    },

    listEventSlotTiers: async (request: FastifyRequest<SlotParams>): Promise<SportEventTierListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      return { tiers: (await tiers.listTiers(eventId, { seasonSlotId })).map(mapSportEventTierToDto) };
    },

    replaceEventSlotTiers: async (
      request: FastifyRequest<SlotParams & { Body: ReplaceSportEventTiersRequest }>,
    ): Promise<SportEventTierListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      await tiers.replaceTiers({ sportEventId: eventId, seasonSlotId, ...request.body });
      return { tiers: (await tiers.listTiers(eventId, { seasonSlotId })).map(mapSportEventTierToDto) };
    },

    autoAssignEventSlotTiers: async (
      request: FastifyRequest<SlotParams & { Body: AutoAssignSportEventTiersRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      await tiers.autoAssignTiers({ sportEventId: eventId, seasonSlotId, ...request.body });
      return fieldResponse(eventId, seasonSlotId);
    },

    replaceEventSlotTierAssignments: async (
      request: FastifyRequest<SlotParams & { Body: ReplaceSportEventTierAssignmentsRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      await tiers.replaceTierAssignments({ sportEventId: eventId, seasonSlotId, assignments: request.body.assignments });
      return fieldResponse(eventId, seasonSlotId);
    },

    autoAssignEventSlotPrices: async (
      request: FastifyRequest<SlotParams & { Body: AutoAssignSportEventPricesRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      const { eventId, seasonSlotId } = request.params;
      await requireEvent(eventId);
      await tiers.autoAssignPrices({ sportEventId: eventId, seasonSlotId, pricing: request.body });
      return fieldResponse(eventId, seasonSlotId);
    },

    previewGolfRoundScores: async (
      request: FastifyRequest<RoundParams & { Body: GolfRoundScoreUploadRequest }>,
    ): Promise<GolfRoundScorePreviewResponse> => {
      await requireEvent(request.params.eventId);
      const rows = await strokePlayResults.previewRoundScores(request.params.eventId, request.params.roundNumber, request.body.rows);
      return mapGolfRoundScorePreviewToDto(rows);
    },

    applyGolfRoundScores: async (
      request: FastifyRequest<RoundParams & { Body: GolfRoundScoreUploadRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      await strokePlayResults.applyRoundScores(request.params.eventId, request.params.roundNumber, request.body.rows);
      return fieldResponse(request.params.eventId);
    },

    previewRaceResults: async (
      request: FastifyRequest<EventParams & { Body: RaceResultUploadRequest }>,
    ): Promise<RaceResultPreviewResponse> => {
      await requireEvent(request.params.eventId);
      return mapRaceResultPreviewToDto(await raceResults.previewResults(request.params.eventId, request.body));
    },

    applyRaceResults: async (
      request: FastifyRequest<EventParams & { Body: RaceResultUploadRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      await raceResults.applyResults(request.params.eventId, request.body);
      return fieldResponse(request.params.eventId);
    },

    updateGolfRoundScore: async (
      request: FastifyRequest<{ Params: { eventId: string; roundNumber: number; sportEventParticipantId: string }; Body: UpdateGolfRoundScoreRequest }>,
    ): Promise<SportEventParticipantResponse> => {
      const { eventId, roundNumber, sportEventParticipantId } = request.params;
      await sportEvents.requireTestEvent(eventId);
      await strokePlayResults.updateRoundScore(eventId, roundNumber, sportEventParticipantId, request.body);
      return fieldRowResponse(eventId, sportEventParticipantId);
    },

    getEventBracket: async (request: FastifyRequest<EventParams>): Promise<SportEventBracketResponse> => {
      // As in getEvent: a draft's bracket is a 404 to anyone but a root admin.
      await sportEvents.requireEvent(request.params.eventId, { releasedOnly: !isRootAdmin(request) });
      return { matches: (await bracket.listBracket(request.params.eventId)).map(mapSportEventRoundMatchToDto) };
    },

    loadEventBracket: async (
      request: FastifyRequest<EventParams & { Body: LoadSportEventBracketRequest }>,
    ): Promise<SportEventBracketResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      const matches = await bracket.loadBracket(request.params.eventId, request.body.matches.map((match) => ({
        ...match,
        scheduledDate: match.scheduledDate === null ? null : new Date(match.scheduledDate),
      })));
      return { matches: matches.map(mapSportEventRoundMatchToDto) };
    },

    listEventSlotTiebreakers: async (request: FastifyRequest<{ Params: { eventId: string } }>): Promise<SportEventSlotTiebreakersResponse> => {
      await requireEvent(request.params.eventId);
      return { slots: (await slotTiebreakers.listSlotTiebreakers(request.params.eventId)).map(toSportEventSlotTiebreakerDto) };
    },

    chooseEventSlotTiebreakerGame: async (
      request: FastifyRequest<{ Params: { eventId: string; seasonSlotId: string }; Body: ChooseSlotTiebreakerGameRequest }>,
    ): Promise<SportEventSlotTiebreakerResponse> => {
      await requireEvent(request.params.eventId);
      const slot = await slotTiebreakers.chooseTiebreakerGame(request.params.eventId, request.params.seasonSlotId, request.body.gameId, request.authUser?.userId ?? '');
      return { slot: toSportEventSlotTiebreakerDto(slot) };
    },

    updateEventBracketMatch: async (
      request: FastifyRequest<{ Params: { eventId: string } & MatchPlace; Body: UpdateSportEventRoundMatchRequest }>,
    ): Promise<SportEventRoundMatchResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      const { scheduledDate, ...edit } = request.body;
      const match = await bracket.updateMatch(request.params.eventId, matchPlaceOf(request.params), {
        ...edit,
        ...(scheduledDate !== undefined && { scheduledDate: scheduledDate === null ? null : new Date(scheduledDate) }),
      });
      return { match: mapSportEventRoundMatchToDto(match) };
    },

    recordEventMatchResult: async (
      request: FastifyRequest<{ Params: { eventId: string } & MatchPlace; Body: RecordSportEventRoundMatchResultRequest }>,
    ): Promise<SportEventBracketResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      const matches = await matchResults.recordResult(request.params.eventId, matchPlaceOf(request.params), request.body);
      return { matches: matches.map(mapSportEventRoundMatchToDto) };
    },

    recordEventMatchPeriodScore: async (
      request: FastifyRequest<{ Params: { eventId: string; periodNumber: number } & MatchPlace; Body: RecordSportEventMatchPeriodScoreRequest }>,
    ): Promise<SportEventBracketResponse> => {
      const { eventId, periodNumber } = request.params;
      await sportEvents.requireTestEvent(eventId);
      const matches = await matchResults.recordPeriodScore(eventId, matchPlaceOf(request.params), periodNumber, request.body.sides);
      return { matches: matches.map(mapSportEventRoundMatchToDto) };
    },

    cancelEventMatch: async (
      request: FastifyRequest<{ Params: { eventId: string } & MatchPlace }>,
    ): Promise<SportEventBracketResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      const matches = await matchResults.cancelMatch(request.params.eventId, matchPlaceOf(request.params));
      return { matches: matches.map(mapSportEventRoundMatchToDto) };
    },

    proposeEventRoundMatchups: async (
      request: FastifyRequest<{ Params: { eventId: string; roundNumber: number } }>,
    ): Promise<SportEventRoundMatchupsResponse> => {
      return { matches: (await bracket.proposeRoundMatchups(request.params.eventId, request.params.roundNumber)).map(({ matchNumber, sides }) => ({ matchNumber, sides: [...sides] })) };
    },

    setEventRoundMatchups: async (
      request: FastifyRequest<{ Params: { eventId: string; roundNumber: number }; Body: SetSportEventRoundMatchupsRequest }>,
    ): Promise<SportEventBracketResponse> => {
      await sportEvents.requireTestEvent(request.params.eventId);
      const matches = await bracket.setRoundMatchups(request.params.eventId, request.params.roundNumber, request.body.matches);
      return { matches: matches.map(mapSportEventRoundMatchToDto) };
    },


  };
}
