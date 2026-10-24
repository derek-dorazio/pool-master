/**
 * League history (#837): a championship year's final contests, and the squad and matrix-cell
 * filters that must list exactly what the finish matrix counts; the All years summary; and one
 * squad's year (#872).
 */
import type { FinalContest } from '@poolmaster/shared/db';
import {
  ContestResultCount,
  RecordType,
  CupContestCount,
  CupStatus,
  CupTrophy,
  CupWeight,
  SummaryTile,
  SelectionType,
  TeamIconKey,
  TrophyKind,
  type LeagueYearFinish,
  type Squad,
} from '@poolmaster/shared/domain';
import type { ChampionshipStandingView, ChampionshipYearSummaryView, ChampionshipYearView } from '../../../packages/core-api/src/modules/championship/service';
import type { CupStandingView, CupView } from '../../../packages/core-api/src/modules/cups/service';
import {
  HistoryService,
  HistorySquadNotFoundError,
  HistorySquadRequiredError,
} from '../../../packages/core-api/src/modules/history/service';
import { InMemoryChampionship } from '../../support/in-memory-championship';
import { fakeLeagueRepo, fakeSquadRepo } from '../../support/repo-fakes';
import { buildLeague } from '../../factories';

const LEAGUE = 'league-1';

function squad(id: string, name: string, leagueId = LEAGUE): Squad {
  return {
    id,
    leagueId,
    createdBy: 'user-1',
    name,
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const EAGLES = squad('eagles', 'Eagles');
const BIRDIES = squad('birdies', 'Birdies');
const BOGEYS = squad('bogeys', 'Bogeys');
const SQUADS = [EAGLES, BIRDIES, BOGEYS];

function build({ hallOfLameVisible = true }: { hallOfLameVisible?: boolean } = {}) {
  const finishes = new InMemoryChampionship();
  const service = new HistoryService({
    finishes,
    leagues: fakeLeagueRepo({ findById: jest.fn().mockResolvedValue(buildLeague({ id: LEAGUE, hallOfLameVisible })) }),
    squads: fakeSquadRepo({
      findById: jest.fn((id: string) => Promise.resolve([...SQUADS, squad('elsewhere', 'Elsewhere', 'league-2')].find((row) => row.id === id) ?? null)),
      findByLeague: jest.fn().mockResolvedValue(SQUADS),
    }),
    championship: { getYear: jest.fn(), listYears: jest.fn().mockResolvedValue([]) },
    cups: { listSeasonYears: jest.fn().mockResolvedValue([]), listSeasonCups: jest.fn().mockResolvedValue([]) },
  });
  const contest = (id: string, completedAt: string | null, overrides: Partial<FinalContest> = {}) => {
    finishes.finalContests.push({
      leagueId: LEAGUE,
      contest: {
        id,
        name: id,
        selectionType: SelectionType.TIERED,
        sportLeagueName: 'PGA Tour',
        completedAt: completedAt === null ? null : new Date(completedAt),
        ...overrides,
      },
    });
  };
  /** One squad's stored finish: [squadId, place, tiedCount]. */
  const finish = (contestId: string, year: number, rows: Array<[string, number, number]>, weight: CupWeight = CupWeight.NORMAL, settledAt = new Date(`${year}-06-01T00:00:00.000Z`)) => {
    finishes.finishes.push(...rows.map(([squadId, place, tiedCount]): LeagueYearFinish => ({
      leagueId: LEAGUE,
      year,
      squadId,
      contestId,
      place,
      tiedCount,
      rankedEntryCount: 6,
      weight,
      points: weight === CupWeight.NOT_COUNTED ? 0 : 1000 - place * 100,
      settledAt,
    })));
  };
  return { contest, finish, finishes, service };
}

describe('HistoryService (#837)', () => {
  it('ranks the record book with each holder\'s squad, the year and the contest won, holders in name order', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2025-04-13T22:00:00.000Z');
    finish('masters', 2025, [['eagles', 1, 2], ['bogeys', 1, 2], ['birdies', 3, 1]]);

    const records = await service.getRecords(LEAGUE);

    const biggest = records.find((row) => row.type === RecordType.BIGGEST_FIELD_WON);
    expect(biggest?.best.holders.map((holder) => [holder.squad.name, holder.year, holder.contest?.name])).toEqual([
      ['Bogeys', 2025, 'masters'],
      ['Eagles', 2025, 'masters'],
    ]);
    expect(records.map((row) => row.type)).toEqual([
      RecordType.MOST_WINS_IN_A_YEAR,
      RecordType.MOST_WINS_ALL_TIME,
      RecordType.LONGEST_PODIUM_RUN,
      RecordType.BIGGEST_FIELD_WON,
      RecordType.MOST_LAST_PLACES,
      RecordType.LONGEST_DROUGHT,
    ]);
  });

  it('names each perpetual trophy plate\'s winners as squads, in name order', async () => {
    const { finish, finishes, service } = build();
    for (const year of [2024, 2025]) {
      finishes.seriesContests.push({ leagueId: LEAGUE, contest: {
        id: `masters-${year}`,
        selectionType: SelectionType.TIERED,
        cupWeight: CupWeight.NORMAL,
        eventSeriesId: 'masters',
        seriesName: 'Masters Tournament',
        sportLeagueName: 'PGA Tour',
        eventYear: year,
        completedAt: new Date(`${year}-04-14T00:00:00.000Z`),
        games: [],
      } });
    }
    finish('masters-2024', 2024, [['eagles', 1, 2], ['bogeys', 1, 2]]);
    finish('masters-2025', 2025, [['birdies', 1, 1], ['eagles', 2, 1]]);

    const trophies = await service.getPerpetualTrophies(LEAGUE);

    expect(trophies.map((trophy) => [trophy.seriesName, trophy.plates.map((plate) => [plate.year, plate.contestId, plate.winners.map((squad) => squad.name)])])).toEqual([
      ['Masters Tournament', [[2025, 'masters-2025', ['Birdies']], [2024, 'masters-2024', ['Bogeys', 'Eagles']]]],
    ]);
  });

  it('leaves the Hall of Lame out of the record book of a league that hides it', async () => {
    const { contest, finish, service } = build({ hallOfLameVisible: false });
    contest('masters', '2025-04-13T22:00:00.000Z');
    finish('masters', 2025, [['eagles', 1, 1], ['birdies', 2, 1], ['bogeys', 4, 1]]);

    const records = await service.getRecords(LEAGUE);

    expect(records.map((row) => row.type)).toEqual([
      RecordType.MOST_WINS_IN_A_YEAR,
      RecordType.MOST_WINS_ALL_TIME,
      RecordType.LONGEST_PODIUM_RUN,
      RecordType.BIGGEST_FIELD_WON,
    ]);
  });

  it('lists every contest that went final in the year newest first, counted, not counted or without a result, with co-winners in name order and the entries ranked', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 2], ['birdies', 1, 2], ['bogeys', 3, 1]]);
    contest('open', '2026-07-20T22:00:00.000Z');
    finish('open', 2026, [['bogeys', 1, 1]], CupWeight.NOT_COUNTED);
    contest('rained-out', '2026-08-02T22:00:00.000Z');
    contest('last-year', '2025-11-01T22:00:00.000Z');

    const contests = await service.listYearContests(LEAGUE, 2026);

    expect(contests.map((row) => [row.contestId, row.count, row.winners.map((winner) => winner.name), row.rankedEntryCount, row.squadFinish])).toEqual([
      ['rained-out', ContestResultCount.NO_RESULT, [], 0, null],
      ['open', ContestResultCount.NOT_COUNTED, ['Bogeys'], 6, null],
      ['masters', ContestResultCount.COUNTED, ['Birdies', 'Eagles'], 6, null],
    ]);
  });

  it('keeps a contest in the year its finishes were written for when its end time was never kept, dated by its settlement', async () => {
    const { contest, finish, service } = build();
    contest('old-pool', null);
    finish('old-pool', 2026, [['eagles', 1, 1]], CupWeight.NORMAL, new Date('2026-03-01T00:00:00.000Z'));

    const contests = await service.listYearContests(LEAGUE, 2026);

    expect(contests.map((row) => [row.contestId, row.completedAt.toISOString()])).toEqual([['old-pool', '2026-03-01T00:00:00.000Z']]);
  });

  it('narrows to a squad\'s counted contests, its Played count, leaving out a not-counted contest it placed in and one it missed, with its own finish on each', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 1], ['bogeys', 2, 2], ['birdies', 2, 2]]);
    contest('open', '2026-07-20T22:00:00.000Z');
    finish('open', 2026, [['bogeys', 1, 1]], CupWeight.NOT_COUNTED);
    contest('pga', '2026-05-20T22:00:00.000Z');
    finish('pga', 2026, [['eagles', 1, 1]]);

    const contests = await service.listYearContests(LEAGUE, 2026, { squadId: 'bogeys' });

    expect(contests.map((row) => [row.contestId, row.squadFinish])).toEqual([
      ['masters', { place: 2, tiedCount: 2, points: 800 }],
    ]);
  });

  it('narrows to one cell of a squad\'s matrix row: only the counted contests it finished in that place', async () => {
    const { contest, finish, service } = build();
    contest('masters', '2026-04-13T22:00:00.000Z');
    finish('masters', 2026, [['eagles', 1, 1]]);
    contest('pga', '2026-05-20T22:00:00.000Z');
    finish('pga', 2026, [['eagles', 2, 1]]);
    contest('us-open', '2026-06-20T22:00:00.000Z');
    finish('us-open', 2026, [['eagles', 1, 1]]);

    const contests = await service.listYearContests(LEAGUE, 2026, { squadId: 'eagles', place: 1 });

    expect(contests.map((row) => row.contestId)).toEqual(['us-open', 'masters']);
  });

  it('refuses a place without a squad, since a cell belongs to one squad\'s row', async () => {
    const { service } = build();

    await expect(service.listYearContests(LEAGUE, 2026, { place: 1 })).rejects.toBeInstanceOf(HistorySquadRequiredError);
  });

  it('refuses a squad of another league as not found, so a league never lists another\'s squad', async () => {
    const { service } = build();

    await expect(service.listYearContests(LEAGUE, 2026, { squadId: 'elsewhere' })).rejects.toBeInstanceOf(HistorySquadNotFoundError);
  });
});

