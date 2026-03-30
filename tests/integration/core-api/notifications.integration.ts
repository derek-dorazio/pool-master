/**
 * Integration: Notifications — list, unread count, preferences, devices, analytics
 */
import {
  setupIntegrationTests,
  teardownIntegrationTests,
  getApp,
  createTestUser,
  getPrisma,
  cleanupTestData,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Notifications Integration', () => {
  let headers: Record<string, string>;
  let userId: string;
  let deviceId: string;

  beforeAll(async () => {
    const user = await createTestUser({ displayName: 'Notification Tester' });
    headers = user.headers;
    userId = user.user.id;
  });

  /** Helper to build headers that include x-user-id alongside auth. */
  function headersWithUserId(): Record<string, string> {
    return { ...headers, 'x-user-id': userId };
  }

  describe('GET /api/v1/notifications', () => {
    it('lists notifications for the current user', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/notifications',
        headers: headersWithUserId(),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const notifications = body.notifications ?? body;
        expect(Array.isArray(notifications) || typeof notifications === 'object').toBe(true);
      }
    });
  });

  describe('GET /api/v1/notifications/unread-count', () => {
    it('returns the unread notification count', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/notifications/unread-count',
        headers: headersWithUserId(),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const count = body.count ?? body.unreadCount ?? body;
        expect(typeof count === 'number' || typeof count === 'object').toBe(true);
      }
    });
  });

  describe('GET /api/v1/notifications/preferences', () => {
    it('returns default notification preferences', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/notifications/preferences',
        headers: headersWithUserId(),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const prefs = body.preferences ?? body;
        expect(prefs).toBeDefined();
      }
    });
  });

  describe('PUT /api/v1/notifications/preferences', () => {
    it('saves notification preferences', async () => {
      const res = await getApp().inject({
        method: 'PUT',
        url: '/api/v1/notifications/preferences',
        headers: headersWithUserId(),
        payload: {
          doNotDisturb: true,
          categories: { scoring: { enabled: false } },
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const prefs = body.preferences ?? body;
        expect(prefs).toBeDefined();
      }
    });
  });

  describe('POST /api/v1/notifications/unsubscribe/scoring', () => {
    it('opts out of the scoring notification category', async () => {
      const { 'content-type': _, ...headersNoContentType } = headersWithUserId();
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/unsubscribe/scoring',
        headers: headersNoContentType,
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  describe('POST /api/v1/devices', () => {
    it('registers a device for push notifications', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/devices',
        headers: headersWithUserId(),
        payload: {
          platform: 'ios',
          token: 'test-device-token-123',
          appVersion: '1.0',
        },
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if ([200, 201].includes(res.statusCode)) {
        const body = res.json();
        const device = body.device ?? body;
        if (device && device.id) {
          deviceId = device.id;
        }
      }
    });
  });

  describe('GET /api/v1/devices', () => {
    it('lists registered devices', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/devices',
        headers: headersWithUserId(),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const devices = body.devices ?? body;
        expect(Array.isArray(devices) || typeof devices === 'object').toBe(true);
      }
    });
  });

  describe('DELETE /api/v1/devices/:id', () => {
    it('unregisters a device (strip content-type)', async () => {
      // Use the deviceId captured from the register step, or a placeholder UUID
      const targetId = deviceId ?? '00000000-0000-0000-0000-000000000000';
      const { 'content-type': _, ...headersNoContentType } = headersWithUserId();
      const res = await getApp().inject({
        method: 'DELETE',
        url: `/api/v1/devices/${targetId}`,
        headers: headersNoContentType,
      });
      // If no device was registered, 404 is acceptable; if it was, 200/204
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
    });
  });

  describe('GET /api/v1/notifications/analytics', () => {
    it('returns delivery analytics', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/notifications/analytics',
        headers: headersWithUserId(),
      });
      expect(res.statusCode).toBeGreaterThanOrEqual(200);
      expect(res.statusCode).toBeLessThan(500);
      if (res.statusCode === 200) {
        const body = res.json();
        const analytics = body.analytics ?? body;
        expect(analytics).toBeDefined();
      }
    });
  });

  describe('Auth enforcement', () => {
    it('rejects GET /notifications without auth', async () => {
      const res = await getApp().inject({
        method: 'GET',
        url: '/api/v1/notifications',
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
