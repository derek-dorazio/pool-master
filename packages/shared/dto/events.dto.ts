import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  ParticipantInactiveReason,
  ParticipantStandingStatus,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
  TierSource,
  ValuationSource,
} from '@poolmaster/shared/domain';
import { DateTimeSchema, JsonObjectSchema } from './common.dto';
import { ParticipantDtoSchema } from './participants.dto';

/** Derived from the domain SportEventStatus constant (plans/124 §4.1) — `OFFICIAL` dropped. */
export const EventStatusDtoSchema = z.nativeEnum(SportEventStatus);
export type EventStatusDto = z.infer<typeof EventStatusDtoSchema>;

export const EventReadinessStatusDtoSchema = z.enum([
  'NOT_RELEASED',
  'PENDING_FIELD',
  'CONTEST_ELIGIBLE',
  'FIELD_LOCKED',
]);
export type EventReadinessStatusDto = z.infer<typeof EventReadinessStatusDtoSchema>;

export const EventReadinessReasonDtoSchema = z.enum([
  'EVENT_NOT_RELEASED',
  'FIELD_NOT_LOADED',
  'FIELD_LOCKED',
]);
export type EventReadinessReasonDto = z.infer<typeof EventReadinessReasonDtoSchema>;

/**
 * Admin-only fields are annotated, not enforced (plans/145 rule 4, DOMAIN-OPERATIONS §13):
 * every caller gets the full object.
 */
const ADMIN_ONLY = '(Admin-only: operational detail no member surface reads.)';

/**
 * The canonical SportEvent — the row plus the three things every reader of an event
 * needs and the row does not store: how many participants are loaded, and whether the
 * event is ready for contest setup (derived from release/field-lock timing and the
 * loaded field). One shape for every caller; it replaced EventSummaryDto and
 * AdminEventSummaryDto, which each derived the same readiness in their own mapper.
 */
export const SportEventDtoSchema = z.object({
  id: z.string().uuid().describe('Sport-event identifier.'),
  externalId: z.string().describe(`Provider-side event identifier used by sync operations. ${ADMIN_ONLY}`),
  providerId: z.string().describe(`Provider that emitted the event, or manual-admin for an admin-authored one. ${ADMIN_ONLY}`),
  sport: z.nativeEnum(Sport).describe('Sport the event belongs to.'),
  name: z.string().describe('Event name shown in contest and event selectors.'),
  venue: z.string().nullable().describe('Venue name when known; null otherwise.'),
  location: z.string().nullable().describe('Human-readable location when known; null otherwise.'),
  status: EventStatusDtoSchema.describe('Event lifecycle status.'),
  startDate: DateTimeSchema.describe('Scheduled or actual start time.'),
  endDate: DateTimeSchema.nullable().describe('Scheduled or actual end time when known; null otherwise.'),
  rounds: z.number().int().nullable().describe('Number of rounds when the format has them; null otherwise.'),
  participantCount: z.number().int().nullable().describe('Field size the provider reports, when it reports one; null otherwise.'),
  loadedParticipantCount: z.number().int().describe('Number of event participants currently persisted for the event.'),
  releaseAt: DateTimeSchema.describe('When the event becomes available for contest setup.'),
  fieldLocksAt: DateTimeSchema.describe('After this time, field changes are no longer honored for new contest setup.'),
  fieldLocked: z.boolean().describe('Whether the field is locked for contest setup now: the provider has locked it, or fieldLocksAt has passed.'),
  readinessStatus: EventReadinessStatusDtoSchema.describe('Contest-setup readiness right now.'),
  readinessReasons: z.array(EventReadinessReasonDtoSchema).describe('Why the event is or is not contest-eligible right now.'),
  contestEligible: z.boolean().describe('Whether a contest can be created or configured for the event right now.'),
  eventSeriesId: z.string().uuid().describe('The recurring tournament (event series) this is one edition of — the event\'s only parent.'),
  eventYear: z.number().int().describe('The year this edition is branded with ("the 2026 Masters"), which is not always the year startDate falls in. One edition of a series per year.'),
  sportLeagueId: z.string().uuid().describe('The sport league the event\'s series belongs to. Read through the series, not stored on the event.'),
  syncScope: z.nativeEnum(SportEventSyncScope).describe(`How much provider data this event accepts on sync. ${ADMIN_ONLY}`),
  autoLifecycleEnabled: z.boolean().describe(`Whether the lifecycle scheduler may move this event's status. ${ADMIN_ONLY}`),
  tierCount: z.number().int().describe(`Pick tiers defined for the event. ${ADMIN_ONLY}`),
  contestCount: z.number().int().describe(`Contests run on the event, across every league; an event with any cannot be deleted. ${ADMIN_ONLY}`),
  allowedTransitions: z.array(EventStatusDtoSchema).describe(`Statuses the event may move to next, from the declared transition map. ${ADMIN_ONLY}`),
  metadata: JsonObjectSchema.describe(`Provider-emitted event metadata captured at field-load time. ${ADMIN_ONLY}`),
  createdAt: DateTimeSchema.describe('When the event row was created.'),
  updatedAt: DateTimeSchema.describe('When the event row was last updated.'),
}).describe('A real-world event a contest can be run on — a golf tournament, a race, a match.');
export type SportEventDto = z.infer<typeof SportEventDtoSchema>;

