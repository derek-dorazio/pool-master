/**
 * Which engine serves which selection type (#198). Adding a selection type to the draft room
 * is adding an engine here; the shared handler does not change.
 *
 * A type with no entry (`SNAKE_DRAFT`, rebuilt under #199, and the deferred catalog types) has
 * no engine, and the room answers it with 501 `DRAFT_MODE_UNSUPPORTED`.
 */

import { SelectionType } from '@poolmaster/shared/domain';
import { budgetPickSelectionEngine } from './budget-pick';
import type { SelectionEngine } from './selection-engine';
import { tieredSelectionEngine } from './tiered';

/**
 * Keyed by the type itself, so a second engine for the same type is a duplicate key, which
 * the compiler refuses, rather than a silent overwrite.
 */
const ENGINE_BY_SELECTION_TYPE: Readonly<Partial<Record<SelectionType, SelectionEngine>>> = {
  [SelectionType.TIERED]: tieredSelectionEngine,
  [SelectionType.BUDGET_PICK]: budgetPickSelectionEngine,
};

/** The engine for a selection type, or undefined when the draft room does not serve it. */
export function findSelectionEngine(selectionType: SelectionType): SelectionEngine | undefined {
  return ENGINE_BY_SELECTION_TYPE[selectionType];
}
