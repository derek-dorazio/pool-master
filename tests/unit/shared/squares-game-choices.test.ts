/**
 * The Games a squares contest can be played on (#711, #2050): one rule, which the squares game
 * picker lists from the API and contest create checks a chosen Game against.
 */
import { expect } from '@jest/globals';
import { MatchStatus, SlotKind, squaresGameChoices, type SportEventRoundMatchGame } from '@poolmaster/shared/domain';
import { legacyMatch } from '../../support/match-sides';
import { roundSlot } from '../../support/round-slots';

const NOW = new Date('2099-01-20T00:00:00.000Z');
const SEMIFINAL = roundSlot(SlotKind.SEMIFINAL);
const FINAL = roundSlot(SlotKind.FINAL);

const idsOf = (matches: Parameters<typeof squaresGameChoices>[0]) => squaresGameChoices(matches, NOW).map(({ game }) => game.id);

describe('squaresGameChoices', () => {
  it('offers only Games still to kick off with no period scored, the final\'s first, then by kickoff and match number', () => {
    const matches = [
      legacyMatch({ id: 'played', slot: SEMIFINAL, status: MatchStatus.COMPLETED, homeScore: 24, awayScore: 21 }),
      legacyMatch({ id: 'kicked-off', slot: SEMIFINAL, scheduledDate: new Date('2099-01-19T20:00:00.000Z') }),
      legacyMatch({ id: 'scored', slot: SEMIFINAL, scheduledDate: new Date('2099-01-25T18:00:00.000Z'), periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 0 }] }),
      legacyMatch({ id: 'late-semi', slot: SEMIFINAL, matchNumber: 12, scheduledDate: new Date('2099-01-26T00:00:00.000Z') }),
      legacyMatch({ id: 'early-semi', slot: SEMIFINAL, matchNumber: 11, scheduledDate: new Date('2099-01-25T20:00:00.000Z') }),
      legacyMatch({ id: 'final', slot: FINAL, roundNumber: 2, scheduledDate: new Date('2099-02-07T23:30:00.000Z') }),
    ];

    expect(idsOf(matches)).toEqual(['final-g1', 'early-semi-g1', 'late-semi-g1']);
  });

  it('leaves out every Game of a slot that takes no squares, so a league whose early rounds are two-legged ties offers only its final', () => {
    const matches = [
      legacyMatch({ id: 'semi-tie', slot: roundSlot(SlotKind.SEMIFINAL, { squaresEligible: false }), scheduledDate: new Date('2099-04-28T19:00:00.000Z') }),
      legacyMatch({ id: 'final', slot: FINAL, roundNumber: 2, scheduledDate: new Date('2099-05-30T16:00:00.000Z') }),
    ];

    expect(idsOf(matches)).toEqual(['final-g1']);
  });

  it('offers each Game of a series still to play in game order, Game 1 first, and a Game with no kickoff yet last', () => {
    const series = legacyMatch({ id: 'finals', slot: roundSlot(SlotKind.FINAL, { seriesGames: 7 }), scheduledDate: new Date('2099-06-01T00:30:00.000Z') });
    const [gameOne] = series.games;
    const gameOf = (gameNumber: number, scheduledDate: Date | null): SportEventRoundMatchGame => ({ ...gameOne, id: `finals-g${String(gameNumber)}`, gameNumber, scheduledDate });
    const matches = [{ ...series, games: [gameOf(3, null), gameOf(2, new Date('2099-06-03T00:30:00.000Z')), gameOne] }];

    expect(idsOf(matches)).toEqual(['finals-g1', 'finals-g2', 'finals-g3']);
  });

  it('offers no Game when every one has kicked off', () => {
    expect(idsOf([legacyMatch({ id: 'final', slot: FINAL, status: MatchStatus.IN_PROGRESS, scheduledDate: new Date('2099-01-19T23:30:00.000Z') })])).toEqual([]);
  });
});
