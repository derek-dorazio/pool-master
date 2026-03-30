/**
 * Integration: Notification Dispatch & Scheduling — dispatch, announce, schedule,
 * cancel, test email, test push, weekly digest, auth enforcement.
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

const TEST_TENANT_ID = '00000000-0000-0000-0000-999999999999';

describe('Notification Dispatch & Scheduling', () => {
  let headers: Record<string, string>;
  let userId: string;
  let leagueId: string;

  beforeAll(async () => {
    // Create test user
    const testUser = await createTestUser({ displayName: 'Dispatch Tester' });
    headers = testUser.headers;
    userId = testUser.user.id;

    // Create a league (needed for announce + digest)
    const leagueRes = await getApp().inject({
      method: 'POST',
      url: '/api/v1/leagues',
      headers,
      payload: {
        name: 'Dispatch Test League',
        visibility: 'PRIVATE',
        maxMembers: 10,
      },
    });
    expect(leagueRes.statusCode).toBe(201);
    leagueId = leagueRes.json().league.id;
  });

  // -----------------------------------------------------------------------
  // 1. Dispatch notification
  // -----------------------------------------------------------------------
  describe('POST /api/v1/notifications/dispatch', () => {
    it('dispatches a notification event and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/dispatch',
        headers,
        payload: {
          type: 'test.notification',
          tenantId: TEST_TENANT_ID,
          recipientUserIds: [userId],
          data: { title: 'Test', body: 'Hello' },
          priority: 'NORMAL',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.eventId).toBeDefined();
      expect(body.eventType).toBe('test.notification');
      expect(body.recipientCount).toBe(1);
      expect(Array.isArray(body.deliveries)).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Commissioner announcement
  // -----------------------------------------------------------------------
  describe('POST /api/v1/notifications/announce', () => {
    it('sends a commissioner announcement and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/announce',
        headers,
        payload: {
          leagueId,
          tenantId: TEST_TENANT_ID,
          title: 'Big News',
          body: 'Season starts Monday',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.eventId).toBeDefined();
      expect(body.eventType).toBe('league.announcement');
      // The owner is a league member, so there should be at least 1 recipient
      expect(body.recipientCount).toBeGreaterThanOrEqual(1);
    });
  });

  // -----------------------------------------------------------------------
  // 3. Schedule notification
  // -----------------------------------------------------------------------
  describe('POST /api/v1/notifications/schedule', () => {
    it('schedules a future notification and returns an id', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/schedule',
        headers,
        payload: {
          eventType: 'contest.reminder',
          fireAt: '2026-12-01T12:00:00Z',
          context: { contestId: 'test' },
          sourceType: 'contest',
          sourceId: '00000000-0000-0000-0000-000000000001',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.scheduled).toBe(true);
      expect(body.id).toBeDefined();
      expect(typeof body.id).toBe('string');
    });
  });

  // -----------------------------------------------------------------------
  // 4. Cancel scheduled notification
  // -----------------------------------------------------------------------
  describe('DELETE /api/v1/notifications/schedule/:sourceType/:sourceId', () => {
    it('cancels scheduled notifications for a source', async () => {
      // First schedule one so there is something to cancel
      const schedRes = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/schedule',
        headers,
        payload: {
          eventType: 'contest.reminder',
          fireAt: '2026-12-15T12:00:00Z',
          context: { contestId: 'cancel-test' },
          sourceType: 'contest',
          sourceId: '00000000-0000-0000-0000-000000000002',
        },
      });
      expect(schedRes.statusCode).toBe(200);

      // Now cancel it — strip content-type for DELETE
      const { 'content-type': _, ...headersNoContentType } = headers;
      const res = await getApp().inject({
        method: 'DELETE',
        url: '/api/v1/notifications/schedule/contest/00000000-0000-0000-0000-000000000002',
        headers: headersNoContentType,
      });
      expect([200, 204]).toContain(res.statusCode);
      if (res.statusCode === 200) {
        const body = res.json();
        expect(body.cancelled).toBeGreaterThanOrEqual(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 5. Test email endpoint
  // -----------------------------------------------------------------------
  describe('POST /api/v1/test/email', () => {
    it('sends a test email and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/test/email',
        headers,
        payload: {
          to: 'test@example.com',
          subject: 'Test',
          text: 'Hello',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // The email channel returns { success, messageId?, error? }
      expect(typeof body.success).toBe('boolean');
    });
  });

  // -----------------------------------------------------------------------
  // 6. Test push endpoint
  // -----------------------------------------------------------------------
  describe('POST /api/v1/test/push', () => {
    it('sends a test push notification and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/test/push',
        headers,
        payload: {
          platform: 'ios',
          token: 'test-token',
          title: 'Test',
          body: 'Push',
        },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Push provider returns { success, messageId?, error?, token? }
      expect(typeof body.success).toBe('boolean');
    });
  });

  // -----------------------------------------------------------------------
  // 7. Weekly digest
  // -----------------------------------------------------------------------
  describe('POST /api/v1/notifications/digest/:leagueId', () => {
    it('triggers a weekly digest and returns 200', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: `/api/v1/notifications/digest/${leagueId}`,
        headers: { ...headers, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // digest returns { sent, skipped }
      expect(typeof body.sent).toBe('number');
      expect(typeof body.skipped).toBe('number');
    });
  });

  // -----------------------------------------------------------------------
  // 8. Auth enforcement on dispatch
  // -----------------------------------------------------------------------
  describe('Auth enforcement', () => {
    it('rejects POST /notifications/dispatch without authentication', async () => {
      const res = await getApp().inject({
        method: 'POST',
        url: '/api/v1/notifications/dispatch',
        payload: {
          type: 'test.notification',
          tenantId: TEST_TENANT_ID,
          recipientUserIds: ['any'],
          data: { title: 'Test', body: 'Hello' },
          priority: 'NORMAL',
        },
      });
      expect([400, 401]).toContain(res.statusCode);
    });
  });
});
