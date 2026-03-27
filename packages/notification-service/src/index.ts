import Fastify from 'fastify';
import { PrismaClient, type NotificationDeliveryLog } from '@prisma/client';
import { loadConfig } from './core/config';
import { getDefaultPreferences } from './core/preference-service';
import { createChannels } from './channels/channel-factory';
import { NotificationDispatcher } from './core/dispatcher';
import { InMemoryRateLimiter } from './core/rate-limiter';
import { EventGrouper } from './core/event-grouper';
import { ScheduledRunner } from './core/scheduled-runner';
import { WeeklyDigestService } from './core/weekly-digest';
import type { NotificationEvent, NotificationChannel, NotificationPriority } from '@poolmaster/shared/events';
import { registerPushTriggers } from './triggers/push-triggers';
import crypto from 'node:crypto';

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();
  const config = loadConfig();
  const channels = createChannels(config, prisma);
  const rateLimiter = new InMemoryRateLimiter();
  const dispatcher = new NotificationDispatcher(prisma, channels, rateLimiter);
  const eventGrouper = new EventGrouper();
  const scheduledRunner = new ScheduledRunner(prisma, dispatcher);
  const digestService = new WeeklyDigestService(prisma, channels);

  // --- Health ---

  app.get('/health', async () => ({
    status: 'ok',
    service: 'notification-service',
    emailProvider: config.emailProvider,
  }));

  // --- In-App Notification Centre ---

  app.get<{ Querystring: { limit?: string; offset?: string; unreadOnly?: string } }>(
    '/api/v1/notifications',
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return channels.inApp.getNotifications(userId, {
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        unreadOnly: request.query.unreadOnly === 'true',
      });
    },
  );

  app.get('/api/v1/notifications/unread-count', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    return { unreadCount: await channels.inApp.getUnreadCount(userId) };
  });

  app.put<{ Params: { id: string } }>('/api/v1/notifications/:id/read', async (request) => {
    await channels.inApp.markAsRead(request.params.id);
    return { success: true };
  });

  app.put('/api/v1/notifications/read-all', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    return { markedRead: await channels.inApp.markAllAsRead(userId) };
  });

  app.delete<{ Params: { id: string } }>('/api/v1/notifications/:id', async (request) => {
    await channels.inApp.dismiss(request.params.id);
    return { success: true };
  });

  // --- Preferences ---

  app.get('/api/v1/notifications/preferences', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const prefs = await prisma.notificationPreference.findUnique({ where: { userId } });
    if (!prefs) {
      return { preferences: { doNotDisturb: false, categories: getDefaultPreferences() } };
    }
    return {
      preferences: {
        doNotDisturb: prefs.doNotDisturb,
        dndSchedule: prefs.dndSchedule,
        categories: prefs.categoryPreferences,
      },
    };
  });

  app.put<{ Body: { doNotDisturb?: boolean; dndSchedule?: object; categories?: object } }>(
    '/api/v1/notifications/preferences',
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body;
      const prefs = await prisma.notificationPreference.upsert({
        where: { userId },
        create: {
          userId,
          doNotDisturb: body.doNotDisturb ?? false,
          dndSchedule: body.dndSchedule ? (body.dndSchedule as object) : undefined,
          categoryPreferences: body.categories
            ? (body.categories as object)
            : (getDefaultPreferences() as unknown as object),
        },
        update: {
          ...(body.doNotDisturb !== undefined && { doNotDisturb: body.doNotDisturb }),
          ...(body.dndSchedule !== undefined && { dndSchedule: body.dndSchedule as object }),
          ...(body.categories !== undefined && { categoryPreferences: body.categories as object }),
        },
      });
      return { preferences: prefs };
    },
  );

  // --- Unsubscribe (per-category opt-out) ---

  app.post<{ Params: { category: string } }>(
    '/api/v1/notifications/unsubscribe/:category',
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const category = request.params.category;

      const existing = await prisma.notificationPreference.findUnique({ where: { userId } });
      const categories = (existing?.categoryPreferences ?? getDefaultPreferences()) as Record<string, unknown>;
      const catPref = categories[category] as Record<string, unknown> | undefined;

      if (catPref) {
        catPref.enabled = false;
      } else {
        categories[category] = { enabled: false, channels: { push: false, email: false, in_app: true, sms: false } };
      }

      await prisma.notificationPreference.upsert({
        where: { userId },
        create: { userId, categoryPreferences: categories as object },
        update: { categoryPreferences: categories as object },
      });

      return { success: true, category, enabled: false };
    },
  );

  // --- Device Registration ---

  app.post<{ Body: { platform: string; token: string; appVersion?: string; osVersion?: string; deviceModel?: string } }>(
    '/api/v1/devices',
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body;
      const device = await prisma.deviceRegistration.upsert({
        where: { platform_token: { platform: body.platform, token: body.token } },
        create: { userId, platform: body.platform, token: body.token, appVersion: body.appVersion, osVersion: body.osVersion, deviceModel: body.deviceModel, lastActiveAt: new Date() },
        update: { userId, appVersion: body.appVersion, osVersion: body.osVersion, deviceModel: body.deviceModel, isActive: true, lastActiveAt: new Date() },
      });
      return reply.status(201).send({ device });
    },
  );

  app.post<{ Body: { platform: string; token: string; appVersion?: string; osVersion?: string; deviceModel?: string } }>(
    '/api/v1/devices/register',
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body;
      const device = await prisma.deviceRegistration.upsert({
        where: { platform_token: { platform: body.platform, token: body.token } },
        create: { userId, platform: body.platform, token: body.token, appVersion: body.appVersion, osVersion: body.osVersion, deviceModel: body.deviceModel, lastActiveAt: new Date() },
        update: { userId, appVersion: body.appVersion, osVersion: body.osVersion, deviceModel: body.deviceModel, isActive: true, lastActiveAt: new Date() },
      });
      return reply.status(201).send({ device });
    },
  );

  app.delete<{ Params: { id: string } }>('/api/v1/devices/:id', async (request) => {
    await prisma.deviceRegistration.update({ where: { id: request.params.id }, data: { isActive: false } });
    return { success: true };
  });

  app.get('/api/v1/devices', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const devices = await prisma.deviceRegistration.findMany({
      where: { userId, isActive: true },
      orderBy: { lastActiveAt: 'desc' },
    });
    return { devices };
  });

  // --- Dispatch (send a notification event) ---

  app.post<{
    Body: {
      type: string;
      tenantId: string;
      leagueId?: string;
      contestId?: string;
      recipientUserIds?: string[];
      recipientScope?: string;
      data: Record<string, unknown>;
      priority?: string;
      channels?: string[];
      action?: { type: string; screen: string; params: Record<string, string> };
    };
  }>('/api/v1/notifications/dispatch', async (request) => {
    const body = request.body;
    const event: NotificationEvent = {
      id: crypto.randomUUID(),
      type: body.type,
      sourceService: 'api',
      timestamp: new Date().toISOString(),
      tenantId: body.tenantId,
      leagueId: body.leagueId,
      contestId: body.contestId,
      recipientUserIds: body.recipientUserIds,
      recipientScope: body.recipientScope as NotificationEvent['recipientScope'],
      data: body.data,
      priority: (body.priority ?? 'NORMAL') as NotificationPriority,
      channels: body.channels as NotificationChannel[] | undefined,
      action: body.action as NotificationEvent['action'] ?? { type: 'NAVIGATE', screen: 'home', params: {} },
    };

    // Check if event should be grouped
    if (eventGrouper.isGroupable(event.type) && event.recipientUserIds?.length === 1) {
      const grouped = eventGrouper.add({
        id: event.id,
        type: event.type,
        userId: event.recipientUserIds[0],
        data: event.data as Record<string, unknown>,
        timestamp: new Date(),
      });
      if (grouped) {
        // Window closed — send the grouped notification
        return dispatcher.dispatch({
          ...event,
          data: { ...event.data, count: grouped.count },
        });
      }
      return { queued: true, message: 'Event buffered for grouping' };
    }

    return dispatcher.dispatch(event);
  });

  // --- Commissioner Announcement (bypass preferences) ---

  app.post<{
    Body: {
      leagueId: string;
      tenantId: string;
      title: string;
      body: string;
      channels?: string[];
    };
  }>('/api/v1/notifications/announce', async (request) => {
    const body = request.body;
    const event: NotificationEvent = {
      id: crypto.randomUUID(),
      type: 'league.announcement',
      sourceService: 'commissioner',
      timestamp: new Date().toISOString(),
      tenantId: body.tenantId,
      leagueId: body.leagueId,
      recipientScope: 'ALL_LEAGUE',
      data: { title: body.title, body: body.body, league_name: body.leagueId },
      priority: 'HIGH',
      channels: (body.channels ?? ['PUSH', 'EMAIL', 'IN_APP']) as NotificationChannel[],
      action: { type: 'NAVIGATE', screen: 'league_feed', params: { leagueId: body.leagueId } },
    };
    // Bypass preferences — dispatcher sends to all channels regardless
    // The dispatcher already handles IN_APP without preference check
    return dispatcher.dispatch(event);
  });

  // --- Scheduled Notifications ---

  app.post<{
    Body: {
      eventType: string;
      fireAt: string;
      context: Record<string, unknown>;
      sourceType: string;
      sourceId: string;
    };
  }>('/api/v1/notifications/schedule', async (request) => {
    const id = await scheduledRunner.schedule({
      eventType: request.body.eventType,
      fireAt: new Date(request.body.fireAt),
      context: request.body.context,
      sourceType: request.body.sourceType,
      sourceId: request.body.sourceId,
    });
    return { scheduled: true, id };
  });

  app.delete<{ Params: { sourceType: string; sourceId: string } }>(
    '/api/v1/notifications/schedule/:sourceType/:sourceId',
    async (request) => {
      const count = await scheduledRunner.cancelForSource(request.params.sourceType, request.params.sourceId);
      return { cancelled: count };
    },
  );

  // --- Weekly Digest ---

  app.post<{ Params: { leagueId: string } }>(
    '/api/v1/notifications/digest/:leagueId',
    async (request) => {
      return digestService.sendDigest(request.params.leagueId);
    },
  );

  // --- Delivery Analytics ---

  app.get<{ Querystring: { days?: string } }>(
    '/api/v1/notifications/analytics',
    async (request) => {
      const days = parseInt(request.query.days ?? '7', 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const logs = await prisma.notificationDeliveryLog.findMany({
        where: { createdAt: { gte: since } },
      });

      const total = logs.length;
      const sent = logs.filter((l: NotificationDeliveryLog) => l.status === 'SENT').length;
      const suppressed = logs.filter((l: NotificationDeliveryLog) => l.status === 'SUPPRESSED').length;
      const failed = logs.filter((l: NotificationDeliveryLog) => l.status === 'FAILED').length;

      const byChannel: Record<string, { sent: number; suppressed: number; failed: number }> = {};
      for (const log of logs) {
        const ch = byChannel[log.channel] ?? { sent: 0, suppressed: 0, failed: 0 };
        if (log.status === 'SENT') ch.sent++;
        else if (log.status === 'SUPPRESSED') ch.suppressed++;
        else if (log.status === 'FAILED') ch.failed++;
        byChannel[log.channel] = ch;
      }

      const suppressionReasons: Record<string, number> = {};
      for (const log of logs.filter((l: NotificationDeliveryLog) => l.status === 'SUPPRESSED')) {
        const reason = log.suppressionReason ?? 'UNKNOWN';
        suppressionReasons[reason] = (suppressionReasons[reason] ?? 0) + 1;
      }

      return {
        period: { days, since: since.toISOString() },
        total,
        deliveryRate: total > 0 ? Math.round((sent / total) * 1000) / 10 : 0,
        sent,
        suppressed,
        failed,
        byChannel,
        suppressionReasons,
      };
    },
  );

  // --- Test endpoints ---

  app.post<{ Body: { to: string; subject: string; text: string; html?: string } }>(
    '/api/v1/test/email',
    async (request) => channels.email.sendToUser(request.body.to, request.body.subject, request.body.text, request.body.html),
  );

  app.post<{ Body: { platform: string; token: string; title: string; body: string; data?: Record<string, string> } }>(
    '/api/v1/test/push',
    async (request) => channels.push.sendToDevice(
      request.body.platform as 'ios' | 'android',
      request.body.token,
      { title: request.body.title, body: request.body.body, data: request.body.data },
    ),
  );

  // --- Lifecycle ---

  app.addHook('onReady', async () => {
    scheduledRunner.start();
    app.log.info('Scheduled notification runner started');

    registerPushTriggers(dispatcher);
    app.log.info('Push notification triggers registered');

    // Flush grouped events periodically
    setInterval(() => {
      const grouped = eventGrouper.flushExpired();
      for (const g of grouped) {
        dispatcher.dispatch({
          id: crypto.randomUUID(),
          type: g.eventType,
          sourceService: 'event-grouper',
          timestamp: new Date().toISOString(),
          tenantId: '',
          recipientUserIds: [g.userId],
          data: { ...g.latestData, count: g.count },
          priority: 'NORMAL',
          action: { type: 'NAVIGATE', screen: 'home', params: {} },
        });
      }
    }, 30_000);
  });

  app.addHook('onClose', async () => {
    scheduledRunner.stop();
  });

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const config = loadConfig();
  try {
    await app.listen({ port: config.port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
