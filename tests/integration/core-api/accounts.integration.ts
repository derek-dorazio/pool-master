/**
 * Accounts and sign-in through the real routes, the real auth guard and Postgres.
 *
 * Each case drives the HTTP surface a browser or the SDK uses — register, login, refresh,
 * logout, and the `/users/:userId` operations — and then checks what the database holds,
 * because a session is only as revoked as its refresh-token row.
 *
 * Cookie sessions are exercised with the cookies the API itself set, so the CSRF check and the
 * cookie parsing are the production ones.
 */
import { randomUUID } from 'node:crypto';
import type { LightMyRequestResponse } from 'fastify';
import type { AuthResponse, UserListResponse, UserResponse } from '@poolmaster/shared/dto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import {
  buildCreateLeaguePayload,
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

const PASSWORD = 'CorrectHorse9';

/** A fresh identity each call, inside the integration email domain cleanup removes. */
function newIdentity() {
  const tag = randomUUID().slice(0, 8);
  return { username: `acct-${tag}`, email: `acct-${tag}@integration.test` };
}

async function register(identity = newIdentity(), password = PASSWORD) {
  const response = await getApp().inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { ...identity, password, firstName: 'Ada', lastName: 'Account' },
  });
  return { response, identity, password };
}

async function login(identifier: string, password = PASSWORD) {
  return getApp().inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { identifier, password },
  });
}

/** The session cookies core-api sets; any one may be absent from a given response. */
type SessionCookies = {
  poolmaster_access?: string;
  poolmaster_refresh?: string;
  poolmaster_csrf?: string;
};

/** `name=value` pairs from the response's Set-Cookie headers, as a browser would send them back. */
function cookiesFrom(response: LightMyRequestResponse): SessionCookies {
  return Object.fromEntries(response.cookies.map((cookie) => [cookie.name, cookie.value]));
}

function cookieHeader(cookies: SessionCookies): string {
  return Object.entries(cookies)
    .flatMap(([name, value]) => (value === undefined ? [] : [`${name}=${encodeURIComponent(value)}`]))
    .join('; ');
}

/** Signs in and returns everything a browser would hold afterwards. */
async function signedIn() {
  const { response, identity } = await register();
  expect(response.statusCode).toBe(201);
  const body = response.json<AuthResponse>();
  const cookies = cookiesFrom(response);
  return {
    identity,
    userId: body.user.id,
    accessToken: body.tokens.accessToken,
    refreshToken: body.tokens.refreshToken,
    cookies,
    bearer: { authorization: `Bearer ${body.tokens.accessToken}` },
    /** A cookie session's headers for a state-changing request, CSRF header included. */
    cookieSession: {
      cookie: cookieHeader(cookies),
      'x-csrf-token': cookies.poolmaster_csrf ?? '',
    },
  };
}

async function liveRefreshTokens(userId: string): Promise<number> {
  return getPrisma().refreshToken.count({ where: { userId, revokedAt: null } });
}

function errorCode(response: LightMyRequestResponse): string {
  return response.json<{ error: { code: string } }>().error.code;
}

