/**
 * The shared `cleanupTestData` each suite runs in its `afterAll`. Integration suites share one
 * database, so whatever a suite leaves behind is seen by every suite after it: a contest left in a
 * league no cleanup arm matches made abandoned-draft retention count rows it never seeded.
 */
import { randomUUID } from 'node:crypto';
import { cleanupTestData, createTestUser, getPrisma, setupIntegrationTests, teardownIntegrationTests } from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('cleanupTestData', () => {
  it('deletes a league a test inserted with no members, with its teams, contests and entries', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const owner = await createTestUser({ firstName: 'Cleanup', lastName: `Owner${suffix}` });
    // An unlisted league code and no membership: the shape a suite gets from `prisma.league.create`.
    const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `NOMEM${suffix.toUpperCase()}`, name: `No Members ${suffix}` } });
    const team = await prisma.squad.create({ data: { leagueId: league.id, name: `Team ${suffix}`, createdBy: owner.user.id } });
    const contest = await prisma.contest.create({
      data: { leagueId: league.id, seasonYear: 2026, name: `Contest ${suffix}`, status: 'OPEN', selectionType: 'TIERED' },
    });
    await prisma.contestEntry.create({ data: { contestId: contest.id, squadId: team.id, entryNumber: 1, name: `${team.name} 1` } });

    await cleanupTestData();

    await expect(prisma.league.count({ where: { id: league.id } })).resolves.toBe(0);
    await expect(prisma.squad.count({ where: { id: team.id } })).resolves.toBe(0);
    await expect(prisma.contest.count({ where: { id: contest.id } })).resolves.toBe(0);
    await expect(prisma.contestEntry.count({ where: { contestId: contest.id } })).resolves.toBe(0);
  });

  it('deletes a league whose members are all test users', async () => {
    const prisma = getPrisma();
    const suffix = randomUUID().slice(0, 8);
    const commissioner = await createTestUser({ firstName: 'Cleanup', lastName: `Commissioner${suffix}` });
    const league = await prisma.league.create({ data: { cupName: 'Test Cup', leagueCode: `ONEMEM${suffix.toUpperCase()}`, name: `One Member ${suffix}` } });
    await prisma.leagueMembership.create({ data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER', status: 'ACTIVE' } });

    await cleanupTestData();

    await expect(prisma.league.count({ where: { id: league.id } })).resolves.toBe(0);
  });
});
