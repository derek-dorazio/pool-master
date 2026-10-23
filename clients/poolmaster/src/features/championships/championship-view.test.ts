import { describe, expect, it } from 'vitest';
import {
  buildPodium,
  describeChampionshipStanding,
  describeContestResult,
  describeContestResultFilter,
  describeHistoryChampions,
  describeHistoryCup,
  historyCupsOnShow,
  historyYearsOnShow,
  historyYearTitle,
  parseContestResultFilter,
} from './championship-view';
import { buildChampionshipStanding, buildContestResult, buildRunningChampionship } from './test/fixtures';

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

describe('parseContestResultFilter', () => {
  const standings = buildRunningChampionship().standings;

  it('reads a squad in the standings and a place from 1st to 10th from the link', () => {
    expect(parseContestResultFilter(new URLSearchParams('squad=team-1&place=10'), standings)).toEqual({ squadId: 'team-1', place: 10 });
    expect(parseContestResultFilter(new URLSearchParams('squad=team-1'), standings)).toEqual({ squadId: 'team-1', place: null });
  });

  it('drops a place outside the matrix or not a whole number, keeping the squad', () => {
    expect(parseContestResultFilter(new URLSearchParams('squad=team-1&place=11'), standings)).toEqual({ squadId: 'team-1', place: null });
    expect(parseContestResultFilter(new URLSearchParams('squad=team-1&place=1.5'), standings)).toEqual({ squadId: 'team-1', place: null });
  });

  it('ignores a squad not in the standings, and a place without a squad', () => {
    expect(parseContestResultFilter(new URLSearchParams('squad=team-9&place=1'), standings)).toBeNull();
    expect(parseContestResultFilter(new URLSearchParams('place=1'), standings)).toBeNull();
  });
});

describe('describeContestResultFilter', () => {
  it('heads the year\'s contests, a squad\'s, and one cell\'s', () => {
    expect(describeContestResultFilter(null, '', 2026)).toBe('Contests in 2026');
    expect(describeContestResultFilter({ squadId: 'team-1', place: null }, 'Casey Crushers', 2026)).toBe('Contests Casey Crushers played in 2026');
    expect(describeContestResultFilter({ squadId: 'team-1', place: 3 }, 'Casey Crushers', 2026)).toBe('Contests Casey Crushers finished 3rd in 2026');
  });
});

describe('describeContestResult', () => {
  it('names co-winners and the entries for a counted contest, with no badge', () => {
    const contest = buildContestResult({ winners: [
      { squadId: 'team-2', squadName: 'Birdie Bandits', squadIconKey: 'CAPTAIN_SMILE_SUNSET' },
      { squadId: 'team-1', squadName: 'Casey Crushers', squadIconKey: 'CAPTAIN_SMILE_FIELD' },
    ] });

    expect(describeContestResult(contest)).toEqual({ badge: null, note: 'Won by Birdie Bandits and Casey Crushers · 12 entries' });
  });

  it('marks a not-counted contest while still naming its winner, and says why one has no result', () => {
    expect(describeContestResult(buildContestResult({ count: 'NOT_COUNTED' }))).toEqual({ badge: 'Not counted', note: 'Won by Birdie Bandits · 12 entries' });
    expect(describeContestResult(buildContestResult({ count: 'NO_RESULT', winners: [], rankedEntryCount: 0 })))
      .toEqual({ badge: 'No result', note: 'Every event was cancelled, so nobody placed' });
  });
});

describe('All years lines', () => {
  const bandits = { squadId: 'team-2', squadName: 'Birdie Bandits', squadIconKey: 'CAPTAIN_SMILE_SUNSET' as const };
  const crushers = { squadId: 'team-1', squadName: 'Casey Crushers', squadIconKey: 'CAPTAIN_SMILE_FIELD' as const };
  const cup = { cupId: 'cup-1', sportLeagueId: 'sl-1', name: '2025 NFL Cup', status: 'CROWNED' as const, contestsCounted: 2, winners: [bandits] };

  it('heads the running year "so far" and a year that is over by its number', () => {
    expect(historyYearTitle({ year: 2026, isOver: false })).toBe('2026 so far');
    expect(historyYearTitle({ year: 2025, isOver: true })).toBe('2025');
  });

  it('names the champion or co-champions of a year over, the leaders of the running one, and says when nothing counted', () => {
    expect(describeHistoryChampions({ year: 2025, isOver: true, champions: [bandits], cups: [] })).toBe('Champion: Birdie Bandits');
    expect(describeHistoryChampions({ year: 2025, isOver: true, champions: [bandits, crushers], cups: [] })).toBe('Champions: Birdie Bandits and Casey Crushers');
    expect(describeHistoryChampions({ year: 2026, isOver: false, champions: [bandits, crushers], cups: [] })).toBe('Birdie Bandits and Casey Crushers lead');
    expect(describeHistoryChampions({ year: 2026, isOver: false, champions: [], cups: [] })).toBe('No championship contest counted');
  });

  it('names a crowned cup\'s winner and an open cup\'s leader, or that nobody leads yet', () => {
    expect(describeHistoryCup(cup)).toBe('Won by Birdie Bandits');
    expect(describeHistoryCup({ ...cup, status: 'OPEN' })).toBe('Birdie Bandits leads');
    expect(describeHistoryCup({ ...cup, status: 'OPEN', winners: [] })).toBe('Nobody leads yet');
  });

  it('shows a cup once two of its contests have counted, as the Trophy case does', () => {
    const open = { ...cup, status: 'OPEN' as const };
    expect(historyCupsOnShow([open, { ...open, cupId: 'cup-2', contestsCounted: 1 }]).map((row) => row.cupId)).toEqual(['cup-1']);
  });

  it('always shows a crowned cup, even one crowned after a single counted contest, so the Most cups tile matches the list', () => {
    expect(historyCupsOnShow([{ ...cup, contestsCounted: 1 }]).map((row) => row.cupId)).toEqual(['cup-1']);
  });

  it('applies the same show rule to a squad page\'s cup rows', () => {
    const rows = [
      { cupId: 'open-1', status: 'OPEN' as const, contestsCounted: 1 },
      { cupId: 'open-2', status: 'OPEN' as const, contestsCounted: 2 },
      { cupId: 'crowned-1', status: 'CROWNED' as const, contestsCounted: 1 },
    ];
    expect(historyCupsOnShow(rows).map((row) => row.cupId)).toEqual(['open-2', 'crowned-1']);
  });

  it('skips a year with no champion and no cup on show, and keeps the others with only their cups on show', () => {
    const quietCup = { ...cup, cupId: 'cup-2', status: 'OPEN' as const, contestsCounted: 1, winners: [] };
    const years = historyYearsOnShow([
      { year: 2027, isOver: false, champions: [], cups: [quietCup] },
      { year: 2026, isOver: false, champions: [bandits], cups: [quietCup] },
      { year: 2025, isOver: true, champions: [], cups: [cup, quietCup] },
    ]);
    expect(years.map((row) => [row.year, row.cups.map((shown) => shown.cupId)])).toEqual([[2026, []], [2025, ['cup-1']]]);
  });
});
