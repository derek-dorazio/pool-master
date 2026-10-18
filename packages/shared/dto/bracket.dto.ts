/**
 * The bracket operations' contract (#698): an event's matches, round by round, and where each
 * winner moves on to. Only an event whose sport plays a bracket has one. An admin loads the whole
 * bracket at once and edits one match at a time; results are entered separately (#699).
 */
import { z } from 'zod';
import { MatchSide, MatchStatus } from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';

/** The most matches one bracket holds: a 128-place draw has 127. */
export const BRACKET_MATCHES_MAX = 127;

export const MatchStatusDtoSchema = z.nativeEnum(MatchStatus).describe('Where a match stands. COMPLETED once its result is in; CANCELLED when it was never played.');
export const MatchSideDtoSchema = z.nativeEnum(MatchSide).describe('One side of a match. On a neutral site HOME is the upper line of the bracket.');

export const SportEventMatchDtoSchema = z.object({
  id: z.string().uuid(),
  sportEventId: z.string().uuid(),
  roundNumber: z.number().int().describe('The round the match is played in; its label comes from the sport definition\'s round labels.'),
  matchNumber: z.number().int().describe('Unique within the event: the bracket slot and the display order.'),
  homeSportEventParticipantId: z.string().uuid().nullable().describe('The field row on the home side; null until it is decided, such as a later round waiting on its feeder match.'),
  awaySportEventParticipantId: z.string().uuid().nullable().describe('The field row on the away side; null until it is decided.'),
  isNeutralSite: z.boolean().describe('True when neither side is at home: screens then say "vs" rather than "@".'),
  scheduledDate: z.string().datetime().nullable().describe('Tip-off or kickoff; null until it is announced.'),
  status: MatchStatusDtoSchema,
  winnerSide: MatchSideDtoSchema.nullable().describe('Who won; null until the match is COMPLETED. A COMPLETED match with none is a draw, which a knockout never has.'),
  homeScore: z.number().int().nullable().describe('The home side\'s score; in a series, games won.'),
  awayScore: z.number().int().nullable().describe('The away side\'s score; in a series, games won.'),
  advancesToMatchId: z.string().uuid().nullable().describe('The match the winner moves on to; null for the final.'),
  advancesToSide: MatchSideDtoSchema.nullable().describe('The side of that match the winner fills; null for the final.'),
  regionLabel: z.string().nullable().describe('The region or conference the match is played in ("AFC", "East"); null when the bracket has none. In a reseeded round each team stays in its region.'),
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
  homeSportEventParticipantId: z.string().uuid().nullable().describe('A field row of the event, or null when an earlier match\'s winner fills the side (or its team is not known yet).'),
  awaySportEventParticipantId: z.string().uuid().nullable().describe('A field row of the event, or null as for the home side.'),
  isNeutralSite: z.boolean(),
  scheduledDate: z.string().datetime().nullable(),
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
  homeSportEventParticipantId: z.string().uuid().nullable().optional().describe('Omitted keeps it; null empties the side. Only until the event is released.'),
  awaySportEventParticipantId: z.string().uuid().nullable().optional().describe('Omitted keeps it; null empties the side. Only until the event is released.'),
  isNeutralSite: z.boolean().optional(),
  scheduledDate: z.string().datetime().nullable().optional().describe('Omitted keeps it; null clears it.'),
}).describe('One match edit. Its time and site can change at any point; its sides only until the event is released.');
export type UpdateSportEventMatchRequest = z.infer<typeof UpdateSportEventMatchRequestSchema>;

export const FillPlayInSlotRequestSchema = z.object({
  participantId: z.string().uuid().describe('The team that won the play-in game: an active participant of the event\'s sport not yet on the field.'),
}).describe('The play-in winner for a field row that stands for a play-in pairing ("Texas / Xavier"). The row then names the winner and keeps its seed, tier, price and picks; the pairing\'s participant is inactivated.');
export type FillPlayInSlotRequest = z.infer<typeof FillPlayInSlotRequestSchema>;

export const RecordSportEventMatchResultRequestSchema = z.object({
  winnerSide: MatchSideDtoSchema.describe('The side that won.'),
  homeScore: z.number().int().min(0).nullable().describe('The home side\'s score (games won, for a series), or null with the away score null too.'),
  awayScore: z.number().int().min(0).nullable().describe('The away side\'s score, or null with the home score null too.'),
}).describe('A match\'s result: who won, and both scores or neither. The winner\'s score must be the higher.');
export type RecordSportEventMatchResultRequest = z.infer<typeof RecordSportEventMatchResultRequestSchema>;

export const RoundMatchupDtoSchema = z.object({
  matchNumber: z.number().int().min(1).describe('A match of the round.'),
  homeSportEventParticipantId: z.string().uuid().describe('The field row on the home side.'),
  awaySportEventParticipantId: z.string().uuid().describe('The field row on the away side.'),
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
registerSchema('SportEventMatchDto', SportEventMatchDtoSchema);
registerSchema('SportEventBracketResponse', SportEventBracketResponseSchema);
registerSchema('SportEventMatchResponse', SportEventMatchResponseSchema);
registerSchema('LoadSportEventBracketRequest', LoadSportEventBracketRequestSchema);
registerSchema('UpdateSportEventMatchRequest', UpdateSportEventMatchRequestSchema);
registerSchema('FillPlayInSlotRequest', FillPlayInSlotRequestSchema);
registerSchema('RecordSportEventMatchResultRequest', RecordSportEventMatchResultRequestSchema);
registerSchema('RoundMatchupDto', RoundMatchupDtoSchema);
registerSchema('SportEventRoundMatchupsResponse', SportEventRoundMatchupsResponseSchema);
registerSchema('SetSportEventRoundMatchupsRequest', SetSportEventRoundMatchupsRequestSchema);
