import { describe, expect, it } from 'vitest';
import {
  formatClaimedCount,
  formatSquaresGameTeams,
  squaresGameChoices,
  squaresMomentLabel,
  squaresMomentRows,
  winningPeriodsByPlace,
} from './squares-board';
import { squaresGameFixture } from './test/squares-fixtures';

describe('squares board helpers', () => {
  it('names a quarters game\'s scoring moments Q1, Halftime, Q3 and Final, a halves game\'s Halftime and Final, and a hockey game\'s 1st period, 2nd period and Final', () => {
    expect([1, 2, 3, 4].map((period) => squaresMomentLabel(period, 'QUARTERS'))).toEqual(['Q1', 'Halftime', 'Q3', 'Final']);
    expect([1, 2].map((period) => squaresMomentLabel(period, 'HALVES'))).toEqual(['Halftime', 'Final']);
    expect([1, 2, 3].map((period) => squaresMomentLabel(period, 'THREE_PERIODS'))).toEqual(['1st period', '2nd period', 'Final']);
  });

  it('lists every scoring moment in order with its winner once scored and none before', () => {
    const winner = { periodNumber: 2, homeScore: 10, awayScore: 3, rowIndex: 3, columnIndex: 0, contestEntryId: null, entryName: null };
    const rows = squaresMomentRows({ winners: [winner], periodLayout: 'QUARTERS' });
    expect(rows.map((row) => [row.label, row.winner])).toEqual([['Q1', null], ['Halftime', winner], ['Q3', null], ['Final', null]]);
  });

  it('keeps every moment a box won when one box wins more than one', () => {
    const won = winningPeriodsByPlace([
      { periodNumber: 1, homeScore: 0, awayScore: 0, rowIndex: 2, columnIndex: 5, contestEntryId: 'entry-1', entryName: 'A' },
      { periodNumber: 4, homeScore: 20, awayScore: 10, rowIndex: 2, columnIndex: 5, contestEntryId: 'entry-1', entryName: 'A' },
    ]);
    expect(won.get('2:5')).toEqual([1, 4]);
  });

  it('counts an entry\'s claimed boxes against its limit in words', () => {
    expect(formatClaimedCount(4, 10)).toBe('4 of 10 boxes claimed');
    expect(formatClaimedCount(0, 1)).toBe('0 of 1 box claimed');
  });

  it('offers only games still to kick off with no quarter scored, the final first and then by kickoff', () => {
    const now = new Date('2099-01-20T00:00:00.000Z');
    const games = [
      squaresGameFixture({ id: 'played', status: 'COMPLETED', advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'kicked-off', scheduledDate: '2099-01-19T20:00:00.000Z', advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'scored', periodScores: [{ periodNumber: 1, homeScore: 7, awayScore: 0 }], advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'late-semi', matchNumber: 12, scheduledDate: '2099-01-26T00:00:00.000Z', advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'early-semi', matchNumber: 11, scheduledDate: '2099-01-25T20:00:00.000Z', advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'final', matchNumber: 13, scheduledDate: '2099-02-07T23:30:00.000Z' }),
    ];
    expect(squaresGameChoices(games, now).map((game) => game.id)).toEqual(['final', 'early-semi', 'late-semi']);
  });

  it('leaves out games before the sport league\'s first squares round, so a Champions League pool offers only its final', () => {
    const now = new Date('2099-01-20T00:00:00.000Z');
    const games = [
      squaresGameFixture({ id: 'semi-tie', roundNumber: 4, matchNumber: 11, scheduledDate: '2099-04-28T19:00:00.000Z', advancesToMatchId: 'final' }),
      squaresGameFixture({ id: 'final', roundNumber: 5, matchNumber: 13, scheduledDate: '2099-05-30T16:00:00.000Z' }),
    ];
    expect(squaresGameChoices(games, now, 5).map((game) => game.id)).toEqual(['final']);
  });

  it('names a game away team first, "vs" at a neutral site, and a side still to be decided as such', () => {
    const names = new Map([['field-chiefs', 'Chiefs']]);
    expect(formatSquaresGameTeams(squaresGameFixture(), names)).toBe('Chiefs vs To be decided');
    expect(formatSquaresGameTeams(squaresGameFixture({ isNeutralSite: false }), names)).toBe('Chiefs @ To be decided');
  });
});