describe('registration', () => {
  it('creates the account with a lowercased email and username, and starts a cookie session', async () => {
    const tag = randomUUID().slice(0, 8);
    const { response } = await register({ username: `Mixed-${tag}`, email: `Mixed-${tag}@Integration.Test` });

    expect(response.statusCode).toBe(201);
    const body = response.json<AuthResponse>();
    expect(body.user.username).toBe(`mixed-${tag}`);
    expect(body.user.email).toBe(`mixed-${tag}@integration.test`);
    expect(body.user.isRootAdmin).toBe(false);
    expect(Object.keys(cookiesFrom(response)).sort()).toEqual(['poolmaster_access', 'poolmaster_csrf', 'poolmaster_refresh']);
    expect(await liveRefreshTokens(body.user.id)).toBe(1);
  });

  it('refuses an email already in use, whatever its case, with 409 EMAIL_EXISTS', async () => {
    const first = await register();
    const second = await register({ username: newIdentity().username, email: first.identity.email.toUpperCase() });

    expect(second.response.statusCode).toBe(409);
    expect(errorCode(second.response)).toBe('EMAIL_EXISTS');
  });

  it('refuses a username already in use with 409 USERNAME_EXISTS', async () => {
    const first = await register();
    const second = await register({ username: first.identity.username, email: newIdentity().email });

    expect(second.response.statusCode).toBe(409);
    expect(errorCode(second.response)).toBe('USERNAME_EXISTS');
  });

  it('refuses a username equal to another account\'s email, since sign-in accepts either', async () => {
    const first = await register();
    const second = await register({ username: first.identity.email, email: newIdentity().email });

    expect(second.response.statusCode).toBe(409);
    expect(errorCode(second.response)).toBe('USERNAME_EXISTS');
  });

  it('rejects a password shorter than eight characters with 400 before creating anything', async () => {
    const identity = newIdentity();
    const { response } = await register(identity, 'short');

    expect(response.statusCode).toBe(400);
    expect(await getPrisma().user.count({ where: { email: identity.email } })).toBe(0);
  });
});

describe('login', () => {
  it('accepts the email or the username in any case and issues a new session each time', async () => {
    const { identity, userId } = await signedIn();

    const byEmail = await login(identity.email.toUpperCase());
    const byUsername = await login(` ${identity.username.toUpperCase()} `);

    expect(byEmail.statusCode).toBe(200);
    expect(byUsername.statusCode).toBe(200);
    expect(byUsername.json<AuthResponse>().user.id).toBe(userId);
    expect(await liveRefreshTokens(userId)).toBe(3);
  });

  it('answers a wrong password and an unknown account with the same 401, so neither reveals the other', async () => {
    const { identity } = await signedIn();

    const wrongPassword = await login(identity.email, 'NotThePassword1');
    const unknown = await login(`nobody-${randomUUID()}@integration.test`);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknown.statusCode).toBe(401);
    expect(wrongPassword.json()).toEqual(unknown.json());
    expect(errorCode(unknown)).toBe('INVALID_CREDENTIALS');
  });
});

describe('refresh and logout', () => {
  it('rotates the refresh cookie: the new one works, the old one is refused, and the session id is kept', async () => {
    const session = await signedIn();

    const rotated = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      headers: { cookie: cookieHeader(session.cookies) },
    });
    expect(rotated.statusCode).toBe(200);
    const nextRefresh = cookiesFrom(rotated).poolmaster_refresh;
    expect(nextRefresh).toBeDefined();
    expect(nextRefresh).not.toBe(session.refreshToken);

    const replayed = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });
    expect(replayed.statusCode).toBe(401);
    expect(errorCode(replayed)).toBe('INVALID_REFRESH_TOKEN');

    const rows = await getPrisma().refreshToken.findMany({ where: { userId: session.userId } });
    expect(new Set(rows.map((row) => row.sessionId)).size).toBe(1);
    expect(rows.filter((row) => row.revokedAt === null).map((row) => row.token)).toEqual([nextRefresh]);
  });

  it('refuses an expired refresh token with 401', async () => {
    const session = await signedIn();
    await getPrisma().refreshToken.update({
      where: { token: session.refreshToken },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });

    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('INVALID_REFRESH_TOKEN');
  });

  it('refreshes the session of an inactive account, which stays signed in so it can reactivate', async () => {
    const session = await signedIn();
    await getPrisma().user.update({ where: { id: session.userId }, data: { isActive: false } });

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken: session.refreshToken },
    });

    expect(response.statusCode).toBe(200);
  });

  it('logs out by revoking the cookie session\'s refresh token and clearing all three cookies', async () => {
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: cookieHeader(session.cookies) },
    });

    expect(response.statusCode).toBe(200);
    expect(response.cookies.every((cookie) => cookie.value === '' && cookie.maxAge === 0)).toBe(true);
    expect(await liveRefreshTokens(session.userId)).toBe(0);
  });
});

