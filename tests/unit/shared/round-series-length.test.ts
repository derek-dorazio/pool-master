import { describe, expect, it } from '@jest/globals';
import { roundSeriesLength, seriesWinsNeeded } from '@poolmaster/shared/domain';

describe('roundSeriesLength', () => {
  it('reads a round\'s best-of length from the league\'s list, first to final', () => {
    // The WNBA's playoffs: a best of three, then two best of sevens.
    expect([1, 2, 3].map((round) => roundSeriesLength([3, 7, 7], round, 3))).toEqual([3, 7, 7]);
  });

  it('lines the lengths up with the final, so a bracket with more rounds than the list plays single games before it', () => {
    expect([1, 2, 3].map((round) => roundSeriesLength([7], round, 3))).toEqual([1, 1, 7]);
  });

  it('plays single games where the league names no lengths, or for a round past the event\'s count', () => {
    expect(roundSeriesLength([], 1, 4)).toBe(1);
    expect(roundSeriesLength([7, 7], 3, 2)).toBe(1);
  });
});

describe('seriesWinsNeeded', () => {
  it('needs more than half of the series\' games: 1 of 1, 2 of 3, 3 of 5, 4 of 7', () => {
    expect([1, 3, 5, 7].map(seriesWinsNeeded)).toEqual([1, 2, 3, 4]);
  });
});
