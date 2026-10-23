/**
 * Cup standings (#841), worked out on read from the contests' frozen places: which contests
 * count, how a squad scores from its best entry, how ties and movement read, and what a squad's
 * breakdown holds.
 */
import {
  ContestStatus,
  CupContestCount,
  CupPointsScale,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type Squad,
} from '@poolmaster/shared/domain';
import { CupService } from '../../../packages/core-api/src/modules/cups/service';
import { InMemoryCups, type InMemoryCupContest } from '../../support/in-memory-cups';
import { fakeSportLeagueRepo, fakeSquadRepo } from '../../support/repo-fakes';

const LEAGUE = 'league-1';
const PGA = 'sport-league-pga';
const NFL = 'sport-league-nfl';
const KEY = { leagueId: LEAGUE, seasonYear: 2026, sportLeagueId: PGA };

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
  const service = new CupService({
    cups,
    squads: fakeSquadRepo({
      findByLeague: jest.fn().mockResolvedValue(squads),
      findById: jest.fn().mockImplementation(async (id: string) => squads.find((candidate) => candidate.id === id) ?? null),
    }),
    sportLeagues: fakeSportLeagueRepo({
      findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: id === PGA ? 'PGA Tour' : 'NFL' })),
    }),
  });
  let day = 0;
  /** A contest of the 2026 PGA Tour season, final on the next day unless told otherwise, with its ranked entries. */
  const contest = (id: string, places: Array<[squadId: string, position: number]>, overrides: Partial<InMemoryCupContest> = {}) => {
    day += 1;
    const status = overrides.status ?? ContestStatus.COMPLETED;
    cups.contests.push({
      ...KEY,
      id,
      name: `Contest ${id}`,
      status,
      selectionType: SelectionType.TIERED,
      cupWeight: CupWeight.NORMAL,
      firstEventStartsAt: new Date(Date.UTC(2026, 3, day)),
      completedAt: status === ContestStatus.COMPLETED ? new Date(Date.UTC(2026, 3, day, 20)) : null,
      ...overrides,
    });
    cups.rankedEntries.push(...places.map(([squadId, position]) => ({ contestId: id, squadId, position })));
  };
  return { cups, service, contest };
}

