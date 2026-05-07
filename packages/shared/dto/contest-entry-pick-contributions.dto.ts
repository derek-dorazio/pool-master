/**
 * Contest-entry-pick contribution DTOs per plans/117 §8.
 *
 * Phase 4 ships only the golf-roster variant. Other categories
 * (BasketballRoster, BasketballBracket, F1Roster, F1PredictTopN, etc.)
 * land as their per-(category × contestFormat) slices ship.
 */

import { z } from 'zod';
import { DateTimeSchema } from './common.dto';

/**
 * Canonical golf-roster contribution DTO. Pure row projection of
 * `ContestEntryPickGolfRosterContribution` per plans/117 §8.1. Each row
 * represents one pick's contribution from one completed round; the entry's
 * `totalScore` is `SUM(contribution)` across all of its picks' rows.
 *
 * `contribution` always equals `scoreToPar` for golf-roster (lowest total
 * wins) but is persisted explicitly so the read path doesn't have to
 * re-derive it and so future scoring tweaks can adjust without changing
 * the read shape.
 */
export const ContestEntryPickGolfRosterContributionDtoSchema = z.object({
  id: z.string().describe('Contribution row identifier.'),
  contestEntryPickId: z.string().describe('Owning ContestEntryPick identifier.'),
  round: z.number().int().min(1).max(8).describe('Tournament round (1..N).'),
  strokes: z.number().int().min(0).describe('Round stroke count from SportEventParticipantGolfRound.'),
  scoreToPar: z.number().int().describe('Round score relative to par.'),
  contribution: z.number().describe('Numeric contribution toward the entry total. Equals scoreToPar for golf-roster.'),
  contributedAt: DateTimeSchema.describe('When the scoring engine wrote this row.'),
  createdAt: DateTimeSchema,
  updatedAt: DateTimeSchema,
}).describe('Canonical ContestEntryPickGolfRosterContribution DTO per plans/117 §8.1 — pure row projection.');
export type ContestEntryPickGolfRosterContributionDto = z.infer<
  typeof ContestEntryPickGolfRosterContributionDtoSchema
>;
