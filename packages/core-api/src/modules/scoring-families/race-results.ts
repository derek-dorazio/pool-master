/**
 * Which scoring families keep their results as race results, the rows the admin finishing-order
 * routes write. Exhaustive over `ScoringFamily`, so a family added to the enum must say whether an
 * admin may enter a finishing order for its events. Only finish position does; any other family's
 * event is refused by those routes with 422 EVENT_SCORING_FAMILY_MISMATCH.
 *
 * Kept apart from the family modules for the same reason as golf-round-scores.ts: the race result
 * service reads it, and the event wiring that builds that service is imported by a family module.
 */
import { ScoringFamily, eventSportDefinition } from '@poolmaster/shared/domain';
import type { ScoringFamilyEvent } from './scoring-family-module';

const STORES_RACE_RESULTS: Readonly<Record<ScoringFamily, boolean>> = {
  [ScoringFamily.STROKE_PLAY]: false,
  [ScoringFamily.FINISH_POSITION]: true,
  [ScoringFamily.HEAD_TO_HEAD]: false,
  [ScoringFamily.COMPOSITE]: false,
};

/** Whether the event stores race results, by its sport league's scoring family. */
export function eventStoresRaceResults(event: ScoringFamilyEvent): boolean {
  return STORES_RACE_RESULTS[eventSportDefinition(event).scoringFamily];
}
