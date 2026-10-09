/**
 * Participant route handlers — search, CRUD, and season records.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ParticipantService } from './service';
import { ParticipantNotFoundError } from './service';
import type { ParticipantSearchFilters } from '@poolmaster/shared/db';
import type {
  BindParticipantProviderMappingRequest,
  CreateParticipantRequest,
  ParticipantListQuery,
  ParticipantListResponse,
  UpdateParticipantRequest,
} from '@poolmaster/shared/dto/participants.dto';
import type { ProviderRegistry } from '../ingestion/core/provider-registry';
import { mapParticipantProviderMappingToDto, mapParticipantToDto, toUpdateParticipantInput } from '../../mappers';
import { sendError } from '../../core/error-handler';

export function createParticipantHandlers(
  participantService: ParticipantService,
  providerRegistry: ProviderRegistry,
) {
  return {
    searchParticipants,
    getParticipant,
    createParticipant,
    updateParticipant,
    listProviderMappings,
    bindProviderMapping,
  };

  async function searchParticipants(
    request: FastifyRequest<{ Querystring: ParticipantListQuery }>,
    _reply: FastifyReply,
  ): Promise<ParticipantListResponse> {
    const { q, sportId, status } = request.query;
    const filters: ParticipantSearchFilters = { sportId, status };

    const participants = await participantService.search({ query: q, filters });
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

  async function bindProviderMapping(
    request: FastifyRequest<{ Params: { id: string }; Body: BindParticipantProviderMappingRequest }>,
    reply: FastifyReply,
  ) {
    const { providerId, externalId } = request.body;
    // A mapping names a registered provider, or no sync will ever use it.
    if (!providerRegistry.getProviderById(providerId)) {
      return sendError(reply, 404, 'PROVIDER_NOT_FOUND', `Provider ${providerId} was not found.`);
    }
    try {
      const providerMapping = await participantService.bindProviderMapping(request.params.id, providerId, externalId);
      return reply.send({ providerMapping: mapParticipantProviderMappingToDto(providerMapping) });
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        return sendError(reply, 404, 'PARTICIPANT_NOT_FOUND', err.message);
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
          sportId: body.sportId,
          participantType: body.participantType,
        },
      },
      'Handling participant create request',
    );

    try {
      const participant = await participantService.create({
        sportId: body.sportId,
        name: body.name,
        participantType: body.participantType,
        externalId: body.externalId,
        firstName: body.firstName,
        lastName: body.lastName,
        shortName: body.shortName,
        nationality: body.nationality,
        role: body.role,
        teamAffiliation: body.teamAffiliation,
        externalIds: body.externalIds,
      });

      logger.info(
        {
          action: 'participants.route.create.success',
          data: {
            participantId: participant.id,
            sportId: participant.sportId,
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
            sportId: body.sportId,
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
