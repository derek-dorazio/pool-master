/**
 * Where a bracket's final is (#2006): the round of its FINAL slot, or, in an event played in one
 * slot with no FINAL kind, the round where its links end. Never the last round by number.
 */
import { expect } from '@jest/globals';
import { finalRoundNumbers, SlotKind, type FinalCandidate } from '@poolmaster/shared/domain';

function game(roundNumber: number, seasonSlotId: string, slotKind: SlotKind, advances: boolean): FinalCandidate {
  return { roundNumber, slot: { seasonSlotId, slotKind }, advances };
}

describe('finalRoundNumbers', () => {
  it('finds the final in the FINAL slot\'s round, even when a third-place game is played in a later round', () => {
    const games = [
      game(1, 'sf', SlotKind.SEMIFINAL, true), game(1, 'sf', SlotKind.SEMIFINAL, true),
      game(2, 'final', SlotKind.FINAL, false),
      game(3, 'third', SlotKind.THIRD_PLACE, false),
    ];

    expect(finalRoundNumbers(games)).toEqual(new Set([2]));
  });

  it('finds a one-slot bracket\'s final where its links end, the one game whose winner goes nowhere (a tennis Slam)', () => {
    const slam = (roundNumber: number, advances: boolean) => game(roundNumber, 'us-open', SlotKind.TOURNAMENT, advances);

    expect(finalRoundNumbers([slam(1, true), slam(1, true), slam(2, false)])).toEqual(new Set([2]));
  });

  it('finds no final for games that form no bracket: a week of unlinked games, or a one-slot bracket whose links end in two games', () => {
    expect(finalRoundNumbers([game(1, 'w1', SlotKind.WEEK, false), game(1, 'w1', SlotKind.WEEK, false)])).toEqual(new Set());
    const split = [game(1, 't', SlotKind.TOURNAMENT, true), game(2, 't', SlotKind.TOURNAMENT, false), game(2, 't', SlotKind.TOURNAMENT, false)];
    expect(finalRoundNumbers(split)).toEqual(new Set());
  });

  it('finds no final in the last round of a bracket of several slots that has no FINAL slot: the last round by number is not the final', () => {
    expect(finalRoundNumbers([game(1, 'r16', SlotKind.ROUND_OF_16, true), game(2, 'qf', SlotKind.QUARTERFINAL, false)])).toEqual(new Set());
  });
});
