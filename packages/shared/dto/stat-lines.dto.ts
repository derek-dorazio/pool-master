/**
 * The stat line operation's contract (#935): an admin's, or the sport data loader's, stat lines
 * for one game of a championship stat pool, the composite family's results. Every value is the
 * player's count as the box score gives it, stored exactly as sent; the server derives none of
 * them, and the composite is computed from them, never stored. What a player's game holds reads
 * back through SportEventParticipantDto's rounds.
 */
import { z } from 'zod';
import { SportStat } from '@poolmaster/shared/domain';
import { registerSchema } from './schema-registry';

/** The most players one game's upload holds: both teams' eligible players, with room to spare. */
export const GAME_STAT_LINE_ROWS_MAX = 200;

export const GameStatLineRowSchema = z.object({
  participantId: z.string().uuid().describe('The player, by participant id; must be in the event\'s field.'),
  stats: z.array(z.object({
    stat: z.nativeEnum(SportStat).describe('One of the stats the sport\'s composite counts.'),
    value: z.number().int().min(0).max(9999).describe('The player\'s count of it in the game.'),
  }).describe('One stat of the line.')).max(Object.keys(SportStat).length)
    .describe('The player\'s whole line for the game, each stat once; a stat left out counts 0. Empty clears the line: the player did not play the game.'),
}).describe('One player\'s line for the game. It replaces the line stored for the player in the game.');
export type GameStatLineRow = z.infer<typeof GameStatLineRowSchema>;

export const GameStatLineUploadRequestSchema = z.object({
  rows: z.array(GameStatLineRowSchema).min(1).max(GAME_STAT_LINE_ROWS_MAX),
}).describe('One game\'s stat lines, or a correction to some of them: one row per player named. Players not named keep the line already stored.');
export type GameStatLineUploadRequest = z.infer<typeof GameStatLineUploadRequestSchema>;

// --- Published contract (#192) -------------------------------------------------
registerSchema('GameStatLineUploadRequest', GameStatLineUploadRequestSchema);
