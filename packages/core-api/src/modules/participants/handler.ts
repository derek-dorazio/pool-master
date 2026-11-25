/**
 * Participant route handlers — search, CRUD, and season records.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ParticipantService } from './service';
import { ParticipantNotFoundError, ProviderNotFoundError } from './service';
import type { ParticipantSearchFilters } from '@poolmaster/shared/db';
import type {
  BindParticipantProviderMappingRequest,
  CreateParticipantRequest,
  ParticipantListQuery,
  ParticipantListResponse,
  SportLeagueProviderMappingListQuery,
  UpdateParticipantRequest,
} from '@poolmaster/shared/dto/participants.dto';
import { mapParticipantProviderMappingToDto, mapParticipantToDto, toUpdateParticipantInput } from '../../mappers';
import { sendError } from '../../core/error-handler';
import { isPlatformSearchTerm, PLATFORM_SEARCH_MIN_LENGTH } from '@poolmaster/shared/domain';

export function createParticipantHandlers(participantService: ParticipantService) {
  return {
    searchParticipants,
    getParticipant,
    createParticipant,
    updateParticipant,
    deleteParticipant,
    listProviderMappings,
    listSportLeagueProviderMappings,
    bindProviderMapping,
  };

  async function searchParticipants(
    request: FastifyRequest<{ Querystring: ParticipantListQuery }>,
    reply: FastifyReply,
  ): Promise<ParticipantListResponse> {
    const { q, sportLeagueId, status } = request.query;
    // Every league's catalog at once is the largest list there is, and nothing pages it (§16), so
    // it takes a sport league or a search term (#1180).
    if (!sportLeagueId && !isPlatformSearchTerm(q)) {
      request.log.warn({ action: 'participants.search.filterRequired' }, 'Rejected a participant list without a sport league or search term');
      return sendError(
        reply,
        400,
        'SEARCH_TERM_REQUIRED',
        `Choose a sport league, or type at least ${PLATFORM_SEARCH_MIN_LENGTH} characters to find a participant.`,
      );
    }
    const filters: ParticipantSearchFilters = { sportLeagueId, status };

    const participants = await participantService.search({ query: q?.trim(), filters });
    return { participants: participants.map(mapParticipantToDto) };
  }

  async function listProviderMappings(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const participant = await participantService.findById(request.params.id);
    if (!participant) {
      return sendError(reply, 404, 'PARTICIPANT_NOT_FOUND', `Participant ${request.params.id} was not found.`);
    }
    const providerMappings = await participantService.getProviderMappings(request.params.id);
    return { providerMappings: providerMappings.map(mapParticipantProviderMappingToDto) };
  }

  // The service's not-found and in-use errors carry their own code and status; the global error
  // handler sends them.
  async function deleteParticipant(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    await participantService.delete(request.params.id);
    return reply.status(204).send();
  }

  async function listSportLeagueProviderMappings(request: FastifyRequest<{ Querystring: SportLeagueProviderMappingListQuery }>) {
    const { providerId, sportLeagueId } = request.query;
    const providerMappings = await participantService.listSportLeagueProviderMappings(providerId, sportLeagueId);
    return { providerMappings: providerMappings.map(mapParticipantProviderMappingToDto) };
  }

  async function bindProviderMapping(
    request: FastifyRequest<{ Params: { id: string }; Body: BindParticipantProviderMappingRequest }>,
    reply: FastifyReply,
  ) {
    const { providerId, externalId } = request.body;
    try {
      const providerMapping = await participantService.bindProviderMapping(request.params.id, providerId, externalId);
      return reply.send({ providerMapping: mapParticipantProviderMappingToDto(providerMapping) });
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        return sendError(reply, 404, 'PARTICIPANT_NOT_FOUND', err.message);
      }
      if (err instanceof ProviderNotFoundError) {
        return sendError(reply, 404, 'PROVIDER_NOT_FOUND', err.message);
      }
      throw err;
    }
  }

  async function getParticipant(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    logger.debug(
      {
        action: 'participants.route.detail.start',
        data: {
          participantId: request.params.id,
        },
      },
      'Handling participant detail request',
    );

    try {
      const participant = await participantService.findById(request.params.id);
      if (!participant) {
        logger.warn(
          {
            action: 'participants.route.detail.not_found',
            data: {
              participantId: request.params.id,
            },
          },
          'Participant detail target not found',
        );
        return sendError(reply, 404, 'PARTICIPANT_NOT_FOUND', 'Participant not found');
      }

      logger.info(
        {
          action: 'participants.route.detail.success',
          data: {
            participantId: request.params.id,
          },
        },
        'Participant detail succeeded',
      );

      return reply.send({ participant: mapParticipantToDto(participant) });
    } catch (error) {
      logger.error(
        {
          action: 'participants.route.detail.failed',
          err: error,
          data: {
            participantId: request.params.id,
          },
        },
        'Participant detail request failed',
      );
      throw error;
    }
  }

  async function createParticipant(
    request: FastifyRequest<{ Body: CreateParticipantRequest }>,
    reply: FastifyReply,
  ) {
    const body = request.body;
    const logger = request.contextLogger ?? request.log;

    logger.debug(
      {
        action: 'participants.route.create.start',
        data: {
          sportLeagueId: body.sportLeagueId,
          participantType: body.participantType,
        },
      },
      'Handling participant create request',
    );

    try {
      const participant = await participantService.create({
        sportLeagueId: body.sportLeagueId,
        ranking: body.ranking,
        name: body.name,
        participantType: body.participantType,
        firstName: body.firstName,
        lastName: body.lastName,
        shortName: body.shortName,
        nationality: body.nationality,
        role: body.role,
        teamAffiliation: body.teamAffiliation,
        feedId: body.feedId,
        isTestData: body.isTestData,
      });

      logger.info(
        {
          action: 'participants.route.create.success',
          data: {
            participantId: participant.id,
            sportLeagueId: participant.sportLeagueId,
          },
        },
        'Participant create succeeded',
      );

      return reply.status(201).send({ participant: mapParticipantToDto(participant) });
    } catch (error) {
      logger.error(
        {
          action: 'participants.route.create.failed',
          err: error,
          data: {
            sportLeagueId: body.sportLeagueId,
            participantType: body.participantType,
          },
        },
        'Participant create request failed',
      );
      throw error;
    }
  }

  async function updateParticipant(
    request: FastifyRequest<{
      Params: { id: string };
      Body: UpdateParticipantRequest;
    }>,
    reply: FastifyReply,
  ) {
    const logger = request.contextLogger ?? request.log;

    logger.debug(
      {
        action: 'participants.route.update.start',
        data: {
          participantId: request.params.id,
          updatedFields: Object.keys(request.body),
        },
      },
      'Handling participant update request',
    );

    try {
      const participant = await participantService.update(request.params.id, toUpdateParticipantInput(request.body));
      logger.info(
        {
          action: 'participants.route.update.success',
          data: {
            participantId: request.params.id,
          },
        },
        'Participant update succeeded',
      );
      return reply.send({ participant: mapParticipantToDto(participant) });
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        logger.warn(
          {
            action: 'participants.route.update.not_found',
            data: {
              participantId: request.params.id,
            },
          },
          'Participant update target not found',
        );
        return sendError(reply, 404, 'PARTICIPANT_NOT_FOUND', err.message);
      }
      logger.error(
        {
          action: 'participants.route.update.failed',
          err,
          data: {
            participantId: request.params.id,
            updatedFields: Object.keys(request.body),
          },
        },
        'Participant update request failed',
      );
      throw err;
    }
  }

}
