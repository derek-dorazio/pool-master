/**
 * PollConfigService — admin-configurable poll interval management.
 *
 * Replaces the hardcoded POLL_INTERVAL_CONFIG in the poll-config plugin
 * with a runtime-configurable service. Admins can tune client polling
 * rates without redeployment.
 */

import { logAdminAction } from './admin-audit-service';
import type { FastifyBaseLogger } from 'fastify';
import { PollIntervalConfigSchema } from '@poolmaster/shared/dto';
import type { PrismaPlatformRuntimeConfigRepository } from './platform-runtime-config-repository';

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

const POLL_RUNTIME_CONFIG_KEY = 'POLL_INTERVAL_CONFIG';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class PollConfigService {
  private initialized = false;
  private readonly repository?: PrismaPlatformRuntimeConfigRepository;
  private readonly logger?: FastifyBaseLogger;

  constructor(
    repositoryOrLogger?: PrismaPlatformRuntimeConfigRepository | FastifyBaseLogger,
    logger?: FastifyBaseLogger,
  ) {
    if (repositoryOrLogger && 'findByKey' in repositoryOrLogger) {
      this.repository = repositoryOrLogger;
      this.logger = logger;
      return;
    }

    this.repository = undefined;
    this.logger = repositoryOrLogger as FastifyBaseLogger | undefined;
  }

  async bootstrap(): Promise<void> {
    await this.ensureLoaded();
  }
  /**
   * Returns the current poll interval configuration.
   */
  async getConfig(): Promise<PollIntervalConfig> {
    await this.ensureLoaded();
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
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminPollConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating poll interval config');
    const before = { ...currentConfig };
    currentConfig = { ...currentConfig, ...partial };
    await this.persist(rootAdminUserId);

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
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminPollConfig.reset.start',
    }, 'Resetting poll interval config');
    const before = { ...currentConfig };
    currentConfig = { ...DEFAULT_POLL_CONFIG };
    await this.persist(rootAdminUserId);

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

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.repository) {
      this.initialized = true;
      return;
    }

    const existing = await this.repository.findByKey(POLL_RUNTIME_CONFIG_KEY);
    if (!existing) {
      await this.repository.create({
        configKey: POLL_RUNTIME_CONFIG_KEY,
        configJson: DEFAULT_POLL_CONFIG,
      });
      currentConfig = { ...DEFAULT_POLL_CONFIG };
      this.initialized = true;
      return;
    }

    const parsed = PollIntervalConfigSchema.safeParse(existing.configJson);
    if (!parsed.success) {
      this.logger?.warn({
        action: 'adminPollConfig.bootstrap.invalidPersistedConfig',
        issues: parsed.error.issues,
      }, 'Persisted poll interval config was invalid; reverting to defaults');
      currentConfig = { ...DEFAULT_POLL_CONFIG };
      await this.repository.update({
        configKey: POLL_RUNTIME_CONFIG_KEY,
        configJson: currentConfig,
        updatedById: existing.updatedById,
      });
      this.initialized = true;
      return;
    }

    currentConfig = { ...parsed.data };
    this.initialized = true;
  }

  private async persist(updatedById?: string): Promise<void> {
    if (!this.repository) {
      return;
    }

    await this.repository.update({
      configKey: POLL_RUNTIME_CONFIG_KEY,
      configJson: currentConfig,
      updatedById: updatedById ?? null,
    });
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
