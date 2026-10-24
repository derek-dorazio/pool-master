/**
 * Which scoring families keep their results as golf round scores, the rows the admin golf score
 * routes write. Exhaustive over `ScoringFamily`, so a family added to the enum must say whether
 * an admin may enter golf rounds for its events. Only stroke play does; any other family's event
 * is refused by those routes with 422 EVENT_SCORING_FAMILY_MISMATCH.
 *
 * Kept apart from the family modules on purpose: the golf score service reads it, and the
 * stroke-play module builds that service, so reading it off the module would import in a circle.
 */
import { ScoringFamily, eventSportDefinition } from '@poolmaster/shared/domain';
import type { ScoringFamilyEvent } from './scoring-family-module';

const STORES_GOLF_ROUND_SCORES: Readonly<Record<ScoringFamily, boolean>> = {
  [ScoringFamily.STROKE_PLAY]: true,
  [ScoringFamily.FINISH_POSITION]: false,
  [ScoringFamily.HEAD_TO_HEAD]: false,
  [ScoringFamily.COMPOSITE]: false,
};

/** Whether the event stores golf round scores, by its sport league's scoring family. */
export function eventStoresGolfRoundScores(event: ScoringFamilyEvent): boolean {
  return STORES_GOLF_ROUND_SCORES[eventSportDefinition(event).scoringFamily];
}
