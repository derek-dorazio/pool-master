/**
 * The bracket operations' contract (#698): an event's matches, round by round, and where each
 * winner moves on to. Only an event whose sport plays a bracket has one. An admin loads the whole
 * bracket at once and edits one match at a time; results are entered separately (#699).
 */
import { z } from 'zod';
import { HomeAway, MatchEnding, MatchSideOutcome, MatchStatus, PeriodKind, PeriodUnit, SlotKind } from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';

/** The most matches one bracket holds: a 128-place draw has 127. */
export const BRACKET_MATCHES_MAX = 127;

export const MatchStatusDtoSchema = z.enum(MatchStatus).describe('Where a match stands. COMPLETED once its result is in; CANCELLED when it was never played; POSTPONED when it was put off before it began and is still to be played, at its scheduledDate once a new time is set.');
export const MatchEndingDtoSchema = z.enum(MatchEnding).describe('How a match with a result ended: PLAYED to its end; RETIREMENT, the loser stopped part way; WALKOVER, the loser never started; DEFAULT, the loser was disqualified. The winner wins in full every way.');
const MatchSideOutcomeDtoSchema = z.enum(MatchSideOutcome).describe('How a side came out of its match: PENDING until the match is decided, then WON or LOST, or TIED for both sides of a game of a week that ended level (#792).');
const HomeAwayDtoSchema = z.enum(HomeAway).describe('Where a side played a game: HOME, AWAY, or NONE at a neutral site. Screens say "at" or "vs" from it.');

/** The side numbers a match has: side 1 and side 2. */
const sideNumber = z.number().int().min(1).max(2);

const SportEventRoundMatchSideDtoSchema = z.object({
  sideNumber: sideNumber.describe('The side\'s fixed place in the match: 1 or 2. A synced game has its away team on side 1 and its home team on side 2; where each side played a game is its game side result\'s homeAway.'),
  sportEventParticipantId: z.uuid().nullable().describe('The field row playing the side; null until it is decided, such as a later round waiting on its feeder match.'),
  outcome: MatchSideOutcomeDtoSchema,
  score: z.number().int().nullable().describe('The side\'s score in the match, summed by the server from its games: its game 1 score in a single game, and in a best-of series the games it has won. Null until it has one.'),
  spread: z.number().nullable().describe('The points spread, on side 1 only (#720): -3.5 has side 1 favoured by 3.5, +3.5 has it getting 3.5. Null until set, and always on side 2. A pick\'em contest scored against the spread reads it.'),
}).describe('One side of a match (#2046).');
export type SportEventRoundMatchSideDto = z.infer<typeof SportEventRoundMatchSideDtoSchema>;

const GamePeriodScoreDtoSchema = z.object({
  kind: z.enum(PeriodKind).describe('REGULAR for a period of regulation, OVERTIME for one of overtime. A shoot-out is not a period here: it is the side result\'s shootoutScore.'),
  periodNumber: z.number().int().min(1).describe('1 for the first period of its kind.'),
  score: z.number().int().min(0).describe('The side\'s score at the end of the period, earlier periods included, as the scoreboard shows it: summed by the server from each period\'s own points.'),
}).describe('One side\'s running score at the end of one period of play of a game (#772, #2046).');

export const GameSideResultDtoSchema = z.object({
  sideNumber: sideNumber.describe('The match side the result is for.'),
  score: z.number().int().nullable().describe('The side\'s score in the game, overtime included and a shoot-out never; null until the game starts.'),
  homeAway: HomeAwayDtoSchema,
  shootoutScore: z.number().int().nullable().describe('The side\'s kicks scored in the shoot-out that settled a game level after extra time; null when there was none. Not part of the score.'),
  periodScores: z.array(GamePeriodScoreDtoSchema).describe('The side\'s running score at the end of each period of play entered so far, regulation then overtime, in play order; empty for a sport whose games keep no score by period.'),
}).describe('One side\'s result in one game of a match (#2046).');
export type GameSideResultDto = z.infer<typeof GameSideResultDtoSchema>;