describe('the auth guard', () => {
  it('refuses a state-changing cookie-session request without the CSRF header with 403', async () => {
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/revoke-sessions',
      headers: { cookie: session.cookieSession.cookie },
    });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe('AUTH_CSRF_INVALID');
    expect(await liveRefreshTokens(session.userId)).toBe(1);
  });

  it('still reads the session cookie when another cookie on the request is not valid percent-encoding', async () => {
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { cookie: `site_tracker=%E0%A4%A; ${session.cookieSession.cookie}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserResponse>().user.id).toBe(session.userId);
  });

  it('logs out a cookie session even when another cookie on the request is not valid percent-encoding', async () => {
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `site_tracker=100%; ${session.cookieSession.cookie}` },
    });

    expect(response.statusCode).toBe(200);
    expect(await liveRefreshTokens(session.userId)).toBe(0);
  });

  it('answers a request with no session at all with 401 AUTH_SESSION_REQUIRED', async () => {
    const response = await getApp().inject({ method: 'GET', url: '/api/v1/users/me' });

    expect(response.statusCode).toBe(401);
    expect(errorCode(response)).toBe('AUTH_SESSION_REQUIRED');
  });
});

describe('reading and listing users', () => {
  it('lets a user read themselves through `me` and refuses them another user with 403 USER_READ_FORBIDDEN', async () => {
    const session = await signedIn();
    const other = await createTestUser();

    const me = await getApp().inject({ method: 'GET', url: '/api/v1/users/me', headers: session.bearer });
    const someoneElse = await getApp().inject({ method: 'GET', url: `/api/v1/users/${other.user.id}`, headers: session.bearer });

    expect(me.json<UserResponse>().user.email).toBe(session.identity.email);
    expect(someoneElse.statusCode).toBe(403);
    expect(errorCode(someoneElse)).toBe('USER_READ_FORBIDDEN');
  });

  it('lets a root admin list users filtered by a search term, and refuses everyone else with 403', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();

    const listed = await getApp().inject({
      method: 'GET',
      url: `/api/v1/users?search=${session.identity.username}`,
      headers: admin.headers,
    });
    const refused = await getApp().inject({ method: 'GET', url: '/api/v1/users', headers: session.bearer });

    expect(listed.json<UserListResponse>().users.map((user) => user.id)).toEqual([session.userId]);
    expect(refused.statusCode).toBe(403);
    expect(errorCode(refused)).toBe('ROOT_ADMIN_ACCESS_REQUIRED');
  });

  it('answers a root admin asking for a user id that is not a uuid with 400, not a server error', async () => {
    const admin = await createTestUser({ isRootAdmin: true });

    const response = await getApp().inject({ method: 'GET', url: '/api/v1/users/not-a-user-id', headers: admin.headers });

    expect(response.statusCode).toBe(400);
  });

  it('answers a root admin asking for a well-formed id nobody holds with 404 USER_NOT_FOUND', async () => {
    const admin = await createTestUser({ isRootAdmin: true });

    const response = await getApp().inject({ method: 'GET', url: `/api/v1/users/${randomUUID()}`, headers: admin.headers });

    expect(response.statusCode).toBe(404);
    expect(errorCode(response)).toBe('USER_NOT_FOUND');
  });
});

describe('profile, username and preferences', () => {
  it('saves a lowercased email and trimmed names, and refuses one another account holds with 409 ACCOUNT_EMAIL_TAKEN', async () => {
    const session = await signedIn();
    const other = await signedIn();
    const fresh = newIdentity().email;

    const saved = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/profile',
      headers: session.bearer,
      payload: { email: fresh.toUpperCase(), firstName: ' Grace ', lastName: 'Hopper' },
    });
    const taken = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/profile',
      headers: session.bearer,
      payload: { email: other.identity.email, firstName: 'Grace', lastName: 'Hopper' },
    });

    expect(saved.json<UserResponse>().user).toMatchObject({ email: fresh, firstName: 'Grace' });
    expect(taken.statusCode).toBe(409);
    expect(errorCode(taken)).toBe('ACCOUNT_EMAIL_TAKEN');
  });

  it('lets a user keep their own username and refuses another account\'s with 409 ACCOUNT_USERNAME_TAKEN', async () => {
    const session = await signedIn();
    const other = await signedIn();

    const same = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/username',
      headers: session.bearer,
      payload: { username: session.identity.username.toUpperCase() },
    });
    const taken = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/username',
      headers: session.bearer,
      payload: { username: other.identity.username },
    });

    expect(same.statusCode).toBe(200);
    expect(taken.statusCode).toBe(409);
    expect(errorCode(taken)).toBe('ACCOUNT_USERNAME_TAKEN');
  });

  it('leaves an omitted preference unchanged and clears one sent as null', async () => {
    const session = await signedIn();
    await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/preferences',
      headers: session.bearer,
      payload: { timezone: 'America/New_York', locale: 'en-GB' },
    });

    const response = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/users/me/preferences',
      headers: session.bearer,
      payload: { timezone: null },
    });

    expect(response.statusCode).toBe(200);
    const stored = await getPrisma().user.findUniqueOrThrow({ where: { id: session.userId } });
    expect(stored.timezone).toBeNull();
    expect(stored.locale).toBe('en-GB');
  });

  it('refuses a user editing somebody else\'s profile with 403 USER_WRITE_FORBIDDEN and changes nothing', async () => {
    const session = await signedIn();
    const other = await signedIn();

    const response = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/users/${other.userId}/profile`,
      headers: session.bearer,
      payload: { email: newIdentity().email, firstName: 'Mallory', lastName: 'Intruder' },
    });

    expect(response.statusCode).toBe(403);
    expect(errorCode(response)).toBe('USER_WRITE_FORBIDDEN');
    expect((await getPrisma().user.findUniqueOrThrow({ where: { id: other.userId } })).firstName).toBe('Ada');
  });
});

