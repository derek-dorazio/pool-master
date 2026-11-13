/**
 * LiveScoreResult — typed result returned by `SportDataProvider.getLiveScores`.
 *
 * Per plans/117 §10.2 the live-score path is normalized at the adapter
 * boundary into a category-discriminated union, replacing the legacy
 * untyped `ProviderStatEvent[]` shape. Each adapter implements one category.
 * Schemas are Zod-validated in `publishLiveScoreUpdate` per plans/117 §10.3 —
 * malformed adapter payloads fail validation on entry, not inside the
 * persistence path.
 *
 * A category arrives with the scoring code that persists it (#605): GOLF for stroke play, GAME
 * for head-to-head games (#1496), STAT_LINE for the composite family's box scores (#1497).
 */

import { z } from 'zod';
import { ParticipantRoundStatus, ProviderGameState, SportStat } from '@poolmaster/shared/domain';

// ============================================================================
// Per-category update schemas
// ============================================================================

/**
 * GOLF — per-event per-participant golf round update.
 *
 * Adapters emit `participantExternalId` (the provider-side identifier they
 * know — e.g. `mock-contest-feed`'s contestantId or a real golf provider's
 * player code).
 * `publishLiveScoreUpdate` resolves it to the internal
 * `SportEventParticipant.id` UUID before persisting; the design plan §10.2
 * field name `sportEventParticipantId` refers to that internal column,
 * which adapters cannot reach without a DB lookup. Keeping the resolution
 * at the boundary preserves the adapter contract as a pure data shape.
 */
export const GolfRoundUpdateSchema = z.object({
  participantExternalId: z.string().min(1).describe(
    'Provider-side participant identifier; resolved to SportEventParticipant.id before persistence.',
  ),
  round: z.number().int().min(1).max(8),
  strokes: z.number().int().min(0).nullable().describe(
    'Per-round strokes. Null when the provider only exposes cumulative scoreToPar without per-round detail. Persistence skips rounds with null strokes.',
  ),
  scoreToPar: z.number().int(),
  thru: z.number().int().min(0).optional().describe(
    'Number of completed holes in this round when the provider reports an in-progress round. Playoff holes are not part of any round (#118).',
  ),
  status: z.enum(ParticipantRoundStatus),
  completedAt: z.iso.datetime().optional(),
}).describe('Golf round update emitted by golf adapters per plans/117 §6.1.');
export type GolfRoundUpdate = z.infer<typeof GolfRoundUpdateSchema>;

/**
 * GAME — one head-to-head game as the provider reports it (#1496). Each side is the provider's
 * team id, resolved to the match's side through the team's provider mapping, so a provider that
 * lists the teams the other way round from the match still scores the right side.
 */
export const GameScoreUpdateSchema = z.object({
  externalGameId: z.string().min(1).describe('Provider-side game identifier; the match linked to it takes its result.'),
  homeTeamExternalId: z.string().min(1).describe('Provider-side identifier of the team the provider lists at home.'),
  awayTeamExternalId: z.string().min(1).describe('Provider-side identifier of the team the provider lists away.'),
  state: z.enum(ProviderGameState),
  homeScore: z.number().int().min(0).nullable().describe('The home team\'s score; null before the game starts.'),
  awayScore: z.number().int().min(0).nullable().describe('The away team\'s score; null before the game starts.'),
  homeShootoutScore: z.number().int().min(0).nullable().optional()
    .describe('The home team\'s shoot-out score, for a game level after extra time and settled by a shoot-out (#1532); left out or null otherwise.'),
  awayShootoutScore: z.number().int().min(0).nullable().optional()
    .describe('The away team\'s shoot-out score, beside `homeShootoutScore`.'),
  playInWinnerTeamExternalId: z.string().min(1).optional().describe('Set when one of the game\'s two teams got here by winning a play-in game (#1571, the March Madness First Four): that team\'s provider-side id. The match\'s side for it is the play-in place, which the team fills.'),
}).describe('Head-to-head game update emitted by game adapters.');
export type GameScoreUpdate = z.infer<typeof GameScoreUpdateSchema>;

/**
 * STAT_LINE — one provider game's box score for a Clutch Card event (#1497). The adapter maps the
 * provider's stat fields to `SportStat`s and numbers the game within the event: game N is the
 * event's round N, and in a round of several series (a conference finals) each series' Game N
 * shares it. A player is the provider's player id, resolved through the player's provider mapping.
 */
export const StatLineGameUpdateSchema = z.object({
  externalGameId: z.string().min(1).describe('Provider-side game identifier, for diagnostics.'),
  gameNumber: z.number().int().min(1).describe('The event\'s game this is, its round number: each series\' Game N is game N.'),
  state: z.enum(ProviderGameState),
  lines: z.array(z.object({
    participantExternalId: z.string().min(1).describe('Provider-side player identifier; resolved through the player\'s provider mapping.'),
    stats: z.array(z.object({
      stat: z.enum(SportStat),
      value: z.number().int(),
    })).describe('Each stat the provider reports that a composite counts, once.'),
  })).describe('Each player\'s line for the game, as the provider reports it so far.'),
}).describe('Box score update emitted by stat line adapters.');
export type StatLineGameUpdate = z.infer<typeof StatLineGameUpdateSchema>;

// ============================================================================
// LiveScoreResult discriminated union
// ============================================================================

/**
 * Every LiveScoreResult arm carries `externalEventId` so `publishLiveScoreUpdate`
 * can scope persistence to the originating SportEvent. Without this scope,
 * resolving `participantId` to a `SportEventParticipant` row would pick the
 * most recent row across *all* events the participant has played in,
 * silently cross-contaminating scores between concurrent events. It
 * resolves external → internal via SportEvent.[providerId,
 * externalId] before filtering SEP rows.
 */
const sportEventScope = {
  externalEventId: z.string().min(1).describe(
    'Provider-side SportEvent identifier; resolved to internal SportEvent.id before persistence, so persistence is filtered by event.',
  ),
};

export const LiveScoreResultSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('GOLF'),
    ...sportEventScope,
    rounds: z.array(GolfRoundUpdateSchema),
  }),
  z.object({
    category: z.literal('GAME'),
    ...sportEventScope,
    games: z.array(GameScoreUpdateSchema),
  }),
  z.object({
    category: z.literal('STAT_LINE'),
    ...sportEventScope,
    games: z.array(StatLineGameUpdateSchema),
  }),
]);
export type LiveScoreResult = z.infer<typeof LiveScoreResultSchema>;