/** A cup of `seasonYear`: its standings as [squad, position, points, trophy] and how many contests counted. */
function cupView(
  sportLeagueName: string,
  seasonYear: number,
  status: CupStatus,
  rows: Array<[Squad, number, number, CupTrophy | null]>,
  counted = 2,
): CupView {
  return {
    cup: {
      id: `cup-${sportLeagueName}-${seasonYear}`,
      leagueId: LEAGUE,
      seasonYear,
      sportLeagueId: `sl-${sportLeagueName}`,
      status,
      crownedAt: status === CupStatus.CROWNED ? new Date(`${seasonYear}-12-01T00:00:00.000Z`) : null,
      crownedPointsTable: null,
      createdAt: new Date(`${seasonYear}-01-01T00:00:00.000Z`),
    },
    sportLeagueName,
    standings: rows.map(([standingSquad, position, points, trophy]): CupStandingView => ({
      squad: standingSquad,
      position,
      displayPosition: String(position),
      points,
      wins: 0,
      podiums: 0,
      contestsCounted: counted,
      movement: null,
      pointsAfter: [],
      trophy,
    })),
    contests: Array.from({ length: counted }, () => ({
      contest: {} as CupView['contests'][number]['contest'],
      weight: CupWeight.NORMAL,
      count: CupContestCount.COUNTED,
      winners: [],
    })),
  };
}

