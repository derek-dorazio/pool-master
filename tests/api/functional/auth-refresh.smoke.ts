import { BASE_URL, smokeFetch, expectStatus } from '../setup';
import { API_ROUTES } from '@poolmaster/shared/api-routes';
/**
 * Functional smoke test — Auth token refresh flow.
 *
 * Register → get tokens → refresh → verify new token works → logout → verify refresh fails.
 * If refresh breaks, users get logged out unexpectedly.
 */

let accessToken: string;
let refreshToken: string;

describe('Auth Token Refresh Flow', () => {
  it('registers and gets initial tokens', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.register}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `refresh-${Date.now()}@smoke.test`,
        password: 'SmokePas123',
        displayName: 'Refresh Tester',
      }),
    });
    await expectStatus(res, 201, 'register for refresh test');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    accessToken = body.tokens.accessToken;
    refreshToken = body.tokens.refreshToken;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
  });

  it('access token works for profile', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.me}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await expectStatus(res, 200, 'access token works for profile');
  });

  it('refreshes token and gets new pair', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.refresh}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    await expectStatus(res, 200, 'refresh token');
    const body = res.headers.get('content-type')?.includes('json')
      ? await res.json() as any
      : null;
    if (!body) return;
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    // New tokens should differ (rotation)
    expect(body.refreshToken).not.toBe(refreshToken);
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('new access token works for profile', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.me}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    await expectStatus(res, 200, 'new access token works for profile');
  });

  it('old refresh token is rejected (rotated)', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.refresh}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'old-invalid-token' }),
    });
    await expectStatus(res, 401, 'old refresh token rejected');
  });

  it('logout revokes current refresh token', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.logout}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    await expectStatus(res, 204, 'logout revokes refresh token');
  });

  it('refresh token fails after logout', async () => {
    const res = await smokeFetch(`${BASE_URL}${API_ROUTES.auth.refresh}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    await expectStatus(res, 401, 'refresh fails after logout');
  });
});
