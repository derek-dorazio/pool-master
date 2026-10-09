/**
 * Which engine serves which selection type (#198). Adding a selection type to the draft room
 * is adding an engine here; the shared handler does not change.
 *
 * A type with no entry (`SNAKE_DRAFT`, rebuilt under #199, and the deferred catalog types) has
 * no engine, and the room answers it with 501 `DRAFT_MODE_UNSUPPORTED`.
 */

import type { SelectionType } from '@poolmaster/shared/domain';
import { budgetPickSelectionEngine } from './budget-pick';
import type { SelectionEngine } from './selection-engine';
import { tieredSelectionEngine } from './tiered';

const ENGINES: readonly SelectionEngine[] = [tieredSelectionEngine, budgetPickSelectionEngine];

const ENGINE_BY_SELECTION_TYPE: ReadonlyMap<SelectionType, SelectionEngine> = new Map(
  ENGINES.map((engine) => [engine.selectionType, engine]),
);

/** The engine for a selection type, or undefined when the draft room does not serve it. */
export function findSelectionEngine(selectionType: SelectionType): SelectionEngine | undefined {
  return ENGINE_BY_SELECTION_TYPE.get(selectionType);
}
