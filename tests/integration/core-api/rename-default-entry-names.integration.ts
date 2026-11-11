/**
 * The #1564 migration renames entries still carrying the old default name, "<team> Entry <n>",
 * to the new default "<team> <n>". Names people chose stay as they are, and a rename never gives
 * a team two entries of one name in a contest. The test seeds each case and runs the migration's
 * own SQL file against them.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

const MIGRATION_SQL = readFileSync(
  join(__dirname, '../../../packages/core-api/prisma/migrations/20271117000000_rename_default_entry_names/migration.sql'),
  'utf8',
);

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

async function seedContestWithTeams() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const owner = await createTestUser({ firstName: 'Rename', lastName: `Owner${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `REN${suffix.toUpperCase()}`, name: `Rename League ${suffix}`, iconKey: 'TROPHY' },
  });
  const team = await prisma.squad.create({ data: { leagueId: league.id, name: `Incubus ${suffix}`, createdBy: owner.user.id } });
  const otherTeam = await prisma.squad.create({ data: { leagueId: league.id, name: `Dead Left ${suffix}`, createdBy: owner.user.id } });
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, seasonYear: 2026, name: `Rename Contest ${suffix}`, status: 'OPEN', selectionType: 'TIERED' },
  });
  return { prisma, team, otherTeam, contest };
}

describe('renaming default entry names (#1564)', () => {
  it('renames "<team> Entry <n>" to "<team> <n>" and leaves names people chose untouched', async () => {
    const { prisma, team, otherTeam, contest } = await seedContestWithTeams();
    const oldDefault = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: team.id, entryNumber: 1, name: `${team.name} Entry 1` } });
    const secondOldDefault = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: team.id, entryNumber: 2, name: `${team.name} Entry 2` } });
    const custom = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: otherTeam.id, entryNumber: 1, name: 'Chalk All The Way' } });
    // The team was renamed after this entry took its default, so the name is no longer the default.
    const staleTeamName = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: otherTeam.id, entryNumber: 2, name: 'Old Team Name Entry 2' } });

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    const names = new Map((await prisma.contestEntry.findMany({ where: { contestId: contest.id } })).map((entry) => [entry.id, entry.name]));
    expect(names.get(oldDefault.id)).toBe(`${team.name} 1`);
    expect(names.get(secondOldDefault.id)).toBe(`${team.name} 2`);
    expect(names.get(custom.id)).toBe('Chalk All The Way');
    expect(names.get(staleTeamName.id)).toBe('Old Team Name Entry 2');
  });

  it('keeps the old default when the team already has another entry in the contest by the new name', async () => {
    const { prisma, team, contest } = await seedContestWithTeams();
    const oldDefault = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: team.id, entryNumber: 1, name: `${team.name} Entry 1` } });
    const takenName = await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: team.id, entryNumber: 2, name: `${team.name} 1` } });

    await prisma.$executeRawUnsafe(MIGRATION_SQL);

    expect((await prisma.contestEntry.findUniqueOrThrow({ where: { id: oldDefault.id } })).name).toBe(`${team.name} Entry 1`);
    expect((await prisma.contestEntry.findUniqueOrThrow({ where: { id: takenName.id } })).name).toBe(`${team.name} 1`);
  });
});
