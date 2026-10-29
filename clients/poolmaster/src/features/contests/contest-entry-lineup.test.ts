import { SelectionType } from '@poolmaster/shared/domain';
import { describe, expect, it } from 'vitest';
import type { SelectionPickResponse, SelectionStateResponse } from '@/lib/api';

type PickHistoryDto = SelectionPickResponse['picks'][number];
import { LINEUP_RULES, lineupRulesFor, mergePickChange } from './contest-entry-lineup';

function golfer(id: string, price: number, isSelected: boolean) {
  return {
    sportEventParticipantId: id,
    participantId: `participant-${id}`,
    participantName: id,
    price,
    isAvailable: true,
    isSelected,
  };
}

/** A two-golfer budget room under a $100 cap: a $50, b $40.01, c $10. */
function budgetRoom(selected: string[]): SelectionStateResponse {
  const prices: Record<string, number> = { a: 50, b: 40.01, c: 10 };
  const spent = selected.reduce((sum, id) => sum + (prices[id] ?? 0), 0);
  return {
    selectionType: SelectionType.BUDGET_PICK,
    selectionGroups: [{
      groupId: 'field',
      groupName: 'Field',
      groupNumber: 1,
      picksFromGroup: 2,
      selectedParticipantIds: selected,
      participants: Object.entries(prices).map(([id, price]) => golfer(id, price, selected.includes(id))),
    }],
    isComplete: selected.length >= 2,
    lineupSummary: {
      selectionType: SelectionType.BUDGET_PICK,
      salaryCap: 100,
      spent,
      remaining: 100 - spent,
      isOverBudget: spent > 100,
      openSlots: 2 - selected.length,
      cheapestFill: 10,
    },
  } as unknown as SelectionStateResponse;
}

const budget = LINEUP_RULES[SelectionType.BUDGET_PICK];

describe('budget lineup rules on the entry page', () => {
  it('adds a golfer and recounts the spend in cents, keeping the server\'s cheapest fill', () => {
    const next = budget.applySelection(budgetRoom(['a']), 'b', 'entry-1');

    expect(next.selectionGroups?.[0]?.selectedParticipantIds).toEqual(['a', 'b']);
    expect(next.isComplete).toBe(true);
    expect(next.lineupSummary).toMatchObject({ spent: 90.01, remaining: 9.99, isOverBudget: false, openSlots: 0, cheapestFill: 10 });
  });

  it('removes a held golfer when tapped again', () => {
    const next = budget.applySelection(budgetRoom(['a', 'b']), 'a', 'entry-1');

    expect(next.selectionGroups?.[0]?.selectedParticipantIds).toEqual(['b']);
    expect(next.lineupSummary).toMatchObject({ spent: 40.01, openSlots: 1 });
  });

  it('changes nothing for a new golfer on a full roster, since the server refuses that pick', () => {
    const next = budget.applySelection(budgetRoom(['a', 'b']), 'c', 'entry-1');

    expect(next.selectionGroups?.[0]?.selectedParticipantIds).toEqual(['a', 'b']);
  });

  it('blocks submitting only while the lineup costs more than the cap, naming both amounts', () => {
    const fits = budgetRoom(['a', 'b']);
    expect(budget.submitBlockedReason(fits)).toBeNull();
    const summary = fits.lineupSummary ?? null;
    expect(summary).not.toBeNull();
    expect(budget.submitBlockedReason({ ...fits, lineupSummary: summary && { ...summary, spent: 120, isOverBudget: true } }))
      .toBe('Your picks cost $120, over the $100 salary cap. Remove one to get under it, then submit.');
  });

});

describe('random-draw lineup rules on the entry page', () => {
  const draw = LINEUP_RULES[SelectionType.RANDOM_DRAW];

  it('leaves the room unchanged on a tap, since the draw deals every golfer and nobody picks', () => {
    const room = { ...budgetRoom(['a']), selectionType: SelectionType.RANDOM_DRAW, lineupSummary: undefined };

    expect(draw.applySelection(room, 'b', 'entry-1')).toBe(room);
  });

  it('always blocks submitting by hand, saying the commissioner\'s draw deals the golfers', () => {
    const room = { ...budgetRoom(['a', 'b']), selectionType: SelectionType.RANDOM_DRAW, lineupSummary: undefined };

    expect(draw.submitBlockedReason(room)).toBe(
      'Picks in this contest are dealt by the commissioner’s draw, so there is nothing to submit.',
    );
  });
});

