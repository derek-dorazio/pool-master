/**
 * The auth route handlers (#1482), called with stand-in auth, password reset and email change
 * undo services: which session cookies each answer sets or clears, where a refresh token is read
 * from, the status each refusal is sent with, and that an error the handler does not own reaches
 * the global error handler unchanged.
 */
import { expect } from '@jest/globals';
import { AuthError, type AuthService } from '../../../packages/core-api/src/modules/auth/auth-service';
import { EmailChangeUndoError, type EmailChangeUndoService } from '../../../packages/core-api/src/modules/auth/email-change-undo-service';
import { createAuthHandlers } from '../../../packages/core-api/src/modules/auth/handler';
import { PasswordResetError, type PasswordResetService } from '../../../packages/core-api/src/modules/auth/password-reset-service';
import { buildUser } from '../../factories';
import { callHandler, stubRequest } from '../../support/handler-call';

const boom = new Error('database down');
const tokens = { accessToken: 'a', refreshToken: 'r', csrfToken: 'c', expiresIn: 900, sessionId: 's' };
const session = { user: buildUser({ id: 'user-1' }), tokens };
const cookie = 'poolmaster_refresh=cookie-token';
const rejected = new AuthError('Wrong password', 'INVALID_CREDENTIALS');

function auth(overrides: Record<string, unknown> = {}) {
  return {
    register: jest.fn((..._args: unknown[]) => Promise.resolve(session)),
    login: jest.fn((..._args: unknown[]) => Promise.resolve(session)),
    refresh: jest.fn((..._args: unknown[]) => Promise.resolve(tokens)),
    logout: jest.fn((..._args: unknown[]) => Promise.resolve()),
    ...overrides,
  };
}
function resets(overrides: Record<string, unknown> = {}) {
  return {
    assertRequestAllowed: jest.fn(),
    requestReset: jest.fn((..._args: unknown[]) => Promise.resolve()),
    assertConfirmAllowed: jest.fn(),
    confirmReset: jest.fn((..._args: unknown[]) => Promise.resolve()),
    ...overrides,
  };
}
function undos(overrides: Record<string, unknown> = {}) {
  return { assertUndoAllowed: jest.fn(), undo: jest.fn((..._args: unknown[]) => Promise.resolve()), ...overrides };
}
const handlersOver = (a = auth(), r = resets(), u = undos()) => createAuthHandlers(
  a as unknown as AuthService,
  r as unknown as PasswordResetService,
  u as unknown as EmailChangeUndoService,
);
const registration = { username: 'ada', email: 'Ada@Example.test', password: 'pw', firstName: 'Ada', lastName: 'L', timezone: 'UTC' };
const sessionCookies = expect.arrayContaining([expect.stringContaining('poolmaster_refresh=r')]) as unknown;

describe('register and login handlers', () => {
  it('registers an account with 201, its session cookies and the user without the session id', async () => {
    const fake = auth();

    const reply = await callHandler(handlersOver(fake).register, stubRequest({ body: registration, contextLogger: false }));

    expect(fake.register).toHaveBeenCalledWith('ada', 'Ada@Example.test', 'pw', 'Ada', 'L', { timezone: 'UTC', locale: undefined });
    expect(reply).toMatchObject({ statusCode: 201, headers: { 'set-cookie': sessionCookies }, body: { user: { id: 'user-1' }, tokens: { refreshToken: 'r' } } });
    expect((reply.body as { tokens: object }).tokens).not.toHaveProperty('sessionId');
  });

  it('signs in with an email or a username, answering with the session cookies', async () => {
    const fake = auth();
    const handlers = handlersOver(fake);

    const byEmail = await callHandler(handlers.login, stubRequest({ body: { identifier: 'ada@example.test', password: 'pw' }, contextLogger: false }));
    await callHandler(handlers.login, stubRequest({ body: { identifier: 'ada', password: '' } }));

    expect(byEmail).toMatchObject({ statusCode: 200, headers: { 'set-cookie': sessionCookies }, body: { user: { id: 'user-1' } } });
    expect(fake.login.mock.calls).toEqual([['ada@example.test', 'pw'], ['ada', '']]);
  });

  it.each([
    ['register', 'register', () => stubRequest({ body: { ...registration, email: 'no-domain' } })],
    ['login', 'login', () => stubRequest({ body: { identifier: 'ada', password: 'pw' } })],
  ] as const)('%s answers a refused attempt with the error\'s own status and code, and passes anything else on', async (handler, method, request) => {
    const refused = handlersOver(auth({ [method]: () => Promise.reject(rejected) }));
    const broken = handlersOver(auth({ [method]: () => Promise.reject(boom) }));

    expect(await callHandler(refused[handler], request())).toMatchObject({ statusCode: 401, body: { error: { code: 'INVALID_CREDENTIALS' } } });
    await expect(callHandler(broken[handler], request())).rejects.toBe(boom);
  });
});

