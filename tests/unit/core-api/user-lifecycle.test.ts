/**
 * #202 — the last-root-admin guard.
 *
 * Unit-tested rather than integration-tested because the condition is "exactly one root
 * admin exists in the whole database", and integration suites share one database that
 * already carries well over a dozen root admins from other fixtures. Arranging the
 * condition there would mean destroying other suites' data; here the count is an input.
 */
import { isLastRootAdmin } from '../../../packages/core-api/src/modules/users/user-lifecycle';

function createPrisma(user: { isRootAdmin: boolean } | null, rootAdminCount: number) {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue(user),
      count: jest.fn().mockResolvedValue(rootAdminCount),
    },
  } as any;
}

describe('isLastRootAdmin', () => {
  it('is true for a root admin when they are the only one', async () => {
    const prisma = createPrisma({ isRootAdmin: true }, 1);

    await expect(isLastRootAdmin(prisma, 'user-1')).resolves.toBe(true);
  });

  it('is false for a root admin when another exists', async () => {
    const prisma = createPrisma({ isRootAdmin: true }, 2);

    await expect(isLastRootAdmin(prisma, 'user-1')).resolves.toBe(false);
  });

  it('is false for a non-root-admin, without counting at all', async () => {
    const prisma = createPrisma({ isRootAdmin: false }, 1);

    await expect(isLastRootAdmin(prisma, 'user-1')).resolves.toBe(false);
    // Short-circuits: a non-admin can never be the last admin, so the count is not needed.
    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('is false for a missing user', async () => {
    const prisma = createPrisma(null, 1);

    await expect(isLastRootAdmin(prisma, 'missing')).resolves.toBe(false);
  });

  it('is true when the count is somehow zero but the user is a root admin', async () => {
    // Defensive: `<= 1` rather than `=== 1`, so a miscount cannot open the lockout path.
    const prisma = createPrisma({ isRootAdmin: true }, 0);

    await expect(isLastRootAdmin(prisma, 'user-1')).resolves.toBe(true);
  });
});