describe('passwords', () => {
  it('changes the password, keeps the caller\'s cookie session and revokes every other session', async () => {
    const session = await signedIn();
    await login(session.identity.email);
    expect(await liveRefreshTokens(session.userId)).toBe(2);

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: { ...session.cookieSession, 'content-type': 'application/json' },
      payload: { currentPassword: PASSWORD, newPassword: 'BatteryStaple7', confirmNewPassword: 'BatteryStaple7' },
    });

    expect(response.statusCode).toBe(200);
    const live = await getPrisma().refreshToken.findMany({ where: { userId: session.userId, revokedAt: null } });
    expect(live.map((row) => row.token)).toEqual([session.refreshToken]);
    expect((await login(session.identity.email)).statusCode).toBe(401);
    expect((await login(session.identity.email, 'BatteryStaple7')).statusCode).toBe(200);
  });

  it('refuses a wrong current password with 400 INVALID_CURRENT_PASSWORD and a mismatched confirmation with 400', async () => {
    const session = await signedIn();

    const wrongCurrent = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: session.bearer,
      payload: { currentPassword: 'NotIt12345', newPassword: 'BatteryStaple7', confirmNewPassword: 'BatteryStaple7' },
    });
    const mismatch = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/password',
      headers: session.bearer,
      payload: { currentPassword: PASSWORD, newPassword: 'BatteryStaple7', confirmNewPassword: 'BatteryStaple8' },
    });

    expect(errorCode(wrongCurrent)).toBe('INVALID_CURRENT_PASSWORD');
    expect(errorCode(mismatch)).toBe('PASSWORD_CONFIRMATION_MISMATCH');
    expect((await login(session.identity.email)).statusCode).toBe(200);
  });

  it('lets a root admin reset a password: the temporary one signs in and every old session is revoked', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/reset-password`,
      headers: withoutJsonBodyHeaders(admin.headers),
    });

    expect(response.statusCode).toBe(200);
    expect(await liveRefreshTokens(session.userId)).toBe(0);
    const { temporaryPassword } = response.json<{ temporaryPassword: string }>();
    expect((await login(session.identity.email, temporaryPassword)).statusCode).toBe(200);
    expect((await login(session.identity.email)).statusCode).toBe(401);
  });

  it('refuses a password reset from a user who is not a root admin with 403', async () => {
    const session = await signedIn();
    const other = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${other.userId}/reset-password`,
      headers: session.bearer,
    });

    expect(response.statusCode).toBe(403);
    expect((await login(other.identity.email)).statusCode).toBe(200);
  });
});

