import { describe, expect, it } from 'vitest';
import { SportStat } from '@poolmaster/shared/domain';
import { formatSportStatCount } from './stat-labels';

describe('formatSportStatCount', () => {
  it('writes one of a stat in the singular and any other count in the plural: "1 run", "2 runs", "0 runs"', () => {
    expect(formatSportStatCount(SportStat.RUNS, 1)).toBe('1 run');
    expect(formatSportStatCount(SportStat.RUNS, 2)).toBe('2 runs');
    expect(formatSportStatCount(SportStat.RUNS, 0)).toBe('0 runs');
  });

  it('keeps a stat whose unit does not change with the count the same: "15 reb", "1 reb"', () => {
    expect(formatSportStatCount(SportStat.REBOUNDS, 15)).toBe('15 reb');
    expect(formatSportStatCount(SportStat.REBOUNDS, 1)).toBe('1 reb');
  });

  it('gives every stat a unit, so a stat line never shows a bare key', () => {
    const missing = Object.values(SportStat).filter((stat) => formatSportStatCount(stat, 2).includes('statUnit'));
    expect(missing).toEqual([]);
  });
});
