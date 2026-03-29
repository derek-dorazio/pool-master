// Notification routes — extracted from notification-service/src/index.ts
import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import type { NotificationEvent, NotificationChannel, NotificationPriority } from '@poolmaster/shared/events';
import type { NotificationDispatcher } from './core/dispatcher';
import type { InMemoryRateLimiter } from './core/rate-limiter';
import type { EventGrouper } from './core/event-grouper';
import type { ScheduledRunner } from './core/scheduled-runner';
import type { WeeklyDigestService } from './core/weekly-digest';
import type { Channels } from './channels/channel-factory';
import { getDefaultPreferences } from './core/preference-service';
import crypto from 'node:crypto';

export interface NotificationModuleOpts {
  prisma: PrismaClient;
  channels: Channels;
  dispatcher: NotificationDispatcher;
  rateLimiter: InMemoryRateLimiter;
  eventGrouper: EventGrouper;
  scheduledRunner: ScheduledRunner;
  digestService: WeeklyDigestService;
}

export async function notificationsModule(
  app: FastifyInstance,
  opts: NotificationModuleOpts,
): Promise<void> {
  const { prisma, channels, dispatcher, eventGrouper, scheduledRunner, digestService } = opts;

  // --- In-App Notification Centre ---

  app.get<{ Querystring: { limit?: string; offset?: string; unreadOnly?: string } }>(
    '/notifications',
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return channels.inApp.getNotifications(userId, {
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        unreadOnly: request.query.unreadOnly === 'true',
      });
    },
  );

  app.get('/notifications/unread-count', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    return { unreadCount: await channels.inApp.getUnreadCount(userId) };
  });

  app.put<{ Params: { id: string } }>('/notifications/:id/read', async (request) => {
    await channels.inApp.markAsRead(request.params.id);
    return { success: true };
  });

  app.put('/notifications/read-all', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    return { markedRead: await channels.inApp.markAllAsRead(userId) };
  });

  app.delete<{ Params: { id: string } }>('/notifications/:id', async (request) => {
    await channels.inApp.dismiss(request.params.id);
    return { success: true };
  });

  // --- Preferences ---

  app.get('/notifications/preferences', async (request) => {
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
    '/notifications/preferences',
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
    '/notifications/unsubscribe/:category',
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
    '/devices',
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
    '/devices/register',
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

  app.delete<{ Params: { id: string } }>('/devices/:id', async (request) => {
    await prisma.deviceRegistration.update({ where: { id: request.params.id }, data: { isActive: false } });
    return { success: true };
  });

  app.get('/devices', async (request) => {
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
  }>('/notifications/dispatch', async (request) => {
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

    if (eventGrouper.isGroupable(event.type) && event.recipientUserIds?.length === 1) {
      const grouped = eventGrouper.add({
        id: event.id,
        type: event.type,
        userId: event.recipientUserIds[0],
        data: event.data as Record<string, unknown>,
        timestamp: new Date(),
      });
      if (grouped) {
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
  }>('/notifications/announce', async (request) => {
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
  }>('/notifications/schedule', async (request) => {
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
    '/notifications/schedule/:sourceType/:sourceId',
    async (request) => {
      const count = await scheduledRunner.cancelForSource(request.params.sourceType, request.params.sourceId);
      return { cancelled: count };
    },
  );

  // --- Weekly Digest ---

  app.post<{ Params: { leagueId: string } }>(
    '/notifications/digest/:leagueId',
    async (request) => {
      return digestService.sendDigest(request.params.leagueId);
    },
  );

  // --- Delivery Analytics ---

  app.get<{ Querystring: { days?: string } }>(
    '/notifications/analytics',
    async (request) => {
      const days = parseInt(request.query.days ?? '7', 10);
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const logs = await prisma.notificationDeliveryLog.findMany({
        where: { createdAt: { gte: since } },
      });

      const total = logs.length;
      const sent = logs.filter((l: any) => l.status === 'SENT').length;
      const suppressed = logs.filter((l: any) => l.status === 'SUPPRESSED').length;
      const failed = logs.filter((l: any) => l.status === 'FAILED').length;

      const byChannel: Record<string, { sent: number; suppressed: number; failed: number }> = {};
      for (const log of logs) {
        const ch = byChannel[log.channel] ?? { sent: 0, suppressed: 0, failed: 0 };
        if (log.status === 'SENT') ch.sent++;
        else if (log.status === 'SUPPRESSED') ch.suppressed++;
        else if (log.status === 'FAILED') ch.failed++;
        byChannel[log.channel] = ch;
      }

      const suppressionReasons: Record<string, number> = {};
      for (const log of logs.filter((l: any) => l.status === 'SUPPRESSED')) {
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
    '/test/email',
    async (request) => channels.email.sendToUser(request.body.to, request.body.subject, request.body.text, request.body.html),
  );

  app.post<{ Body: { platform: string; token: string; title: string; body: string; data?: Record<string, string> } }>(
    '/test/push',
    async (request) => channels.push.sendToDevice(
      request.body.platform as 'ios' | 'android',
      request.body.token,
      { title: request.body.title, body: request.body.body, data: request.body.data },
    ),
  );
}
