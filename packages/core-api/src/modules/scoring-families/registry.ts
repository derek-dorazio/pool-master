/**
 * Which module serves which scoring family (#606). Exhaustive over `ScoringFamily`, so a family
 * added to the enum fails the typecheck until it has a module. Callers reach a module through
 * the event's sport league definition, never by comparing sports.
 */
import { ScoringFamily } from '@poolmaster/shared/domain';
import type { ScoringFamilyEvent, ScoringFamilyModule } from './scoring-family-module';
import { finishPositionScoringFamily } from './finish-position';
import { headToHeadScoringFamily } from './head-to-head';
import { strokePlayScoringFamily } from './stroke-play';

const MODULE_BY_SCORING_FAMILY: Readonly<Record<ScoringFamily, ScoringFamilyModule>> = {
  [ScoringFamily.STROKE_PLAY]: strokePlayScoringFamily,
  [ScoringFamily.FINISH_POSITION]: finishPositionScoringFamily,
  [ScoringFamily.HEAD_TO_HEAD]: headToHeadScoringFamily,
};

export function getScoringFamilyModule(family: ScoringFamily): ScoringFamilyModule {
  return MODULE_BY_SCORING_FAMILY[family];
}

/** The module that scores an event, by its sport league's scoring family (#934, #2001). */
export function scoringFamilyForEvent(event: ScoringFamilyEvent): ScoringFamilyModule {
  return getScoringFamilyModule(event.scoringFamily);
}
