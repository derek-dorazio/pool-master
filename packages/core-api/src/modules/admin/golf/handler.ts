import type { FastifyReply, FastifyRequest } from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
import type {
  AdminAddGolfLeagueRosterEntryRequest,
  AdminAutoAssignGolfPricesRequest,
  AdminAutoAssignGolfTiersRequest,
  AdminBulkAddGolfFieldEntriesRequest,
  AdminCreateGolfLeagueRequest,
  AdminCreateGolfSeasonRequest,
  AdminCreateGolfTournamentRequest,
  AdminGolfLeagueListQuery,
  AdminGolfLeagueRosterUploadRequest,
  AdminGolfSeasonListQuery,
  AdminGolfTournamentListQuery,
  AdminLinkGolfTournamentScoreSourceRequest,
  AdminReplaceGolfTierAssignmentsRequest,
  AdminReplaceGolfTournamentTiersRequest,
  AdminTransitionGolfTournamentRequest,
  AdminUpdateGolfFieldEntriesRequest,
  AdminUpdateGolfLeagueRequest,
  AdminUpdateGolfLeagueRosterRequest,
  AdminUpdateGolfSeasonRequest,
  AdminUpdateGolfTournamentRequest,
  AdminUpdateGolfTournamentRoundsRequest,
} from '@poolmaster/shared/dto';
import {
  toAdminGolfFieldEntryDtoList,
  toAdminGolfLeagueDto,
  toAdminGolfLeagueRosterEntryDto,
  toAdminGolfLeagueRosterEntryDtoList,
  toAdminGolfLeagueRosterUploadPreviewRowDtoList,
  toAdminGolfLeagueSummaryDtoList,
  toAdminGolfSeasonDetailDto,
  toAdminGolfSeasonDto,
  toAdminGolfSeasonSummaryDtoList,
  toAdminGolfTierGroupDtoList,
  toAdminGolfTournamentDetailDto,
  toAdminGolfTournamentDtoList,
  toAdminGolfTournamentRoundDtoList,
  toGolfFieldEntriesUpdateInput,
  toGolfRoundScheduleUpdateInput,
} from '../../../mappers';
import { sendError } from '../../../core/error-handler';
import type { SportLeagueService } from '../../sport-catalog/sport-league-service';
import type { SeasonService } from '../../sport-catalog/season-service';
import { SportCatalogError } from '../../sport-catalog/errors';
import type { GolfRoundScheduleService } from '../../golf/golf-round-schedule-service';
import { GolfRoundScheduleError } from '../../golf/golf-round-schedule-service';
import type { GolfTournamentService } from '../../golf/golf-tournament-service';
import { GolfTournamentError } from '../../golf/golf-tournament-service';
import type { GolfFieldService } from '../../golf/golf-field-service';
import { GolfFieldError } from '../../golf/golf-field-service';
import type { GolfTierService } from '../../golf/golf-tier-service';
import { GolfTierError } from '../../golf/golf-tier-service';
import type { EventLifecycleService } from '../../events/event-lifecycle-service';
import { EventLifecycleError } from '../../events/event-lifecycle-service';
import type { EventScoreSourceService } from '../../events/event-score-source-service';
import { EventScoreSourceError } from '../../events/event-score-source-service';
import { extractRootAdminContext } from '../request-admin-context';

