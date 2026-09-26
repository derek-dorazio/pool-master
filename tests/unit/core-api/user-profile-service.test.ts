/**
 * #202 step 3.3 — the ONE `User` profile-write operation, for either caller.
 *
 * `docs/DOMAIN-OPERATIONS.md` defines "Update profile, username, preferences" as one
 * operation available to `self` OR `rootAdmin` (A6). The code had only the self half, in
 * `account/service.ts`, where the authority rule was implicit in the route — so the rule
 * itself had never been tested. These are the first tests of it.
 *
 * **On asserting the port call.** plans/145 "Test layering" says no layer asserts which
 * method was called with what, and that an effect with no observable moves DOWN a layer.
 * The normalization cases below are the exception that rule contemplates rather than a
 * breach of it: this service holds no state and performs no query, so the `UserUpdate` it
 * hands the port IS its output — there is nothing else to observe, at this layer or a lower
 * one. What the port then DOES with that update, including the null-clears, is asserted
 * against real Postgres in `identity-repositories.integration.ts`. Nothing here asserts a
 * read the adapter owns.
 */
import { UserProfileService } from '../../../packages/core-api/src/modules/users/user-profile-service';
import { fakeUserRepo } from '../../support/repo-fakes';
import { DateFormat, TimeFormat, type User } from '../../../packages/shared/domain';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    email: 'user@example.com',
    username: 'user-1',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    createdAt: new Date('2026-04-13T00:00:00.000Z'),
    updatedAt: new Date('2026-04-13T00:00:00.000Z'),
    ...overrides,
  };
}

const self = { userId: 'user-1', isRootAdmin: false };
const rootAdmin = { userId: 'admin-1', isRootAdmin: true };
const stranger = { userId: 'other-1', isRootAdmin: false };

function serviceFor(user: User | null, extra: Parameters<typeof fakeUserRepo>[0] = {}) {
  const users = fakeUserRepo({
    findById: jest.fn().mockResolvedValue(user),
    update: jest.fn().mockImplementation(async (id: string, updates: Partial<User>) => ({
      ...(user ?? buildUser()),
      ...updates,
      id,
    })),
    ...extra,
  });
  return { users, service: new UserProfileService(users) };
}

describe('UserProfileService — A6: self, or rootAdmin', () => {
  it('lets a user write their own record', async () => {
    const { users, service } = serviceFor(buildUser());

    await expect(
      service.updateProfile(self, 'user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
        email: 'user@example.com',
      }),
    ).resolves.toMatchObject({ id: 'user-1' });
    expect(users.update).toHaveBeenCalled();
  });

  it('lets a root admin write somebody else’s record', async () => {
    // This arm is the half that did not exist. The document has always said root admin may
    // do it; there was no code path for it.
    const { users, service } = serviceFor(buildUser());

    await expect(service.updateUsername(rootAdmin, 'user-1', 'corrected')).resolves.toMatchObject({
      username: 'corrected',
    });
    expect(users.update).toHaveBeenCalledWith('user-1', { username: 'corrected' });
  });

  it('refuses an ordinary user writing somebody else’s record, before reading it', async () => {
    const { users, service } = serviceFor(buildUser());

    await expect(service.updateUsername(stranger, 'user-1', 'hijacked'))
      .rejects.toMatchObject({ code: 'USER_WRITE_FORBIDDEN', statusCode: 403 });
    // Rejected on authority alone — the subject is not even loaded.
    expect(users.findById).not.toHaveBeenCalled();
    expect(users.update).not.toHaveBeenCalled();
  });

  it('rejects a missing subject', async () => {
    const { service } = serviceFor(null);

    await expect(service.updateUsername(rootAdmin, 'missing', 'whoever'))
      .rejects.toMatchObject({ code: 'USER_NOT_FOUND', statusCode: 404 });
  });

  it('writes an INACTIVE account, because isActive is a read filter, not a write lock (A9)', async () => {
    // The old account path rejected this with a 409 ACCOUNT_INACTIVE_READ_ONLY, which made
    // the obvious recovery — fix your details, then reactivate — impossible.
    const { users, service } = serviceFor(buildUser({ isActive: false }));

    await expect(
      service.updateProfile(self, 'user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
        email: 'fixed@example.com',
      }),
    ).resolves.toMatchObject({ email: 'fixed@example.com' });
    expect(users.update).toHaveBeenCalled();
  });
});

describe('UserProfileService.updateProfile', () => {
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

  it('rejects an email another account already holds', async () => {
    const { users, service } = serviceFor(buildUser(), {
      findByIdentifier: jest.fn().mockResolvedValue(buildUser({ id: 'someone-else' })),
    });

    await expect(
      service.updateProfile(self, 'user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
        email: 'taken@example.com',
      }),
    ).rejects.toMatchObject({ code: 'ACCOUNT_EMAIL_TAKEN', statusCode: 409 });
    expect(users.update).not.toHaveBeenCalled();
  });

  it('allows an email the subject already holds themselves', async () => {
    // "Not me" is the caller's business, not the query's — findByIdentifier has no idea who
    // is asking, so the id comparison happens here. Without it, re-saving an unchanged
    // profile would report your own email as taken.
    const { users, service } = serviceFor(buildUser(), {
      findByIdentifier: jest.fn().mockResolvedValue(buildUser()),
    });

    await expect(
      service.updateProfile(self, 'user-1', {
        firstName: 'Derek',
        lastName: 'Dorazio',
        email: 'user@example.com',
      }),
    ).resolves.toMatchObject({ id: 'user-1' });
    expect(users.update).toHaveBeenCalled();
  });
});

describe('UserProfileService.updateUsername', () => {
  it('trims and lowercases the username before writing', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updateUsername(self, 'user-1', '  NewName  ');

    expect(users.update).toHaveBeenCalledWith('user-1', { username: 'newname' });
  });

  it('rejects a username another account already holds — including as their EMAIL', async () => {
    // One check for both columns: login accepts either, so a username matching somebody
    // else's email address is just as unusable as a duplicate username.
    const { users, service } = serviceFor(buildUser(), {
      findByIdentifier: jest.fn().mockResolvedValue(buildUser({ id: 'someone-else' })),
    });

    await expect(service.updateUsername(self, 'user-1', 'taken@example.com'))
      .rejects.toMatchObject({ code: 'ACCOUNT_USERNAME_TAKEN', statusCode: 409 });
    expect(users.update).not.toHaveBeenCalled();
  });
});

describe('UserProfileService.updatePreferences', () => {
  it('writes only the preferences the caller named', async () => {
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
  });

  it('clears a preference passed as null, and treats blank as cleared', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updatePreferences(self, 'user-1', {
      timezone: null,
      locale: '   ',
      dateFormat: null,
    });

    expect(users.update).toHaveBeenCalledWith('user-1', {
      timezone: null,
      locale: null,
      dateFormat: null,
    });
  });

  it('writes nothing at all when the caller names no preference', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updatePreferences(self, 'user-1', {});

    expect(users.update).toHaveBeenCalledWith('user-1', {});
  });

  it('passes domain enums through unmapped — the adapter owns the row mapping', async () => {
    const { users, service } = serviceFor(buildUser());

    await service.updatePreferences(self, 'user-1', { dateFormat: DateFormat.YMD });

    expect(users.update).toHaveBeenCalledWith('user-1', { dateFormat: DateFormat.YMD });
  });
});
