/**
 * The league championship (#863): what settlement writes for a contest going final, and how a
 * year and the list of years read back from what was written.
 */
import {
  ChampionshipTile,
  CupPointsScale,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type Squad,
} from '@poolmaster/shared/domain';
import { ChampionshipService } from '../../../packages/core-api/src/modules/championship/service';
import { InMemoryChampionship } from '../../support/in-memory-championship';
import { InMemoryCups } from '../../support/in-memory-cups';
import { fakeSquadRepo } from '../../support/repo-fakes';

const LEAGUE = 'league-1';
const MASTERS_SERIES = 'series-masters';
const NOW = new Date('2026-08-01T12:00:00.000Z');

function squad(id: string, name: string, overrides: Partial<Squad> = {}): Squad {
  return {
    id,
    leagueId: LEAGUE,
    createdBy: 'user-1',
    name,
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

const EAGLES = squad('eagles', 'Eagles');
const BIRDIES = squad('birdies', 'Birdies');
const BOGEYS = squad('bogeys', 'Bogeys');

function build(squads: Squad[] = [EAGLES, BIRDIES, BOGEYS]) {
  const cups = new InMemoryCups();
  cups.addLeague(LEAGUE);
  const finishes = new InMemoryChampionship();
  finishes.cupNames.set(LEAGUE, 'Derek\'s Pool Cup');
  const service = new ChampionshipService({
    finishes,
    cups,
    squads: fakeSquadRepo({ findByLeague: jest.fn().mockResolvedValue(squads) }),
    now: () => NOW,
  });
  /** Settles a contest with its ranked entries, as settlement hands it over. */
  const settle = async (
    id: string,
    places: Array<[squadId: string, position: number]>,
    settledAt: Date,
    overrides: { cupWeight?: CupWeight; selectionType?: SelectionType } = {},
  ) => {
    cups.rankedEntries.push(...places.map(([squadId, position]) => ({ contestId: id, squadId, position })));
    return service.recordContest({
      id,
      leagueId: LEAGUE,
      selectionType: overrides.selectionType ?? SelectionType.TIERED,
      cupWeight: overrides.cupWeight ?? CupWeight.NORMAL,
    }, settledAt);
  };
  return { cups, finishes, service, settle };
}

describe('ChampionshipService (#863)', () => {
  it('writes each squad once from its best entry, with its place, the tie, the field, the single event\'s series and its points at settlement', async () => {
    const { finishes, settle } = build();
    finishes.singleEventSeries.set('masters', MASTERS_SERIES);

    const written = await settle('masters', [['eagles', 1], ['birdies', 2], ['bogeys', 2], ['eagles', 4]], new Date('2026-04-13T22:00:00.000Z'), { cupWeight: CupWeight.BONUS });

    expect(written).toBe(3);
    expect(finishes.finishes.map((row) => [row.squadId, row.year, row.place, row.tiedCount, row.rankedEntryCount, row.eventSeriesId, row.weight, row.points])).toEqual([
      ['eagles', 2026, 1, 1, 4, MASTERS_SERIES, CupWeight.BONUS, 1500],
      ['birdies', 2026, 2, 2, 4, MASTERS_SERIES, CupWeight.BONUS, 1088],
      ['bogeys', 2026, 2, 2, 4, MASTERS_SERIES, CupWeight.BONUS, 1088],
    ]);
  });

  it('counts a contest final late on 31 December in New York in that year, and keeps the first write when settlement runs twice', async () => {
    const { finishes, settle } = build();

    await settle('bowl', [['eagles', 1]], new Date('2027-01-01T04:30:00.000Z'));
    const again = await settle('bowl', [], new Date('2027-01-01T04:30:00.000Z'));

    expect(again).toBe(0);
    expect(finishes.finishes.map((row) => [row.contestId, row.year])).toEqual([['bowl', 2026]]);
  });

  it('writes nothing for a contest nobody placed in', async () => {
    const { finishes, settle } = build();

    expect(await settle('washout', [], NOW)).toBe(0);
    expect(finishes.finishes).toEqual([]);
  });

  it('keeps the points earned at settlement when the league\'s points table changes afterwards', async () => {
    const { cups, service, settle } = build();
    await settle('masters', [['eagles', 1]], new Date('2026-04-13T22:00:00.000Z'));
    cups.addLeague(LEAGUE, { scale: CupPointsScale.TOP_TEN, customPoints: [] });

    const year = await service.getYear(LEAGUE, 2026);

    expect(year.standings[0]).toMatchObject({ squad: EAGLES, points: 1000 });
  });

  it('ranks a year on points, then 1sts, then 2nds, with the finish matrix and medal tiles, leaving out a NOT_COUNTED contest', async () => {
    const { finishes, service, settle } = build();
    finishes.unfinishedContests = 3;
    await settle('masters', [['eagles', 1], ['birdies', 2], ['bogeys', 3]], new Date('2026-04-13T22:00:00.000Z'));
    await settle('pga', [['birdies', 1], ['eagles', 2], ['bogeys', 3]], new Date('2026-05-17T22:00:00.000Z'));
    await settle('fun', [['bogeys', 1]], new Date('2026-06-01T22:00:00.000Z'), { cupWeight: CupWeight.NOT_COUNTED });

    const year = await service.getYear(LEAGUE, 2026);

    expect(year).toMatchObject({ year: 2026, cupName: 'Derek\'s Pool Cup', isOver: false, contestsCounted: 2, contestsToGo: 3 });
    expect(year.standings.map((row) => [row.squad.name, row.displayPosition, row.points, row.finishes.slice(0, 3), row.played])).toEqual([
      ['Birdies', 'T1', 1800, [1, 1, 0], 2],
      ['Eagles', 'T1', 1800, [1, 1, 0], 2],
      ['Bogeys', '3', 1300, [0, 0, 2], 2],
    ]);
    expect(year.tiles.find((tile) => tile.tile === ChampionshipTile.MOST_THIRDS)).toMatchObject({ count: 2, squads: [BOGEYS] });
  });

  it('gives each squad its movement since before the latest counted contest, a NOT_COUNTED one later changing nothing, and none until two have counted', async () => {
    const { service, settle } = build();
    await settle('masters', [['eagles', 1], ['birdies', 2], ['bogeys', 3]], new Date('2026-04-13T22:00:00.000Z'));
    const afterOne = await service.getYear(LEAGUE, 2026);
    await settle('pga', [['bogeys', 1], ['birdies', 2], ['eagles', 3]], new Date('2026-05-17T22:00:00.000Z'));
    await settle('fun', [['eagles', 1]], new Date('2026-06-01T22:00:00.000Z'), { cupWeight: CupWeight.NOT_COUNTED });

    const year = await service.getYear(LEAGUE, 2026);

    expect(afterOne.standings.map((row) => row.movement)).toEqual([null, null, null]);
    expect(year.standings.map((row) => [row.squad.name, row.displayPosition, row.movement])).toEqual([
      ['Bogeys', 'T1', 2],
      ['Eagles', 'T1', 0],
      ['Birdies', '3', -1],
    ]);
  });

  it('gives no movement in a year that is over, its standings final as a crowned cup\'s are', async () => {
    const { service, settle } = build();
    await settle('masters', [['eagles', 1], ['birdies', 2]], new Date('2025-04-13T22:00:00.000Z'));
    await settle('pga', [['birdies', 1], ['eagles', 3]], new Date('2025-05-17T22:00:00.000Z'));

    const past = await service.getYear(LEAGUE, 2025);

    expect(past.isOver).toBe(true);
    expect(past.standings.map((row) => row.movement)).toEqual([null, null, null]);
  });

  it('shows every active squad at 0 in a year with nothing counted, an inactive squad only once it placed, and nothing to go in a past year', async () => {
    const retired = squad('retired', 'Albatross', { isActive: false });
    const { finishes, service, settle } = build([EAGLES, retired]);
    finishes.unfinishedContests = 3;
    await settle('masters', [['retired', 1]], new Date('2025-04-13T22:00:00.000Z'));

    const past = await service.getYear(LEAGUE, 2025);
    const empty = await service.getYear(LEAGUE, 2026);

    expect(past).toMatchObject({ isOver: true, contestsToGo: 0 });
    expect(past.standings.map((row) => row.squad.name)).toEqual(['Albatross', 'Eagles']);
    expect(empty.standings.map((row) => [row.squad.name, row.points])).toEqual([['Eagles', 0]]);
  });

  it('lists the years with a counted contest newest first, with their champions or leaders, ties naming each, and skips a year of only NOT_COUNTED contests', async () => {
    const { service, settle } = build();
    await settle('2024-open', [['bogeys', 1]], new Date('2024-06-01T22:00:00.000Z'), { cupWeight: CupWeight.NOT_COUNTED });
    await settle('2025-masters', [['eagles', 1], ['birdies', 1]], new Date('2025-04-13T22:00:00.000Z'));
    await settle('2026-masters', [['bogeys', 1]], new Date('2026-04-13T22:00:00.000Z'));

    const years = await service.listYears(LEAGUE);

    expect(years.map((row) => [row.year, row.isOver, row.leaders.map((leader) => leader.name)])).toEqual([
      [2026, false, ['Bogeys']],
      [2025, true, ['Birdies', 'Eagles']],
    ]);
  });

  it('refuses a league that does not exist with LEAGUE_NOT_FOUND', async () => {
    const { service } = build();

    await expect(service.getYear('league-2', 2026)).rejects.toMatchObject({ code: 'LEAGUE_NOT_FOUND' });
  });
});
