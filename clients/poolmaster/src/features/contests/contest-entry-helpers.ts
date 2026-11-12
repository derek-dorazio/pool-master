import { ContestStatus, SelectionType, type SportNoun } from '@poolmaster/shared/domain';
import type { ContestDto } from '@/lib/api';
import { contestStatusLabel } from './contest-status';
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
  return contest.status === ContestStatus.OPEN ? 'Entries closed' : contestStatusLabel(contest.status);
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
