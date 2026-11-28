/**
 * A contest's championship year (#2021) in real Postgres: the migration copies each contest's
 * Season's year onto it and moves its championship finishes into that year, and the composite key
 * refuses a contest whose year disagrees with its Season. The migration test puts the old columns
 * back, runs the migration's own statements from its file, and rolls everything back. No mocks.
 */
import { expect } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SeasonSlotStatus, Sport } from '@poolmaster/shared/domain';
import { PrismaLeagueChampionshipYearRepository } from '../../../packages/core-api/src/adapters';
import { ChampionshipYearCloseService } from '../../../packages/core-api/src/modules/championship/year-close-service';
import { cleanupTestData, createTestUser, getAppPrisma, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';
import { fixtureSeasonId } from '../../support/event-edition';
import { sportLeagueRowDefaults } from '../../support/league-profiles';
import { sportPlay } from '../../support/sport-play';
import { sportRowKeys } from '../../support/sport-rows';
import { linkTestSlot, testSlotIdIn } from '../../support/test-slots';
import { anySeasonId } from '../../support/contest-rows';
import { StatementVerb, recordStatements, statementsOn } from '../statement-log';

beforeAll(async () => {
  await setupIntegrationTests();
  await cleanupTestData();
});
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const MIGRATION = join(__dirname, '../../../packages/core-api/prisma/migrations/20271218032400_contest_championship_year/migration.sql');

/** The migration's statements in order. */
function migrationStatements(): string[] {
  return readFileSync(MIGRATION, 'utf8')
    .split(/;\s*\n/)
    .map((statement) => statement.replace(/^\s*--.*$/gm, '').trim())
    .filter((statement) => statement.length > 0);
}

/** The tables as they were before the migration: no contest year, the review's `year`, no closed years. */
const PUT_BACK = [
  'DROP TABLE "league_championship_years"',
  'DROP INDEX "league_year_reviews_league_id_championship_year_key"',
  'ALTER TABLE "league_year_reviews" RENAME COLUMN "championship_year" TO "year"',
  'CREATE UNIQUE INDEX "league_year_reviews_league_id_year_key" ON "league_year_reviews"("league_id", "year")',
  'ALTER TABLE "contests" DROP CONSTRAINT "contests_season_year_fkey"',
  'ALTER TABLE "contests" ADD CONSTRAINT "contests_sport_league_season_id_fkey" FOREIGN KEY ("sport_league_season_id") REFERENCES "sport_league_seasons"("id") ON DELETE RESTRICT ON UPDATE CASCADE',
  'DROP INDEX "sport_league_seasons_id_championship_year_key"',
  'ALTER TABLE "contests" DROP COLUMN "championship_year"',
];

class Rollback extends Error {}

/** A league with one squad and a COMPLETED contest in a Season of `championshipYear`. */
async function completedContest(championshipYear: number) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Year', lastName: `Keeper${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Year Cup', leagueCode: `CYR${suffix.toUpperCase()}`, name: `Year League ${suffix}` } });
  const squad = await prisma.squad.create({ data: { leagueId: league.id, name: `Eagles ${suffix}`, createdBy: commissioner.user.id } });
  const sportLeagueSeasonId = await anySeasonId(prisma, championshipYear);
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, sportLeagueSeasonId, championshipYear, name: `Playoffs ${suffix}`, status: 'COMPLETED', selectionType: 'TIERED' },
  });
  return { league, squad, contest, sportLeagueSeasonId };
}

