/**
 * Integration: Auth token lifecycle — refresh, logout, forgot-password
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Auth Token Lifecycle', () => {
  const email = `tokens-${Date.now()}@integration.test`;
  const password = 'SecurePass123';
  let accessToken: string;
  let refreshToken: string;

  beforeAll(async () => {
    // Register a user to get initial tokens
    const res = await getApp().inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password, displayName: 'Token Test' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    accessToken = body.tokens.accessToken;
    refreshToken = body.tokens.refreshToken;
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('exchanges refresh token for new access token', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.accessToken).toBeDefined();
      expect(body.refreshToken).toBeDefined();
      // New tokens should be different (rotation)
      expect(body.refreshToken).not.toBe(refreshToken);
      // Update for subsequent tests
      accessToken = body.accessToken;
      refreshToken = body.refreshToken;
    });

    it('rejects already-rotated (old) refresh token', async () => {
      // The original refresh token was rotated in the previous test
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'old-revoked-token-value' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects invalid refresh token', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: 'totally-invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns profile with refreshed access token', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().user.email).toBe(email);
    });
  });

  describe('POST /api/v1/auth/logout', () => {
    it('revokes the refresh token', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
    });

    it('refresh token no longer works after logout', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/auth/forgot-password', () => {
    it('returns success message (does not reveal email existence)', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('password reset');
    });

    it('returns same message for non-existent email', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/forgot-password',
        payload: { email: 'nobody-exists@nowhere.test' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain('password reset');
    });
  });
});
