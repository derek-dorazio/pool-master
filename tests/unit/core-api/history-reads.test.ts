/**
 * History and the trophy room read a league's past in a fixed number of reads (#1166): the All
 * years summary and a squad's whole history read every cup, contest and finish of the league
 * once, not once per year and per cup, and still show each year exactly as the year's own
 * Championship and Cups pages do.
 */
import {
  ContestStatus,
  CupContestCount,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type Squad,
} from '@poolmaster/shared/domain';
import { ChampionshipService } from '../../../packages/core-api/src/modules/championship/service';
import { CupService } from '../../../packages/core-api/src/modules/cups/service';
import { HistoryService } from '../../../packages/core-api/src/modules/history/service';
import { InMemoryChampionship } from '../../support/in-memory-championship';
import { InMemoryCups } from '../../support/in-memory-cups';
import { fakeLeagueRepo, fakeSportLeagueRepo, fakeSquadRepo } from '../../support/repo-fakes';

const LEAGUE = 'league-1';
const NOW = new Date('2026-08-01T12:00:00.000Z');
const SPORT_LEAGUES = new Map([['pga', 'PGA Tour'], ['nfl', 'NFL'], ['nba', 'NBA']]);

function squad(id: string, name: string, isActive = true): Squad {
  return {
    id,
    leagueId: LEAGUE,
    createdBy: 'user-1',
    name,
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    updatedAt: new Date('2020-01-01T00:00:00.000Z'),
  };
}

/** The Albatross placed in the oldest season and has since left the league. */
const SQUADS = [squad('eagles', 'Eagles'), squad('birdies', 'Birdies'), squad('bogeys', 'Bogeys'), squad('albatross', 'Albatross', false)];

