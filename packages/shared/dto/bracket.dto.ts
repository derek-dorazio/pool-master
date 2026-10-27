/**
 * The bracket operations' contract (#698): an event's matches, round by round, and where each
 * winner moves on to. Only an event whose sport plays a bracket has one. An admin loads the whole
 * bracket at once and edits one match at a time; results are entered separately (#699).
 */
import { z } from 'zod';
import { MatchEnding, MatchSide, MatchStatus } from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';

/** The most matches one bracket holds: a 128-place draw has 127. */
export const BRACKET_MATCHES_MAX = 127;

export const MatchStatusDtoSchema = z.enum(MatchStatus).describe('Where a match stands. COMPLETED once its result is in; CANCELLED when it was never played.');
export const MatchSideDtoSchema = z.enum(MatchSide).describe('One side of a match. On a neutral site HOME is the upper line of the bracket.');
export const MatchEndingDtoSchema = z.enum(MatchEnding).describe('How a match with a result ended: PLAYED to its end; RETIREMENT, the loser stopped part way; WALKOVER, the loser never started; DEFAULT, the loser was disqualified. The winner wins in full every way.');

export const SportEventMatchPeriodScoreDtoSchema = z.object({
  periodNumber: z.number().int().min(1).describe('1 for the first period (quarter, in American football); never the last, whose score is the match\'s final result.'),
  homeScore: z.number().int().min(0).describe('The home side\'s score at the end of the period, earlier periods included, as the scoreboard shows it.'),
  awayScore: z.number().int().min(0).describe('The away side\'s score at the end of the period, earlier periods included.'),
}).describe('Both sides\' score at the end of one period of a game (#772).');
export type SportEventMatchPeriodScoreDto = z.infer<typeof SportEventMatchPeriodScoreDtoSchema>;

export const SportEventMatchDtoSchema = z.object({
  id: z.uuid(),
  sportEventId: z.uuid(),
  roundNumber: z.number().int().describe('The round the match is played in; its label comes from the sport definition\'s round labels.'),
  matchNumber: z.number().int().describe('Unique within the event: the bracket slot and the display order.'),
  homeSportEventParticipantId: z.uuid().nullable().describe('The field row on the home side; null until it is decided, such as a later round waiting on its feeder match.'),
  awaySportEventParticipantId: z.uuid().nullable().describe('The field row on the away side; null until it is decided.'),
  isNeutralSite: z.boolean().describe('True when neither side is at home: screens then say "vs" rather than "@".'),
  scheduledDate: z.iso.datetime().nullable().describe('Tip-off or kickoff; null until it is announced.'),
  status: MatchStatusDtoSchema,
  winnerSide: MatchSideDtoSchema.nullable().describe('Who won; null until the match is COMPLETED. A COMPLETED match with none is a tie (#792), which only a game of a week, never a bracket match, can be.'),
  homeScore: z.number().int().nullable().describe('The home side\'s score; in a series, games won.'),
  awayScore: z.number().int().nullable().describe('The away side\'s score; in a series, games won.'),
  homeShootoutScore: z.number().int().nullable().describe('The home side\'s kicks scored in the shoot-out that settled a knockout match level after extra time; null with the away side\'s when there was none. Not part of the match score.'),
  awayShootoutScore: z.number().int().nullable().describe('The away side\'s kicks scored in the shoot-out; null with the home side\'s.'),
  ending: MatchEndingDtoSchema.describe('How the match ended; PLAYED for a match without a result. A WALKOVER has no scores.'),
  advancesToMatchId: z.uuid().nullable().describe('The match the winner moves on to; null for the final.'),
  advancesToSide: MatchSideDtoSchema.nullable().describe('The side of that match the winner fills; null for the final.'),
  regionLabel: z.string().nullable().describe('The region or conference the match is played in ("AFC", "East"); null when the bracket has none. In a reseeded round each team stays in its region.'),
  homeSpread: z.number().nullable().describe('The points spread from the home team\'s side (#720): -3.5 has the home team favoured by 3.5, +3.5 has it getting 3.5. Null until set. A pick\'em contest scored against the spread reads it.'),
  periodScores: z.array(SportEventMatchPeriodScoreDtoSchema).describe('The score at the end of each period entered so far, in period order; empty for a sport whose games keep no score by period. The final score is homeScore and awayScore.'),
}).describe('One game or match of an event, which in a bracket is also a slot naming where its winner goes.');
export type SportEventMatchDto = z.infer<typeof SportEventMatchDtoSchema>;

