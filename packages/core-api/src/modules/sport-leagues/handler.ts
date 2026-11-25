import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  CreateTestSlotRequest,
  SportLeagueListQuery,
  SportLeagueParticipantListQuery,
  SportLeagueListResponse,
  SportLeagueParticipantRankingsRequest,
  SportLeagueRankingUploadPreviewResponse,
  SportLeagueRankingUploadRequest,
  SportLeagueEventOverviewListResponse,
  SportLeagueOverviewListResponse,
  SportLeagueParticipantOverviewListResponse,
  SportLeaguePositionListResponse,
  SportLeagueResponse,
  SportLeagueSeasonListResponse,
  SportLeagueSeasonSlotResponse,
  SportLeagueStructureResponse,
  SportLeagueSyncListResponse,
  UpdateSportLeagueRequest,
} from '@poolmaster/shared/dto/sport-catalog.dto';
import type { ParticipantListResponse } from '@poolmaster/shared/dto/participants.dto';
import { sendError } from '../../core/error-handler';
import type { ReadCache } from '../../core/read-cache';
import {
  mapParticipantToDto,
  mapRankingUploadPreviewRowToDto,
  mapSportLeagueEventOverviewToDto,
  mapSportLeagueOverviewToDto,
  mapSportLeagueParticipantOverviewToDto,
  mapSportLeagueSeasonSlotToDto,
  mapSportLeagueSeasonToDto,
  mapSportLeaguePositionToDto,
  mapSportLeagueStructureToDto,
  mapSportLeagueSyncToDto,
  mapSportLeagueToDto,
} from '../../mappers';
import type { SportLeaguePageService } from '../sport-catalog/sport-league-page';
import type { SportLeagueOverviewService } from '../sport-catalog/sport-league-overview';
import type { SportLeagueService } from '../sport-catalog/sport-league-service';

type SportLeagueParams = { Params: { sportLeagueId: string } };

/**
 * Service errors carry their own code and status; the global error handler sends them. `lists`
 * keeps the public list by its filters (#1181); the routes clear it on every write.
 */
export function buildSportLeagueHandlers(
  sportLeagues: SportLeagueService,
  lists: ReadCache<SportLeagueListResponse>,
  overviews: SportLeagueOverviewService,
  page: SportLeaguePageService,
) {
  const notFound = (reply: FastifyReply, sportLeagueId: string) => sendError(reply, 404, 'SPORT_LEAGUE_NOT_FOUND', `Sport league ${sportLeagueId} was not found.`);
  return {
    listSyncs: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const syncs = await page.listSyncs(request.params.sportLeagueId);
      if (syncs === null) return notFound(reply, request.params.sportLeagueId);
      return { syncs: syncs.map(mapSportLeagueSyncToDto) } satisfies SportLeagueSyncListResponse;
    },

    listPositions: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const positions = await page.listPositions(request.params.sportLeagueId);
      if (positions === null) return notFound(reply, request.params.sportLeagueId);
      return { positions: positions.map(mapSportLeaguePositionToDto) } satisfies SportLeaguePositionListResponse;
    },

    listEventOverviews: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const events = await page.listEvents(request.params.sportLeagueId);
      if (events === null) return notFound(reply, request.params.sportLeagueId);
      return { events: events.map(mapSportLeagueEventOverviewToDto) } satisfies SportLeagueEventOverviewListResponse;
    },

    listParticipantOverviews: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const participants = await page.listParticipants(request.params.sportLeagueId);
      if (participants === null) return notFound(reply, request.params.sportLeagueId);
      return { participants: participants.map(mapSportLeagueParticipantOverviewToDto) } satisfies SportLeagueParticipantOverviewListResponse;
    },

    getStructure: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const structure = await page.getStructure(request.params.sportLeagueId);
      if (structure === null) return notFound(reply, request.params.sportLeagueId);
      return mapSportLeagueStructureToDto(structure) satisfies SportLeagueStructureResponse;
    },

    listSeasons: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      const seasons = await page.listSeasons(request.params.sportLeagueId);
      if (seasons === null) return notFound(reply, request.params.sportLeagueId);
      return { seasons: seasons.map(mapSportLeagueSeasonToDto) } satisfies SportLeagueSeasonListResponse;
    },

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

    createTestSlot: async (request: FastifyRequest<SportLeagueParams & { Body: CreateTestSlotRequest }>, reply: FastifyReply) => {
      const { startsAt, endsAt, ...input } = request.body;
      const slot = await sportLeagues.createTestSlot(request.params.sportLeagueId, { ...input, startsAt: new Date(startsAt), endsAt: endsAt === undefined ? null : new Date(endsAt) });
      return reply.status(201).send({ slot: mapSportLeagueSeasonSlotToDto(slot) } satisfies SportLeagueSeasonSlotResponse);
    },

    deleteTestSlot: async (request: FastifyRequest<{ Params: { sportLeagueId: string; seasonSlotId: string } }>, reply: FastifyReply) => {
      await sportLeagues.deleteTestSlot(request.params.sportLeagueId, request.params.seasonSlotId);
      return reply.status(204).send();
    },

    updateSportLeague: async (request: FastifyRequest<SportLeagueParams & { Body: UpdateSportLeagueRequest }>): Promise<SportLeagueResponse> => {
      const sportLeague = await sportLeagues.updateSportLeague(request.params.sportLeagueId, request.body);
      return { sportLeague: mapSportLeagueToDto(sportLeague) };
    },

    deleteSportLeague: async (request: FastifyRequest<SportLeagueParams>, reply: FastifyReply) => {
      await sportLeagues.deleteSportLeague(request.params.sportLeagueId);
      return reply.status(204).send();
    },

    listParticipants: async (
      request: FastifyRequest<SportLeagueParams & { Querystring: SportLeagueParticipantListQuery }>,
    ): Promise<ParticipantListResponse> => {
      const participants = await sportLeagues.listParticipants(request.params.sportLeagueId, request.query.testData ?? false);
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
