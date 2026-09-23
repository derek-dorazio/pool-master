import type { Notification } from '@prisma/client';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

/**
 * Takes the Prisma row directly. It previously took `Record<string, unknown>`,
 * which forced every caller to assert its typed row through `unknown` and made
 * the defensive `String(...)` coercion below load-bearing rather than belt-and-
 * braces. With the real type the coercion was redundant, so it's removed below.
 */
export function mapNotificationToDto(notification: Notification) {
  return {
    id: notification.id,
    userId: notification.userId,
    eventType: notification.eventType,
    title: notification.title,
    body: notification.body,
    read: notification.read,
    readAt: toIso(notification.readAt),
    dismissed: notification.dismissed,
    imageUrl: notification.imageUrl ?? undefined,
    actionScreen: notification.actionScreen ?? undefined,
    actionParams: (notification.actionParams ?? {}) as Record<string, unknown>,
    groupKey: notification.groupKey ?? undefined,
    createdAt: notification.createdAt.toISOString(),
  };
}
