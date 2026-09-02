/**
 * Admin Golf routes — golf league/season/roster CRUD, thin wrappers over the
 * cross-sport sport-catalog module scoped to Sport.GOLF (plans/124 §3.2/§5.2).
 * Registered as a sub-plugin under /api/v1/admin/sports/golf by adminModule,
 * so the adminAuth preHandler already covers it.
 */
import type { FastifyInstance } from 'fastify';
import {
  AdminAddGolfLeagueRosterEntryRequestSchema,
  AdminAutoAssignGolfPricesRequestSchema,
  AdminAutoAssignGolfTiersRequestSchema,
  AdminBulkAddGolfFieldEntriesRequestSchema,
  AdminBulkAddGolfFieldEntriesResponseSchema,
  AdminCreateGolfLeagueRequestSchema,
  AdminCreateGolfSeasonRequestSchema,
  AdminCreateGolfTournamentRequestSchema,
  AdminGolfFieldEntryParamsSchema,
  AdminGolfLeagueListQuerySchema,
  AdminGolfLeagueListResponseSchema,
  AdminGolfLeagueParamsSchema,
  AdminGolfLeagueRosterEntryParamsSchema,
  AdminGolfLeagueRosterResponseSchema,
  AdminGolfLeagueRosterUploadPreviewResponseSchema,
  AdminGolfLeagueRosterUploadRequestSchema,
  AdminGolfSeasonListQuerySchema,
  AdminGolfSeasonListResponseSchema,
  AdminGolfSeasonParamsSchema,
  AdminGolfTournamentDetailResponseSchema,
  AdminGolfTournamentFieldParamsSchema,
  AdminGolfTournamentFieldResponseSchema,
  AdminGolfTournamentListQuerySchema,
  AdminGolfTournamentListResponseSchema,
  AdminGolfTournamentParamsSchema,
  AdminGolfTournamentRoundsResponseSchema,
  AdminGolfTournamentTiersResponseSchema,
  AdminLinkGolfTournamentScoreSourceRequestSchema,
  AdminReplaceGolfTierAssignmentsRequestSchema,
  AdminReplaceGolfTournamentTiersRequestSchema,
  AdminSeedGolfTournamentFieldResponseSchema,
  AdminSetCurrentGolfSeasonResponseSchema,
  AdminTransitionGolfTournamentRequestSchema,
  AdminUpdateGolfFieldEntriesRequestSchema,
  AdminUpdateGolfLeagueRequestSchema,
  AdminUpdateGolfLeagueRosterRequestSchema,
  AdminUpdateGolfSeasonRequestSchema,
  AdminUpdateGolfTournamentRequestSchema,
  AdminUpdateGolfTournamentRoundsRequestSchema,
  zodToJsonSchema,
} from '@poolmaster/shared/dto';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { z } from 'zod';
import {
  AdminGolfLeagueDtoSchema,
  AdminGolfLeagueRosterEntryDtoSchema,
  AdminGolfSeasonDetailDtoSchema,
  AdminGolfSeasonDtoSchema,
} from '@poolmaster/shared/dto';
import type { SportLeagueService } from '../../sport-catalog/sport-league-service';
import type { SeasonService } from '../../sport-catalog/season-service';
import type { GolfRoundScheduleService } from '../../golf/golf-round-schedule-service';
import type { GolfTournamentService } from '../../golf/golf-tournament-service';
import type { GolfFieldService } from '../../golf/golf-field-service';
import type { GolfTierService } from '../../golf/golf-tier-service';
import type { EventLifecycleService } from '../../events/event-lifecycle-service';
import type { EventScoreSourceService } from '../../events/event-score-source-service';
import { createGolfAdminHandlers } from './handler';

function withGolfErrorResponses(
  successResponses: Record<number, unknown>,
  extraErrorStatuses: number[] = [],
): Record<number, unknown> {
  return {
    ...successResponses,
    401: zodToJsonSchema(ErrorEnvelopeSchema),
    ...Object.fromEntries(extraErrorStatuses.map((status) => [status, zodToJsonSchema(ErrorEnvelopeSchema)])),
  };
}

export interface GolfAdminRoutesOptions {
  sportLeagueService: SportLeagueService;
  seasonService: SeasonService;
  golfRoundScheduleService: GolfRoundScheduleService;
  golfTournamentService: GolfTournamentService;
  eventLifecycleService: EventLifecycleService;
  golfFieldService: GolfFieldService;
  golfTierService: GolfTierService;
  eventScoreSourceService: EventScoreSourceService;
}

