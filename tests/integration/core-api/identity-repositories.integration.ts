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
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import {
  DateFormat,
  JoinPolicy,
  LeagueIconKey,
  LeagueRole,
  LeagueMembershipStatus,
  TimeFormat,
} from '@poolmaster/shared/domain';

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

  // #202 step 3.3 — the identifier lookup that was written out by hand FOUR times: login,
  // the registration collision check, and the two near-identical availability checks in
  // `account/service.ts`.
  describe('UserRepository.findByIdentifier', () => {
    it('resolves the same user by either email or username', async () => {
      const repo = new PrismaUserRepository(getPrisma());
      const marker = `ident${Date.now().toString(36)}`;
      const created = await createTestUser({ email: `${marker}@integration.test` });

      const byEmail = await repo.findByIdentifier(created.user.email);
      const byUsername = await repo.findByIdentifier(created.user.username);

      expect(byEmail?.id).toBe(created.user.id);
      expect(byUsername?.id).toBe(created.user.id);
    });

    it('finds a user whose USERNAME matches a string offered as an email, and vice versa', async () => {
      // This cross-column match is the whole point. Login accepts either, so a username
      // colliding with somebody else's email is just as unusable as a duplicate username —
      // which is why the availability check is one question, not two.
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);
      const marker = `cross${Date.now().toString(36)}`;
      const created = await createTestUser({ email: `${marker}@integration.test` });
      await prisma.user.update({
        where: { id: created.user.id },
        data: { username: `${marker}-name@integration.test` },
      });

      const found = await repo.findByIdentifier(`${marker}-name@integration.test`);

      expect(found?.id).toBe(created.user.id);
    });

    it('returns null for an identifier nobody holds', async () => {
      const repo = new PrismaUserRepository(getPrisma());

      await expect(repo.findByIdentifier(`nobody-${Date.now()}@integration.test`))
        .resolves.toBeNull();
    });
  });

  // #202 step 3.3 — the platform-lockout guard's count. Written inline three times in
  // `admin/user-service.ts` before this.
  describe('UserRepository.countActiveRootAdmins', () => {
    it('counts active root admins and nobody else', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(prisma);

      const before = await repo.countActiveRootAdmins();

      // A plain user must not move the count; an active root admin must move it by exactly one.
      await createTestUser({ lastName: 'NotAnAdmin' });
      expect(await repo.countActiveRootAdmins()).toBe(before);

      const admin = await createTestUser({ lastName: 'AnAdmin', isRootAdmin: true });
      expect(await repo.countActiveRootAdmins()).toBe(before + 1);

      // An inactive root admin does not count towards the active root admins the guard keeps.
      await prisma.user.update({ where: { id: admin.user.id }, data: { isActive: false } });
      expect(await repo.countActiveRootAdmins()).toBe(before);
    });
  });

  describe('UserRepository.update', () => {
    it('applies the given fields and leaves the rest alone', async () => {
      const repo = new PrismaUserRepository(getPrisma());
      const created = await createTestUser({ firstName: 'Before', lastName: 'Change' });

      const updated = await repo.update(created.user.id, { firstName: 'After' });

      expect(updated.firstName).toBe('After');
      expect(updated.lastName).toBe('Change');
      expect(updated.email).toBe(created.user.email);
    });

    it('CLEARS a nullable preference passed as null, and leaves one passed as undefined', async () => {
      // This is the case `UserUpdate` exists for. Under `Partial<User>` the optional
      // preferences are `string | undefined`, so "clear my timezone" was inexpressible — and
      // mapping a null through the enum Record returns undefined, which Prisma reads as "no
      // change", so a clear would have silently done nothing.
      const repo = new PrismaUserRepository(getPrisma());
      const created = await createTestUser({ lastName: 'Preferences' });

      const set = await repo.update(created.user.id, {
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: TimeFormat.TWELVE_HOUR,
        dateFormat: DateFormat.MDY,
      });
      expect(set).toMatchObject({
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: TimeFormat.TWELVE_HOUR,
        dateFormat: DateFormat.MDY,
      });

      const cleared = await repo.update(created.user.id, {
        timezone: null,
        timeFormat: null,
        dateFormat: null,
      });

      expect(cleared.timezone).toBeUndefined();
      expect(cleared.timeFormat).toBeUndefined();
      expect(cleared.dateFormat).toBeUndefined();
      // Not named in the update, so untouched.
      expect(cleared.locale).toBe('en-US');
    });

    it('never returns a password hash on the updated user', async () => {
      const repo = new PrismaUserRepository(getPrisma());
      const created = await createTestUser({ lastName: 'Hashless', password: 'TestPass123' });

      const updated = await repo.update(created.user.id, { firstName: 'Still' });

      expect(updated).not.toHaveProperty('passwordHash');
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

    it('omits a league the user was removed from, so a removed member no longer sees it in their leagues', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(prisma);
      const former = await createTestUser({ lastName: 'FormerMember' });

      const current = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B4`, 'Current');
      const left = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B5`, 'Left');
      for (const [leagueId, status] of [
        [current.id, LeagueMembershipStatus.ACTIVE],
        [left.id, LeagueMembershipStatus.INACTIVE],
      ] as const) {
        await prisma.leagueMembership.create({
          data: { leagueId, userId: former.user.id, role: LeagueRole.MEMBER, status },
        });
      }

      const ids = (await repo.findByUser(former.user.id)).map((league) => league.id);

      expect(ids).toEqual([current.id]);
    });
  });

  // #202 — new in step 3.3, backing the admin league list. Asserted against a real
  // database because it is a grouped query: the FAPI suite proves the league list still
  // responds, but asserts nothing about the counts themselves.
  describe('LeagueMembershipRepository.countActiveByLeagues', () => {
    it('counts active members per league and omits leagues with none', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueMembershipRepository(prisma);

      const busy = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}D1`, 'Busy');
      const quiet = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}D2`, 'Quiet');

      const [a, b, c] = await Promise.all([
        createTestUser({ lastName: 'CountA' }),
        createTestUser({ lastName: 'CountB' }),
        createTestUser({ lastName: 'CountC' }),
      ]);

      for (const user of [a, b]) {
        await prisma.leagueMembership.create({
          data: {
            leagueId: busy.id,
            userId: user.user.id,
            role: LeagueRole.MEMBER,
            status: LeagueMembershipStatus.ACTIVE,
          },
        });
      }
      // Inactive membership must NOT be counted.
      await prisma.leagueMembership.create({
        data: {
          leagueId: busy.id,
          userId: c.user.id,
          role: LeagueRole.MEMBER,
          status: LeagueMembershipStatus.INACTIVE,
        },
      });

      const counts = await repo.countActiveByLeagues([busy.id, quiet.id]);

      expect(counts.get(busy.id)).toBe(2);
      // Absent rather than present with 0 — the caller defaults it.
      expect(counts.has(quiet.id)).toBe(false);
    });

    it('returns an empty map for no league ids, without querying', async () => {
      const repo = new PrismaLeagueMembershipRepository(getPrisma());

      await expect(repo.countActiveByLeagues([])).resolves.toEqual(new Map());
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