/** Wraps a repository so every call to it is one read counted, as each is one query against Postgres. */
function counted<T extends object>(repository: T, reads: { count: number }): T {
  return new Proxy(repository, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => {
        reads.count += 1;
        return (value as (...params: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}

/**
 * A league with a season per year from 2026 back: a cup per sports league each season with two
 * contests settled in it, both won by the Eagles and Birdies tied, the PGA Tour cup crowned
 * in every year that is over. The Albatross, since inactive, placed only in the oldest of those
 * seasons, and the season before it has a single PGA Tour contest that is NOT_COUNTED.
 */
async function leagueWithSeasons(seasonCount: number) {
  const cups = new InMemoryCups();
  cups.addLeague(LEAGUE, undefined, 'Pool Cup');
  const finishes = new InMemoryChampionship();
  const squads = fakeSquadRepo({
    findByLeague: jest.fn().mockResolvedValue(SQUADS),
    findById: jest.fn((id: string) => Promise.resolve(SQUADS.find((row) => row.id === id) ?? null)),
  });
  const sportLeagues = fakeSportLeagueRepo({
    findById: jest.fn((id: string) => Promise.resolve({ id, name: SPORT_LEAGUES.get(id) ?? id } as never)),
    findByIds: jest.fn((ids: readonly string[]) => Promise.resolve(ids.map((id) => ({ id, name: SPORT_LEAGUES.get(id) ?? id })) as never)),
  });
  const reads = { count: 0 };
  const cupService = new CupService({
    cups: counted(cups, reads),
    leagues: counted(cups.leagues, reads),
    liveContests: { livePositionsOf: () => Promise.resolve([]) },
    squads: counted(squads, reads),
    sportLeagues: counted(sportLeagues, reads),
    now: () => NOW,
  });
  const championship = new ChampionshipService({ finishes: counted(finishes, reads), cups: counted(cups, reads), leagues: counted(cups.leagues, reads), squads: counted(squads, reads), now: () => NOW });
  const history = new HistoryService({
    finishes: counted(finishes, reads),
    squads: counted(squads, reads),
    leagues: counted(fakeLeagueRepo(), reads),
    championship,
    cups: cupService,
    now: () => NOW,
  });

  for (let index = 0; index < seasonCount; index += 1) {
    const seasonYear = 2026 - index;
    for (const sportLeagueId of SPORT_LEAGUES.keys()) {
      await cupService.ensureCup({ leagueId: LEAGUE, seasonYear, sportLeagueId });
      const oldest = index === seasonCount - 1;
      const contests: Array<[day: number, places: Array<[squadId: string, position: number]>]> = [
        [1, [['eagles', 1], ['birdies', 1], ['bogeys', 3], ...(oldest ? [['albatross', 4] as [string, number]] : [])]],
        [2, [['birdies', 1], ['eagles', 1], ...(oldest ? [['albatross', 3] as [string, number]] : []), ['bogeys', 4]]],
      ];
      for (const [day, places] of contests) {
        const id = `${sportLeagueId}-${seasonYear}-${day}`;
        const completedAt = new Date(Date.UTC(seasonYear, 3, day + [...SPORT_LEAGUES.keys()].indexOf(sportLeagueId) * 3, 20));
        cups.contests.push({
          leagueId: LEAGUE,
          seasonYear,
          sportLeagueId,
          id,
          name: `Contest ${id}`,
          status: ContestStatus.COMPLETED,
          selectionType: SelectionType.TIERED,
          cupWeight: CupWeight.NORMAL,
          firstEventStartsAt: new Date(completedAt.getTime() - 86_400_000),
          completedAt,
        });
        cups.rankedEntries.push(...places.map(([squadId, position]) => ({ contestId: id, squadId, position })));
        cups.settle(id, completedAt);
        await championship.recordContest({ id, leagueId: LEAGUE, cupWeight: CupWeight.NORMAL }, completedAt);
      }
    }
    const pgaCup = cups.cups.find((cup) => cup.seasonYear === seasonYear && cup.sportLeagueId === 'pga');
    if (seasonYear < 2026 && pgaCup !== undefined) {
      await cupService.crown(LEAGUE, pgaCup.id);
    }
  }
  const quietYear = 2026 - seasonCount;
  await cupService.ensureCup({ leagueId: LEAGUE, seasonYear: quietYear, sportLeagueId: 'pga' });
  const quietAt = new Date(Date.UTC(quietYear, 5, 1, 20));
  cups.contests.push({
    leagueId: LEAGUE,
    seasonYear: quietYear,
    sportLeagueId: 'pga',
    id: `fun-${String(quietYear)}`,
    name: 'Just for fun',
    status: ContestStatus.COMPLETED,
    selectionType: SelectionType.TIERED,
    cupWeight: CupWeight.NOT_COUNTED,
    firstEventStartsAt: new Date(quietAt.getTime() - 86_400_000),
    completedAt: quietAt,
  });
  cups.rankedEntries.push({ contestId: `fun-${String(quietYear)}`, squadId: 'bogeys', position: 1 });
  cups.settle(`fun-${String(quietYear)}`, quietAt);
  await championship.recordContest({ id: `fun-${String(quietYear)}`, leagueId: LEAGUE, cupWeight: CupWeight.NOT_COUNTED }, quietAt);
  reads.count = 0;
  return { history, championship, cupService, reads };
}

async function readsFor(seasonCount: number, read: (history: HistoryService) => Promise<unknown>): Promise<number> {
  const { history, reads } = await leagueWithSeasons(seasonCount);
  await read(history);
  return reads.count;
}

describe('History reads (#1166)', () => {
  it('reads the All years summary of a ten-season league in no more reads than a two-season one', async () => {
    const summary = (history: HistoryService) => history.getSummary(LEAGUE);

    const [twoSeasons, tenSeasons] = [await readsFor(2, summary), await readsFor(10, summary)];

    expect(tenSeasons).toBe(twoSeasons);
  });

  it('reads a squad\'s whole history of a ten-season league in no more reads than a two-season one', async () => {
    const squadHistory = (history: HistoryService) => history.getSquadHistory(LEAGUE, 'eagles');

    const [twoSeasons, tenSeasons] = [await readsFor(2, squadHistory), await readsFor(10, squadHistory)];

    expect(tenSeasons).toBe(twoSeasons);
  });

  it('reads one season\'s cups in no more reads for three cups than the cup pages need for one', async () => {
    const { cupService, reads } = await leagueWithSeasons(1);
    const cup = (await cupService.listSeasonCups(LEAGUE, 2026)).at(0);
    reads.count = 0;
    await cupService.getCup(LEAGUE, cup?.cup.id ?? '');
    const oneCup = reads.count;
    reads.count = 0;

    const season = await cupService.listSeasonCups(LEAGUE, 2026);

    expect([season.length, reads.count <= oneCup]).toEqual([3, true]);
  });

  it('shows every year of the summary with the same cups, standings and contests as that season\'s Cups page', async () => {
    const { history, cupService } = await leagueWithSeasons(3);

    const summary = await history.getSummary(LEAGUE);

    for (const year of summary.years) {
      const seasonCups = await cupService.listSeasonCups(LEAGUE, year.year);
      expect(year.cups.map((row) => row.view)).toEqual([...seasonCups].sort((left, right) => left.sportLeagueName.localeCompare(right.sportLeagueName)));
    }
    expect(summary.years.map((year) => [year.year, year.cups.length, year.champions.map((squad) => squad.name)])).toEqual([
      [2026, 3, ['Birdies', 'Eagles']],
      [2025, 3, ['Birdies', 'Eagles']],
      [2024, 3, ['Birdies', 'Eagles']],
      [2023, 1, []],
    ]);
    expect(summary.years.at(-1)?.cups[0]?.view.contests.map((row) => row.count)).toEqual([CupContestCount.NOT_COUNTED]);
  });

  it('shows every year of a squad\'s history, tied, active or since gone, with the same championship and cup rows as that year\'s Championship tab and Cups page', async () => {
    const { history, championship, cupService } = await leagueWithSeasons(3);

    for (const squadId of ['eagles', 'albatross']) {
      const squadHistory = await history.getSquadHistory(LEAGUE, squadId);

      for (const year of squadHistory.years) {
        const championshipYear = await championship.getYear(LEAGUE, year.year);
        const seasonCups = await cupService.listSeasonCups(LEAGUE, year.year);
        const standing = championshipYear.standings.find((row) => row.squad.id === squadId);
        expect(year.championship === null ? null : [year.championship.standing, year.championship.isOver, year.championship.contestsCounted])
          .toEqual(standing === undefined ? null : [standing, championshipYear.isOver, championshipYear.contestsCounted]);
        expect(year.cups.map((cup) => cup.standing)).toEqual(seasonCups
          .sort((left, right) => left.sportLeagueName.localeCompare(right.sportLeagueName))
          .flatMap((view) => view.standings.filter((row) => row.squad.id === squadId)));
      }
    }
    const eagles = await history.getSquadHistory(LEAGUE, 'eagles');
    const albatross = await history.getSquadHistory(LEAGUE, 'albatross');
    expect(eagles.years.map((year) => [year.year, year.cups.length, year.championship?.standing.displayPosition])).toEqual([
      [2026, 3, 'T1'], [2025, 3, 'T1'], [2024, 3, 'T1'], [2023, 1, 'T1'],
    ]);
    // Gone since 2024: no row in a year it never placed in, its 2024 rows kept.
    expect(albatross.years.map((year) => [year.year, year.championship?.standing.played ?? null, year.cups.length])).toEqual([
      [2026, null, 0], [2025, null, 0], [2024, 6, 3], [2023, null, 0],
    ]);
  });
});
