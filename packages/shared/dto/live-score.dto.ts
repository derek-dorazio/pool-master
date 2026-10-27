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
 * GOLF is the only member: a category arrives with the scoring code that persists it (#605).
 */

import { z } from 'zod';
import { ParticipantRoundStatus } from '@poolmaster/shared/domain';

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
]);
export type LiveScoreResult = z.infer<typeof LiveScoreResultSchema>;
