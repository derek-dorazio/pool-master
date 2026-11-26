/**
 * An event slot's tiebreaker game (#2048), as the event's Slots tab reads it and a root admin
 * chooses it: the one Game whose combined score every contest covering the slot guesses.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { MatchStatusDtoSchema } from './bracket.dto';
import { DateTimeSchema } from './common.dto';

const SlotTiebreakerGameDtoSchema = z.object({
  id: z.uuid().describe('The Game: what a root admin chooses.'),
  sportEventRoundMatchId: z.uuid().describe('The match the Game is played in, as the event\'s bracket names it (SportEventRoundMatchDto.id).'),
  gameNumber: z.number().int().min(1).describe('1 for a single game; a series\' games in the order they are played.'),
  scheduledDate: DateTimeSchema.nullable().describe('When the Game starts; null until the schedule gives it a time.'),
  status: MatchStatusDtoSchema,
  moved: z.boolean().describe('Whether the provider moved the Game to another slot\'s event; it is played there, so it is never chosen.'),
  choosable: z.boolean().describe('Whether a root admin can choose it now: the slot\'s game has not started, and this one is in the slot, not cancelled and not started.'),
}).describe('One of a slot\'s Games.');

const SportEventSlotTiebreakerDtoSchema = z.object({
  seasonSlotId: z.uuid().describe('The Season slot, as the event\'s slots name it (SportLeagueSeasonSlotDto.id).'),
  tiebreakerGameId: z.uuid().nullable().describe('The slot\'s tiebreaker game, one of `games`; null while the slot has no Game that can be one. The rule chooses it, the latest scheduled start with ties to the lower Game id and an unscheduled Game after every scheduled one (the later round first), and chooses again on each schedule change until it starts.'),
  chosenAt: DateTimeSchema.nullable().describe('When a root admin chose it by hand; null while the rule chose it. A chosen game stays until it starts, unless it is cancelled or moved.'),
  chosenByUserId: z.uuid().nullable().describe('The root admin who chose it; null while the rule chose it, or once that account is gone.'),
  editable: z.boolean().describe('Whether it can be changed: no game is chosen yet, or the chosen one has not started.'),
  games: z.array(SlotTiebreakerGameDtoSchema).describe('Every Game played in the slot, by match and game number.'),
}).describe('One slot\'s tiebreaker game and the Games it could be.');
export type SportEventSlotTiebreakerDto = z.infer<typeof SportEventSlotTiebreakerDtoSchema>;

export const SportEventSlotTiebreakersResponseSchema = z.object({
  slots: z.array(SportEventSlotTiebreakerDtoSchema).describe('Each slot the event covers; empty for an event with none.'),
});
export type SportEventSlotTiebreakersResponse = z.infer<typeof SportEventSlotTiebreakersResponseSchema>;

const ChooseSlotTiebreakerGameRequestSchema = z.object({
  gameId: z.uuid().describe('One of the slot\'s Games (SlotTiebreakerGameDto.id) that is `choosable`.'),
});
export type ChooseSlotTiebreakerGameRequest = z.infer<typeof ChooseSlotTiebreakerGameRequestSchema>;

export const SportEventSlotTiebreakerResponseSchema = z.object({
  slot: SportEventSlotTiebreakerDtoSchema,
});
export type SportEventSlotTiebreakerResponse = z.infer<typeof SportEventSlotTiebreakerResponseSchema>;

registerSchema('SlotTiebreakerGameDto', SlotTiebreakerGameDtoSchema);
registerSchema('SportEventSlotTiebreakerDto', SportEventSlotTiebreakerDtoSchema);
registerSchema('SportEventSlotTiebreakersResponse', SportEventSlotTiebreakersResponseSchema);
registerSchema('ChooseSlotTiebreakerGameRequest', ChooseSlotTiebreakerGameRequestSchema);
registerSchema('SportEventSlotTiebreakerResponse', SportEventSlotTiebreakerResponseSchema);
