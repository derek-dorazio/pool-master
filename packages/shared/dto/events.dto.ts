import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  AutoReleaseCheckOutcome,
  ContestOpening,
  ContestStatus,
  EventPricingConfigSchema,
  EventTierConfigSchema,
  ParticipantInactiveReason,
  ParticipantRoundStatus,
  ParticipantType,
  ParticipantStandingStatus,
  RaceResultStatus,
  ReleaseCheckKey,
  RoundStatus,
  ScoringFamily,
  SelectionType,
  Sport,
  SportEventStatus,
  SportEventSyncScope,
  ValuationSource,
} from '@poolmaster/shared/domain';
import { DateTimeSchema } from './common.dto';
import { ParticipantDtoSchema } from './participants.dto';
import { UploadRowResolutionDtoSchema } from './sport-catalog.dto';

/** Derived from the domain SportEventStatus constant (plans/124 §4.1) — `OFFICIAL` dropped. */
export const EventStatusDtoSchema = z.enum(SportEventStatus);
export type EventStatusDto = z.infer<typeof EventStatusDtoSchema>;

export const EventReadinessStatusDtoSchema = z.enum([
  'NOT_RELEASED',
  'PENDING_FIELD',
  'CONTEST_ELIGIBLE',
  'EVENT_STARTED',
]);
export type EventReadinessStatusDto = z.infer<typeof EventReadinessStatusDtoSchema>;

export const EventReadinessReasonDtoSchema = z.enum([
  'EVENT_NOT_RELEASED',
  'FIELD_NOT_LOADED',
  'EVENT_STARTED',
]);
export type EventReadinessReasonDto = z.infer<typeof EventReadinessReasonDtoSchema>;

/**
 * Admin-only fields are annotated, not enforced (plans/145 rule 4, DOMAIN-OPERATIONS §13):
 * every caller gets the full object. The one exception is `adminCounts`, which costs queries on
 * every read and is filled for a root admin only (#1198).
 */
const ADMIN_ONLY = '(Admin-only: operational detail no member surface reads.)';

/** A root admin's counts on an event: its release readiness and whether it can be deleted (#1198). */
export const SportEventAdminCountsDtoSchema = z.object({
  untieredParticipantCount: z.number().int().describe('Active event participants with no tier. A DRAFT event can\'t be released while any remain.'),
  unpricedParticipantCount: z.number().int().describe('Active event participants with no price. A DRAFT event can\'t be released while any remain.'),
  emptyTierLabels: z.array(z.string()).describe('Labels of the event\'s tiers no active participant is in, in tier order. A DRAFT event can\'t be released while any remain: no entry could pick from them.'),
  contestCount: z.number().int().describe('Contests run on the event, across every league; an event with any cannot be deleted.'),
}).describe('What only a root admin reads of an event: what still stops its release, and how many contests run on it.');
export type SportEventAdminCountsDto = z.infer<typeof SportEventAdminCountsDtoSchema>;

/** One ready check of a DRAFT event's release (#1823): whether it passed, and the value it was judged on. */
const releaseCheck = <K extends ReleaseCheckKey, V extends z.ZodType>(key: K, value: V, meaning: string) => z.object({
  key: z.literal(key),
  passed: z.boolean().describe('Whether the check passed.'),
  value: value.describe(meaning),
});

export const ReleaseCheckDtoSchema = z.discriminatedUnion('key', [
  releaseCheck(ReleaseCheckKey.NOT_STARTED, DateTimeSchema, 'NOT_STARTED: the event\'s start, which must still be ahead. 409 SPORT_EVENT_ALREADY_STARTED from a release once it is not.'),
  releaseCheck(ReleaseCheckKey.ROUNDS_SCHEDULED, z.number().int(), 'ROUNDS_SCHEDULED: how many rounds the event has scheduled; at least one passes.'),
  releaseCheck(ReleaseCheckKey.FIELD_LOADED, z.number().int(), 'FIELD_LOADED: how many participants are in the field; at least one passes.'),
  releaseCheck(ReleaseCheckKey.TIERS_ASSIGNED, z.number().int(), 'TIERS_ASSIGNED: how many active field participants have no tier; 0 passes.'),
  releaseCheck(ReleaseCheckKey.TIERS_FILLED, z.array(z.string()), 'TIERS_FILLED: the labels of the tiers no active participant is in, in tier order; none passes, since no entry could pick from an empty tier.'),
  releaseCheck(ReleaseCheckKey.PRICES_ASSIGNED, z.number().int().nullable(), 'PRICES_ASSIGNED: how many active field participants have no price, or null while prices have not been assigned; 0 passes.'),
  releaseCheck(ReleaseCheckKey.BRACKET_COMPLETE, z.array(z.string()), 'BRACKET_COMPLETE, only on an event played as matches: what its bracket still lacks, in words; none passes.'),
  releaseCheck(ReleaseCheckKey.CONTEST_SETUPS_ON, z.number().int(), 'CONTEST_SETUPS_ON: how many active contest setups the event\'s sport league offers; at least one passes.'),
]).describe('One ready check of a draft event\'s release, keyed by which check it is.');
export type ReleaseCheckDto = z.infer<typeof ReleaseCheckDtoSchema>;

