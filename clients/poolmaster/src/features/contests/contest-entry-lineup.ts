import { SelectionType, toCents } from '@poolmaster/shared/domain';
import type { SelectionStateResponse } from '@/lib/api';
import { formatDollars } from '@/features/shared/ui';
import type { SelectionGroup } from './contest-entry-selection';
import type { ErrorCodeMessages } from '@/lib/errors';

type SelectionState = SelectionStateResponse;
type BudgetLineupSummary = NonNullable<SelectionState['lineupSummary']>;

/** The ways of picking the entry page can build a lineup for, one rules arm each. */
export type EnterableSelectionType = typeof SelectionType.TIERED | typeof SelectionType.BUDGET_PICK;

export function isEnterableSelectionType(selectionType: SelectionType): selectionType is EnterableSelectionType {
  return selectionType === SelectionType.TIERED || selectionType === SelectionType.BUDGET_PICK;
}

/**
 * What differs between ways of picking on the entry page, mirroring the server's selection
 * engines: how a tap changes the lineup before the server answers, and what beyond a full lineup
 * keeps Submit disabled. The page shell (header, tiebreaker, Submit) is shared.
 */
type LineupRules = {
  /** The room as it will read once the server applies a tap on `participantId`. */
  applySelection: (selectionState: SelectionState, participantId: string, entryId: string) => SelectionState;
  /** Why a full lineup still cannot be submitted, in the words the page shows, or null. */
  submitBlockedReason: (selectionState: SelectionState) => string | null;
};

/**
 * When each of the entry's golfers was picked, by sport-event participant id. A full tier's swap
 * displaces the tier's most recently picked golfer on the server, and the tier's list is in tier
 * order, not pick order, so the optimistic swap needs this to drop the same one.
 */
export function buildPickedAtById(selectionState: SelectionState, entryId: string): Map<string, string> {
  return new Map(
    (selectionState.pickHistories ?? [])
      .flatMap((pick) => (pick.entryId === entryId && pick.participantId
        ? [[pick.participantId, pick.pickedAt] as const]
        : [])),
  );
}

/** A tiered group's picks after a tap: unselect a held golfer, swap the newest on a full tier. */
export function getNextSelectedParticipantIds(
  group: SelectionGroup,
  participantId: string,
  pickedAtById: ReadonlyMap<string, string>,
) {
  if (group.selectedParticipantIds.includes(participantId)) {
    return group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== participantId);
  }

  if (group.selectedParticipantIds.length >= group.picksFromGroup) {
    // A golfer with no pick time is treated as the oldest, so it is never the one displaced.
    const newest = group.selectedParticipantIds.reduce((latest, candidate) =>
      (pickedAtById.get(candidate) ?? '') >= (pickedAtById.get(latest) ?? '') ? candidate : latest);
    return [...group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== newest), participantId];
  }

  return Array.from(new Set([...group.selectedParticipantIds, participantId]));
}

/** A budget roster's picks after a tap: unselect a held golfer; a full roster takes no one new. */
function getNextBudgetSelectedParticipantIds(group: SelectionGroup, participantId: string) {
  if (group.selectedParticipantIds.includes(participantId)) {
    return group.selectedParticipantIds.filter((selectedParticipantId) => selectedParticipantId !== participantId);
  }
  return group.selectedParticipantIds.length >= group.picksFromGroup
    ? group.selectedParticipantIds
    : [...group.selectedParticipantIds, participantId];
}

/** The room with the group holding `participantId` re-picked, and `isComplete` recounted. */
function withGroupSelection(
  selectionState: SelectionState,
  participantId: string,
  nextSelectedIds: (group: SelectionGroup) => string[],
): SelectionState {
  const nextSelectionGroups = (selectionState.selectionGroups ?? []).map((group) => {
    if (!group.participants.some((participant) => participant.sportEventParticipantId === participantId)) {
      return group;
    }
    const selectedParticipantIds = nextSelectedIds(group);
    const selectedIdSet = new Set(selectedParticipantIds);
    return {
      ...group,
      selectedParticipantIds,
      participants: group.participants.map((participant) => ({
        ...participant,
        isSelected: selectedIdSet.has(participant.sportEventParticipantId),
      })),
    };
  });
  const totalSelections = nextSelectionGroups.reduce((sum, group) => sum + group.selectedParticipantIds.length, 0);
  const requiredSelections = nextSelectionGroups.reduce((sum, group) => sum + group.picksFromGroup, 0);
  return {
    ...selectionState,
    selectionGroups: nextSelectionGroups,
    isComplete: requiredSelections > 0 && totalSelections >= requiredSelections,
  };
}

/**
 * The spend after an optimistic tap, from the picked golfers' prices in cents. The cheapest fill
 * needs the whole field's availability, so it keeps the server's last answer until the next one.
 */
function respend(summary: BudgetLineupSummary, group: SelectionGroup): BudgetLineupSummary {
  const spentCents = group.participants
    .filter((participant) => group.selectedParticipantIds.includes(participant.sportEventParticipantId))
    .reduce((sum, participant) => sum + toCents(participant.price ?? 0), 0);
  const capCents = toCents(summary.salaryCap);
  return {
    ...summary,
    spent: spentCents / 100,
    remaining: (capCents - spentCents) / 100,
    isOverBudget: spentCents > capCents,
    openSlots: Math.max(0, group.picksFromGroup - group.selectedParticipantIds.length),
  };
}

export const LINEUP_RULES: Record<EnterableSelectionType, LineupRules> = {
  [SelectionType.TIERED]: {
    applySelection: (selectionState, participantId, entryId) => {
      const pickedAtById = buildPickedAtById(selectionState, entryId);
      return withGroupSelection(selectionState, participantId, (group) =>
        getNextSelectedParticipantIds(group, participantId, pickedAtById));
    },
    submitBlockedReason: () => null,
  },
  [SelectionType.BUDGET_PICK]: {
    applySelection: (selectionState, participantId) => {
      const next = withGroupSelection(selectionState, participantId, (group) =>
        getNextBudgetSelectedParticipantIds(group, participantId));
      const [field] = next.selectionGroups ?? [];
      return next.lineupSummary && field
        ? { ...next, lineupSummary: respend(next.lineupSummary, field) }
        : next;
    },
    submitBlockedReason: ({ lineupSummary }) => lineupSummary?.isOverBudget
      ? `Your golfers cost ${formatDollars(lineupSummary.spent)}, over the ${formatDollars(lineupSummary.salaryCap)} salary cap. Remove a golfer to get under it, then submit.`
      : null,
  },
};

/**
 * Copy for the pick and submit refusals the entry page can meet. The codes are the contract;
 * the server's own sentences are a fallback for anything not listed.
 */
export const CONTEST_ENTRY_CODE_MESSAGES: ErrorCodeMessages = {
  ENTRY_OVER_BUDGET: 'Your golfers cost more than the salary cap. Remove a golfer to get under it, then submit.',
  PRICE_MISSING: 'This golfer has no price yet, so they can’t be picked.',
};
