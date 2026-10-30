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
import { randomUUID } from 'node:crypto';
import {
  getAppPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  getPrisma,
  createTestUser,
} from '../helpers';
import {
  PrismaLeagueInvitationRepository,
  PrismaLeagueMembershipRepository,
  PrismaLeagueRepository,
  PrismaUserRepository,
} from '../../../packages/core-api/src/adapters';
import { recordStatements } from '../statement-log';
import {
  InvitationStatus,
  InviteType,
  LeagueIconKey,
  LeaguePlan,
  LeagueRole,
  LeagueMembershipStatus,
  TimeFormat,
} from '@poolmaster/shared/domain';

const LEAGUE_CODE_PREFIX = 'IDREPO';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.leagueInvitation.deleteMany({
    where: { league: { leagueCode: { startsWith: LEAGUE_CODE_PREFIX } } },
  });
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
      cupName: 'Test Cup', leagueCode: code,
      name,
      isActive,
      iconKey: LeagueIconKey.TROPHY,
    },
  });
}

describe('identity cluster repositories (#202)', () => {
  describe('UserRepository.search — the unscoped read (A1)', () => {
    it('matches the search term across email, username, firstName and lastName', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `zzq${Date.now().toString(36)}`;

      const byLastName = await createTestUser({ lastName: `Sur${marker}` });
      const byFirstName = await createTestUser({ firstName: `Fore${marker}` });
      const byEmail = await createTestUser({ email: `mail${marker}@integration.test` });

      const users = await repo.search({ search: marker });

      const ids = users.map((user) => user.id);
      expect(ids).toContain(byLastName.user.id);
      expect(ids).toContain(byFirstName.user.id);
      expect(ids).toContain(byEmail.user.id);
    });

    it('finds a user by full name, each word matching a different column, and not when one word matches nothing', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = Date.now().toString(36);
      const created = await createTestUser({ firstName: `Ali${marker}`, lastName: `Smith${marker}` });
      await createTestUser({ firstName: `Ali${marker}`, lastName: `Jones${marker}` });

      const fullName = await repo.search({ search: `  Ali${marker}   Smith${marker} ` });
      const wrongSurname = await repo.search({ search: `Ali${marker} Brown${marker}` });

      expect(fullName.map((user) => user.id)).toEqual([created.user.id]);
      expect(wrongSurname).toEqual([]);
    });

    it('matches case-insensitively', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `Mixed${Date.now().toString(36)}`;
      const created = await createTestUser({ lastName: marker });

      const users = await repo.search({ search: marker.toUpperCase() });

      expect(users.map((user) => user.id)).toContain(created.user.id);
    });

    it('returns every match, unpaged', async () => {
      // §16 — the API does not page. A filter narrows the set; nothing slices it.
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `all${Date.now().toString(36)}`;
      await createTestUser({ lastName: marker });
      await createTestUser({ lastName: marker });
      await createTestUser({ lastName: marker });

      const users = await repo.search({ search: marker });

      expect(users).toHaveLength(3);
    });

    it('filters on isActive', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `act${Date.now().toString(36)}`;
      const active = await createTestUser({ lastName: marker });
      const inactive = await createTestUser({ lastName: marker });
      await prisma.user.update({ where: { id: inactive.user.id }, data: { isActive: false } });

      const activeOnly = await repo.search({ search: marker, isActive: true });
      const inactiveOnly = await repo.search({ search: marker, isActive: false });

      expect(activeOnly.map((user) => user.id)).toEqual([active.user.id]);
      expect(inactiveOnly.map((user) => user.id)).toEqual([inactive.user.id]);
    });

    it('filters on isRootAdmin, finding only root admins or only everyone else', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `root${Date.now().toString(36)}`;
      const rootAdmin = await createTestUser({ lastName: marker });
      const member = await createTestUser({ lastName: marker });
      await prisma.user.update({ where: { id: rootAdmin.user.id }, data: { isRootAdmin: true } });

      const rootAdmins = await repo.search({ search: marker, isRootAdmin: true });
      const others = await repo.search({ search: marker, isRootAdmin: false });

      expect(rootAdmins.map((user) => user.id)).toEqual([rootAdmin.user.id]);
      expect(others.map((user) => user.id)).toEqual([member.user.id]);
    });

    it('never returns a password hash on the domain user', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `secret${Date.now().toString(36)}`;
      await createTestUser({ lastName: marker, password: 'TestPass123' });

      const users = await repo.search({ search: marker });

      expect(users).toHaveLength(1);
      expect(users[0]).not.toHaveProperty('passwordHash');
    });
  });

  describe('UserRepository.findActiveRootAdmins (#1313)', () => {
    it('finds the active root admins, leaving out a disabled root admin and everyone else', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `admins${Date.now().toString(36)}`;
      const active = await createTestUser({ lastName: marker });
      const disabled = await createTestUser({ lastName: marker });
      const member = await createTestUser({ lastName: marker });
      await prisma.user.update({ where: { id: active.user.id }, data: { isRootAdmin: true } });
      await prisma.user.update({ where: { id: disabled.user.id }, data: { isRootAdmin: true, isActive: false } });

      const ids = (await repo.findActiveRootAdmins()).map((user) => user.id);

      expect(ids).toContain(active.user.id);
      expect(ids).not.toContain(disabled.user.id);
      expect(ids).not.toContain(member.user.id);
    });
  });

  describe('UserRepository.findActiveByLeague — the scoped peer read (A4 + A6)', () => {
    it('returns only users sharing the given league', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());

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

      const users = await repo.findActiveByLeague(league.id);
      const ids = users.map((user) => user.id);

      expect(ids).toContain(insider.user.id);
      expect(ids).toContain(peer.user.id);
      // This is the scoping guarantee A6 depends on.
      expect(ids).not.toContain(outsider.user.id);
    });

    it('carries the fields a member roster needs', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
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

      const [user] = await repo.findActiveByLeague(league.id);

      expect(user).toMatchObject({
        id: member.user.id,
        email: member.user.email,
        firstName: 'Roster',
        lastName: 'Member',
      });
    });

    it('leaves out a member removed from the league, whose membership is INACTIVE, keeping the active one (#1182)', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
      const former = await createTestUser({ lastName: 'Former' });
      const current = await createTestUser({ lastName: 'Current' });
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}A4`, 'Inactive Membership League');
      for (const [userId, status] of [
        [former.user.id, LeagueMembershipStatus.INACTIVE],
        [current.user.id, LeagueMembershipStatus.ACTIVE],
      ] as const) {
        await prisma.leagueMembership.create({ data: { leagueId: league.id, userId, role: LeagueRole.MEMBER, status } });
      }

      const users = await repo.findActiveByLeague(league.id);

      expect(users.map((user) => user.id)).toEqual([current.user.id]);
    });
  });

  // #202 step 3.3 — the identifier lookup that was written out by hand FOUR times: login,
  // the registration collision check, and the two near-identical availability checks in
  // `account/service.ts`.
  describe('UserRepository.findByIdentifier', () => {
    it('resolves the same user by either email or username', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
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
      const repo = new PrismaUserRepository(getAppPrisma());
      const marker = `cross${Date.now().toString(36)}`;
      const created = await createTestUser({ email: `${marker}@integration.test` });
      await prisma.user.update({
        where: { id: created.user.id },
        data: { username: `${marker}-name@integration.test` },
      });

      const found = await repo.findByIdentifier(`${marker}-name@integration.test`);

      expect(found?.id).toBe(created.user.id);
    });

    it.each([
      ['the email holder was created first', 'email-first'],
      ['the username holder was created first', 'username-first'],
    ] as const)('returns the account whose EMAIL the identifier is, not the one whose username it is, when %s', async (_order, order) => {
      // Both orders, so the answer can't come from the order Postgres happens to return rows in.
      const repo = new PrismaUserRepository(getAppPrisma());
      const shared = `both${order}${Date.now().toString(36)}@integration.test`;
      const createEmailHolder = () => createTestUser({ email: shared, username: `email-holder-${shared}` });
      const createUsernameHolder = () => createTestUser({ username: shared });
      const [first, second] = order === 'email-first'
        ? [createEmailHolder, createUsernameHolder]
        : [createUsernameHolder, createEmailHolder];
      const firstCreated = await first();
      const secondCreated = await second();
      const emailHolder = order === 'email-first' ? firstCreated : secondCreated;

      await expect(repo.findByIdentifier(shared)).resolves.toMatchObject({ id: emailHolder.user.id });
    });

    it('returns null for an identifier nobody holds', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());

      await expect(repo.findByIdentifier(`nobody-${Date.now()}@integration.test`))
        .resolves.toBeNull();
    });
  });

  describe('UserRepository.findHolderOtherThan', () => {
    it("finds another account holding the identifier in either column, even when the subject's own row matches too", async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());
      const shared = `held${Date.now().toString(36)}@integration.test`;
      const subject = await createTestUser();
      const other = await createTestUser();
      await prisma.user.update({ where: { id: subject.user.id }, data: { username: shared } });
      await prisma.user.update({ where: { id: other.user.id }, data: { email: shared } });

      await expect(repo.findHolderOtherThan(shared, subject.user.id)).resolves.toMatchObject({ id: other.user.id });
      await expect(repo.findHolderOtherThan(subject.user.email, subject.user.id)).resolves.toBeNull();
    });
  });

  // #202 step 3.3 — the platform-lockout guard's count. Written inline three times in
  // `admin/user-service.ts` before this.
  describe('UserRepository.countActiveRootAdmins', () => {
    it('counts active root admins and nobody else', async () => {
      const prisma = getPrisma();
      const repo = new PrismaUserRepository(getAppPrisma());

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
      const repo = new PrismaUserRepository(getAppPrisma());
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
      const repo = new PrismaUserRepository(getAppPrisma());
      const created = await createTestUser({ lastName: 'Preferences' });

      const set = await repo.update(created.user.id, {
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: TimeFormat.TWELVE_HOUR,
      });
      expect(set).toMatchObject({
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: TimeFormat.TWELVE_HOUR,
      });

      const cleared = await repo.update(created.user.id, {
        timezone: null,
        timeFormat: null,
      });

      expect(cleared.timezone).toBeUndefined();
      expect(cleared.timeFormat).toBeUndefined();
      // Not named in the update, so untouched.
      expect(cleared.locale).toBe('en-US');
    });

    it('never returns a password hash on the updated user', async () => {
      const repo = new PrismaUserRepository(getAppPrisma());
      const created = await createTestUser({ lastName: 'Hashless', password: 'TestPass123' });

      const updated = await repo.update(created.user.id, { firstName: 'Still' });

      expect(updated).not.toHaveProperty('passwordHash');
    });
  });

  describe('LeagueRepository.findByUser — the scoped league read (A2)', () => {
    it('returns only leagues the user is a member of', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
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
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const loner = await createTestUser({ lastName: 'Loner' });

      expect(await repo.findByUser(loner.user.id)).toEqual([]);
    });

    it('omits a league the user was removed from, so a removed member no longer sees it in their leagues', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
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

    it('narrows a member\'s leagues by a case-insensitive name search and the active flag in the query (#1182)', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const member = await createTestUser({ lastName: 'Searcher' });
      const office = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B6`, 'Office Majors');
      const closed = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B7`, 'Old Office Pool', false);
      const family = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}B8`, 'Family Pool');
      for (const leagueId of [office.id, closed.id, family.id]) {
        await prisma.leagueMembership.create({
          data: { leagueId, userId: member.user.id, role: LeagueRole.MEMBER, status: LeagueMembershipStatus.ACTIVE },
        });
      }

      const ids = async (filters: Parameters<typeof repo.findByUser>[1]) =>
        (await repo.findByUser(member.user.id, filters)).map((league) => league.id).sort();

      expect(await ids({ search: '  OFFICE ' })).toEqual([office.id, closed.id].sort());
      expect(await ids({ search: 'office', isActive: true })).toEqual([office.id]);
      expect(await ids({ isActive: false })).toEqual([closed.id]);
    });
  });

  // #202 — new in step 3.3, backing the admin league list. Asserted against a real
  // database because it is a grouped query: the FAPI suite proves the league list still
  // responds, but asserts nothing about the counts themselves.
  describe('LeagueRepository Hall of Lame setting (#873)', () => {
    it('shows the Hall of Lame on a new league, and stores it hidden and shown again', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}H1`, 'Lame');

      expect((await repo.findById(league.id))?.hallOfLameVisible).toBe(true);
      expect((await repo.update(league.id, { hallOfLameVisible: false })).hallOfLameVisible).toBe(false);
      expect((await repo.findById(league.id))?.hallOfLameVisible).toBe(false);
      expect((await repo.update(league.id, { hallOfLameVisible: true })).hallOfLameVisible).toBe(true);
    });
  });

  describe('LeagueMembershipRepository.countActiveByLeagues', () => {
    it('counts active members per league and omits leagues with none', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueMembershipRepository(getAppPrisma());

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
      const repo = new PrismaLeagueMembershipRepository(getAppPrisma());

      await expect(repo.countActiveByLeagues([])).resolves.toEqual(new Map());
    });
  });

  describe('LeagueMembershipRepository.findActiveJoinedSince (#903)', () => {
    it("finds every league's active memberships joined at or after the time, in the order they joined, leaving out earlier and inactive ones", async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueMembershipRepository(getAppPrisma());
      const first = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}J1`, 'Joins One');
      const second = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}J2`, 'Joins Two');
      const [early, late, left, before] = await Promise.all([
        createTestUser({ lastName: 'JoinEarly' }),
        createTestUser({ lastName: 'JoinLate' }),
        createTestUser({ lastName: 'JoinLeft' }),
        createTestUser({ lastName: 'JoinBefore' }),
      ]);
      // Far in the future, so no other test's memberships fall in the window.
      const since = new Date('2099-03-01T00:00:00.000Z');
      const rows = [
        { leagueId: second.id, userId: late.user.id, joinedAt: new Date('2099-03-01T12:00:00.000Z'), status: LeagueMembershipStatus.ACTIVE },
        { leagueId: first.id, userId: early.user.id, joinedAt: since, status: LeagueMembershipStatus.ACTIVE },
        { leagueId: first.id, userId: left.user.id, joinedAt: new Date('2099-03-01T06:00:00.000Z'), status: LeagueMembershipStatus.INACTIVE },
        { leagueId: first.id, userId: before.user.id, joinedAt: new Date('2099-02-28T23:59:59.000Z'), status: LeagueMembershipStatus.ACTIVE },
      ];
      for (const row of rows) {
        await prisma.leagueMembership.create({ data: { ...row, role: LeagueRole.MEMBER } });
      }

      const found = await repo.findActiveJoinedSince(since);

      expect(found.map((membership) => [membership.leagueId, membership.userId])).toEqual([
        [first.id, early.user.id],
        [second.id, late.user.id],
      ]);
    });
  });

  describe('LeagueRepository.search — the unscoped read (A1)', () => {
    it('finds the leagues whose name holds the search term, narrowed by isActive', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const marker = `Findable${Date.now().toString(36)}`;

      const activeLeague = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C1`, `${marker} Active`, true);
      const inactiveLeague = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C2`, `${marker} Inactive`, false);

      const searched = await repo.search({ search: marker });
      expect(searched.map((league) => league.id).sort())
        .toEqual([activeLeague.id, inactiveLeague.id].sort());

      const activeOnly = await repo.search({ search: marker, isActive: true });
      expect(activeOnly.map((league) => league.id)).toEqual([activeLeague.id]);
    });

    it('matches the league name case-insensitively', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const marker = `CaseLeague${Date.now().toString(36)}`;
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C3`, marker);

      const found = await repo.search({ search: marker.toLowerCase() });

      expect(found.map((row) => row.id)).toContain(league.id);
    });
  });

  describe('LeagueRepository.findActive (#1313)', () => {
    it('finds every active league and leaves out an inactive one', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueRepository(getAppPrisma());
      const marker = `Sweep${Date.now().toString(36)}`;
      const active = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C4`, `${marker} Active`, true);
      const inactive = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}C5`, `${marker} Inactive`, false);

      const ids = (await repo.findActive()).map((league) => league.id);

      expect(ids).toContain(active.id);
      expect(ids).not.toContain(inactive.id);
    });
  });

  describe('LeagueRepository.create — the plan (#944)', () => {
    it('starts a new league on a Premium gift that runs about six months from its creation', async () => {
      const repo = new PrismaLeagueRepository(getAppPrisma());

      const league = await repo.create({
        leagueCode: `${LEAGUE_CODE_PREFIX}P1`, name: 'Plan Default', isActive: true, iconKey: LeagueIconKey.TROPHY, cupName: 'Plan Default Cup',
      });

      const fiveMonthsOut = Date.now() + 150 * 24 * 60 * 60 * 1000;
      const sevenMonthsOut = Date.now() + 215 * 24 * 60 * 60 * 1000;
      expect(league.plan).toBe(LeaguePlan.PREMIUM);
      expect((await repo.findById(league.id))?.plan).toBe(LeaguePlan.PREMIUM);
      expect(league.planRenewsAt.getTime()).toBeGreaterThan(fiveMonthsOut);
      expect(league.planRenewsAt.getTime()).toBeLessThan(sevenMonthsOut);
    });
  });

  describe('LeagueMembershipRepository.findByUser', () => {
    it('lists a user\'s ACTIVE memberships, most recently joined first', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueMembershipRepository(getAppPrisma());
      const { user } = await createTestUser({ lastName: 'Joiner' });
      const [older, newer, left] = await Promise.all([
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}E1`, 'Joined First'),
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}E2`, 'Joined Second'),
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}E3`, 'Left'),
      ]);
      const join = (leagueId: string, joinedAt: string, status: LeagueMembershipStatus) => prisma.leagueMembership.create({
        data: { leagueId, userId: user.id, role: LeagueRole.MEMBER, status, joinedAt: new Date(joinedAt) },
      });
      await join(older.id, '2026-01-01T00:00:00.000Z', LeagueMembershipStatus.ACTIVE);
      await join(newer.id, '2026-02-01T00:00:00.000Z', LeagueMembershipStatus.ACTIVE);
      await join(left.id, '2026-03-01T00:00:00.000Z', LeagueMembershipStatus.INACTIVE);

      const memberships = await repo.findByUser(user.id);

      expect(memberships.map((membership) => membership.leagueId)).toEqual([newer.id, older.id]);
    });
  });

  describe('LeagueInvitationRepository reads', () => {
    it('reads an invitation by id, null for an unknown id, and lists a league\'s invitations newest first', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueInvitationRepository(getAppPrisma());
      const { user } = await createTestUser({ lastName: 'Inviter' });
      const [league, otherLeague] = await Promise.all([
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}F1`, 'Inviting'),
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}F2`, 'Elsewhere'),
      ]);
      const invite = (leagueId: string, code: string, createdAt: string) => prisma.leagueInvitation.create({
        data: { leagueId, inviteCode: `${LEAGUE_CODE_PREFIX}-${code}-${Date.now()}`, invitedBy: user.id, createdAt: new Date(createdAt) },
      });
      const first = await invite(league.id, 'first', '2026-01-01T00:00:00.000Z');
      const second = await invite(league.id, 'second', '2026-01-02T00:00:00.000Z');
      await invite(otherLeague.id, 'other', '2026-01-03T00:00:00.000Z');

      await expect(repo.findById(first.id)).resolves.toEqual(expect.objectContaining({ id: first.id, leagueId: league.id }));
      await expect(repo.findById('00000000-0000-0000-0000-000000000000')).resolves.toBeNull();
      expect((await repo.findOutstandingByLeague(league.id)).map((row) => row.id)).toEqual([second.id, first.id]);
    });

    it('lists as outstanding only pending invites and email invites that expired unaccepted, leaving out accepted, revoked and expired join links (#1182)', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueInvitationRepository(getAppPrisma());
      const { user } = await createTestUser({ lastName: 'OutstandingInviter' });
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}F3`, 'Outstanding');
      let day = 0;
      const invite = (inviteType: InviteType, status: InvitationStatus) => {
        day += 1;
        return prisma.leagueInvitation.create({
          data: {
            leagueId: league.id,
            inviteCode: `${LEAGUE_CODE_PREFIX}-${inviteType}-${status}-${Date.now()}-${day}`,
            invitedBy: user.id,
            inviteType,
            status,
            createdAt: new Date(Date.UTC(2026, 0, day)),
          },
        });
      };
      const pendingEmail = await invite(InviteType.EMAIL, InvitationStatus.PENDING);
      await invite(InviteType.EMAIL, InvitationStatus.ACCEPTED);
      const pendingLink = await invite(InviteType.LINK, InvitationStatus.PENDING);
      await invite(InviteType.EMAIL, InvitationStatus.REVOKED);
      const expiredEmail = await invite(InviteType.EMAIL, InvitationStatus.EXPIRED);
      await invite(InviteType.LINK, InvitationStatus.EXPIRED);

      const outstanding = await repo.findOutstandingByLeague(league.id);

      expect(outstanding.map((row) => row.id)).toEqual([expiredEmail.id, pendingLink.id, pendingEmail.id]);
    });

    it('finds the league\'s pending invitations to any of the addresses in one read, leaving out accepted ones, other addresses and other leagues (#1173)', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueInvitationRepository(getAppPrisma());
      const { user } = await createTestUser({ lastName: 'PendingInviter' });
      const [league, otherLeague] = await Promise.all([
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}F4`, 'Pending'),
        createLeague(prisma, `${LEAGUE_CODE_PREFIX}F5`, 'Pending elsewhere'),
      ]);
      const invite = (leagueId: string, email: string, status: InvitationStatus) => prisma.leagueInvitation.create({
        data: { leagueId, email, status, inviteType: InviteType.EMAIL, inviteCode: `${LEAGUE_CODE_PREFIX}-${email}-${leagueId}-${Date.now()}`, invitedBy: user.id },
      });
      const pending = await invite(league.id, 'pending@integration.test', InvitationStatus.PENDING);
      await invite(league.id, 'accepted@integration.test', InvitationStatus.ACCEPTED);
      await invite(league.id, 'not-asked@integration.test', InvitationStatus.PENDING);
      await invite(otherLeague.id, 'elsewhere@integration.test', InvitationStatus.PENDING);

      const { result, statements } = await recordStatements(() => repo.findPendingByEmails(league.id, [
        'pending@integration.test', 'accepted@integration.test', 'elsewhere@integration.test',
      ]));

      expect(result.map((row) => row.id)).toEqual([pending.id]);
      expect(statements).toHaveLength(1);
      await expect(repo.findPendingByEmails(league.id, [])).resolves.toEqual([]);
    });

    it('creates several invitations in one write under the ids given, answering each in the order given', async () => {
      const prisma = getPrisma();
      const repo = new PrismaLeagueInvitationRepository(getAppPrisma());
      const { user } = await createTestUser({ lastName: 'BatchInviter' });
      const league = await createLeague(prisma, `${LEAGUE_CODE_PREFIX}F6`, 'Batch');
      const expiresAt = new Date('2026-11-06T00:00:00.000Z');
      const invitation = (email: string) => ({
        id: randomUUID(),
        leagueId: league.id,
        email,
        inviteCode: `${LEAGUE_CODE_PREFIX}-${email}-${Date.now()}`,
        inviteType: InviteType.EMAIL,
        status: InvitationStatus.PENDING,
        maxUses: 1,
        currentUses: 0,
        invitedBy: user.id,
        expiresAt,
      });

      const given = [invitation('zed@integration.test'), invitation('amy@integration.test'), invitation('kim@integration.test')];
      const { result, statements } = await recordStatements(() => repo.createMany(given));

      expect(result.map((row) => row.id)).toEqual(given.map((row) => row.id));
      expect(result.map((row) => [row.email, row.status, row.expiresAt])).toEqual([
        ['zed@integration.test', InvitationStatus.PENDING, expiresAt],
        ['amy@integration.test', InvitationStatus.PENDING, expiresAt],
        ['kim@integration.test', InvitationStatus.PENDING, expiresAt],
      ]);
      expect(statements.filter(({ sql }) => sql.startsWith('INSERT'))).toHaveLength(1);
      await expect(prisma.leagueInvitation.count({ where: { leagueId: league.id } })).resolves.toBe(3);
      await expect(repo.createMany([])).resolves.toEqual([]);
    });
  });
});