export const SportEventBracketResponseSchema = z.object({
  matches: z.array(SportEventMatchDtoSchema).describe('Every match of the event in match-number order; empty until the bracket is loaded.'),
}).describe('An event\'s bracket.');
export type SportEventBracketResponse = z.infer<typeof SportEventBracketResponseSchema>;

export const SportEventMatchResponseSchema = z.object({
  match: SportEventMatchDtoSchema,
}).describe('One match of an event\'s bracket.');
export type SportEventMatchResponse = z.infer<typeof SportEventMatchResponseSchema>;

export const LoadSportEventBracketMatchSchema = z.object({
  matchNumber: z.number().int().min(1).describe('Unique within the bracket: the slot and the display order.'),
  roundNumber: z.number().int().min(1).describe('A round the event has.'),
  homeSportEventParticipantId: z.uuid().nullable().describe('A field row of the event, or null when an earlier match\'s winner fills the side (or its team is not known yet).'),
  awaySportEventParticipantId: z.uuid().nullable().describe('A field row of the event, or null as for the home side.'),
  isNeutralSite: z.boolean(),
  scheduledDate: z.iso.datetime().nullable(),
  advancesTo: z.object({
    matchNumber: z.number().int().min(1).describe('A match of this bracket in a later round.'),
    side: MatchSideDtoSchema.describe('The side of that match the winner fills, which must not name a team.'),
  }).nullable().describe('Where the winner moves on to; null for the final. In a league that reseeds, also null for each match of a round whose winners are placed by seed.'),
  regionLabel: z.string().min(1).max(40).nullable().optional().describe('The region or conference the match is played in; omitted or null for none.'),
}).describe('One match of a bracket being loaded. A team placed straight into a later round (a bye) is named on that match\'s side.');

export const LoadSportEventBracketRequestSchema = z.object({
  matches: z.array(LoadSportEventBracketMatchSchema).min(1).max(BRACKET_MATCHES_MAX),
}).describe('The whole bracket: it replaces every match the event has. Each team appears at most once, there is exactly one final in the last round named, and two matches never advance to the same side.');
export type LoadSportEventBracketRequest = z.infer<typeof LoadSportEventBracketRequestSchema>;

export const UpdateSportEventMatchRequestSchema = z.object({
  homeSportEventParticipantId: z.uuid().nullable().optional().describe('Omitted keeps it; null empties the side. Only until the event is released.'),
  awaySportEventParticipantId: z.uuid().nullable().optional().describe('Omitted keeps it; null empties the side. Only until the event is released.'),
  isNeutralSite: z.boolean().optional(),
  scheduledDate: z.iso.datetime().nullable().optional().describe('Omitted keeps it; null clears it.'),
  homeSpread: z.number().min(-99.5).max(99.5).multipleOf(0.5).nullable().optional()
    .describe('The points spread from the home team\'s side, in half points (-3.5: the home team favoured by 3.5). Omitted keeps it; null clears it. Once the event is released, only while nobody has picked the game.'),
}).describe('One match edit. Its time and site can change at any point; its sides only until the event is released; its spread until someone picks the game.');
export type UpdateSportEventMatchRequest = z.infer<typeof UpdateSportEventMatchRequestSchema>;

export const FillPlayInSlotRequestSchema = z.object({
  participantId: z.uuid().describe('The team that won the play-in game: an active participant of the event\'s sport not yet on the field.'),
}).describe('The play-in winner for a field row that stands for a play-in pairing ("Texas / Xavier"). The row then names the winner and keeps its seed, tier, price and picks; the pairing\'s participant is inactivated.');
export type FillPlayInSlotRequest = z.infer<typeof FillPlayInSlotRequestSchema>;

export const ReplaceWithdrawnParticipantRequestSchema = z.object({
  participantId: z.uuid().describe('Who takes the place: an active participant of the event\'s sport not yet on the field, such as a tennis lucky loser.'),
}).describe('A replacement for a field row that withdrew before its first match. The replacement gets its own field row in the withdrawn row\'s bracket place, unseeded, last in the event\'s last tier and at its lowest price. The withdrawn row stays on the field, inactive as WITHDRAWN, and every pick of it scores as a first-round loss.');
export type ReplaceWithdrawnParticipantRequest = z.infer<typeof ReplaceWithdrawnParticipantRequestSchema>;

