import { randomUUID } from 'node:crypto';
import { LeagueMembershipStatus, LeaguePlan, LeagueRole } from '@poolmaster/shared/domain';
import {
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaMembershipTransaction,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import { runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import {
  cleanupTestData,
  createTestUser,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// The request read memo against Postgres (#1176): within one request the league and a member's
// membership are read once and shared, a write through the repository is seen by the next read,
// and a transaction's own client always reads the database.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

async function seedLeague(isActive = true) {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const { user } = await createTestUser({ displayName: `Memo ${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Memo Cup', leagueCode: `MEMO${suffix}`, name: `Memo ${suffix}`, isActive } });
  const membership = await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: user.id, role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE },
  });
  return { league, user, membership };
}

describe('request read memo with the Prisma repositories (#1176)', () => {
  it('reads the league and the membership once per request, and afresh in the next request', async () => {
    const { league, user } = await seedLeague();
    const leagues = new PrismaLeagueRepository(getPrisma());
    const memberships = new PrismaLeagueMembershipRepository(getPrisma());

    const first = await runWithReadMemo(async () => ({
      league: [await leagues.findById(league.id), await leagues.findById(league.id)],
      membership: [await memberships.findByLeagueAndUser(league.id, user.id), await memberships.findByLeagueAndUser(league.id, user.id)],
    }));
    const next = await runWithReadMemo(() => leagues.findById(league.id));

    expect(first.league[1]).toBe(first.league[0]);
    expect(first.membership[1]).toBe(first.membership[0]);
    expect(next).not.toBe(first.league[0]);
    expect(next).toEqual(first.league[0]);
  });

  it('sees a write made earlier in the same request through the repository', async () => {
    const { league, user, membership } = await seedLeague();
    const leagues = new PrismaLeagueRepository(getPrisma());
    const memberships = new PrismaLeagueMembershipRepository(getPrisma());

    const after = await runWithReadMemo(async () => {
      await leagues.findById(league.id);
      await memberships.findByLeagueAndUser(league.id, user.id);
      await leagues.update(league.id, { cupName: 'Renamed Cup' });
      await memberships.update(membership.id, { status: LeagueMembershipStatus.INACTIVE });
      return {
        league: await leagues.findById(league.id),
        membership: await memberships.findByLeagueAndUser(league.id, user.id),
      };
    });

    expect(after.league?.cupName).toBe('Renamed Cup');
    expect(after.membership?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('never answers a transaction\'s read from the request\'s memo', async () => {
    const { league, user } = await seedLeague();
    const prisma = getPrisma();
    const memberships = new PrismaLeagueMembershipRepository(prisma);

    const inside = await runWithReadMemo(async () => {
      const before = await memberships.findByLeagueAndUser(league.id, user.id);
      return prisma.$transaction(async (tx) => {
        await tx.leagueMembership.update({ where: { leagueId_userId: { leagueId: league.id, userId: user.id } }, data: { role: LeagueRole.MEMBER } });
        const read = await new PrismaLeagueMembershipRepository(tx).findByLeagueAndUser(league.id, user.id);
        return { before, read };
      });
    });

    expect(inside.before?.role).toBe(LeagueRole.COMMISSIONER);
    expect(inside.read?.role).toBe(LeagueRole.MEMBER);
  });

  it('sees a plan change made earlier in the same request', async () => {
    const { league, user } = await seedLeague();
    const leagues = new PrismaLeagueRepository(getPrisma());

    const after = await runWithReadMemo(async () => {
      const before = await leagues.findById(league.id);
      await leagues.changePlan(league.id, { fromPlan: LeaguePlan.PREMIUM, toPlan: LeaguePlan.PRO, changedById: user.id });
      return { before, after: await leagues.findById(league.id) };
    });

    expect(after.before?.plan).toBe(LeaguePlan.PREMIUM);
    expect(after.after?.plan).toBe(LeaguePlan.PRO);
  });

  it('reads no league and no membership after the request deletes the league', async () => {
    const { league, user } = await seedLeague(false);
    const prisma = getPrisma();
    const leagues = new PrismaLeagueRepository(prisma);
    const memberships = new PrismaLeagueMembershipRepository(prisma);
    const service = new LeagueService({ leagues, memberships, users: new PrismaUserRepository(prisma), prisma });

    const after = await runWithReadMemo(async () => {
      await leagues.findById(league.id);
      await memberships.findByLeagueAndUser(league.id, user.id);
      await service.deleteInactiveLeague(league.id, league.leagueCode);
      return {
        league: await leagues.findById(league.id),
        membership: await memberships.findByLeagueAndUser(league.id, user.id),
      };
    });

    expect(after).toEqual({ league: null, membership: null });
  });

  it('forgets a membership read during a membership transaction once the transaction commits', async () => {
    const { league, user, membership } = await seedLeague();
    const prisma = getPrisma();
    const memberships = new PrismaLeagueMembershipRepository(prisma);

    const after = await runWithReadMemo(async () => {
      await new PrismaMembershipTransaction(prisma).run(async (repos) => {
        await repos.leagueMemberships.update(membership.id, { status: LeagueMembershipStatus.INACTIVE });
        // Outside the transaction, so it sees the row as it was before the write.
        await memberships.findByLeagueAndUser(league.id, user.id);
      });
      return memberships.findByLeagueAndUser(league.id, user.id);
    });

    expect(after?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });
});