/** A sport event's latest automatic release check (#1847), as stored: not judged again on read. */
export const SportEventAutoReleaseCheckDtoSchema = z.object({
  checkedAt: DateTimeSchema.describe('When the hourly release sweep last judged the event.'),
  outcome: z.enum(AutoReleaseCheckOutcome).describe('RELEASED: every ready check passed and the event was released. HELD: a check failed and it stays a draft.'),
  failedChecks: z.array(z.enum(ReleaseCheckKey)).describe('The ready checks that held it, in check order; empty when RELEASED.'),
}).describe('The last automatic release try of an event: when, its result, and the checks that held it.');
export type SportEventAutoReleaseCheckDto = z.infer<typeof SportEventAutoReleaseCheckDtoSchema>;

export const SportEventContestOpeningDtoSchema = z.object({
  selectionType: z.enum(SelectionType).describe('A way to pick that the event\'s sport league offers.'),
  opening: z.enum(ContestOpening).describe('OPEN: Create contest would take a contest of this selection type on the event now. NOT_YET: the event is not released or its field is not loaded. CLOSED: the event is under way or over and this selection type can no longer start on it. A knockout under way stays OPEN to a second-chance bracket with a later round left to start at, and to squares, whose cutoff is its own game\'s kickoff; Create contest checks the chosen round or game itself.'),
  startsAtRounds: z.array(z.number().int()).describe('For BRACKET, the rounds a bracket can start at: [1] (the full bracket) before the event starts, else each later round up to the one before the final, as a second-chance bracket. Empty for every other selection type.'),
}).describe('Whether one selection type can start a contest on the event now.');
export type SportEventContestOpeningDto = z.infer<typeof SportEventContestOpeningDtoSchema>;

/**
 * The canonical SportEvent — the row plus the three things every reader of an event
 * needs and the row does not store: how many participants are loaded, and whether the
 * event is ready for contest setup (derived from its status, its start time and the
 * loaded field). One shape for every caller; it replaced EventSummaryDto and
 * AdminEventSummaryDto, which each derived the same readiness in their own mapper.
 */
