import { InAppChannel } from '../../../packages/core-api/src/modules/notifications/core/../channels/in-app-channel';
import { EmailChannel } from '../../../packages/core-api/src/modules/notifications/channels/email-channel';
import { PushChannel } from '../../../packages/core-api/src/modules/notifications/channels/push-channel';
import type { EmailProvider } from '../../../packages/core-api/src/modules/notifications/channels/email-channel';
import type { PushProvider } from '../../../packages/core-api/src/modules/notifications/channels/push-channel';

describe('InAppChannel', () => {
  function makePrisma() {
    return {
      notification: {
        create: jest.fn().mockResolvedValue({ id: 'notif-abc' }),
        createMany: jest.fn().mockResolvedValue({ count: 3 }),
        findMany: jest.fn().mockResolvedValue([
          { id: 'n1', title: 'Test', read: false },
          { id: 'n2', title: 'Test 2', read: true },
        ]),
        count: jest.fn().mockResolvedValue(5),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 2 }),
      },
    } as any;
  }

  it('send() creates a notification and returns its id', async () => {
    const prisma = makePrisma();
    const channel = new InAppChannel(prisma);

    const id = await channel.send({
      userId: 'user-1',
      eventType: 'draft.on_the_clock',
      title: 'Your pick!',
      body: 'You are on the clock',
      actionScreen: 'draft',
      actionParams: { draftId: 'd1' },
      groupKey: 'draft-d1',
    });

    expect(id).toBe('notif-abc');
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        eventType: 'draft.on_the_clock',
        title: 'Your pick!',
        body: 'You are on the clock',
        groupKey: 'draft-d1',
      }),
    });
  });

  it('getNotifications() returns paginated results with total', async () => {
    const prisma = makePrisma();
    const channel = new InAppChannel(prisma);

    const result = await channel.getNotifications('user-1', { limit: 10, offset: 0 });

    expect(result.notifications).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 10, skip: 0 }),
    );
  });

  it('markAsRead() updates the notification', async () => {
    const prisma = makePrisma();
    const channel = new InAppChannel(prisma);

    await channel.markAsRead('notif-abc');

    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'notif-abc' },
      data: { read: true, readAt: expect.any(Date) },
    });
  });

  it('getUnreadCount() queries only unread, undismissed notifications', async () => {
    const prisma = makePrisma();
    const channel = new InAppChannel(prisma);

    const count = await channel.getUnreadCount('user-1');

    expect(count).toBe(5);
    expect(prisma.notification.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', read: false, dismissed: false },
    });
  });
});

describe('EmailChannel', () => {
  it('sendToUser() delegates to the provider with correct params', async () => {
    const mockProvider: EmailProvider = {
      send: jest.fn().mockResolvedValue({ success: true, messageId: 'msg-1' }),
    };
    const channel = new EmailChannel(mockProvider, 'noreply@poolmaster.local');

    const result = await channel.sendToUser(
      'user@example.com',
      'Test Subject',
      'Plain text body',
      '<p>HTML body</p>',
    );

    expect(result.success).toBe(true);
    expect(result.messageId).toBe('msg-1');
    expect(mockProvider.send).toHaveBeenCalledWith({
      to: 'user@example.com',
      from: 'noreply@poolmaster.local',
      subject: 'Test Subject',
      text: 'Plain text body',
      html: '<p>HTML body</p>',
    });
  });

  it('sendToUser() forwards provider errors', async () => {
    const mockProvider: EmailProvider = {
      send: jest.fn().mockResolvedValue({ success: false, error: 'SMTP timeout' }),
    };
    const channel = new EmailChannel(mockProvider, 'noreply@poolmaster.local');

    const result = await channel.sendToUser('user@example.com', 'Subject', 'body');

    expect(result.success).toBe(false);
    expect(result.error).toBe('SMTP timeout');
  });
});

describe('PushChannel', () => {
  function makePushPrisma(devices: Array<{ platform: string; token: string }> = []) {
    return {
      deviceRegistration: {
        findMany: jest.fn().mockResolvedValue(
          devices.map((d) => ({ ...d, userId: 'user-1', isActive: true })),
        ),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as any;
  }

  function makePushProviders() {
    return {
      apns: {
        platform: 'apns' as const,
        sendToDevice: jest.fn().mockResolvedValue({ success: true, messageId: 'apns-1' }),
        sendBatch: jest.fn().mockResolvedValue([{ success: true, messageId: 'apns-1' }]),
      } satisfies PushProvider,
      fcm: {
        platform: 'fcm' as const,
        sendToDevice: jest.fn().mockResolvedValue({ success: true, messageId: 'fcm-1' }),
        sendBatch: jest.fn().mockResolvedValue([{ success: true, messageId: 'fcm-1' }]),
      } satisfies PushProvider,
    };
  }

  const payload = { title: 'Test', body: 'Push body' };

  it('sendToUser() returns empty array when user has no devices', async () => {
    const prisma = makePushPrisma([]);
    const providers = makePushProviders();
    const channel = new PushChannel(providers, prisma);

    const results = await channel.sendToUser('user-1', payload);

    expect(results).toEqual([]);
    expect(providers.apns.sendBatch).not.toHaveBeenCalled();
    expect(providers.fcm.sendBatch).not.toHaveBeenCalled();
  });

  it('sendToUser() routes iOS devices to APNs and Android to FCM', async () => {
    const prisma = makePushPrisma([
      { platform: 'ios', token: 'ios-token-1' },
      { platform: 'android', token: 'fcm-token-1' },
    ]);
    const providers = makePushProviders();
    const channel = new PushChannel(providers, prisma);

    await channel.sendToUser('user-1', payload);

    expect(providers.apns.sendBatch).toHaveBeenCalledWith([
      { token: 'ios-token-1', payload },
    ]);
    expect(providers.fcm.sendBatch).toHaveBeenCalledWith([
      { token: 'fcm-token-1', payload },
    ]);
  });

  it('sendToDevice() delegates to the correct provider by platform', async () => {
    const prisma = makePushPrisma();
    const providers = makePushProviders();
    const channel = new PushChannel(providers, prisma);

    await channel.sendToDevice('ios', 'token-abc', payload);
    expect(providers.apns.sendToDevice).toHaveBeenCalledWith('token-abc', payload);

    await channel.sendToDevice('android', 'token-def', payload);
    expect(providers.fcm.sendToDevice).toHaveBeenCalledWith('token-def', payload);
  });

  it('deactivates tokens that return BadDeviceToken errors', async () => {
    const prisma = makePushPrisma([
      { platform: 'ios', token: 'bad-token' },
    ]);
    const providers = makePushProviders();
    providers.apns.sendBatch.mockResolvedValue([
      { success: false, error: 'APNs 410: BadDeviceToken', token: 'bad-token' },
    ]);
    const channel = new PushChannel(providers, prisma);

    await channel.sendToUser('user-1', payload);

    expect(prisma.deviceRegistration.updateMany).toHaveBeenCalledWith({
      where: { token: { in: ['bad-token'] } },
      data: { isActive: false },
    });
  });
});