describe('a contest\'s championship year (#2021)', () => {
  it('copies each contest\'s Season year onto it, and moves a finish settled in the next calendar year back into the contest\'s championship year', async () => {
    const { league, squad, contest } = await completedContest(2025);
    const prisma = getPrisma();
    // Settled with the Super Bowl in February 2026, so the old write put it in 2026.
    const settledAt = new Date('2026-02-09T04:30:00.000Z');
    await prisma.leagueYearFinish.create({
      data: { leagueId: league.id, year: 2026, squadId: squad.id, contestId: contest.id, place: 1, tiedCount: 1, rankedEntryCount: 4, weight: 'NORMAL', points: 1000, settledAt },
    });

    const after = await prisma.$transaction(async (tx) => {
      for (const statement of PUT_BACK) {
        // poolmaster-allow-query-in-loop: the statements putting the old tables back, in order
        await tx.$executeRawUnsafe(statement);
      }
      for (const statement of migrationStatements()) {
        // poolmaster-allow-query-in-loop: the migration's own statements, in order
        await tx.$executeRawUnsafe(statement);
      }
      const [row] = await tx.$queryRawUnsafe<{ contestYear: number; finishYear: number }[]>(
        'SELECT c."championship_year" AS "contestYear", f."year" AS "finishYear" FROM "contests" c JOIN "league_year_finishes" f ON f."contest_id" = c."id" WHERE c."id" = $1::uuid',
        contest.id,
      );
      throw new Rollback(JSON.stringify(row));
    }, { timeout: 30_000 }).catch((error: unknown) => {
      if (error instanceof Rollback) return JSON.parse(error.message) as { contestYear: number; finishYear: number };
      throw error;
    });

    expect(after).toEqual({ contestYear: 2025, finishYear: 2025 });
  });

  it('refuses a contest whose championship year disagrees with its Season\'s, so the two can never drift apart', async () => {
    const { league, sportLeagueSeasonId } = await completedContest(2025);

    await expect(getPrisma().contest.create({
      data: { leagueId: league.id, sportLeagueSeasonId, championshipYear: 2026, name: 'Drifted', status: 'DRAFT', selectionType: 'TIERED' },
    })).rejects.toThrow(/contests_season_year_fkey/);
  });
});

/**
 * A league that ran contests in one football Season of 2025 of a sport league of its own: two real
 * slots (the Divisional round and the Super Bowl), each with its event, and its contests.
 */