export function createGolfAdminHandlers(
  sportLeagueService: SportLeagueService,
  seasonService: SeasonService,
  golfRoundScheduleService: GolfRoundScheduleService,
  golfTournamentService: GolfTournamentService,
  eventLifecycleService: EventLifecycleService,
  golfFieldService: GolfFieldService,
  golfTierService: GolfTierService,
  eventScoreSourceService: EventScoreSourceService,
) {
  return {
    listLeagues,
    createLeague,
    updateLeague,
    getLeagueRoster,
    addLeagueRosterEntry,
    removeLeagueRosterEntry,
    updateLeagueRoster,
    previewLeagueRosterUpload,
    applyLeagueRosterUpload,
    listSeasons,
    createSeason,
    getSeason,
    updateSeason,
    setCurrentSeason,
    getTournamentRounds,
    updateTournamentRounds,
    listTournaments,
    createTournament,
    getTournament,
    updateTournament,
    deleteTournament,
    transitionTournament,
    linkTournamentScoreSource,
    unlinkTournamentScoreSource,
    getTournamentField,
    seedTournamentField,
    bulkAddFieldEntries,
    updateFieldEntries,
    removeFieldEntry,
    getTournamentTiers,
    replaceTournamentTiers,
    autoAssignTournamentTiers,
    replaceTournamentTierAssignments,
    autoAssignTournamentPrices,
  };

  async function listLeagues(
    request: FastifyRequest<{ Querystring: AdminGolfLeagueListQuery }>,
    reply: FastifyReply,
  ) {
    const leagues = await sportLeagueService.listLeagues(Sport.GOLF, { isActive: request.query.isActive });
    return reply.send({ leagues: toAdminGolfLeagueSummaryDtoList(leagues) });
  }

  async function createLeague(
    request: FastifyRequest<{ Body: AdminCreateGolfLeagueRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const league = await sportLeagueService.createLeague(Sport.GOLF, request.body);
      return reply.status(201).send({ league: toAdminGolfLeagueDto(league) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function updateLeague(
    request: FastifyRequest<{ Params: { leagueId: string }; Body: AdminUpdateGolfLeagueRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const league = await sportLeagueService.updateLeague(request.params.leagueId, request.body);
      return reply.send({ league: toAdminGolfLeagueDto(league) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function getLeagueRoster(
    request: FastifyRequest<{ Params: { leagueId: string } }>,
    reply: FastifyReply,
  ) {
    const entries = await sportLeagueService.getRoster(request.params.leagueId);
    return reply.send({ entries: toAdminGolfLeagueRosterEntryDtoList(entries) });
  }

  async function addLeagueRosterEntry(
    request: FastifyRequest<{ Params: { leagueId: string }; Body: AdminAddGolfLeagueRosterEntryRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const entry = await sportLeagueService.addRosterEntry(request.params.leagueId, request.body.participantId);
      return reply.status(201).send({ entry: toAdminGolfLeagueRosterEntryDto(entry) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function removeLeagueRosterEntry(
    request: FastifyRequest<{ Params: { leagueId: string; participantId: string } }>,
    reply: FastifyReply,
  ) {
    await sportLeagueService.removeRosterEntry(request.params.leagueId, request.params.participantId);
    return reply.status(204).send();
  }

  async function updateLeagueRoster(
    request: FastifyRequest<{ Params: { leagueId: string }; Body: AdminUpdateGolfLeagueRosterRequest }>,
    reply: FastifyReply,
  ) {
    const entries = await sportLeagueService.bulkUpdateRoster(request.params.leagueId, request.body.entries);
    return reply.send({ entries: toAdminGolfLeagueRosterEntryDtoList(entries) });
  }

  async function previewLeagueRosterUpload(
    request: FastifyRequest<{ Params: { leagueId: string }; Body: AdminGolfLeagueRosterUploadRequest }>,
    reply: FastifyReply,
  ) {
    const rows = await sportLeagueService.previewRosterUpload(request.params.leagueId, request.body.rows);
    return reply.send({ rows: toAdminGolfLeagueRosterUploadPreviewRowDtoList(rows) });
  }

  async function applyLeagueRosterUpload(
    request: FastifyRequest<{ Params: { leagueId: string }; Body: AdminGolfLeagueRosterUploadRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const entries = await sportLeagueService.applyRosterUpload(request.params.leagueId, request.body.rows);
      return reply.send({ entries: toAdminGolfLeagueRosterEntryDtoList(entries) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function listSeasons(
    request: FastifyRequest<{ Querystring: AdminGolfSeasonListQuery }>,
    reply: FastifyReply,
  ) {
    const seasons = await seasonService.listSeasons(Sport.GOLF, {
      isActive: request.query.isActive,
      sportLeagueId: request.query.sportLeagueId,
    });
    return reply.send({ seasons: toAdminGolfSeasonSummaryDtoList(seasons) });
  }

  async function createSeason(
    request: FastifyRequest<{ Body: AdminCreateGolfSeasonRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const season = await seasonService.createSeason({
        ...request.body,
        startDate: new Date(request.body.startDate),
        endDate: new Date(request.body.endDate),
      });
      return reply.status(201).send({ season: toAdminGolfSeasonDto(season) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function getSeason(
    request: FastifyRequest<{ Params: { seasonId: string } }>,
    reply: FastifyReply,
  ) {
    const season = await seasonService.getSeason(request.params.seasonId);
    if (!season) {
      return sendError(reply, 404, 'SEASON_NOT_FOUND', `Season ${request.params.seasonId} was not found.`);
    }
    return reply.send({ season: toAdminGolfSeasonDetailDto(season) });
  }

  async function updateSeason(
    request: FastifyRequest<{ Params: { seasonId: string }; Body: AdminUpdateGolfSeasonRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const season = await seasonService.updateSeason(request.params.seasonId, {
        ...request.body,
        startDate: request.body.startDate ? new Date(request.body.startDate) : undefined,
        endDate: request.body.endDate ? new Date(request.body.endDate) : undefined,
      });
      return reply.send({ season: toAdminGolfSeasonDto(season) });
    } catch (err) {
      return handleSportCatalogError(err, reply);
    }
  }

  async function setCurrentSeason(
    request: FastifyRequest<{ Params: { seasonId: string } }>,
    reply: FastifyReply,
  ) {
    const result = await seasonService.setCurrentSeason(request.params.seasonId);
    return reply.send(result);
  }

  async function getTournamentRounds(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    const rounds = await golfRoundScheduleService.listSportEventRounds(request.params.eventId);
    return reply.send({ rounds: toAdminGolfTournamentRoundDtoList(rounds) });
  }

  async function updateTournamentRounds(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminUpdateGolfTournamentRoundsRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const rounds = await golfRoundScheduleService.updateSportEventRounds(
        request.params.eventId,
        toGolfRoundScheduleUpdateInput(request.body.rounds),
      );
      return reply.send({ rounds: toAdminGolfTournamentRoundDtoList(rounds) });
    } catch (err) {
      if (err instanceof GolfRoundScheduleError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
  }

  async function listTournaments(
    request: FastifyRequest<{ Querystring: AdminGolfTournamentListQuery }>,
    reply: FastifyReply,
  ) {
    const tournaments = await golfTournamentService.listTournaments({
      status: request.query.status,
      search: request.query.search,
    });
    return reply.send({ tournaments: toAdminGolfTournamentDtoList(tournaments) });
  }

  async function createTournament(
    request: FastifyRequest<{ Body: AdminCreateGolfTournamentRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const tournament = await golfTournamentService.createTournament({
        ...request.body,
        startDate: new Date(request.body.startDate),
        endDate: request.body.endDate ? new Date(request.body.endDate) : undefined,
        releaseAt: new Date(request.body.releaseAt),
        fieldLocksAt: new Date(request.body.fieldLocksAt),
      });
      const allowedTransitions = golfTournamentService.getAllowedTransitions(tournament.status);
      return reply.status(201).send({ tournament: toAdminGolfTournamentDetailDto(tournament, allowedTransitions) });
    } catch (err) {
      return handleGolfTournamentError(err, reply);
    }
  }

  async function getTournament(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    const tournament = await golfTournamentService.getTournament(request.params.eventId);
    if (!tournament) {
      return sendError(reply, 404, 'EVENT_NOT_FOUND', `Golf tournament ${request.params.eventId} was not found.`);
    }
    const allowedTransitions = golfTournamentService.getAllowedTransitions(tournament.status);
    return reply.send({ tournament: toAdminGolfTournamentDetailDto(tournament, allowedTransitions) });
  }

  async function updateTournament(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminUpdateGolfTournamentRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const tournament = await golfTournamentService.updateTournament(request.params.eventId, {
        ...request.body,
        startDate: request.body.startDate ? new Date(request.body.startDate) : undefined,
        endDate: request.body.endDate ? new Date(request.body.endDate) : undefined,
        releaseAt: request.body.releaseAt ? new Date(request.body.releaseAt) : undefined,
        fieldLocksAt: request.body.fieldLocksAt ? new Date(request.body.fieldLocksAt) : undefined,
      });
      const allowedTransitions = golfTournamentService.getAllowedTransitions(tournament.status);
      return reply.send({ tournament: toAdminGolfTournamentDetailDto(tournament, allowedTransitions) });
    } catch (err) {
      return handleGolfTournamentError(err, reply);
    }
  }

  async function deleteTournament(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await golfTournamentService.deleteTournament(request.params.eventId);
      return reply.status(204).send();
    } catch (err) {
      return handleGolfTournamentError(err, reply);
    }
  }

  async function transitionTournament(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminTransitionGolfTournamentRequest }>,
    reply: FastifyReply,
  ) {
    const { rootAdminUserId, rootAdminEmail } = extractRootAdminContext(request);
    try {
      await eventLifecycleService.applySportEventStatusTransition({
        sportEventId: request.params.eventId,
        toStatus: request.body.toStatus,
        actor: { type: 'ROOT_ADMIN', userId: rootAdminUserId, email: rootAdminEmail },
      });
    } catch (err) {
      if (err instanceof EventLifecycleError) {
        return sendError(reply, err.statusCode, err.code, err.message);
      }
      throw err;
    }
    return respondWithReloadedTournament(request.params.eventId, reply);
  }

  async function linkTournamentScoreSource(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminLinkGolfTournamentScoreSourceRequest }>,
    reply: FastifyReply,
  ) {
    try {
      await eventScoreSourceService.linkScoreSource(request.params.eventId, request.body);
    } catch (err) {
      return handleEventScoreSourceError(err, reply);
    }
    return respondWithReloadedTournament(request.params.eventId, reply);
  }

  async function unlinkTournamentScoreSource(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await eventScoreSourceService.unlinkScoreSource(request.params.eventId);
    } catch (err) {
      return handleEventScoreSourceError(err, reply);
    }
    return respondWithReloadedTournament(request.params.eventId, reply);
  }

  /** Shared by every write that mutates a tournament in place and then re-sends the canonical detail DTO. */
  async function respondWithReloadedTournament(eventId: string, reply: FastifyReply) {
    const tournament = await golfTournamentService.getTournament(eventId);
    if (!tournament) {
      return sendError(reply, 404, 'EVENT_NOT_FOUND', `Golf tournament ${eventId} was not found.`);
    }
    const allowedTransitions = golfTournamentService.getAllowedTransitions(tournament.status);
    return reply.send({ tournament: toAdminGolfTournamentDetailDto(tournament, allowedTransitions) });
  }

  async function getTournamentField(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    const entries = await golfFieldService.listField(request.params.eventId);
    return reply.send({ entries: toAdminGolfFieldEntryDtoList(entries) });
  }

  async function seedTournamentField(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      const result = await golfFieldService.seedFieldFromLeagueRoster(request.params.eventId);
      return reply.send(result);
    } catch (err) {
      return handleGolfFieldError(err, reply);
    }
  }

  async function bulkAddFieldEntries(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminBulkAddGolfFieldEntriesRequest }>,
    reply: FastifyReply,
  ) {
    const result = await golfFieldService.bulkAddFieldEntries(request.params.eventId, request.body.participantIds);
    return reply.send(result);
  }

  async function updateFieldEntries(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminUpdateGolfFieldEntriesRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const entries = await golfFieldService.bulkUpdateFieldEntries(
        request.params.eventId,
        toGolfFieldEntriesUpdateInput(request.body.entries),
      );
      return reply.send({ entries: toAdminGolfFieldEntryDtoList(entries) });
    } catch (err) {
      return handleGolfFieldError(err, reply);
    }
  }

  async function removeFieldEntry(
    request: FastifyRequest<{ Params: { eventId: string; sportEventParticipantId: string } }>,
    reply: FastifyReply,
  ) {
    try {
      await golfFieldService.removeFieldEntry(request.params.eventId, request.params.sportEventParticipantId);
      return reply.status(204).send();
    } catch (err) {
      return handleGolfFieldError(err, reply);
    }
  }

  async function getTournamentTiers(
    request: FastifyRequest<{ Params: { eventId: string } }>,
    reply: FastifyReply,
  ) {
    const tiers = await golfTierService.getEffectiveTiersForSportEvent(request.params.eventId);
    return reply.send({ tiers: toAdminGolfTierGroupDtoList(tiers) });
  }

  async function replaceTournamentTiers(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminReplaceGolfTournamentTiersRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const tiers = await golfTierService.replaceGolfTournamentTiers({
        sportEventId: request.params.eventId,
        tiers: request.body.tiers,
        reassignOrphansTo: request.body.reassignOrphansTo,
      });
      return reply.send({ tiers: toAdminGolfTierGroupDtoList(tiers) });
    } catch (err) {
      return handleGolfTierError(err, reply);
    }
  }

  async function autoAssignTournamentTiers(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminAutoAssignGolfTiersRequest }>,
    reply: FastifyReply,
  ) {
    const tiers = await golfTierService.autoAssignGolfTiers({
      sportEventId: request.params.eventId,
      source: request.body.source,
      tierSize: request.body.tierSize,
    });
    return reply.send({ tiers: toAdminGolfTierGroupDtoList(tiers) });
  }

  async function replaceTournamentTierAssignments(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminReplaceGolfTierAssignmentsRequest }>,
    reply: FastifyReply,
  ) {
    try {
      const tiers = await golfTierService.replaceGolfTierAssignments({
        sportEventId: request.params.eventId,
        assignments: request.body.assignments,
      });
      return reply.send({ tiers: toAdminGolfTierGroupDtoList(tiers) });
    } catch (err) {
      return handleGolfTierError(err, reply);
    }
  }

  async function autoAssignTournamentPrices(
    request: FastifyRequest<{ Params: { eventId: string }; Body: AdminAutoAssignGolfPricesRequest }>,
    reply: FastifyReply,
  ) {
    await golfTierService.autoAssignGolfPrices({
      sportEventId: request.params.eventId,
      minPrice: request.body.minPrice,
      maxPrice: request.body.maxPrice,
    });
    const tiers = await golfTierService.getEffectiveTiersForSportEvent(request.params.eventId);
    return reply.send({ tiers: toAdminGolfTierGroupDtoList(tiers) });
  }
}

function handleSportCatalogError(err: unknown, reply: FastifyReply) {
  if (err instanceof SportCatalogError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  throw err;
}

function handleGolfTournamentError(err: unknown, reply: FastifyReply) {
  if (err instanceof GolfTournamentError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  if (err instanceof SportCatalogError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  throw err;
}

function handleGolfFieldError(err: unknown, reply: FastifyReply) {
  if (err instanceof GolfFieldError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  throw err;
}

function handleGolfTierError(err: unknown, reply: FastifyReply) {
  if (err instanceof GolfTierError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  throw err;
}

function handleEventScoreSourceError(err: unknown, reply: FastifyReply) {
  if (err instanceof EventScoreSourceError) {
    return sendError(reply, err.statusCode, err.code, err.message);
  }
  throw err;
}
