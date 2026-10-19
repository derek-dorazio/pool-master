/**
 * Which engine serves which prediction selection type (#716). Exhaustive, as the roster
 * registry is: a prediction type exists only with its engine.
 */

import { SelectionType, type PredictionSelectionType } from '@poolmaster/shared/domain';
import { bracketPredictionEngine } from './bracket';
import { pickEmPredictionEngine } from './pick-em';
import type { PredictionEngine } from './prediction-engine';
import { survivorPredictionEngine } from './survivor';

const ENGINE_BY_SELECTION_TYPE: Readonly<Record<PredictionSelectionType, PredictionEngine>> = {
  [SelectionType.PICK_EM]: pickEmPredictionEngine,
  [SelectionType.BRACKET]: bracketPredictionEngine,
  [SelectionType.SURVIVOR]: survivorPredictionEngine,
};

export function getPredictionEngine(selectionType: PredictionSelectionType): PredictionEngine {
  return ENGINE_BY_SELECTION_TYPE[selectionType];
}