export const SportEventDtoSchema = z.object({
  id: z.uuid().describe('Sport-event identifier.'),
  externalId: z.string().describe(`Provider-side event identifier used by sync operations. ${ADMIN_ONLY}`),
  providerId: z.string().describe(`Provider that emitted the event, or manual-admin for an admin-authored one. ${ADMIN_ONLY}`),
  sport: z.enum(Sport).describe('Sport the event belongs to.'),
  name: z.string().describe('Event name shown in contest and event selectors.'),
  venue: z.string().nullable().describe('Venue name when known; null otherwise.'),
  location: z.string().nullable().describe('Human-readable location when known; null otherwise.'),
  status: EventStatusDtoSchema.describe('Event lifecycle status.'),
  startDate: DateTimeSchema.describe('Scheduled or actual start time.'),
  endDate: DateTimeSchema.nullable().describe('Scheduled or actual end time when known; null otherwise.'),
  rounds: z.number().int().nullable().describe('Number of rounds when the format has them; null otherwise.'),
  roundsPar: z.number().int().nullable().describe('Par for every round, when an admin set it. Null: contest scoring derives each round\'s par from the field\'s finished rounds. Contest scoring uses it to turn an unplayed round\'s 80 strokes into to-par.'),
  participantCount: z.number().int().nullable().describe('Field size the provider reports, when it reports one; null otherwise.'),
  loadedParticipantCount: z.number().int().describe('Number of event participants currently persisted for the event.'),
  pricing: EventPricingConfigSchema.nullable().describe('The values the field was last priced with for budget contests, or null until prices are assigned. Locked at release; its salaryCap is the cap of every budget contest on the event.'),
  tierLayout: EventTierConfigSchema.nullable().describe('The tier layout the field was last auto-tiered with: its sport league\'s tier profile at the time, with any tier size an admin sent instead. Null until the field is first auto-tiered. Hand placements do not change it.'),
  readinessStatus: EventReadinessStatusDtoSchema.describe('Contest-setup readiness right now.'),
  readinessReasons: z.array(EventReadinessReasonDtoSchema).describe('Why the event is or is not contest-eligible right now: not released yet (DRAFT), no field loaded, or already started.'),
  contestEligible: z.boolean().describe('Whether a contest can be created on the event right now: it is released, its field is loaded, and it has not started.'),
  contestOpenings: z.array(SportEventContestOpeningDtoSchema).describe('One row per selection type the event\'s sport league offers, in the order it offers them: whether that selection type can start a contest on the event now. Contest setup lists an event under a selection type only when its row is OPEN.'),
  tiersLocked: z.boolean().describe('Whether the event\'s tiers and prices are locked: true once it is released (#431). A tier or price write on a locked event is refused with 409 SPORT_EVENT_TIERS_LOCKED.'),
  eventSeriesId: z.uuid().describe('The recurring tournament (event series) this is one edition of. One edition of a series per Season.'),
  sportLeagueSeasonId: z.uuid().describe('The Season the event is played in (SportLeagueSeasonDto).'),
  championshipYear: z.number().int().describe('The year the event\'s Season is named for: 2025 for the NFL 2025 Season\'s Super Bowl, played in February 2026; 2026 for an NBA 2025-26 game. Read through the Season.'),
  sportLeagueId: z.uuid().describe('The sport league the event\'s series belongs to. Read through the series, not stored on the event.'),
  participantType: z.enum(ParticipantType).nullable().describe('Who competes, when the event\'s sport league overrides its sport. Null competes as the sport does. Read through the series\' sport league.'),
  scoringFamily: z.enum(ScoringFamily).nullable().describe('How the event is scored, when its sport league overrides its sport. Null scores as the sport does. Read through the series\' sport league.'),
  syncScope: z.enum(SportEventSyncScope).describe(`How much provider data this event accepts on sync. ${ADMIN_ONLY}`),
  providerSynced: z.boolean().describe(`Whether the event's details come from its provider's sync (ADR 0011): its sport league's event sync names a provider and the event is linked to that provider for scores. The provider wins over an edit to such an event's name, venue and dates, so they are shown read-only. ${ADMIN_ONLY}`),
  autoLifecycleEnabled: z.boolean().describe(`Whether the lifecycle scheduler may move this event's status. ${ADMIN_ONLY}`),
  tierCount: z.number().int().describe('Pick tiers defined for the event. A tiered contest\'s entry picks this many tiers times the contest\'s picksPerTier.'),
  releaseChecks: z.array(ReleaseCheckDtoSchema).nullable().describe('A DRAFT event\'s ready checks, every one judged now, in a fixed order; a check that does not apply to the event is left out. The automatic release passes only when every check passes; a root admin\'s release is refused only by the checks other than ROUNDS_SCHEDULED and CONTEST_SETUPS_ON. Filled on a root admin\'s read of the one event; null on lists, on an admin action\'s answer, for anyone but a root admin, and once the event is released.'),
  lastAutoReleaseCheck: SportEventAutoReleaseCheckDtoSchema.nullable().describe(`The latest automatic release try, as the sweep stored it, so a page shows the last try without judging the checks again. Null until the first try, and once a root admin releases the event by hand. The checks as they stand now are releaseChecks. ${ADMIN_ONLY}`),
  adminCounts: SportEventAdminCountsDtoSchema.nullable().describe('The root admin\'s counts: release readiness and the contest count across every league. Null for anyone but a root admin, whose reads alone count them.'),
  allowedTransitions: z.array(EventStatusDtoSchema).describe(`Statuses the event may move to next, from the declared transition map. ${ADMIN_ONLY}`),
  createdAt: DateTimeSchema.describe('When the event row was created.'),
  updatedAt: DateTimeSchema.describe('When the event row was last updated.'),
}).describe('A real-world event a contest can be run on — a golf tournament, a race, a match.');
export type SportEventDto = z.infer<typeof SportEventDtoSchema>;

