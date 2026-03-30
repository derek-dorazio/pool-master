/**
 * Integration: Auth endpoints — register, login, me
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

describe('Auth Integration', () => {
  const testEmail = `auth-${Date.now()}@integration.test`;
  const testPassword = 'SecurePass123';
  let accessToken: string;

  describe('POST /api/v1/auth/register', () => {
    it('creates a new user and returns tokens', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: testEmail,
          password: testPassword,
          displayName: 'Auth Test User',
        },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json();
      // Response shape: { user, tokens: { accessToken, refreshToken, expiresIn } }
      expect(body.tokens).toBeDefined();
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.tokens.refreshToken).toBeDefined();
      expect(body.user.email).toBe(testEmail);
      accessToken = body.tokens.accessToken;
    });

    it('rejects duplicate email', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        payload: {
          email: testEmail,
          password: testPassword,
          displayName: 'Duplicate',
        },
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('authenticates with correct credentials', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: testEmail, password: testPassword },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.tokens.accessToken).toBeDefined();
      expect(body.user.email).toBe(testEmail);
      // Update token for subsequent tests
      accessToken = body.tokens.accessToken;
    });

    it('rejects wrong password', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: testEmail, password: 'wrong-password' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects non-existent email', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'nobody@nowhere.com', password: testPassword },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('GET /api/v1/auth/me', () => {
    it('returns profile for authenticated user', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.user.email).toBe(testEmail);
    });

    it('rejects request without token', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/auth/me',
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
