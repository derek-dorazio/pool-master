import { describe, expect, it } from 'vitest';
import { describeSquadChampionship, describeSquadCup, squadCupsOnShow } from './squad-year-view';
import { buildSquadChampionship, buildSquadCup } from './test/fixtures';

describe('squad year lines', () => {
  it('names the squad\'s place of N with its gap to 1st, or that it leads, shares the lead, or won', () => {
    expect(describeSquadChampionship(buildSquadChampionship())).toBe('2nd of 3 · 180 points · 6 behind 1st');
    expect(describeSquadChampionship(buildSquadChampionship({ position: 1, displayPosition: '1', pointsBehindLeader: 0 }))).toBe('1st of 3 · 180 points · Leads');
    expect(describeSquadChampionship(buildSquadChampionship({ position: 1, displayPosition: 'T1', pointsBehindLeader: 0 }))).toBe('T1 of 3 · 180 points · Shares the lead');
    expect(describeSquadChampionship(buildSquadChampionship({ isOver: true, position: 1, displayPosition: '1', pointsBehindLeader: 0 }))).toBe('1st of 3 · 180 points · Champion');
    expect(describeSquadChampionship(buildSquadChampionship({ isOver: true, position: 1, displayPosition: 'T1', pointsBehindLeader: 0 }))).toBe('T1 of 3 · 180 points · Co-champion');
  });

  it('says nothing has counted yet rather than placing the squad in an empty year', () => {
    expect(describeSquadChampionship(buildSquadChampionship({ contestsCounted: 0 }))).toBe('No championship contest has counted yet');
  });

  it('names a cup place with its trophy once crowned, and shows a crowned cup always but an open one only after two counted contests', () => {
    expect(describeSquadCup(buildSquadCup({ position: 2, displayPosition: 'T2' }))).toBe('T2 of 3 · 160 points');
    expect(describeSquadCup(buildSquadCup({ status: 'CROWNED', trophy: 'RUNNER_UP' }))).toBe('1st of 3 · 160 points · Runner-up');
    const shown = squadCupsOnShow([
      buildSquadCup({ cupId: 'open-1', contestsCounted: 1 }),
      buildSquadCup({ cupId: 'open-2', contestsCounted: 2 }),
      buildSquadCup({ cupId: 'crowned-1', status: 'CROWNED', contestsCounted: 1 }),
    ]);
    expect(shown.map((cup) => cup.cupId)).toEqual(['open-2', 'crowned-1']);
  });
});
