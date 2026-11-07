import { randomUUID } from 'node:crypto';
import { LeagueMembershipStatus, LeagueRole } from '@poolmaster/shared/domain';
import {
  PrismaContestRepository,
  PrismaLeagueInvitationRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaMembershipTransaction,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { InvitationService } from '../../../packages/core-api/src/modules/leagues/invitation-service';
import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import { LeagueMembershipCache } from '../../../packages/core-api/src/core/league-membership-cache';
import { runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';
import { recordStatements } from '../statement-log';

/** `call`'s result and how many statements it sent to the league memberships table. */
async function countMembershipReads<T>(call: () => Promise<T>): Promise<{ count: number; result: T }> {
  const { result, statements } = await recordStatements(call);
  return { result, count: statements.filter((s) => s.sql.includes('"league_memberships"')).length };
}

// The league membership cache against Postgres (#1438). Each API task keeps its own cache, so
// a test stands up two tasks as two repositories with their own caches over one database. An
// ACTIVE membership is kept for 30 seconds; "not a member" is never kept, so a user one task
// turned away who then joins through another task is let in by the first on the next request.

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});
beforeEach(async () => {
  await cleanupTestData();
});

async function seedLeague() {
  const prisma = getPrisma();
  const suffix = randomUUID().slice(0, 8).toUpperCase();
  const { user: commissioner } = await createTestUser({ displayName: `Cache Commissioner ${suffix}` });
  const { user: joiner } = await createTestUser({ displayName: `Cache Joiner ${suffix}` });
  const league = await prisma.league.create({ data: { cupName: 'Cache Cup', leagueCode: `MCACHE${suffix}`, name: `Cache ${suffix}` } });
  const commissionerMembership = await prisma.leagueMembership.create({
    data: { leagueId: league.id, userId: commissioner.id, role: LeagueRole.COMMISSIONER, status: LeagueMembershipStatus.ACTIVE },
  });
  return { league, commissioner, joiner, commissionerMembershipId: commissionerMembership.id };
}

/** One API task: its own cache, and its own repositories over the shared database. */
function task() {
  const cache = new LeagueMembershipCache(30_000);
  return {
    cache,
    memberships: new PrismaLeagueMembershipRepository(getAppPrisma(), cache),
    transaction: new PrismaMembershipTransaction(getAppPrisma(), cache),
  };
}

/** One request on a task: its own read memo, as the request hook gives it. */
function request<T>(work: () => Promise<T>): Promise<T> {
  return runWithReadMemo(work);
}

describe('league membership cache: "not a member" is never kept', () => {
  it('lets a user in on their next request after they join, when the same task turned them away', async () => {
    const { league, joiner } = await seedLeague();
    const a = task();

    const refused = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
    await request(() => a.memberships.create({
      leagueId: league.id, userId: joiner.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE, joinedAt: new Date(),
    }));
    const next = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));

    expect(refused).toBeNull();
    expect(next?.status).toBe(LeagueMembershipStatus.ACTIVE);
  });

  it('lets a user in on their next request after they join through another task, when this task turned them away', async () => {
    const { league, joiner } = await seedLeague();
    const a = task();
    const b = task();

    const refused = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
    await request(() => b.transaction.run((repos) => repos.leagueMemberships.create({
      leagueId: league.id, userId: joiner.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE, joinedAt: new Date(),
    })));
    const next = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));

    expect(refused).toBeNull();
    expect(next?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(next?.userId).toBe(joiner.id);
  });

  it('lets a member who left back in on their next request after they rejoin through another task', async () => {
    const { league, joiner } = await seedLeague();
    const row = await getPrisma().leagueMembership.create({
      data: { leagueId: league.id, userId: joiner.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.INACTIVE },
    });
    const a = task();
    const b = task();

    const inactive = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
    await request(() => b.memberships.update(row.id, { status: LeagueMembershipStatus.ACTIVE }));
    const next = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));

    expect(inactive?.status).toBe(LeagueMembershipStatus.INACTIVE);
    expect(next?.status).toBe(LeagueMembershipStatus.ACTIVE);
  });

  it('reads the database on every request for a user who is not a member', async () => {
    const { league, joiner } = await seedLeague();
    const a = task();

    const { count } = await countMembershipReads(async () => {
      await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
      await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
      await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
    });

    expect(count).toBe(3);
  });
});

describe('league membership cache: an active membership is kept', () => {
  it('answers later requests on the same task from the cache, one read in all', async () => {
    const { league, commissioner } = await seedLeague();
    const a = task();

    const { count, result } = await countMembershipReads(async () => [
      await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id)),
      await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id)),
      await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id)),
    ]);

    expect(count).toBe(1);
    expect(result.every((m) => m?.role === LeagueRole.COMMISSIONER)).toBe(true);
  });

  it('keeps granting the old role on another task until its 30 seconds pass, as accepted for a removal or role change made elsewhere', async () => {
    const { league, commissioner, commissionerMembershipId } = await seedLeague();
    let nowMs = Date.now();
    const aCache = new LeagueMembershipCache(30_000, () => new Date(nowMs));
    const a = new PrismaLeagueMembershipRepository(getAppPrisma(), aCache);
    const b = task();

    await request(() => a.findByLeagueAndUser(league.id, commissioner.id));
    await request(() => b.memberships.update(commissionerMembershipId, { role: LeagueRole.MEMBER }));

    const withinTtl = await request(() => a.findByLeagueAndUser(league.id, commissioner.id));
    nowMs += 30_000;
    const afterTtl = await request(() => a.findByLeagueAndUser(league.id, commissioner.id));

    expect(withinTtl?.role).toBe(LeagueRole.COMMISSIONER);
    expect(afterTtl?.role).toBe(LeagueRole.MEMBER);
  });
});

