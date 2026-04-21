/**
 * Participant route handlers — search, CRUD, and season records.
 */

import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ParticipantService } from './service';
import { ParticipantNotFoundError } from './service';
import type { ParticipantSearchFilters } from '@poolmaster/shared/db';
import type { ParticipantStatus } from '@poolmaster/shared/domain';
import {
  mapParticipantSeasonRecordToDto,
  mapParticipantToDto,
} from '../../mappers';
import { sendError } from '../../core/error-handler';

export function createParticipantHandlers(participantService: ParticipantService) {
  return {
    searchParticipants,
    getParticipant,
    createParticipant,
    updateParticipant,
    getSeasonRecord,
    getSeasonRecords,
  };

  async function searchParticipants(
    request: FastifyRequest<{
      Querystring: {
        q?: string;
        sportId?: string;
        status?: string;
        position?: string;
        team?: string;
        nationality?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    _reply: FastifyReply,
  ): Promise<{ participants: ReturnType<typeof mapParticipantToDto>[]; total: number }> {
    const qs = request.query;
    const logger = request.contextLogger ?? request.log;
    const filters: ParticipantSearchFilters = {};
    if (qs.sportId) filters.sportId = qs.sportId;
    if (qs.status) filters.status = qs.status.split(',') as ParticipantStatus[];
    if (qs.position) filters.position = qs.position.split(',');
    if (qs.team) filters.teamAffiliation = qs.team.split(',');
    if (qs.nationality) filters.nationality = qs.nationality.split(',');

    logger.debug(
      {
        action: 'participants.route.search.start',
        data: {
          query: qs.q ?? null,
          sportId: qs.sportId ?? null,
          status: qs.status ?? null,
          limit: qs.limit ?? null,
          offset: qs.offset ?? null,
        },
      },
      'Handling participant search request',
    );

    try {
      const result = await participantService.search({
        query: qs.q,
        filters,
        limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
        offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
      });
      const response = {
        participants: result.participants.map(mapParticipantToDto),
        total: result.total,
      };

      logger.info(
        {
          action: 'participants.route.search.success',
          data: {
            returnedCount: response.participants.length,
            total: response.total,
          },
        },
        'Participant search succeeded',
      );

      return response;
    } catch (error) {
      logger.error(
        {
          action: 'participants.route.search.failed',
          err: error,
          data: {
            query: qs.q ?? null,
            sportId: qs.sportId ?? null,
          },
        },
        'Participant search request failed',
      );
      throw error;
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
    request: FastifyRequest<{
      Body: {
        sportId: string;
        name: string;
        participantType: string;
        externalId?: string;
        firstName?: string;
        lastName?: string;
        shortName?: string;
        nationality?: string;
        position?: string;
        teamAffiliation?: string;
        metadata?: Record<string, unknown>;
        externalIds?: Record<string, string>;
      };
    }>,
    reply: FastifyReply,
  ): Promise<void> {
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
        participantType: body.participantType as 'INDIVIDUAL' | 'TEAM',
        externalId: body.externalId,
        firstName: body.firstName,
        lastName: body.lastName,
        shortName: body.shortName,
        nationality: body.nationality,
        position: body.position,
        teamAffiliation: body.teamAffiliation,
        metadata: body.metadata,
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
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
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
      const participant = await participantService.update(request.params.id, request.body);
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

  async function getSeasonRecord(
    request: FastifyRequest<{ Params: { id: string; season: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const logger = request.contextLogger ?? request.log;

    logger.debug(
      {
        action: 'participants.route.season_record.start',
        data: {
          participantId: request.params.id,
          season: request.params.season,
        },
      },
      'Handling participant season record request',
    );

    try {
      const record = await participantService.getSeasonRecord(
        request.params.id,
        request.params.season,
      );
      if (!record) {
        logger.warn(
          {
            action: 'participants.route.season_record.not_found',
            data: {
              participantId: request.params.id,
              season: request.params.season,
            },
          },
          'Participant season record not found',
        );
        return sendError(
          reply,
          404,
          'PARTICIPANT_SEASON_RECORD_NOT_FOUND',
          'Season record not found',
        );
      }

      logger.info(
        {
          action: 'participants.route.season_record.success',
          data: {
            participantId: request.params.id,
            season: request.params.season,
          },
        },
        'Participant season record request succeeded',
      );

      return reply.send({ seasonRecord: mapParticipantSeasonRecordToDto(record) });
    } catch (error) {
      logger.error(
        {
          action: 'participants.route.season_record.failed',
          err: error,
          data: {
            participantId: request.params.id,
            season: request.params.season,
          },
        },
        'Participant season record request failed',
      );
      throw error;
    }
  }

  async function getSeasonRecords(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ seasonRecords: ReturnType<typeof mapParticipantSeasonRecordToDto>[] }> {
    const logger = request.contextLogger ?? request.log;

    logger.debug(
      {
        action: 'participants.route.season_records.start',
        data: {
          participantId: request.params.id,
        },
      },
      'Handling participant season-record list request',
    );

    try {
      const records = await participantService.getSeasonRecords(request.params.id);
      const response = { seasonRecords: records.map(mapParticipantSeasonRecordToDto) };
      logger.info(
        {
          action: 'participants.route.season_records.success',
          data: {
            participantId: request.params.id,
            count: response.seasonRecords.length,
          },
        },
        'Participant season-record list request succeeded',
      );
      return response;
    } catch (error) {
      logger.error(
        {
          action: 'participants.route.season_records.failed',
          err: error,
          data: {
            participantId: request.params.id,
          },
        },
        'Participant season-record list request failed',
      );
      throw error;
    }
  }
}
