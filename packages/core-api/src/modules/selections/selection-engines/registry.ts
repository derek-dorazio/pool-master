/**
 * Which engine serves which selection type (#198). Adding a selection type is adding an engine
 * here; the shared handler does not change. The record is exhaustive (#605): a selection type
 * exists only with its engine, so a new value fails the typecheck until it has one.
 */

import { SelectionType, type RosterSelectionType } from '@poolmaster/shared/domain';
import { budgetPickSelectionEngine } from './budget-pick';
import { randomDrawSelectionEngine } from './random-draw';
import type { SelectionEngine } from './selection-engine';
import { tieredSelectionEngine } from './tiered';

/**
 * Keyed by the type itself, so a second engine for the same type is a duplicate key, which
 * the compiler refuses, rather than a silent overwrite.
 */
const ENGINE_BY_SELECTION_TYPE: Readonly<Record<RosterSelectionType, SelectionEngine>> = {
  [SelectionType.TIERED]: tieredSelectionEngine,
  [SelectionType.BUDGET_PICK]: budgetPickSelectionEngine,
  [SelectionType.RANDOM_DRAW]: randomDrawSelectionEngine,
};

/** The engine for a roster selection type; a prediction type's is a `PredictionEngine` (#716). */
export function getSelectionEngine(selectionType: RosterSelectionType): SelectionEngine {
  return ENGINE_BY_SELECTION_TYPE[selectionType];
}