export const RecordSportEventMatchResultRequestSchema = z.object({
  winnerSide: MatchSideDtoSchema.nullable().describe('The side that won; null for a tie (#792), which needs both scores, level. Only a game of a week, which forms no bracket, can end in a tie.'),
  homeScore: z.number().int().min(0).nullable().describe('The home side\'s score (games won, for a series), or null with the away score null too.'),
  awayScore: z.number().int().min(0).nullable().describe('The away side\'s score, or null with the home score null too.'),
  homeShootoutScore: z.number().int().min(0).nullable().optional().describe('The home side\'s kicks scored in a shoot-out, for a bracket match level after extra time in a sport settled that way; omitted or null with the away side\'s for none.'),
  awayShootoutScore: z.number().int().min(0).nullable().optional().describe('The away side\'s kicks scored in a shoot-out; omitted or null with the home side\'s.'),
  ending: MatchEndingDtoSchema.optional().describe('How the match ended; omitted is PLAYED. A RETIREMENT or DEFAULT takes both scores or neither, and the winner\'s may be the lower (where it stopped); a WALKOVER takes no scores. Neither a tie nor a shoot-out ends early.'),
}).describe('A match\'s result: who won, or a tie, and both scores or neither. A match that ended early says how (ending). The winner\'s score must be the higher, except in a bracket match of a sport settled by shoot-out, where a level score takes both shoot-out scores and the winner\'s shoot-out score is the higher. Shoot-out scores are refused anywhere else. A tie, only in a game of a week, has level scores.');
export type RecordSportEventMatchResultRequest = z.infer<typeof RecordSportEventMatchResultRequestSchema>;

export const RecordSportEventMatchPeriodScoreRequestSchema = z.object({
  homeScore: z.number().int().min(0).describe('The home side\'s score at the end of the period, earlier periods included.'),
  awayScore: z.number().int().min(0).describe('The away side\'s score at the end of the period, earlier periods included.'),
}).describe('Both sides\' score at the end of one period, as the scoreboard shows it. Neither may be below its score at an earlier period\'s end, or above its score at a later one\'s or its final score.');
export type RecordSportEventMatchPeriodScoreRequest = z.infer<typeof RecordSportEventMatchPeriodScoreRequestSchema>;

export const RoundMatchupDtoSchema = z.object({
  matchNumber: z.number().int().min(1).describe('A match of the round.'),
  homeSportEventParticipantId: z.uuid().describe('The field row on the home side.'),
  awaySportEventParticipantId: z.uuid().describe('The field row on the away side.'),
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
registerSchema('MatchSideDto', MatchSideDtoSchema);
registerSchema('MatchEndingDto', MatchEndingDtoSchema);
registerSchema('SportEventMatchPeriodScoreDto', SportEventMatchPeriodScoreDtoSchema);
registerSchema('SportEventMatchDto', SportEventMatchDtoSchema);
registerSchema('SportEventBracketResponse', SportEventBracketResponseSchema);
registerSchema('SportEventMatchResponse', SportEventMatchResponseSchema);
registerSchema('LoadSportEventBracketRequest', LoadSportEventBracketRequestSchema);
registerSchema('UpdateSportEventMatchRequest', UpdateSportEventMatchRequestSchema);
registerSchema('FillPlayInSlotRequest', FillPlayInSlotRequestSchema);
registerSchema('ReplaceWithdrawnParticipantRequest', ReplaceWithdrawnParticipantRequestSchema);
registerSchema('RecordSportEventMatchResultRequest', RecordSportEventMatchResultRequestSchema);
registerSchema('RecordSportEventMatchPeriodScoreRequest', RecordSportEventMatchPeriodScoreRequestSchema);
registerSchema('RoundMatchupDto', RoundMatchupDtoSchema);
registerSchema('SportEventRoundMatchupsResponse', SportEventRoundMatchupsResponseSchema);
registerSchema('SetSportEventRoundMatchupsRequest', SetSportEventRoundMatchupsRequestSchema);