/** Filters narrow the list; nothing pages it (§16). One of sport, sportLeagueId and sportLeagueSeasonId is required (#1180). */
export const SportEventListQuerySchema = z.object({
  sport: z.enum(Sport).optional().describe('Only events of this sport.'),
  status: z.array(EventStatusDtoSchema).optional().describe('Only events in one of these lifecycle statuses: repeat the parameter for several. Contest setup asks for the statuses an event can still take a contest in.'),
  sportLeagueId: z.uuid().optional().describe('Only events of this sport league\'s series.'),
  sportLeagueSeasonId: z.uuid().optional().describe('Only events of this Season (SportLeagueSeasonDto).'),
  q: z.string().optional().describe('Case-insensitive substring of the event name.'),
}).describe('Filters for the sport-event list. At least one of sport, sportLeagueId and sportLeagueSeasonId is required.');
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
  sportLeagueId: z.uuid().describe('The sport league the event runs on; it decides the sport. The event\'s series is found or created in it by name, and the event is in its current Season: 422 SPORT_LEAGUE_HAS_NO_SEASON when it has none; 409 EVENT_EDITION_ALREADY_EXISTS when the series already has an edition in it.'),
  name: z.string().min(1),
  venue: z.string().optional(),
  location: z.string().optional(),
  startDate: DateTimeSchema,
  endDate: DateTimeSchema.optional(),
  rounds: z.number().int().min(1).optional().describe('Round count; omitted, the sport\'s default round count (4 for golf).'),
  autoLifecycleEnabled: z.boolean().optional(),
}).describe('An admin-authored event. Created DRAFT with its default rounds and tiers, accepting no provider data; commissioners see it once it is released.');
export type CreateSportEventRequest = z.infer<typeof CreateSportEventRequestSchema>;

export const CreateSportEventFromProviderEventRequestSchema = z.object({
  sportLeagueId: z.uuid().describe('The sport league the event runs on; it decides the sport. The event is in its current Season: 422 SPORT_LEAGUE_HAS_NO_SEASON when it has none; 409 EVENT_EDITION_ALREADY_EXISTS when the series already has an edition in it.'),
  providerId: z.string().min(1),
  externalId: z.string().min(1).describe('From a provider catalog browse (listProviderCatalogEvents).'),
  rounds: z.number().int().min(1).optional().describe('Round count; omitted, the provider schedule decides.'),
}).describe('An event created from a provider event, linked to it for scores (SCORES_ONLY). Created DRAFT; the field is not touched.');
export type CreateSportEventFromProviderEventRequest = z.infer<typeof CreateSportEventFromProviderEventRequestSchema>;


/** The par range an admin may set for an event's rounds. Never above 80, so an unplayed round's 80 strokes is never under par. */
export const ROUNDS_PAR_MIN = 60;
export const ROUNDS_PAR_MAX = 80;

export const UpdateSportEventRequestSchema = z.object({
  name: z.string().min(1).optional(),
  venue: z.string().nullable().optional().describe('null clears it.'),
  location: z.string().nullable().optional().describe('null clears it.'),
  startDate: DateTimeSchema.optional(),
  endDate: z.iso.datetime().nullable().optional().describe('null clears it.'),
  rounds: z.number().int().min(1).optional(),
  roundsPar: z.number().int().min(ROUNDS_PAR_MIN).max(ROUNDS_PAR_MAX).nullable().optional()
    .describe(`Par for every round, ${ROUNDS_PAR_MIN} to ${ROUNDS_PAR_MAX}. null clears it, so contest scoring derives each round's par from the field.`),
  autoLifecycleEnabled: z.boolean().optional(),
  tellMembers: z.boolean().optional()
    .describe('false for a data correction, such as filling in the real start time of an event loaded with only its date: a released event\'s start moves without the "event moved" email to its leagues. Refused (400) when the start being moved is not the noon-UTC date-only placeholder. Defaults to true.'),
}).describe('Changes to an event; omitted fields are left alone.');
export type UpdateSportEventRequest = z.infer<typeof UpdateSportEventRequestSchema>;

export const TransitionSportEventRequestSchema = z.object({
  toStatus: EventStatusDtoSchema.describe('One of the event\'s allowedTransitions. SCHEDULED from DRAFT is the release, which has its own action (releaseEvent).'),
}).describe('Moves an event to its next lifecycle status, activating or settling its contests as that status requires.');
export type TransitionSportEventRequest = z.infer<typeof TransitionSportEventRequestSchema>;

export const LinkSportEventScoreSourceRequestSchema = z.object({
  providerId: z.string().min(1),
  externalId: z.string().min(1).describe('From a provider catalog browse.'),
}).describe('Links an event to a provider event for scores.');
export type LinkSportEventScoreSourceRequest = z.infer<typeof LinkSportEventScoreSourceRequestSchema>;

// --- SportEventRound -------------------------------------------------------------

