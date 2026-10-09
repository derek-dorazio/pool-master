/**
 * #202 step 3.4 — the `User` operations, one suite for one implementation.
 *
 * This replaces three: `admin-user-service.test.ts`, `account-service.test.ts` and
 * `user-profile-service.test.ts`. They tested the same operations twice over — disable,
 * enable, delete, revoke sessions, read — because the code implemented them twice, once per
 * caller. With one implementation there is one suite, and the thing most worth asserting
 * becomes visible: that **both callers reach the same operation**, and that the authority rule
 * decides who may.
 *
 * These assert returned values and typed errors. What each operation writes — the flag, the
 * revoked sessions, the delete cascade, and the no-ops that write nothing — is asserted against
 * Postgres in `tests/integration/core-api/accounts.integration.ts` and
 * `user-lifecycle.integration.ts` (#209); query shapes in `identity-repositories.integration.ts`.
 */
import { expect } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { fakeUserRepo } from '../../support/repo-fakes';
import { asPrismaClient } from '../../support/prisma-double';
import { DateFormat, TimeFormat, type User } from '../../../packages/shared/domain';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'userone',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  };
}

/** The three callers every operation has to distinguish. */
const self = { userId: 'user-1', isRootAdmin: false };
const rootAdmin = { userId: 'admin-1', isRootAdmin: true };
const stranger = { userId: 'other-1', isRootAdmin: false };

function createPrismaMock(passwordHash: string | null = null) {
  const tx = {
    user: { update: jest.fn().mockResolvedValue(undefined) },
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
  };

  const prisma = {
    // The ONE read that stays on Prisma: passwordHash is a secret the port never returns.
    user: { findUnique: jest.fn().mockResolvedValue({ passwordHash }) },
    // The delete-dependency counts. Zero means nothing blocks the delete.
    leagueMembership: { count: jest.fn().mockResolvedValue(0) },
    squadMembership: { count: jest.fn().mockResolvedValue(0) },
    squad: { count: jest.fn().mockResolvedValue(0) },
    $transaction: jest.fn(async (callback: (client: typeof tx) => Promise<void>) => callback(tx)),
  };

  return { prisma };
}