export const SportEventRoundMatchGameDtoSchema = z.object({
  gameNumber: z.number().int().min(1).describe('1 for a single game; a best-of series numbers its games in the order they are played.'),
  status: MatchStatusDtoSchema,
  isFinal: z.boolean().describe('True once the game is decided (COMPLETED). The server\'s own fact, so a client never re-derives it from the status.'),
  scheduledDate: z.iso.datetime().nullable().describe('The game\'s start; null until it is announced.'),
  sideResults: z.array(GameSideResultDtoSchema).describe('Each side\'s result in the game, side 1 first, from the moment the game is loaded: where the side plays it, then its scores once they are in.'),
}).describe('One game of a match (#2007): a single game is its match\'s game 1, a best-of series one game per game played.');
export type SportEventRoundMatchGameDto = z.infer<typeof SportEventRoundMatchGameDtoSchema>;

const MatchAdvancementDtoSchema = z.object({
  matchId: z.uuid().describe('The match the winner moves on to.'),
  sideNumber: sideNumber.describe('The side of that match the winner fills.'),
}).describe('Where a match\'s winner moves on to.');

export const SlotPeriodsDtoSchema = z.object({
  unit: z.enum(PeriodUnit).describe('What a game of the slot is played in: QUARTER, HALF, PERIOD, INNING or HOLE. Its words come from the display strings.'),
  count: z.number().int().min(1).describe('How many periods a game has, overtime aside: 4 quarters, 2 halves, 9 innings, 18 holes. The last period\'s score is the final score.'),
}).describe('What a game of a slot is played in (#2047), from its slot definition.');
export type SlotPeriodsDto = z.infer<typeof SlotPeriodsDtoSchema>;

export const SportEventRoundSlotDtoSchema = z.object({
  seasonSlotId: z.uuid().describe('The Season slot (SportLeagueSeasonSlotDto) the round is played in. Rounds that share it, such as a golf tournament\'s four, are named by number rather than by the slot.'),
  name: z.string().nullable().describe('The slot\'s proper name ("Super Bowl", "Sweet 16"); null when it is called by its kind\'s word.'),
  slotKind: z.enum(SlotKind).describe('The slot\'s kind. FINAL is the event\'s final: never found by round position.'),
  weekNumber: z.number().int().nullable().describe('A WEEK slot\'s week ("Week 14"); null for every other kind.'),
  periods: SlotPeriodsDtoSchema.nullable().describe('What a game of the slot is played in (#2047); null for a game that keeps no score by period, such as a race or a tennis match.'),
}).describe('The slot a round is played in (#2006): what the round is called, and whether it is the final.');
export type SportEventRoundSlotDto = z.infer<typeof SportEventRoundSlotDtoSchema>;

export const SportEventRoundMatchDtoSchema = z.object({
  id: z.uuid(),
  sportEventId: z.uuid(),
  roundNumber: z.number().int().describe('The round the match is played in.'),
  slot: SportEventRoundSlotDtoSchema.describe('The slot the match\'s round is played in: the round\'s label and whether the match is the final.'),
  matchNumber: z.number().int().describe('Unique within its round (#2161): the match\'s place in the round and its display order. Two rounds each have a match 1, so a match is named by roundNumber and matchNumber together.'),
  isNeutralSite: z.boolean().describe('True when neither side is at home: screens then say "vs" rather than "at".'),
  scheduledDate: z.iso.datetime().nullable().describe('Tip-off or kickoff; null until it is announced.'),
  status: MatchStatusDtoSchema,
  isFinal: z.boolean().describe('True once the match is decided (COMPLETED): its score and its winner, or its tie, stand. The server\'s own fact, so a client never re-derives it from the status.'),
  isUnplayed: z.boolean().describe('True while the match is still to be played: scheduled, or postponed to be played later. The server\'s own `isMatchUnplayed`, so a client never re-derives it from the status.'),
  ending: MatchEndingDtoSchema.describe('How the match ended; PLAYED for a match without a result. A WALKOVER has no scores.'),
  completedAt: z.iso.datetime().nullable().describe('When the result was last recorded: each COMPLETED result sets it, a correction included. Null in every other status.'),
  advancesTo: MatchAdvancementDtoSchema.nullable().describe('Where the winner moves on to; null for the final, and for a match whose winner is placed by seed in a league that reseeds.'),
  regionLabel: z.string().nullable().describe('The region or conference the match is played in ("AFC", "East"); null when the bracket has none. In a reseeded round each team stays in its region.'),
  sides: z.array(SportEventRoundMatchSideDtoSchema).describe('Side 1 then side 2. The winner is the side whose outcome is WON.'),
  games: z.array(SportEventRoundMatchGameDtoSchema).describe('The match\'s games in game-number order: a single game has its game 1 from the moment the match is loaded.'),
}).describe('One game or match of an event, which in a bracket is also a slot naming where its winner goes.');
export type SportEventRoundMatchDto = z.infer<typeof SportEventRoundMatchDtoSchema>;