export async function golfAdminRoutes(
  fastify: FastifyInstance,
  opts: GolfAdminRoutesOptions,
): Promise<void> {
  const handlers = createGolfAdminHandlers(
    opts.sportLeagueService,
    opts.seasonService,
    opts.golfRoundScheduleService,
    opts.golfTournamentService,
    opts.eventLifecycleService,
    opts.golfFieldService,
    opts.golfTierService,
    opts.eventScoreSourceService,
  );

  fastify.get('/leagues', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'List golf leagues',
      description: 'Returns golf SportLeague rows with roster size and season count — the global list by league.',
      operationId: 'adminListGolfLeagues',
      querystring: zodToJsonSchema(AdminGolfLeagueListQuerySchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfLeagueListResponseSchema) }),
    },
    handler: handlers.listLeagues,
  });

  fastify.post('/leagues', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Create a golf league',
      description: 'Creates a new golf SportLeague (tour), e.g. adding "Champions Tour" — one call, not a migration.',
      operationId: 'adminCreateGolfLeague',
      body: zodToJsonSchema(AdminCreateGolfLeagueRequestSchema),
      response: withGolfErrorResponses(
        { 201: zodToJsonSchema(z.object({ league: AdminGolfLeagueDtoSchema })) },
        [409],
      ),
    },
    handler: handlers.createLeague,
  });

  fastify.patch('/leagues/:leagueId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Update a golf league',
      description: 'Renames a league, edits its matchKeyword, or deactivates it.',
      operationId: 'adminUpdateGolfLeague',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfLeagueRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(z.object({ league: AdminGolfLeagueDtoSchema })) }, [404]),
    },
    handler: handlers.updateLeague,
  });

  fastify.get('/leagues/:leagueId/roster', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get a golf league\'s roster',
      description: 'Returns the league\'s current, league-scoped (not season-scoped) roster.',
      operationId: 'adminGetGolfLeagueRoster',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfLeagueRosterResponseSchema) }),
    },
    handler: handlers.getLeagueRoster,
  });

  fastify.post('/leagues/:leagueId/roster', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Add a golfer to a league roster',
      description: 'Creates a ParticipantLeagueAffiliation row for one golfer.',
      operationId: 'adminAddGolfLeagueRosterEntry',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      body: zodToJsonSchema(AdminAddGolfLeagueRosterEntryRequestSchema),
      response: withGolfErrorResponses(
        { 201: zodToJsonSchema(z.object({ entry: AdminGolfLeagueRosterEntryDtoSchema })) },
        [409],
      ),
    },
    handler: handlers.addLeagueRosterEntry,
  });

  fastify.delete('/leagues/:leagueId/roster/:participantId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Remove a golfer from a league roster',
      description: 'Removes the affiliation row — a golfer leaving the tour entirely, distinct from retiring (Participant.status = INACTIVE).',
      operationId: 'adminRemoveGolfLeagueRosterEntry',
      params: zodToJsonSchema(AdminGolfLeagueRosterEntryParamsSchema),
      response: withGolfErrorResponses({ 204: { type: 'null' } }),
    },
    handler: handlers.removeLeagueRosterEntry,
  });

  fastify.patch('/leagues/:leagueId/roster', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Bulk-patch a golf league roster',
      description: 'Bulk row patch (worldRanking) — same shape as the tournament field bulk-patch.',
      operationId: 'adminUpdateGolfLeagueRoster',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfLeagueRosterRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfLeagueRosterResponseSchema) }),
    },
    handler: handlers.updateLeagueRoster,
  });

  fastify.post('/leagues/:leagueId/roster/preview', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Preview a golf league roster upload',
      description: 'Dry run. Resolves rows to existing Participants and reports unresolved ones — never silently creates a golfer record from an upload row.',
      operationId: 'adminPreviewGolfLeagueRosterUpload',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      body: zodToJsonSchema(AdminGolfLeagueRosterUploadRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfLeagueRosterUploadPreviewResponseSchema) }),
    },
    handler: handlers.previewLeagueRosterUpload,
  });

  fastify.post('/leagues/:leagueId/roster/apply', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Apply a golf league roster upload',
      description: 'Applies a previewed upload. 422 when any row is unresolved.',
      operationId: 'adminApplyGolfLeagueRosterUpload',
      params: zodToJsonSchema(AdminGolfLeagueParamsSchema),
      body: zodToJsonSchema(AdminGolfLeagueRosterUploadRequestSchema),
      response: withGolfErrorResponses(
        { 200: zodToJsonSchema(AdminGolfLeagueRosterResponseSchema) },
        [422],
      ),
    },
    handler: handlers.applyLeagueRosterUpload,
  });

  fastify.get('/seasons', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'List golf seasons',
      description: 'Global list by league and season — pass sportLeagueId to see just one league\'s seasons.',
      operationId: 'adminListGolfSeasons',
      querystring: zodToJsonSchema(AdminGolfSeasonListQuerySchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfSeasonListResponseSchema) }),
    },
    handler: handlers.listSeasons,
  });

  fastify.post('/seasons', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Create a golf season',
      description: 'Creates a season linked to a golf SportLeague. 409 SEASON_YEAR_ALREADY_EXISTS if that league already has a season for the given year.',
      operationId: 'adminCreateGolfSeason',
      body: zodToJsonSchema(AdminCreateGolfSeasonRequestSchema),
      response: withGolfErrorResponses(
        { 201: zodToJsonSchema(z.object({ season: AdminGolfSeasonDtoSchema })) },
        [409],
      ),
    },
    handler: handlers.createSeason,
  });

  fastify.get('/seasons/:seasonId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get golf season detail',
      description: 'Season detail + tournament count + isCurrent (derived from the parent league\'s currentSeasonId).',
      operationId: 'adminGetGolfSeason',
      params: zodToJsonSchema(AdminGolfSeasonParamsSchema),
      response: withGolfErrorResponses(
        { 200: zodToJsonSchema(z.object({ season: AdminGolfSeasonDetailDtoSchema })) },
        [404],
      ),
    },
    handler: handlers.getSeason,
  });

  fastify.patch('/seasons/:seasonId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Update a golf season',
      operationId: 'adminUpdateGolfSeason',
      params: zodToJsonSchema(AdminGolfSeasonParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfSeasonRequestSchema),
      response: withGolfErrorResponses(
        { 200: zodToJsonSchema(z.object({ season: AdminGolfSeasonDtoSchema })) },
        [404],
      ),
    },
    handler: handlers.updateSeason,
  });

  fastify.post('/seasons/:seasonId/set-current', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Set a season as its league\'s current season',
      description: 'A single atomic write on the parent SportLeague row — no window where a league has zero or two current seasons.',
      operationId: 'adminSetCurrentGolfSeason',
      params: zodToJsonSchema(AdminGolfSeasonParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminSetCurrentGolfSeasonResponseSchema) }, [404]),
    },
    handler: handlers.setCurrentSeason,
  });

  fastify.get('/tournaments/:eventId/rounds', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get a tournament\'s round schedule',
      description: 'The SportEventRound schedule rows (plans/124 §4.10) — round number, scheduled date, scheduled end. Ordered by roundNumber ascending, not by date.',
      operationId: 'adminGetGolfTournamentRounds',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentRoundsResponseSchema) }),
    },
    handler: handlers.getTournamentRounds,
  });

  fastify.patch('/tournaments/:eventId/rounds', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Reschedule a tournament\'s rounds',
      description: 'Bulk row patch — how a rain delay or an irregular schedule gets recorded. Only reschedules existing rounds; 404 ROUND_NOT_FOUND for a roundNumber this event has no row for.',
      operationId: 'adminUpdateGolfTournamentRounds',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfTournamentRoundsRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentRoundsResponseSchema) }, [404]),
    },
    handler: handlers.updateTournamentRounds,
  });

  fastify.get('/tournaments', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'List golf tournaments',
      description: 'Filters: status, search (case-insensitive name substring). Returns the canonical AdminGolfTournamentDto per row.',
      operationId: 'adminListGolfTournaments',
      querystring: zodToJsonSchema(AdminGolfTournamentListQuerySchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentListResponseSchema) }),
    },
    handler: handlers.listTournaments,
  });

  fastify.post('/tournaments', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Create a manual golf tournament',
      description: 'Server assigns providerId=manual-admin, a generated externalId, status=SCHEDULED, syncScope=NONE; creates the round schedule (ensureSportEventRounds), default tiers (ensureDefaultGolfTiers), and resolves/creates the LeagueEvent identity by (sportLeagueId, name). 422 SEASON_SPORT_MISMATCH if seasonId resolves to a non-golf season.',
      operationId: 'adminCreateGolfTournament',
      body: zodToJsonSchema(AdminCreateGolfTournamentRequestSchema),
      response: withGolfErrorResponses({ 201: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404, 422]),
    },
    handler: handlers.createTournament,
  });

  fastify.get('/tournaments/:eventId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get a golf tournament',
      description: 'Canonical DTO plus a workflow block: current status and the server-computed set of allowed next transitions.',
      operationId: 'adminGetGolfTournament',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404]),
    },
    handler: handlers.getTournament,
  });

  fastify.patch('/tournaments/:eventId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Update a golf tournament',
      description: 'Partial update, minus seasonId (immutable after creation). 409 EVENT_NOT_ADMIN_MANAGED when the event is provider-owned (syncScope=FULL).',
      operationId: 'adminUpdateGolfTournament',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfTournamentRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404, 409]),
    },
    handler: handlers.updateTournament,
  });

  fastify.delete('/tournaments/:eventId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Delete a golf tournament',
      description: 'Hard delete. 409 EVENT_HAS_CONTESTS when any Contest references it.',
      operationId: 'adminDeleteGolfTournament',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      response: withGolfErrorResponses({ 204: { type: 'null' } }, [404, 409]),
    },
    handler: handlers.deleteTournament,
  });

  fastify.post('/tournaments/:eventId/transitions', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Transition a golf tournament\'s status',
      description: 'Routes to EventLifecycleService.applySportEventStatusTransition with a ROOT_ADMIN actor — the same function the lifecycle scheduler calls with a SYSTEM actor. 422 SPORT_EVENT_INVALID_TRANSITION for an undeclared jump.',
      operationId: 'adminTransitionGolfTournament',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      body: zodToJsonSchema(AdminTransitionGolfTournamentRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404, 422]),
    },
    handler: handlers.transitionTournament,
  });

  fastify.post('/tournaments/:eventId/score-source', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Link a golf tournament to a provider score source',
      description: 'Sets providerId/externalId/syncScope=SCORES_ONLY from a row selected via adminListProviderCatalogEvents. Does not import the provider\'s field or odds — a tournament that already has a field keeps it untouched. 409 EXTERNAL_EVENT_ALREADY_LINKED if another sport event already holds that identity; 409 EVENT_NOT_ADMIN_MANAGED when the event is already provider-owned (syncScope=FULL).',
      operationId: 'adminLinkGolfTournamentScoreSource',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      body: zodToJsonSchema(AdminLinkGolfTournamentScoreSourceRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404, 409]),
    },
    handler: handlers.linkTournamentScoreSource,
  });

  fastify.delete('/tournaments/:eventId/score-source', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Unlink a golf tournament\'s provider score source',
      description: 'Reverts to the manual-admin placeholder identity and syncScope=NONE. Already-synced score rows are left as-is.',
      operationId: 'adminUnlinkGolfTournamentScoreSource',
      params: zodToJsonSchema(AdminGolfTournamentParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentDetailResponseSchema) }, [404, 409]),
    },
    handler: handlers.unlinkTournamentScoreSource,
  });

  fastify.get('/tournaments/:eventId/field', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get a golf tournament\'s field',
      description: 'Field rows with participant identity, isActive/inactiveReason, world rank, odds, seed, price, and isLeagueRosterMember (flags an out-of-roster invite).',
      operationId: 'adminGetGolfTournamentField',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentFieldResponseSchema) }),
    },
    handler: handlers.getTournamentField,
  });

  fastify.post('/tournaments/:eventId/field/seed', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Seed a golf tournament\'s field from its league roster',
      description: 'Creates a SportEventParticipant per active affiliated Participant, deriving seedNumber/oddsToWin (plans/124 §4.7). Idempotent — skips any golfer already in the field. 409 TOURNAMENT_HAS_NO_SEASON if the tournament has no season to resolve a league from.',
      operationId: 'adminSeedGolfTournamentField',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminSeedGolfTournamentFieldResponseSchema) }, [409]),
    },
    handler: handlers.seedTournamentField,
  });

  fastify.post('/tournaments/:eventId/field/bulk-add', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Bulk-add golfers to a tournament\'s field',
      description: 'One call for both the league-browse multi-select and free-text single-golfer search. Accepts golfers from any league\'s roster, or none — the deliberate path for a cross-league invite. Idempotent — skips any participantId already in the field.',
      operationId: 'adminBulkAddGolfFieldEntries',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminBulkAddGolfFieldEntriesRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminBulkAddGolfFieldEntriesResponseSchema) }),
    },
    handler: handlers.bulkAddFieldEntries,
  });

  fastify.patch('/tournaments/:eventId/field', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Bulk-patch a golf tournament\'s field entries',
      description: 'One request per Save on the field grid. price writes SportEventParticipantGolfValuation.price with priceAssignedSource=MANUAL. 404 FIELD_ENTRY_NOT_FOUND for a sportEventParticipantId not on this tournament.',
      operationId: 'adminUpdateGolfFieldEntries',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminUpdateGolfFieldEntriesRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentFieldResponseSchema) }, [404]),
    },
    handler: handlers.updateFieldEntries,
  });

  fastify.delete('/tournaments/:eventId/field/:sportEventParticipantId', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Remove a golfer from a tournament\'s field',
      description: '409 FIELD_ENTRY_HAS_PICKS when a ContestEntryPick references it — withdraw (isActive=false) instead of removing.',
      operationId: 'adminRemoveGolfFieldEntry',
      params: zodToJsonSchema(AdminGolfFieldEntryParamsSchema),
      response: withGolfErrorResponses({ 204: { type: 'null' } }, [404, 409]),
    },
    handler: handlers.removeFieldEntry,
  });

  fastify.get('/tournaments/:eventId/tiers', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Get a golf tournament\'s tier definitions and assignments',
      description: 'Tier definitions + ordered assignments. Each row includes price alongside tier — one response, both valuations.',
      operationId: 'adminGetGolfTournamentTiers',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentTiersResponseSchema) }),
    },
    handler: handlers.getTournamentTiers,
  });

  fastify.put('/tournaments/:eventId/tiers', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Replace a golf tournament\'s tier definitions',
      description: 'Full replace of tier definitions. 409 TIER_REPLACE_WOULD_ORPHAN_ASSIGNMENTS when removing a tier that still has golfers assigned, unless reassignOrphansTo names a surviving tierKey.',
      operationId: 'adminReplaceGolfTournamentTiers',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminReplaceGolfTournamentTiersRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentTiersResponseSchema) }, [409, 422]),
    },
    handler: handlers.replaceTournamentTiers,
  });

  fastify.post('/tournaments/:eventId/tiers/auto-assign', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Auto-assign a golf tournament\'s tiers',
      description: 'Partitions the active field across however many SportEventGolfTier rows currently exist, tierSize golfers per tier except the last (absorbs the remainder). Writes tierAssignedSource, leaves price untouched.',
      operationId: 'adminAutoAssignGolfTiers',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminAutoAssignGolfTiersRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentTiersResponseSchema) }),
    },
    handler: handlers.autoAssignTournamentTiers,
  });

  fastify.put('/tournaments/:eventId/tiers/assignments', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Replace a golf tournament\'s tier assignments',
      description: 'The drag-and-drop save. Full desired state, applied in one transaction so a dropped request never leaves a half-moved field. tierAssignedSource = MANUAL.',
      operationId: 'adminReplaceGolfTierAssignments',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminReplaceGolfTierAssignmentsRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentTiersResponseSchema) }, [404, 422]),
    },
    handler: handlers.replaceTournamentTierAssignments,
  });

  fastify.post('/tournaments/:eventId/prices/auto-assign', {
    schema: {
      tags: ['Admin Golf'],
      summary: 'Auto-assign a golf tournament\'s prices',
      description: 'Same tie-broken position ordering as tiers and odds, rescaled into the given price range — higher rank, higher price. Leaves tier assignments untouched.',
      operationId: 'adminAutoAssignGolfPrices',
      params: zodToJsonSchema(AdminGolfTournamentFieldParamsSchema),
      body: zodToJsonSchema(AdminAutoAssignGolfPricesRequestSchema),
      response: withGolfErrorResponses({ 200: zodToJsonSchema(AdminGolfTournamentTiersResponseSchema) }),
    },
    handler: handlers.autoAssignTournamentPrices,
  });
}
