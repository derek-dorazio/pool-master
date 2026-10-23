import { describe, expect, it } from 'vitest';
import { describeSquadChampionship, describeSquadCup } from './squad-year-view';
import { buildSquadChampionship, buildSquadCup } from './test/fixtures';

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
});
