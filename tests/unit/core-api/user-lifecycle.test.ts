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
  it('is true for a root admin when they are the only one', async () => {
    const users = fakeUserRepo({ countRootAdmins: jest.fn().mockResolvedValue(1) });

    await expect(isLastRootAdmin(users, { isRootAdmin: true })).resolves.toBe(true);
  });

  it('is false for a root admin when another exists', async () => {
    const users = fakeUserRepo({ countRootAdmins: jest.fn().mockResolvedValue(2) });

    await expect(isLastRootAdmin(users, { isRootAdmin: false })).resolves.toBe(false);
    await expect(isLastRootAdmin(users, { isRootAdmin: true })).resolves.toBe(false);
  });

  it('is false for a non-root-admin, without counting at all', async () => {
    const users = fakeUserRepo({ countRootAdmins: jest.fn().mockResolvedValue(1) });

    // `isRootAdmin` is optional on the canonical User, so absent must read as "not one"
    // rather than as "unknown, go and count".
    await expect(isLastRootAdmin(users, {})).resolves.toBe(false);
    await expect(isLastRootAdmin(users, { isRootAdmin: false })).resolves.toBe(false);
    expect(users.countRootAdmins).not.toHaveBeenCalled();
  });
});
