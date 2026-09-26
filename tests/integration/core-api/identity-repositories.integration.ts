/**
 * #202 step 3.2 — the identity-cluster repository ports added because their absence is
 * what sent `admin/user-service.ts` and `account/service.ts` to raw Prisma (§2y).
 *
 * `UserRepository` had NO implementation at all before this: the port was declared and
 * exported with zero adapters and zero consumers. These are the first tests it has had.
 *
 * Each access rule from docs/DOMAIN-OPERATIONS.md that motivated a method is asserted
 * here, because "the port exists" was exactly the state that produced the problem.
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import {
  PrismaLeagueRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { JoinPolicy, LeagueIconKey, LeagueRole, LeagueMembershipStatus } from '@poolmaster/shared/domain';

const LEAGUE_CODE_PREFIX = 'IDREPO';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.leagueMembership.deleteMany({
    where: { league: { leagueCode: { startsWith: LEAGUE_CODE_PREFIX } } },
  });
  await prisma.league.deleteMany({
    where: { leagueCode: { startsWith: LEAGUE_CODE_PREFIX } },
  });
  await teardownIntegrationTests();
});

async function createLeague(prisma: ReturnType<typeof getPrisma>, code: string, name: string, isActive = true) {
  return prisma.league.create({
    data: {
      leagueCode: code,
      name,
      isActive,
      iconKey: LeagueIconKey.TROPHY,
      joinPolicy: JoinPolicy.COMMISSIONER_ONLY,
    },
  });
}

describe('identity cluster repositories (#202)', () => {
  describe('UserRepository.findAll — the unscoped read (A1)', () => {
    it('matches the search term across email, username, firstName and lastName', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `zzq${Date.now().toString(36)}`;

      const byLastName = await createTestUser({ lastName: `Sur${marker}` });
      const byFirstName = await createTestUser({ firstName: `Fore${marker}` });
      const byEmail = await createTestUser({ email: `mail${marker}@integration.test` });

      const users = await repo.findAll({ search: marker });

      const ids = users.map((user) => user.id);
      expect(ids).toContain(byLastName.user.id);
      expect(ids).toContain(byFirstName.user.id);
      expect(ids).toContain(byEmail.user.id);
    });

    it('matches case-insensitively', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `Mixed${Date.now().toString(36)}`;
      const created = await createTestUser({ lastName: marker });

      const users = await repo.findAll({ search: marker.toUpperCase() });

      expect(users.map((user) => user.id)).toContain(created.user.id);
    });

    it('returns every match, unpaged', async () => {
      // §16 — the API does not page. A filter narrows the set; nothing slices it.
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `all${Date.now().toString(36)}`;
      await createTestUser({ lastName: marker });
      await createTestUser({ lastName: marker });
      await createTestUser({ lastName: marker });

      const users = await repo.findAll({ search: marker });

      expect(users).toHaveLength(3);
    });

    it('filters on isActive', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `act${Date.now().toString(36)}`;
      const active = await createTestUser({ lastName: marker });
      const inactive = await createTestUser({ lastName: marker });
      await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });

      const activeOnly = await repo.findAll({ search: marker, isActive: true });
      const inactiveOnly = await repo.findAll({ search: marker, isActive: false });

      expect(activeOnly.map((user) => user.id)).toEqual([active.user.id]);
      expect(inactiveOnly.map((user) => user.id)).toEqual([inactive.user.id]);
    });

    it('never returns a password hash on the domain user', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `secret${Date.now().toString(36)}`;
      await createTestUser({ lastName: marker, password: 'TestPass123' });

      const users = await repo.findAll({ search: marker });

      expect(users).toHaveLength(1);
      expect(users[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('UserRepository.findByLeague — the scoped peer read (A4 + A6)', () => {
    it('returns only users sharing the given league', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);

      const insider = await createTestUser({ lastName: 'Insider' });
      const peer = await createTestUser({ lastName: 'Peer' });
      const outsider = await createTestUser({ lastName: 'Outsider' });

      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}A1`, 'Scoped Read League');
      const otherLeague = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}A2`, 'Other League');

      for (const userId of [insider.user.id, peer.user.id]) {
        await prisma.leagueMembership.create({
          data: {
            leagueId: league.id,
            userId,
            role: LeagueRole.MEMBER,
            status: LeagueMembershipStatus.ACTIVE,
          },
        });
      }
      await prisma.leagueMembership.create({
        data: {
          leagueId: otherLeague.id,
          userId: outsider.user.id,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
        },
      });

      const users = await repo.findByLeague(league.id);
      const ids = users.map((user) => user.id);

      expect(ids).toContain(insider.user.id);
      expect(ids).toContain(peer.user.id);
      // This is the scoping guarantee A6 depends on.
      expect(ids).not.toContain(outsider.user.id);
    });

    it('carries the fields a member roster needs', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const member = await createTestUser({ firstName: 'Roster', lastName: 'Member' });
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}A3`, 'Roster League');
      await prisma.leagueMembership.create({
        data: {
          leagueId: league.id,
          userId: member.user.id,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.ACTIVE,
        },
      });

      const [user] = await repo.findByLeague(league.id);

      expect(user).toMatchObject({
        id: member.user.id,
        email: member.user.email,
        firstName: 'Roster',
        lastName: 'Member',
      });
    });

    it('includes inactive memberships, leaving the status filter to the caller', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const former = await createTestUser({ lastName: 'Former' });
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}A4`, 'Inactive Membership League');
      await prisma.leagueMembership.create({
        data: {
          leagueId: league.id,
          userId: former.user.id,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.INACTIVE,
        },
      });

      const users = await repo.findByLeague(league.id);

      expect(users.map((user) => user.id)).toContain(former.user.id);
    });
  });

  describe('LeagueRepository.findByUser — the scoped league read (A2)', () => {
    it('returns only leagues the user is a member of', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(prisma);
      const member = await createTestUser({ lastName: 'LeagueMember' });

      const mine = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B1`, 'Mine');
      const alsoMine = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B2`, 'Also Mine');
      const notMine = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B3`, 'Not Mine');

      for (const leagueId of [mine.id, alsoMine.id]) {
        await prisma.leagueMembership.create({
          data: {
            leagueId,
            userId: member.user.id,
            role: LeagueRole.MEMBER,
            status: LeagueMembershipStatus.ACTIVE,
          },
        });
      }

      const leagues = await repo.findByUser(member.user.id);
      const ids = leagues.map((league) => league.id);

      expect(ids).toContain(mine.id);
      expect(ids).toContain(alsoMine.id);
      expect(ids).not.toContain(notMine.id);
    });

    it('returns an empty list for a user with no memberships', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(prisma);
      const loner = await createTestUser({ lastName: 'Loner' });

      expect(await repo.findByUser(loner.user.id)).toEqual([]);
    });
  });

  describe('LeagueRepository.findAll — the unscoped read (A1)', () => {
    it('filters by name search and isActive, and returns everything when unfiltered', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(prisma);
      const marker = `Findable${Date.now().toString(36)}`;

      const activeLeague = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C1`, `${marker} Active`, true);
      const inactiveLeague = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C2`, `${marker} Inactive`, false);

      const searched = await repo.findAll({ search: marker });
      expect(searched.map((league) => league.id).sort())
        .toEqual([activeLeague.id, inactiveLeague.id].sort());

      const activeOnly = await repo.findAll({ search: marker, isActive: true });
      expect(activeOnly.map((league) => league.id)).toEqual([activeLeague.id]);

      // Unfiltered is the unscoped read A1 reserves for rootAdmin.
      const all = await repo.findAll();
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    it('matches the league name case-insensitively', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(prisma);
      const marker = `CaseLeague${Date.now().toString(36)}`;
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C3`, marker);

      const found = await repo.findAll({ search: marker.toLowerCase() });

      expect(found.map((row) => row.id)).toContain(league.id);
    });
  });
});
