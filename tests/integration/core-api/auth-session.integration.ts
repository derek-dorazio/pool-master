import {
  cleanupTestData,
  getApp,
  setupIntegrationTests,
  teardownIntegrationTests,
  createTestUser,
} from '../helpers';
import { randomUUID } from 'node:crypto';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
import { ErrorEnvelopeSchema } from '@poolmaster/shared/dto/errors.dto';
import { LeagueVisibility } from '@poolmaster/shared/domain';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

function buildCookieHeader(setCookieHeaders: string[]): string {
  return setCookieHeaders
    .map((header) => header.split(';')[0])
    .join('; ');
}

function extractCookieValue(setCookieHeaders: string[], name: string): string | undefined {
  return setCookieHeaders
    .map((header) => header.split(';')[0] ?? '')
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

describe('Auth session integration', () => {
  it('issues cookie-backed sessions, resolves /auth/me from cookies, and enforces CSRF on writes', async () => {
    const registerRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.register,
      payload: {
        email: `cookie-auth-${randomUUID().slice(0, 8)}@integration.test`,
        password: 'TestPass123',
        displayName: 'Cookie Auth User',
      },
    });

    expect(registerRes.statusCode).toBe(201);
    const setCookie = registerRes.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);

    const cookieHeader = buildCookieHeader(setCookie as string[]);
    const csrfToken = extractCookieValue(setCookie as string[], 'poolmaster_csrf');
    expect(cookieHeader).toContain('poolmaster_access=');
    expect(cookieHeader).toContain('poolmaster_refresh=');
    expect(csrfToken).toBeTruthy();

    const meRes = await getApp().inject({
      method: 'GET',
      url: API_ROUTES.auth.me,
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(meRes.statusCode).toBe(200);
    expect(meRes.json().user.email).toContain('cookie-auth-');

    const missingCsrfRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: {
        cookie: cookieHeader,
      },
      payload: {
        name: 'CSRF Blocked League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(missingCsrfRes.statusCode).toBe(403);
    expect(ErrorEnvelopeSchema.safeParse(missingCsrfRes.json()).success).toBe(true);

    const createLeagueRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.leagues.create,
      headers: {
        cookie: cookieHeader,
        'x-csrf-token': decodeURIComponent(csrfToken ?? ''),
      },
      payload: {
        name: 'Cookie Session League',
        visibility: LeagueVisibility.PRIVATE,
      },
    });

    expect(createLeagueRes.statusCode).toBe(201);
    expect(createLeagueRes.json().league.name).toBe('Cookie Session League');
  });

  it('allows root-admin routes to use the same cookie-backed session model', async () => {
    const rootAdminEmail = `cookie-root-admin-${randomUUID().slice(0, 8)}@integration.test`;
    await createTestUser({
      email: rootAdminEmail,
      displayName: 'Cookie Root Admin',
      password: 'TestPass123',
      isRootAdmin: true,
    });

    const loginRes = await getApp().inject({
      method: 'POST',
      url: API_ROUTES.auth.login,
      payload: {
        email: rootAdminEmail,
        password: 'TestPass123',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const loginPayload = loginRes.json();
    const cookieHeader = [
      `poolmaster_access=${encodeURIComponent(loginPayload.tokens.accessToken)}`,
      `poolmaster_refresh=${encodeURIComponent(loginPayload.tokens.refreshToken)}`,
      `poolmaster_csrf=${encodeURIComponent(loginPayload.tokens.csrfToken)}`,
    ].join('; ');

    const rootAdminRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/admin/users',
      headers: {
        cookie: cookieHeader,
      },
    });

    expect(rootAdminRes.statusCode).toBe(200);
  });
});
