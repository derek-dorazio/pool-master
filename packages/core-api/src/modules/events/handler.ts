import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AddSportEventParticipantsRequest,
  AddSportEventParticipantsResponse,
  AutoAssignSportEventPricesRequest,
  AutoAssignSportEventTiersRequest,
  CloneSportEventYearRequest,
  CreateSportEventFromProviderEventRequest,
  CreateSportEventRequest,
  ImportSportEventYearFromProviderRequest,
  LinkSportEventScoreSourceRequest,
  ReplaceSportEventTierAssignmentsRequest,
  ReplaceSportEventTiersRequest,
  SeedSportEventParticipantsResponse,
  SportEventListQuery,
  SportEventListResponse,
  SportEventLiveSimulationResponse,
  SportEventParticipantListResponse,
  SportEventParticipantResponse,
  SportEventParticipantUploadPreviewResponse,
  SportEventParticipantUploadRequest,
  SportEventResponse,
  SportEventRoundListResponse,
  SportEventTierListResponse,
  StartSportEventLiveSimulationRequest,
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
import { Sport, SportEventSyncScope } from '@poolmaster/shared/domain';
import { sendError } from '../../core/error-handler';
import {
  mapFieldUploadPreviewToDto,
  mapGolfRoundScorePreviewToDto,
  mapLiveSimulationToResponse,
  mapProviderEventYearImportToResponse,
  mapSportEventParticipantToDto,
  mapSportEventRoundToDto,
  mapSportEventTierToDto,
  mapSportEventToDto,
  toProviderManualSyncSubmissionResponse,
} from '../../mappers';
import type { IngestionService } from '../ingestion/ingestion-service';
import {
  SportEventSyncScopeError,
  SportProviderNotFoundError,
  SportSyncNotConfiguredError,
} from '../ingestion/ingestion-service';
import { SportEventError } from './errors';
import type { EventLifecycleService } from './event-lifecycle-service';
import type { EventScoreSourceService } from './event-score-source-service';
import type { SportEventServices } from './wiring';

type EventParams = { Params: { eventId: string } };
type RoundParams = { Params: { eventId: string; roundNumber: number } };

export interface EventHandlerDeps {
  services: SportEventServices;
  eventLifecycle: EventLifecycleService;
  scoreSource: EventScoreSourceService;
  ingestion: IngestionService;
}

/**
 * The SportEvent operation set and its children's (#236). Every service error carries its
 * contract code and status and reaches the caller through the global error handler; only
 * the provider-sync errors, which carry neither, are mapped here.
 */
