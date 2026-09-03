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

// plans/124 §6.3 — pure tier-board model behind the drag-and-drop editor.

type Tier = Parameters<typeof buildTierBoard>[0][number];
type Field = Parameters<typeof buildTierBoard>[1][number];

function tier(overrides: Partial<Tier> = {}): Tier {
  return {
    tierKey: 'tier-1',
    label: 'Tier 1',
    tierNumber: 1,
    defaultPickCount: 1,
    assignments: [],
    ...overrides,
  };
}

function fieldEntry(overrides: Partial<Field> = {}): Field {
  return {
    sportEventParticipantId: 'sep-1',
    participantId: 'p-1',
    participantName: 'Rory McIlroy',
    shortName: 'R. McIlroy',
    nationality: 'NIR',
    isActive: true,
    inactiveReason: null as unknown as Field['inactiveReason'],
    worldRanking: 2,
    oddsToWin: 8,
    seedNumber: 2,
    price: 9000,
    isLeagueRosterMember: true,
    ...overrides,
  };
}

const field = [
  fieldEntry({ sportEventParticipantId: 'sep-1', participantId: 'p-1', participantName: 'Rory' }),
  fieldEntry({ sportEventParticipantId: 'sep-2', participantId: 'p-2', participantName: 'Scottie', price: 9800 }),
  fieldEntry({ sportEventParticipantId: 'sep-3', participantId: 'p-3', participantName: 'Jon', price: 8500 }),
];

const tiers = [
  tier({
    tierKey: 'tier-1',
    tierNumber: 1,
    assignments: [
      { sportEventParticipantId: 'sep-2', participantId: 'p-2', tierOrderIndex: 0, price: 9800 },
      { sportEventParticipantId: 'sep-1', participantId: 'p-1', tierOrderIndex: 1, price: 9000 },
    ],
  }),
  tier({ tierKey: 'tier-2', label: 'Tier 2', tierNumber: 2, assignments: [] }),
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
    const b = buildTierBoard(tiers, field.map((e) => ({ ...e, price: e.price + 1 })));
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
    // A golfer added before auto-assign prices — or one bulk-added with no
    // seedNumber — has price null at runtime (the generated type says `number`,
    // but the server DTO is `.nullable()` and really sends null — see the price
    // cell coalesce in golf-tier-board.tsx). It must round-trip as null so the
    // board's price input renders empty rather than the literal string "null".
    const nullPrice = null as unknown as number;
    const unpricedField = [
      fieldEntry({ sportEventParticipantId: 'sep-9', participantId: 'p-9', participantName: 'Guest', price: nullPrice }),
    ];
    const unpricedTiers = [
      tier({
        tierKey: 'tier-1',
        tierNumber: 1,
        assignments: [
          { sportEventParticipantId: 'sep-9', participantId: 'p-9', tierOrderIndex: 0, price: nullPrice },
        ],
      }),
    ];

    const assigned = buildTierBoard(unpricedTiers, unpricedField);
    expect(assigned[0].cards[0].price).toBeNull();

    // Same when the golfer is still in the Unassigned catch-all.
    const unassigned = buildTierBoard([tier({ assignments: [] })], unpricedField);
    expect(unassigned[1].cards[0].price).toBeNull();
  });
});
