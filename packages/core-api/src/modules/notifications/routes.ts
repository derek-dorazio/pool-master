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
        operationId: 'listNotifications',
        response: { 200: zodToJsonSchema(NotificationListResponseSchema) },
      },
    },
    async (request) => {
      const userId = request.headers['x-user-id'] as string;
      const result = await inAppChannel.getNotifications(userId, {
        limit: request.query.limit ? parseInt(request.query.limit, 10) : undefined,
        offset: request.query.offset ? parseInt(request.query.offset, 10) : undefined,
        unreadOnly: request.query.unreadOnly === 'true',
      });
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
      operationId: 'getUnreadNotificationCount',
      response: { 200: zodToJsonSchema(NotificationUnreadCountResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return { unreadCount: await inAppChannel.getUnreadCount(userId) };
    },
  });

  app.put<{ Params: { id: string } }>('/notifications/:id/read', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark a notification as read',
      operationId: 'markNotificationRead',
      response: { 200: zodToJsonSchema(NotificationMarkedReadResponseSchema) },
    },
    handler: async (request) => {
      await inAppChannel.markAsRead(request.params.id);
      return { success: true };
    },
  });

  app.put('/notifications/read-all', {
    schema: {
      tags: ['Notifications'],
      summary: 'Mark all notifications as read',
      operationId: 'markAllNotificationsRead',
      response: { 200: zodToJsonSchema(NotificationMarkAllReadResponseSchema) },
    },
    handler: async (request) => {
      const userId = request.headers['x-user-id'] as string;
      return { markedRead: await inAppChannel.markAllAsRead(userId) };
    },
  });

  app.delete<{ Params: { id: string } }>('/notifications/:id', {
    schema: {
      tags: ['Notifications'],
      summary: 'Dismiss a notification',
      operationId: 'dismissNotification',
      response: { 200: zodToJsonSchema(NotificationMarkedReadResponseSchema) },
    },
    handler: async (request) => {
      await inAppChannel.dismiss(request.params.id);
      return { success: true };
    },
  });
}
