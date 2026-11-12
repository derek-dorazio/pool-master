import { ContestStatus, SelectionType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import {
  formatStillToPick,
  getCompletionStats,
  getContestPhaseLabel,
  getNextIncompleteGroupId,
} from './contest-entry-helpers';

const golfers = { one: 'golfer', many: 'golfers' };

describe('contest entry helpers', () => {
  it('says how many picks are left in the singular for one and the plural for any other count', () => {
    expect(formatStillToPick(1, golfers)).toBe('1 golfer still to pick');
    expect(formatStillToPick(3, golfers)).toBe('3 golfers still to pick');
    expect(formatStillToPick(0, golfers)).toBe('0 golfers still to pick');
  });

  it('reads an open roster contest as editable until the event starts and an open random draw as open until the draw', () => {
    expect(getContestPhaseLabel({ selectionType: SelectionType.TIERED, status: ContestStatus.OPEN }, true)).toBe('Editable until the event starts');
    expect(getContestPhaseLabel({ selectionType: SelectionType.RANDOM_DRAW, status: ContestStatus.OPEN }, true)).toBe('Open until the draw');
  });

  it('reads a contest still open past its start as entries closed, and any later status by its usual label', () => {
    expect(getContestPhaseLabel({ selectionType: SelectionType.TIERED, status: ContestStatus.OPEN }, false)).toBe('Entries closed');
    expect(getContestPhaseLabel({ selectionType: SelectionType.TIERED, status: ContestStatus.ACTIVE }, false)).toBe('Live');
  });

  it('counts full tiers, picks made and picks needed across the lineup', () => {
    expect(getCompletionStats([
      { picksFromGroup: 2, selectedParticipantIds: ['a', 'b'] },
      { picksFromGroup: 2, selectedParticipantIds: ['c'] },
      { picksFromGroup: 1, selectedParticipantIds: [] },
    ])).toEqual({ completedTiers: 1, totalSelections: 3, requiredSelections: 5 });
    expect(getCompletionStats([])).toEqual({ completedTiers: 0, totalSelections: 0, requiredSelections: 0 });
  });

  it('names the first tier still short of picks, and null once every tier is full', () => {
    const full = { groupId: 'a', picksFromGroup: 1, selectedParticipantIds: ['x'] };
    const short = { groupId: 'b', picksFromGroup: 2, selectedParticipantIds: ['y'] };
    const empty = { groupId: 'c', picksFromGroup: 1, selectedParticipantIds: [] };
    expect(getNextIncompleteGroupId([full, short, empty])).toBe('b');
    expect(getNextIncompleteGroupId([full])).toBeNull();
  });
});
