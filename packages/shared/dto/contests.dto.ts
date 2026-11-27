/**
 * Contest DTOs — request/response schemas for contest endpoints.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import {
  ContestEntryStatus,
  ContestStatus,
  ContestFormat,
  CupWeight,
  ParticipantScoringDefinitionIdSchema,
  ParticipantType,
  ScoringFamily,
  SeasonSlotStatus,
  SelectionType,
  SlotKind,
  Sport,
  SportEventStatus,
} from '@poolmaster/shared/domain';
import { ContestConfigurationRequestSchema } from './contest-management.dto';
import { SportEventParticipantDtoSchema } from './events.dto';

// --- Requests ---

/** 400 error code when a create request names neither a template nor a configuration. */
export const CONTEST_CONFIGURATION_REQUIRED = 'CONTEST_CONFIGURATION_REQUIRED';

/**
 * One creation path with an optional first step (plans/145 slice 3, Q6b/Q9). A template seeds the
 * configuration and `configuration`, when also supplied, replaces it; a request with neither is
 * refused, because there is no platform default. OpenAPI cannot say "at least one of these two"
 * structurally, so the published shape has both optional and the rule lives in the refine below,
 * reported as CONTEST_CONFIGURATION_REQUIRED.
 */
export const CreateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).describe('Contest name shown to commissioners and members.'),
  sportEventIds: z.array(z.uuid()).min(1).describe('The events the contest covers (#713): one for a golf or race contest, several for a majors pool or a season. All from one sport league, each released, with its field loaded and not yet started. The contest keeps them in start-date order, whatever order they are sent in.'),
  contestFormat: z.enum(ContestFormat).describe(
    'ROSTER: entries pick a lineup from the field. PREDICTION: entries pick the winners of games (#716). SQUARES: entries claim boxes of a grid on one game (#711). It must be the format the selection type plays (PICK_EM, BRACKET and SURVIVOR are PREDICTION, SQUARES is SQUARES, every other type ROSTER) and one the event\'s tournament format allows: 422 CONTEST_FORMAT_NOT_ALLOWED otherwise.',
  ),
  selectionType: z.enum(SelectionType).describe(
    'How an entry picks: the selection types with typed rules. It must match the template\'s selection type when a template is named, and the configuration\'s.',
  ),
  templateId: z.uuid().optional().describe('Template whose configuration seeds the contest. Optional: the first step of creation, not a second way to create.'),
  configuration: ContestConfigurationRequestSchema.optional().describe('The contest configuration. With a template, replaces the template\'s configuration; without one, is the configuration.'),
  startingSlotId: z.uuid().optional().describe('The Season slot the contest starts at (#2014): for a template covering one slot, the slot it covers; for one covering from a slot on, its first. Left out, the event\'s first slot the template lists. It must be one of the events\' slots the template lists: 422 CONTEST_COVERAGE_SLOT_NOT_COVERABLE otherwise, and 422 CONTEST_COVERAGE_SLOT_NOT_CHOSEN for a one-slot template on an event holding several of its slots with none chosen. An event holding none of them is refused with 422 CONTEST_COVERAGE_NO_LISTED_SLOT.'),
  sportEventRoundMatchId: z.uuid().optional().describe('A squares contest\'s game (#711): one of its event\'s games not yet kicked off. Required for SQUARES (422 CONTEST_SQUARES_GAME_REQUIRED) and refused for every other selection type; 422 CONTEST_SQUARES_GAME_INVALID for a game not of the event, cancelled, or already started.'),
}).refine(
  (request) => request.templateId !== undefined || request.configuration !== undefined,
  { message: 'Name a template, supply a configuration, or both.', params: { code: CONTEST_CONFIGURATION_REQUIRED } },
).describe('Request payload for creating a contest.');
export type CreateContestRequest = z.infer<typeof CreateContestRequestSchema>;

export const UpdateContestRequestSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  startsAt: z.iso.datetime().optional(),
  endsAt: z.iso.datetime().optional(),
}).describe('Patch payload for updating editable contest metadata.');
export type UpdateContestRequest = z.infer<typeof UpdateContestRequestSchema>;

