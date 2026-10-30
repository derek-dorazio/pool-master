/**
 * Cup standings (#841), worked out on read from the contests' frozen places: which contests
 * count, how a squad scores from its best entry, how ties and movement read, and what a squad's
 * breakdown holds.
 */
import {
  ContestStatus,
  CupContestCount,
  CupPointsScale,
  CupStatus,
  CupTrophy,
  CupWeight,
  SelectionType,
  TeamIconKey,
  type RankedContestEntry,
  type Squad,
} from '@poolmaster/shared/domain';
import { CupService } from '../../../packages/core-api/src/modules/cups/service';
import { InMemoryCups, type InMemoryCupContest } from '../../support/in-memory-cups';
import { fakeSportLeagueRepo, fakeSquadRepo } from '../../support/repo-fakes';

const LEAGUE = 'league-1';
const PGA = 'sport-league-pga';
const NFL = 'sport-league-nfl';
const KEY = { leagueId: LEAGUE, seasonYear: 2026, sportLeagueId: PGA };
const CROWNED_AT = new Date('2026-09-30T12:00:00.000Z');

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
  /** Each live contest's leaderboard places as they stand. */
  const live = new Map<string, RankedContestEntry[]>();
  const service = new CupService({
    cups,
    leagues: cups.leagues,
    liveContests: { livePositionsOfMany: async (contestIds) => new Map(contestIds.map((contestId) => [contestId, live.get(contestId) ?? []])) },
    squads: fakeSquadRepo({
      findByLeague: jest.fn().mockResolvedValue(squads),
      findById: jest.fn().mockImplementation(async (id: string) => squads.find((candidate) => candidate.id === id) ?? null),
    }),
    sportLeagues: fakeSportLeagueRepo({
      findById: jest.fn().mockImplementation(async (id: string) => ({ id, name: id === PGA ? 'PGA Tour' : 'NFL' })),
      findByIds: jest.fn().mockImplementation(async (ids: string[]) => ids.map((id) => ({ id, name: id === PGA ? 'PGA Tour' : 'NFL' }))),
    }),
    now: () => CROWNED_AT,
  });
  let day = 0;
  /** A contest of the 2026 PGA Tour season, final on the next day unless told otherwise, with its ranked entries: its places as they stand while it is live. */
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
    if (status === ContestStatus.ACTIVE) {
      live.set(id, places.map(([squadId, position]) => ({ squadId, position })));
    }
    const completedAt = cups.contests.at(-1)?.completedAt ?? null;
    if (completedAt !== null) {
      cups.settle(id, completedAt);
    }
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

  it('lists the seasons the league has a cup to show in, newest first, leaving out one with only a draft', async () => {
    const { service, contest } = build();
    contest('masters', []);
    contest('last-season', [], { seasonYear: 2025 });
    contest('next-season', [], { seasonYear: 2027, status: ContestStatus.DRAFT });

    await expect(service.listSeasonYears(LEAGUE)).resolves.toEqual([2026, 2025]);
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

  it('breaks one squad\'s points down contest by contest in the order they went final, with no place where it had no entry, finding the cup by its season and sports league', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    await service.ensureCup({ ...KEY, sportLeagueId: NFL });
    contest('masters', [['eagles', 2], ['birdies', 2]]);
    contest('open', [['birdies', 1]]);
    const pgaCup = cups.cups.find((cup) => cup.sportLeagueId === PGA);

    const breakdown = await service.getSquadPoints(KEY, 'eagles');

    expect(breakdown.cup.id).toBe(pgaCup?.id);
    expect(breakdown.sportLeagueName).toBe('PGA Tour');
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

  it('lists every season with a listed contest newest first, each with its cups as that season\'s list shows them, a season whose cup lists nothing with none and a draft-only season left out (#1166)', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    await service.ensureCup({ ...KEY, sportLeagueId: NFL });
    await service.ensureCup({ ...KEY, seasonYear: 2025 });
    contest('masters', [['eagles', 1], ['birdies', 2]]);
    contest('bowl', [['bogeys', 1]], { sportLeagueId: NFL });
    contest('last-masters', [['birdies', 1]], { seasonYear: 2025 });
    // A contest moved to 2024 whose season has no cup, and a 2027 draft.
    contest('moved', [], { seasonYear: 2024, status: ContestStatus.OPEN });
    contest('next', [], { seasonYear: 2027, status: ContestStatus.DRAFT });
    const lastSeasonCup = cups.cups.find((cup) => cup.seasonYear === 2025);
    await service.crown(LEAGUE, lastSeasonCup?.id ?? '');

    const seasons = await service.listLeagueSeasons(LEAGUE);

    expect(seasons.map((season) => [season.seasonYear, season.cups.map((view) => view.sportLeagueName)])).toEqual([
      [2026, ['PGA Tour', 'NFL']],
      [2025, ['PGA Tour']],
      [2024, []],
    ]);
    for (const season of seasons) {
      expect(season.cups).toEqual(await service.listSeasonCups(LEAGUE, season.seasonYear));
    }
    expect(seasons[1]?.cups[0]?.standings.map((row) => [row.squad.name, row.trophy])).toEqual([
      ['Birdies', CupTrophy.CHAMPION], ['Bogeys', null], ['Eagles', null],
    ]);
  });

  it('opens a crowned cup with its frozen standings and an open one with its live ones, reading both from one season list (#1166)', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    await service.ensureCup({ ...KEY, sportLeagueId: NFL });
    contest('masters', [['eagles', 1], ['birdies', 2]]);
    contest('bowl', [['bogeys', 1], ['eagles', 2]], { sportLeagueId: NFL });
    const pga = cups.cups.find((cup) => cup.sportLeagueId === PGA);
    await service.crown(LEAGUE, pga?.id ?? '');

    const listed = await service.listSeasonCups(LEAGUE, 2026);

    expect(listed).toEqual([await service.getCup(LEAGUE, pga?.id ?? ''), await service.getCup(LEAGUE, cups.cups.find((cup) => cup.sportLeagueId === NFL)?.id ?? '')]);
    expect(listed.map((view) => [view.cup.status, view.standings.map((row) => row.trophy)])).toEqual([
      [CupStatus.CROWNED, [CupTrophy.CHAMPION, CupTrophy.RUNNER_UP, null]],
      [CupStatus.OPEN, [null, null, null]],
    ]);
  });

  it('refuses another league\'s cup with CUP_NOT_FOUND and another league\'s squad with SQUAD_NOT_FOUND', async () => {
    const { cups, service } = build();
    await service.ensureCup(KEY);
    const cupId = cups.cups[0]?.id ?? '';

    await expect(service.getCup('league-2', cupId)).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
    await expect(service.getSquadPoints(KEY, 'strangers')).rejects.toMatchObject({ code: 'SQUAD_NOT_FOUND' });
  });

  it('refuses a squad\'s cup points with CUP_NOT_FOUND for a season or sports league the league has no cup in, or another league\'s cup', async () => {
    const { service } = build();
    await service.ensureCup(KEY);

    await expect(service.getSquadPoints({ ...KEY, seasonYear: 2025 }, 'eagles')).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
    await expect(service.getSquadPoints({ ...KEY, sportLeagueId: NFL }, 'eagles')).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
    await expect(service.getSquadPoints({ ...KEY, leagueId: 'league-2' }, 'eagles')).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
  });

  it('scores a final contest at the weight it was settled with, not a weight saved while it settled', async () => {
    const { cups, service, contest } = build();
    await service.ensureCup(KEY);
    contest('masters', [['eagles', 1], ['birdies', 2]]);
    // Saved after settlement read the weight, before the contest went final.
    const masters = cups.contests.find((candidate) => candidate.id === 'masters');
    if (masters) {
      masters.cupWeight = CupWeight.DOUBLE;
    }

    const [cup] = await service.listSeasonCups(LEAGUE, 2026);
    const breakdown = await service.getSquadPoints(KEY, 'eagles');

    expect(cup.standings.map((row) => row.points)).toEqual([1000, 800, 0]);
    expect(cup.contests.map((row) => row.weight)).toEqual([CupWeight.NORMAL]);
    expect(breakdown.contests.map((row) => [row.weight, row.points])).toEqual([[CupWeight.NORMAL, 1000]]);
  });

  describe('projection', () => {
    it('ranks squads as if every live contest ended now, at its own weight on top of the counted ones, with the points each gains and the places it moves', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1], ['birdies', 2], ['bogeys', 3]]);
      contest('open', [['bogeys', 1], ['birdies', 2], ['eagles', 3]], { status: ContestStatus.ACTIVE, cupWeight: CupWeight.DOUBLE });

      const projection = await service.getProjection(LEAGUE, cups.cups[0]?.id ?? '');

      expect(projection.contests.map((row) => row.id)).toEqual(['open']);
      expect(projection.standings.map((row) => [row.squad.name, row.displayPosition, row.points, row.gained, row.movement])).toEqual([
        ['Bogeys', '1', 2650, 2000, 2],
        ['Birdies', '2', 2400, 1600, 0],
        ['Eagles', '3', 2300, 1300, -2],
      ]);
    });

    it('leaves out a live contest that is not counted and one still taking entries, so with nothing live it matches the standings', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1], ['birdies', 2]]);
      contest('skins-game', [['birdies', 1]], { status: ContestStatus.ACTIVE, cupWeight: CupWeight.NOT_COUNTED });
      contest('open', [], { status: ContestStatus.OPEN });

      const projection = await service.getProjection(LEAGUE, cups.cups[0]?.id ?? '');

      expect(projection.contests).toEqual([]);
      expect(projection.standings.map((row) => [row.squad.name, row.displayPosition, row.points, row.gained, row.movement])).toEqual([
        ['Eagles', '1', 1000, 0, 0],
        ['Birdies', '2', 800, 0, 0],
        ['Bogeys', '3', 0, 0, 0],
      ]);
    });

    it('refuses a crowned cup with CUP_CROWNED, its standings being final, and another league\'s cup with CUP_NOT_FOUND', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1]]);
      const cupId = cups.cups[0]?.id ?? '';
      await service.crown(LEAGUE, cupId);

      await expect(service.getProjection(LEAGUE, cupId)).rejects.toMatchObject({ code: 'CUP_CROWNED' });
      await expect(service.getProjection('league-2', cupId)).rejects.toMatchObject({ code: 'CUP_NOT_FOUND' });
    });
  });

  describe('crowning', () => {
    it('freezes every squad\'s place and hands 1st, 2nd and 3rd their trophies, none to a squad at 0', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1], ['birdies', 2]]);
      contest('open', [['eagles', 1]]);
      const cupId = cups.cups[0]?.id ?? '';

      const crowned = await service.crown(LEAGUE, cupId);

      expect(crowned.cup).toMatchObject({ status: CupStatus.CROWNED, crownedAt: CROWNED_AT });
      expect(crowned.standings.map((row) => [row.squad.name, row.displayPosition, row.points, row.trophy, row.movement])).toEqual([
        ['Eagles', '1', 2000, CupTrophy.CHAMPION, null],
        ['Birdies', '2', 800, CupTrophy.RUNNER_UP, null],
        ['Bogeys', '3', 0, null, null],
      ]);
    });

    it('gives squads sharing a place the same trophy', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1], ['birdies', 2], ['bogeys', 3]]);
      contest('open', [['birdies', 1], ['eagles', 2], ['bogeys', 3]]);

      const crowned = await service.crown(LEAGUE, cups.cups[0]?.id ?? '');

      expect(crowned.standings.map((row) => [row.squad.name, row.displayPosition, row.trophy])).toEqual([
        ['Birdies', 'T1', CupTrophy.CHAMPION],
        ['Eagles', 'T1', CupTrophy.CHAMPION],
        ['Bogeys', '3', CupTrophy.THIRD],
      ]);
    });

    it('keeps a crowned cup on the points table it was crowned on, and leaves a contest final later out as after the crowning', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1], ['birdies', 2]]);
      contest('tour-championship', [], { status: ContestStatus.OPEN, cupWeight: CupWeight.NOT_COUNTED });
      const cupId = cups.cups[0]?.id ?? '';
      await service.crown(LEAGUE, cupId);

      cups.addLeague(LEAGUE, { scale: CupPointsScale.TOP_TEN, customPoints: [] });
      // Settled, and its finishes written, after the crowning.
      contest('late', [['bogeys', 1]], { completedAt: new Date('2026-10-05T20:00:00.000Z') });
      const cup = await service.getCup(LEAGUE, cupId);

      expect(cup.standings.map((row) => [row.squad.name, row.points, row.pointsAfter])).toEqual([
        ['Eagles', 1000, [1000]],
        ['Birdies', 800, [800]],
        ['Bogeys', 0, [0]],
      ]);
      expect(cup.contests.map((row) => [row.contest.id, row.count, row.winners.map((winner) => winner.name)])).toEqual([
        ['masters', CupContestCount.COUNTED, ['Eagles']],
        ['tour-championship', CupContestCount.NOT_COUNTED, []],
        ['late', CupContestCount.AFTER_CROWNING, []],
      ]);
    });

    it('refuses while a counted contest is open or live, naming each, but not for one that is not counted', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1]]);
      contest('open', [], { status: ContestStatus.OPEN });
      contest('players', [], { status: ContestStatus.ACTIVE });
      contest('skins-game', [], { status: ContestStatus.ACTIVE, cupWeight: CupWeight.NOT_COUNTED });

      const refusal = service.crown(LEAGUE, cups.cups[0]?.id ?? '');

      await expect(refusal).rejects.toMatchObject({
        code: 'CUP_HAS_UNFINISHED_CONTESTS',
        message: 'The cup cannot be crowned while Contest open, Contest players are not final.',
      });
      await expect(refusal).rejects.toHaveProperty('contests', [
        expect.objectContaining({ id: 'open' }),
        expect.objectContaining({ id: 'players' }),
      ]);
      expect(cups.cups[0]?.status).toBe(CupStatus.OPEN);
    });

    it('refuses with CUP_NOTHING_COUNTED a cup none of whose contests has counted, leaving it open', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('skins-game', [['eagles', 1]], { cupWeight: CupWeight.NOT_COUNTED });
      contest('washed-out', []);

      await expect(service.crown(LEAGUE, cups.cups[0]?.id ?? '')).rejects.toMatchObject({ code: 'CUP_NOTHING_COUNTED' });
      expect(cups.cups[0]?.status).toBe(CupStatus.OPEN);
      expect(cups.standings).toEqual([]);
    });

    it('refuses to crown a cup twice with CUP_CROWNED', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1]]);
      const cupId = cups.cups[0]?.id ?? '';
      await service.crown(LEAGUE, cupId);

      await expect(service.crown(LEAGUE, cupId)).rejects.toMatchObject({ code: 'CUP_CROWNED' });
      expect(cups.standings).toHaveLength(3);
    });

    it('refuses with CUP_CROWNED when another crowning got there first', async () => {
      const { cups, service, contest } = build();
      await service.ensureCup(KEY);
      contest('masters', [['eagles', 1]]);
      jest.spyOn(cups, 'crown').mockResolvedValueOnce(null);

      await expect(service.crown(LEAGUE, cups.cups[0]?.id ?? '')).rejects.toMatchObject({ code: 'CUP_CROWNED' });
    });
  });
});
