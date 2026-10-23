import { describe, expect, it } from 'vitest';
import { championshipsTitle, championshipYearsOffered, parseChampionshipYearParam } from './championship-year';

describe('championship year', () => {
  it('offers the current year and every championship year and cup season once, newest first', () => {
    expect(championshipYearsOffered([2026, 2024], [2025, 2024], 2026)).toEqual([2026, 2025, 2024]);
    expect(championshipYearsOffered([], [], 2027)).toEqual([2027]);
  });

  it('reads a four-digit year from the route and nothing else', () => {
    expect([parseChampionshipYearParam('2025'), parseChampionshipYearParam('latest'), parseChampionshipYearParam(undefined)]).toEqual([2025, null, null]);
  });

  it('titles the current year as its race and a past year as its championships', () => {
    const now = new Date('2026-09-01T12:00:00.000Z');
    expect([championshipsTitle(2026, now), championshipsTitle(2025, now)]).toEqual(['2026 Championship Race', '2025 Championships']);
  });
});