describe('HistoryService summary (#837)', () => {
  const NOW = new Date('2026-08-01T12:00:00.000Z');

  function buildSummary(years: ChampionshipYearSummaryView[], cupsBySeason: Record<number, CupView[]>) {
    return new HistoryService({
      finishes: new InMemoryChampionship(),
      leagues: fakeLeagueRepo(),
      squads: fakeSquadRepo(),
      championship: { getYear: jest.fn(), listYears: jest.fn().mockResolvedValue(years) },
      cups: {
        listSeasonYears: jest.fn().mockResolvedValue(Object.keys(cupsBySeason).map(Number).sort((left, right) => right - left)),
        listSeasonCups: jest.fn((_leagueId: string, seasonYear: number) => Promise.resolve(cupsBySeason[seasonYear] ?? [])),
      },
      now: () => NOW,
    });
  }

  it('lists every year with a championship or a cup newest first, the current one so far, with champions and each cup\'s champions or leaders by sports league', async () => {
    const service = buildSummary(
      [{ year: 2026, isOver: false, leaders: [EAGLES] }, { year: 2025, isOver: true, leaders: [EAGLES, BIRDIES] }],
      {
        2026: [cupView('PGA Tour', 2026, CupStatus.OPEN, [[BOGEYS, 1, 900, null], [EAGLES, 2, 800, null]])],
        2025: [
          cupView('NFL', 2025, CupStatus.CROWNED, [[BIRDIES, 1, 1500, CupTrophy.CHAMPION], [EAGLES, 2, 1200, CupTrophy.RUNNER_UP]]),
          cupView('LPGA Tour', 2025, CupStatus.OPEN, [[EAGLES, 1, 0, null], [BIRDIES, 1, 0, null]], 0),
        ],
        2024: [cupView('NFL', 2024, CupStatus.CROWNED, [[BIRDIES, 1, 1500, CupTrophy.CHAMPION]])],
      },
    );

    const summary = await service.getSummary(LEAGUE);

    expect(summary.years.map((row) => [
      row.year,
      row.isOver,
      row.champions.map((champion) => champion.name),
      row.cups.map((cup) => [cup.view.sportLeagueName, cup.contestsCounted, cup.winners.map((winner) => winner.name)]),
    ])).toEqual([
      [2026, false, ['Eagles'], [['PGA Tour', 2, ['Bogeys']]]],
      [2025, true, ['Birdies', 'Eagles'], [['LPGA Tour', 0, []], ['NFL', 2, ['Birdies']]]],
      [2024, true, [], [['NFL', 2, ['Birdies']]]],
    ]);
  });

  it('counts championships from years over only and cups from crowned ones only, naming every squad tied on the most', async () => {
    const service = buildSummary(
      [
        { year: 2026, isOver: false, leaders: [BOGEYS] },
        { year: 2025, isOver: true, leaders: [EAGLES, BIRDIES] },
        { year: 2024, isOver: true, leaders: [EAGLES] },
      ],
      {
        2026: [cupView('PGA Tour', 2026, CupStatus.OPEN, [[BOGEYS, 1, 900, null]])],
        2025: [
          cupView('NFL', 2025, CupStatus.CROWNED, [[BIRDIES, 1, 1500, CupTrophy.CHAMPION], [BOGEYS, 1, 1500, CupTrophy.CHAMPION]]),
          cupView('PGA Tour', 2025, CupStatus.CROWNED, [[BIRDIES, 1, 1500, CupTrophy.CHAMPION]]),
        ],
      },
    );

    const { tiles } = await service.getSummary(LEAGUE);

    expect(tiles.map((tile) => [tile.tile, tile.count, tile.squads.map((tied) => tied.name)])).toEqual([
      [SummaryTile.MOST_CHAMPIONSHIPS, 2, ['Eagles']],
      [SummaryTile.MOST_CUPS, 2, ['Birdies']],
    ]);
  });

  it('gives a league with no history no years and tiles at 0 naming nobody', async () => {
    const summary = await buildSummary([], {}).getSummary(LEAGUE);

    expect(summary.years).toEqual([]);
    expect(summary.tiles.map((tile) => [tile.tile, tile.count, tile.squads])).toEqual([
      [SummaryTile.MOST_CHAMPIONSHIPS, 0, []],
      [SummaryTile.MOST_CUPS, 0, []],
    ]);
  });
});

