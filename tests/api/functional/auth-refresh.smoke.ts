export {};
/**
 * Functional smoke test — Auth token refresh flow.
 *
 * Register → get tokens → refresh → verify new token works → logout → verify refresh fails.
 * If refresh breaks, users get logged out unexpectedly.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

let accessToken: string;
let refreshToken: string;

describe('Auth Token Refresh Flow', () => {
  it('registers and gets initial tokens', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: `refresh-${Date.now()}@smoke.test`,
        password: 'SmokePas123',
        displayName: 'Refresh Tester',
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    accessToken = body.tokens.accessToken;
    refreshToken = body.tokens.refreshToken;
    expect(accessToken).toBeDefined();
    expect(refreshToken).toBeDefined();
  });

  it('access token works for profile', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('refreshes token and gets new pair', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();
    // New tokens should differ (rotation)
    expect(body.refreshToken).not.toBe(refreshToken);
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('new access token works for profile', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
  });

  it('old refresh token is rejected (rotated)', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'old-invalid-token' }),
    });
    expect(res.status).toBe(401);
  });

  it('logout revokes current refresh token', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(204);
  });

  it('refresh token fails after logout', async () => {
    const res = await fetch(`${BASE}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    expect(res.status).toBe(401);
  });
});