export const SportEventRoundDtoSchema = z.object({
  id: z.uuid(),
  sportEventId: z.uuid(),
  roundNumber: z.number().int().describe('1-based; how a score names its round.'),
  scheduledDate: DateTimeSchema,
  // A fresh schema rather than DateTimeSchema.nullable(): reusing the instance makes the
  // JSON-schema output an allOf $ref without a type, which the route builder rejects.
  scheduledEndAt: z.iso.datetime().nullable(),
  status: z.enum(RoundStatus).describe('Where the round stands, read off its results: by its matches where it has any (COMPLETED once every one is finished or cancelled), otherwise by its participants\' rounds (COMPLETED once some are recorded and none is still under way). Not stored.'),
  resultCount: z.number().int().describe('Matches with a result, or participant rounds finished.'),
  completedAt: z.iso.datetime().nullable().describe('When the round\'s last result was recorded, once it is COMPLETED; null before, and for a round whose matches were all cancelled.'),
}).describe('A scheduled round of an event: its own date, and where its results stand.');
export type SportEventRoundDto = z.infer<typeof SportEventRoundDtoSchema>;

export const SportEventRoundListResponseSchema = z.object({
  rounds: z.array(SportEventRoundDtoSchema).describe('By round number.'),
}).describe('An event\'s rounds.');
export type SportEventRoundListResponse = z.infer<typeof SportEventRoundListResponseSchema>;

export const UpdateSportEventRoundsRequestSchema = z.object({
  rounds: z.array(z.object({
    roundNumber: z.number().int(),
    scheduledDate: DateTimeSchema,
    scheduledEndAt: z.iso.datetime().nullable().optional().describe('Omitted keeps it; null clears it.'),
  })).min(1).describe('Existing rounds to reschedule, all or none. Never creates a round.'),
}).describe('How a rain delay or an irregular schedule is recorded.');
export type UpdateSportEventRoundsRequest = z.infer<typeof UpdateSportEventRoundsRequestSchema>;

// --- The contests on an event (#1889) -------------------------------------------

export const SportEventContestDtoSchema = z.object({
  id: z.uuid().describe('Contest identifier.'),
  name: z.string().describe('The contest\'s name, as its league named it.'),
  status: z.enum(ContestStatus).describe('The contest\'s lifecycle status: DRAFT is shown as Set up, OPEN as Open, ACTIVE as Live, COMPLETED as Final.'),
  leagueId: z.uuid().describe('The customer league that runs the contest.'),
  leagueCode: z.string().describe('That league\'s code, which its pages\' links carry.'),
  leagueName: z.string().describe('That league\'s name.'),
  contestTemplateId: z.uuid().nullable().describe('The contest template the contest was set up from; null for one set up without a template.'),
  contestTemplateName: z.string().nullable().describe('That template\'s name; null with contestTemplateId.'),
  entryCount: z.number().int().describe('Entries in the contest, across every team.'),
  createdAt: DateTimeSchema.describe('When the contest was created.'),
}).describe('A customer contest run on the event, as the root admin\'s Event page lists it.');
export type SportEventContestDto = z.infer<typeof SportEventContestDtoSchema>;

export const SportEventContestListResponseSchema = z.object({
  contests: z.array(SportEventContestDtoSchema).describe('Every contest on the event, across every league, newest first. Never paged.'),
}).describe('The customer contests on one event.');
export type SportEventContestListResponse = z.infer<typeof SportEventContestListResponseSchema>;

// --- SportEventTier --------------------------------------------------------------

export const SportEventTierDtoSchema = z.object({
  id: z.uuid(),
  sportEventId: z.uuid(),
  tierKey: z.string().describe('Stable key; assignments name a tier by it.'),
  label: z.string(),
  tierNumber: z.number().int().describe('Order among the event\'s tiers; 1 first.'),
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
  })).min(1),
  reassignOrphansTo: z.string().optional().describe('A tierKey from this request; where participants in a removed tier go once a tier was placed by hand, and required then when a removed tier still has participants. Ignored otherwise: the field is placed in the new tiers afresh.'),
}).describe('The event\'s full tier list, replacing the current one.');
export type ReplaceSportEventTiersRequest = z.infer<typeof ReplaceSportEventTiersRequestSchema>;

export const AutoAssignSportEventTiersRequestSchema = z.object({
  tierSize: z.number().int().min(1).optional().describe('Participants per tier but the last, instead of the sport league\'s tier profile\'s; the last tier takes the rest, or up to the profile\'s cap. Omitted: an event with its profile\'s tier count gets the profile\'s tier size (10 for golf\'s six tiers of ten) while the field reaches the last tier; any other tier count, or a smaller field, gets the active field spread evenly over its tiers, larger tiers first (22 on four tiers is 6/6/5/5).'),
}).describe('Fills the event\'s tiers from the active field, in the order auto-assigned prices use too (#1807): odds, then seed, then rank, decided for the whole field by the first value every participant has, then name.');
export type AutoAssignSportEventTiersRequest = z.infer<typeof AutoAssignSportEventTiersRequestSchema>;

