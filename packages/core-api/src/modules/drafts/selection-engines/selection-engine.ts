/**
 * The selection-engine seam (#198): what differs between selection types, and nothing else.
 *
 * `DraftService` is the one shared handler. It owns everything every selection type does the
 * same way: auth and entry ownership, the pick window, participant-in-event, availability,
 * exclusivity across entries, persistence through `ContestEntryPickService`, and the room it
 * answers with. An engine supplies only the rules that vary by type: how many picks a roster
 * holds, what a selection does to an entry, when a lineup is complete, and which round a pick
 * shows in.
 *
 * **Exclusivity is not an engine concern.** It is driven by `ContestConfiguration.isExclusive`
 * and applies the same way to every type, so it stays in the shared handler; an engine never
 * sees other entries' picks.
 *
 * **`evaluate` returns an outcome, not a verdict.** The first attempt at this abstraction gave
 * `validatePick` a `{ valid, reason }` return; a boolean cannot say *replace* or *toggle off*,
 * so the live tiered rules could never sit behind it, and #323 deleted the engines built on it
 * (plans/144). The union below is the behaviour, and the handler acts on each kind.
 */

import type { ContestConfiguration, SelectionType } from '@poolmaster/shared/domain';
import type { DraftTierConfig, LineupShortfall, SelectionParticipant } from '../types';

/** What a selection does to the entry. */
export const SelectionOutcomeKind = {
  /** Insert the pick at `draftRound`. */
  ACCEPT: 'accept',
  /** Delete `replacedPickId`, then insert the pick at `draftRound`. */
  REPLACE: 'replace',
  /** Delete `pickId` and insert nothing: the participant is unselected. */
  TOGGLE_OFF: 'toggleOff',
  /** Change nothing; the handler answers with the error `code` names. */
  REJECT: 'reject',
} as const;
export type SelectionOutcomeKind = (typeof SelectionOutcomeKind)[keyof typeof SelectionOutcomeKind];

/**
 * Why an engine refused a selection. Each value is also the contract code of the error the
 * handler answers with, so the published codes do not change.
 */
export const SelectionRejectCode = {
  /** The participant is already on the entry, in a type with no unselect gesture. */
  DUPLICATE_PICK: 'DUPLICATE_PICK',
  /** The roster is full and the selection displaces nothing. */
  ENTRY_COMPLETE: 'ENTRY_COMPLETE',
  /** A tiered selection of a participant with no tier. */
  TIER_MISSING: 'TIER_MISSING',
  /** A tiered selection of a participant whose tier label matches no configured tier. */
  TIER_NOT_FOUND: 'TIER_NOT_FOUND',
} as const;
export type SelectionRejectCode = (typeof SelectionRejectCode)[keyof typeof SelectionRejectCode];

export type SelectionRejection =
  | { kind: typeof SelectionOutcomeKind.REJECT; code: typeof SelectionRejectCode.DUPLICATE_PICK }
  | { kind: typeof SelectionOutcomeKind.REJECT; code: typeof SelectionRejectCode.ENTRY_COMPLETE }
  | { kind: typeof SelectionOutcomeKind.REJECT; code: typeof SelectionRejectCode.TIER_MISSING }
  | {
    kind: typeof SelectionOutcomeKind.REJECT;
    code: typeof SelectionRejectCode.TIER_NOT_FOUND;
    tierLabel: string;
  };

export type SelectionOutcome =
  | { kind: typeof SelectionOutcomeKind.ACCEPT; draftRound: number }
  | { kind: typeof SelectionOutcomeKind.REPLACE; draftRound: number; replacedPickId: string }
  | { kind: typeof SelectionOutcomeKind.TOGGLE_OFF; pickId: string }
  | SelectionRejection;

/** One of the entry's picks as an engine reasons over it: its id and whom it points at. */
export interface EntryPick {
  id: string;
  /** The canonical participant, which is what tiers list. */
  participantId: string;
}

/** Everything an engine needs to decide one selection on one entry. */
export interface SelectionRequest {
  /** The participant being selected, with its effective tier already resolved. */
  participant: SelectionParticipant;
  /** The entry's own pick on this participant, when it already holds them. */
  heldPick: EntryPick | null;
  /** The entry's picks, oldest first. */
  existingPicks: readonly EntryPick[];
  tiers: readonly DraftTierConfig[];
  rosterSize: number;
}

export interface SelectionEngine {
  readonly selectionType: SelectionType;

  /** How many picks a full roster holds. 0 means the contest cannot take picks. */
  rosterSize(input: {
    configuration: ContestConfiguration | null;
    tiers: readonly DraftTierConfig[];
  }): number;

  /**
   * What selecting `participant` does to the entry. Pure: the handler performs the writes.
   * The handler runs its shared guards around this call — a toggle-off is acted on before the
   * availability check, so a withdrawn golfer can still be removed, and a rejection is
   * answered after the availability and exclusivity checks.
   */
  evaluate(request: SelectionRequest): SelectionOutcome;

  /** Why the lineup cannot be submitted yet, or null when it is complete (#481). */
  findShortfall(input: {
    rosterSize: number;
    tiers: readonly DraftTierConfig[];
    /** The entry's picks, each with the canonical participant it points at. */
    picks: readonly { participantId: string }[];
  }): LineupShortfall | null;

  /**
   * The round a pick shows in within the room's history. `tierNumber` is the tier the pick's
   * participant sits in, if any; `entryPickIndex` is its 1-based position among its entry's
   * picks.
   */
  historyRound(input: { tierNumber: number | undefined; entryPickIndex: number }): number;
}

/**
 * The shortfall every engine reports in the same shape: none only when the roster has places,
 * the lineup fills exactly that many, and no tier is short.
 */
export function lineupShortfall(input: {
  rosterSize: number;
  pickCount: number;
  shortTierNames: string[];
}): LineupShortfall | null {
  const { rosterSize, pickCount, shortTierNames } = input;
  if (rosterSize > 0 && pickCount === rosterSize && shortTierNames.length === 0) return null;
  return { pickCount, rosterSize, shortTierNames };
}
