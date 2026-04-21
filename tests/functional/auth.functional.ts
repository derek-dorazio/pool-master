import {
  createLeague,
  getCurrentUser,
  logoutUser,
  refreshToken,
} from '@poolmaster/shared/generated/hey-api';
import { randomUUID } from 'node:crypto';
import { buildRegisteredUser } from './builders';
import {
  cleanupFunctionalData,
  createCookieSessionClient,
  disconnectFunctionalPrisma,
  expectFunctionalError,
  getFunctionalPrisma,
} from './setup';

afterEach(async () => {
  await cleanupFunctionalData();
});

afterAll(async () => {
  await disconnectFunctionalPrisma();
});

describe('SDK Functional: Auth', () => {
  it('register -> login -> fetch profile succeeds through the SDK', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Auth Pilot User',
    });

    expect(user.registration.user.email).toBe(user.email);
    expect(user.registration.user.username).toBe(user.username);
    expect(user.login.user.id).toBe(user.userId);
    expect(user.registration.tokens.accessToken).toBeTruthy();
    expect(user.login.tokens.refreshToken).toBeTruthy();

    const { data: currentUser } = await getCurrentUser({
      client: user.client,
    });

    expect(currentUser).toBeDefined();
    expect(currentUser?.user.id).toBe(user.userId);
    expect(currentUser?.user.email).toBe(user.email);
    expect(currentUser?.user.username).toBe(user.username);
    expect(currentUser?.user.firstName).toBe(user.firstName);
    expect(currentUser?.user.lastName).toBe(user.lastName);
  });

  it('supports cookie-session auth for reads and refresh rotation through the SDK', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Cookie Session User',
    });
    const prisma = getFunctionalPrisma();

    const cookieClient = createCookieSessionClient(user.login.tokens);
    const originalRefreshToken = await prisma.refreshToken.findUniqueOrThrow({
      where: { token: user.login.tokens.refreshToken },
      select: {
        sessionId: true,
        revokedAt: true,
      },
    });

    const currentUser = await getCurrentUser({
      client: cookieClient,
    });

    expect(currentUser.data?.user.id).toBe(user.userId);
    expect(currentUser.data?.user.email).toBe(user.email);
    expect(currentUser.data?.user.username).toBe(user.username);

    const refreshResponse = await refreshToken({
      client: cookieClient,
    });

    expect(refreshResponse.data).toBeDefined();
    expect(refreshResponse.data?.accessToken).toBeTruthy();
    expect(refreshResponse.data?.refreshToken).toBeTruthy();
    expect(refreshResponse.data?.csrfToken).toBeTruthy();
    expect(refreshResponse.data?.refreshToken).not.toBe(user.login.tokens.refreshToken);

    const rotatedOriginalRefreshToken = await prisma.refreshToken.findUniqueOrThrow({
      where: { token: user.login.tokens.refreshToken },
      select: {
        sessionId: true,
        revokedAt: true,
      },
    });
    const rotatedRefreshToken = await prisma.refreshToken.findUniqueOrThrow({
      where: { token: refreshResponse.data!.refreshToken },
      select: {
        sessionId: true,
        revokedAt: true,
      },
    });

    expect(originalRefreshToken.sessionId).toBeTruthy();
    expect(rotatedOriginalRefreshToken.sessionId).toBe(originalRefreshToken.sessionId);
    expect(rotatedOriginalRefreshToken.revokedAt).toBeTruthy();
    expect(rotatedRefreshToken.sessionId).toBe(originalRefreshToken.sessionId);
    expect(rotatedRefreshToken.revokedAt).toBeNull();
  });

  it('requires a matching CSRF header for cookie-session state-changing requests', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Cookie CSRF User',
    });

    const cookieClientWithoutCsrf = createCookieSessionClient(user.login.tokens, {
      includeCsrfHeader: false,
    });

    const forbiddenCreate = await createLeague({
      client: cookieClientWithoutCsrf,
      body: {
        name: 'Cookie Session League',
        leagueCode: `COOKIE${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      },
    });

    expectFunctionalError(forbiddenCreate, {
      status: 403,
      code: 'AUTH_CSRF_INVALID',
    });

    const cookieClient = createCookieSessionClient(user.login.tokens);
    const successfulCreate = await createLeague({
      client: cookieClient,
      body: {
        name: 'Cookie Session League',
        leagueCode: `COOKIE${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`,
      },
    });

    expect(successfulCreate.data?.league.id).toBeTruthy();
    expect(successfulCreate.data?.league.role).toBe('COMMISSIONER');
  });

  it('revokes the refresh token on logout and rejects subsequent refresh attempts', async () => {
    const user = await buildRegisteredUser({
      displayName: 'Logout Session User',
    });
    const cookieClient = createCookieSessionClient(user.login.tokens);

    const logoutResponse = await logoutUser({
      client: cookieClient,
    });

    expect(logoutResponse.data?.success).toBe(true);

    const refreshResponse = await refreshToken({
      client: cookieClient,
    });

    expectFunctionalError(refreshResponse, {
      status: 401,
      code: 'INVALID_REFRESH_TOKEN',
    });
  });
});
