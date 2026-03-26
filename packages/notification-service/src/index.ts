import Fastify from 'fastify';
import { PrismaClient } from '@prisma/client';
import { InAppChannel } from './channels/in-app-channel';
import { getDefaultPreferences } from './core/preference-service';

export function buildApp() {
  const app = Fastify({ logger: true });
  const prisma = new PrismaClient();
  const inAppChannel = new InAppChannel(prisma);

  // --- Health ---

  app.get('/health', async () => {
    return { status: 'ok', service: 'notification-service' };
  });

  // --- In-App Notification Centre ---

  // GET /api/v1/notifications
  app.get<{ Querystring: { limit?: string; offset?: string; unreadOnly?: string } }>(
    '/api/v1/notifications',
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return inAppChannel.getNotifications(userId, {
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        unreadOnly: request.query.unreadOnly === 'true',
      });
    },
  );

  // GET /api/v1/notifications/unread-count
  app.get('/api/v1/notifications/unread-count', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const count = await inAppChannel.getUnreadCount(userId);
    return { unreadCount: count };
  });

  // PUT /api/v1/notifications/:id/read
  app.put<{ Params: { id: string } }>(
    '/api/v1/notifications/:id/read',
    async (request) => {
      await inAppChannel.markAsRead(request.params.id);
      return { success: true };
    },
  );

  // PUT /api/v1/notifications/read-all
  app.put('/api/v1/notifications/read-all', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const count = await inAppChannel.markAllAsRead(userId);
    return { markedRead: count };
  });

  // DELETE /api/v1/notifications/:id
  app.delete<{ Params: { id: string } }>(
    '/api/v1/notifications/:id',
    async (request) => {
      await inAppChannel.dismiss(request.params.id);
      return { success: true };
    },
  );

  // --- Preferences ---

  // GET /api/v1/notifications/preferences
  app.get('/api/v1/notifications/preferences', async (request) => {
    const userId = request.headers['x-user-id'] as string;
    const prefs = await prisma.notificationPreference.findUnique({
      where: { userId },
    });
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

  // PUT /api/v1/notifications/preferences
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

  return app;
}

async function start(): Promise<void> {
  const app = buildApp();
  const port = Number(process.env.PORT ?? 3004);

  try {
    await app.listen({ port, host: '0.0.0.0' });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
