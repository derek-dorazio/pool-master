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
    const filters: ParticipantSearchFilters = {};
    if (qs.sportId) filters.sportId = qs.sportId;
    if (qs.status) filters.status = qs.status.split(',') as ParticipantStatus[];
    if (qs.position) filters.position = qs.position.split(',');
    if (qs.team) filters.teamAffiliation = qs.team.split(',');
    if (qs.nationality) filters.nationality = qs.nationality.split(',');

    const result = await participantService.search({
      query: qs.q,
      filters,
      limit: qs.limit ? parseInt(qs.limit, 10) : undefined,
      offset: qs.offset ? parseInt(qs.offset, 10) : undefined,
    });
    return {
      participants: result.participants.map(mapParticipantToDto),
      total: result.total,
    };
  }

  async function getParticipant(
    request: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const participant = await participantService.findById(request.params.id);
    if (!participant) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Participant not found' });
    }
    return reply.send({ participant: mapParticipantToDto(participant) });
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
    return reply.status(201).send({ participant: mapParticipantToDto(participant) });
  }

  async function updateParticipant(
    request: FastifyRequest<{
      Params: { id: string };
      Body: Record<string, unknown>;
    }>,
    reply: FastifyReply,
  ): Promise<void> {
    try {
      const participant = await participantService.update(request.params.id, request.body);
      return reply.send({ participant: mapParticipantToDto(participant) });
    } catch (err) {
      if (err instanceof ParticipantNotFoundError) {
        return reply.status(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  }

  async function getSeasonRecord(
    request: FastifyRequest<{ Params: { id: string; season: string } }>,
    reply: FastifyReply,
  ): Promise<void> {
    const record = await participantService.getSeasonRecord(
      request.params.id,
      request.params.season,
    );
    if (!record) {
      return reply.status(404).send({ error: 'NOT_FOUND', message: 'Season record not found' });
    }
    return reply.send({ seasonRecord: mapParticipantSeasonRecordToDto(record) });
  }

  async function getSeasonRecords(
    request: FastifyRequest<{ Params: { id: string } }>,
    _reply: FastifyReply,
  ): Promise<{ seasonRecords: ReturnType<typeof mapParticipantSeasonRecordToDto>[] }> {
    const records = await participantService.getSeasonRecords(request.params.id);
    return { seasonRecords: records.map(mapParticipantSeasonRecordToDto) };
  }
}
