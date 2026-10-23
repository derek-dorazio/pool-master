import { describe, expect, it } from 'vitest';
import { buildPodium, describeChampionshipStanding } from './championship-view';
import { buildChampionshipStanding, buildRunningChampionship } from './test/fixtures';

describe('describeChampionshipStanding', () => {
  it('names the leader, the gap to 2nd and the contests to go while the year runs', () => {
    expect(describeChampionshipStanding(buildRunningChampionship())).toBe('Birdie Bandits leads by 15 points with 2 contests to go.');
  });

  it('leaves off the contests to go once none is open or live', () => {
    expect(describeChampionshipStanding(buildRunningChampionship({ contestsToGo: 0 }))).toBe('Birdie Bandits leads by 15 points.');
  });

  it('says one contest, not "1 contests", is to go', () => {
    expect(describeChampionshipStanding(buildRunningChampionship({ contestsToGo: 1 }))).toBe('Birdie Bandits leads by 15 points with 1 contest to go.');
  });

  it('names every squad sharing the lead', () => {
    const championship = buildRunningChampionship({
      contestsToGo: 0,
      standings: [
        buildChampionshipStanding({ squadId: 'a', squadName: 'Aces', position: 1, points: 100 }),
        buildChampionshipStanding({ squadId: 'b', squadName: 'Birdies', position: 1, points: 100 }),
      ],
    });
    expect(describeChampionshipStanding(championship)).toBe('Aces and Birdies share the lead.');
  });

  it('names the champion and the winning points once the year is over', () => {
    expect(describeChampionshipStanding(buildRunningChampionship({ isOver: true }))).toBe('Birdie Bandits won with 245 points.');
  });

  it('says a year that ended with nothing counted had no contest', () => {
    const championship = buildRunningChampionship({ isOver: true, standings: [buildChampionshipStanding()] });
    expect(describeChampionshipStanding(championship)).toBe('No contest counted in 2026.');
  });
});

describe('buildPodium', () => {
  it('puts each of the top three places on its step, leaving off squads still at 0', () => {
    const steps = buildPodium([
      { squadId: 'a', squadName: 'Aces', position: 1, points: 300 },
      { squadId: 'b', squadName: 'Birdies', position: 2, points: 200 },
      { squadId: 'c', squadName: 'Chips', position: 3, points: 0 },
    ]);
    expect(steps.map((step) => [step.place, step.squads.map((squad) => squad.squadName)])).toEqual([
      [1, ['Aces']],
      [2, ['Birdies']],
    ]);
  });
});
