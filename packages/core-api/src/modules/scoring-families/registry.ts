/**
 * Which module serves which scoring family (#606). Exhaustive over `ScoringFamily`, so a family
 * added to the enum fails the typecheck until it has a module. Callers reach a module through
 * the event's sport league definition, never by comparing sports.
 */
import { ScoringFamily, eventSportDefinition } from '@poolmaster/shared/domain';
import type { ScoringFamilyEvent, ScoringFamilyModule } from './scoring-family-module';
import { compositeScoringFamily } from './composite';
import { finishPositionScoringFamily } from './finish-position';
import { headToHeadScoringFamily } from './head-to-head';
import { strokePlayScoringFamily } from './stroke-play';

const MODULE_BY_SCORING_FAMILY: Readonly<Record<ScoringFamily, ScoringFamilyModule>> = {
  [ScoringFamily.STROKE_PLAY]: strokePlayScoringFamily,
  [ScoringFamily.FINISH_POSITION]: finishPositionScoringFamily,
  [ScoringFamily.HEAD_TO_HEAD]: headToHeadScoringFamily,
  [ScoringFamily.COMPOSITE]: compositeScoringFamily,
};

export function getScoringFamilyModule(family: ScoringFamily): ScoringFamilyModule {
  return MODULE_BY_SCORING_FAMILY[family];
}

/** The module that scores an event, by its sport league's definition: a stat pool league's is composite (#934). */
export function scoringFamilyForEvent(event: ScoringFamilyEvent): ScoringFamilyModule {
  return getScoringFamilyModule(eventSportDefinition(event).scoringFamily);
}
