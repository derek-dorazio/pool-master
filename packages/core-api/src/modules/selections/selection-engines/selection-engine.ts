/**
 * The selection-engine seam (#198): what differs between selection types, and nothing else.
 *
 * `SelectionService` is the one shared handler. It owns everything every selection type does the
 * same way: auth and entry ownership, the pick window, participant-in-event, availability,
 * exclusivity across entries, persistence through `ContestEntryPickService`, and the room it
 * answers with. An engine supplies only the rules that vary by type: how many picks a roster
 * holds, what a selection does to an entry, what stops a lineup being submitted, how the room
 * lists the field, what the room says about the viewed lineup, and which round a pick shows in.
 *
 * **Exclusivity is not an engine concern.** It is driven by `ContestConfiguration.isExclusive`
 * and applies the same way to every type, so it stays in the shared handler; an engine never
 * sees other entries' picks.
 *
 * **`evaluate` returns an outcome, not a verdict.** The first attempt at this abstraction gave
 * `validatePick` a `{ valid, reason }` return; a boolean cannot say *replace* or *toggle off*,
 * so the live tiered rules could never sit behind it, and #323 deleted the engines built on it.
 * The union below is the behaviour, and the handler acts on each kind.
 */

import type { ContestConfiguration, SelectionType } from '@poolmaster/shared/domain';
import type { FieldGroup, LineupIssue, LineupSummary, SelectionTierConfig, SelectionParticipant } from '../types';
import { LineupIssueKind } from '../types';

/** What a selection does to the entry. */
export const SelectionOutcomeKind = {
  /** Insert the pick at `lineupSlot`. */
  ACCEPT: 'accept',
  /** Delete `replacedPickId`, then insert the pick at `lineupSlot`. */
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
  /** A budget selection of a participant with no price to spend against the cap (#93). */
  PRICE_MISSING: 'PRICE_MISSING',
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
  | { kind: typeof SelectionOutcomeKind.REJECT; code: typeof SelectionRejectCode.PRICE_MISSING }
  | { kind: typeof SelectionOutcomeKind.REJECT; code: typeof SelectionRejectCode.TIER_MISSING }
  | {
    kind: typeof SelectionOutcomeKind.REJECT;
    code: typeof SelectionRejectCode.TIER_NOT_FOUND;
    tierLabel: string;
  };

export type SelectionOutcome =
  | { kind: typeof SelectionOutcomeKind.ACCEPT; lineupSlot: number }
  | { kind: typeof SelectionOutcomeKind.REPLACE; lineupSlot: number; replacedPickId: string }
  | { kind: typeof SelectionOutcomeKind.TOGGLE_OFF; pickId: string }
  | SelectionRejection;

/** One of the entry's picks as an engine reasons over it: its id, whom it points at, and its place. */
export interface EntryPick {
  id: string;
  /** The canonical participant, which is what tiers list. */
  participantId: string;
  /** The place in the lineup the pick was stored with, when it has one. */
  lineupSlot?: number;
}

/** A pick as lineup checks read it: whom it points at, and the golfer's price in dollars. */
export interface LineupPick {
  participantId: string;
  /** Undefined only for a golfer with no price, which a budget room never lets an entry pick. */
  price?: number;
}

/** Everything an engine needs to decide one selection on one entry. */
export interface SelectionRequest {
  /** The participant being selected, with its effective tier already resolved. */
  participant: SelectionParticipant;
  /** The entry's own pick on this participant, when it already holds them. */
  heldPick: EntryPick | null;
  /** The entry's picks, oldest first. */
  existingPicks: readonly EntryPick[];
  tiers: readonly SelectionTierConfig[];
  rosterSize: number;
}

/** What an engine needs to judge a lineup: the contest's rules, its tiers and the entry's picks. */
export interface LineupInput {
  configuration: ContestConfiguration | null;
  rosterSize: number;
  tiers: readonly SelectionTierConfig[];
  /** The entry's picks. */
  picks: readonly LineupPick[];
}

export interface SelectionEngine {
  readonly selectionType: SelectionType;

  /** How many picks a full roster holds. 0 means the contest cannot take picks. */
  rosterSize(input: {
    configuration: ContestConfiguration | null;
    tiers: readonly SelectionTierConfig[];
  }): number;

  /**
   * What selecting `participant` does to the entry. Pure: the handler performs the writes.
   * The handler runs its shared guards around this call — a toggle-off is acted on before the
   * availability check, so a withdrawn golfer can still be removed, and a rejection is
   * answered after the availability and exclusivity checks.
   */
  evaluate(request: SelectionRequest): SelectionOutcome;

  /**
   * Everything that stops the lineup being submitted, empty when it may be (#481, #93). The
   * handler refuses a submit on any issue and sends a submitted entry back to draft when a pick
   * change leaves one.
   */
  findLineupIssues(input: LineupInput): LineupIssue[];

  /** How the room lists the field: the groups an entry picks from, in display order. */
  groupField(input: {
    tiers: readonly SelectionTierConfig[];
    participants: readonly SelectionParticipant[];
    rosterSize: number;
  }): FieldGroup[];

  /**
   * What the room tells the viewer about the viewed lineup beyond its picks, or null when the
   * type has nothing to say. `field` is every selectable row, for what the open places could cost.
   */
  summarizeLineup(input: LineupInput & {
    heldParticipantIds: ReadonlySet<string>;
    field: readonly SelectionParticipant[];
  }): LineupSummary | null;

  /**
   * The round a pick shows in within the room's history. `tierNumber` is the tier the pick's
   * participant sits in, if any; `entryPickIndex` is its 1-based position among its entry's
   * picks.
   */
  historyRound(input: { tierNumber: number | undefined; entryPickIndex: number }): number;
}

/**
 * The completeness issues every engine reports the same way: the roster is short unless it has
 * places and the lineup fills exactly that many, and each tier still owed picks is named.
 */
export function completenessIssues(input: {
  rosterSize: number;
  pickCount: number;
  shortTierNames: readonly string[];
}): LineupIssue[] {
  const { rosterSize, pickCount, shortTierNames } = input;
  const issues: LineupIssue[] = [];
  if (rosterSize <= 0 || pickCount !== rosterSize) {
    issues.push({ kind: LineupIssueKind.ROSTER_SHORT, pickCount, rosterSize });
  }
  if (shortTierNames.length > 0) {
    issues.push({ kind: LineupIssueKind.TIER_SHORT, tierNames: [...shortTierNames] });
  }
  return issues;
}
