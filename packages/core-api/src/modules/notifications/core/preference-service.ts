/**
 * PreferenceService — resolves whether a notification should be sent
 * to a user on a given channel based on their preferences.
 */

import type { NotificationCategory, NotificationChannel } from '@poolmaster/shared/events';
import { NotificationChannel as NotificationChannelEnum } from '@poolmaster/shared/domain';

export interface CategoryPreference {
  enabled: boolean;
  channels: {
    push: boolean;
    email: boolean;
    in_app: boolean;
    sms: boolean;
  };
}

export interface UserPreferences {
  doNotDisturb: boolean;
  dndSchedule?: {
    enabled: boolean;
    startTime: string;
    endTime: string;
    timezone: string;
  };
  categories: Record<string, CategoryPreference>;
}

const DEFAULT_PREFERENCES: Record<NotificationCategory, CategoryPreference> = {
  DRAFT: { enabled: true, channels: { push: true, email: true, in_app: true, sms: false } },
  SCORING: { enabled: true, channels: { push: true, email: false, in_app: true, sms: false } },
  CONTEST: { enabled: true, channels: { push: true, email: true, in_app: true, sms: false } },
  LEAGUE: { enabled: true, channels: { push: false, email: false, in_app: true, sms: false } },
  SOCIAL: { enabled: true, channels: { push: true, email: false, in_app: true, sms: false } },
  ACCOUNT: { enabled: true, channels: { push: false, email: true, in_app: true, sms: false } },
};

/**
 * Maps a notification event type to its category.
 */
export function getEventCategory(eventType: string): NotificationCategory {
  const prefix = eventType.split('.')[0];
  const categoryMap: Record<string, NotificationCategory> = {
    draft: 'DRAFT',
    scoring: 'SCORING',
    contest: 'CONTEST',
    league: 'LEAGUE',
    social: 'SOCIAL',
    account: 'ACCOUNT',
  };
  return categoryMap[prefix] ?? 'ACCOUNT';
}

/**
 * Checks whether a notification should be delivered to a user on a specific channel.
 */
export function shouldDeliver(
  eventType: string,
  channel: NotificationChannel,
  preferences?: UserPreferences,
): boolean {
  // In-app is always delivered
  if (channel === NotificationChannelEnum.IN_APP) return true;

  // Global DND blocks push and SMS (not email or in-app)
  if (preferences?.doNotDisturb && (channel === NotificationChannelEnum.PUSH || channel === NotificationChannelEnum.SMS)) {
    // Check DND schedule if configured
    if (preferences.dndSchedule?.enabled) {
      if (isInDndWindow(preferences.dndSchedule)) return false;
    } else {
      return false;
    }
  }

  const category = getEventCategory(eventType);
  const prefs = preferences?.categories?.[category];
  const defaults = DEFAULT_PREFERENCES[category];
  const categoryPref = prefs ?? defaults;

  if (!categoryPref?.enabled) return false;

  const channelKey = channel.toLowerCase().replace('-', '_') as keyof CategoryPreference['channels'];
  return categoryPref.channels[channelKey] ?? false;
}

/**
 * Returns the default preferences for a new user.
 */
export function getDefaultPreferences(): Record<NotificationCategory, CategoryPreference> {
  return { ...DEFAULT_PREFERENCES };
}

function isInDndWindow(schedule: { startTime: string; endTime: string }): boolean {
  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  const [startH, startM] = schedule.startTime.split(':').map(Number);
  const [endH, endM] = schedule.endTime.split(':').map(Number);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  if (startMinutes <= endMinutes) {
    // Same day range (e.g., 09:00 - 17:00)
    return currentMinutes >= startMinutes && currentMinutes < endMinutes;
  } else {
    // Overnight range (e.g., 22:00 - 07:00)
    return currentMinutes >= startMinutes || currentMinutes < endMinutes;
  }
}