export const SportEventBracketResponseSchema = z.object({
  matches: z.array(SportEventRoundMatchDtoSchema).describe('Every match of the event in round order, then match-number order within each round; empty until the bracket is loaded.'),
}).describe('An event\'s bracket.');
export type SportEventBracketResponse = z.infer<typeof SportEventBracketResponseSchema>;

const SquaresGameChoiceDtoSchema = z.object({
  sportEventRoundMatchGameId: z.uuid().describe('The Game: what CreateContestRequest.sportEventRoundMatchGameId takes.'),
  gameNumber: z.number().int().min(1).describe('Its number in its match: 1 for a single game, a series\' games in the order they are played.'),
  scheduledDate: z.iso.datetime().nullable().describe('The Game\'s kickoff, which closes a squares contest on it; null while it is to be announced.'),
  match: SportEventRoundMatchDtoSchema.describe('The match it is a Game of: its round, its slot and its two sides.'),
}).describe('A Game a squares contest can be played on.');

export const SquaresGameChoicesResponseSchema = z.object({
  games: z.array(SquaresGameChoiceDtoSchema).describe('The Games a squares contest can be played on now: each a Game of a slot that takes squares, still to kick off, with no period score in. The final\'s first, then by kickoff, round, match and game number. Empty when every game has kicked off.'),
  defaultSportEventRoundMatchGameId: z.uuid().nullable().describe('The Game Create contest starts on: Game 1 of the soonest match, the first of `games`. Null when there is none.'),
}).describe('The Games of an event a squares contest can be played on.');
export type SquaresGameChoicesResponse = z.infer<typeof SquaresGameChoicesResponseSchema>;

export const SportEventRoundMatchResponseSchema = z.object({
  match: SportEventRoundMatchDtoSchema,
}).describe('One match of an event\'s bracket.');
export type SportEventRoundMatchResponse = z.infer<typeof SportEventRoundMatchResponseSchema>;

const MatchSideTeamDtoSchema = z.object({
  sideNumber: sideNumber.describe('The side: 1 or 2.'),
  sportEventParticipantId: z.uuid().nullable().describe('A field row of the event, or null when an earlier match\'s winner fills the side (or its team is not known yet).'),
}).describe('The team on one side of a match.');

/** Both sides of a match, once each: checked here rather than as a fixed-length array, so clients read a plain list. */
const bothSides = <T extends z.ZodType<{ sideNumber: number }>>(side: T) => z.array(side)
  .refine((sides) => sides.length === 2 && new Set(sides.map((each) => each.sideNumber)).size === 2, { message: 'Name side 1 and side 2 once each.' });

