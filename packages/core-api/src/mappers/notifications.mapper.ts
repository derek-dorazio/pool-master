import type { Notification } from '@prisma/client';

function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

/**
 * Takes the Prisma row directly. It previously took `Record<string, unknown>`,
 * which forced every caller to assert its typed row through `unknown` and made
 * the defensive `String(...)` coercion below load-bearing rather than belt-and-
 * braces. With the real type the coercion is redundant, but it is left in place:
 * narrowing it is a behavior change that belongs in its own slice.
 */
export function mapNotificationToDto(notification: Notification) {
  return {
    id: String(notification.id),
    userId: notification.userId == null ? undefined : String(notification.userId),
    eventType: String(notification.eventType),
    title: String(notification.title),
    body: String(notification.body),
    read: Boolean(notification.read),
    readAt: notification.readAt instanceof Date ? toIso(notification.readAt) : undefined,
    dismissed: notification.dismissed == null ? undefined : Boolean(notification.dismissed),
    imageUrl: notification.imageUrl == null ? undefined : String(notification.imageUrl),
    actionScreen: notification.actionScreen == null ? undefined : String(notification.actionScreen),
    actionParams: (notification.actionParams ?? {}) as Record<string, unknown>,
    groupKey: notification.groupKey == null ? undefined : String(notification.groupKey),
    createdAt: notification.createdAt instanceof Date
      ? notification.createdAt.toISOString()
      : String(notification.createdAt),
  };
}
