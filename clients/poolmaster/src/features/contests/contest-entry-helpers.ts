import { ContestStatus, SelectionType, formatDollars, type SportNoun } from '@poolmaster/shared/domain';
import { enumLabel } from '@poolmaster/shared/display-strings';
import type { ContestDto, SelectionStateResponse } from '@/lib/api';
import type { StatStripItem } from '@/features/shared/ui';
import type { SelectionGroup } from './contest-entry-selection';

/** How many of the lineup's picks are still to make, in the contest's own word: "3 golfers still to pick". */
export function formatStillToPick(count: number, participant: SportNoun): string {
  return `${count} ${count === 1 ? participant.one : participant.many} still to pick`;
}

/**
 * The entry page says what an open contest means for this entry; every other status reads as it
 * does on every contest page.
 */
export function getContestPhaseLabel(contest: Pick<ContestDto, 'selectionType' | 'status'>, entriesOpen: boolean): string {
  if (entriesOpen) {
    return contest.selectionType === SelectionType.RANDOM_DRAW
      ? 'Open until the draw'
      : 'Editable until the event starts';
  }
  // Still OPEN past its start means the event has teed off and the In Progress update is late.
  return contest.status === ContestStatus.OPEN ? 'Entries closed' : enumLabel('ContestStatus', contest.status);
}

type GroupProgress = Pick<SelectionGroup, 'picksFromGroup' | 'selectedParticipantIds'>;

/** How far the lineup is: the tiers already full, and the picks made against the picks needed. */
export function getCompletionStats(selectionGroups: GroupProgress[]) {
  return {
    completedTiers: selectionGroups.filter((group) => group.selectedParticipantIds.length >= group.picksFromGroup).length,
    totalSelections: selectionGroups.reduce((sum, group) => sum + group.selectedParticipantIds.length, 0),
    requiredSelections: selectionGroups.reduce((sum, group) => sum + group.picksFromGroup, 0),
  };
}

/** The first tier still short of picks, which the page opens next, or null when every tier is full. */
export function getNextIncompleteGroupId(selectionGroups: Array<GroupProgress & Pick<SelectionGroup, 'groupId'>>): string | null {
  return selectionGroups.find((group) => group.selectedParticipantIds.length < group.picksFromGroup)?.groupId ?? null;
}

/**
 * A lineup's progress strip (#1769): how many are picked, then the budget spent, or while picks
 * are open the next tier to fill.
 */
export function rosterProgressItems({
  isBudget,
  isEditable,
  lineupSummary,
  selectionGroups,
}: {
  isBudget: boolean;
  isEditable: boolean;
  lineupSummary: SelectionStateResponse['lineupSummary'] | null;
  selectionGroups: Array<GroupProgress & Pick<SelectionGroup, 'groupId' | 'groupName'>>;
}): StatStripItem[] {
  const stats = getCompletionStats(selectionGroups);
  const nextGroupId = getNextIncompleteGroupId(selectionGroups);
  const picked: StatStripItem = { label: 'Picked', value: `${stats.totalSelections} of ${stats.requiredSelections}`, testId: 'contest-entry-picked-count' };
  if (isBudget) {
    return lineupSummary
      ? [picked, { label: 'Spent', value: `${formatDollars(lineupSummary.spent)} of ${formatDollars(lineupSummary.salaryCap)}`, testId: 'contest-entry-spent' }]
      : [picked];
  }
  if (!isEditable) {
    return [picked];
  }
  const nextGroup = selectionGroups.find((group) => group.groupId === nextGroupId);
  return [picked, { label: 'Next', value: nextGroup ? nextGroup.groupName : 'Lineup full', testId: 'contest-entry-next-tier' }];
}

/** A random draw's progress strip (#1769): when the draw ran, and how many it deals each entry. */
export function drawProgressItems({
  drawnAt,
  noun,
  rosterSize,
}: {
  /** When the draw ran, as the page words it; null before it runs. */
  drawnAt: string | null;
  /** What the event's sport calls a participant: "golfer", "horse". */
  noun: SportNoun;
  rosterSize: number;
}): StatStripItem[] {
  return [
    { label: 'Draw', value: drawnAt ?? 'Not yet run', testId: 'contest-entry-draw-status' },
    { label: `${noun.many.charAt(0).toUpperCase()}${noun.many.slice(1)}`, value: String(rosterSize), testId: 'contest-entry-draw-count' },
  ];
}
