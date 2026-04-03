function toIso(value?: Date | null): string | undefined {
  return value ? value.toISOString() : undefined;
}

export function mapNotificationToDto(notification: Record<string, unknown>) {
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

export function mapNotificationPreferenceToDto(preferences: {
  doNotDisturb: boolean;
  dndSchedule?: Record<string, unknown>;
  categories: Record<string, unknown>;
}) {
  return preferences;
}

export function mapNotificationDeviceToDto(device: Record<string, unknown>) {
  return {
    id: String(device.id),
    userId: String(device.userId),
    platform: String(device.platform),
    token: String(device.token),
    appVersion: device.appVersion == null ? undefined : String(device.appVersion),
    osVersion: device.osVersion == null ? undefined : String(device.osVersion),
    deviceModel: device.deviceModel == null ? undefined : String(device.deviceModel),
    isActive: Boolean(device.isActive),
    registeredAt: device.registeredAt instanceof Date
      ? device.registeredAt.toISOString()
      : String(device.registeredAt),
    lastActiveAt: device.lastActiveAt instanceof Date
      ? device.lastActiveAt.toISOString()
      : String(device.lastActiveAt),
  };
}
