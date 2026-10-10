/**
 * The budget-pick selection engine (#198, #93): pick a roster of a set size whose prices fit
 * under the event's salary cap.
 *
 * The budget never blocks a pick (Derek, plans/93 §2): an entry may go over the cap while it
 * shuffles its roster, and only submitting is refused while it is over. So re-selecting a
 * golfer the entry holds **toggles it off**, the one way to make room, and a full roster is
 * complete: nothing is displaced. A golfer with no price cannot be picked, since a pick must be
 * spent against the cap. Money is summed in whole cents, never as floats.
 */

import { SelectionType, toCents, type ContestConfiguration } from '@poolmaster/shared/domain';
import { LineupIssueKind, type LineupIssue, type SelectionParticipant } from '../types';
import {
  completenessIssues,
  SelectionOutcomeKind,
  SelectionRejectCode,
  type EntryPick,
  type LineupPick,
  type SelectionEngine,
} from './selection-engine';

/** The budget rules' salary cap, or null when the contest carries no budget rules. */
function salaryCapOf(configuration: ContestConfiguration | null): number | null {
  return configuration?.configJson?.selectionType === SelectionType.BUDGET_PICK
    ? configuration.configJson.salaryCap
    : null;
}

/**
 * What the picks cost, in cents. A pick with no price adds nothing: the engine refuses to pick
 * an unpriced golfer and prices are frozen at release, so a held pick always has one.
 */
function spentCents(picks: readonly LineupPick[]): number {
  return picks.reduce((sum, pick) => sum + (pick.price === undefined ? 0 : toCents(pick.price)), 0);
}

/** The lowest place in the lineup no held pick occupies, so a removed pick's place is reused. */
function firstFreeSlot(existingPicks: readonly EntryPick[]): number {
  const taken = new Set(existingPicks.map((pick) => pick.lineupSlot));
  let slot = 1;
  while (taken.has(slot)) slot += 1;
  return slot;
}

/** Field order for a budget room: dearest first, unpriced last, then by name. */
function byPriceDescending(left: SelectionParticipant, right: SelectionParticipant): number {
  const leftPrice = left.price ?? -1;
  const rightPrice = right.price ?? -1;
  if (leftPrice !== rightPrice) return rightPrice - leftPrice;
  return left.participantName.localeCompare(right.participantName);
}

export const budgetPickSelectionEngine: SelectionEngine = {
  selectionType: SelectionType.BUDGET_PICK,

  /** The roster size the contest's budget rules carry, and 0 when it carries none. */
  rosterSize: ({ configuration }) =>
    configuration?.configJson?.selectionType === SelectionType.BUDGET_PICK ? configuration.configJson.rosterSize : 0,

  evaluate: ({ participant, heldPick, existingPicks, rosterSize }) => {
    if (heldPick) return { kind: SelectionOutcomeKind.TOGGLE_OFF, pickId: heldPick.id };
    if (participant.price === undefined) {
      return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.PRICE_MISSING };
    }
    if (existingPicks.length >= rosterSize) {
      return { kind: SelectionOutcomeKind.REJECT, code: SelectionRejectCode.ENTRY_COMPLETE };
    }
    return { kind: SelectionOutcomeKind.ACCEPT, lineupSlot: firstFreeSlot(existingPicks) };
  },

  /** A full roster, judged by count alone (there are no tiers), that costs no more than the cap. */
  findLineupIssues: ({ configuration, rosterSize, picks }) => {
    const issues: LineupIssue[] = completenessIssues({ rosterSize, pickCount: picks.length, shortTierNames: [] });
    const salaryCap = salaryCapOf(configuration);
    const spent = spentCents(picks);
    if (salaryCap !== null && spent > toCents(salaryCap)) {
      issues.push({ kind: LineupIssueKind.OVER_BUDGET, spent: spent / 100, salaryCap });
    }
    return issues;
  },

  /** The whole field as one group, dearest first, so the list reads as a price board. */
  groupField: ({ participants, rosterSize }) => [{
    groupId: 'field',
    groupName: 'Field',
    groupNumber: 1,
    picksFromGroup: rosterSize,
    participants: [...participants].sort(byPriceDescending),
  }],

  summarizeLineup: ({ configuration, rosterSize, picks, heldParticipantIds, field }) => {
    const salaryCap = salaryCapOf(configuration);
    if (salaryCap === null) return null;

    const capCents = toCents(salaryCap);
    const spent = spentCents(picks);
    const openSlots = Math.max(0, rosterSize - picks.length);
    const cheapestOpen = field
      .flatMap((participant) => participant.isAvailable
        && participant.price !== undefined
        && !heldParticipantIds.has(participant.participantId)
        ? [toCents(participant.price)]
        : [])
      .sort((left, right) => left - right)
      .slice(0, openSlots);

    return {
      selectionType: SelectionType.BUDGET_PICK,
      salaryCap,
      spent: spent / 100,
      remaining: (capCents - spent) / 100,
      isOverBudget: spent > capCents,
      openSlots,
      cheapestFill: cheapestOpen.length === openSlots
        ? cheapestOpen.reduce((sum, cents) => sum + cents, 0) / 100
        : null,
    };
  },

  historyRound: ({ entryPickIndex }) => entryPickIndex,
};
