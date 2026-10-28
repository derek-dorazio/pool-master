/**
 * History and the trophy room read a league's past in a fixed number of reads (#1166): the All
 * years summary and a squad's whole history read every cup, contest and finish of the league
 * once, not once per year and per cup, and still show each year exactly as the year's own
 * Championship and Cups pages do.
 */
import {
  ContestStatus,
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

function squad(id: string, name: string): Squad {
  return {
    id,
    leagueId: LEAGUE,
    createdBy: 'user-1',
    name,
    iconKey: TeamIconKey.CAPTAIN_SMILE_FIELD,
    isActive: true,
    createdAt: new Date('2020-01-01T00:00:00.000Z'),
    updatedAt: new Date('2020-01-01T00:00:00.000Z'),
  };
}

const SQUADS = [squad('eagles', 'Eagles'), squad('birdies', 'Birdies'), squad('bogeys', 'Bogeys')];

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
 * contests settled in it, the PGA Tour cup crowned in every year that is over.
 */
async function leagueWithSeasons(seasonCount: number) {
  const cups = new InMemoryCups();
  cups.addLeague(LEAGUE);
  const finishes = new InMemoryChampionship();
  finishes.cupNames.set(LEAGUE, 'Pool Cup');
  const squads = fakeSquadRepo({
    findByLeague: jest.fn().mockResolvedValue(SQUADS),
    findById: jest.fn((id: string) => Promise.resolve(SQUADS.find((row) => row.id === id) ?? null)),
  });
  const sportLeagues = fakeSportLeagueRepo({
    findById: jest.fn((id: string) => Promise.resolve({ id, name: SPORT_LEAGUES.get(id) ?? id } as never)),
  });
  const reads = { count: 0 };
  const cupService = new CupService({
    cups: counted(cups, reads),
    liveContests: { livePositionsOf: () => Promise.resolve([]) },
    squads: counted(squads, reads),
    sportLeagues: counted(sportLeagues, reads),
    now: () => NOW,
  });
  const championship = new ChampionshipService({ finishes: counted(finishes, reads), cups: counted(cups, reads), squads: counted(squads, reads), now: () => NOW });
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
      for (const [day, order] of [[1, ['eagles', 'birdies', 'bogeys']], [2, ['bogeys', 'eagles', 'birdies']]] as const) {
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
        cups.rankedEntries.push(...order.map((squadId, position) => ({ contestId: id, squadId, position: position + 1 })));
        cups.settle(id, completedAt);
        await championship.recordContest({ id, leagueId: LEAGUE, cupWeight: CupWeight.NORMAL }, completedAt);
      }
    }
    const pgaCup = cups.cups.find((cup) => cup.seasonYear === seasonYear && cup.sportLeagueId === 'pga');
    if (seasonYear < 2026 && pgaCup !== undefined) {
      await cupService.crown(LEAGUE, pgaCup.id);
    }
  }
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
    expect(summary.years.map((year) => [year.year, year.cups.length])).toEqual([[2026, 3], [2025, 3], [2024, 3]]);
  });

  it('shows every year of a squad\'s history with the same championship row as that year\'s Championship tab', async () => {
    const { history, championship } = await leagueWithSeasons(3);

    const squadHistory = await history.getSquadHistory(LEAGUE, 'eagles');

    for (const year of squadHistory.years) {
      const championshipYear = await championship.getYear(LEAGUE, year.year);
      expect(year.championship?.standing).toEqual(championshipYear.standings.find((row) => row.squad.id === 'eagles'));
      expect([year.championship?.isOver, year.championship?.contestsCounted]).toEqual([championshipYear.isOver, championshipYear.contestsCounted]);
    }
    expect(squadHistory.years.map((year) => [year.year, year.cups.length])).toEqual([[2026, 3], [2025, 3], [2024, 3]]);
  });
});