describe('HistoryService squad year (#872)', () => {
  function standing(rowSquad: Squad, position: number, points: number, movement: number | null): ChampionshipStandingView {
    return {
      squad: rowSquad,
      position,
      displayPosition: String(position),
      points,
      finishes: [1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      podiums: 1,
      topTens: 1,
      played: 1,
      movement,
    };
  }

  function buildSquadYear(standings: ChampionshipStandingView[], cups: CupView[]) {
    const year: ChampionshipYearView = {
      leagueId: LEAGUE,
      year: 2026,
      cupName: 'Derek\'s Pool Cup',
      isOver: false,
      contestsCounted: 4,
      contestsToGo: 2,
      standings,
      tiles: [],
    };
    const getYear = jest.fn().mockResolvedValue(year);
    const listSeasonCups = jest.fn().mockResolvedValue(cups);
    const service = new HistoryService({
      finishes: new InMemoryChampionship(),
      leagues: fakeLeagueRepo(),
      squads: fakeSquadRepo({
        findById: jest.fn((id: string) => Promise.resolve([...SQUADS, squad('elsewhere', 'Elsewhere', 'league-2')].find((row) => row.id === id) ?? null)),
      }),
      championship: { getYear, listYears: jest.fn() },
      cups: { listSeasonYears: jest.fn(), listSeasonCups },
    });
    return { service, getYear, listSeasonCups };
  }

  it('keeps the squad\'s own championship row with its place of N and points behind 1st, read from the same year the Championship tab reads', async () => {
    const { service, getYear } = buildSquadYear(
      [standing(EAGLES, 1, 2400, 1), standing(BIRDIES, 2, 1800, -1), standing(BOGEYS, 3, 900, 0)],
      [],
    );

    const view = await service.getSquadYear(LEAGUE, 'birdies', 2026);

    expect(getYear).toHaveBeenCalledWith(LEAGUE, 2026);
    expect(view.championship).toMatchObject({
      cupName: 'Derek\'s Pool Cup',
      isOver: false,
      squadCount: 3,
      pointsBehindLeader: 600,
      contestsCounted: 4,
      contestsToGo: 2,
      standing: { position: 2, points: 1800, movement: -1 },
    });
  });

  it('lists only the cups of the season the squad has a row in, by sports league name, each with its counted contests', async () => {
    const { service, listSeasonCups } = buildSquadYear(
      [standing(EAGLES, 1, 2400, null), standing(BIRDIES, 2, 1800, null)],
      [
        cupView('PGA Tour', 2026, CupStatus.OPEN, [[EAGLES, 1, 900, null], [BIRDIES, 2, 800, null]], 3),
        cupView('NFL', 2026, CupStatus.CROWNED, [[BIRDIES, 1, 1500, CupTrophy.CHAMPION]], 1),
        cupView('NBA', 2026, CupStatus.OPEN, [[EAGLES, 1, 400, null]]),
      ],
    );

    const view = await service.getSquadYear(LEAGUE, 'birdies', 2026);

    expect(listSeasonCups).toHaveBeenCalledWith(LEAGUE, 2026);
    expect(view.cups.map((cup) => [cup.view.sportLeagueName, cup.contestsCounted, cup.standing.position, cup.standing.trophy])).toEqual([
      ['NFL', 1, 1, CupTrophy.CHAMPION],
      ['PGA Tour', 3, 2, null],
    ]);
  });

  it('has no championship row for a squad missing from the standings, such as an inactive one that placed in nothing', async () => {
    const { service } = buildSquadYear([standing(EAGLES, 1, 2400, null)], []);

    const view = await service.getSquadYear(LEAGUE, 'bogeys', 2026);

    expect(view.championship).toBeNull();
    expect(view.cups).toEqual([]);
  });

  it('refuses a squad of another league with SQUAD_NOT_FOUND', async () => {
    const { service } = buildSquadYear([], []);

    await expect(service.getSquadYear(LEAGUE, 'elsewhere', 2026)).rejects.toBeInstanceOf(HistorySquadNotFoundError);
  });
});

describe('HistoryService squad history (#872)', () => {
  const NOW = new Date('2026-08-01T12:00:00.000Z');

  function standingRow(rowSquad: Squad, position: number, points: number, finishes = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]): ChampionshipStandingView {
    return {
      squad: rowSquad,
      position,
      displayPosition: String(position),
      points,
      finishes,
      podiums: 0,
      topTens: 0,
      played: 1,
      movement: null,
    };
  }

  function buildHistory(years: Record<number, { isOver: boolean; standings: ChampionshipStandingView[]; cups: CupView[] }>) {
    const finishes = new InMemoryChampionship();
    const byYear = new Map(Object.entries(years).map(([year, row]) => [Number(year), row]));
    const yearNumbers = [...byYear.keys()].sort((left, right) => right - left);
    return new HistoryService({
      finishes,
      leagues: fakeLeagueRepo(),
      squads: fakeSquadRepo({
        findById: jest.fn((id: string) => Promise.resolve([...SQUADS, squad('elsewhere', 'Elsewhere', 'league-2')].find((row) => row.id === id) ?? null)),
      }),
      championship: {
        listYears: jest.fn().mockResolvedValue(yearNumbers
          .filter((year) => (byYear.get(year)?.standings.length ?? 0) > 0)
          .map((year) => ({ year, isOver: byYear.get(year)?.isOver ?? false, leaders: [] }))),
        getYear: jest.fn((_leagueId: string, year: number): Promise<ChampionshipYearView> => Promise.resolve({
          leagueId: LEAGUE,
          year,
          cupName: 'Derek\'s Pool Cup',
          isOver: byYear.get(year)?.isOver ?? false,
          contestsCounted: 2,
          contestsToGo: 0,
          standings: byYear.get(year)?.standings ?? [],
          tiles: [],
        })),
      },
      cups: {
        listSeasonYears: jest.fn().mockResolvedValue(yearNumbers.filter((year) => (byYear.get(year)?.cups.length ?? 0) > 0)),
        listSeasonCups: jest.fn((_leagueId: string, year: number) => Promise.resolve(byYear.get(year)?.cups ?? [])),
      },
      now: () => NOW,
    });
  }

  it('reads the squad\'s year for every league year newest first, and shelves its championship podiums of years over and its crowned cups\' trophies', async () => {
    const service = buildHistory({
      2026: { isOver: false, standings: [standingRow(EAGLES, 1, 900)], cups: [] },
      2025: {
        isOver: true,
        standings: [standingRow(BIRDIES, 1, 2000), standingRow(EAGLES, 2, 1500)],
        cups: [
          cupView('PGA Tour', 2025, CupStatus.CROWNED, [[EAGLES, 1, 1200, CupTrophy.CHAMPION]]),
          cupView('NFL', 2025, CupStatus.CROWNED, [[EAGLES, 3, 400, CupTrophy.THIRD]]),
          cupView('NBA', 2025, CupStatus.OPEN, [[EAGLES, 1, 800, null]]),
        ],
      },
      2024: { isOver: true, standings: [standingRow(EAGLES, 4, 300)], cups: [] },
    });

    const history = await service.getSquadHistory(LEAGUE, 'eagles');

    expect(history.years.map((year) => [year.year, year.championship?.standing.position])).toEqual([[2026, 1], [2025, 2], [2024, 4]]);
    // The running year's lead is no trophy; 4th is off the podium; an open cup's lead is none either.
    expect(history.trophies.map((row) => [row.kind, row.year, row.trophy, row.kind === TrophyKind.CUP ? row.cup.sportLeagueName : row.cupName])).toEqual([
      [TrophyKind.CHAMPIONSHIP, 2025, CupTrophy.RUNNER_UP, 'Derek\'s Pool Cup'],
      [TrophyKind.CUP, 2025, CupTrophy.THIRD, 'NFL'],
      [TrophyKind.CUP, 2025, CupTrophy.CHAMPION, 'PGA Tour'],
    ]);
  });

  it('gives no championship trophy for a podium place at 0 points', async () => {
    const service = buildHistory({ 2025: { isOver: true, standings: [standingRow(EAGLES, 1, 0)], cups: [] } });

    const history = await service.getSquadHistory(LEAGUE, 'eagles');

    expect(history.trophies).toEqual([]);
  });

  it('sums the squad\'s contest 1sts, 2nds and 3rds over its championship rows of every year, leaving out other squads', async () => {
    const service = buildHistory({
      2026: { isOver: false, standings: [standingRow(BIRDIES, 1, 900, [5, 5, 5, 0, 0, 0, 0, 0, 0, 0]), standingRow(EAGLES, 2, 600, [1, 0, 1, 1, 0, 0, 0, 0, 0, 0])], cups: [] },
      2025: { isOver: true, standings: [standingRow(EAGLES, 1, 2000, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0])], cups: [] },
    });

    const history = await service.getSquadHistory(LEAGUE, 'eagles');

    expect(history.medals).toEqual({ firsts: 2, seconds: 1, thirds: 1 });
  });

  it('refuses a squad of another league with SQUAD_NOT_FOUND', async () => {
    await expect(buildHistory({}).getSquadHistory(LEAGUE, 'elsewhere')).rejects.toBeInstanceOf(HistorySquadNotFoundError);
  });
});
