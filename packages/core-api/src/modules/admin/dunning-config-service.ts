/**
 * DunningConfigService — admin-configurable dunning schedule management.
 *
 * Provides runtime configuration for the DunningService retry schedule,
 * grace periods, degradation timeline, and notification preferences.
 * Replaces the hardcoded DEFAULT_CONFIG in the DunningService.
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DunningScheduleConfig {
  retryAttempts: { daysAfterFailure: number; action: string }[];
  gracePeriodDays: number;
  degradedPeriodDays: number;
  cancellationDays: number;
  notifyOnRetry: boolean;
  notifyOnGracePeriodStart: boolean;
  notifyOnDegradation: boolean;
  notifyBeforeCancellation: boolean;
  notifyBeforeCancellationDays: number;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DUNNING_CONFIG: DunningScheduleConfig = {
  retryAttempts: [
    { daysAfterFailure: 1, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 3, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 5, action: 'RETRY_PAYMENT' },
    { daysAfterFailure: 7, action: 'RETRY_PAYMENT' },
  ],
  gracePeriodDays: 7,
  degradedPeriodDays: 14,
  cancellationDays: 21,
  notifyOnRetry: true,
  notifyOnGracePeriodStart: true,
  notifyOnDegradation: true,
  notifyBeforeCancellation: true,
  notifyBeforeCancellationDays: 3,
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let currentConfig: DunningScheduleConfig = deepCopy(DEFAULT_DUNNING_CONFIG);

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DunningConfigService {
  /**
   * Returns the current dunning schedule configuration.
   */
  async getConfig(): Promise<DunningScheduleConfig> {
    return deepCopy(currentConfig);
  }

  /**
   * Merges partial updates into the current configuration.
   */
  async updateConfig(
    partial: Partial<DunningScheduleConfig>,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<DunningScheduleConfig> {
    const before = deepCopy(currentConfig);
    currentConfig = { ...currentConfig, ...partial };

    // Deep-merge retryAttempts if provided (replace entirely)
    if (partial.retryAttempts) {
      currentConfig.retryAttempts = partial.retryAttempts.map((a) => ({ ...a }));
    }

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'UPDATE_DUNNING_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'dunning-schedule',
      description: 'Updated dunning schedule configuration',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    return deepCopy(currentConfig);
  }

  /**
   * Resets the dunning schedule to hardcoded defaults.
   */
  async resetDefaults(
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<DunningScheduleConfig> {
    const before = deepCopy(currentConfig);
    currentConfig = deepCopy(DEFAULT_DUNNING_CONFIG);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'RESET_DUNNING_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'dunning-schedule',
      description: 'Reset dunning schedule configuration to defaults',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    return deepCopy(currentConfig);
  }
}

// ---------------------------------------------------------------------------
// Getter for DunningService integration
// ---------------------------------------------------------------------------

/**
 * Returns the current dunning config. Called by the DunningService instead
 * of using its hardcoded DEFAULT_CONFIG.
 */
export function getDunningConfig(): DunningScheduleConfig {
  return deepCopy(currentConfig);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepCopy(config: DunningScheduleConfig): DunningScheduleConfig {
  return {
    ...config,
    retryAttempts: config.retryAttempts.map((a) => ({ ...a })),
  };
}