export function createEventHandlers({ services, eventLifecycle, scoreSource, ingestion }: EventHandlerDeps) {
  const { sportEvents, rounds, field, tiers, golfScores } = services;

  async function eventResponse(eventId: string): Promise<SportEventResponse> {
    return { event: mapSportEventToDto(await sportEvents.requireSummary(eventId)) };
  }

  /** The golf score operations write golf rows; any other sport's event is refused. */
  async function requireGolfEvent(eventId: string): Promise<void> {
    const { event } = await sportEvents.requireSummary(eventId);
    if (event.sport !== Sport.GOLF) {
      throw new SportEventError(`Sport event ${eventId} is ${event.sport}, not golf.`, 'SPORT_NOT_SUPPORTED', 422);
    }
  }

  async function fieldResponse(eventId: string): Promise<SportEventParticipantListResponse> {
    return { participants: (await field.listEventParticipants(eventId)).map(mapSportEventParticipantToDto) };
  }

  return {
    listEvents: async (request: FastifyRequest<{ Querystring: SportEventListQuery }>): Promise<SportEventListResponse> => {
      const logger = request.contextLogger ?? request.log;
      // A DRAFT event is the admin's work in progress: only a root admin sees it (#431).
      const releasedOnly = request.authUser?.isRootAdmin !== true;
      const events = (await sportEvents.listEvents({ ...request.query, releasedOnly })).map(mapSportEventToDto);
      logger.info({
        action: 'events.route.list.success',
        data: { count: events.length, contestEligibleCount: events.filter((event) => event.contestEligible).length },
      }, 'Listed sport events');
      return { events };
    },

    getEvent: async (request: FastifyRequest<EventParams>): Promise<SportEventResponse> => {
      // As in listEvents: a draft is a 404 to anyone but a root admin.
      const releasedOnly = request.authUser?.isRootAdmin !== true;
      return { event: mapSportEventToDto(await sportEvents.requireSummary(request.params.eventId, { releasedOnly })) };
    },

    createEvent: async (request: FastifyRequest<{ Body: CreateSportEventRequest }>, reply: FastifyReply) => {
      const { body } = request;
      const created = await sportEvents.createEvent({
        ...body,
        startDate: new Date(body.startDate),
        endDate: body.endDate ? new Date(body.endDate) : undefined,
      });
      return reply.status(201).send({ event: mapSportEventToDto(created) } satisfies SportEventResponse);
    },

    createEventFromProviderEvent: async (
      request: FastifyRequest<{ Body: CreateSportEventFromProviderEventRequest }>,
      reply: FastifyReply,
    ) => {
      const { sportLeagueId, eventYear, providerId, externalId, rounds: roundCount } = request.body;
      const providerEvent = await scoreSource.getProviderEventDetail(providerId, externalId);
      const created = await sportEvents.createEventFromProviderEvent({
        sportLeagueId,
        eventYear,
        providerId,
        externalId,
        rounds: roundCount,
        providerEvent,
      });
      return reply.status(201).send({ event: mapSportEventToDto(created) } satisfies SportEventResponse);
    },

    cloneEventYear: async (request: FastifyRequest<{ Body: CloneSportEventYearRequest }>, reply: FastifyReply) => {
      const cloned = await sportEvents.cloneEventYear(request.body);
      return reply.status(201).send({ events: cloned.map(mapSportEventToDto) } satisfies SportEventListResponse);
    },

    importEventYearFromProvider: async (
      request: FastifyRequest<{ Body: ImportSportEventYearFromProviderRequest }>,
      reply: FastifyReply,
    ) => {
      const { sportLeagueId, eventYear, providerId } = request.body;
      const providerEvents = await scoreSource.listTourEventsForYear(providerId, sportLeagueId, eventYear);
      const result = await sportEvents.importProviderEventYear({ sportLeagueId, eventYear, providerId, providerEvents });
      return reply.status(201).send(mapProviderEventYearImportToResponse(result));
    },

    updateEvent: async (request: FastifyRequest<EventParams & { Body: UpdateSportEventRequest }>): Promise<SportEventResponse> => {
      const { startDate, endDate, ...rest } = request.body;
      const updated = await sportEvents.updateEvent(request.params.eventId, {
        ...rest,
        ...(startDate !== undefined && { startDate: new Date(startDate) }),
        ...(endDate !== undefined && { endDate: endDate === null ? null : new Date(endDate) }),
      });
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
      await sportEvents.requireSummary(request.params.eventId);
      await eventLifecycle.applySportEventStatusTransition({
        sportEventId: request.params.eventId,
        toStatus: request.body.toStatus,
        actor: { type: 'ROOT_ADMIN' },
      });
      return eventResponse(request.params.eventId);
    },

    linkScoreSource: async (request: FastifyRequest<EventParams & { Body: LinkSportEventScoreSourceRequest }>): Promise<SportEventResponse> => {
      await scoreSource.linkScoreSource(request.params.eventId, request.body);
      return eventResponse(request.params.eventId);
    },

    unlinkScoreSource: async (request: FastifyRequest<EventParams>): Promise<SportEventResponse> => {
      await scoreSource.unlinkScoreSource(request.params.eventId);
      return eventResponse(request.params.eventId);
    },

    startLiveSimulation: async (
      request: FastifyRequest<EventParams & { Body: StartSportEventLiveSimulationRequest | undefined }>,
    ): Promise<SportEventLiveSimulationResponse> => {
      const status = await scoreSource.startLiveSimulation(request.params.eventId, {
        minutesPerRound: request.body?.minutesPerRound,
      });
      return mapLiveSimulationToResponse(request.params.eventId, status);
    },

    getLiveSimulation: async (request: FastifyRequest<EventParams>): Promise<SportEventLiveSimulationResponse> => {
      const status = await scoreSource.getLiveSimulation(request.params.eventId);
      return mapLiveSimulationToResponse(request.params.eventId, status);
    },

    /** Queues a provider sync of the event's field. 409 EVENT_NOT_LINKED for an event with no provider link. */
    refreshEventParticipants: async (request: FastifyRequest<EventParams>, reply: FastifyReply) => {
      const { event } = await sportEvents.requireSummary(request.params.eventId);
      if (event.syncScope === SportEventSyncScope.NONE) {
        return sendError(reply, 409, 'EVENT_NOT_LINKED', `Sport event ${event.id} is not linked to a provider.`);
      }
      try {
        const result = await ingestion.syncEventData(
          { sport: event.sport, eventId: event.externalId, feeds: ['EVENTPARTICIPANTS'] },
          request.authUser?.userId ?? '',
          request.authUser?.email ?? '',
        );
        return reply.status(202).send(toProviderManualSyncSubmissionResponse(result));
      } catch (err) {
        if (err instanceof SportProviderNotFoundError) return sendError(reply, 404, 'SPORT_PROVIDER_NOT_FOUND', err.message);
        if (err instanceof SportSyncNotConfiguredError) return sendError(reply, 422, 'SPORT_SYNC_NOT_CONFIGURED', err.message);
        if (err instanceof SportEventSyncScopeError) return sendError(reply, 409, 'SPORT_EVENT_SYNC_SCOPE_RESTRICTED', err.message);
        throw err;
      }
    },

    listEventRounds: async (request: FastifyRequest<EventParams>): Promise<SportEventRoundListResponse> => {
      await sportEvents.requireSummary(request.params.eventId);
      return { rounds: (await rounds.listRounds(request.params.eventId)).map(mapSportEventRoundToDto) };
    },

    updateEventRounds: async (
      request: FastifyRequest<EventParams & { Body: UpdateSportEventRoundsRequest }>,
    ): Promise<SportEventRoundListResponse> => {
      const updated = await rounds.reschedule(request.params.eventId, request.body.rounds.map((round) => ({
        roundNumber: round.roundNumber,
        scheduledDate: new Date(round.scheduledDate),
        ...(round.scheduledEndAt !== undefined && {
          scheduledEndAt: round.scheduledEndAt === null ? null : new Date(round.scheduledEndAt),
        }),
      })));
      return { rounds: updated.map(mapSportEventRoundToDto) };
    },

    listEventParticipants: async (request: FastifyRequest<EventParams>): Promise<SportEventParticipantListResponse> => {
      return fieldResponse(request.params.eventId);
    },

    seedEventParticipants: async (request: FastifyRequest<EventParams>): Promise<SeedSportEventParticipantsResponse> => {
      return field.seedFromSportLeague(request.params.eventId);
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

    previewEventParticipantUpload: async (
      request: FastifyRequest<EventParams & { Body: SportEventParticipantUploadRequest }>,
    ): Promise<SportEventParticipantUploadPreviewResponse> => {
      return mapFieldUploadPreviewToDto(await field.previewUpload(request.params.eventId, request.body.rows));
    },

    applyEventParticipantUpload: async (
      request: FastifyRequest<EventParams & { Body: SportEventParticipantUploadRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      const updated = await field.applyUpload(request.params.eventId, request.body.rows);
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
      await sportEvents.requireSummary(request.params.eventId);
      return { tiers: (await tiers.listTiers(request.params.eventId)).map(mapSportEventTierToDto) };
    },

    replaceEventTiers: async (
      request: FastifyRequest<EventParams & { Body: ReplaceSportEventTiersRequest }>,
    ): Promise<SportEventTierListResponse> => {
      await sportEvents.requireSummary(request.params.eventId);
      const groups = await tiers.replaceTiers({ sportEventId: request.params.eventId, ...request.body });
      return { tiers: groups.map(mapSportEventTierToDto) };
    },

    autoAssignEventTiers: async (
      request: FastifyRequest<EventParams & { Body: AutoAssignSportEventTiersRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await sportEvents.requireSummary(request.params.eventId);
      await tiers.autoAssignTiers({ sportEventId: request.params.eventId, ...request.body });
      return fieldResponse(request.params.eventId);
    },

    replaceEventTierAssignments: async (
      request: FastifyRequest<EventParams & { Body: ReplaceSportEventTierAssignmentsRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await sportEvents.requireSummary(request.params.eventId);
      await tiers.replaceTierAssignments({ sportEventId: request.params.eventId, assignments: request.body.assignments });
      return fieldResponse(request.params.eventId);
    },

    autoAssignEventPrices: async (
      request: FastifyRequest<EventParams & { Body: AutoAssignSportEventPricesRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await sportEvents.requireSummary(request.params.eventId);
      await tiers.autoAssignPrices({ sportEventId: request.params.eventId, ...request.body });
      return fieldResponse(request.params.eventId);
    },

    previewGolfRoundScores: async (
      request: FastifyRequest<RoundParams & { Body: GolfRoundScoreUploadRequest }>,
    ): Promise<GolfRoundScorePreviewResponse> => {
      await requireGolfEvent(request.params.eventId);
      const rows = await golfScores.previewRoundScores(request.params.eventId, request.params.roundNumber, request.body.rows);
      return mapGolfRoundScorePreviewToDto(rows);
    },

    applyGolfRoundScores: async (
      request: FastifyRequest<RoundParams & { Body: GolfRoundScoreUploadRequest }>,
    ): Promise<SportEventParticipantListResponse> => {
      await requireGolfEvent(request.params.eventId);
      await golfScores.applyRoundScores(request.params.eventId, request.params.roundNumber, request.body.rows);
      return fieldResponse(request.params.eventId);
    },

    updateGolfRoundScore: async (
      request: FastifyRequest<{ Params: { eventId: string; roundNumber: number; sportEventParticipantId: string }; Body: UpdateGolfRoundScoreRequest }>,
    ): Promise<SportEventParticipantResponse> => {
      const { eventId, roundNumber, sportEventParticipantId } = request.params;
      await requireGolfEvent(eventId);
      await golfScores.updateRoundScore(eventId, roundNumber, sportEventParticipantId, request.body);
      const participant = (await field.listEventParticipants(eventId)).find((view) => view.entry.id === sportEventParticipantId);
      return { participant: mapSportEventParticipantToDto(participant as NonNullable<typeof participant>) };
    },
  };
}