export const UpdateContestEntryRequestSchema = z.object({
  name: z.string().trim().min(1).max(100).optional().describe('Unique entry name shown anywhere the team entry is listed.'),
  tiebreakerValue: z.number().int().nullable().optional().describe('Optional tiebreaker prediction saved on the contest entry. Refused with 400 CONTEST_FORMAT_MISMATCH on a prediction contest, whose tiebreaker is saved with its game picks (#721).'),
}).refine((value) => value.name !== undefined || value.tiebreakerValue !== undefined, {
  message: 'At least one contest entry field must be provided.',
}).describe('Request payload for updating a contest entry while the contest is still joinable.');
export type UpdateContestEntryRequest = z.infer<typeof UpdateContestEntryRequestSchema>;

// --- Response Sub-schemas ---

export const ContestSportEventDtoSchema = z.object({
  sportEventId: z.string().describe('The event.'),
  name: z.string().describe('The event\'s name.'),
  startDate: z.iso.datetime().describe('The event\'s scheduled start: when its picks close.'),
  endDate: z.iso.datetime().nullable().describe('The event\'s scheduled end when known; null otherwise. The last event\'s end is when the contest is expected to finish.'),
  status: z.enum(SportEventStatus).describe('The event\'s own status. Each event of a contest is picked, submitted, played and settled on its own (#713).'),
  participantType: z.enum(ParticipantType).describe('Who competes: teams or individuals, from the event\'s sport league. The same on every event of a contest, which covers one sport league.'),
  scoringFamily: z.enum(ScoringFamily).describe('How the event is scored, from its sport league. The same on every event of a contest, which covers one sport league.'),
  tierSetSeasonSlotId: z.uuid().nullable().optional().describe('The Season slot whose tier set a tiered or budget contest picks from on this event (#2044): the first slot the contest covers that holds a set. Its tiers and prices are read with listEventSlotTiers and listEventSlotParticipants. Null for a contest of another selection type, or an event covering no slot. Present on the one-contest read only.'),
}).describe('One event a contest covers, enough to name, order and pick it without reading the event (#713).');
export type ContestSportEventDto = z.infer<typeof ContestSportEventDtoSchema>;

export const ContestCoveredSlotDtoSchema = z.object({
  seasonSlotId: z.uuid().describe('The Season slot (SportLeagueSeasonSlotDto.id).'),
  slotDefinitionId: z.uuid().describe('Its slot definition (SportLeagueCompetitionSlot).'),
  key: z.string().describe('The definition\'s code in its league, such as WEEK_14, FINAL or MASTERS. An identifier; nothing parses it.'),
  name: z.string().nullable().describe('The league\'s proper name for the slot, such as "Super Bowl", or a test slot\'s label; null: screens use the word for its kind.'),
  slotKind: z.enum(SlotKind).describe('What kind of slot it is: a WEEK of games, a postseason ROUND, a TOURNAMENT of its own, a PLAY_IN.'),
  weekNumber: z.number().int().nullable().describe('For a WEEK slot, its week; null otherwise.'),
  status: z.enum(SeasonSlotStatus).describe('The Season slot\'s own status.'),
  startsAt: z.iso.datetime().nullable().describe('The earliest start of the slot\'s games; null until the sync has placed one.'),
  endsAt: z.iso.datetime().nullable().describe('The latest end of the slot\'s games; null until the sync has placed one.'),
  sportEventId: z.uuid().nullable().describe('The event that plays the slot, one of the contest\'s `sportEvents`; null until an event does.'),
  competitionCode: z.string().describe('The competition the slot is in, such as REGULAR or CFP; nothing parses it.'),
  competitionName: z.string().nullable().describe('That competition\'s name, such as "Bowls", when it has one.'),
}).describe('One Season slot a contest covers (#2014): what a screen names it by, its status and the event that plays it.');
export type ContestCoveredSlotDto = z.infer<typeof ContestCoveredSlotDtoSchema>;

