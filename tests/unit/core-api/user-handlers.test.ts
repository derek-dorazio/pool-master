/**
 * The user route handlers (#1482), called with a stand-in user service: `me` read as the caller,
 * the one error arm every operation shares, and which session cookies a change to your own
 * account sets or clears.
 */
import { expect } from '@jest/globals';
import { AuthError, type AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import type { EmailPreferencesService } from '../../../packages/core-api/src/modules/email/email-preferences-service';
import { createUserHandlers } from '../../../packages/core-api/src/modules/users/handler';
import { UserOperationError } from '../../../packages/core-api/src/modules/users/user-errors';
import type { UserService } from '../../../packages/core-api/src/modules/users/user-service';
import { buildUser } from '../../factories';
import { authUser, callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const me = authUser('user-1');
const admin = authUser('admin', { isRootAdmin: true });
const cookie = 'poolmaster_refresh=refresh-1';

function userService(overrides: Record<string, unknown> = {}) {
  const answer = (userId: string) => Promise.resolve(buildUser({ id: userId }));
  return {
    listUsers: jest.fn((..._args: unknown[]) => Promise.resolve([buildUser({ id: 'user-2' })])),
    readUser: jest.fn((_actor: unknown, userId: string) => answer(userId)),
    writableUser: jest.fn((_actor: unknown, userId: string) => answer(userId)),
    updateProfile: jest.fn((_actor: unknown, userId: string, ..._rest: unknown[]) => answer(userId)),
    updateUsername: jest.fn((_actor: unknown, userId: string, ..._rest: unknown[]) => answer(userId)),
    updatePreferences: jest.fn((_actor: unknown, userId: string, ..._rest: unknown[]) => answer(userId)),
    changeOwnPassword: jest.fn((..._args: unknown[]) => Promise.resolve()),
    resetPassword: jest.fn((..._args: unknown[]) => Promise.resolve({ temporaryPassword: 'tmp' })),
    disableUser: jest.fn((_actor: unknown, userId: string, ..._rest: unknown[]) => answer(userId)),
    enableUser: jest.fn((_actor: unknown, userId: string) => answer(userId)),
    revokeSessions: jest.fn((..._args: unknown[]) => Promise.resolve(3)),
    deleteUser: jest.fn((..._args: unknown[]) => Promise.resolve()),
    setRootAdmin: jest.fn((..._args: unknown[]) => Promise.resolve()),
    ...overrides,
  };
}
const authService = { issueSessionForUser: jest.fn(() => Promise.resolve({ accessToken: 'a', refreshToken: 'r', csrfToken: 'c' })) };
const emailPreferences = {
  read: jest.fn((..._args: unknown[]) => Promise.resolve({ categories: [] })),
  set: jest.fn((..._args: unknown[]) => Promise.resolve({ categories: [{ category: 'DIGEST', enabled: false }] })),
};
const payments = { listForPayer: jest.fn((..._args: unknown[]) => Promise.resolve([])) };
const handlersOver = (fake: ReturnType<typeof userService>) => createUserHandlers(
  fake as unknown as UserService,
  authService as unknown as AuthService,
  emailPreferences as unknown as EmailPreferencesService,
  payments,
);
const actorOf = (user: ReturnType<typeof authUser>) => ({ userId: user.userId, isRootAdmin: user.isRootAdmin });

describe('user handlers: the actor and the subject', () => {
  it('refuses any user operation with no session with 401 AUTH_SESSION_REQUIRED', async () => {
    const fake = userService();

    const reply = await callHandler(handlersOver(fake).readUser, stubRequest({ params: { userId: 'me' }, contextLogger: false }));

    expect(reply).toMatchObject({ statusCode: 401, body: { error: { code: 'AUTH_SESSION_REQUIRED' } } });
    expect(fake.readUser).not.toHaveBeenCalled();
  });

  it('reads `me` as the caller, and any other id as that user', async () => {
    const fake = userService();
    const handlers = handlersOver(fake);

    const mine = await callHandler(handlers.readUser, stubRequest({ params: { userId: 'me' }, authUser: me }));
    await callHandler(handlers.readUser, stubRequest({ params: { userId: 'user-2' }, authUser: admin }));

    expect(fake.readUser.mock.calls).toEqual([[actorOf(me), 'user-1'], [actorOf(admin), 'user-2']]);
    expect(mine.body).toMatchObject({ user: { id: 'user-1' } });
  });

  it.each([
    ['a user error', new UserOperationError('Not yours', 'ROOT_ADMIN_ACCESS_REQUIRED', 403), 403, 'ROOT_ADMIN_ACCESS_REQUIRED'],
    ['an auth error', new AuthError('Wrong password', 'INVALID_CREDENTIALS'), 401, 'INVALID_CREDENTIALS'],
  ])('answers %s with its own status and code', async (_label, error, status, code) => {
    const handlers = handlersOver(userService({ readUser: () => Promise.reject(error) }));

    const reply = await callHandler(handlers.readUser, stubRequest({ params: { userId: 'me' }, authUser: me }));

    expect(reply).toMatchObject({ statusCode: status, body: { error: { code } } });
  });

  it('passes an unexpected failure on to the global error handler', async () => {
    const handlers = handlersOver(userService({ readUser: () => Promise.reject(boom) }));

    await expect(callHandler(handlers.readUser, stubRequest({ params: { userId: 'me' }, authUser: me }))).rejects.toBe(boom);
  });
});

describe('user handlers: reads and profile writes', () => {
  it('lists users by the search and active filter', async () => {
    const fake = userService();

    const reply = await callHandler(handlersOver(fake).listUsers, stubRequest({ query: { search: 'ada', isActive: true }, authUser: admin }));

    expect(fake.listUsers).toHaveBeenCalledWith(actorOf(admin), { search: 'ada', isActive: true });
    expect(reply.body).toMatchObject({ users: [{ id: 'user-2' }] });
  });

  it('updates the caller\'s profile, username and preferences, answering with the user', async () => {
    const fake = userService();
    const handlers = handlersOver(fake);
    const request = (body: unknown) => stubRequest({ params: { userId: 'me' }, body, authUser: me });

    const profile = await callHandler(handlers.updateProfile, request({ firstName: 'Ada' }));
    await callHandler(handlers.updateUsername, request({ username: 'ada' }));
    await callHandler(handlers.updatePreferences, request({ colorScheme: 'DARK' }));

    expect(profile.body).toMatchObject({ user: { id: 'user-1' } });
    expect(fake.updateProfile).toHaveBeenCalledWith(actorOf(me), 'user-1', { firstName: 'Ada' });
    expect(fake.updateUsername).toHaveBeenCalledWith(actorOf(me), 'user-1', 'ada');
    expect(fake.updatePreferences).toHaveBeenCalledWith(actorOf(me), 'user-1', { colorScheme: 'DARK' });
  });

  it('reads and sets the caller\'s email preferences', async () => {
    const handlers = handlersOver(userService());

    const read = await callHandler(handlers.readEmailPreferences, stubRequest({ params: { userId: 'me' }, authUser: me }));
    const set = await callHandler(handlers.updateEmailPreference, stubRequest({
      params: { userId: 'me' }, body: { category: 'DIGEST', enabled: false }, authUser: me, contextLogger: false,
    }));

    expect(read.body).toEqual({ categories: [] });
    expect(set.body).toEqual({ categories: [{ category: 'DIGEST', enabled: false }] });
    expect(emailPreferences.set).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'DIGEST', false, expect.anything());
  });

  it('lists the payments the caller made', async () => {
    const reply = await callHandler(handlersOver(userService()).listPayments, stubRequest({ params: { userId: 'me' }, authUser: me }));

    expect(payments.listForPayer).toHaveBeenCalledWith('user-1');
    expect(reply.body).toEqual({ payments: [] });
  });
});

describe('user handlers: credentials and lifecycle', () => {
  it('changes the caller\'s password keeping the session it was done from', async () => {
    const fake = userService();

    const reply = await callHandler(handlersOver(fake).changePassword, stubRequest({
      params: { userId: 'me' }, body: { currentPassword: 'a', newPassword: 'b' }, headers: { cookie }, authUser: me,
    }));

    expect(fake.changeOwnPassword).toHaveBeenCalledWith(actorOf(me), 'user-1', { currentPassword: 'a', newPassword: 'b', currentRefreshToken: 'refresh-1' });
    expect(reply.body).toEqual({ success: true });
  });

  it('resets a user\'s password, answering with what the service gave', async () => {
    const reply = await callHandler(handlersOver(userService()).resetPassword, stubRequest({ params: { userId: 'user-2' }, authUser: admin }));

    expect(reply.body).toEqual({ temporaryPassword: 'tmp' });
  });

  it('keeps the caller\'s own session when they inactivate themselves, and no one\'s when an admin inactivates another', async () => {
    const fake = userService();
    const handlers = handlersOver(fake);

    await callHandler(handlers.disableUser, stubRequest({ params: { userId: 'me' }, headers: { cookie }, authUser: me }));
    await callHandler(handlers.disableUser, stubRequest({ params: { userId: 'user-2' }, headers: { cookie }, authUser: admin }));

    expect(fake.disableUser.mock.calls).toEqual([[actorOf(me), 'user-1', 'refresh-1'], [actorOf(admin), 'user-2', null]]);
  });

  it('issues a fresh session when the caller re-enables themselves, and none when an admin re-enables another', async () => {
    const handlers = handlersOver(userService());

    const self = await callHandler(handlers.enableUser, stubRequest({ params: { userId: 'me' }, authUser: me }));
    const other = await callHandler(handlers.enableUser, stubRequest({ params: { userId: 'user-2' }, authUser: admin }));

    expect(self.headers['set-cookie']).toEqual(expect.arrayContaining([expect.stringContaining('poolmaster_refresh=r')]));
    expect(other.headers['set-cookie']).toBeUndefined();
    expect(other.body).toMatchObject({ user: { id: 'user-2' } });
  });

  it('clears the session cookies when the caller revokes their own sessions or deletes their own account, and not another\'s', async () => {
    const fake = userService();
    const handlers = handlersOver(fake);

    const revokedSelf = await callHandler(handlers.revokeSessions, stubRequest({ params: { userId: 'me' }, authUser: me }));
    const revokedOther = await callHandler(handlers.revokeSessions, stubRequest({ params: { userId: 'user-2' }, authUser: admin }));
    const deletedSelf = await callHandler(handlers.deleteUser, stubRequest({ params: { userId: 'me' }, body: { email: 'user-1@example.test' }, authUser: me }));
    const deletedOther = await callHandler(handlers.deleteUser, stubRequest({ params: { userId: 'user-2' }, body: { email: 'x@example.test' }, authUser: admin }));

    expect(revokedSelf).toMatchObject({ body: { revokedCount: 3 }, headers: { 'set-cookie': expect.any(Array) as unknown } });
    expect(revokedOther.headers['set-cookie']).toBeUndefined();
    expect(deletedSelf).toMatchObject({ body: { success: true }, headers: { 'set-cookie': expect.any(Array) as unknown } });
    expect(deletedOther.headers['set-cookie']).toBeUndefined();
    expect(fake.deleteUser).toHaveBeenCalledWith(actorOf(me), 'user-1', 'user-1@example.test');
  });

  it('sets whether a user is a root admin', async () => {
    const fake = userService();

    const reply = await callHandler(handlersOver(fake).setRootAdmin, stubRequest({ params: { userId: 'user-2' }, body: { isRootAdmin: true }, authUser: admin }));

    expect(fake.setRootAdmin).toHaveBeenCalledWith(actorOf(admin), 'user-2', true);
    expect(reply.body).toEqual({ success: true });
  });
});