export const ReplaceSportEventTierAssignmentsRequestSchema = z.object({
  assignments: z.array(z.object({
    sportEventParticipantId: z.uuid(),
    tierKey: z.string(),
    tierOrderIndex: z.number().int(),
  })).min(1).describe('The full desired placement, applied all or none.'),
}).describe('The drag-and-drop tier save.');
export type ReplaceSportEventTierAssignmentsRequest = z.infer<typeof ReplaceSportEventTierAssignmentsRequestSchema>;

export const AutoAssignSportEventPricesRequestSchema = EventPricingConfigSchema.describe(
  'Prices the active field on the budget curve with these values, best seed first and golfers with no seed last, and records them on the event as its pricing. The values usually come from a Budget pricing profile, possibly changed.',
);
export type AutoAssignSportEventPricesRequest = z.infer<typeof AutoAssignSportEventPricesRequestSchema>;

// --- SportEventParticipant — the Participant↔SportEvent edge ----------------------

export const SportEventParticipantValuationDtoSchema = z.object({
  id: z.uuid(),
  sportEventTierId: z.uuid().nullable().describe('The tier the participant is placed in; null when untiered.'),
  tierOrderIndex: z.number().int().nullable().describe('Order within the tier.'),
  tierAssignedSource: z.enum(ValuationSource).nullable(),
  price: z.number().nullable().describe('Price in a budget contest; null when unpriced.'),
  priceAssignedSource: z.enum(ValuationSource).nullable(),
}).describe('A field row\'s tier placement and price, each set independently.');
export type SportEventParticipantValuationDto = z.infer<typeof SportEventParticipantValuationDtoSchema>;

export const SportEventParticipantGolfStandingDtoSchema = z.object({
  eventScoreToPar: z.number().int(),
  eventStrokes: z.number().int(),
  currentRoundThru: z.number().int().nullable().describe('Holes completed in the current round.'),
}).describe('Golf extension of a standing: the totals it was ranked from.');

export const SportEventParticipantStandingDtoSchema = z.object({
  id: z.uuid(),
  position: z.number().int().nullable().describe('The participant\'s place within this event as it stands — its leaderboard position, direction-free: 1 is best in every sport. Not their rank coming in: that is the field row\'s `ranking`.'),
  displayPosition: z.string().nullable().describe('Position as shown, e.g. "T3".'),
  status: z.enum(ParticipantStandingStatus).describe('ELIMINATED covers a missed cut; golf surfaces show it as "Cut".'),
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
  id: z.uuid(),
  sportEventRoundId: z.uuid(),
  roundNumber: z.number().int(),
  status: z.enum(ParticipantRoundStatus).describe('Progress through the round.'),
  completedAt: DateTimeSchema.nullable(),
  golf: SportEventParticipantGolfRoundDtoSchema.nullable().describe('Present once a golf round is scored.'),
}).describe('A field row\'s part in one round.');
export type SportEventParticipantRoundDto = z.infer<typeof SportEventParticipantRoundDtoSchema>;

export const SportEventParticipantRaceResultDtoSchema = z.object({
  finishPosition: z.number().int().min(1).nullable().describe('Finishing place, 1 for the winner; runners in a dead heat share a place. Set only when resultStatus is FINISHED; null until entered.'),
  startPosition: z.number().int().min(1).nullable().describe('Post position (or grid slot, or starting spot); null when not entered.'),
  resultStatus: z.enum(RaceResultStatus).describe('How the race ended for this runner. Every status but FINISHED scores the contest\'s "did not finish" points.'),
  isOfficial: z.boolean().describe('Whether the race\'s result is official. Contest scoring counts a result only once it is.'),
  riderName: z.string().nullable().describe('The jockey (or rider) for this start; null when not entered. The trainer is the participant\'s teamAffiliation.'),
}).describe('Finish-position extension of a field row: how one runner\'s race ended, as an admin entered it.');
export type SportEventParticipantRaceResultDto = z.infer<typeof SportEventParticipantRaceResultDtoSchema>;

