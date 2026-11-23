import { displayString } from '@poolmaster/shared/display-strings';
import { describe, expect, it } from 'vitest';
import {
  formatClaimedCount,
  formatSquaresGameTeams,
  squaresGameChoices,
  squaresLiveBox,
  squaresMomentRows,
  squaresMomentTag,
  squaresScoreByPeriod,
  winningPeriodsByPlace,
} from './squares-board';
import { squaresGameFixture } from './test/squares-fixtures';
import type { SquaresBoardResponse } from '@/lib/api';

/** Digits as drawn for the live-box checks: the away score's 7 sits in row 3, the home score's 0 in column 0. */
const LIVE_DIGITS: NonNullable<SquaresBoardResponse['digits']> = {
  rowDigits: [3, 1, 4, 7, 5, 9, 2, 6, 8, 0],
  columnDigits: [0, 9, 8, 7, 6, 5, 4, 3, 2, 1],
  drawnAt: '2099-02-07T23:00:00.000Z',
};

describe('squares board helpers', () => {
  it('tags a quarters game\'s winning boxes Q1, Q2, Q3 and Final, a halves game\'s H1 and Final, and a hockey game\'s P1, P2 and Final', () => {
    expect([1, 2, 3, 4].map((period) => squaresMomentTag(period, 'QUARTERS'))).toEqual(['Q1', 'Q2', 'Q3', 'Final']);
    expect([1, 2].map((period) => squaresMomentTag(period, 'HALVES'))).toEqual(['H1', 'Final']);
    expect([1, 2, 3].map((period) => squaresMomentTag(period, 'THREE_PERIODS'))).toEqual(['P1', 'P2', 'Final']);
  });

  it('reads every period tag from the display strings\' short forms, and the last period\'s from its name unless asked for its short form', () => {
    const short = { form: 'short' } as const;
    expect([1, 2, 3, 4].map((period) => squaresMomentTag(period, 'QUARTERS'))).toEqual([
      displayString('word.quarterNumber', { n: 1 }, undefined, short),
      displayString('word.quarterNumber', { n: 2 }, undefined, short),
      displayString('word.quarterNumber', { n: 3 }, undefined, short),
      displayString('word.finalPeriod'),
    ]);
    expect(squaresMomentTag(1, 'HALVES')).toBe(displayString('word.halfNumber', { n: 1 }, undefined, short));
    expect(squaresMomentTag(2, 'THREE_PERIODS')).toBe(displayString('word.periodNumber', { n: 2 }, undefined, short));
    expect(squaresMomentTag(4, 'QUARTERS', 'short')).toBe(displayString('word.finalPeriod', undefined, undefined, short));
    expect(squaresMomentTag(4, 'QUARTERS', 'short')).toBe('F');
    expect(squaresMomentTag(2, 'QUARTERS', 'short')).toBe('Q2');
  });

  it('lists every scoring moment in order with its winner once scored and none before', () => {
    const winner = { periodNumber: 2, homeScore: 10, awayScore: 3, rowIndex: 3, columnIndex: 0, contestEntryId: null, entryName: null };
    const rows = squaresMomentRows({ winners: [winner], periodLayout: 'QUARTERS' });
    expect(rows.map((row) => [row.tag, row.winner])).toEqual([['Q1', null], ['Q2', winner], ['Q3', null], ['Final', null]]);
  });

  it('keeps every moment a box won when one box wins more than one', () => {
    const won = winningPeriodsByPlace([
      { periodNumber: 1, homeScore: 0, awayScore: 0, rowIndex: 2, columnIndex: 5, contestEntryId: 'entry-1', entryName: 'A' },
      { periodNumber: 4, homeScore: 20, awayScore: 10, rowIndex: 2, columnIndex: 5, contestEntryId: 'entry-1', entryName: 'A' },
    ]);
    expect(won.get('2:5')).toEqual([1, 4]);
  });

  it('counts an entry\'s claimed boxes against its limit in words', () => {
    expect(formatClaimedCount(4, 10)).toBe('4 of 10 boxes');
    expect(formatClaimedCount(0, 1)).toBe('0 of 1 box');
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

  it('leaves every period and total of the score table blank before kickoff', () => {
    const score = squaresScoreByPeriod(squaresGameFixture(), 'QUARTERS');
    expect(score.periodNames).toEqual(['Q1', 'Q2', 'Q3', 'Q4']);
    expect(score.home).toEqual({ periods: [null, null, null, null], total: null });
    expect(score.away).toEqual({ periods: [null, null, null, null], total: null });
    expect(score.livePeriodNumber).toBeNull();
  });

  it('splits a live game\'s score into each period\'s points, counting the period being played from the score now', () => {
    const game = squaresGameFixture({
      status: 'IN_PROGRESS',
      homeScore: 10,
      awayScore: 17,
      periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 7 }, { periodNumber: 2, homeScore: 10, awayScore: 14 }],
    });
    const score = squaresScoreByPeriod(game, 'QUARTERS');
    expect(score.away).toEqual({ periods: [7, 7, 3, null], total: 17 });
    expect(score.home).toEqual({ periods: [3, 7, 0, null], total: 10 });
    expect(score.livePeriodNumber).toBe(3);
  });

  it('runs a finished game\'s last period to the final score, overtime included, with no period live', () => {
    const game = squaresGameFixture({
      status: 'COMPLETED',
      homeScore: 27,
      awayScore: 24,
      periodScores: [
        { periodNumber: 1, homeScore: 3, awayScore: 7 },
        { periodNumber: 2, homeScore: 10, awayScore: 14 },
        { periodNumber: 3, homeScore: 17, awayScore: 17 },
      ],
    });
    const score = squaresScoreByPeriod(game, 'QUARTERS');
    expect(score.home).toEqual({ periods: [3, 7, 7, 10], total: 27 });
    expect(score.away).toEqual({ periods: [7, 7, 3, 7], total: 24 });
    expect(score.livePeriodNumber).toBeNull();
  });

  it('keeps a live game in its last period once the periods before it are all in', () => {
    const game = squaresGameFixture({
      status: 'IN_PROGRESS',
      homeScore: 21,
      awayScore: 20,
      periodScores: [1, 2, 3].map((periodNumber) => ({ periodNumber, homeScore: 14, awayScore: 14 })),
    });
    expect(squaresScoreByPeriod(game, 'QUARTERS').livePeriodNumber).toBe(4);
  });

  it('finds the box winning the live period at the row of the away score\'s last digit and the column of the home score\'s', () => {
    const game = squaresGameFixture({ status: 'IN_PROGRESS', homeScore: 10, awayScore: 17, periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 7 }] });
    expect(squaresLiveBox({ digits: LIVE_DIGITS, game, periodLayout: 'QUARTERS' })).toEqual({ periodNumber: 2, rowIndex: 3, columnIndex: 0 });
  });

  it('finds no live box before the draw, before kickoff or once the game is over', () => {
    const live = squaresGameFixture({ status: 'IN_PROGRESS', homeScore: 10, awayScore: 17 });
    expect(squaresLiveBox({ digits: null, game: live, periodLayout: 'QUARTERS' })).toBeNull();
    expect(squaresLiveBox({ digits: LIVE_DIGITS, game: squaresGameFixture(), periodLayout: 'QUARTERS' })).toBeNull();
    expect(squaresLiveBox({ digits: LIVE_DIGITS, game: squaresGameFixture({ status: 'COMPLETED', homeScore: 10, awayScore: 17 }), periodLayout: 'QUARTERS' })).toBeNull();
  });
});