export const LoadSportEventBracketMatchSchema = z.object({
  roundNumber: z.number().int().min(1).describe('A round the event has.'),
  matchNumber: z.number().int().min(1).describe('Unique within its round (#2161): the match\'s place in the round and its display order.'),
  sides: bothSides(MatchSideTeamDtoSchema.extend({
    homeAway: HomeAwayDtoSchema.describe('Where the side plays game 1: NONE for both sides at a neutral site, else one HOME and one AWAY.'),
  })).describe('Side 1 and side 2, once each. A synced game has its away team on side 1 and its home team on side 2.'),
  isNeutralSite: z.boolean(),
  scheduledDate: z.iso.datetime().nullable(),
  advancesTo: z.object({
    roundNumber: z.number().int().min(1).describe('A later round of this bracket.'),
    matchNumber: z.number().int().min(1).describe('A match of that round.'),
    sideNumber: sideNumber.describe('The side of that match the winner fills, which must not name a team.'),
  }).nullable().describe('Where the winner moves on to; null for the final. In a league that reseeds, also null for each match of a round whose winners are placed by seed.'),
  regionLabel: z.string().min(1).max(40).nullable().optional().describe('The region or conference the match is played in; omitted or null for none.'),
}).describe('One match of a bracket being loaded. A team placed straight into a later round (a bye) is named on that match\'s side.');

export const LoadSportEventBracketRequestSchema = z.object({
  matches: z.array(LoadSportEventBracketMatchSchema).min(1).max(BRACKET_MATCHES_MAX),
}).describe('The whole bracket: it replaces every match the event has. Each team appears at most once, there is exactly one final in the last round named, and two matches never advance to the same side.');
export type LoadSportEventBracketRequest = z.infer<typeof LoadSportEventBracketRequestSchema>;

export const UpdateSportEventRoundMatchRequestSchema = z.object({
  sides: bothSides(MatchSideTeamDtoSchema).optional().describe('Both sides\' teams; omitted keeps them, and a null team empties its side. Only until the event is released.'),
  isNeutralSite: z.boolean().optional(),
  scheduledDate: z.iso.datetime().nullable().optional().describe('Omitted keeps it; null clears it.'),
  spread: z.number().min(-99.5).max(99.5).multipleOf(0.5).nullable().optional()
    .describe('The points spread on side 1, in half points (-3.5: side 1 favoured by 3.5). Omitted keeps it; null clears it. Once the event is released, only while nobody has picked the game.'),
}).describe('One match edit. Its time and site can change at any point; its sides only until the event is released; its spread until someone picks the game.');
export type UpdateSportEventRoundMatchRequest = z.infer<typeof UpdateSportEventRoundMatchRequestSchema>;

const MatchSideResultRequestSchema = z.object({
  sideNumber: sideNumber.describe('The side: 1 or 2.'),
  score: z.number().int().min(0).nullable().describe('The side\'s score (games won, for a series), or null with the other side\'s null too.'),
  shootoutScore: z.number().int().min(0).nullable().optional().describe('The side\'s kicks scored in a shoot-out, for a bracket match level after extra time in a sport settled that way; omitted or null with the other side\'s for none.'),
}).describe('One side\'s result in a match.');

export const RecordSportEventRoundMatchResultRequestSchema = z.object({
  winnerSideNumber: sideNumber.nullable().describe('The side that won; null for a tie (#792), which needs both scores, level. Only a game of a week, which forms no bracket, can end in a tie.'),
  sides: bothSides(MatchSideResultRequestSchema).describe('Side 1 and side 2, once each: both scores or neither.'),
  ending: MatchEndingDtoSchema.optional().describe('How the match ended; omitted is PLAYED. A RETIREMENT or DEFAULT takes both scores or neither, and the winner\'s may be the lower (where it stopped); a WALKOVER takes no scores. Neither a tie nor a shoot-out ends early.'),
}).describe('A match\'s result: who won, or a tie, and both scores or neither. A match that ended early says how (ending). The winner\'s score must be the higher, except in a bracket match of a sport settled by shoot-out, where a level score takes both shoot-out scores and the winner\'s shoot-out score is the higher. Shoot-out scores are refused anywhere else. A tie, only in a game of a week, has level scores.');
export type RecordSportEventRoundMatchResultRequest = z.infer<typeof RecordSportEventRoundMatchResultRequestSchema>;

export const RecordSportEventMatchPeriodScoreRequestSchema = z.object({
  sides: bothSides(z.object({
    sideNumber: sideNumber.describe('The side: 1 or 2.'),
    score: z.number().int().min(0).describe('The side\'s score at the end of the period, earlier periods included.'),
  })).describe('Side 1 and side 2, once each.'),
}).describe('Both sides\' score at the end of one period, as the scoreboard shows it. Neither may be below its score at an earlier period\'s end, or above its score at a later one\'s or its final score.');
export type RecordSportEventMatchPeriodScoreRequest = z.infer<typeof RecordSportEventMatchPeriodScoreRequestSchema>;