/** Body of the commissioner's cup weight save (#841). */
export const SetContestCupWeightRequestSchema = z.object({
  cupWeight: z.enum(CupWeight).describe('How much the contest counts toward its cup and the league championship: NORMAL x1, BONUS x1.5, DOUBLE x2, NOT_COUNTED not at all.'),
}).describe('Request payload for setting how much a contest counts toward its cup and the championship.');
export type SetContestCupWeightRequest = z.infer<typeof SetContestCupWeightRequestSchema>;

export const ContestProgressDtoSchema = z.object({
  played: z.number().int().min(0).describe('How many have been played: games, weeks or events, as `unit` says.'),
  total: z.number().int().min(1).describe('How many there are, cancelled ones left out.'),
  unit: z.enum(['GAMES', 'WEEKS', 'EVENTS']).describe('What is counted: GAMES, the one event\'s games of a one-event prediction contest; WEEKS, the events of a prediction season (pick\'em, survivor); EVENTS, the events of a roster contest of several.'),
}).describe('How far a live contest has got (#1782): "9 of 14 games played", "11 of 18 weeks played".');
export type ContestProgressDto = z.infer<typeof ContestProgressDtoSchema>;

export const ContestDtoSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum([
    ContestStatus.DRAFT,
    ContestStatus.OPEN,
    ContestStatus.ACTIVE,
    ContestStatus.COMPLETED,
  ]),
  contestFormat: z.enum(Object.values(ContestFormat) as [string, ...string[]]),
  selectionType: z.enum(SelectionType),
  leagueId: z.string(),
  sportEvents: z.array(ContestSportEventDtoSchema).describe('The events that play the contest\'s covered slots, each once, in the order their slots are played (#713). One for a golf or race contest.'),
  coveredSlots: z.array(ContestCoveredSlotDtoSchema).describe('The Season slots the contest covers, in play order (#2014), fixed at creation.'),
  currentSlotId: z.uuid().nullable().describe('The covered slot the contest\'s pages open on when none is named (#2014): its first covered slot that has not started, the one being picked, else its last. A slot has started once its event has and, when its games give it a start, that start has passed. Null only for a contest that covers no slot.'),
  sport: z.enum(Sport).nullable().optional(),
  sportUrlSegment: z.string().nullable().optional().describe('The URL segment of the contest\'s sport, read through its events\' sport league: what a link to its sport\'s How to Play names it by. Null or absent as `sport` is.'),
  entryCount: z.number().optional().describe('Number of entries that have submitted at least one event. Present on the list and single-contest reads; omitted on the contest writes.'),
  enteredSquadCount: z.number().int().min(0).optional().describe('Number of squads with at least one entry that submitted an event (#1197). Single-contest read only.'),
  allEntryCount: z.number().int().min(0).optional().describe('Every entry the contest holds, drafts included, as its entry cap counts them (#1197): before a random draw no entry is submitted. The contest is full once this reaches `entriesPerContest` (#1781). Present on the list and single-contest reads; omitted on the contest writes.'),
  myEntryIds: z.array(z.string()).optional().describe('The requester\'s own squad\'s entries in the contest, drafts included, in entry-number order (#1197). Empty without an active squad in the league. Single-contest read only.'),
  progress: ContestProgressDtoSchema.nullable().optional().describe('How far a live (ACTIVE) contest has got (#1782); null on any other status, on a one-event roster contest, and on a one-event prediction contest with fewer than two games. List read only.'),
  entriesPerContest: z.number().int().min(1).nullable().describe('The most entries the contest takes, every squad\'s drafts included: its league plan\'s cap or its expansion (#987), whichever is higher. Null for no limit.'),
  startsAt: z.iso.datetime().nullable().optional(),
  endsAt: z.iso.datetime().nullable().optional(),
  drawnAt: z.iso.datetime().nullable().optional().describe('When a random-draw contest\'s draw dealt its picks (#601). From then on its entries are closed, though it stays OPEN until its event starts. Null until then, and for every other selection type.'),
  createdAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime().optional(),
}).describe('A contest: the one shape every contest read returns (#248 collapsed the summary and detail variants, which differed by two fields).');
export type ContestDto = z.infer<typeof ContestDtoSchema>;

