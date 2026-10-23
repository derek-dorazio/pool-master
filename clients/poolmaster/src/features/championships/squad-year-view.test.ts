import { describe, expect, it } from 'vitest';
import { describeSquadChampionship, describeSquadCup, describeSquadTrophy, describeSquadYearLine, squadYearsPlaced } from './squad-year-view';
import { buildSquadChampionship, buildSquadCup, buildSquadHistory, buildSquadYear } from './test/fixtures';

describe('squad year lines', () => {
  it('names the squad\'s place of N with its gap to 1st, or that it leads, shares the lead, or won', () => {
    const first = { position: 1, displayPosition: '1' };
    const sharedFirst = { position: 1, displayPosition: 'T1' };
    expect(describeSquadChampionship(buildSquadChampionship())).toBe('2nd of 3 · 180 points · 6 behind 1st');
    expect(describeSquadChampionship(buildSquadChampionship({ pointsBehindLeader: 0 }, first))).toBe('1st of 3 · 180 points · Leads');
    expect(describeSquadChampionship(buildSquadChampionship({ pointsBehindLeader: 0 }, sharedFirst))).toBe('T1 of 3 · 180 points · Shares the lead');
    expect(describeSquadChampionship(buildSquadChampionship({ isOver: true, pointsBehindLeader: 0 }, first))).toBe('1st of 3 · 180 points · Champion');
    expect(describeSquadChampionship(buildSquadChampionship({ isOver: true, pointsBehindLeader: 0 }, sharedFirst))).toBe('T1 of 3 · 180 points · Co-champion');
  });

  it('says nothing has counted yet rather than placing the squad in an empty year', () => {
    expect(describeSquadChampionship(buildSquadChampionship({ contestsCounted: 0 }))).toBe('No championship contest has counted yet');
  });

  it('names a cup place, with its trophy once crowned', () => {
    expect(describeSquadCup(buildSquadCup({}, { position: 2, displayPosition: 'T2' }))).toBe('T2 of 3 · 160 points');
    expect(describeSquadCup(buildSquadCup({ status: 'CROWNED' }, { trophy: 'RUNNER_UP' }))).toBe('1st of 3 · 160 points · Runner-up');
  });

  it('names a trophy by what it was won in and its place', () => {
    expect(buildSquadHistory().trophies.map(describeSquadTrophy)).toEqual(['2025 Derek\'s Pool Cup · Runner-up', '2025 NFL Cup · Champion']);
  });

  it('lists only the years the squad placed in or has a cup on show in, each with its championship place and cup finishes', () => {
    const empty = buildSquadYear({ year: 2027, championship: buildSquadChampionship({}, { played: 0 }), cups: [buildSquadCup({ contestsCounted: 1 })] });
    const cupOnly = buildSquadYear({ year: 2026, championship: null, cups: [buildSquadCup({}, { position: 2, displayPosition: 'T2' })] });
    const past = buildSquadYear({
      year: 2025,
      championship: buildSquadChampionship({ isOver: true, squadCount: 12 }),
      cups: [buildSquadCup({ name: '2025 NFL Cup', status: 'CROWNED' }, { trophy: 'CHAMPION' })],
    });
    expect(squadYearsPlaced([empty, cupOnly, past]).map((row) => row.year)).toEqual([2026, 2025]);
    expect(describeSquadYearLine(cupOnly, 2026)).toEqual({ title: '2026 so far', detail: '2026 PGA Tour Cup T2' });
    expect(describeSquadYearLine(past, 2026)).toEqual({ title: '2025', detail: 'Championship 2nd of 12 · 2025 NFL Cup champion' });
  });
});