describe('account lifecycle', () => {
  it('inactivating your own account keeps your session, revokes the others, and lets you reactivate', async () => {
    const session = await signedIn();
    await login(session.identity.email);

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/disable',
      headers: session.cookieSession,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserResponse>().user.isActive).toBe(false);
    expect(response.cookies).toEqual([]);
    const live = await getPrisma().refreshToken.findMany({ where: { userId: session.userId, revokedAt: null } });
    expect(live.map((row) => row.token)).toEqual([session.refreshToken]);

    const reactivated = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/enable',
      headers: session.cookieSession,
    });
    expect(reactivated.json<UserResponse>().user.isActive).toBe(true);
  });

  it('an account a root admin disabled loses every session but can sign in again, as inactive, to reactivate', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();

    await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/disable`,
      headers: withoutJsonBodyHeaders(admin.headers),
    });
    expect(await liveRefreshTokens(session.userId)).toBe(0);

    const signIn = await login(session.identity.email);
    expect(signIn.statusCode).toBe(200);
    expect(signIn.json<AuthResponse>().user.isActive).toBe(false);
  });

  it('lets a root admin disable and re-enable a user without touching the admin\'s own cookies', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();

    const disabled = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/disable`,
      headers: withoutJsonBodyHeaders(admin.headers),
    });
    const enabled = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/enable`,
      headers: withoutJsonBodyHeaders(admin.headers),
    });

    expect(disabled.cookies).toEqual([]);
    expect(enabled.cookies).toEqual([]);
    expect(enabled.json<UserResponse>().user.isActive).toBe(true);
    expect((await login(session.identity.email)).statusCode).toBe(200);
  });

  it('revoking your own sessions revokes every refresh token and clears the cookies', async () => {
    const session = await signedIn();
    await login(session.identity.email);

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/revoke-sessions',
      headers: session.bearer,
    });

    expect(response.json<{ revokedCount: number }>().revokedCount).toBe(2);
    expect(response.cookies.every((cookie) => cookie.maxAge === 0)).toBe(true);
    expect(await liveRefreshTokens(session.userId)).toBe(0);
  });

  it('refuses to delete an active account with 409 and a mistyped confirmation email with 400, then deletes it', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();
    const deleteWith = (email: string) => getApp().inject({
      method: 'DELETE',
      url: `/api/v1/users/${session.userId}`,
      headers: admin.headers,
      payload: { email },
    });

    const whileActive = await deleteWith(session.identity.email);
    await getPrisma().user.update({ where: { id: session.userId }, data: { isActive: false } });
    const mistyped = await deleteWith(`x${session.identity.email}`);
    expect(await getPrisma().user.findUnique({ where: { id: session.userId } })).not.toBeNull();
    expect(await liveRefreshTokens(session.userId)).toBe(1);
    const deleted = await deleteWith(session.identity.email);

    expect(errorCode(whileActive)).toBe('ACCOUNT_DELETE_REQUIRES_INACTIVE');
    expect(errorCode(mistyped)).toBe('ACCOUNT_DELETE_CONFIRMATION_MISMATCH');
    expect(deleted.statusCode).toBe(200);
    expect(await getPrisma().user.findUnique({ where: { id: session.userId } })).toBeNull();
    expect(await getPrisma().refreshToken.count({ where: { userId: session.userId } })).toBe(0);
  });
  it('treats disabling an account that is already inactive as a no-op that leaves its sessions alone', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();
    await getPrisma().user.update({ where: { id: session.userId }, data: { isActive: false } });
    const before = await getPrisma().user.findUniqueOrThrow({ where: { id: session.userId } });

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/disable`,
      headers: withoutJsonBodyHeaders(admin.headers),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<UserResponse>().user.isActive).toBe(false);
    expect(await liveRefreshTokens(session.userId)).toBe(1);
    expect((await getPrisma().user.findUniqueOrThrow({ where: { id: session.userId } })).updatedAt).toEqual(before.updatedAt);
  });

  it('refuses to delete an inactive account that still belongs to a league with 409, and keeps it', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();
    const league = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: session.bearer,
      payload: buildCreateLeaguePayload('Blocks Account Delete'),
    });
    expect(league.statusCode).toBe(201);
    await getPrisma().user.update({ where: { id: session.userId }, data: { isActive: false } });

    const response = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/users/${session.userId}`,
      headers: admin.headers,
      payload: { email: session.identity.email },
    });

    expect(errorCode(response)).toBe('ACCOUNT_DELETE_DEPENDENCIES_EXIST');
    expect(await getPrisma().user.findUnique({ where: { id: session.userId } })).not.toBeNull();
    expect(await liveRefreshTokens(session.userId)).toBe(1);
  });
});

describe('the root-admin role', () => {
  it('grants the role without signing anyone out, takes effect on the next sign-in, and revokes sessions on removal', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const session = await signedIn();
    const setRole = (isRootAdmin: boolean) => getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${session.userId}/root-admin`,
      headers: admin.headers,
      payload: { isRootAdmin },
    });

    expect((await setRole(true)).statusCode).toBe(200);
    expect(await liveRefreshTokens(session.userId)).toBe(1);
    const stillOldToken = await getApp().inject({ method: 'GET', url: '/api/v1/users', headers: session.bearer });
    const relogin = (await login(session.identity.email)).json<AuthResponse>();
    const withNewToken = await getApp().inject({
      method: 'GET',
      url: '/api/v1/users',
      headers: { authorization: `Bearer ${relogin.tokens.accessToken}` },
    });

    expect(stillOldToken.statusCode).toBe(403);
    expect(withNewToken.statusCode).toBe(200);

    expect((await setRole(false)).statusCode).toBe(200);
    expect(await liveRefreshTokens(session.userId)).toBe(0);
  });

  it('refuses a user who is not a root admin granting themselves the role with 403', async () => {
    const session = await signedIn();

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/root-admin',
      headers: session.bearer,
      payload: { isRootAdmin: true },
    });

    expect(response.statusCode).toBe(403);
    expect((await getPrisma().user.findUniqueOrThrow({ where: { id: session.userId } })).isRootAdmin).toBe(false);
  });

  it('lets a root admin step down while another root admin remains', async () => {
    await createTestUser({ isRootAdmin: true });
    const admin = await createTestUser({ isRootAdmin: true });

    const response = await getApp().inject({
      method: 'POST',
      url: '/api/v1/users/me/root-admin',
      headers: admin.headers,
      payload: { isRootAdmin: false },
    });

    expect(response.statusCode).toBe(200);
    expect((await getPrisma().user.findUniqueOrThrow({ where: { id: admin.user.id } })).isRootAdmin).toBe(false);
  });

  it('treats granting the role to a user who already holds it as a no-op that writes nothing', async () => {
    const admin = await createTestUser({ isRootAdmin: true });
    const other = await createTestUser({ isRootAdmin: true });
    const before = await getPrisma().user.findUniqueOrThrow({ where: { id: other.user.id } });

    const response = await getApp().inject({
      method: 'POST',
      url: `/api/v1/users/${other.user.id}/root-admin`,
      headers: admin.headers,
      payload: { isRootAdmin: true },
    });

    expect(response.statusCode).toBe(200);
    const after = await getPrisma().user.findUniqueOrThrow({ where: { id: other.user.id } });
    expect(after.isRootAdmin).toBe(true);
    expect(after.updatedAt).toEqual(before.updatedAt);
  });
});
