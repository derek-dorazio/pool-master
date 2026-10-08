/**
 * #202 — the last-root-admin guard.
 *
 * Unit-tested rather than integration-tested because the condition is "exactly one root
 * admin exists in the whole database", and integration suites share one database that
 * already carries well over a dozen root admins from other fixtures. Arranging the
 * condition there would mean destroying other suites' data; here the count is an input.
 */
import { isLastRootAdmin } from '../../../packages/core-api/src/modules/users/user-lifecycle';
import { fakeUserRepo } from '../../support/repo-fakes';

describe('isLastRootAdmin', () => {
  it('is true for an active root admin when they are the only active one', async () => {
    const users = fakeUserRepo({ countActiveRootAdmins: jest.fn().mockResolvedValue(1) });

    await expect(isLastRootAdmin(users, { isRootAdmin: true, isActive: true })).resolves.toBe(true);
  });

  it('is false for an active root admin when another active one exists', async () => {
    const users = fakeUserRepo({ countActiveRootAdmins: jest.fn().mockResolvedValue(2) });

    await expect(isLastRootAdmin(users, { isRootAdmin: false, isActive: true })).resolves.toBe(false);
    await expect(isLastRootAdmin(users, { isRootAdmin: true, isActive: true })).resolves.toBe(false);
  });

  it('is false for an inactive root admin while one active root admin remains', async () => {
    const users = fakeUserRepo({ countActiveRootAdmins: jest.fn().mockResolvedValue(1) });

    await expect(isLastRootAdmin(users, { isRootAdmin: true, isActive: false })).resolves.toBe(false);
  });

  it('is true for an inactive root admin when no active root admin remains', async () => {
    const users = fakeUserRepo({ countActiveRootAdmins: jest.fn().mockResolvedValue(0) });

    await expect(isLastRootAdmin(users, { isRootAdmin: true, isActive: false })).resolves.toBe(true);
  });

  it('is false for a non-root-admin, without counting at all', async () => {
    const users = fakeUserRepo({ countActiveRootAdmins: jest.fn().mockResolvedValue(1) });

    // `isRootAdmin` is optional on the canonical User, so absent must read as "not one"
    // rather than as "unknown, go and count".
    await expect(isLastRootAdmin(users, { isActive: true })).resolves.toBe(false);
    await expect(isLastRootAdmin(users, { isRootAdmin: false, isActive: true })).resolves.toBe(false);
    expect(users.countActiveRootAdmins).not.toHaveBeenCalled();
  });
});