describe('league membership cache: a task forgets on its own writes', () => {
  it('sees a role change this task made on the next request', async () => {
    const { league, commissioner, commissionerMembershipId } = await seedLeague();
    const a = task();
    await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));

    await request(() => a.memberships.update(commissionerMembershipId, { role: LeagueRole.MEMBER }));
    const after = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));

    expect(after?.role).toBe(LeagueRole.MEMBER);
  });

  it('turns away a member this task removed on their next request', async () => {
    const { league, commissioner, commissionerMembershipId } = await seedLeague();
    const a = task();
    await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));

    await request(() => a.transaction.run((repos) => repos.leagueMemberships.update(commissionerMembershipId, { status: LeagueMembershipStatus.INACTIVE })));
    const after = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));

    expect(after?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('does not keep the row from before a membership transaction committed, read while it ran', async () => {
    const { league, commissioner, commissionerMembershipId } = await seedLeague();
    const a = task();
    await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));
    a.cache.forget(league.id, commissioner.id);

    const seen: { during?: Awaited<ReturnType<typeof a.memberships.findByLeagueAndUser>> } = {};
    await a.transaction.run(async (repos) => {
      await repos.leagueMemberships.update(commissionerMembershipId, { role: LeagueRole.MEMBER });
      // Another request on this task, outside the transaction, still sees the committed row.
      seen.during = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));
    });
    const after = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));

    expect(seen.during?.role).toBe(LeagueRole.COMMISSIONER);
    expect(after?.role).toBe(LeagueRole.MEMBER);
  });
});

describe('league membership cache: a check that decides a write reads fresh', () => {
  it('lets a member who left on another task accept a new invite on this task at once, not "already a member"', async () => {
    const { league, commissioner, joiner } = await seedLeague();
    const row = await getPrisma().leagueMembership.create({
      data: { leagueId: league.id, userId: joiner.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE },
    });
    const invite = await getPrisma().leagueInvitation.create({
      data: { leagueId: league.id, inviteCode: `CACHE${randomUUID().slice(0, 8)}`, inviteType: 'LINK', maxUses: 0, invitedBy: commissioner.id },
    });
    const a = task();
    const b = task();
    const invitations = new InvitationService({
      invitations: new PrismaLeagueInvitationRepository(getAppPrisma()),
      memberships: a.memberships,
      leagues: new PrismaLeagueRepository(getAppPrisma()),
      users: new PrismaUserRepository(getAppPrisma()),
      contests: new PrismaContestRepository(getAppPrisma()),
      memberJoined: { tellJoined: async () => undefined },
    });

    const cachedOnA = await request(() => a.memberships.findByLeagueAndUser(league.id, joiner.id));
    await request(() => b.memberships.update(row.id, { status: LeagueMembershipStatus.INACTIVE }));
    const rejoined = await request(() => invitations.acceptInvitation(invite.inviteCode, joiner.id));

    expect(cachedOnA?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(rejoined.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(rejoined.id).toBe(row.id);
  });

  it('answers a fresh read from the database while the cache still holds the row from before another task\'s removal', async () => {
    const { league, commissioner, commissionerMembershipId } = await seedLeague();
    const a = task();
    const b = task();
    await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));
    await request(() => b.memberships.update(commissionerMembershipId, { status: LeagueMembershipStatus.INACTIVE }));

    const cached = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id));
    const fresh = await request(() => a.memberships.findByLeagueAndUser(league.id, commissioner.id, { fresh: true }));

    expect(cached?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(fresh?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });
});

describe('league membership cache: deleting a league', () => {
  it('forgets every member of the deleted league kept by this task\'s cache', async () => {
    const { league, commissioner } = await seedLeague();
    await getPrisma().league.update({ where: { id: league.id }, data: { isActive: false } });
    const before = await request(() => new PrismaLeagueMembershipRepository(getAppPrisma()).findByLeagueAndUser(league.id, commissioner.id));
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());
    const service = new LeagueService({
      leagues: new PrismaLeagueRepository(getAppPrisma()),
      memberships,
      users: new PrismaUserRepository(getAppPrisma()),
      prisma: getAppPrisma(),
    });

    await request(() => service.deleteInactiveLeague(league.id, league.leagueCode));
    const after = await request(() => memberships.findByLeagueAndUser(league.id, commissioner.id));

    expect(before?.status).toBe(LeagueMembershipStatus.ACTIVE);
    expect(after).toBeNull();
  });
});