export const SportEventParticipantDtoSchema = z.object({
  id: z.uuid().describe('Field row identifier.'),
  sportEventId: z.uuid(),
  participantId: z.uuid(),
  isActive: z.boolean().describe('Whether the participant is competing; false is withdrawn or eliminated.'),
  inactiveReason: z.enum(ParticipantInactiveReason).nullable().describe('Meaningful only when isActive is false; null means no more specific reason is recorded.'),
  ranking: z.number().int().nullable().describe('The participant\'s rank coming into this event — seeded from the provider\'s ranking (a world ranking, say), then editable. Not their place in the event: that is `standing.position`.'),
  oddsToWin: z.number().nullable(),
  seedNumber: z.number().int().nullable(),
  isPlayInPlace: z.boolean().describe('Whether this bracket place stands for a play-in pairing ("Texas / Xavier") still to be filled with its winner. Always false on an event that plays no bracket.'),
  participant: ParticipantDtoSchema.describe('The canonical participant.'),
  valuation: SportEventParticipantValuationDtoSchema.nullable().describe('Null until a tier or price is set.'),
  standing: SportEventParticipantStandingDtoSchema.nullable().describe('Null until the participant has a scored round, or a race result.'),
  rounds: z.array(SportEventParticipantRoundDtoSchema).describe('By round number.'),
  race: SportEventParticipantRaceResultDtoSchema.nullable().describe('Present once a race result is entered for a finish-position event (a horse race); null otherwise.'),
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
  participantIds: z.array(z.uuid()).min(1).describe('Any participants; ones already on the field are skipped.'),
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

/** The largest value the 32-bit integer columns behind ranking and seed number can hold (#437). */
const MAX_INT32 = 2147483647;

/** The field-row values an admin patches — by the grid save and by the field upload alike. */
const SportEventParticipantPatchShape = {
  isActive: z.boolean().optional(),
  inactiveReason: z.enum(ParticipantInactiveReason).nullable().optional(),
  ranking: z.number().int().min(1).max(MAX_INT32).nullable().optional(),
  oddsToWin: z.number().nullable().optional(),
  seedNumber: z.number().int().min(1).max(MAX_INT32).nullable().optional(),
};

export const UpdateSportEventParticipantsRequestSchema = z.object({
  participants: z.array(z.object({
    sportEventParticipantId: z.uuid(),
    ...SportEventParticipantPatchShape,
    price: z.number().nullable().optional().describe('A manual price; null clears it.'),
    tierKey: z.string().min(1).optional().describe('Moves the participant last into this tier as a manual tier, in the same save. Only before release; 422 UNKNOWN_TIER_KEY for a key the event has no tier for.'),
    isPlayInPlace: z.boolean().optional().describe('Marks the row as a play-in place, standing for a pairing until its winner fills it. Only on a bracket event before release.'),
  })).min(1).describe('Field rows to patch, all or none. Omitted fields are left alone; null clears.'),
}).describe('One save of the field grid.');
export type UpdateSportEventParticipantsRequest = z.infer<typeof UpdateSportEventParticipantsRequestSchema>;

// --- Field upload (#128): adjust the field's rankings, odds, seeds and withdrawals ------

export const SportEventParticipantUploadRowSchema = z.object({
  participantId: z.string().optional(),
  externalId: z.string().optional().describe('The participant\'s canonical external id.'),
  playerName: z.string().optional(),
  ...SportEventParticipantPatchShape,
}).describe(
  'One uploaded field row. The first identifier present is used — participantId, then externalId, then an exact '
  + 'case-insensitive playerName — matched only within the event\'s field, with no fallback to the next. '
  + 'Each value omitted is left alone; null clears it.',
);
export type SportEventParticipantUploadRow = z.infer<typeof SportEventParticipantUploadRowSchema>;

export const SportEventParticipantUploadRequestSchema = z.object({
  rows: z.array(SportEventParticipantUploadRowSchema).min(1).max(500),
}).describe('A field upload: changes to participants already on the event\'s field. It never adds one.');
export type SportEventParticipantUploadRequest = z.infer<typeof SportEventParticipantUploadRequestSchema>;

export const SportEventParticipantUploadValuesDtoSchema = z.object({
  isActive: z.boolean(),
  inactiveReason: z.enum(ParticipantInactiveReason).nullable(),
  ranking: z.number().int().nullable(),
  oddsToWin: z.number().nullable(),
  seedNumber: z.number().int().nullable(),
}).describe('The values a field upload can change on a field row.');

export const SportEventParticipantUploadChangeDtoSchema = z.enum(['UPDATE', 'UNCHANGED'])
  .describe('What applying the row would do to its field row: change a value, or nothing.');

export const SportEventParticipantUploadRowErrorDtoSchema = z.enum(['DUPLICATE_PARTICIPANT'])
  .describe('Why a row that resolved still cannot be applied. DUPLICATE_PARTICIPANT: another row in the upload names the same participant.');

export const SportEventParticipantUploadPreviewRowDtoSchema = z.object({
  row: SportEventParticipantUploadRowSchema,
  resolution: UploadRowResolutionDtoSchema.describe('MATCHED: one participant on the field. UNRESOLVED: none on the field — the upload never adds one, so load the field from the provider first. AMBIGUOUS: several.'),
  participantId: z.uuid().nullable().describe('Set only when MATCHED.'),
  participantName: z.string().nullable().describe('Set only when MATCHED.'),
  sportEventParticipantId: z.uuid().nullable().describe('The field row it resolved to; set only when MATCHED.'),
  rowError: SportEventParticipantUploadRowErrorDtoSchema.nullable().describe('Set when a MATCHED row still cannot be applied.'),
  change: SportEventParticipantUploadChangeDtoSchema.nullable().describe('Null when the row cannot be applied.'),
  before: SportEventParticipantUploadValuesDtoSchema.nullable().describe('What is stored now; set whenever the row resolved.'),
  after: SportEventParticipantUploadValuesDtoSchema.nullable().describe('What applying would store; null when the row cannot be applied.'),
  message: z.string().nullable().describe('Why the row cannot be applied, for display; null when it can.'),
}).describe('What applying one uploaded field row would do.');
export type SportEventParticipantUploadPreviewRowDto = z.infer<typeof SportEventParticipantUploadPreviewRowDtoSchema>;

export const SportEventParticipantUploadPreviewResponseSchema = z.object({
  rows: z.array(SportEventParticipantUploadPreviewRowDtoSchema).describe('One per uploaded row, in upload order.'),
  rollup: z.object({
    total: z.number().int(),
    matched: z.number().int(),
    unresolved: z.number().int(),
    ambiguous: z.number().int(),
    duplicate: z.number().int().describe('MATCHED rows refused as DUPLICATE_PARTICIPANT.'),
    update: z.number().int().describe('Rows that would change a value.'),
    unchanged: z.number().int().describe('Rows that would change nothing.'),
  }).describe('Counts by resolution and by change. Apply succeeds only when matched equals total and duplicate is 0.'),
}).describe('A dry run of a field upload. Nothing is written.');
export type SportEventParticipantUploadPreviewResponse = z.infer<typeof SportEventParticipantUploadPreviewResponseSchema>;

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
registerSchema('SportEventAdminCountsDto', SportEventAdminCountsDtoSchema);
registerSchema('ReleaseCheckDto', ReleaseCheckDtoSchema);
registerSchema('SportEventContestOpeningDto', SportEventContestOpeningDtoSchema);
registerSchema('SportEventAutoReleaseCheckDto', SportEventAutoReleaseCheckDtoSchema);
registerSchema('SportEventDto', SportEventDtoSchema);
registerSchema('SportEventListQuery', SportEventListQuerySchema);
registerSchema('SportEventListResponse', SportEventListResponseSchema);
registerSchema('SportEventResponse', SportEventResponseSchema);
registerSchema('CreateSportEventRequest', CreateSportEventRequestSchema);
registerSchema('CreateSportEventFromProviderEventRequest', CreateSportEventFromProviderEventRequestSchema);
registerSchema('UpdateSportEventRequest', UpdateSportEventRequestSchema);
registerSchema('TransitionSportEventRequest', TransitionSportEventRequestSchema);
registerSchema('LinkSportEventScoreSourceRequest', LinkSportEventScoreSourceRequestSchema);
registerSchema('SportEventRoundDto', SportEventRoundDtoSchema);
registerSchema('SportEventRoundListResponse', SportEventRoundListResponseSchema);
registerSchema('UpdateSportEventRoundsRequest', UpdateSportEventRoundsRequestSchema);
registerSchema('SportEventContestDto', SportEventContestDtoSchema);
registerSchema('SportEventContestListResponse', SportEventContestListResponseSchema);
registerSchema('SportEventTierDto', SportEventTierDtoSchema);
registerSchema('SportEventTierListResponse', SportEventTierListResponseSchema);
registerSchema('ReplaceSportEventTiersRequest', ReplaceSportEventTiersRequestSchema);
registerSchema('AutoAssignSportEventTiersRequest', AutoAssignSportEventTiersRequestSchema);
registerSchema('ReplaceSportEventTierAssignmentsRequest', ReplaceSportEventTierAssignmentsRequestSchema);
registerSchema('EventPricingConfig', EventPricingConfigSchema);
registerSchema('EventTierConfig', EventTierConfigSchema);
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
registerSchema('SportEventParticipantUploadRequest', SportEventParticipantUploadRequestSchema);
registerSchema('SportEventParticipantUploadPreviewResponse', SportEventParticipantUploadPreviewResponseSchema);
