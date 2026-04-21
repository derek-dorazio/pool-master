import {
  cleanupTestData,
  createTestUser,
  getApp,
  getPrisma,
  setupIntegrationTests,
  teardownIntegrationTests,
  withoutJsonBodyHeaders,
} from '../helpers';

beforeAll(() => setupIntegrationTests());
afterAll(async () => {
  await cleanupTestData();
  await teardownIntegrationTests();
});

describe('Notifications Integration', () => {
  it('lists, counts, marks read, marks all read, and dismisses notifications for the authenticated user', async () => {
    const user = await createTestUser({ displayName: 'Notifications User' });
    const otherUser = await createTestUser({ displayName: 'Other Notifications User' });
    const prisma = getPrisma();

    const [first, second, other] = await Promise.all([
      prisma.notification.create({
        data: {
          userId: user.user.id,
          eventType: 'TEST_NOTIFICATION',
          title: 'Unread One',
          body: 'Unread notification body',
          actionParams: {},
        },
      }),
      prisma.notification.create({
        data: {
          userId: user.user.id,
          eventType: 'TEST_NOTIFICATION',
          title: 'Unread Two',
          body: 'Second unread notification body',
          actionParams: {},
        },
      }),
      prisma.notification.create({
        data: {
          userId: otherUser.user.id,
          eventType: 'TEST_NOTIFICATION',
          title: 'Other User Notification',
          body: 'Should not appear for the primary user',
          actionParams: {},
        },
      }),
    ]);

    const listRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/notifications?limit=10&offset=0&unreadOnly=true',
      headers: user.headers,
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json()).toEqual(
      expect.objectContaining({
        total: 2,
      }),
    );
    expect(listRes.json().notifications).toHaveLength(2);
    expect(listRes.json().notifications.map((notification: { id: string }) => notification.id)).toEqual(
      expect.arrayContaining([first.id, second.id]),
    );
    expect(listRes.json().notifications.map((notification: { id: string }) => notification.id)).not.toContain(other.id);

    const unreadCountRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: user.headers,
    });
    expect(unreadCountRes.statusCode).toBe(200);
    expect(unreadCountRes.json()).toEqual({ unreadCount: 2 });

    const markReadRes = await getApp().inject({
      method: 'PUT',
      url: `/api/v1/notifications/${first.id}/read`,
      headers: withoutJsonBodyHeaders(user.headers),
    });
    expect(markReadRes.statusCode).toBe(200);
    expect(markReadRes.json()).toEqual({ success: true });

    const markedRead = await prisma.notification.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(markedRead.read).toBe(true);
    expect(markedRead.readAt).toBeTruthy();

    const markAllRes = await getApp().inject({
      method: 'PUT',
      url: '/api/v1/notifications/read-all',
      headers: withoutJsonBodyHeaders(user.headers),
    });
    expect(markAllRes.statusCode).toBe(200);
    expect(markAllRes.json()).toEqual({ markedRead: 1 });

    const unreadAfterMarkAllRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/notifications/unread-count',
      headers: user.headers,
    });
    expect(unreadAfterMarkAllRes.statusCode).toBe(200);
    expect(unreadAfterMarkAllRes.json()).toEqual({ unreadCount: 0 });

    const dismissRes = await getApp().inject({
      method: 'DELETE',
      url: `/api/v1/notifications/${second.id}`,
      headers: withoutJsonBodyHeaders(user.headers),
    });
    expect(dismissRes.statusCode).toBe(200);
    expect(dismissRes.json()).toEqual({ success: true });

    const listAfterDismissRes = await getApp().inject({
      method: 'GET',
      url: '/api/v1/notifications?limit=10&offset=0',
      headers: user.headers,
    });
    expect(listAfterDismissRes.statusCode).toBe(200);
    expect(listAfterDismissRes.json().notifications.map((notification: { id: string }) => notification.id)).not.toContain(second.id);
  });
});
