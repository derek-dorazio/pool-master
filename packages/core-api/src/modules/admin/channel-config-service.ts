/**
 * ChannelConfigService — admin-configurable default notification channels.
 *
 * Manages the default channel assignments per notification category.
 * Replaces the hardcoded DEFAULT_CHANNELS in the NotificationDispatcher.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationChannelConfig {
  defaults: Record<string, string[]>;  // category -> channels
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_CHANNEL_CONFIG: NotificationChannelConfig = {
  defaults: {
    DRAFT: ['PUSH', 'EMAIL', 'IN_APP'],
    SCORING: ['PUSH', 'IN_APP'],
    CONTEST: ['PUSH', 'EMAIL', 'IN_APP'],
    LEAGUE: ['IN_APP'],
    SOCIAL: ['PUSH', 'IN_APP'],
    ACCOUNT: ['EMAIL', 'IN_APP'],
  },
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let currentConfig: NotificationChannelConfig = deepCopy(DEFAULT_CHANNEL_CONFIG);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class ChannelConfigService {
  /**
   * Returns the current notification channel defaults.
   */
  async getConfig(): Promise<NotificationChannelConfig> {
    return deepCopy(currentConfig);
  }

  /**
   * Updates the channels for a specific notification category.
   */
  async updateCategoryChannels(
    category: string,
    channels: string[],
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<NotificationChannelConfig> {
    const before = deepCopy(currentConfig);
    currentConfig.defaults[category] = [...channels];

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'UPDATE_CHANNEL_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: `notification-channels:${category}`,
      description: `Updated notification channels for category: ${category}`,
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    return deepCopy(currentConfig);
  }

  /**
   * Resets all channel defaults to their hardcoded values.
   */
  async resetDefaults(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<NotificationChannelConfig> {
    const before = deepCopy(currentConfig);
    currentConfig = deepCopy(DEFAULT_CHANNEL_CONFIG);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'RESET_CHANNEL_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'notification-channels',
      description: 'Reset notification channel defaults',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    return deepCopy(currentConfig);
  }
}

// ---------------------------------------------------------------------------
// Getter for NotificationDispatcher integration
// ---------------------------------------------------------------------------

/**
 * Returns the current channel defaults. Called by the NotificationDispatcher
 * instead of reading the hardcoded DEFAULT_CHANNELS constant.
 */
export function getChannelDefaults(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(currentConfig.defaults).map(([k, v]) => [k, [...v]]),
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepCopy(config: NotificationChannelConfig): NotificationChannelConfig {
  return {
    defaults: Object.fromEntries(
      Object.entries(config.defaults).map(([k, v]) => [k, [...v]]),
    ),
  };
}