export const RoundMatchupDtoSchema = z.object({
  matchNumber: z.number().int().min(1).describe('A match of the round, numbered within it.'),
  sides: bothSides(z.object({
    sideNumber: sideNumber.describe('The side: 1 or 2. The better seed hosts, on side 2.'),
    sportEventParticipantId: z.uuid().describe('The field row on the side.'),
  })).describe('Side 1 and side 2, once each.'),
}).describe('Both sides of one match of a reseeded round.');
export type RoundMatchupDto = z.infer<typeof RoundMatchupDtoSchema>;

export const SportEventRoundMatchupsResponseSchema = z.object({
  matches: z.array(RoundMatchupDtoSchema).describe('One per match of the round, in match-number order.'),
}).describe('The pairing the server proposes for a reseeded round: in each region the best seed left hosts the worst, the second best the second worst, and a team already holding its place keeps it.');
export type SportEventRoundMatchupsResponse = z.infer<typeof SportEventRoundMatchupsResponseSchema>;

export const SetSportEventRoundMatchupsRequestSchema = z.object({
  matches: z.array(RoundMatchupDtoSchema).min(1).max(BRACKET_MATCHES_MAX).describe('Every match of the round, once each.'),
}).describe('A reseeded round\'s teams, all at once. Every team left in the round plays once, in its own region, and a team holding its place (a bye, a linked winner) keeps it.');
export type SetSportEventRoundMatchupsRequest = z.infer<typeof SetSportEventRoundMatchupsRequestSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('MatchStatusDto', MatchStatusDtoSchema);
registerSchema('MatchEndingDto', MatchEndingDtoSchema);
registerSchema('MatchSideOutcomeDto', MatchSideOutcomeDtoSchema);
registerSchema('HomeAwayDto', HomeAwayDtoSchema);
registerSchema('SportEventRoundMatchSideDto', SportEventRoundMatchSideDtoSchema);
registerSchema('GamePeriodScoreDto', GamePeriodScoreDtoSchema);
registerSchema('GameSideResultDto', GameSideResultDtoSchema);
registerSchema('SportEventRoundMatchGameDto', SportEventRoundMatchGameDtoSchema);
registerSchema('MatchAdvancementDto', MatchAdvancementDtoSchema);
registerSchema('MatchSideTeamDto', MatchSideTeamDtoSchema);
registerSchema('MatchSideResultRequest', MatchSideResultRequestSchema);
registerSchema('SlotPeriodsDto', SlotPeriodsDtoSchema);
registerSchema('SportEventRoundSlotDto', SportEventRoundSlotDtoSchema);
registerSchema('SportEventRoundMatchDto', SportEventRoundMatchDtoSchema);
registerSchema('SportEventBracketResponse', SportEventBracketResponseSchema);
registerSchema('SportEventRoundMatchResponse', SportEventRoundMatchResponseSchema);
registerSchema('SquaresGameChoiceDto', SquaresGameChoiceDtoSchema);
registerSchema('SquaresGameChoicesResponse', SquaresGameChoicesResponseSchema);
registerSchema('LoadSportEventBracketRequest', LoadSportEventBracketRequestSchema);
registerSchema('UpdateSportEventRoundMatchRequest', UpdateSportEventRoundMatchRequestSchema);
registerSchema('RecordSportEventRoundMatchResultRequest', RecordSportEventRoundMatchResultRequestSchema);
registerSchema('RecordSportEventMatchPeriodScoreRequest', RecordSportEventMatchPeriodScoreRequestSchema);
registerSchema('RoundMatchupDto', RoundMatchupDtoSchema);
registerSchema('SportEventRoundMatchupsResponse', SportEventRoundMatchupsResponseSchema);
registerSchema('SetSportEventRoundMatchupsRequest', SetSportEventRoundMatchupsRequestSchema);
