import { describe, expect, it } from 'vitest';
import {
  UNASSIGNED_KEY,
  assignmentsEqual,
  buildTierBoard,
  moveCard,
  nudgeCard,
  reorderById,
  reorderColumn,
  toAssignmentsPayload,
} from './golf-tier-board-utils';
import {
  fieldEntryFixture,
  participantFixture,
  tierFixture,
  valuationFixture,
} from './golf-test-fixtures';

// plans/124 §6.3 — pure tier-board model behind the drag-and-drop editor. #236: a
// golfer's tier and order come from its valuation, not from assignments on the tier.

function entry(id: string, name: string, tierId: string | null, order: number | null, price: number | null) {
  return fieldEntryFixture({
    id,
    participantId: `p-${id}`,
    participant: participantFixture({ id: `p-${id}`, name }),
    ranking: 2,
    oddsToWin: 8,
    valuation: valuationFixture({ sportEventTierId: tierId, tierOrderIndex: order, price }),
  });
}

const field = [
  entry('sep-1', 'Rory', 'tier-id-1', 1, 9000),
  entry('sep-2', 'Scottie', 'tier-id-1', 0, 9800),
  entry('sep-3', 'Jon', null, null, 8500),
];

const tiers = [
  tierFixture({ id: 'tier-id-1', tierKey: 'tier-1', tierNumber: 1 }),
  tierFixture({ id: 'tier-id-2', tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2 }),
];

describe('pool-master-dyb golf-tier-board-utils', () => {
  it('pool-master-dyb builds columns per tier (ordered) + an Unassigned catch-all', () => {
    const board = buildTierBoard(tiers, field);
    expect(board.map((c) => c.key)).toEqual(['tier-1', 'tier-2', UNASSIGNED_KEY]);
    // tier-1 cards ordered by tierOrderIndex, names resolved from the field.
    expect(board[0].cards.map((c) => c.name)).toEqual(['Scottie', 'Rory']);
    // sep-3 is in the field but not assigned -> Unassigned.
    expect(board[2].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-3']);
  });

  it('pool-master-dyb moveCard reassigns a golfer to another column (keyboard "Move to tier" path)', () => {
    const board = buildTierBoard(tiers, field);
    const moved = moveCard(board, 'sep-1', 'tier-2');
    expect(moved[0].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-2']);
    expect(moved[1].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-1']);
  });

  it('pool-master-dyb nudgeCard swaps a golfer with its neighbour, clamped at the ends', () => {
    const board = buildTierBoard(tiers, field);
    const up = nudgeCard(board, 'sep-1', -1); // sep-1 is second -> becomes first
    expect(up[0].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-1', 'sep-2']);
    // Already first -> no change.
    expect(nudgeCard(up, 'sep-1', -1)).toBe(up);
  });

  it('pool-master-dyb toAssignmentsPayload emits assigned golfers only, with fresh order indices', () => {
    const board = moveCard(buildTierBoard(tiers, field), 'sep-3', 'tier-2');
    expect(toAssignmentsPayload(board)).toEqual([
      { sportEventParticipantId: 'sep-2', tierKey: 'tier-1', tierOrderIndex: 0 },
      { sportEventParticipantId: 'sep-1', tierKey: 'tier-1', tierOrderIndex: 1 },
      { sportEventParticipantId: 'sep-3', tierKey: 'tier-2', tierOrderIndex: 0 },
    ]);
  });

  it('pool-master-dyb assignmentsEqual ignores price but not tier/order', () => {
    const a = buildTierBoard(tiers, field);
    const b = buildTierBoard(
      tiers,
      field.map((e) => ({
        ...e,
        valuation: e.valuation ? { ...e.valuation, price: (e.valuation.price ?? 0) + 1 } : null,
      })),
    );
    expect(assignmentsEqual(a, b)).toBe(true);
    expect(assignmentsEqual(a, moveCard(a, 'sep-1', 'tier-2'))).toBe(false);
  });

  it('pool-master-dyb reorderById reorders a keyed list and drops missing ids (SortableList onReorder result)', () => {
    const list = [
      { id: 'a', label: 'Alpha' },
      { id: 'b', label: 'Beta' },
      { id: 'c', label: 'Gamma' },
    ];
    expect(reorderById(list, ['c', 'a', 'b']).map((i) => i.id)).toEqual(['c', 'a', 'b']);
    expect(reorderById(list, ['b', 'zzz', 'a']).map((i) => i.id)).toEqual(['b', 'a']);
  });

  it('pool-master-dyb reorderColumn applies an ordered id list to one column only', () => {
    const board = buildTierBoard(tiers, field); // tier-1 = [sep-2, sep-1]
    const next = reorderColumn(board, 'tier-1', ['sep-1', 'sep-2']);
    expect(next[0].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-1', 'sep-2']);
    // Other columns untouched (same reference).
    expect(next[1]).toBe(board[1]);
    expect(next[2]).toBe(board[2]);
  });

  it('pool-master-z3l keeps a null price as null (not coerced) for an unpriced golfer', () => {
    // A golfer added before auto-assign prices has no price. It must stay null so
    // the board's price input renders empty rather than the literal string "null".
    const assigned = buildTierBoard(tiers, [entry('sep-9', 'Guest', 'tier-id-1', 0, null)]);
    expect(assigned[0].cards[0].price).toBeNull();

    // Same when the golfer is still in the Unassigned catch-all.
    const unassigned = buildTierBoard(tiers, [entry('sep-9', 'Guest', null, null, null)]);
    expect(unassigned[2].cards[0].price).toBeNull();
  });

  it('puts a golfer whose valuation names a tier not among the definitions in Unassigned', () => {
    const board = buildTierBoard(tiers, [entry('sep-7', 'Orphan', 'tier-id-gone', 0, 5000)]);
    expect(board[0].cards).toEqual([]);
    expect(board[2].cards.map((c) => c.sportEventParticipantId)).toEqual(['sep-7']);
  });
});
