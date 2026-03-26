import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from './core/config';
import { getDefaultPreferences } from './core/preference-service';
import { createChannels } from './channels/channel-factory';

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();
  const config = loadConfig();
  const channels = createChannels(config, prisma);

  // --- Health ---

  app.get('/health', async () => {
    return { status: 'ok', service: 'notification-service', emailProvider: config.emailProvider };
  });

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
    const count = await channels.inApp.getUnreadCount(userId);
    return { unreadCount: count };
  });

  app.put<{ Params: { id: string } }>(
    '/api/v1/notifications/:id/read',
    async (request) => {
      await channels.inApp.markAsRead(request.params.id);
      return { success: true };
    },
  );

  app.put('/api/v1/notifications/read-all', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const count = await channels.inApp.markAllAsRead(userId);
    return { markedRead: count };
  });

  app.delete<{ Params: { id: string } }>(
    '/api/v1/notifications/:id',
    async (request) => {
      await channels.inApp.dismiss(request.params.id);
      return { success: true };
    },
  );

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
          categoryPreferences: body.categories ? (body.categories as object) : (getDefaultPreferences() as unknown as object),
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

  // --- Device Registration (Push) ---

  app.post<{ Body: { platform: string; token: string; appVersion?: string; osVersion?: string; deviceModel?: string } }>(
    '/api/v1/devices',
    async (request, reply) => {
      const userId = request.headers['x-user-id'] as string;
      const body = request.body;
      const device = await prisma.deviceRegistration.upsert({
        where: { platform_token: { platform: body.platform, token: body.token } },
        create: {
          userId,
          platform: body.platform,
          token: body.token,
          appVersion: body.appVersion,
          osVersion: body.osVersion,
          deviceModel: body.deviceModel,
          lastActiveAt: new Date(),
        },
        update: {
          userId,
          appVersion: body.appVersion,
          osVersion: body.osVersion,
          deviceModel: body.deviceModel,
          isActive: true,
          lastActiveAt: new Date(),
        },
      });
      return reply.status(201).send({ device });
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/devices/:id',
    async (request) => {
      await prisma.deviceRegistration.update({
        where: { id: request.params.id },
        data: { isActive: false },
      });
      return { success: true };
    },
  );

  // --- Test endpoints (dev only) ---

  app.post<{ Body: { to: string; subject: string; text: string; html?: string } }>(
    '/api/v1/test/email',
    async (request) => {
      const result = await channels.email.sendToUser(
        request.body.to,
        request.body.subject,
        request.body.text,
        request.body.html,
      );
      return result;
    },
  );

  app.post<{ Body: { platform: string; token: string; title: string; body: string; data?: Record<string, string> } }>(
    '/api/v1/test/push',
    async (request) => {
      const result = await channels.push.sendToDevice(
        request.body.platform as 'ios' | 'android',
        request.body.token,
        { title: request.body.title, body: request.body.body, data: request.body.data },
      );
      return result;
    },
  );

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