function serviceFor(user: User | null, extra: Parameters<typeof fakeUserRepo>[0] = {}) {
  const users = fakeUserRepo({
    findById: jest.fn().mockResolvedValue(user),
    update: jest.fn().mockImplementation(async (id: string, updates: Record<string, unknown>) => ({
      ...(user ?? buildUser()),
      ...updates,
      id,
    })),
    ...extra,
  });
  const { prisma } = createPrismaMock();
  return { users, prisma, service: new UserService(users, asPrismaClient(prisma), undefined) };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('A6 — every User write is by the subject, or by a root admin', () => {
  it('lets a user write their own record', async () => {
    const { users, service } = serviceFor(buildUser());

    await expect(service.updateUsername(self, 'user-1', 'renamed'))
      .resolves.toMatchObject({ username: 'renamed' });
    expect(users.update).toHaveBeenCalled();
  });

  it('lets a root admin write somebody else’s record', async () => {
    // The half that did not exist before #202: the document has always said root admin may
    // do it, and there was no code path.
    const { users, service } = serviceFor(buildUser());

    await expect(service.updateUsername(rootAdmin, 'user-1', 'corrected'))
      .resolves.toMatchObject({ username: 'corrected' });
    expect(users.update).toHaveBeenCalled();
  });

  it('refuses an ordinary user writing somebody else’s record, before reading it', async () => {
    const { users, service } = serviceFor(buildUser());

    await expect(service.updateUsername(stranger, 'user-1', 'hijacked'))
      .rejects.toMatchObject({ code: 'USER_WRITE_FORBIDDEN', statusCode: 403 });
    // Rejected on authority alone — the subject is not even loaded.
    expect(users.findById).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('refuses an ordinary user READING somebody else’s record', async () => {
    const { service } = serviceFor(buildUser());

    await expect(service.readUser(stranger, 'user-1'))
      .rejects.toMatchObject({ code: 'USER_READ_FORBIDDEN', statusCode: 403 });
    await expect(service.readUser(self, 'user-1')).resolves.toMatchObject({ id: 'user-1' });
    await expect(service.readUser(rootAdmin, 'user-1')).resolves.toMatchObject({ id: 'user-1' });
  });

  it('rejects a missing subject', async () => {
    const { service } = serviceFor(null);

    await expect(service.readUser(rootAdmin, 'missing'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
  });

  it('writes an INACTIVE account, because isActive is a read filter, not a write lock (A9)', async () => {
    // The old account path rejected this with 409 ACCOUNT_INACTIVE_READ_ONLY, which made the
    // obvious recovery — fix your details, then reactivate — impossible.
    const { users, service } = serviceFor(buildUser({ isActive: false }));

    await expect(service.updateProfile(self, 'user-1', {
      firstName: 'Derek',
      lastName: 'Dorazio',
      email: 'fixed@example.com',
    })).resolves.toMatchObject({ email: 'fixed@example.com' });
    expect(users.update).toHaveBeenCalled();
  });

  it('reserves the unscoped list for a root admin (A1)', async () => {
    const { service } = serviceFor(buildUser(), { findAll: jest.fn().mockResolvedValue([buildUser()]) });

    await expect(service.listUsers(self, {}))
      .rejects.toMatchObject({ code: 'ROOT_ADMIN_ACCESS_REQUIRED', statusCode: 403 });
    await expect(service.listUsers(rootAdmin, {})).resolves.toHaveLength(1);
  });
});

describe('profile, username and preferences', () => {
  it('trims the names and lowercases the email before writing', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updateProfile(self, 'user-1', {
      firstName: '  Derek  ',
      lastName: '  Dorazio  ',
      email: '  Updated@Example.COM  ',
    });

    expect(users.update).toHaveBeenCalledWith('user-1', {
      email: 'updated@example.com',
      firstName: 'Derek',
      lastName: 'Dorazio',
    });
  });

  it('rejects an identifier another account holds — including as their EMAIL', async () => {
    // One check for both columns: login accepts either, so a username matching somebody
    // else's email address is just as unusable as a duplicate username.
    const { users, service } = serviceFor(buildUser(), {
      findByIdentifier: jest.fn().mockResolvedValue(buildUser({ id: 'someone-else' })),
    });

    await expect(service.updateUsername(self, 'user-1', 'taken@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_USERNAME_TAKEN', statusCode: 409 });
    await expect(service.updateProfile(self, 'user-1', {
      firstName: 'Derek',
      lastName: 'Dorazio',
      email: 'taken@example.com',
    })).rejects.toMatchObject({ code: 'ACCOUNT_EMAIL_TAKEN', statusCode: 409 });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('allows an identifier the subject already holds themselves', async () => {
    // "Not me" is the caller's business, not the query's — `findByIdentifier` has no idea who
    // is asking. Without the id comparison, re-saving an unchanged profile would report your
    // own email as taken.
    const { users, service } = serviceFor(buildUser(), {
      findByIdentifier: jest.fn().mockResolvedValue(buildUser()),
    });

    await expect(service.updateProfile(self, 'user-1', {
      firstName: 'Derek',
      lastName: 'Dorazio',
      email: 'user@example.com',
    })).resolves.toMatchObject({ id: 'user-1' });
    expect(users.update).toHaveBeenCalled();
  });

  it('writes only the preferences the caller named, and clears the ones passed as null', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updatePreferences(self, 'user-1', {
      timezone: '  America/New_York  ',
      timeFormat: TimeFormat.TWELVE_HOUR,
    });
    // `locale` and `dateFormat` were not named, so they are absent rather than cleared.
    expect(users.update).toHaveBeenCalledWith('user-1', {
      timezone: 'America/New_York',
      timeFormat: TimeFormat.TWELVE_HOUR,
    });

    await service.updatePreferences(self, 'user-1', {
      timezone: null,
      locale: '   ',
      dateFormat: DateFormat.YMD,
    });
    // Blank counts as cleared; a domain enum passes through unmapped, because the adapter owns
    // the row mapping.
    expect(users.update).toHaveBeenLastCalledWith('user-1', {
      timezone: null,
      locale: null,
      dateFormat: DateFormat.YMD,
    });
  });
});

describe('passwords', () => {
  it('refuses to let even a root admin change somebody else’s password this way', async () => {
    // A6 separates the two by SUBJECT: changing your own requires the current password,
    // resetting another's does not. They are two operations, and this is the self one.
    const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
    const service = new UserService(users, asPrismaClient(createPrismaMock('hash').prisma));

    await expect(service.changeOwnPassword(rootAdmin, 'user-1', {
      currentPassword: 'CurrentPass123!',
      newPassword: 'NewPass456!',
      confirmNewPassword: 'NewPass456!',
    })).rejects.toMatchObject({ code: 'USER_WRITE_FORBIDDEN', statusCode: 403 });
  });

  it('rejects a wrong current password, a mismatched confirmation, and a passwordless account', async () => {
    const users = fakeUserRepo({ findById: jest.fn().mockResolvedValue(buildUser()) });
    const hashed = await bcrypt.hash('CurrentPass123!', 10);

    await expect(new UserService(users, asPrismaClient(createPrismaMock(hashed).prisma))
      .changeOwnPassword(self, 'user-1', {
        currentPassword: 'WrongPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
      })).rejects.toMatchObject({ code: 'INVALID_CURRENT_PASSWORD', statusCode: 400 });

    await expect(new UserService(users, asPrismaClient(createPrismaMock(hashed).prisma))
      .changeOwnPassword(self, 'user-1', {
        currentPassword: 'CurrentPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'Different789!',
      })).rejects.toMatchObject({ code: 'PASSWORD_CONFIRMATION_MISMATCH', statusCode: 400 });

    await expect(new UserService(users, asPrismaClient(createPrismaMock(null).prisma))
      .changeOwnPassword(self, 'user-1', {
        currentPassword: 'AnyPass123!',
        newPassword: 'NewPass456!',
        confirmNewPassword: 'NewPass456!',
      })).rejects.toMatchObject({ code: 'ACCOUNT_PASSWORD_UNAVAILABLE', statusCode: 409 });
  });

  it('reserves the reset for a root admin', async () => {
    const { service } = serviceFor(buildUser());

    await expect(service.resetPassword(self, 'user-1'))
      .rejects.toMatchObject({ code: 'ROOT_ADMIN_ACCESS_REQUIRED', statusCode: 403 });
  });
});

describe('disable and enable — one operation, either caller', () => {
  it('returns an already-inactive user as they are when asked to disable them', async () => {
    const { service } = serviceFor(buildUser({ isActive: false }));

    await expect(service.disableUser(rootAdmin, 'user-1')).resolves.toMatchObject({
      isActive: false,
    });
  });

  it('refuses to disable the last remaining root admin, whoever asks', async () => {
    for (const actor of [self, rootAdmin]) {
      const { service } = serviceFor(
        buildUser({ isRootAdmin: true }),
        { countActiveRootAdmins: jest.fn().mockResolvedValue(1) },
      );

      await expect(service.disableUser(actor, 'user-1'))
        .rejects.toMatchObject({ code: 'ACCOUNT_LAST_ROOT_ADMIN', statusCode: 409 });
    }
  });

  it('enables an inactive user and is a no-op for an active one', async () => {
    const inactive = serviceFor(buildUser({ isActive: false }));
    await expect(inactive.service.enableUser(self, 'user-1'))
      .resolves.toMatchObject({ isActive: true });
    expect(inactive.users.update).toHaveBeenCalledWith('user-1', { isActive: true });

    const active = serviceFor(buildUser());
    await expect(active.service.enableUser(self, 'user-1')).resolves.toMatchObject({
      isActive: true,
    });
    expect(active.users.update).not.toHaveBeenCalled();
  });
});

describe('revoke sessions — one operation, either caller', () => {
  it('refuses to revoke the sessions of a user who does not exist with 404 USER_NOT_FOUND', async () => {
    const { service } = serviceFor(null);

    await expect(service.revokeSessions(rootAdmin, 'missing'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
  });
});

describe('permanent delete — one operation, either caller', () => {
  const inactive = () => buildUser({ isActive: false });

  it('rejects an ACTIVE account — the one place isActive gates a write (A9)', async () => {
    const { service } = serviceFor(buildUser());

    await expect(service.deleteUser(rootAdmin, 'user-1', 'user@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_REQUIRES_INACTIVE', statusCode: 409 });
  });

  it('rejects a confirmation email that does not match exactly', async () => {
    const { service } = serviceFor(inactive());

    await expect(service.deleteUser(self, 'user-1', 'wrong@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_CONFIRMATION_MISMATCH', statusCode: 400 });
  });

  it('rejects an account that still holds league-scoped data', async () => {
    const { prisma, service } = serviceFor(inactive());
    prisma.squadMembership.count.mockResolvedValue(1);

    await expect(service.deleteUser(self, 'user-1', 'user@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST', statusCode: 409 });
  });

  it('refuses the last root admin, even though they are already inactive', async () => {
    // Belt and braces with the disable gate: a root admin who went inactive before that rule
    // existed can still reach delete, and this must not be the path that empties the
    // root-admin set.
    const { service } = serviceFor(
      buildUser({ isActive: false, isRootAdmin: true }),
      { countActiveRootAdmins: jest.fn().mockResolvedValue(0) },
    );

    await expect(service.deleteUser(rootAdmin, 'user-1', 'user@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_LAST_ROOT_ADMIN', statusCode: 409 });
  });
});

describe('the root-admin role', () => {
  it('lets a root admin demote THEMSELVES while another remains', async () => {
    // #202 — the self-demotion block is gone. The only rule is that the platform keeps an
    // administrator, and that is the count; with two, one stepping down is legitimate.
    const { service } = serviceFor(
      buildUser({ id: 'admin-1', isRootAdmin: true }),
      { countActiveRootAdmins: jest.fn().mockResolvedValue(2) },
    );

    await expect(service.setRootAdmin(rootAdmin, 'admin-1', false)).resolves.toBeUndefined();
  });

  it('refuses to remove the last remaining root admin', async () => {
    const { service } = serviceFor(
      buildUser({ isRootAdmin: true }),
      { countActiveRootAdmins: jest.fn().mockResolvedValue(1) },
    );

    await expect(service.setRootAdmin(rootAdmin, 'user-1', false))
      .rejects.toMatchObject({ code: 'LAST_ROOT_ADMIN', statusCode: 409 });
  });

  it('treats an unchanged role as a no-op that never counts the root admins', async () => {
    const { users, service } = serviceFor(buildUser({ isRootAdmin: true }));

    await expect(service.setRootAdmin(rootAdmin, 'user-1', true)).resolves.toBeUndefined();

    expect(users.countActiveRootAdmins).not.toHaveBeenCalled();
  });

  it('is root-admin only', async () => {
    const { service } = serviceFor(buildUser());

    await expect(service.setRootAdmin(self, 'user-1', true))
      .rejects.toMatchObject({ code: 'ROOT_ADMIN_ACCESS_REQUIRED', statusCode: 403 });
  });
});
