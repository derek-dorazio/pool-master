/**
 * Integration: Compliance deep tests — consent, data export, self-exclusion, enforcement.
 *
 * Hits real Fastify routes backed by real Postgres. Age verification is covered
 * in compliance.integration.ts, so it is intentionally skipped here.
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

describe('Compliance Deep Integration', () => {
  let headers: Record<string, string>;
  let userId: string;

  beforeAll(async () => {
    const testUser = await createTestUser();
    headers = testUser.headers;
    userId = testUser.user.id;
  });

  // -----------------------------------------------------------------------
  // Consent
  // -----------------------------------------------------------------------

  describe('Consent management', () => {
    it('returns empty consent history for a new user', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/account/consent',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('consents');
      expect(body.consents).toEqual([]);
    });

    it('saves consent preferences', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/consent',
        headers,
        payload: {
          consentType: 'analytics_cookies',
          granted: true,
          version: '1.0',
        },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({ success: true });
    });

    it('returns saved consent after persistence', async () => {
      // Save a second consent type so we verify both are returned
      await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/consent',
        headers,
        payload: {
          consentType: 'marketing_email',
          granted: false,
          version: '1.0',
        },
      });

      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/account/consent',
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.consents.length).toBeGreaterThanOrEqual(2);

      const types = body.consents.map((c: any) => c.consentType);
      expect(types).toContain('analytics_cookies');
      expect(types).toContain('marketing_email');

      // Verify the analytics consent was granted
      const analytics = body.consents.find((c: any) => c.consentType === 'analytics_cookies');
      expect(analytics.granted).toBe(true);

      // Verify marketing was NOT granted
      const marketing = body.consents.find((c: any) => c.consentType === 'marketing_email');
      expect(marketing.granted).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // Data Export
  // -----------------------------------------------------------------------

  describe('Data export (GDPR)', () => {
    let exportRequestId: string;

    it('creates a data export request', async () => {
      const { 'content-type': _, ...noCtHeaders } = headers;
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/data-export',
        headers: noCtHeaders,
      });

      expect(res.statusCode).toBe(202);
      const body = res.json();
      expect(body).toHaveProperty('requestId');
      expect(body.message).toBe('Export request accepted');
      exportRequestId = body.requestId;
    });

    it('processes and returns the data export', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/account/data-export/${exportRequestId}`,
        headers,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('profile');
      expect(body).toHaveProperty('exportedAt');
      expect(body.profile.id).toBe(userId);
      // Consent records we created earlier should be present
      expect(body.consents.length).toBeGreaterThanOrEqual(2);
    });
  });

  // -----------------------------------------------------------------------
  // Self-Exclusion
  // -----------------------------------------------------------------------

  describe('Self-exclusion', () => {
    // Use a separate user so the exclusion doesn't interfere with other tests
    let exclHeaders: Record<string, string>;
    let exclUserId: string;

    beforeAll(async () => {
      const u = await createTestUser();
      exclHeaders = u.headers;
      exclUserId = u.user.id;
    });

    it('creates a self-exclusion', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/self-exclusion',
        headers: exclHeaders,
        payload: {
          type: 'COOL_DOWN',
          duration: '30D',
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty('exclusionId');
      expect(typeof body.exclusionId).toBe('string');
    });

    it('returns the active exclusion', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/account/self-exclusion',
        headers: exclHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.exclusion).not.toBeNull();
      expect(body.exclusion.userId).toBe(exclUserId);
      expect(body.exclusion.exclusionType).toBe('COOL_DOWN');
      expect(body.exclusion.duration).toBe('30D');
      expect(body.exclusion.isActive).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // Enforcement
  // -----------------------------------------------------------------------

  describe('Enforcement', () => {
    let targetHeaders: Record<string, string>;
    let targetUserId: string;
    let adminHeaders: Record<string, string>;

    beforeAll(async () => {
      const target = await createTestUser();
      targetHeaders = target.headers;
      targetUserId = target.user.id;

      const admin = await createTestUser();
      adminHeaders = admin.headers;
    });

    it('returns empty enforcement history for a clean user', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: `/api/v1/account/enforcement/${targetUserId}`,
        headers: adminHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty('enforcement');
      expect(body.enforcement).toEqual([]);
    });

    it('creates an enforcement action and retrieves it', async () => {
      const createRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/account/enforcement',
        headers: adminHeaders,
        payload: {
          userId: targetUserId,
          level: 'WARNING',
          reason: 'Unsportsmanlike conduct in chat',
          trigger: 'MANUAL_REVIEW',
        },
      });

      expect(createRes.statusCode).toBe(201);
      expect(createRes.json()).toHaveProperty('enforcementId');

      // Retrieve enforcement history
      const historyRes = await getApp().inject({
        method: 'GET',
        url: `/api/v1/account/enforcement/${targetUserId}`,
        headers: adminHeaders,
      });

      expect(historyRes.statusCode).toBe(200);
      const history = historyRes.json();
      expect(history.enforcement.length).toBe(1);
      expect(history.enforcement[0].level).toBe('WARNING');
      expect(history.enforcement[0].reason).toBe('Unsportsmanlike conduct in chat');
    });
  });

  // -----------------------------------------------------------------------
  // Auth enforcement — unauthenticated requests must be rejected
  // -----------------------------------------------------------------------

  describe('Auth enforcement', () => {
    const protectedRoutes: Array<{ method: 'GET' | 'POST' | 'PUT'; url: string; payload?: object }> = [
      { method: 'GET', url: '/api/v1/account/consent' },
      { method: 'POST', url: '/api/v1/account/consent', payload: { consentType: 'terms_of_service', granted: true, version: '1.0' } },
      { method: 'POST', url: '/api/v1/account/data-export' },
      { method: 'POST', url: '/api/v1/account/self-exclusion', payload: { type: 'COOL_DOWN', duration: '24H' } },
      { method: 'GET', url: '/api/v1/account/self-exclusion' },
    ];

    it.each(protectedRoutes)(
      'rejects unauthenticated $method $url',
      async ({ method, url, payload }) => {
        const res = await getApp().inject({
          method,
          url,
          headers: { 'content-type': 'application/json' },
          ...(payload ? { payload } : {}),
        });

        expect([400, 401]).toContain(res.statusCode);
      },
    );
  });
});
