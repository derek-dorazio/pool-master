import { ScoringFamily, type SportDefinition } from '@poolmaster/shared/domain';
import { finishPositionUi } from './finish-position';
import { headToHeadUi } from './head-to-head';
import { strokePlayUi } from './stroke-play';
import type { ScoringFamilyUi } from './types';

/**
 * The web's scoring-family registry (#606): how each family's results read on the shared
 * contest screens. Exhaustive over `ScoringFamily`, so a family added to the shared registry
 * fails the web build until it has an entry here. A screen reaches it from the response's
 * sport, through the sport definition's scoring family — never by comparing sports.
 */
export const SCORING_FAMILY_UI: Readonly<Record<ScoringFamily, ScoringFamilyUi>> = {
  [ScoringFamily.STROKE_PLAY]: strokePlayUi,
  [ScoringFamily.FINISH_POSITION]: finishPositionUi,
  [ScoringFamily.HEAD_TO_HEAD]: headToHeadUi,
};

export function getScoringFamilyUi(sport: SportDefinition): ScoringFamilyUi {
  return SCORING_FAMILY_UI[sport.scoringFamily];
}