describe('lineup rules by selection type', () => {
  it('has lineup rules for every roster type and none for pick\'em, whose entries pick games rather than a lineup', () => {
    expect(lineupRulesFor(SelectionType.TIERED)).toBe(LINEUP_RULES[SelectionType.TIERED]);
    expect(lineupRulesFor(SelectionType.BUDGET_PICK)).toBe(LINEUP_RULES[SelectionType.BUDGET_PICK]);
    expect(lineupRulesFor(SelectionType.RANDOM_DRAW)).toBe(LINEUP_RULES[SelectionType.RANDOM_DRAW]);
    expect(lineupRulesFor(SelectionType.PICK_EM)).toBeNull();
  });
});

describe('merging one pick change\'s answer into the room', () => {
  function pick(entryId: string, participantId: string, pickedAt: string): PickHistoryDto {
    return {
      pickNumber: 1,
      round: 1,
      pickInRound: 1,
      entryId,
      entryName: entryId,
      participantId,
      participantName: participantId,
      autoPicked: false,
      pickedAt,
    };
  }

  /** The budget room above, viewed for entry-1 in event-1, beside another entry with a pick of its own. */
  function viewedRoom(selected: string[]): SelectionStateResponse {
    return {
      ...budgetRoom(selected),
      sportEventId: 'event-1',
      selectedEntryId: 'entry-1',
      entries: [
        { id: 'entry-1', userId: 'user-1', name: 'Mine', status: 'SUBMITTED' },
        { id: 'entry-2', userId: 'user-2', name: 'Theirs', status: 'SUBMITTED' },
      ],
      pickHistories: [
        ...selected.map((id) => pick('entry-1', id, '2026-04-15T10:00:00.000Z')),
        pick('entry-2', 'c', '2026-04-15T09:00:00.000Z'),
      ],
    };
  }

  function answer(picked: string[], overrides: Partial<SelectionPickResponse> = {}): SelectionPickResponse {
    const summary = budgetRoom(picked).lineupSummary;
    return {
      contestId: 'contest-1',
      entryId: 'entry-1',
      sportEventId: 'event-1',
      entryStatus: 'DRAFT',
      picks: picked.map((id) => pick('entry-1', id, '2026-04-15T11:00:00.000Z')),
      lineupSummary: summary ? { ...summary, cheapestFill: 40.01 } : null,
      ...overrides,
    };
  }

  it('marks the entry\'s picks as the server kept them, with its status, its summary and a recount of completeness', () => {
    const merged = mergePickChange(viewedRoom(['a', 'b']), answer(['b']));

    const field = merged.selectionGroups?.[0];
    expect(field?.selectedParticipantIds).toEqual(['b']);
    expect(field?.participants.filter((participant) => participant.isSelected).map((participant) => participant.sportEventParticipantId))
      .toEqual(['b']);
    expect(merged.isComplete).toBe(false);
    expect(merged.entries.find((entry) => entry.id === 'entry-1')?.status).toBe('DRAFT');
    expect(merged.lineupSummary).toMatchObject({ spent: 40.01, openSlots: 1, cheapestFill: 40.01 });
  });

  it('replaces only the changed entry\'s pick history, leaving another entry\'s picks and status alone', () => {
    const merged = mergePickChange(viewedRoom(['a']), answer(['a', 'b']));

    expect(merged.pickHistories.filter((row) => row.entryId === 'entry-2').map((row) => row.participantId)).toEqual(['c']);
    expect(merged.pickHistories.filter((row) => row.entryId === 'entry-1').map((row) => row.participantId)).toEqual(['a', 'b']);
    expect(merged.entries.find((entry) => entry.id === 'entry-2')?.status).toBe('SUBMITTED');
  });

  it('leaves the room as it is for an answer about another event than the one shown', () => {
    const room = viewedRoom(['a']);

    expect(mergePickChange(room, answer(['a', 'b'], { sportEventId: 'event-2' }))).toBe(room);
  });

  it('keeps the viewed lineup when the answer is about an entry the room is not showing', () => {
    const merged = mergePickChange(viewedRoom(['a']), answer([], { entryId: 'entry-2' }));

    expect(merged.selectionGroups?.[0]?.selectedParticipantIds).toEqual(['a']);
    expect(merged.pickHistories.some((row) => row.entryId === 'entry-2')).toBe(false);
    expect(merged.entries.find((entry) => entry.id === 'entry-2')?.status).toBe('DRAFT');
  });
});
