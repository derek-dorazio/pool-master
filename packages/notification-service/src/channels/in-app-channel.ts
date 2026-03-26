/**
 * InAppChannel — writes notifications to the database notification centre.
 *
 * This is the canonical record of all notifications. Always on, always delivered.
 */

import type { PrismaClient } from '@prisma/client';
import type { RenderedContent } from '../core/template-renderer';

export interface InAppNotificationInput {
  userId: string;
  eventType: string;
  title: string;
  body: string;
  imageUrl?: string;
  actionScreen?: string;
  actionParams?: Record<string, string>;
  groupKey?: string;
}

export class InAppChannel {
  constructor(private readonly prisma: PrismaClient) {}

  async send(input: InAppNotificationInput): Promise<string> {
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        imageUrl: input.imageUrl,
        actionScreen: input.actionScreen,
        actionParams: (input.actionParams ?? {}) as object,
        groupKey: input.groupKey,
      },
    });
    return notification.id;
  }

  async sendBatch(inputs: InAppNotificationInput[]): Promise<number> {
    const result = await this.prisma.notification.createMany({
      data: inputs.map((input) => ({
        userId: input.userId,
        eventType: input.eventType,
        title: input.title,
        body: input.body,
        imageUrl: input.imageUrl,
        actionScreen: input.actionScreen,
        actionParams: (input.actionParams ?? {}) as object,
        groupKey: input.groupKey,
      })),
    });
    return result.count;
  }

  async getNotifications(
    userId: string,
    options: { limit?: number; offset?: number; unreadOnly?: boolean } = {},
  ) {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const where: { userId: string; read?: boolean; dismissed: boolean } = {
      userId,
      dismissed: false,
    };
    if (options.unreadOnly) where.read = false;

    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { notifications, total };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, read: false, dismissed: false },
    });
  }

  async markAsRead(notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });
  }

  async markAllAsRead(userId: string): Promise<number> {
    const result = await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true, readAt: new Date() },
    });
    return result.count;
  }

  async dismiss(notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { dismissed: true },
    });
  }
}
