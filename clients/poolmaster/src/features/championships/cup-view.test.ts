import { describe, expect, it } from 'vitest';
import {
  buildRaceSeries,
  cupLeaders,
  cupProgress,
  cupsOnShow,
  describeCupContest,
  describeCupStanding,
  describeMovement,
  describeProjection,
  formatCupPoints,
  formatPlace,
  formatProjectedStanding,
  hasLiveContest,
  isCupSeasonOver,
  isReadyToCrown,
  nextContestToCount,
} from './cup-view';
import { buildCup, buildCupContest, buildCupStanding, buildRunningCup, buildRunningCupProjection } from './test/fixtures';

describe('cup view', () => {
  it('reads tenths of a point to one decimal, and whole points without one', () => {
    expect([formatCupPoints(6125), formatCupPoints(6000), formatCupPoints(0), formatCupPoints(12345)]).toEqual([
      '612.5', '600', '0', '1,234.5',
    ]);
  });

  it('shows movement as places up or down, with words for a screen reader, and a dash for none', () => {
    expect(describeMovement(2)).toEqual({ label: '▲2', description: 'Up 2 places', direction: 'up' });
    expect(describeMovement(-1)).toEqual({ label: '▼1', description: 'Down 1 place', direction: 'down' });
    expect(describeMovement(0)).toMatchObject({ label: '–', description: 'No change' });
    expect(describeMovement(null)).toMatchObject({ label: '–', description: 'No movement yet' });
  });

  it('reads a place as an ordinal, keeping a shared place as T2', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 103].map((position) => formatPlace({ position, displayPosition: String(position) }))).toEqual([
      '1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '103rd',
    ]);
    expect(formatPlace({ position: 2, displayPosition: 'T2' })).toBe('T2');
  });

  it('says a counted contest was won by its winners, and why the others do not count yet or at all', () => {
    expect(describeCupContest(buildCupContest({
      winners: [{ squadId: 'a', squadName: 'Eagles' }, { squadId: 'b', squadName: 'Birdies' }, { squadId: 'c', squadName: 'Bogeys' }],
    }))).toEqual({ label: 'Final', tone: 'final', note: 'Won by Eagles, Birdies and Bogeys' });
    expect(describeCupContest(buildCupContest({ count: 'NOT_COUNTED' }))).toMatchObject({ label: 'Not counted' });
    expect(describeCupContest(buildCupContest({ count: 'NO_RESULT' }))).toMatchObject({ label: 'No result' });
    expect(describeCupContest(buildCupContest({ count: 'NOT_FINAL', status: 'ACTIVE' }))).toMatchObject({ label: 'Live', tone: 'live' });
    expect(describeCupContest(buildCupContest({ count: 'NOT_FINAL', status: 'OPEN' }))).toMatchObject({ label: 'Open', tone: 'active' });
  });

  it('shows a cup once two of its contests have counted, not for one, nor for contests final without counting', () => {
    const counted = buildCupContest();
    const notCounted = buildCupContest({ count: 'NOT_COUNTED' });
    const two = buildCup({ id: 'two', contests: [counted, counted] });
    expect(cupsOnShow([
      buildCup({ id: 'one', contests: [counted, notCounted, buildCupContest({ count: 'NO_RESULT' })] }),
      two,
    ])).toEqual([two]);
  });

  it('counts every final contest toward a cup\'s progress, counted or not, out of all it lists', () => {
    expect(cupProgress(buildRunningCup())).toEqual({ final: 3, total: 4 });
  });

  it('names no leader while every squad is still at 0, and every squad sharing 1st once points are in', () => {
    expect(cupLeaders(buildCup({ standings: [buildCupStanding()] }))).toEqual([]);
    const shared = buildCup({
      standings: [
        buildCupStanding({ squadId: 'a', squadName: 'Eagles', points: 1000, displayPosition: 'T1' }),
        buildCupStanding({ squadId: 'b', squadName: 'Birdies', points: 1000, displayPosition: 'T1' }),
        buildCupStanding({ squadId: 'c', squadName: 'Bogeys', position: 3, points: 650 }),
      ],
    });
    expect(cupLeaders(shared).map((row) => row.squadName)).toEqual(['Eagles', 'Birdies']);
    expect(describeCupStanding(shared, { squadId: 'c', isViewer: true })).toBe('Eagles and Birdies share the lead · you are 3rd');
  });

  it('sums a cup up as its leader and the focus squad\'s place, by name when the focus is not the viewer', () => {
    const cup = buildRunningCup();
    expect(describeCupStanding(cup, { squadId: 'team-1', isViewer: true })).toBe('Birdie Bandits leads · you are 2nd');
    expect(describeCupStanding(cup, { squadId: 'team-3', isViewer: false })).toBe('Birdie Bandits leads · Bogey Men is 3rd');
    expect(describeCupStanding(cup, { squadId: null, isViewer: true })).toBe('Birdie Bandits leads');
    expect(describeCupStanding(buildCup(), { squadId: 'team-1', isViewer: true })).toBe('No contest has counted yet');
  });

  it('says who won a crowned cup and where the focus squad finished', () => {
    const cup = buildCup({ ...buildRunningCup(), status: 'CROWNED', crownedAt: '2026-09-30T12:00:00.000Z' });
    const shared = buildCup({
      status: 'CROWNED',
      standings: [
        buildCupStanding({ squadId: 'a', squadName: 'Eagles', position: 1, displayPosition: 'T1', points: 100 }),
        buildCupStanding({ squadId: 'b', squadName: 'Birdies', position: 1, displayPosition: 'T1', points: 100 }),
      ],
    });

    expect(describeCupStanding(cup, { squadId: 'team-1', isViewer: true })).toBe('Birdie Bandits won · you were 2nd');
    expect(describeCupStanding(cup, { squadId: 'team-3', isViewer: false })).toBe('Birdie Bandits won · Bogey Men was 3rd');
    expect(describeCupStanding(shared, { squadId: null, isViewer: true })).toBe('Eagles and Birdies share the cup');
  });

  it('is ready to crown once a contest has counted and none still to count is open or live, and never once crowned', () => {
    const counted = buildCupContest({ contestId: 'final' });
    const ready = buildCup({ contests: [counted, buildCupContest({ contestId: 'side', count: 'NOT_COUNTED', status: 'ACTIVE' })] });

    expect(isReadyToCrown(ready)).toBe(true);
    expect(isReadyToCrown(buildCup({ contests: [counted, buildCupContest({ contestId: 'live', status: 'ACTIVE', count: 'NOT_FINAL' })] }))).toBe(false);
    expect(isReadyToCrown(buildCup({ contests: [buildCupContest({ count: 'NO_RESULT' })] }))).toBe(false);
    expect(isReadyToCrown({ ...ready, status: 'CROWNED' })).toBe(false);
  });

  it('marks a contest the cup was crowned before as changing nothing', () => {
    expect(describeCupContest(buildCupContest({ count: 'AFTER_CROWNING' }))).toEqual({
      label: 'After crowning',
      tone: 'neutral',
      note: 'The cup was crowned before it went final, so it changes nothing',
    });
  });

  it('picks a live contest as the next to count before an open one that starts sooner', () => {
    const cup = buildCup({
      contests: [
        buildCupContest({ contestId: 'open', status: 'OPEN', count: 'NOT_FINAL' }),
        buildCupContest({ contestId: 'live', status: 'ACTIVE', count: 'NOT_FINAL' }),
      ],
    });
    expect(nextContestToCount(cup)?.contestId).toBe('live');
    expect(nextContestToCount(buildCup({ contests: [buildCupContest()] }))).toBeNull();
  });

  it('draws the top squads\' running totals from 0 before the first counted contest', () => {
    expect(buildRaceSeries(buildRunningCup(), 2)).toEqual([
      { squadId: 'team-2', squadName: 'Birdie Bandits', points: [0, 800, 1800] },
      { squadId: 'team-1', squadName: 'Casey Crushers', points: [0, 1000, 1650] },
    ]);
  });

  it('has a projection only for an open cup with a counted contest live, not one whose live contest is not counted or a crowned one', () => {
    const notCountedLive = buildCup({ contests: [buildCupContest({ status: 'ACTIVE', count: 'NOT_COUNTED', cupWeight: 'NOT_COUNTED', completedAt: null })] });
    const crowned = buildCup({ ...buildRunningCup(), status: 'CROWNED', crownedAt: '2026-09-01T00:00:00.000Z' });

    expect([hasLiveContest(buildRunningCup()), hasLiveContest(notCountedLive), hasLiveContest(crowned)]).toEqual([true, false, false]);
  });

  it('shows a projected place with its points, and names every live contest the projection counts', () => {
    const projection = buildRunningCupProjection();

    expect(formatProjectedStanding({ position: 2, displayPosition: 'T2', points: 725 })).toBe('T2 · 72.5');
    expect(formatProjectedStanding({ position: 3, displayPosition: '3', points: 2000 })).toBe('3rd · 200');
    expect(describeProjection({
      ...projection,
      contests: [...projection.contests, { contestId: 'contest-5', name: 'Wyndham Budget', cupWeight: 'BONUS' }],
    })).toBe('The greyed column shows where each squad would stand if Tour Championship Tiers and Wyndham Budget ended now.');
  });

  it('ends a cup\'s season once its year is past and no contest of it is open or live, but not while one still is', () => {
    const now = new Date('2026-02-03T12:00:00.000Z');
    const finals = [buildCupContest()];
    const stillLive = [...finals, buildCupContest({ contestId: 'super-bowl', status: 'ACTIVE', count: 'NOT_FINAL', completedAt: null })];

    expect([
      isCupSeasonOver(buildCup({ seasonYear: 2025, contests: finals }), now),
      isCupSeasonOver(buildCup({ seasonYear: 2025, contests: stillLive }), now),
      isCupSeasonOver(buildCup({ seasonYear: 2026, contests: finals }), now),
    ]).toEqual([true, false, false]);
  });
});