/** Filters narrow the list; nothing pages it (§16). */
export const SportEventListQuerySchema = z.object({
  sport: z.nativeEnum(Sport).optional().describe('Only events of this sport.'),
  status: EventStatusDtoSchema.optional().describe('Only events in this lifecycle status.'),
  sportLeagueId: z.string().uuid().optional().describe('Only events of this sport league\'s series.'),
  eventYear: z.number().int().optional().describe('Only editions branded with this year.'),
  q: z.string().optional().describe('Case-insensitive substring of the event name.'),
}).describe('Filters for the sport-event list.');
export type SportEventListQuery = z.infer<typeof SportEventListQuerySchema>;

export const SportEventListResponseSchema = z.object({
  events: z.array(SportEventDtoSchema).describe('Matching events, earliest start first.'),
}).describe('Sport events matching the filters.');
export type SportEventListResponse = z.infer<typeof SportEventListResponseSchema>;

export const SportEventResponseSchema = z.object({
  event: SportEventDtoSchema,
}).describe('One sport event.');
export type SportEventResponse = z.infer<typeof SportEventResponseSchema>;

export const CreateSportEventRequestSchema = z.object({
  sportLeagueId: z.string().uuid().describe('The sport league the event runs on; it decides the sport. The event\'s series is found or created in it by name.'),
  eventYear: z.number().int().describe('The year the edition is branded with. 409 EVENT_EDITION_ALREADY_EXISTS when the series already has an edition in it.'),
  name: z.string().min(1),
  venue: z.string().optional(),
  location: z.string().optional(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.optional(),
  rounds: z.number().int().min(1).optional().describe('Round count; golf defaults to 4.'),
  releaseAt: DateTimeSchema,
  fieldLocksAt: DateTimeSchema,
  autoLifecycleEnabled: z.boolean().optional(),
}).describe('An admin-authored event. Created SCHEDULED with its default rounds and tiers, accepting no provider data.');
export type CreateSportEventRequest = z.infer<typeof CreateSportEventRequestSchema>;

export const CreateSportEventFromProviderEventRequestSchema = z.object({
  sportLeagueId: z.string().uuid().describe('The sport league the event runs on; it decides the sport.'),
  eventYear: z.number().int().describe('The year the edition is branded with. 409 EVENT_EDITION_ALREADY_EXISTS when the series already has an edition in it.'),
  providerId: z.string().min(1),
  externalId: z.string().min(1).describe('From a provider catalog browse (listProviderCatalogEvents).'),
  rounds: z.number().int().min(1).optional().describe('Round count; omitted, the provider schedule decides.'),
}).describe('An event created from a provider event, linked to it for scores (SCORES_ONLY). The field is not touched.');
export type CreateSportEventFromProviderEventRequest = z.infer<typeof CreateSportEventFromProviderEventRequestSchema>;

/**
 * plans/147 — the season clone, without the season: one sport league's calendar for one
 * event year, copied to another. Answered with the created events.
 */
export const CloneSportEventYearRequestSchema = z.object({
  sportLeagueId: z.string().uuid().describe('The sport league whose calendar is cloned.'),
  eventYear: z.number().int().describe('The year cloned from. 422 EVENT_YEAR_HAS_NO_EVENTS when the sport league has no events in it.'),
  targetYear: z.number().int().optional().describe('The year cloned to; defaults to eventYear + 1. 409 EVENT_YEAR_NOT_EMPTY when the sport league already has events in it.'),
}).describe('Re-creates each of a sport league\'s events in one year as a fresh event in another, dates shifted by the year difference and in the same series. Fields, tiers, prices, scores and provider links are never copied, and the current event year does not change.');
export type CloneSportEventYearRequest = z.infer<typeof CloneSportEventYearRequestSchema>;

/**
 * #385 — a tour's event year created in one action from the provider's slate, each event
 * linked for scores. Answered with what was created and what was skipped.
 */
export const ImportSportEventYearFromProviderRequestSchema = z.object({
  sportLeagueId: z.string().uuid().describe('The tour. Its matchKeyword must equal the provider\'s tour name for an event (case-insensitive), e.g. "PGA TOUR"; 422 SPORT_LEAGUE_HAS_NO_MATCH_KEYWORD when it has none.'),
  eventYear: z.number().int().min(2000).max(2100).describe('Provider events starting in this calendar year (UTC) are imported, as editions branded with it.'),
  providerId: z.string().min(1),
}).describe('Creates each of the provider\'s events for a tour and year that PoolMaster does not have yet, each linked to its provider event for scores (SCORES_ONLY). Fields are not loaded.');
export type ImportSportEventYearFromProviderRequest = z.infer<typeof ImportSportEventYearFromProviderRequestSchema>;

export const ImportSportEventSkipReasonDtoSchema = z.enum(['ALREADY_LINKED', 'EDITION_EXISTS'])
  .describe('ALREADY_LINKED: an event is already linked to this provider event. EDITION_EXISTS: the series already has an edition that year (link it from its page if it should score).');
export type ImportSportEventSkipReasonDto = z.infer<typeof ImportSportEventSkipReasonDtoSchema>;

export const ImportSportEventYearFromProviderResponseSchema = z.object({
  created: z.array(SportEventDtoSchema).describe('The events created, in provider order.'),
  skipped: z.array(z.object({
    externalId: z.string().describe('The provider event id.'),
    name: z.string(),
    reason: ImportSportEventSkipReasonDtoSchema,
  })).describe('Provider events left alone because PoolMaster already has them.'),
}).describe('What an event-year import created and skipped. Running it again creates nothing new.');
export type ImportSportEventYearFromProviderResponse = z.infer<typeof ImportSportEventYearFromProviderResponseSchema>;

export const UpdateSportEventRequestSchema = z.object({
  name: z.string().min(1).optional(),
  venue: z.string().nullable().optional().describe('null clears it.'),
  location: z.string().nullable().optional().describe('null clears it.'),
  startDate: DateTimeSchema.optional(),
  endDate: z.string().datetime().nullable().optional().describe('null clears it.'),
  rounds: z.number().int().min(1).optional(),
  releaseAt: DateTimeSchema.optional(),
  fieldLocksAt: DateTimeSchema.optional(),
  autoLifecycleEnabled: z.boolean().optional(),
}).describe('Changes to an admin-managed event; omitted fields are left alone.');
export type UpdateSportEventRequest = z.infer<typeof UpdateSportEventRequestSchema>;

export const TransitionSportEventRequestSchema = z.object({
  toStatus: EventStatusDtoSchema.describe('One of the event\'s allowedTransitions.'),
}).describe('Moves an event to its next lifecycle status, activating or settling its contests as that status requires.');
export type TransitionSportEventRequest = z.infer<typeof TransitionSportEventRequestSchema>;

export const LinkSportEventScoreSourceRequestSchema = z.object({
  providerId: z.string().min(1),
  externalId: z.string().min(1).describe('From a provider catalog browse.'),
}).describe('Links an event to a provider event for scores.');
export type LinkSportEventScoreSourceRequest = z.infer<typeof LinkSportEventScoreSourceRequestSchema>;

export const StartSportEventLiveSimulationRequestSchema = z.object({
  minutesPerRound: z.number().int().min(1).max(1440).optional()
    .describe('How long each of the four simulated rounds lasts. Defaults to the provider\'s own default (20 on the mock feed).'),
}).describe('Starts, or restarts from round 1, the score source\'s simulated live scoring for a linked event.');
export type StartSportEventLiveSimulationRequest = z.infer<typeof StartSportEventLiveSimulationRequestSchema>;

export const SportEventLiveSimulationPhaseSchema = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'])
  .describe('Where the simulation is on its own clock.');

export const SportEventLiveSimulationResponseSchema = z.object({
  sportEventId: z.string().uuid(),
  startsAt: DateTimeSchema.describe('When simulated round 1 started.'),
  endsAt: DateTimeSchema.describe('When simulated round 4 finishes; scores stop changing after this.'),
  minutesPerRound: z.number().int(),
  phase: SportEventLiveSimulationPhaseSchema,
  currentRound: z.number().int().min(1).max(4).nullable().describe('The round being played now; null before the start and after the finish.'),
}).describe('A running simulated live-scoring replay. Scores reach PoolMaster through the normal live-score sync, which polls only while the event is IN_PROGRESS.');
export type SportEventLiveSimulationResponse = z.infer<typeof SportEventLiveSimulationResponseSchema>;

// --- SportEventRound -------------------------------------------------------------

export const SportEventRoundDtoSchema = z.object({
  id: z.string().uuid(),
  sportEventId: z.string().uuid(),
  roundNumber: z.number().int().describe('1-based; how a score names its round.'),
  scheduledDate: DateTimeSchema,
  // A fresh schema rather than DateTimeSchema.nullable(): reusing the instance makes the
  // JSON-schema output an allOf $ref without a type, which the route builder rejects.
  scheduledEndAt: z.string().datetime().nullable(),
}).describe('A scheduled round of an event — its own date, independent of any result in it.');
export type SportEventRoundDto = z.infer<typeof SportEventRoundDtoSchema>;

export const SportEventRoundListResponseSchema = z.object({
  rounds: z.array(SportEventRoundDtoSchema).describe('By round number.'),
}).describe('An event\'s rounds.');
export type SportEventRoundListResponse = z.infer<typeof SportEventRoundListResponseSchema>;

export const UpdateSportEventRoundsRequestSchema = z.object({
  rounds: z.array(z.object({
    roundNumber: z.number().int(),
    scheduledDate: DateTimeSchema,
    scheduledEndAt: z.string().datetime().nullable().optional().describe('Omitted keeps it; null clears it.'),
  })).min(1).describe('Existing rounds to reschedule, all or none. Never creates a round.'),
}).describe('How a rain delay or an irregular schedule is recorded.');
export type UpdateSportEventRoundsRequest = z.infer<typeof UpdateSportEventRoundsRequestSchema>;

// --- SportEventTier --------------------------------------------------------------

export const SportEventTierDtoSchema = z.object({
  id: z.string().uuid(),
  sportEventId: z.string().uuid(),
  tierKey: z.string().describe('Stable key; assignments name a tier by it.'),
  label: z.string(),
  tierNumber: z.number().int().describe('Order among the event\'s tiers; 1 first.'),
  defaultPickCount: z.number().int().describe('Picks a contest takes from this tier by default.'),
}).describe('A pick tier an event\'s field is divided into. Who is in it is on each field row\'s valuation.');
export type SportEventTierDto = z.infer<typeof SportEventTierDtoSchema>;

export const SportEventTierListResponseSchema = z.object({
  tiers: z.array(SportEventTierDtoSchema).describe('By tier number.'),
}).describe('An event\'s tiers.');
export type SportEventTierListResponse = z.infer<typeof SportEventTierListResponseSchema>;

export const ReplaceSportEventTiersRequestSchema = z.object({
  tiers: z.array(z.object({
    tierKey: z.string().min(1),
    label: z.string().min(1),
    tierNumber: z.number().int().min(1),
    defaultPickCount: z.number().int().min(1),
  })).min(1),
  reassignOrphansTo: z.string().optional().describe('A tierKey from this request; required when a removed tier still has participants in it.'),
}).describe('The event\'s full tier list, replacing the current one.');
export type ReplaceSportEventTiersRequest = z.infer<typeof ReplaceSportEventTiersRequestSchema>;

export const AutoAssignSportEventTiersRequestSchema = z.object({
  source: z.nativeEnum(TierSource).describe('What the active field is ordered by before the tiers are filled.'),
  tierSize: z.number().int().min(1).optional().describe('Participants per tier; the last tier takes the rest. Default 10.'),
}).describe('Fills the event\'s tiers from the active field.');
export type AutoAssignSportEventTiersRequest = z.infer<typeof AutoAssignSportEventTiersRequestSchema>;

export const ReplaceSportEventTierAssignmentsRequestSchema = z.object({
  assignments: z.array(z.object({
    sportEventParticipantId: z.string().uuid(),
    tierKey: z.string(),
    tierOrderIndex: z.number().int(),
  })).min(1).describe('The full desired placement, applied all or none.'),
}).describe('The drag-and-drop tier save.');
export type ReplaceSportEventTierAssignmentsRequest = z.infer<typeof ReplaceSportEventTierAssignmentsRequestSchema>;

export const AutoAssignSportEventPricesRequestSchema = z.object({
  minPrice: z.number().min(0),
  maxPrice: z.number().min(0),
}).describe('Prices the seeded, active field between minPrice and maxPrice by seed.');
export type AutoAssignSportEventPricesRequest = z.infer<typeof AutoAssignSportEventPricesRequestSchema>;

// --- SportEventParticipant — the Participant↔SportEvent edge ----------------------

export const SportEventParticipantValuationDtoSchema = z.object({
  id: z.string().uuid(),
  sportEventTierId: z.string().uuid().nullable().describe('The tier the participant is placed in; null when untiered.'),
  tierOrderIndex: z.number().int().nullable().describe('Order within the tier.'),
  tierAssignedSource: z.nativeEnum(ValuationSource).nullable(),
  price: z.number().nullable().describe('Price in a budget contest; null when unpriced.'),
  priceAssignedSource: z.nativeEnum(ValuationSource).nullable(),
}).describe('A field row\'s tier placement and price, each set independently.');
export type SportEventParticipantValuationDto = z.infer<typeof SportEventParticipantValuationDtoSchema>;

export const SportEventParticipantGolfStandingDtoSchema = z.object({
  eventScoreToPar: z.number().int(),
  eventStrokes: z.number().int(),
  currentRoundThru: z.number().int().nullable().describe('Holes completed in the current round.'),
}).describe('Golf extension of a standing: the totals it was ranked from.');

export const SportEventParticipantStandingDtoSchema = z.object({
  id: z.string().uuid(),
  position: z.number().int().nullable().describe('The participant\'s place within this event as it stands — its leaderboard position, direction-free: 1 is best in every sport. Not their rank coming in: that is the field row\'s `ranking`.'),
  displayPosition: z.string().nullable().describe('Position as shown, e.g. "T3".'),
  status: z.nativeEnum(ParticipantStandingStatus).describe('ELIMINATED covers a missed cut; golf surfaces show it as "Cut".'),
  asOf: DateTimeSchema.nullable(),
  currentRound: z.number().int().nullable(),
  golf: SportEventParticipantGolfStandingDtoSchema.nullable().describe('Present for a golf event with scores; null otherwise.'),
}).describe('A field row\'s running standing. The score lives in the sport\'s extension.');
export type SportEventParticipantStandingDto = z.infer<typeof SportEventParticipantStandingDtoSchema>;

export const SportEventParticipantGolfRoundDtoSchema = z.object({
  strokes: z.number().int(),
  scoreToPar: z.number().int(),
  thru: z.number().int().nullable(),
}).describe('Golf extension of a round: what was scored.');

export const SportEventParticipantRoundDtoSchema = z.object({
  id: z.string().uuid(),
  sportEventRoundId: z.string().uuid(),
  roundNumber: z.number().int(),
  status: z.string().describe('Progress through the round, e.g. IN_PROGRESS, COMPLETED, MISSED_CUT.'),
  completedAt: DateTimeSchema.nullable(),
  golf: SportEventParticipantGolfRoundDtoSchema.nullable().describe('Present once a golf round is scored.'),
}).describe('A field row\'s part in one round.');
export type SportEventParticipantRoundDto = z.infer<typeof SportEventParticipantRoundDtoSchema>;

export const SportEventParticipantDtoSchema = z.object({
  id: z.string().uuid().describe('Field row identifier.'),
  sportEventId: z.string().uuid(),
  participantId: z.string().uuid(),
  isActive: z.boolean().describe('Whether the participant is competing; false is withdrawn or eliminated.'),
  inactiveReason: z.nativeEnum(ParticipantInactiveReason).nullable().describe('Meaningful only when isActive is false; null means no more specific reason is recorded.'),
  ranking: z.number().int().nullable().describe('The participant\'s rank coming into this event — seeded from the provider\'s ranking (a world ranking, say), then editable. Not their place in the event: that is `standing.position`.'),
  oddsToWin: z.number().nullable(),
  seedNumber: z.number().int().nullable(),
  participant: ParticipantDtoSchema.describe('The canonical participant.'),
  valuation: SportEventParticipantValuationDtoSchema.nullable().describe('Null until a tier or price is set.'),
  standing: SportEventParticipantStandingDtoSchema.nullable().describe('Null until the participant has a scored round.'),
  rounds: z.array(SportEventParticipantRoundDtoSchema).describe('By round number.'),
  affiliatedWithSportLeague: z.boolean().describe(`Whether the participant is affiliated with the event's sport league; false flags an invite from elsewhere. ${ADMIN_ONLY}`),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('A participant on an event\'s field, with everything the event records about them.');
export type SportEventParticipantDto = z.infer<typeof SportEventParticipantDtoSchema>;

export const SportEventParticipantListResponseSchema = z.object({
  participants: z.array(SportEventParticipantDtoSchema).describe('In seed order, unseeded last.'),
}).describe('An event\'s field.');
export type SportEventParticipantListResponse = z.infer<typeof SportEventParticipantListResponseSchema>;

export const AddSportEventParticipantsRequestSchema = z.object({
  participantIds: z.array(z.string().uuid()).min(1).describe('Any participants; ones already on the field are skipped.'),
}).describe('Adds participants to the field.');
export type AddSportEventParticipantsRequest = z.infer<typeof AddSportEventParticipantsRequestSchema>;

export const AddSportEventParticipantsResponseSchema = z.object({
  added: z.number().int(),
  skipped: z.number().int().describe('Already on the field.'),
  total: z.number().int(),
}).describe('What adding participants did.');
export type AddSportEventParticipantsResponse = z.infer<typeof AddSportEventParticipantsResponseSchema>;

export const SeedSportEventParticipantsResponseSchema = z.object({
  added: z.number().int(),
  skipped: z.number().int().describe('Already on the field.'),
  total: z.number().int().describe('Active affiliations considered.'),
  seedNumbersDerived: z.number().int(),
  oddsDerived: z.number().int(),
}).describe('What seeding the field from the event\'s sport league did.');
export type SeedSportEventParticipantsResponse = z.infer<typeof SeedSportEventParticipantsResponseSchema>;

export const UpdateSportEventParticipantsRequestSchema = z.object({
  participants: z.array(z.object({
    sportEventParticipantId: z.string().uuid(),
    isActive: z.boolean().optional(),
    inactiveReason: z.nativeEnum(ParticipantInactiveReason).nullable().optional(),
    ranking: z.number().int().nullable().optional(),
    oddsToWin: z.number().nullable().optional(),
    seedNumber: z.number().int().nullable().optional(),
    price: z.number().nullable().optional().describe('A manual price; null clears it.'),
  })).min(1).describe('Field rows to patch, all or none. Omitted fields are left alone; null clears.'),
}).describe('One save of the field grid.');
export type UpdateSportEventParticipantsRequest = z.infer<typeof UpdateSportEventParticipantsRequestSchema>;

export const SportEventParticipantResponseSchema = z.object({
  participant: SportEventParticipantDtoSchema,
}).describe('One field row.');
export type SportEventParticipantResponse = z.infer<typeof SportEventParticipantResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// EventStatusDto is also the status of ingestion.dto.ts's ProviderEventDto; naming them gives the frontend
// importable unions instead of re-spelled literals.
registerSchema('EventStatusDto', EventStatusDtoSchema);
registerSchema('EventReadinessStatusDto', EventReadinessStatusDtoSchema);
registerSchema('EventReadinessReasonDto', EventReadinessReasonDtoSchema);
registerSchema('SportEventDto', SportEventDtoSchema);
registerSchema('SportEventListQuery', SportEventListQuerySchema);
registerSchema('SportEventListResponse', SportEventListResponseSchema);
registerSchema('SportEventResponse', SportEventResponseSchema);
registerSchema('CreateSportEventRequest', CreateSportEventRequestSchema);
registerSchema('CreateSportEventFromProviderEventRequest', CreateSportEventFromProviderEventRequestSchema);
registerSchema('CloneSportEventYearRequest', CloneSportEventYearRequestSchema);
registerSchema('ImportSportEventYearFromProviderRequest', ImportSportEventYearFromProviderRequestSchema);
registerSchema('ImportSportEventSkipReasonDto', ImportSportEventSkipReasonDtoSchema);
registerSchema('ImportSportEventYearFromProviderResponse', ImportSportEventYearFromProviderResponseSchema);
registerSchema('UpdateSportEventRequest', UpdateSportEventRequestSchema);
registerSchema('TransitionSportEventRequest', TransitionSportEventRequestSchema);
registerSchema('LinkSportEventScoreSourceRequest', LinkSportEventScoreSourceRequestSchema);
registerSchema('StartSportEventLiveSimulationRequest', StartSportEventLiveSimulationRequestSchema);
registerSchema('SportEventLiveSimulationResponse', SportEventLiveSimulationResponseSchema);
registerSchema('SportEventRoundDto', SportEventRoundDtoSchema);
registerSchema('SportEventRoundListResponse', SportEventRoundListResponseSchema);
registerSchema('UpdateSportEventRoundsRequest', UpdateSportEventRoundsRequestSchema);
registerSchema('SportEventTierDto', SportEventTierDtoSchema);
registerSchema('SportEventTierListResponse', SportEventTierListResponseSchema);
registerSchema('ReplaceSportEventTiersRequest', ReplaceSportEventTiersRequestSchema);
registerSchema('AutoAssignSportEventTiersRequest', AutoAssignSportEventTiersRequestSchema);
registerSchema('ReplaceSportEventTierAssignmentsRequest', ReplaceSportEventTierAssignmentsRequestSchema);
registerSchema('AutoAssignSportEventPricesRequest', AutoAssignSportEventPricesRequestSchema);
registerSchema('SportEventParticipantValuationDto', SportEventParticipantValuationDtoSchema);
registerSchema('SportEventParticipantStandingDto', SportEventParticipantStandingDtoSchema);
registerSchema('SportEventParticipantRoundDto', SportEventParticipantRoundDtoSchema);
registerSchema('SportEventParticipantDto', SportEventParticipantDtoSchema);
registerSchema('SportEventParticipantListResponse', SportEventParticipantListResponseSchema);
registerSchema('AddSportEventParticipantsRequest', AddSportEventParticipantsRequestSchema);
registerSchema('AddSportEventParticipantsResponse', AddSportEventParticipantsResponseSchema);
registerSchema('SeedSportEventParticipantsResponse', SeedSportEventParticipantsResponseSchema);
registerSchema('UpdateSportEventParticipantsRequest', UpdateSportEventParticipantsRequestSchema);
registerSchema('SportEventParticipantResponse', SportEventParticipantResponseSchema);
