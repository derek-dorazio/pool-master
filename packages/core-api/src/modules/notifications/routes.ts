import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { zodToJsonSchema } from '@poolmaster/shared/dto';
import {
  NotificationListResponseSchema,
  NotificationUnreadCountResponseSchema,
  NotificationMarkedReadResponseSchema,
  NotificationMarkAllReadResponseSchema,
} from '@poolmaster/shared/dto/notifications.dto';
import { mapNotificationToDto } from '../../mappers';
import { InAppChannel } from './channels/in-app-channel';

export interface NotificationModuleOpts {
  prisma: PrismaClient;
}

export async function notificationsModule(
  app: FastifyInstance,
  opts: NotificationModuleOpts,
): Promise<void> {
  const inAppChannel = new InAppChannel(opts.prisma);

  app.get<{ Querystring: { limit?: string; offset?: string; unreadOnly?: string } }>(
    '/notifications',
    {
      schema: {
        tags: ['Notifications'],
        summary: 'List in-app notifications for current user',
        description:
          'Returns the authenticated user notification feed for in-app inbox and unread-state surfaces.',
        operationId: 'listNotifications',
        response: { 200: zodToJsonSchema(NotificationListResponseSchema) },
      },
    },
    async (request) => {
      const logger = request.contextLogger ?? request.log;
      const userId = request.authUser?.userId as string;
      logger.debug({
        userId,
        limit: request.query.limit ?? null,
        offset: request.query.offset ?? null,
        unreadOnly: request.query.unreadOnly ?? null,
      }, 'Listing in-app notifications');
      const result = await inAppChannel.getNotifications(userId, {
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        unreadOnly: request.query.unreadOnly === 'true',
      });
      logger.info({ userId, count: result.notifications.length, total: result.total }, 'Listed in-app notifications');
      return {
        notifications: result.notifications.map((notification) =>
          mapNotificationToDto(notification as unknown as Record<string, unknown>),
        ),
        total: result.total,
      };
    },
  );

  app.get('/notifications/unread-count', {
    schema: {
      tags: ['Notifications'],
      summary: 'Get unread notification count',
      description:
        'Returns the unread notification count used by shell badges and lightweight polling surfaces.',
      operationId: 'getUnreadNotificationCount',
      response: { 200: zodToJsonSchema(NotificationUnreadCountResponseSchema) },
    },
    handler: async (request) => {
      const logger = request.contextLogger ?? request.log;
      const userId = request.authUser?.userId as string;
      logger.debug({ userId }, 'Reading unread notification count');
      const unreadCount = await inAppChannel.getUnreadCount(userId);
      logger.info({ userId, unreadCount }, 'Read unread notification count');
      return { unreadCount };
    },
  });

  app.put<{ Params: { id: string } }>('/notifications/:id/read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark a notification as read',
      description:
        'Marks the specified notification as read for the authenticated user.',
      operationId: 'markNotificationRead',
      response: { 200: zodToJsonSchema(NotificationMarkedReadResponseSchema) },
    },
    handler: async (request) => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({ notificationId: request.params.id }, 'Marking notification as read');
      await inAppChannel.markAsRead(request.params.id);
      logger.info({ notificationId: request.params.id }, 'Marked notification as read');
      return { success: true };
    },
  });

  app.put('/notifications/read-all', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark all notifications as read',
      description:
        'Marks every current notification as read for the authenticated user.',
      operationId: 'markAllNotificationsRead',
      response: { 200: zodToJsonSchema(NotificationMarkAllReadResponseSchema) },
    },
    handler: async (request) => {
      const logger = request.contextLogger ?? request.log;
      const userId = request.authUser?.userId as string;
      logger.debug({ userId }, 'Marking all notifications as read');
      const markedRead = await inAppChannel.markAllAsRead(userId);
      logger.info({ userId, markedRead }, 'Marked all notifications as read');
      return { markedRead };
    },
  });

  app.delete<{ Params: { id: string } }>('/notifications/:id', {
    schema: {
      tags: ['Notifications'],
      summary: 'Dismiss a notification',
      description:
        'Dismisses a notification so it no longer appears in the active inbox feed.',
      operationId: 'dismissNotification',
      response: { 200: zodToJsonSchema(NotificationMarkedReadResponseSchema) },
    },
    handler: async (request) => {
      const logger = request.contextLogger ?? request.log;
      logger.debug({ notificationId: request.params.id }, 'Dismissing notification');
      await inAppChannel.dismiss(request.params.id);
      logger.info({ notificationId: request.params.id }, 'Dismissed notification');
      return { success: true };
    },
  });
}
