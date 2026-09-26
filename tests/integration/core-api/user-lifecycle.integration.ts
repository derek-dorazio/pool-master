/**
 * #202 step 3.3 — the shared User delete cascade.
 *
 * `admin/user-service.ts` and `account/service.ts` each carried their own copy of this
 * cascade, byte-for-byte identical: nine statements across eight tables, for a destructive
 * operation. They now share one implementation in `modules/users/user-lifecycle.ts`.
 *
 * The FAPI suites already prove both delete PATHS succeed end to end, and because
 * `refresh_tokens` has a foreign key to `users`, a cascade that missed it would fail the
 * delete outright. What they do not assert is that every dependent table is actually
 * cleared — so that is what this does, directly against the shared function. De-duplicating
 * destructive code without a test that watches it delete is not worth the saving.
 */
import { setupIntegrationTests, teardownIntegrationTests, getPrisma, createTestUser } from '../helpers';
import {
  countUserDeleteDependencies,
  deleteUserCascade,
  hasUserDeleteDependencies,
  isLastRootAdmin,
  revokeUserSessions,
} from '../../../packages/core-api/src/modules/users/user-lifecycle';
import { JoinPolicy, LeagueIconKey, LeagueRole, LeagueMembershipStatus } from '@poolmaster/shared/domain';

const LEAGUE_CODE_PREFIX = 'ULIFE';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  const prisma = getPrisma();
  await prisma.leagueMembership.deleteMany({
    where: { league: { leagueCode: { startsWith: LEAGUE_CODE_PREFIX } } },
  });
  await prisma.league.deleteMany({ where: { leagueCode: { startsWith: LEAGUE_CODE_PREFIX } } });
  await teardownIntegrationTests();
});

describe('shared user delete cascade (#202)', () => {
  it('clears every dependent row and the user, in one transaction', async () => {
    const prisma = getPrisma();
    const { user } = await createTestUser({ lastName: 'Cascade' });

    await prisma.refreshToken.create({
      data: {
        token: `cascade-token-${user.id}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await prisma.notification.create({
      data: {
        userId: user.id,
        eventType: 'TEST',
        title: 'Cascade test',
        body: 'Should not survive the delete',
      },
    });
    await prisma.consentRecord.create({
      data: {
        userId: user.id,
        consentType: 'TERMS',
        granted: true,
        version: '1',
      },
    });
    const league = await prisma.league.create({
      data: {
        leagueCode: `${LEAGUE_CODE_PREFIX}1`,
        name: 'Cascade League',
        isActive: true,
        iconKey: LeagueIconKey.TROPHY,
        joinPolicy: JoinPolicy.COMMISSIONER_ONLY,
      },
    });
    await prisma.leagueInvitation.create({
      data: {
        leagueId: league.id,
        inviteCode: `cascade-invite-${user.id}`,
        invitedBy: user.id,
      },
    });

    await expect(prisma.refreshToken.count({ where: { userId: user.id } })).resolves.toBe(1);

    await prisma.$transaction((tx) => deleteUserCascade(tx, user.id));

    await expect(prisma.user.findUnique({ where: { id: user.id } })).resolves.toBeNull();
    await expect(prisma.refreshToken.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.notification.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(prisma.consentRecord.count({ where: { userId: user.id } })).resolves.toBe(0);
    await expect(
      prisma.leagueInvitation.count({ where: { invitedBy: user.id } }),
    ).resolves.toBe(0);
  });

  it('counts league-scoped dependencies that must block a delete', async () => {
    const prisma = getPrisma();
    const { user } = await createTestUser({ lastName: 'Blocked' });
    const league = await prisma.league.create({
      data: {
        leagueCode: `${LEAGUE_CODE_PREFIX}2`,
        name: 'Blocking League',
        isActive: true,
        iconKey: LeagueIconKey.TROPHY,
        joinPolicy: JoinPolicy.COMMISSIONER_ONLY,
      },
    });
    await prisma.leagueMembership.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        role: LeagueRole.MEMBER,
        status: LeagueMembershipStatus.ACTIVE,
      },
    });

    const counts = await countUserDeleteDependencies(prisma, user.id);

    expect(counts.leagueCount).toBe(1);
    expect(hasUserDeleteDependencies(counts)).toBe(true);
  });

  it('reports no dependencies for an unattached user', async () => {
    const prisma = getPrisma();
    const { user } = await createTestUser({ lastName: 'Unattached' });

    const counts = await countUserDeleteDependencies(prisma, user.id);

    expect(counts).toEqual({ leagueCount: 0, squadMembershipCount: 0, createdSquadCount: 0 });
    expect(hasUserDeleteDependencies(counts)).toBe(false);
  });

  // #202 — the lockout. Before this, neither self path carried the last-root-admin guard
  // that both admin paths did, so the sole root admin could inactivate their own account
  // and then delete it, leaving nobody able to administer the platform.
  describe('last root admin', () => {
    // The count branch is NOT asserted here on purpose. Integration suites share one
    // database and leave root admins behind — there are already well over a dozen — so no
    // test can arrange "exactly one root admin exists" without destroying other suites'
    // fixtures. The count logic is unit-tested against a mocked client where it can be
    // controlled; what this covers is the branch that holds regardless of the count.
    it('never reports a non-root-admin as the last root admin', async () => {
      const prisma = getPrisma();
      const plainUser = await createTestUser({ lastName: 'Plain' });

      await expect(isLastRootAdmin(prisma, plainUser.user.id)).resolves.toBe(false);
    });

    it('does not report a root admin as the last one while others exist', async () => {
      const prisma = getPrisma();
      const first = await createTestUser({ lastName: 'AdminOne', isRootAdmin: true });
      const second = await createTestUser({ lastName: 'AdminTwo', isRootAdmin: true });

      await expect(isLastRootAdmin(prisma, first.user.id)).resolves.toBe(false);
      await expect(isLastRootAdmin(prisma, second.user.id)).resolves.toBe(false);
    });
  });

  it('revokes only live sessions and reports how many', async () => {
    const prisma = getPrisma();
    const { user } = await createTestUser({ lastName: 'Sessions' });

    await prisma.refreshToken.createMany({
      data: [
        { token: `live-1-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        { token: `live-2-${user.id}`, userId: user.id, expiresAt: new Date(Date.now() + 60_000) },
        {
          token: `already-revoked-${user.id}`,
          userId: user.id,
          expiresAt: new Date(Date.now() + 60_000),
          revokedAt: new Date(),
        },
      ],
    });

    // Two live, one already revoked — the already-revoked one must not be counted again.
    await expect(revokeUserSessions(prisma, user.id)).resolves.toBe(2);
    await expect(
      prisma.refreshToken.count({ where: { userId: user.id, revokedAt: null } }),
    ).resolves.toBe(0);
    // Idempotent: nothing live left to revoke.
    await expect(revokeUserSessions(prisma, user.id)).resolves.toBe(0);
  });
});
