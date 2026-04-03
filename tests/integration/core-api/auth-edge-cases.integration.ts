/**
 * Integration: Auth edge cases — expired tokens, malformed JWTs, revoked refresh
 * tokens, email normalization, and case-sensitivity.
 */
import jwt from 'jsonwebtoken';
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

const JWT_SECRET = 'poolmaster-dev-secret-change-in-production';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Auth Edge Cases', () => {
  // -------------------------------------------------------------------------
  // 1. Expired JWT
  // -------------------------------------------------------------------------
  describe('Expired JWT', () => {
    it('returns 401 for an expired access token on GET /api/v1/auth/me', async () => {
      const expiredToken = jwt.sign(
        { sub: 'test-user-id', email: 'expired@test.com', tenantId: 'tid' },
        JWT_SECRET,
        { expiresIn: '0s' },
      );

      // Wait for the token to be definitively expired
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${expiredToken}` },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 2. Malformed JWT
  // -------------------------------------------------------------------------
  describe('Malformed JWT', () => {
    it('returns 401 for a non-JWT bearer token on GET /api/v1/auth/me', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: 'Bearer not-a-jwt' },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 3. JWT signed with wrong secret
  // -------------------------------------------------------------------------
  describe('JWT signed with wrong secret', () => {
    it('returns 401 when JWT is signed with a different secret', async () => {
      const wrongSecretToken = jwt.sign(
        { sub: 'test-user-id', email: 'wrong@test.com', tenantId: 'tid' },
        'wrong-secret',
        { expiresIn: '15m' },
      );

      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${wrongSecretToken}` },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 4. JWT with missing sub claim
  // -------------------------------------------------------------------------
  describe('JWT with missing sub claim', () => {
    it('returns 401 when JWT has no sub claim', async () => {
      const noSubToken = jwt.sign(
        { email: 'nosub@test.com', tenantId: 'tid' },
        JWT_SECRET,
        { expiresIn: '15m' },
      );

      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${noSubToken}` },
      });

      // Should return 401, not 500 (server error)
      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 5. JWT with empty string sub
  // -------------------------------------------------------------------------
  describe('JWT with empty string sub', () => {
    it('returns 401 or 400 when JWT has empty sub claim', async () => {
      const emptySubToken = jwt.sign(
        { sub: '', email: 'emptysub@test.com', tenantId: 'tid' },
        JWT_SECRET,
        { expiresIn: '15m' },
      );

      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${emptySubToken}` },
      });

      // Should return 401 or 400, not 500
      expect([400, 401]).toContain(res.statusCode);
      const body = res.json();
      expect(body.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // 6. Already-revoked refresh token
  // -------------------------------------------------------------------------
  describe('Already-revoked refresh token', () => {
    it('returns 401 when using a refresh token that was revoked by logout', async () => {
      // Register a fresh user via the API to get real tokens
      const email = `revoke-${Date.now()}@integration.test`;
      const registerRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email, password: 'SecurePass123', displayName: 'Revoke Test' },
      });
      expect(registerRes.statusCode).toBe(201);
      const { tokens } = registerRes.json();

      // Logout to revoke the refresh token
      const logoutRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: tokens.refreshToken },
      });
      expect(logoutRes.statusCode).toBe(200);
      expect(logoutRes.json()).toEqual({ success: true });

      // Attempt to use the revoked refresh token
      const refreshRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/refresh',
        payload: { refreshToken: tokens.refreshToken },
      });

      expect(refreshRes.statusCode).toBe(401);
      const body = refreshRes.json();
      expect(body.error).toBe('INVALID_REFRESH_TOKEN');
    });
  });

  // -------------------------------------------------------------------------
  // 7. Register with email trailing spaces
  // -------------------------------------------------------------------------
  describe('Register with email trailing spaces', () => {
    it('handles email with leading/trailing spaces without crashing', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: '  spaceduser@test.com  ',
          password: 'SecurePass123',
          displayName: 'Spaced Email User',
        },
      });

      // Either 201 (trimmed and accepted) or 400 (rejected by validation) — but not 500
      expect([201, 400]).toContain(res.statusCode);

      if (res.statusCode === 201) {
        // If accepted, the stored email should be trimmed
        const body = res.json();
        expect(body.user.email).toBe(body.user.email.trim());
      }
    });
  });

  // -------------------------------------------------------------------------
  // 8. Case-insensitive email login
  // -------------------------------------------------------------------------
  describe('Case-insensitive email login', () => {
    const mixedCaseEmail = `CaseTest-${Date.now()}@Integration.Test`;
    const password = 'SecurePass123';

    beforeAll(async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: { email: mixedCaseEmail, password, displayName: 'Case Test' },
      });
      expect(res.statusCode).toBe(201);
    });

    it('documents case-sensitivity behavior: login with lowercase version of registered email', async () => {
      const lowercaseEmail = mixedCaseEmail.toLowerCase();

      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: lowercaseEmail, password },
      });

      // Document actual behavior: either 200 (case-insensitive match) or 401 (case-sensitive)
      if (res.statusCode === 200) {
        // Case-insensitive login: the system normalizes email comparison
        const body = res.json();
        expect(body.tokens.accessToken).toBeDefined();
        expect(body.user.email).toBeDefined();
        // eslint-disable-next-line no-console
        console.log('[AUTH EDGE CASE] Email login is CASE-INSENSITIVE');
      } else {
        // Case-sensitive login: exact match required
        expect(res.statusCode).toBe(401);
        // eslint-disable-next-line no-console
        console.log('[AUTH EDGE CASE] Email login is CASE-SENSITIVE');
      }
    });
  });
});
