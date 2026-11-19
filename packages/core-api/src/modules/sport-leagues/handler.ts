import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateSportLeagueRequest,
  SportLeagueListQuery,
  SportLeagueListResponse,
  SportLeagueParticipantRankingsRequest,
  SportLeagueRankingUploadPreviewResponse,
  SportLeagueRankingUploadRequest,
  SportLeagueOverviewListResponse,
  SportLeagueResponse,
  UpdateSportLeagueRequest,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { ParticipantListResponse } from '@poolmaster/shared/dto/participants.dto';
import { sendError } from '../../core/error-handler';
import type { ReadCache } from '../../core/read-cache';
import {
  mapParticipantToDto,
  mapRankingUploadPreviewRowToDto,
  mapSportLeagueOverviewToDto,
  mapSportLeagueToDto,
} from '../../mappers';
import type { SportLeagueOverviewService } from '../sport-catalog/sport-league-overview';
import type { SportLeagueService } from '../sport-catalog/sport-league-service';

type SportLeagueParams = { Params: { sportLeagueId: string } };

/**
 * Service errors carry their own code and status; the global error handler sends them. `lists`
 * keeps the public list by its filters (#1181); the routes clear it on every write.
 */
export function createSportLeagueHandlers(
  sportLeagues: SportLeagueService,
  lists: ReadCache<SportLeagueListResponse>,
  overviews: SportLeagueOverviewService,
) {
  return {
    listSportLeagueOverviews: async (): Promise<SportLeagueOverviewListResponse> => {
      const rows = await overviews.listOverviews();
      return { sportLeagues: rows.map(mapSportLeagueOverviewToDto) };
    },

    listSportLeagues: async (request: FastifyRequest<{ Querystring: SportLeagueListQuery }>): Promise<SportLeagueListResponse> => {
      const { sport, isActive } = request.query;
      return lists.get(`${sport ?? ''}:${isActive ?? ''}`, new Date(), async () => {
        const rows = await sportLeagues.listSportLeagues({ sport, isActive });
        return { sportLeagues: rows.map(mapSportLeagueToDto) };
      });
    },

    getSportLeague: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const sportLeague = await sportLeagues.getSportLeague(request.params.sportLeagueId);
      if (!sportLeague) {
        return sendError(reply, 404, 'SPORT_LEAGUE_NOT_FOUND', `Sport league ${request.params.sportLeagueId} was not found.`);
      }
      return { sportLeague: mapSportLeagueToDto(sportLeague) } satisfies SportLeagueResponse;
    },

    createSportLeague: async (request: FastifyRequest<{ Body: CreateSportLeagueRequest }>, reply: FastifyReply) => {
      const { sport, ...input } = request.body;
      const sportLeague = await sportLeagues.createSportLeague(sport, input);
      return reply.status(201).send({ sportLeague: mapSportLeagueToDto(sportLeague) } satisfies SportLeagueResponse);
    },

    updateSportLeague: async (request: FastifyRequest<SportLeagueParams & { Body: UpdateSportLeagueRequest }>): Promise<SportLeagueResponse> => {
      const sportLeague = await sportLeagues.updateSportLeague(request.params.sportLeagueId, request.body);
      return { sportLeague: mapSportLeagueToDto(sportLeague) };
    },

    deleteSportLeague: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      await sportLeagues.deleteSportLeague(request.params.sportLeagueId);
      return reply.status(204).send();
    },

    listParticipants: async (request: FastifyRequest<SportLeagueParams>): Promise<ParticipantListResponse> => {
      const participants = await sportLeagues.listParticipants(request.params.sportLeagueId);
      return { participants: participants.map(mapParticipantToDto) };
    },

    updateParticipantRankings: async (
      request: FastifyRequest<SportLeagueParams & { Body: SportLeagueParticipantRankingsRequest }>,
    ): Promise<ParticipantListResponse> => {
      const participants = await sportLeagues.updateRankings(request.params.sportLeagueId, request.body.rankings);
      return { participants: participants.map(mapParticipantToDto) };
    },

    previewRankingUpload: async (
      request: FastifyRequest<SportLeagueParams & { Body: SportLeagueRankingUploadRequest }>,
    ): Promise<SportLeagueRankingUploadPreviewResponse> => {
      const rows = await sportLeagues.previewRankingUpload(request.params.sportLeagueId, request.body.rows);
      return { rows: rows.map(mapRankingUploadPreviewRowToDto) };
    },

    applyRankingUpload: async (
      request: FastifyRequest<SportLeagueParams & { Body: SportLeagueRankingUploadRequest }>,
    ): Promise<ParticipantListResponse> => {
      const participants = await sportLeagues.applyRankingUpload(request.params.sportLeagueId, request.body.rows);
      return { participants: participants.map(mapParticipantToDto) };
    },
  };
}
