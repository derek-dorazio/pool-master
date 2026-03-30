import { NotificationDispatcher } from '../../../packages/core-api/src/modules/notifications/core/dispatcher';
import type { NotificationEvent } from '../../../packages/shared/events/notification';
import type { RateLimiter } from '../../../packages/core-api/src/modules/notifications/core/rate-limiter';

function makeEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    id: 'evt-1',
    type: 'draft.on_the_clock',
    sourceService: 'draft-service',
    timestamp: new Date().toISOString(),
    tenantId: 'tenant-1',
    recipientUserIds: ['user-1'],
    data: { player_name: 'Patrick Mahomes' },
    priority: 'NORMAL',
    action: { type: 'NAVIGATE', screen: 'draft', params: { draftId: 'd1' } },
    ...overrides,
  };
}

function makePrisma() {
  return {
    user: {
      findUnique: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user1@test.com' }),
    },
    notificationPreference: {
      findUnique: jest.fn().mockResolvedValue(null),
    },
    notificationTemplate: {
      findFirst: jest.fn().mockResolvedValue({
        pushTitle: 'Pick: {{player_name}}',
        pushBody: 'You are on the clock',
        emailSubject: 'Draft: {{player_name}}',
        emailHtml: '<p>Pick {{player_name}}</p>',
        emailText: 'Pick {{player_name}}',
        inAppTitle: 'Draft pick',
        inAppBody: '{{player_name}} drafted',
        inAppIcon: null,
      }),
    },
    notificationDeliveryLog: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    leagueMembership: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    contestEntry: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  } as any;
}

function makeChannels() {
  return {
    inApp: {
      send: jest.fn().mockResolvedValue('notif-1'),
    },
    push: {
      sendToUser: jest.fn().mockResolvedValue([{ success: true, messageId: 'push-1' }]),
    },
    email: {
      sendToUser: jest.fn().mockResolvedValue({ success: true, messageId: 'email-1' }),
    },
  };
}

function makeRateLimiter(): RateLimiter & { check: jest.Mock; record: jest.Mock; reset: jest.Mock } {
  return {
    check: jest.fn().mockResolvedValue(true),
    record: jest.fn().mockResolvedValue(undefined),
    reset: jest.fn().mockResolvedValue(undefined),
  };
}

describe('NotificationDispatcher', () => {
  it('constructs without a rate limiter', () => {
    const dispatcher = new NotificationDispatcher(makePrisma(), makeChannels() as any);
    expect(dispatcher).toBeDefined();
  });

  it('dispatches to IN_APP channel by default for league events', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    const dispatcher = new NotificationDispatcher(prisma, channels as any);

    const event = makeEvent({
      type: 'league.member_joined',
      channels: ['IN_APP'],
    });

    const result = await dispatcher.dispatch(event);

    expect(result.eventId).toBe('evt-1');
    expect(result.recipientCount).toBe(1);
    expect(channels.inApp.send).toHaveBeenCalledTimes(1);
    expect(channels.push.sendToUser).not.toHaveBeenCalled();
    expect(channels.email.sendToUser).not.toHaveBeenCalled();
    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].status).toBe('SENT');
    expect(result.deliveries[0].channel).toBe('IN_APP');
  });

  it('dispatches to multiple channels', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    const dispatcher = new NotificationDispatcher(prisma, channels as any);

    const event = makeEvent({ channels: ['PUSH', 'EMAIL', 'IN_APP'] });
    const result = await dispatcher.dispatch(event);

    expect(result.deliveries).toHaveLength(3);
    expect(channels.push.sendToUser).toHaveBeenCalledTimes(1);
    expect(channels.email.sendToUser).toHaveBeenCalledTimes(1);
    expect(channels.inApp.send).toHaveBeenCalledTimes(1);
  });

  it('suppresses delivery when user preference says no', async () => {
    const prisma = makePrisma();
    prisma.notificationPreference.findUnique.mockResolvedValue({
      doNotDisturb: false,
      dndSchedule: null,
      categoryPreferences: {
        DRAFT: {
          enabled: true,
          channels: { push: false, email: false, in_app: true, sms: false },
        },
      },
    });
    const channels = makeChannels();
    const dispatcher = new NotificationDispatcher(prisma, channels as any);

    const event = makeEvent({ channels: ['PUSH', 'IN_APP'] });
    const result = await dispatcher.dispatch(event);

    const pushDelivery = result.deliveries.find((d) => d.channel === 'PUSH');
    expect(pushDelivery?.status).toBe('SUPPRESSED');
    expect(pushDelivery?.suppressionReason).toBe('USER_PREFERENCE');

    const inAppDelivery = result.deliveries.find((d) => d.channel === 'IN_APP');
    expect(inAppDelivery?.status).toBe('SENT');
  });

  it('suppresses delivery when rate limiter blocks', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    const rateLimiter = makeRateLimiter();
    rateLimiter.check.mockResolvedValue(false);

    const dispatcher = new NotificationDispatcher(prisma, channels as any, rateLimiter);
    const event = makeEvent({ channels: ['PUSH'] });
    const result = await dispatcher.dispatch(event);

    expect(result.deliveries).toHaveLength(1);
    expect(result.deliveries[0].status).toBe('SUPPRESSED');
    expect(result.deliveries[0].suppressionReason).toBe('RATE_LIMITED');
    expect(channels.push.sendToUser).not.toHaveBeenCalled();
  });

  it('records rate limit usage after successful send', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    const rateLimiter = makeRateLimiter();

    const dispatcher = new NotificationDispatcher(prisma, channels as any, rateLimiter);
    const event = makeEvent({ channels: ['PUSH'] });
    await dispatcher.dispatch(event);

    expect(rateLimiter.record).toHaveBeenCalledWith('user-1', 'PUSH', 'draft.on_the_clock');
  });

  it('suppresses EMAIL when user has no email address', async () => {
    const prisma = makePrisma();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: null });
    const channels = makeChannels();
    const dispatcher = new NotificationDispatcher(prisma, channels as any);

    const event = makeEvent({ channels: ['EMAIL'] });
    const result = await dispatcher.dispatch(event);

    expect(result.deliveries[0].status).toBe('SUPPRESSED');
    expect(result.deliveries[0].suppressionReason).toBe('NO_EMAIL');
  });

  it('handles channel send failure gracefully', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    channels.inApp.send.mockRejectedValue(new Error('DB connection lost'));

    const dispatcher = new NotificationDispatcher(prisma, channels as any);
    const event = makeEvent({ channels: ['IN_APP'] });
    const result = await dispatcher.dispatch(event);

    expect(result.deliveries[0].status).toBe('FAILED');
    expect(result.deliveries[0].error).toBe('DB connection lost');
  });

  it('logs deliveries to notificationDeliveryLog', async () => {
    const prisma = makePrisma();
    const channels = makeChannels();
    const dispatcher = new NotificationDispatcher(prisma, channels as any);

    const event = makeEvent({ channels: ['IN_APP'] });
    await dispatcher.dispatch(event);

    expect(prisma.notificationDeliveryLog.createMany).toHaveBeenCalledTimes(1);
    const logCall = prisma.notificationDeliveryLog.createMany.mock.calls[0][0];
    expect(logCall.data).toHaveLength(1);
    expect(logCall.data[0].channel).toBe('IN_APP');
    expect(logCall.data[0].status).toBe('SENT');
  });
});
