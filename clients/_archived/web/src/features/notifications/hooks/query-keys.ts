export const notificationKeys = {
  all: ['notifications'] as const,
  list: (category?: string) => [...notificationKeys.all, 'list', { category }] as const,
  unreadCount: () => [...notificationKeys.all, 'unread-count'] as const,
  unreadCountGrouped: () => [...notificationKeys.all, 'unread-count', 'grouped'] as const,
  unreadList: () => [...notificationKeys.all, 'unread', 'list'] as const,
  preferences: () => [...notificationKeys.all, 'preferences'] as const,
};
