/**
 * LiveScoreResult — typed result returned by `SportDataProvider.getLiveScores`.
 *
 * Per plans/117 §10.2 the live-score path is normalized at the adapter
 * boundary into a sport-category-discriminated union, replacing the legacy
 * untyped `ProviderStatEvent[]` shape. Each adapter implements one category
 * (mock-feed and pga-tour return GOLF; openf1 returns F1; etc.). Schemas are
 * Zod-validated at the bus boundary in `publishLiveScoreUpdate` per
 * plans/117 §10.3 — malformed adapter payloads fail validation at the
 * boundary, not inside the scoring consumer.
 *
 * Phase 4 (pool-master-rop.78.3) ships only the GOLF schema; the deferred
 * categories below are shape-locked by the design plan so the bus contract
 * is forward-stable.
 */

import { z } from 'zod';

// ============================================================================
// Per-category update schemas
// ============================================================================

/**
 * GOLF — per-event per-participant golf round update.
 *
 * Adapters emit `participantExternalId` (the provider-side identifier they
 * know — e.g. `mock-contest-feed`'s contestantId or PGA Tour's player code).
 * The bus-boundary `publishLiveScoreUpdate` resolves to the internal
 * `SportEventParticipant.id` UUID before persisting; the design plan §10.2
 * field name `sportEventParticipantId` refers to that internal column,
 * which adapters cannot reach without a DB lookup. Keeping the resolution
 * at the boundary preserves the adapter contract as a pure data shape.
 */
export const GolfRoundUpdateSchema = z.object({
  participantExternalId: z.string().min(1).describe(
    'Provider-side participant identifier; resolved to SportEventParticipant.id at the bus boundary.',
  ),
  round: z.number().int().min(1).max(8),
  strokes: z.number().int().min(0),
  scoreToPar: z.number().int(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED', 'DNF', 'DSQ']),
  completedAt: z.string().datetime().optional(),
}).describe('Golf round update emitted by golf adapters per plans/117 §6.1.');
export type GolfRoundUpdate = z.infer<typeof GolfRoundUpdateSchema>;

/**
 * BASKETBALL — designed-but-deferred (plans/117 §6.3 / §10.2). The schema is
 * present so the bus contract is forward-stable; no adapter currently
 * implements this category.
 */
export const BasketballGameUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  round: z.enum(['R64', 'R32', 'S16', 'E8', 'F4', 'NCG']),
  result: z.enum(['WIN', 'LOSS']),
  score: z.number().int().min(0),
  opponentScore: z.number().int().min(0),
  opponentParticipantExternalId: z.string().min(1),
  isUpset: z.boolean(),
  playedAt: z.string().datetime().optional(),
});
export type BasketballGameUpdate = z.infer<typeof BasketballGameUpdateSchema>;

/** F1 — designed-but-deferred (plans/117 §6.4 / §10.2). */
export const F1ResultUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  finalPosition: z.number().int().min(1).nullable(),
  didFinish: z.boolean(),
  lapsCompleted: z.number().int().min(0),
  fastestLap: z.boolean(),
  status: z.enum(['FINISHED', 'DNF', 'DSQ']),
  finishedAt: z.string().datetime().optional(),
});
export type F1ResultUpdate = z.infer<typeof F1ResultUpdateSchema>;

/** NFL — designed-but-deferred (plans/117 §6.6 / §10.2). */
export const NflGameUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  isHomeTeam: z.boolean(),
  finalScore: z.number().int().min(0),
  didWin: z.boolean(),
  pointSpread: z.number().nullable().optional(),
  didCoverSpread: z.boolean().nullable().optional(),
  playedAt: z.string().datetime().optional(),
});
export type NflGameUpdate = z.infer<typeof NflGameUpdateSchema>;

/** NASCAR — designed-but-deferred (plans/117 §6.5 / §10.2). */
export const NascarResultUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  finalPosition: z.number().int().min(1).nullable(),
  didFinish: z.boolean(),
  finishPoints: z.number().int().min(0),
  stage1Points: z.number().int().min(0),
  stage2Points: z.number().int().min(0),
  lapsLed: z.number().int().min(0),
  status: z.enum(['FINISHED', 'DNF', 'DSQ']),
  finishedAt: z.string().datetime().optional(),
});
export type NascarResultUpdate = z.infer<typeof NascarResultUpdateSchema>;

/** TENNIS — designed-but-deferred (plans/117 §6.2 / §10.2). */
export const TennisMatchUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  roundReached: z.enum(['R128', 'R64', 'R32', 'R16', 'QF', 'SF', 'F']),
  matchResult: z.enum(['WIN', 'LOSS', 'WALKOVER', 'RETIRE']),
  setsWon: z.number().int().min(0),
  setsLost: z.number().int().min(0),
  opponentParticipantExternalId: z.string().min(1),
  playedAt: z.string().datetime().optional(),
});
export type TennisMatchUpdate = z.infer<typeof TennisMatchUpdateSchema>;

/** SOCCER — designed-but-deferred (plans/117 §6.7 / §10.2). */
export const SoccerMatchUpdateSchema = z.object({
  participantExternalId: z.string().min(1),
  round: z.enum(['GROUP', 'R16', 'QF', 'SF', 'F']),
  matchResult: z.enum(['WIN', 'DRAW', 'LOSS']),
  goalsFor: z.number().int().min(0),
  goalsAgainst: z.number().int().min(0),
  isUpset: z.boolean(),
  opponentParticipantExternalId: z.string().min(1),
  playedAt: z.string().datetime().optional(),
});
export type SoccerMatchUpdate = z.infer<typeof SoccerMatchUpdateSchema>;

// ============================================================================
// LiveScoreResult discriminated union
// ============================================================================

export const LiveScoreResultSchema = z.discriminatedUnion('category', [
  z.object({
    category: z.literal('GOLF'),
    rounds: z.array(GolfRoundUpdateSchema),
  }),
  z.object({
    category: z.literal('BASKETBALL'),
    games: z.array(BasketballGameUpdateSchema),
  }),
  z.object({
    category: z.literal('F1'),
    results: z.array(F1ResultUpdateSchema),
  }),
  z.object({
    category: z.literal('NFL'),
    games: z.array(NflGameUpdateSchema),
  }),
  z.object({
    category: z.literal('NASCAR'),
    results: z.array(NascarResultUpdateSchema),
  }),
  z.object({
    category: z.literal('TENNIS'),
    matches: z.array(TennisMatchUpdateSchema),
  }),
  z.object({
    category: z.literal('SOCCER'),
    matches: z.array(SoccerMatchUpdateSchema),
  }),
]);
export type LiveScoreResult = z.infer<typeof LiveScoreResultSchema>;