export const ContestEntryParticipantDetailDtoSchema = z.object({
  pickId: z.string(),
  sportEventParticipantId: z.string(),
  sportEventId: z.string().describe('The event of the contest the pick is in (#713).'),
  participantId: z.string(),
  participantName: z.string(),
  participantStatus: z.string().nullable().optional(),
  role: z.string().nullable().optional().describe('The participant\'s playing role, when known.'),
  teamAffiliation: z.string().nullable().optional(),
  pickedAt: z.iso.datetime().describe('When the participant was added to the contest entry.'),
}).describe('Contest entry participant detail. Picks remain pointers to event participants; scores are returned by the contest leaderboard endpoint.');
export type ContestEntryParticipantDetailDto = z.infer<typeof ContestEntryParticipantDetailDtoSchema>;

export const ContestEntryEventDtoSchema = z.object({
  sportEventId: z.string().describe('One event of the entry\'s contest.'),
  status: z.enum(ContestEntryStatus).describe('DRAFT until the owner submits a complete lineup for this event; only a SUBMITTED event counts on the leaderboard, in standings and at settlement (#481, per event since #713).'),
  submittedAt: z.iso.datetime().nullable().describe('When the event\'s picks were submitted; null while a draft.'),
}).describe('An entry\'s status in one event of its contest (#713): "submit week 6".');
export type ContestEntryEventDto = z.infer<typeof ContestEntryEventDtoSchema>;

export const ContestEntryDtoSchema = z.object({
  id: z.string(),
  contestId: z.string(),
  squadId: z.string(),
  squadName: z.string(),
  entryNumber: z.number().int().min(1),
  name: z.string(),
  events: z.array(ContestEntryEventDtoSchema).describe('The entry\'s status in each event of its contest, in the contest\'s event order.'),
  tiebreakerValue: z.number().int().nullable().optional(),
  picksCount: z.number().int().min(0).describe('Number of roster picks currently saved on this entry. Always populated, even when picks are hidden from non-owners.'),
  createdAt: z.iso.datetime().describe('When the contest entry was created.'),
  updatedAt: z.iso.datetime().describe('When the contest entry was last updated.'),
  participants: z.array(ContestEntryParticipantDetailDtoSchema).optional().describe('The entry\'s picked participants, each naming its event. To anyone but the owning squad only the picks of events whose picks are revealed are listed. Omitted on the entry writes, which return the entry without them.'),
}).describe('A contest entry: the one shape every entry read and write returns (#248 collapsed the summary and detail variants, which differed by `participants`).');
export type ContestEntryDto = z.infer<typeof ContestEntryDtoSchema>;


/**
 * The contest leaderboard (#248). Cross-sport: an entry's standing and its picks are the same
 * objects in every sport, and the sport-shaped value — golf's total against par, a race's
 * points — is the entry standing's scoring-family extension (`golf` or `race`), as on
 * `ContestEntryStanding` in persistence. The event's field is published as the event's own
 * canonical `SportEventParticipantDto` rows, not a second leaderboard-shaped copy of them: round
 * scores, race results, standings and their extensions come from there, and a client renders
 * them through `PARTICIPANT_SCORING_DEFINITIONS[scoringDefinitionId]`.
 */
export const ScoredContestEntryPickGolfDtoSchema = z.object({
  scoreToPar: z.number().int().nullable().describe('The golfer\'s score in this contest against par: their event total, with every round they did not play scored as 80 strokes (80 minus that round\'s par). Differs from the event standing\'s eventScoreToPar only when unplayedRoundNumbers is non-empty. Null while unscored.'),
  unplayedRoundNumbers: z.array(z.number().int().min(1)).describe('Rounds scored as 80 strokes because the golfer did not play them: cut, withdrawn, removed from the field, or no score once the field moved past the round. Empty when none.'),
}).describe('Golf extension of a scored pick: the golfer\'s contest score and the rounds in it scored as 80 strokes.');
export type ScoredContestEntryPickGolfDto = z.infer<typeof ScoredContestEntryPickGolfDtoSchema>;

