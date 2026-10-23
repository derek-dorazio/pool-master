/**
 * The league championship's pure rules (#863): which year a settlement falls in, how a year's
 * finishes tally and rank, and who holds each medal tile.
 */
import {
  ChampionshipTile,
  CupWeight,
  championshipTiles,
  championshipYear,
  championshipYearStart,
  rankChampionshipTallies,
  tallyChampionship,
} from '@poolmaster/shared/domain';

const finish = (squadId: string, place: number, points: number, weight: CupWeight = CupWeight.NORMAL) => ({ squadId, place, points, weight });

describe('championship rules (#863)', () => {
  it('puts a contest final at 11pm New York on 31 December, 04:00Z on 1 January, in the old year, and one an hour later in the new', () => {
    expect(championshipYear(new Date('2027-01-01T04:00:00.000Z'))).toBe(2026);
    expect(championshipYear(new Date('2027-01-01T05:00:00.000Z'))).toBe(2027);
  });

  it('starts a championship year at midnight New York on 1 January, 05:00Z, the first instant championshipYear puts in it', () => {
    const start = championshipYearStart(2027);

    expect(start.toISOString()).toBe('2027-01-01T05:00:00.000Z');
    expect(championshipYear(start)).toBe(2027);
    expect(championshipYear(new Date(start.getTime() - 1))).toBe(2026);
  });

  it('tallies points, the finish matrix, podiums, top tens and contests played, leaving out NOT_COUNTED finishes and giving an unplaced squad a row at 0', () => {
    const tallies = tallyChampionship(['eagles', 'birdies'], [
      finish('eagles', 1, 1000),
      finish('eagles', 3, 650),
      finish('eagles', 12, 230),
      finish('eagles', 1, 1000, CupWeight.NOT_COUNTED),
    ]);

    expect(tallies).toEqual([
      { squadId: 'eagles', points: 1880, finishes: [1, 0, 1, 0, 0, 0, 0, 0, 0, 0], podiums: 2, topTens: 2, played: 3 },
      { squadId: 'birdies', points: 0, finishes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], podiums: 0, topTens: 0, played: 0 },
    ]);
  });

  it('ranks on points, then most 1sts, then most 2nds, and shares the place between squads equal on all three as "T2"', () => {
    const ranked = rankChampionshipTallies(tallyChampionship(['a', 'b', 'c', 'd'], [
      finish('a', 1, 1000),
      finish('b', 2, 800), finish('b', 2, 200),
      finish('c', 1, 500), finish('c', 2, 500),
      finish('d', 3, 1000),
    ]));

    expect(ranked.map((row) => [row.squadId, row.displayPosition])).toEqual([
      ['c', '1'],
      ['a', '2'],
      ['b', '3'],
      ['d', '4'],
    ]);
    const tied = rankChampionshipTallies(tallyChampionship(['a', 'b'], [finish('a', 2, 800), finish('b', 2, 800)]));
    expect(tied.map((row) => row.displayPosition)).toEqual(['T1', 'T1']);
  });

  it('names every squad tied on a medal tile\'s most, and nobody on a tile nobody has any of', () => {
    const tiles = championshipTiles(tallyChampionship(['a', 'b'], [finish('a', 1, 1000), finish('b', 1, 1000), finish('b', 3, 650)]));

    expect(tiles.map((tile) => [tile.tile, tile.count, tile.squadIds])).toEqual([
      [ChampionshipTile.MOST_FIRSTS, 1, ['a', 'b']],
      [ChampionshipTile.MOST_SECONDS, 0, []],
      [ChampionshipTile.MOST_THIRDS, 1, ['b']],
      [ChampionshipTile.MOST_PODIUMS, 2, ['b']],
      [ChampionshipTile.MOST_TOP_TENS, 2, ['b']],
      [ChampionshipTile.MOST_PLAYED, 2, ['b']],
    ]);
  });
});