describe('refresh and logout handlers', () => {
  it('refreshes with the body\'s token over the cookie\'s, and with the cookie\'s when the body has none', async () => {
    const fake = auth();
    const handlers = handlersOver(fake);

    const fromBody = await callHandler(handlers.refresh, stubRequest({ body: { refreshToken: 'body-token' }, headers: { cookie }, contextLogger: false }));
    await callHandler(handlers.refresh, stubRequest({ headers: { cookie } }));

    expect(fake.refresh.mock.calls).toEqual([['body-token'], ['cookie-token']]);
    expect(fromBody).toMatchObject({ headers: { 'set-cookie': sessionCookies }, body: { accessToken: 'a', refreshToken: 'r' } });
  });

  it('refuses a refresh with no token anywhere with 401 INVALID_REFRESH_TOKEN', async () => {
    const fake = auth();

    const reply = await callHandler(handlersOver(fake).refresh, stubRequest({ body: {} }));

    expect(reply).toMatchObject({ statusCode: 401, body: { error: { code: 'INVALID_REFRESH_TOKEN' } } });
    expect(fake.refresh).not.toHaveBeenCalled();
  });

  it('answers a refused refresh with its own status and code, and passes anything else on', async () => {
    const request = () => stubRequest({ body: { refreshToken: 'stale' } });
    const refused = handlersOver(auth({ refresh: () => Promise.reject(new AuthError('Revoked', 'INVALID_REFRESH_TOKEN')) }));
    const broken = handlersOver(auth({ refresh: () => Promise.reject(boom) }));

    expect(await callHandler(refused.refresh, request())).toMatchObject({ statusCode: 401, body: { error: { code: 'INVALID_REFRESH_TOKEN' } } });
    await expect(callHandler(broken.refresh, request())).rejects.toBe(boom);
  });

  it('revokes the session a logout names, and clears the cookies whether or not it names one', async () => {
    const fake = auth();
    const handlers = handlersOver(fake);

    const withToken = await callHandler(handlers.logout, stubRequest({ headers: { cookie }, contextLogger: false }));
    const without = await callHandler(handlers.logout, stubRequest({}));

    expect(fake.logout).toHaveBeenCalledTimes(1);
    expect(fake.logout).toHaveBeenCalledWith('cookie-token');
    for (const reply of [withToken, without]) {
      expect(reply).toMatchObject({ body: { success: true }, headers: { 'set-cookie': expect.arrayContaining([expect.stringContaining('Max-Age=0')]) as unknown } });
    }
  });
});

describe('password reset and email change undo handlers', () => {
  it('answers a reset request with 202 once its address is under the limit, and runs the reset for its identifier', async () => {
    const r = resets();

    const reply = await callHandler(handlersOver(auth(), r).requestPasswordReset, stubRequest({ body: { identifier: 'ada@example.test' }, ip: '10.0.0.1', contextLogger: false }));

    expect(r.assertRequestAllowed).toHaveBeenCalledWith('10.0.0.1');
    expect(r.requestReset).toHaveBeenCalledWith('ada@example.test');
    expect(reply).toMatchObject({ statusCode: 202, body: { success: true } });
  });

  it('refuses a rate-limited reset request with its own status and code, and runs no reset', async () => {
    const r = resets({ assertRequestAllowed: () => { throw new PasswordResetError('Slow down', 'PASSWORD_RESET_RATE_LIMITED', 429); } });

    const reply = await callHandler(handlersOver(auth(), r).requestPasswordReset, stubRequest({ body: { identifier: 'ada' } }));

    expect(reply).toMatchObject({ statusCode: 429, body: { error: { code: 'PASSWORD_RESET_RATE_LIMITED' } } });
    expect(r.requestReset).not.toHaveBeenCalled();
  });

  it('passes an unexpected failure checking the reset limit on to the global error handler', async () => {
    const r = resets({ assertRequestAllowed: () => { throw boom; } });

    await expect(callHandler(handlersOver(auth(), r).requestPasswordReset, stubRequest({ body: { identifier: 'ada' } }))).rejects.toBe(boom);
  });

  it('confirms a reset with the token and both passwords', async () => {
    const r = resets();
    const body = { token: 't', newPassword: 'n', confirmNewPassword: 'n' };

    const reply = await callHandler(handlersOver(auth(), r).confirmPasswordReset, stubRequest({ body, contextLogger: false }));

    expect(r.confirmReset).toHaveBeenCalledWith('t', 'n', 'n');
    expect(reply.body).toEqual({ success: true });
  });

  it('answers a refused reset confirm with its own status and code, and passes anything else on', async () => {
    const request = () => stubRequest({ body: { token: 't', newPassword: 'n', confirmNewPassword: 'n' } });
    const refused = handlersOver(auth(), resets({ confirmReset: () => Promise.reject(new PasswordResetError('Used', 'PASSWORD_RESET_LINK_INVALID', 400)) }));
    const broken = handlersOver(auth(), resets({ confirmReset: () => Promise.reject(boom) }));

    expect(await callHandler(refused.confirmPasswordReset, request())).toMatchObject({ statusCode: 400, body: { error: { code: 'PASSWORD_RESET_LINK_INVALID' } } });
    await expect(callHandler(broken.confirmPasswordReset, request())).rejects.toBe(boom);
  });

  it('undoes an email change, answers a refused one with its own status and code, and passes anything else on', async () => {
    const request = (contextLogger?: false) => stubRequest({ body: { token: 't' }, contextLogger });
    const u = undos();
    const refused = handlersOver(auth(), resets(), undos({ undo: () => Promise.reject(new EmailChangeUndoError('Taken', 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN', 409)) }));
    const broken = handlersOver(auth(), resets(), undos({ undo: () => Promise.reject(boom) }));

    expect((await callHandler(handlersOver(auth(), resets(), u).undoEmailChange, request(false))).body).toEqual({ success: true });
    expect(u.undo).toHaveBeenCalledWith('t');
    expect(await callHandler(refused.undoEmailChange, request())).toMatchObject({ statusCode: 409, body: { error: { code: 'EMAIL_CHANGE_UNDO_ADDRESS_TAKEN' } } });
    await expect(callHandler(broken.undoEmailChange, request())).rejects.toBe(boom);
  });
});