async function footballYear() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const sport = await prisma.sport.upsert({ where: { sport: Sport.FOOTBALL }, create: { sport: Sport.FOOTBALL, ...sportRowKeys(Sport.FOOTBALL) }, update: {} });
  const sportLeague = await prisma.sportLeague.create({
    data: { timeZone: 'UTC', ...(await sportLeagueRowDefaults(prisma)), ...sportPlay(sport.sport), sportId: sport.id, name: `Year Close League ${suffix}` },
  });
  const sportLeagueSeasonId = await fixtureSeasonId(prisma, sportLeague.id, 2025);
  const slot = async (name: string, startDate: Date) => {
    const event = await prisma.sportEvent.create({ data: { sportLeagueId: sportLeague.id, sportLeagueSeasonId, name: `${name} ${suffix}`, startDate, status: 'SCHEDULED' } });
    return { event, seasonSlotId: await linkTestSlot(prisma, event, false) };
  };
  const divisional = await slot('Divisional Round', new Date('2026-01-17T21:00:00.000Z'));
  const superBowl = await slot('Super Bowl', new Date('2026-02-08T23:30:00.000Z'));
  const commissioner = await createTestUser({ firstName: 'Close', lastName: `Keeper${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Close Cup', leagueCode: `CLS${suffix.toUpperCase()}`, name: `Close League ${suffix}` } });
  await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER' } });
  const contest = (name: string, status: 'DRAFT' | 'ACTIVE' | 'COMPLETED', seasonSlotId: string) => prisma.contest.create({
    data: {
      leagueId: league.id, sportLeagueSeasonId, championshipYear: 2025, name: `${name} ${suffix}`, status, selectionType: 'TIERED',
      seasonSlots: { create: { sportLeagueSeasonCompetitionSlotId: seasonSlotId } },
    },
  });
  const finish = (seasonSlotId: string) => prisma.sportLeagueSeasonCompetitionSlot.update({ where: { id: seasonSlotId }, data: { status: SeasonSlotStatus.COMPLETED } });
  return { league, sportLeague, sportLeagueSeasonId, divisional, superBowl, contest, finish, key: { leagueId: league.id, championshipYear: 2025 } };
}

const closer = (now: Date) => new ChampionshipYearCloseService({ years: new PrismaLeagueChampionshipYearRepository(getAppPrisma()), now: () => now });

describe('the championship year close against Postgres (#2021)', () => {
  const AFTER_SUPER_BOWL = new Date('2026-02-10T12:00:00.000Z');

  it('holds the year open while its Super Bowl slot is still to play, then closes it once that slot and every contest are final, reached from the slot', async () => {
    const year = await footballYear();
    await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await year.finish(year.divisional.seasonSlotId);

    await expect(closer(AFTER_SUPER_BOWL).closeSeasonYears(year.divisional.seasonSlotId)).resolves.toEqual({ changedCount: 0 });

    await year.finish(year.superBowl.seasonSlotId);
    await expect(closer(AFTER_SUPER_BOWL).closeSeasonYears(year.superBowl.seasonSlotId)).resolves.toEqual({ changedCount: 1 });
    expect(await new PrismaLeagueChampionshipYearRepository(getAppPrisma()).findClosedYears(year.league.id)).toEqual([{ championshipYear: 2025, closedAt: AFTER_SUPER_BOWL }]);
  });

  it('holds the year open while a contest in it is still live, and closes it from that contest once it goes final', async () => {
    const year = await footballYear();
    await year.finish(year.divisional.seasonSlotId);
    await year.finish(year.superBowl.seasonSlotId);
    const live = await year.contest('Super Bowl squares', 'ACTIVE', year.superBowl.seasonSlotId);

    await expect(closer(AFTER_SUPER_BOWL).closeContestYear(live.id)).resolves.toEqual({ changedCount: 0 });

    await getPrisma().contest.update({ where: { id: live.id }, data: { status: 'COMPLETED' } });
    await expect(closer(AFTER_SUPER_BOWL).closeContestYear(live.id)).resolves.toEqual({ changedCount: 1 });
  });

  it('holds the year open for a synced Season slot no event is placed on yet, as a round not yet drawn, since a closed year never reopens for it', async () => {
    const year = await footballYear();
    await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await year.finish(year.divisional.seasonSlotId);
    await year.finish(year.superBowl.seasonSlotId);
    await testSlotIdIn(getPrisma(), year.sportLeague.id, year.sportLeagueSeasonId, new Date('2026-02-15T20:00:00.000Z'), null, false);

    await expect(new PrismaLeagueChampionshipYearRepository(getAppPrisma()).readYearState(year.key, AFTER_SUPER_BOWL))
      .resolves.toEqual({ contestCount: 1, unfinishedContestCount: 0, unfinishedSeasonSlotCount: 1 });
    await expect(closer(AFTER_SUPER_BOWL).closeYear(year.key)).resolves.toBe(false);
  });

  it('reads a year with no contests as holding nothing, so it never closes, and finds no league years for a slot or contest that is gone', async () => {
    const year = await footballYear();
    const repo = new PrismaLeagueChampionshipYearRepository(getAppPrisma());

    await expect(repo.readYearState(year.key, AFTER_SUPER_BOWL)).resolves.toEqual({ contestCount: 0, unfinishedContestCount: 0, unfinishedSeasonSlotCount: 0 });
    await expect(closer(AFTER_SUPER_BOWL).closeYear(year.key)).resolves.toBe(false);
    await expect(repo.findLeagueYearsOfSeasonSlot(randomUUID())).resolves.toEqual([]);
    await expect(closer(AFTER_SUPER_BOWL).closeContestYear(randomUUID())).resolves.toEqual({ changedCount: 0 });
  });

  it('ignores a draft that can never open, its event over, and never reopens a closed year', async () => {
    const year = await footballYear();
    await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await year.contest('Forgotten draft', 'DRAFT', year.superBowl.seasonSlotId);
    await getPrisma().sportEvent.update({ where: { id: year.superBowl.event.id }, data: { status: 'COMPLETED' } });
    await year.finish(year.divisional.seasonSlotId);
    await year.finish(year.superBowl.seasonSlotId);
    const repo = new PrismaLeagueChampionshipYearRepository(getAppPrisma());

    await expect(repo.readYearState(year.key, AFTER_SUPER_BOWL)).resolves.toEqual({ contestCount: 1, unfinishedContestCount: 0, unfinishedSeasonSlotCount: 0 });
    await expect(closer(AFTER_SUPER_BOWL).closeYear(year.key)).resolves.toBe(true);
    await expect(repo.close(year.key, new Date('2026-03-01T12:00:00.000Z'))).resolves.toBe(false);
    expect(await repo.findClosedYears(year.league.id)).toEqual([{ championshipYear: 2025, closedAt: AFTER_SUPER_BOWL }]);
  });
});

describe('the championship calendar\'s reads against Postgres (#2021)', () => {
  const BEFORE_SUPER_BOWL = new Date('2026-01-20T12:00:00.000Z');

  it('reads the league\'s contest years with the live one marked and its unfinished contests named, its closed years, and only the open year\'s slots still to play', async () => {
    const year = await footballYear();
    await year.finish(year.divisional.seasonSlotId);
    const live = await year.contest('Super Bowl pool', 'ACTIVE', year.superBowl.seasonSlotId);
    const done = await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await getPrisma().leagueChampionshipYear.create({ data: { leagueId: year.league.id, championshipYear: 2023, closedAt: new Date('2024-02-12T12:00:00.000Z') } });

    const input = await new PrismaLeagueChampionshipYearRepository(getAppPrisma()).readCalendarInput(year.league.id, BEFORE_SUPER_BOWL);

    expect(input.contestYears).toEqual([2025]);
    expect(input.unfinishedContests).toEqual([{ id: live.id, name: live.name, championshipYear: 2025, status: 'ACTIVE' }]);
    expect(input.unfinishedContests.map((contest) => contest.id)).not.toContain(done.id);
    expect(input.closedYears).toEqual([2023]);
    expect(input.unfinishedSlots).toEqual([expect.objectContaining({ championshipYear: 2025, sportLeagueId: year.sportLeague.id, startsAt: expect.any(Date) })]);
    expect(input.currentSeasonYears.every((value) => Number.isInteger(value))).toBe(true);
  });

  it('reads the league\'s finished contests only grouped by year, never row by row, however many years of them it has', async () => {
    const year = await footballYear();
    await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await year.contest('Super Bowl pool', 'ACTIVE', year.superBowl.seasonSlotId);

    const { result, statements } = await recordStatements(() => new PrismaLeagueChampionshipYearRepository(getAppPrisma()).readCalendarInput(year.league.id, BEFORE_SUPER_BOWL));

    expect(result.contestYears).toEqual([2025]);
    const contestReads = statementsOn(statements, StatementVerb.SELECT, 'contests').map((statement) => statement.sql);
    expect(contestReads).toHaveLength(2);
    expect(contestReads.filter((sql) => sql.includes('GROUP BY'))).toHaveLength(1);
    expect(contestReads.filter((sql) => !sql.includes('GROUP BY')).every((sql) => sql.includes('"status" <> '))).toBe(true);
  });

  it('reads no slots for a year the league has closed, and none for a league with no contests', async () => {
    const year = await footballYear();
    await year.contest('Divisional pool', 'COMPLETED', year.divisional.seasonSlotId);
    await getPrisma().leagueChampionshipYear.create({ data: { leagueId: year.league.id, championshipYear: 2025, closedAt: BEFORE_SUPER_BOWL } });
    const repo = new PrismaLeagueChampionshipYearRepository(getAppPrisma());

    expect((await repo.readCalendarInput(year.league.id, BEFORE_SUPER_BOWL)).unfinishedSlots).toEqual([]);
    const empty = await getPrisma().league.create({ data: { cupName: 'Empty Cup', leagueCode: `EMP${randomUUID().slice(0, 8).toUpperCase()}`, name: 'Empty League' } });
    await expect(repo.readCalendarInput(empty.id, BEFORE_SUPER_BOWL)).resolves.toEqual(expect.objectContaining({ contestYears: [], unfinishedContests: [], closedYears: [], unfinishedSlots: [] }));
  });
});
