import { describe, expect, it } from 'vitest';
import { buildContestResult } from '@/features/championships/test/fixtures';
import { RECENTLY_FINAL_DAYS, describeRecentlyFinal, pickRecentlyFinal, recentlyFinalYears } from './recently-final';

const NOW = new Date('2026-11-17T18:00:00.000Z');

describe('pickRecentlyFinal', () => {
  it(`keeps the contests gone final in the last ${String(RECENTLY_FINAL_DAYS)} days, newest first, and drops older ones`, () => {
    const contests = [
      buildContestResult({ contestId: 'two-days', completedAt: '2026-11-15T18:00:00.000Z' }),
      buildContestResult({ contestId: 'four-days', completedAt: '2026-11-13T18:00:00.000Z' }),
      buildContestResult({ contestId: 'today', completedAt: '2026-11-17T12:00:00.000Z' }),
    ];

    expect(pickRecentlyFinal(contests, NOW).map((contest) => contest.contestId)).toEqual(['today', 'two-days']);
  });
});

describe('recentlyFinalYears', () => {
  it('reads only this championship year mid-year, and last year too in the first days of January', () => {
    expect(recentlyFinalYears(NOW)).toEqual([2026]);
    expect(recentlyFinalYears(new Date('2027-01-02T18:00:00.000Z'))).toEqual([2027, 2026]);
  });
});

describe('describeRecentlyFinal', () => {
  it('gives the team\'s place of every ranked entry, or the entry count for a team not in it', () => {
    expect(describeRecentlyFinal({ rankedEntryCount: 14, squadFinish: { displayPlace: 'T3', place: 3, points: 0 } }, 'en-US')).toBe('Final · you were T3 of 14');
    expect(describeRecentlyFinal({ rankedEntryCount: 1, squadFinish: null }, 'en-US')).toBe('Final · 1 entry');
  });
});
