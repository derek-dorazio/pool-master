/**
 * Deletes that remove contest entries take the contest row lock before touching any entry
 * (#646), the same lock a random draw and an entry write take first (#644). With one lock
 * order, a delete racing a draw waits for it, or makes it refuse as entries changed, instead
 * of failing on a foreign key or deadlocking.
 *
 * Each test holds the contest row as a draw would, starts the delete, waits until it is
 * blocked, and checks from inside the holder that the contest's entries are still untouched.
 */
import { randomUUID } from 'node:crypto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';
import { contestEntriesFree, holdContestLocks, waitUntilBlockedBy } from '../contest-lock';
import { PrismaContestRepository } from '../../../packages/core-api/src/adapters';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

/** An inactive league whose commissioner's inactive team holds one entry in one open contest. */
async function seedLeagueWithEntry() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8);
  const commissioner = await createTestUser({ firstName: 'Lock', lastName: `Commish${suffix}` });
  const league = await prisma.league.create({
    data: { cupName: 'Test Cup', leagueCode: `LCK${suffix.toUpperCase()}`, name: `Lock League ${suffix}`, iconKey: 'TROPHY', isActive: false },
  });
  await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: commissioner.user.id, role: 'COMMISSIONER', status: 'ACTIVE', joinedAt: new Date() },
  });
  const squad = await prisma.squad.create({
    data: { leagueId: league.id, name: `Lock Team ${suffix}`, createdBy: commissioner.user.id, isActive: false },
  });
  const contest = await prisma.contest.create({
    data: { leagueId: league.id, seasonYear: 2026, name: `Lock Contest ${suffix}`, status: 'OPEN', selectionType: 'RANDOM_DRAW' },
  });
  const entry = await prisma.contestEntry.create({
    data: { contestId: contest.id, squadId: squad.id, entryNumber: 1, name: `Lock Entry ${suffix}` },
  });
  return { commissioner, league, squad, contest, entry };
}

describe('deleting entries while a draw holds the contest', () => {
  it('makes a team delete wait on the contest row before touching its entries, then delete the team', async () => {
    const prisma = getPrisma();
    const seeded = await seedLeagueWithEntry();
    const admin = await createTestUser({ isRootAdmin: true });

    const holder = holdContestLocks<boolean>(prisma, [seeded.contest.id]);
    const holderPid = await holder.ready;
    const response = getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.squads.detail(seeded.league.id, seeded.squad.id),
      headers: withoutJsonBodyHeaders(admin.headers),
    });
    let entriesFree: boolean | undefined;
    await waitUntilBlockedBy(prisma, holderPid).finally(async () => {
      entriesFree = await holder.release((tx) => contestEntriesFree(tx, seeded.contest.id));
    });

    expect(entriesFree).toBe(true);
    expect((await response).statusCode).toBe(200);
    await expect(prisma.contestEntry.count({ where: { id: seeded.entry.id } })).resolves.toBe(0);
  });

  it('makes a league delete wait on its contests\' rows before touching any entry, then delete the league', async () => {
    const prisma = getPrisma();
    const seeded = await seedLeagueWithEntry();

    const holder = holdContestLocks<boolean>(prisma, [seeded.contest.id]);
    const holderPid = await holder.ready;
    const response = getApp().inject({
      method: 'DELETE',
      url: API_ROUTES.leagues.detail(seeded.league.id),
      headers: seeded.commissioner.headers,
      payload: { leagueCode: seeded.league.leagueCode },
    });
    let entriesFree: boolean | undefined;
    await waitUntilBlockedBy(prisma, holderPid).finally(async () => {
      entriesFree = await holder.release((tx) => contestEntriesFree(tx, seeded.contest.id));
    });

    expect(entriesFree).toBe(true);
    expect((await response).statusCode).toBe(200);
    await expect(prisma.league.count({ where: { id: seeded.league.id } })).resolves.toBe(0);
  });

  it('makes a contest delete wait on the contest row before touching its entries, then delete the contest', async () => {
    const prisma = getPrisma();
    const seeded = await seedLeagueWithEntry();

    const holder = holdContestLocks<boolean>(prisma, [seeded.contest.id]);
    const holderPid = await holder.ready;
    const deleted = new PrismaContestRepository(prisma).delete(seeded.contest.id);
    let entriesFree: boolean | undefined;
    await waitUntilBlockedBy(prisma, holderPid).finally(async () => {
      entriesFree = await holder.release((tx) => contestEntriesFree(tx, seeded.contest.id));
    });

    expect(entriesFree).toBe(true);
    await deleted;
    await expect(prisma.contest.count({ where: { id: seeded.contest.id } })).resolves.toBe(0);
  });
});
