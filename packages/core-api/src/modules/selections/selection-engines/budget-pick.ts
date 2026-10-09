/**
 * The budget-pick selection engine (#198): build a roster of a configured size.
 *
 * It has no unselect gesture, so re-selecting a participant the entry holds is a duplicate,
 * and a full roster is complete: nothing is displaced. Picks are numbered in the order made.
 * The budget itself is not enforced yet; that is #93.
 */

import { SelectionType } from '@poolmaster/shared/domain';
import {
  lineupShortfall,
  SelectionOutcomeKind,
  SelectionRejectCode,
  type SelectionEngine,
} from './selection-engine';

export const budgetPickSelectionEngine: SelectionEngine = {
  selectionType: SelectionType.BUDGET_PICK,

  /** The roster size the contest's configuration carries, and 0 when it carries none. */
  rosterSize: ({ configuration }) => configuration?.rosterSize ?? 0,

  evaluate: ({ heldPick, existingPicks, rosterSize }) => {
    if (heldPick) return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.DUPLICATE_PICK };
    if (existingPicks.length >= rosterSize) {
      return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE };
    }
    return { kind: SelectionOutcomeKind.ACCEPT, lineupSlot: existingPicks.length + 1 };
  },

  /** Judged by the pick count alone: a budget-pick roster has no tiers to fill. */
  findShortfall: ({ rosterSize, picks }) =>
    lineupShortfall({ rosterSize, pickCount: picks.length, shortTierNames: [] }),

  historyRound: ({ entryPickIndex }) => entryPickIndex,
};
