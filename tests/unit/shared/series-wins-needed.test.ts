import { describe, expect, it } from '@jest/globals';
import { seriesWinsNeeded } from '@poolmaster/shared/domain';

describe('seriesWinsNeeded', () => {
  it('needs more than half of the series\' games: 1 of 1, 2 of 3, 3 of 5, 4 of 7', () => {
    expect([1, 3, 5, 7].map(seriesWinsNeeded)).toEqual([1, 2, 3, 4]);
  });
});