export const ScoredContestEntryPickRaceDtoSchema = z.object({
  points: z.number().int().nullable().describe('The runner\'s points in this contest: the contest\'s points table at its finishing place (0 beyond the table), or its "did not finish" points when it did not finish, was disqualified, did not start or was scratched. Null until the race result is official.'),
}).describe('Finish-position extension of a scored pick: the runner\'s points from the contest\'s points table.');
export type ScoredContestEntryPickRaceDto = z.infer<typeof ScoredContestEntryPickRaceDtoSchema>;

export const ScoredContestEntryPickKnockoutDtoSchema = z.object({
  points: z.number().int().nullable().describe('The team\'s points in this contest: each round it won a match in scores that round\'s value, plus the upset bonus when the contest has one on. A bye counts as a win: a team placed straight into a later round scores each skipped round\'s value once that round is decided, with no upset bonus. Null until the bracket has a result.'),
  wins: z.number().int().min(0).describe('Matches the team has won, each bye whose skipped round is decided counted as a win.'),
  upsetBonusPoints: z.number().int().min(0).describe('The part of the points that is upset bonus; 0 when the bonus is off.'),
  isAlive: z.boolean().describe('False once the team has lost a match.'),
}).describe('Head-to-head extension of a scored pick: the team\'s knockout points and how they came about.');
export type ScoredContestEntryPickKnockoutDto = z.infer<typeof ScoredContestEntryPickKnockoutDtoSchema>;

export const ScoredContestEntryPickDtoSchema = z.object({
  pickId: z.string().describe('ContestEntryPick row identifier.'),
  sportEventParticipantId: z.string().describe('The picked field row. Its scores are the matching entry of `participants`; a pick is a pointer, not a copy.'),
  pickedAt: z.iso.datetime().describe('When this participant was picked.'),
  slot: z.number().int().nullable().describe('Deprecated, always null: picks have no slot column (#632, #2042). Kept because a stored leaderboard is served by tasks on older code during a rolling deploy, and a board format may only add fields (rules/service-rules.md, Response Rules).'),
  isCounting: z.boolean().describe('Whether this pick currently counts toward the entry\'s total under the counting rule.'),
  isDropped: z.boolean().describe('Whether this scored pick is currently dropped because better picks fill the counting places.'),
  golf: ScoredContestEntryPickGolfDtoSchema.nullable().describe('Present for a golf contest; null otherwise.'),
  race: ScoredContestEntryPickRaceDtoSchema.nullable().describe('Present for a finish-position contest (a horse race); null otherwise.'),
  knockout: ScoredContestEntryPickKnockoutDtoSchema.nullable().describe('Present for a head-to-head contest (a basketball bracket); null otherwise.'),
}).describe('One pick on a contest entry, with whether it counts.');
export type ScoredContestEntryPickDto = z.infer<typeof ScoredContestEntryPickDtoSchema>;

export const ContestEntryEventResultDtoSchema = z.object({
  sportEventId: z.string().describe('The event.'),
  totalScore: z.number().int().nullable().describe('The entry\'s score in the event: the sum of its counting picks\' contest scores there, or, for an event it missed, a missed lineup\'s score (golf: 80 strokes a round for each counted pick). Null until a pick is scored.'),
  position: z.number().int().nullable().describe('The entry\'s rank in the event, 1 best; null while unscored. Once the event is settled, an entry that missed it ranks too, scored as a missed lineup (#714).'),
  displayPosition: z.string().nullable().describe('Position as shown, "T" prefixed for a tie.'),
}).describe('An entry\'s result in one event of its contest (#713): one week\'s score, one major\'s.');
export type ContestEntryEventResultDto = z.infer<typeof ContestEntryEventResultDtoSchema>;

