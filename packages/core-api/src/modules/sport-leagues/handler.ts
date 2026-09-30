import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateParticipantLeagueAffiliationRequest,
  CreateSeasonRequest,
  CreateSportLeagueRequest,
  ParticipantLeagueAffiliationListResponse,
  ParticipantLeagueAffiliationResponse,
  ParticipantLeagueAffiliationUploadPreviewResponse,
  ParticipantLeagueAffiliationUploadRequest,
  SeasonListQuery,
  SeasonListResponse,
  SportLeagueListQuery,
  SportLeagueListResponse,
  SportLeagueResponse,
  UpdateParticipantLeagueAffiliationRankingsRequest,
  UpdateSportLeagueRequest,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import { sendError } from '../../core/error-handler';
import {
  mapAffiliationToDto,
  mapAffiliationUploadPreviewRowToDto,
  mapSeasonToDto,
  mapSportLeagueToDto,
} from '../../mappers';
import type { SeasonService } from '../sport-catalog/season-service';
import type { SportLeagueService } from '../sport-catalog/sport-league-service';

type SportLeagueParams = { Params: { sportLeagueId: string } };

/** Service errors carry their own code and status; the global error handler sends them. */
export function createSportLeagueHandlers(sportLeagues: SportLeagueService, seasons: SeasonService) {
  return {
    listSportLeagues: async (request: FastifyRequest<{ Querystring: SportLeagueListQuery }>): Promise<SportLeagueListResponse> => {
      const rows = await sportLeagues.listSportLeagues({ sport: request.query.sport, isActive: request.query.isActive });
      return { sportLeagues: rows.map(mapSportLeagueToDto) };
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

    listAffiliations: async (request: FastifyRequest<SportLeagueParams>): Promise<ParticipantLeagueAffiliationListResponse> => {
      const affiliations = await sportLeagues.listAffiliations(request.params.sportLeagueId);
      return { affiliations: affiliations.map(mapAffiliationToDto) };
    },

    createAffiliation: async (
      request: FastifyRequest<SportLeagueParams & { Body: CreateParticipantLeagueAffiliationRequest }>,
      reply: FastifyReply,
    ) => {
      const affiliation = await sportLeagues.addAffiliation(request.params.sportLeagueId, request.body.participantId);
      return reply.status(201).send({ affiliation: mapAffiliationToDto(affiliation) } satisfies ParticipantLeagueAffiliationResponse);
    },

    deleteAffiliation: async (
      request: FastifyRequest<{ Params: { sportLeagueId: string; participantId: string } }>,
      reply: FastifyReply,
    ) => {
      await sportLeagues.removeAffiliation(request.params.sportLeagueId, request.params.participantId);
      return reply.status(204).send();
    },

    updateAffiliationRankings: async (
      request: FastifyRequest<SportLeagueParams & { Body: UpdateParticipantLeagueAffiliationRankingsRequest }>,
    ): Promise<ParticipantLeagueAffiliationListResponse> => {
      const affiliations = await sportLeagues.updateRankings(request.params.sportLeagueId, request.body.rankings);
      return { affiliations: affiliations.map(mapAffiliationToDto) };
    },

    previewAffiliationUpload: async (
      request: FastifyRequest<SportLeagueParams & { Body: ParticipantLeagueAffiliationUploadRequest }>,
    ): Promise<ParticipantLeagueAffiliationUploadPreviewResponse> => {
      const rows = await sportLeagues.previewAffiliationUpload(request.params.sportLeagueId, request.body.rows);
      return { rows: rows.map(mapAffiliationUploadPreviewRowToDto) };
    },

    applyAffiliationUpload: async (
      request: FastifyRequest<SportLeagueParams & { Body: ParticipantLeagueAffiliationUploadRequest }>,
    ): Promise<ParticipantLeagueAffiliationListResponse> => {
      const affiliations = await sportLeagues.applyAffiliationUpload(request.params.sportLeagueId, request.body.rows);
      return { affiliations: affiliations.map(mapAffiliationToDto) };
    },

    listSeasons: async (request: FastifyRequest<SportLeagueParams & { Querystring: SeasonListQuery }>): Promise<SeasonListResponse> => {
      const rows = await seasons.listSeasons(request.params.sportLeagueId, { isActive: request.query.isActive });
      return { seasons: rows.map(mapSeasonToDto) };
    },

    createSeason: async (request: FastifyRequest<SportLeagueParams & { Body: CreateSeasonRequest }>, reply: FastifyReply) => {
      const created = await seasons.createSeason({
        sportLeagueId: request.params.sportLeagueId,
        name: request.body.name,
        year: request.body.year,
        startDate: new Date(request.body.startDate),
        endDate: new Date(request.body.endDate),
      });
      const season = await seasons.getSeason(created.id);
      return reply.status(201).send({ season: mapSeasonToDto(season as NonNullable<typeof season>) });
    },
  };
}
