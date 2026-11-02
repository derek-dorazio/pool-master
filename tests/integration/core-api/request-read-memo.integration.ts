import { randomUUID } from 'node:crypto';
import { LeagueMembershipStatus, LeaguePlan, LeagueRole } from '@poolmaster/shared/domain';
import {
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaMembershipTransaction,
  PrismaSquadRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { LeagueService } from '../../../packages/core-api/src/modules/leagues/service';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { PasswordChangedNotifier } from '../../../packages/core-api/src/modules/auth/password-changed-notifier';
import { EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';
import { emailServiceInto } from '../../support/email-service';
import { runWithReadMemo } from '../../../packages/core-api/src/core/request-read-memo';
import {
  cleanupTestData,
  createTestUser,
  getAppPrisma,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
} from '../helpers';

// The request read memo against Postgres (#1176, #1355): within one request the league, a member's
// membership, a user and a team are read once and shared, a write through the repository is seen
// by the next read, and a transaction's own client always reads the database.

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

async function seedSquad(leagueId: string, createdBy: string) {
  return getPrisma().squad.create({ data: { leagueId, createdBy, name: `Memo Team ${randomUUID().slice(0, 8)}`, iconKey: 'CAPTAIN_SMILE_FIELD' } });
}

function userService(users: PrismaUserRepository): UserService {
  const email = emailServiceInto();
  const appBaseUrl = 'https://app.example.test';
  return new UserService(
    users,
    getAppPrisma(),
    new PasswordChangedNotifier(users, email, appBaseUrl),
    new EmailChangeUndoService({ users, prisma: getAppPrisma(), email, appBaseUrl }),
  );
}

describe('request read memo with the Prisma repositories (#1176)', () => {
  it('reads the league and the membership once per request, and afresh in the next request', async () => {
    const { league, user } = await seedLeague();
    const leagues = new PrismaLeagueRepository(getAppPrisma());
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());

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
    const leagues = new PrismaLeagueRepository(getAppPrisma());
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());

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
    const prisma = getAppPrisma();
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());

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
    const leagues = new PrismaLeagueRepository(getAppPrisma());

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
    const prisma = getAppPrisma();
    const leagues = new PrismaLeagueRepository(getAppPrisma());
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());
    const service = new LeagueService({ leagues, memberships, users: new PrismaUserRepository(getAppPrisma()), prisma });

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
    const memberships = new PrismaLeagueMembershipRepository(getAppPrisma());

    const after = await runWithReadMemo(async () => {
      await new PrismaMembershipTransaction(getAppPrisma()).run(async (repos) => {
        await repos.leagueMemberships.update(membership.id, { status: LeagueMembershipStatus.INACTIVE });
        // Outside the transaction, so it sees the row as it was before the write.
        await memberships.findByLeagueAndUser(league.id, user.id);
      });
      return memberships.findByLeagueAndUser(league.id, user.id);
    });

    expect(after?.status).toBe(LeagueMembershipStatus.INACTIVE);
  });

  it('reads a user and a team once per request (#1355)', async () => {
    const { league, user } = await seedLeague();
    const squad = await seedSquad(league.id, user.id);
    const users = new PrismaUserRepository(getAppPrisma());
    const squads = new PrismaSquadRepository(getAppPrisma());

    const first = await runWithReadMemo(async () => ({
      user: [await users.findById(user.id), await users.findById(user.id)],
      squad: [await squads.findById(squad.id), await squads.findById(squad.id)],
    }));

    expect(first.user[0]?.id).toBe(user.id);
    expect(first.user[1]).toBe(first.user[0]);
    expect(first.squad[0]?.id).toBe(squad.id);
    expect(first.squad[1]).toBe(first.squad[0]);
  });

  it('sees a user and a team renamed earlier in the same request through their repositories (#1355)', async () => {
    const { league, user } = await seedLeague();
    const squad = await seedSquad(league.id, user.id);
    const users = new PrismaUserRepository(getAppPrisma());
    const squads = new PrismaSquadRepository(getAppPrisma());

    const after = await runWithReadMemo(async () => {
      await users.findById(user.id);
      await squads.findById(squad.id);
      await users.update(user.id, { firstName: 'Renamed' });
      await squads.update(squad.id, { name: 'Renamed Team' });
      return { user: await users.findById(user.id), squad: await squads.findById(squad.id) };
    });

    expect(after.user?.firstName).toBe('Renamed');
    expect(after.squad?.name).toBe('Renamed Team');
  });

  it('answers a disabled account as inactive when the same request read it before disabling it (#1355)', async () => {
    const { user } = await seedLeague();
    const { user: admin } = await createTestUser({ isRootAdmin: true });
    const users = new PrismaUserRepository(getAppPrisma());

    const disabled = await runWithReadMemo(async () => {
      await users.findById(user.id);
      return userService(users).disableUser({ userId: admin.id, isRootAdmin: true }, user.id);
    });

    expect(disabled.isActive).toBe(false);
  });

  it('forgets a team read during a membership transaction once the transaction commits (#1355)', async () => {
    const { league, user } = await seedLeague();
    const squad = await seedSquad(league.id, user.id);
    const squads = new PrismaSquadRepository(getAppPrisma());

    const after = await runWithReadMemo(async () => {
      await new PrismaMembershipTransaction(getAppPrisma()).run(async (repos) => {
        await repos.squads.update(squad.id, { isActive: false });
        // Outside the transaction, so it sees the row as it was before the write.
        await squads.findById(squad.id);
      });
      return squads.findById(squad.id);
    });

    expect(after?.isActive).toBe(false);
  });
});