export const ContestEntryStandingDtoSchema = z.object({
  entryId: z.string().describe('Contest entry identifier.'),
  entryName: z.string().describe('Entry display name.'),
  entryNumber: z.number().int().min(1).describe('Entry number, for squads allowed several entries.'),
  squadId: z.string().describe('Squad identifier.'),
  squadName: z.string().describe('Squad display name.'),
  position: z.number().int().nullable().describe('The entry\'s rank in the contest by its total, direction-free: 1 is best in every sport. Null while unscored.'),
  displayPosition: z.string().nullable().describe('Position as shown, "T" prefixed for a tie.'),
  countingPickLimit: z.number().int().min(0).describe('How many picks count toward the shown event\'s score under the counting rule: its N.'),
  scoredPickCount: z.number().int().min(0).describe('How many of the entry\'s picks in the shown event currently have an event standing.'),
  totalScore: z.number().int().nullable().describe('The entry\'s contest total, in the unit of the response\'s scoring definition (a golf to-par total, a race\'s points): the sum of its scores in the events it submitted (#713). In a one-event contest, that event\'s score. Null until a pick is scored.'),
  events: z.array(ContestEntryEventResultDtoSchema).describe('The entry\'s score and place in each event it submitted whose picks are revealed, in the contest\'s event order.'),
  picks: z.array(ScoredContestEntryPickDtoSchema).describe('The entry\'s picks in the shown event, counting picks first; empty when it did not submit that event.'),
}).describe('One entry\'s standing in a contest leaderboard: its contest total, its result in each event, and its picks in the shown event. Each pick\'s score lives in its sport\'s block.');
export type ContestEntryStandingDto = z.infer<typeof ContestEntryStandingDtoSchema>;

export const ContestCountingRuleDtoSchema = z.object({
  type: z.literal('BEST_N').describe('Sum the best N picks\' totals for each entry.'),
  count: z.number().int().min(1).describe('N: how many picks count toward each entry\'s total.'),
  pickCount: z.number().int().min(1).nullable().describe('M: how many picks a full entry holds under the contest\'s rules, so a client can state "best N of M" once (#1740). A tiered entry\'s is its tiers in play times its picks per tier. Null where it is not known, such as a tiered event not yet tiered.'),
}).describe('How an entry\'s picks combine into its total.');
export type ContestCountingRuleDto = z.infer<typeof ContestCountingRuleDtoSchema>;

export const ContestLeaderboardResponseSchema = z.object({
  contestId: z.string().describe('Contest whose leaderboard was requested.'),
  sportEventId: z.string().describe('The event whose field and picks are shown: the one asked for, else the contest\'s latest event whose picks are revealed.'),
  sport: z.enum(Sport).describe(
    'Sport of the event the contest runs on. A client resolves it through the shared sport registry to the scoring family and vocabulary it renders the leaderboard with.',
  ),
  participantType: z.enum(ParticipantType).describe('Who competes in the shown event, from its sport league. A client reads the event\'s definition from the sport and these two.'),
  scoringFamily: z.enum(ScoringFamily).describe('How the shown event is scored, from its sport league.'),
  scoringDefinitionId: ParticipantScoringDefinitionIdSchema.describe(
    'The participant scoring definition this leaderboard was ranked by. Positions are already ranked and direction-free; the id keys the client\'s own PARTICIPANT_SCORING_DEFINITIONS to render scores and rounds.',
  ),
  countingRule: ContestCountingRuleDtoSchema,
  upsetBonus: z.boolean().describe('Whether the contest scores an upset bonus (#1748): a knockout contest whose bonus rule is on, so a client shows each pick\'s bonus in its own column even before any team has earned one. False for every other contest.'),
  participants: z.array(SportEventParticipantDtoSchema).describe('The shown event\'s field, as the event publishes it: in seed order, unseeded last. Picks point into it by sportEventParticipantId.'),
  entries: z.array(ContestEntryStandingDtoSchema).describe('Contest entries that submitted at least one revealed event, best total first.'),
  asOf: z.iso.datetime().nullable().describe('Latest standing timestamp the leaderboard reflects, or null when there is none.'),
}).describe(
  'Member-facing contest leaderboard. Live, entry standings are computed from the events\' standings; a completed event answers from the standings frozen when it settled, and a COMPLETED contest\'s totals are the ones frozen at its settlement.',
);

