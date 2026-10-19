import { SelectionType } from '@poolmaster/shared/domain';

/**
 * Whether the web app has a screen an entry of each selection type makes its picks on. A
 * `Record` over the enum, so a new selection type has to say, and a commissioner cannot create a
 * contest nobody could pick in.
 */
export const HAS_WEB_ENTRY_SCREEN = {
  [SelectionType.TIERED]: true,
  [SelectionType.BUDGET_PICK]: true,
  [SelectionType.RANDOM_DRAW]: true,
  // A pick'em entry picks each week's games on its week screen (#718).
  [SelectionType.PICK_EM]: true,
  // A bracket entry fills in its bracket on the contest entry page (#721).
  [SelectionType.BRACKET]: true,
} as const satisfies Record<SelectionType, boolean>;

/** The selection types whose entries have a web screen to pick on. */
export type WebEnterableSelectionType = {
  [Type in SelectionType]: (typeof HAS_WEB_ENTRY_SCREEN)[Type] extends true ? Type : never
}[SelectionType];

export function hasWebEntryScreen(selectionType: SelectionType): selectionType is WebEnterableSelectionType {
  return HAS_WEB_ENTRY_SCREEN[selectionType];
}