describe('CupService (#841)', () => {
  it('makes a league one cup per season and sports league, however many contests ask for it', async () => {
    const { cups, service } = build();

    await service.ensureCup(KEY);
    await service.ensureCup(KEY);
    await service.ensureCup({ ...KEY, sportLeagueId: NFL });

    expect(cups.cups.map((cup) => cup.sportLeagueId)).toEqual([PGA, NFL]);
  });

  it('names the cup from its season and sports league and ranks squads by STANDARD points from their best entry', async () => {
    const { service, contest } = build();
    await service.ensureCup(KEY);
    // The Eagles' second entry finishes 3rd: only their best, 1st, scores, but it still holds 3rd.
    contest('masters', [['eagles', 1], ['birdies', 2], ['eagles', 3], ['bogeys', 4]]);

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(cup.sportLeagueName).toBe('PGA Tour');
    expect(cup.standings.map((row) => [row.squad.name, row.displayPosition, row.points, row.wins, row.podiums, row.contestsCounted])).toEqual([
      ['Eagles', '1', 1000, 1, 1, 1],
      ['Birdies', '2', 800, 0, 1, 1],
      ['Bogeys', '3', 550, 0, 0, 1],
    ]);
  });

  it('counts only final contests that are counted, and lists open, not-counted and resultless ones with why', async () => {
    const { service, contest } = build();
    await service.ensureCup(KEY);
    contest('final', [['eagles', 1], ['birdies', 2]]);
    contest('live', [], { status: ContestStatus.ACTIVE });
    contest('skins-game', [['birdies', 1], ['eagles', 2]], { cupWeight: CupWeight.NOT_COUNTED });
    contest('washed-out', []);
    contest('draft', [], { status: ContestStatus.DRAFT });

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(cup.contests.map((row) => [row.contest.id, row.count, row.winners.map((winner) => winner.name)])).toEqual([
      ['final', CupContestCount.COUNTED, ['Eagles']],
      ['live', CupContestCount.NOT_FINAL, []],
      ['skins-game', CupContestCount.NOT_COUNTED, []],
      ['washed-out', CupContestCount.NO_RESULT, []],
    ]);
    expect(cup.standings.find((row) => row.squad.id === 'eagles')?.points).toBe(1000);
  });

  it('weights a BONUS contest x1.5, and shares a place between squads equal on points, wins and podiums', async () => {
    const { service, contest } = build();
    await service.ensureCup(KEY);
    contest('players', [['eagles', 1], ['birdies', 2]], { cupWeight: CupWeight.BONUS });
    contest('open', [['birdies', 1], ['eagles', 2]], { cupWeight: CupWeight.BONUS });

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(cup.standings.map((row) => [row.squad.name, row.displayPosition, row.points])).toEqual([
      ['Birdies', 'T1', 2700],
      ['Eagles', 'T1', 2700],
      ['Bogeys', '3', 0],
    ]);
  });

  it('scores with the league\'s own points table', async () => {
    const { cups, service, contest } = build();
    cups.addLeague(LEAGUE, { scale: CupPointsScale.TOP_TEN, customPoints: [] });
    await service.ensureCup(KEY);
    contest('masters', [['eagles', 1], ['birdies', 2]]);

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(cup.standings.map((row) => row.points)).toEqual([250, 180, 0]);
  });

  it('moves squads by the places they gained or lost in the latest contest to go final, and shows no movement before two have', async () => {
    const { service, contest } = build();
    await service.ensureCup(KEY);
    contest('first', [['eagles', 1], ['birdies', 2], ['bogeys', 3]]);

    const [afterOne] = await service.listSeasonCups(LEAGUE, 2026);
    expect(afterOne.standings.map((row) => row.movement)).toEqual([null, null, null]);

    contest('second', [['bogeys', 1], ['birdies', 2], ['eagles', 3]]);
    const [afterTwo] = await service.listSeasonCups(LEAGUE, 2026);

    // Eagles 100 + 65, Bogeys 65 + 100, Birdies 80 + 80: Bogeys climb from 3rd to T1.
    expect(afterTwo.standings.map((row) => [row.squad.name, row.displayPosition, row.movement])).toEqual([
      ['Bogeys', 'T1', 2],
      ['Eagles', 'T1', 0],
      ['Birdies', '3', -1],
    ]);
  });

  it('carries each squad\'s running total after each counted contest in the order they went final, 0 where it had no entry', async () => {
    const { service, contest } = build();
    await service.ensureCup(KEY);
    contest('first', [['eagles', 1], ['birdies', 2]]);
    contest('open', [['bogeys', 1]], { status: ContestStatus.OPEN });
    contest('second', [['bogeys', 1], ['eagles', 2]]);

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(Object.fromEntries(cup.standings.map((row) => [row.squad.name, row.pointsAfter]))).toEqual({
      Eagles: [1000, 1800],
      Birdies: [800, 800],
      Bogeys: [0, 1000],
    });
  });

  it('shows every active squad at 0, and an inactive squad only once it has placed', async () => {
    const retired = squad('retired', 'Retired', { isActive: false });
    const gone = squad('gone', 'Gone', { isActive: false });
    const { service, contest } = build([EAGLES, BIRDIES, retired, gone]);
    await service.ensureCup(KEY);
    contest('masters', [['retired', 1]]);

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);

    expect(cup.standings.map((row) => [row.squad.name, row.points])).toEqual([
      ['Retired', 1000],
      ['Birdies', 0],
      ['Eagles', 0],
    ]);
  });

  it('breaks one squad\'s points down contest by contest in the order they went final, with no place where it had no entry', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    contest('masters', [['eagles', 2], ['birdies', 2]]);
    contest('open', [['birdies', 1]]);
    const cupId = cups.cups[0]?.id ?? '';

    const breakdown = await service.getSquadPoints(LEAGUE, cupId, 'eagles');

    expect(breakdown.points).toBe(725);
    expect(breakdown.contests.map((row) => [row.contest.id, row.finish?.place ?? null, row.finish?.tiedCount ?? null, row.points])).toEqual([
      ['masters', 2, 2, 725],
      ['open', null, null, 0],
    ]);
  });

  it('leaves out of the season list a cup none of whose contests is listed, as when its only contest moved to another season, while the cup itself still opens', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    await service.ensureCup({ ...KEY, sportLeagueId: NFL });
    contest('masters', [['eagles', 1]]);
    const emptyCupId = cups.cups.find((cup) => cup.sportLeagueId === NFL)?.id ?? '';

    const listed = await service.listSeasonCups(LEAGUE, 2026);

    expect(listed.map((view) => view.sportLeagueName)).toEqual(['PGA Tour']);
    await expect(service.getCup(LEAGUE, emptyCupId)).resolves.toMatchObject({ contests: [] });
  });

  it('refuses another league\'s cup with CUP_NOT_FOUND and another league\'s squad with SQUAD_NOT_FOUND', async () => {
    const { cups, service } = build();
    await service.ensureCup(KEY);
    const cupId = cups.cups[0]?.id ?? '';

    await expect(service.getCup('league-2', cupId)).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
    await expect(service.getSquadPoints(LEAGUE, cupId, 'strangers')).rejects.toMatchObject({ code: 'SQUAD_NOT_FOUND' });
  });
});
