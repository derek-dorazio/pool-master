/**
 * Integration: Compliance endpoints — age verification
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Compliance Integration', () => {
  let headers: Record<string, string>;

  beforeAll(async () => {
    const user = await createTestUser();
    headers = user.headers;
  });

  describe('POST /api/v1/account/verify-age', () => {
    it('allows users 18 and older', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/verify-age',
        headers,
        payload: { birthYear: 2000 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allowed).toBe(true);
    });

    it('blocks users under 13', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/verify-age',
        headers,
        payload: { birthYear: 2020 },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.allowed).toBe(false);
    });
  });
});
