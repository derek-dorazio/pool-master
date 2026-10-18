/**
 * Game-pick DTOs (#716): a prediction contest entry's picks on one event's games, and the
 * requests that change and submit them.
 */
import { z } from 'zod';
import { registerSchema } from './schema-registry';
import { ContestEntryStatus, MatchStatus, PickEmMode } from '../domain/enums';

// --- Requests ---

export const GamePickWriteSchema = z.object({
  sportEventMatchId: z.string().uuid().describe('The game picked: one of the event\'s games.'),
  sportEventParticipantId: z.string().uuid().describe('The team picked to win: the field row of one of the game\'s two teams.'),
  confidence: z.number().int().min(1).nullable().optional().describe('A confidence pool\'s value for this pick, 1 to the week\'s number of games. Omitted or null in a straight-up pool, and until the entry gives one. A value may repeat until the week is submitted.'),
}).describe('One game\'s pick as it is saved.');
export type GamePickWrite = z.infer<typeof GamePickWriteSchema>;

export const SaveGamePicksRequestSchema = z.object({
  picks: z.array(GamePickWriteSchema).min(1)
    .refine((picks) => new Set(picks.map((pick) => pick.sportEventMatchId)).size === picks.length, {
      message: 'Each game is picked at most once per request.',
    })
    .describe('The picks to save, one per game. Each replaces the entry\'s pick on that game; the entry\'s other picks are kept. Saved together or not at all, so two confidence values can be swapped in one request.'),
}).describe('Request payload for saving an entry\'s picks on one event\'s games.');
export type SaveGamePicksRequest = z.infer<typeof SaveGamePicksRequestSchema>;

// --- Response ---

export const GamePickTeamDtoSchema = z.object({
  sportEventParticipantId: z.string().uuid().describe('The team\'s field row in the event: what a pick names.'),
  participantId: z.string().uuid(),
  name: z.string(),
}).describe('One team of a game.');
export type GamePickTeamDto = z.infer<typeof GamePickTeamDtoSchema>;

export const GamePickDtoSchema = z.object({
  sportEventParticipantId: z.string().uuid().describe('The team picked to win.'),
  confidence: z.number().int().nullable().describe('The pick\'s confidence value; null in a straight-up pool or until given.'),
  pickedAt: z.string().datetime(),
}).describe('An entry\'s pick on one game.');
export type GamePickDto = z.infer<typeof GamePickDtoSchema>;

export const GamePickGameDtoSchema = z.object({
  sportEventMatchId: z.string().uuid(),
  matchNumber: z.number().int(),
  roundNumber: z.number().int(),
  kickoff: z.string().datetime().describe('When the game starts: its scheduled time, else its event\'s start. Its pick locks then.'),
  status: z.nativeEnum(MatchStatus),
  isNeutralSite: z.boolean(),
  home: GamePickTeamDtoSchema.nullable().describe('Null until the team is decided.'),
  away: GamePickTeamDtoSchema.nullable().describe('Null until the team is decided.'),
  locked: z.boolean().describe('Whether the game\'s pick can no longer change: it has kicked off, or the contest no longer takes picks.'),
  revealed: z.boolean().describe('Whether picks on this game are shown to the whole league: from its kickoff once the contest is live.'),
  pick: GamePickDtoSchema.nullable().describe('The entry\'s pick on the game. Null when it has none, and on another team\'s entry until the game is revealed.'),
}).describe('One game of the event with the entry\'s pick on it.');
export type GamePickGameDto = z.infer<typeof GamePickGameDtoSchema>;

export const GamePicksResponseSchema = z.object({
  contestId: z.string().uuid(),
  entryId: z.string().uuid(),
  entryName: z.string(),
  sportEventId: z.string().uuid(),
  mode: z.nativeEnum(PickEmMode),
  status: z.nativeEnum(ContestEntryStatus).describe('The entry\'s status for this event: DRAFT while picking, SUBMITTED once every game is picked and submitted. Only a submitted event counts.'),
  submittedAt: z.string().datetime().nullable(),
  ownEntry: z.boolean().describe('Whether the caller is on the entry\'s team, and so sees every pick on it.'),
  canSubmit: z.boolean().describe('Whether the caller can submit the event now: their own draft entry, every game picked with valid confidence values, before the first game starts.'),
  pickedCount: z.number().int().describe('How many of the games have a pick. Counted on the caller\'s own entry; on another team\'s, only revealed games are counted.'),
  gameCount: z.number().int(),
  games: z.array(GamePickGameDtoSchema).describe('The event\'s games in game-number order. Cancelled games are left out: they are not picked.'),
}).describe('A prediction contest entry\'s picks on one event\'s games.');
export type GamePicksResponse = z.infer<typeof GamePicksResponseSchema>;

registerSchema('SaveGamePicksRequest', SaveGamePicksRequestSchema);
registerSchema('GamePicksResponse', GamePicksResponseSchema);