export const ContestLeaderboardQuerySchema = z.object({
  sportEventId: z.uuid().optional().describe('The contest event whose field and picks to show; its picks must be revealed. Defaults to the contest\'s latest event whose picks are revealed.'),
}).describe('Optional query parameters for the contest leaderboard.');
export type ContestLeaderboardQuery = z.infer<typeof ContestLeaderboardQuerySchema>;
export type ContestLeaderboardResponse = z.infer<typeof ContestLeaderboardResponseSchema>;

// --- Responses ---

export const ContestResponseSchema = z.object({
  contest: ContestDtoSchema,
}).describe('Single-contest response. A contest\'s rules are on the contest-management read (commissioners) and the selection-state read (entries).');
export type ContestResponse = z.infer<typeof ContestResponseSchema>;

export const ContestListResponseSchema = z.object({
  contests: z.array(ContestDtoSchema),
}).describe('Contest-list response.');
export type ContestListResponse = z.infer<typeof ContestListResponseSchema>;

export const ListContestsQuerySchema = z.object({
  finishedYear: z.number().int().min(2000).max(9999).optional().describe('List the COMPLETED contests that went final in this championship year, US Eastern, such as 2025, instead of the current ones. The years with any are `listContestFinishedYears`.'),
}).describe('Which of a league\'s contests to list: the current ones by default, or one year\'s finished ones.');
export type ListContestsQuery = z.infer<typeof ListContestsQuerySchema>;

export const ContestFinishedYearsResponseSchema = z.object({
  years: z.array(z.number().int()).describe('Each championship year, US Eastern, a COMPLETED contest of the league went final in, newest first. Empty when none has finished.'),
}).describe('The years a league has finished contests in.');
export type ContestFinishedYearsResponse = z.infer<typeof ContestFinishedYearsResponseSchema>;

export const ContestEntryResponseSchema = z.object({
  contestId: z.string().describe('Contest that owns the entry.'),
  entry: ContestEntryDtoSchema,
}).describe('Single contest-entry response.');
export type ContestEntryResponse = z.infer<typeof ContestEntryResponseSchema>;

export const ContestEntryDetailResponseSchema = z.object({
  contestId: z.string().describe('Contest that owns the entry.'),
  picksRevealed: z.boolean().describe('Whether any of the contest\'s events has its picks visible to non-owners: once the contest is live and that event has started, or once a random draw has dealt.'),
  entry: ContestEntryDtoSchema,
}).describe('Expanded contest-entry detail response.');
export type ContestEntryDetailResponse = z.infer<typeof ContestEntryDetailResponseSchema>;

export const ContestEntryListResponseSchema = z.object({
  contestId: z.string().describe('Contest whose entries are being returned.'),
  total: z.number().describe('Total number of entries in the contest.'),
  picksRevealed: z.boolean().describe('Whether any of the contest\'s events has its picks visible to non-owners: once the contest is live and that event has started, or once a random draw has dealt.'),
  entries: z.array(ContestEntryDtoSchema).describe('Entries for the contest, the requester\'s own squad\'s first. Each entry lists participants[]: all of them for the requester\'s own entries, and only the revealed events\' picks for everyone else\'s. The requester\'s entry ids alone are `myEntryIds` on `getContest`.'),
}).describe('Contest-entry list response.');
export type ContestEntryListResponse = z.infer<typeof ContestEntryListResponseSchema>;

export const ContestEntryPlaceDtoSchema = z.object({
  entryId: z.string().describe('The entry placed: one of the response\'s `entries`.'),
  position: z.number().int().min(1).describe('The entry\'s place in its contest as its leaderboard stands, 1 best in every sport; entries level share it.'),
  displayPosition: z.string().describe('The place as the leaderboard shows it, "T3" when shared.'),
}).describe('One entry\'s place in a live contest, the same place its leaderboard shows (#1565).');
export type ContestEntryPlaceDto = z.infer<typeof ContestEntryPlaceDtoSchema>;

