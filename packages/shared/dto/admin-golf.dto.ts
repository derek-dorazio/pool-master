/**
 * Admin Golf DTOs — sport-league/season/roster surfaces (plans/124 §3.2/§4.2,
 * §5.2). The golf admin routes are thin wrappers over the cross-sport
 * sport-catalog module scoped to Sport.GOLF.
 */
import { z } from 'zod';
import { GolfParticipantInactiveReason, GolfTierSource, SportEventStatus, SportEventSyncScope } from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';

// --- Params ---

export const AdminGolfLeagueParamsSchema = z.object({ leagueId: z.string() });
export type AdminGolfLeagueParams = z.infer<typeof AdminGolfLeagueParamsSchema>;

export const AdminGolfLeagueRosterEntryParamsSchema = z.object({
  leagueId: z.string(),
  participantId: z.string(),
});
export type AdminGolfLeagueRosterEntryParams = z.infer<typeof AdminGolfLeagueRosterEntryParamsSchema>;

export const AdminGolfSeasonParamsSchema = z.object({ seasonId: z.string() });
export type AdminGolfSeasonParams = z.infer<typeof AdminGolfSeasonParamsSchema>;

// --- Leagues ---

export const AdminGolfLeagueDtoSchema = z.object({
  id: z.string().describe('SportLeague identifier.'),
  sportId: z.string().describe('Owning Sport row identifier.'),
  name: z.string().describe('League/tour name, e.g. "PGA Tour".'),
  matchKeyword: z.string().nullable().describe('Plain catalog-browse filter keyword, e.g. "PGA".'),
  currentSeasonId: z.string().nullable().describe('The season currently designated as this league\'s active one, if any.'),
  isActive: z.boolean(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical SportLeague DTO.');
export type AdminGolfLeagueDto = z.infer<typeof AdminGolfLeagueDtoSchema>;

export const AdminGolfLeagueSummaryDtoSchema = AdminGolfLeagueDtoSchema.extend({
  rosterSize: z.number().int().describe('Number of golfers currently affiliated with this league.'),
  seasonCount: z.number().int().describe('Number of seasons on record for this league.'),
}).describe('SportLeague row with roster/season counts, for the league list view.');
export type AdminGolfLeagueSummaryDto = z.infer<typeof AdminGolfLeagueSummaryDtoSchema>;

export const AdminGolfLeagueListResponseSchema = z.object({
  leagues: z.array(AdminGolfLeagueSummaryDtoSchema),
});
export type AdminGolfLeagueListResponse = z.infer<typeof AdminGolfLeagueListResponseSchema>;

export const AdminGolfLeagueListQuerySchema = z.object({
  isActive: z.coerce.boolean().optional(),
});
export type AdminGolfLeagueListQuery = z.infer<typeof AdminGolfLeagueListQuerySchema>;

export const AdminCreateGolfLeagueRequestSchema = z.object({
  name: z.string().min(1),
  matchKeyword: z.string().optional(),
});
export type AdminCreateGolfLeagueRequest = z.infer<typeof AdminCreateGolfLeagueRequestSchema>;

export const AdminUpdateGolfLeagueRequestSchema = z.object({
  name: z.string().min(1).optional(),
  matchKeyword: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});
export type AdminUpdateGolfLeagueRequest = z.infer<typeof AdminUpdateGolfLeagueRequestSchema>;

// --- League roster ---

export const AdminGolfLeagueRosterEntryDtoSchema = z.object({
  participantId: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  nationality: z.string().nullable(),
  status: z.string().describe('Participant.status (ACTIVE/INACTIVE/etc.) — hides a retired golfer.'),
  worldRanking: z.number().int().nullable(),
}).describe('One golfer\'s current league affiliation.');
export type AdminGolfLeagueRosterEntryDto = z.infer<typeof AdminGolfLeagueRosterEntryDtoSchema>;

export const AdminGolfLeagueRosterResponseSchema = z.object({
  entries: z.array(AdminGolfLeagueRosterEntryDtoSchema),
});
export type AdminGolfLeagueRosterResponse = z.infer<typeof AdminGolfLeagueRosterResponseSchema>;

export const AdminAddGolfLeagueRosterEntryRequestSchema = z.object({
  participantId: z.string(),
});
export type AdminAddGolfLeagueRosterEntryRequest = z.infer<typeof AdminAddGolfLeagueRosterEntryRequestSchema>;

export const AdminUpdateGolfLeagueRosterRequestSchema = z.object({
  entries: z.array(z.object({
    participantId: z.string(),
    worldRanking: z.number().int().nullable(),
  })).min(1).max(500),
});
export type AdminUpdateGolfLeagueRosterRequest = z.infer<typeof AdminUpdateGolfLeagueRosterRequestSchema>;

export const AdminGolfLeagueRosterUploadRowSchema = z.object({
  participantId: z.string().uuid().optional(),
  externalId: z.string().optional(),
  playerName: z.string().optional(),
  worldRanking: z.number().int().optional(),
}).describe('One golfer\'s league roster entry. Exactly one identifier (participantId, externalId, or playerName) should be supplied; participantId takes precedence, then externalId, then an exact case-insensitive playerName match.');
export type AdminGolfLeagueRosterUploadRow = z.infer<typeof AdminGolfLeagueRosterUploadRowSchema>;

export const AdminGolfLeagueRosterUploadRequestSchema = z.object({
  rows: z.array(AdminGolfLeagueRosterUploadRowSchema).min(1).max(2000),
});
export type AdminGolfLeagueRosterUploadRequest = z.infer<typeof AdminGolfLeagueRosterUploadRequestSchema>;

export const AdminGolfLeagueRosterUploadResolutionDtoSchema = z.enum(['MATCHED', 'UNRESOLVED', 'AMBIGUOUS']);

export const AdminGolfLeagueRosterUploadPreviewRowDtoSchema = z.object({
  row: AdminGolfLeagueRosterUploadRowSchema,
  resolution: AdminGolfLeagueRosterUploadResolutionDtoSchema,
  participantId: z.string().nullable(),
  participantName: z.string().nullable(),
});
export type AdminGolfLeagueRosterUploadPreviewRowDto = z.infer<typeof AdminGolfLeagueRosterUploadPreviewRowDtoSchema>;

export const AdminGolfLeagueRosterUploadPreviewResponseSchema = z.object({
  rows: z.array(AdminGolfLeagueRosterUploadPreviewRowDtoSchema),
});
export type AdminGolfLeagueRosterUploadPreviewResponse = z.infer<typeof AdminGolfLeagueRosterUploadPreviewResponseSchema>;

// --- Seasons ---

export const AdminGolfSeasonDtoSchema = z.object({
  id: z.string(),
  sportLeagueId: z.string(),
  name: z.string(),
  year: z.number().int(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema,
  isActive: z.boolean(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical Season DTO.');
export type AdminGolfSeasonDto = z.infer<typeof AdminGolfSeasonDtoSchema>;

export const AdminGolfSeasonSummaryDtoSchema = AdminGolfSeasonDtoSchema.extend({
  tournamentCount: z.number().int().describe('Number of tournaments linked to this season.'),
});
export type AdminGolfSeasonSummaryDto = z.infer<typeof AdminGolfSeasonSummaryDtoSchema>;

export const AdminGolfSeasonDetailDtoSchema = AdminGolfSeasonSummaryDtoSchema.extend({
  isCurrent: z.boolean().describe('Whether this season is its league\'s currently-designated season.'),
});
export type AdminGolfSeasonDetailDto = z.infer<typeof AdminGolfSeasonDetailDtoSchema>;

export const AdminGolfSeasonListResponseSchema = z.object({
  seasons: z.array(AdminGolfSeasonSummaryDtoSchema),
});
export type AdminGolfSeasonListResponse = z.infer<typeof AdminGolfSeasonListResponseSchema>;

export const AdminGolfSeasonListQuerySchema = z.object({
  isActive: z.coerce.boolean().optional(),
  sportLeagueId: z.string().optional(),
});
export type AdminGolfSeasonListQuery = z.infer<typeof AdminGolfSeasonListQuerySchema>;

export const AdminCreateGolfSeasonRequestSchema = z.object({
  sportLeagueId: z.string(),
  name: z.string().min(1),
  year: z.number().int(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema,
});
export type AdminCreateGolfSeasonRequest = z.infer<typeof AdminCreateGolfSeasonRequestSchema>;

export const AdminUpdateGolfSeasonRequestSchema = z.object({
  name: z.string().min(1).optional(),
  startDate: DateTimeSchema.optional(),
  endDate: DateTimeSchema.optional(),
  isActive: z.boolean().optional(),
});
export type AdminUpdateGolfSeasonRequest = z.infer<typeof AdminUpdateGolfSeasonRequestSchema>;

export const AdminSetCurrentGolfSeasonResponseSchema = z.object({
  sportLeagueId: z.string(),
  currentSeasonId: z.string(),
});
export type AdminSetCurrentGolfSeasonResponse = z.infer<typeof AdminSetCurrentGolfSeasonResponseSchema>;

// --- Tournament round schedule (plans/124 §4.10) ---

export const AdminGolfTournamentParamsSchema = z.object({ eventId: z.string() });
export type AdminGolfTournamentParams = z.infer<typeof AdminGolfTournamentParamsSchema>;

export const AdminGolfTournamentRoundDtoSchema = z.object({
  roundNumber: z.number().int().describe('1-indexed round number; the only resolution key for score writes.'),
  scheduledDate: DateTimeSchema,
  // A fresh z.string().datetime() rather than DateTimeSchema.nullable() — reusing the
  // same schema instance for both fields makes zod-to-json-schema emit this one as
  // `{ allOf: [{ $ref: '#/.../scheduledDate' }], nullable: true }`, which has no
  // sibling "type" keyword and fails ajv's route-schema build ("nullable cannot be
  // used without type").
  scheduledEndAt: z.string().datetime().nullable(),
}).describe('One SportEventRound schedule row — this round\'s own date/end, independent of any participant result.');
export type AdminGolfTournamentRoundDto = z.infer<typeof AdminGolfTournamentRoundDtoSchema>;

export const AdminGolfTournamentRoundsResponseSchema = z.object({
  rounds: z.array(AdminGolfTournamentRoundDtoSchema).describe('Ordered by roundNumber ascending, not by date.'),
});
export type AdminGolfTournamentRoundsResponse = z.infer<typeof AdminGolfTournamentRoundsResponseSchema>;

export const AdminUpdateGolfTournamentRoundsRequestSchema = z.object({
  rounds: z.array(z.object({
    roundNumber: z.number().int(),
    scheduledDate: DateTimeSchema,
    // See AdminGolfTournamentRoundDtoSchema's comment on scheduledEndAt for why this
    // isn't DateTimeSchema.nullable().optional().
    scheduledEndAt: z.string().datetime().nullable().optional(),
  })).min(1).describe('How a rain delay or an irregular schedule gets recorded. Only reschedules existing rounds; never creates one.'),
});
export type AdminUpdateGolfTournamentRoundsRequest = z.infer<typeof AdminUpdateGolfTournamentRoundsRequestSchema>;

// --- Tournaments (plans/124 §4.3/§5.2) ---

export const AdminGolfTournamentSourceDtoSchema = z.enum(['MANUAL', 'PROVIDER']);
export type AdminGolfTournamentSourceDto = z.infer<typeof AdminGolfTournamentSourceDtoSchema>;

export const AdminGolfTournamentSyncScopeDtoSchema = z.nativeEnum(SportEventSyncScope);
export type AdminGolfTournamentSyncScopeDto = z.infer<typeof AdminGolfTournamentSyncScopeDtoSchema>;

export const AdminGolfTournamentDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  venue: z.string().nullable(),
  location: z.string().nullable(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.nullable(),
  status: z.nativeEnum(SportEventStatus),
  rounds: z.number().int().nullable(),
  releaseAt: DateTimeSchema,
  fieldLocksAt: DateTimeSchema,
  fieldLocked: z.boolean(),
  seasonId: z.string().nullable(),
  leagueEventId: z.string().nullable().describe('The recurring tournament identity this year\'s event resolves to, if any (plans/124 §4.3a).'),
  source: AdminGolfTournamentSourceDtoSchema.describe('MANUAL when providerId is the reserved manual-admin identity; PROVIDER otherwise.'),
  syncScope: AdminGolfTournamentSyncScopeDtoSchema,
  autoLifecycleEnabled: z.boolean(),
  fieldCount: z.number().int(),
  tierCount: z.number().int(),
  contestCount: z.number().int(),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical admin golf tournament DTO — a SportEvent plus field/tier/contest counts.');
export type AdminGolfTournamentDto = z.infer<typeof AdminGolfTournamentDtoSchema>;

export const AdminGolfTournamentWorkflowDtoSchema = z.object({
  currentStatus: z.nativeEnum(SportEventStatus),
  allowedTransitions: z.array(z.nativeEnum(SportEventStatus)).describe('Server-computed from the declared transition map — never re-derived client-side.'),
});
export type AdminGolfTournamentWorkflowDto = z.infer<typeof AdminGolfTournamentWorkflowDtoSchema>;

export const AdminGolfTournamentDetailDtoSchema = AdminGolfTournamentDtoSchema.extend({
  workflow: AdminGolfTournamentWorkflowDtoSchema,
});
export type AdminGolfTournamentDetailDto = z.infer<typeof AdminGolfTournamentDetailDtoSchema>;

export const AdminGolfTournamentListResponseSchema = z.object({
  tournaments: z.array(AdminGolfTournamentDtoSchema),
});
export type AdminGolfTournamentListResponse = z.infer<typeof AdminGolfTournamentListResponseSchema>;

export const AdminGolfTournamentListQuerySchema = z.object({
  status: z.nativeEnum(SportEventStatus).optional(),
  search: z.string().optional(),
});
export type AdminGolfTournamentListQuery = z.infer<typeof AdminGolfTournamentListQuerySchema>;

export const AdminGolfTournamentDetailResponseSchema = z.object({
  tournament: AdminGolfTournamentDetailDtoSchema,
});
export type AdminGolfTournamentDetailResponse = z.infer<typeof AdminGolfTournamentDetailResponseSchema>;

export const AdminCreateGolfTournamentRequestSchema = z.object({
  name: z.string().min(1),
  venue: z.string().optional(),
  location: z.string().optional(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.optional(),
  rounds: z.number().int().min(1).default(4),
  releaseAt: DateTimeSchema,
  fieldLocksAt: DateTimeSchema,
  seasonId: z.string(),
  autoLifecycleEnabled: z.boolean().optional(),
});
export type AdminCreateGolfTournamentRequest = z.infer<typeof AdminCreateGolfTournamentRequestSchema>;

export const AdminUpdateGolfTournamentRequestSchema = AdminCreateGolfTournamentRequestSchema
  .omit({ seasonId: true, rounds: true })
  .extend({ rounds: z.number().int().min(1).optional() })
  .partial();
export type AdminUpdateGolfTournamentRequest = z.infer<typeof AdminUpdateGolfTournamentRequestSchema>;

export const AdminTransitionGolfTournamentRequestSchema = z.object({
  toStatus: z.nativeEnum(SportEventStatus),
});
export type AdminTransitionGolfTournamentRequest = z.infer<typeof AdminTransitionGolfTournamentRequestSchema>;

// --- Field (plans/124 §4.7/§5.2) ---

export const AdminGolfFieldEntryDtoSchema = z.object({
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  participantName: z.string(),
  shortName: z.string().nullable(),
  nationality: z.string().nullable(),
  isActive: z.boolean(),
  inactiveReason: z.nativeEnum(GolfParticipantInactiveReason).nullable().describe('Meaningful only when isActive is false; null covers "inactive, no more specific reason recorded."'),
  worldRanking: z.number().int().nullable(),
  oddsToWin: z.number().nullable(),
  seedNumber: z.number().int().nullable(),
  price: z.number().nullable().describe('SportEventParticipantGolfValuation.price — set via the bulk field patch, priceAssignedSource=MANUAL.'),
  isLeagueRosterMember: z.boolean().describe('Whether this golfer is currently affiliated with the tournament\'s linked league — flags an out-of-roster invite.'),
}).describe('One SportEventParticipant row on a golf tournament\'s field.');
export type AdminGolfFieldEntryDto = z.infer<typeof AdminGolfFieldEntryDtoSchema>;

export const AdminGolfTournamentFieldResponseSchema = z.object({
  entries: z.array(AdminGolfFieldEntryDtoSchema),
});
export type AdminGolfTournamentFieldResponse = z.infer<typeof AdminGolfTournamentFieldResponseSchema>;

export const AdminSeedGolfTournamentFieldResponseSchema = z.object({
  added: z.number().int(),
  skipped: z.number().int(),
  total: z.number().int(),
  seedNumbersDerived: z.number().int(),
  oddsDerived: z.number().int(),
});
export type AdminSeedGolfTournamentFieldResponse = z.infer<typeof AdminSeedGolfTournamentFieldResponseSchema>;

export const AdminBulkAddGolfFieldEntriesRequestSchema = z.object({
  participantIds: z.array(z.string()).min(1),
});
export type AdminBulkAddGolfFieldEntriesRequest = z.infer<typeof AdminBulkAddGolfFieldEntriesRequestSchema>;

export const AdminBulkAddGolfFieldEntriesResponseSchema = z.object({
  added: z.number().int(),
  skipped: z.number().int(),
  total: z.number().int(),
});
export type AdminBulkAddGolfFieldEntriesResponse = z.infer<typeof AdminBulkAddGolfFieldEntriesResponseSchema>;

export const AdminUpdateGolfFieldEntriesRequestSchema = z.object({
  entries: z.array(z.object({
    sportEventParticipantId: z.string(),
    isActive: z.boolean().optional(),
    inactiveReason: z.nativeEnum(GolfParticipantInactiveReason).nullable().optional(),
    worldRanking: z.number().int().nullable().optional(),
    oddsToWin: z.number().nullable().optional(),
    seedNumber: z.number().int().nullable().optional(),
    price: z.number().nullable().optional(),
  })).min(1),
});
export type AdminUpdateGolfFieldEntriesRequest = z.infer<typeof AdminUpdateGolfFieldEntriesRequestSchema>;

export const AdminGolfTournamentFieldParamsSchema = z.object({ eventId: z.string() });
export type AdminGolfTournamentFieldParams = z.infer<typeof AdminGolfTournamentFieldParamsSchema>;

export const AdminGolfFieldEntryParamsSchema = z.object({
  eventId: z.string(),
  sportEventParticipantId: z.string(),
});
export type AdminGolfFieldEntryParams = z.infer<typeof AdminGolfFieldEntryParamsSchema>;

// --- Tiers and price (plans/124 §4.5/§4.7a/§5.2) ---

export const AdminGolfTierDtoSchema = z.object({
  tierKey: z.string(),
  label: z.string(),
  tierNumber: z.number().int(),
  defaultPickCount: z.number().int(),
});
export type AdminGolfTierDto = z.infer<typeof AdminGolfTierDtoSchema>;

export const AdminGolfTierAssignmentDtoSchema = z.object({
  sportEventParticipantId: z.string(),
  participantId: z.string(),
  tierOrderIndex: z.number().int().nullable(),
  price: z.number().nullable(),
});
export type AdminGolfTierAssignmentDto = z.infer<typeof AdminGolfTierAssignmentDtoSchema>;

export const AdminGolfTierGroupDtoSchema = AdminGolfTierDtoSchema.extend({
  assignments: z.array(AdminGolfTierAssignmentDtoSchema),
});
export type AdminGolfTierGroupDto = z.infer<typeof AdminGolfTierGroupDtoSchema>;

export const AdminGolfTournamentTiersResponseSchema = z.object({
  tiers: z.array(AdminGolfTierGroupDtoSchema).describe('Ordered by tierNumber ascending.'),
});
export type AdminGolfTournamentTiersResponse = z.infer<typeof AdminGolfTournamentTiersResponseSchema>;

export const AdminReplaceGolfTournamentTiersRequestSchema = z.object({
  tiers: z.array(z.object({
    tierKey: z.string().min(1),
    label: z.string().min(1),
    tierNumber: z.number().int().min(1),
    defaultPickCount: z.number().int().min(1),
  })).min(1),
  reassignOrphansTo: z.string().optional().describe('A tierKey from this same request — required when removing a tier that still has golfers assigned to it.'),
});
export type AdminReplaceGolfTournamentTiersRequest = z.infer<typeof AdminReplaceGolfTournamentTiersRequestSchema>;

export const AdminAutoAssignGolfTiersRequestSchema = z.object({
  source: z.nativeEnum(GolfTierSource),
  tierSize: z.number().int().min(1).optional(),
});
export type AdminAutoAssignGolfTiersRequest = z.infer<typeof AdminAutoAssignGolfTiersRequestSchema>;

export const AdminReplaceGolfTierAssignmentsRequestSchema = z.object({
  assignments: z.array(z.object({
    sportEventParticipantId: z.string(),
    tierKey: z.string(),
    tierOrderIndex: z.number().int(),
  })).min(1).describe('Full desired state — the drag-and-drop save. Applied in one transaction so a dropped request never leaves a half-moved field.'),
});
export type AdminReplaceGolfTierAssignmentsRequest = z.infer<typeof AdminReplaceGolfTierAssignmentsRequestSchema>;

export const AdminAutoAssignGolfPricesRequestSchema = z.object({
  minPrice: z.number().min(0),
  maxPrice: z.number().min(0),
});
export type AdminAutoAssignGolfPricesRequest = z.infer<typeof AdminAutoAssignGolfPricesRequestSchema>;
