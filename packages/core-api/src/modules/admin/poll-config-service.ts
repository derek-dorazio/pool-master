/**
 * PollConfigService — admin-configurable poll interval management.
 *
 * Replaces the hardcoded POLL_INTERVAL_CONFIG in the poll-config plugin
 * with a runtime-configurable service. Admins can tune client polling
 * rates without redeployment.
 */

import { logAdminAction } from './admin-audit-service';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PollIntervalConfig {
  standings: number;       // ms, default 10000
  draft: number;           // ms, default 10000
  contestStatus: number;   // ms, default 30000
  notifications: number;   // ms, default 30000
  default: number;         // ms, default 30000
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLL_CONFIG: PollIntervalConfig = {
  standings: 10000,
  draft: 10000,
  contestStatus: 30000,
  notifications: 30000,
  default: 30000,
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let currentConfig: PollIntervalConfig = { ...DEFAULT_POLL_CONFIG };

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PollConfigService {
  constructor(private readonly logger?: FastifyBaseLogger) {}
  /**
   * Returns the current poll interval configuration.
   */
  async getConfig(): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.get.start',
    }, 'Loading poll interval config');
    this.logger?.info({
      action: 'adminPollConfig.get.success',
    }, 'Loaded poll interval config');
    return { ...currentConfig };
  }

  /**
   * Merges partial updates into the current configuration.
   */
  async updateConfig(
    partial: Partial<PollIntervalConfig>,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating poll interval config');
    const before = { ...currentConfig };
    currentConfig = { ...currentConfig, ...partial };

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'UPDATE_POLL_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'poll-intervals',
      description: 'Updated poll interval configuration',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    this.logger?.info({
      action: 'adminPollConfig.update.success',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updated poll interval config');
    return { ...currentConfig };
  }

  /**
   * Resets all intervals to their hardcoded defaults.
   */
  async resetDefaults(
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.reset.start',
    }, 'Resetting poll interval config');
    const before = { ...currentConfig };
    currentConfig = { ...DEFAULT_POLL_CONFIG };

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'RESET_POLL_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'poll-intervals',
      description: 'Reset poll interval configuration to defaults',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    this.logger?.info({
      action: 'adminPollConfig.reset.success',
    }, 'Reset poll interval config');
    return { ...currentConfig };
  }
}

// ---------------------------------------------------------------------------
// Getter for the poll-config plugin
// ---------------------------------------------------------------------------

/**
 * Returns the current poll interval config. Called by the poll-config plugin
 * instead of reading the hardcoded constant.
 */
export function getPollIntervalConfig(): PollIntervalConfig {
  return { ...currentConfig };
}