export const MyContestEntriesResponseSchema = z.object({
  entries: z.array(ContestEntryDtoSchema).describe('The requester\'s own squad\'s entries, drafts included, in each of the league\'s OPEN and ACTIVE contests, in entry-number order within a contest. Without `participants`: an entry\'s picks are on `getContestEntry`. Empty without an active squad in the league.'),
  places: z.array(ContestEntryPlaceDtoSchema).describe('The place of each of `entries` that its ACTIVE contest\'s leaderboard ranks, read from the same stored board the leaderboard answers from (#1565), so a list of contests needs no leaderboard read per contest. An entry with no place is left out: one in an OPEN contest, one not yet scored, any in a contest whose picks are not revealed yet, and any in a squares contest, whose grid has no places until it settles.'),
}).describe('The requester\'s own entries across a league\'s current contests (#1197), with each live entry\'s place (#1565).');
export type MyContestEntriesResponse = z.infer<typeof MyContestEntriesResponseSchema>;

export const ContestEntryDeletionResponseSchema = z.object({
  contestId: z.string().describe('Contest from which the entry was removed.'),
  deleted: z.literal(true).describe('Confirms that the delete operation succeeded.'),
}).describe('Contest-entry deletion response.');
export type ContestEntryDeletionResponse = z.infer<typeof ContestEntryDeletionResponseSchema>;

// --- Published contract (#192) -------------------------------------------------
// Each name becomes `components.schemas.<name>` and an importable generated type.
// The frontend imports these; it must not re-derive a shape from a response map.
registerSchema('CreateContestRequest', CreateContestRequestSchema);
registerSchema('UpdateContestRequest', UpdateContestRequestSchema);
registerSchema('UpdateContestEntryRequest', UpdateContestEntryRequestSchema);
registerSchema('ContestSportEventDto', ContestSportEventDtoSchema);
registerSchema('ContestCoveredSlotDto', ContestCoveredSlotDtoSchema);
registerSchema('SetContestCupWeightRequest', SetContestCupWeightRequestSchema);
registerSchema('ContestEntryEventDto', ContestEntryEventDtoSchema);
registerSchema('ContestEntryEventResultDto', ContestEntryEventResultDtoSchema);
registerSchema('ContestLeaderboardQuery', ContestLeaderboardQuerySchema);
registerSchema('ContestDto', ContestDtoSchema);
registerSchema('ContestProgressDto', ContestProgressDtoSchema);
registerSchema('ContestEntryDto', ContestEntryDtoSchema);
registerSchema('ContestEntryParticipantDetailDto', ContestEntryParticipantDetailDtoSchema);
registerSchema('ParticipantScoringDefinitionId', ParticipantScoringDefinitionIdSchema);
registerSchema('ScoredContestEntryPickGolfDto', ScoredContestEntryPickGolfDtoSchema);
registerSchema('ScoredContestEntryPickDto', ScoredContestEntryPickDtoSchema);
registerSchema('ContestEntryStandingDto', ContestEntryStandingDtoSchema);
registerSchema('ContestCountingRuleDto', ContestCountingRuleDtoSchema);
registerSchema('ContestLeaderboardResponse', ContestLeaderboardResponseSchema);
registerSchema('ContestResponse', ContestResponseSchema);
registerSchema('ContestListResponse', ContestListResponseSchema);
registerSchema('ListContestsQuery', ListContestsQuerySchema);
registerSchema('ContestFinishedYearsResponse', ContestFinishedYearsResponseSchema);
registerSchema('ContestEntryResponse', ContestEntryResponseSchema);
registerSchema('ContestEntryDetailResponse', ContestEntryDetailResponseSchema);
registerSchema('ContestEntryPlaceDto', ContestEntryPlaceDtoSchema);
registerSchema('MyContestEntriesResponse', MyContestEntriesResponseSchema);
registerSchema('ContestEntryListResponse', ContestEntryListResponseSchema);
registerSchema('ContestEntryDeletionResponse', ContestEntryDeletionResponseSchema);
