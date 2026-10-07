/**
 * PollConfigService — admin-configurable client poll intervals, stored as the
 * POLL_INTERVAL_CONFIG settings group (#450). Admins tune client polling rates without a
 * redeploy; the routes under /platform/poll-intervals read and write through here.
 */

import type { FastifyBaseLogger } from 'fastify';
import { PollIntervalConfigSchema } from '@poolmaster/shared/dto';
import type { PollIntervalConfig, PollIntervalConfigPatch } from '@poolmaster/shared/dto';
import type { AppSettingsService } from './app-settings-service';
import { defineSettingsGroup } from './settings-group';

export const POLL_INTERVAL_SETTINGS = defineSettingsGroup<PollIntervalConfig>({
  key: 'POLL_INTERVAL_CONFIG',
  title: 'Poll intervals',
  description: 'How often clients refresh standings, drafts, contest status and notifications.',
  schema: PollIntervalConfigSchema,
  defaults: () => ({
    standings: 10000,
    draft: 10000,
    contestStatus: 30000,
    notifications: 30000,
    default: 30000,
  }),
});

export class PollConfigService {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  /**
   * Returns the current poll interval configuration.
   */
  getConfig(): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.get.start',
    }, 'Loading poll interval config');
    const config = this.settings.get(POLL_INTERVAL_SETTINGS);
    this.logger?.info({
      action: 'adminPollConfig.get.success',
    }, 'Loaded poll interval config');
    return Promise.resolve(config);
  }

  /**
   * Merges partial updates into the current configuration.
   */
  async updateConfig(
    partial: PollIntervalConfigPatch,
    rootAdminUserId: string,
  ): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating poll interval config');
    const saved = await this.settings.save(
      POLL_INTERVAL_SETTINGS,
      { ...this.settings.get(POLL_INTERVAL_SETTINGS), ...partial },
      { changedById: rootAdminUserId },
    );

    this.logger?.info({
      action: 'adminPollConfig.update.success',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updated poll interval config');
    return saved.value;
  }

  /**
   * Resets all intervals to their defaults.
   */
  async resetDefaults(
    rootAdminUserId: string,
  ): Promise<PollIntervalConfig> {
    this.logger?.debug({
      action: 'adminPollConfig.reset.start',
    }, 'Resetting poll interval config');
    const saved = await this.settings.reset(POLL_INTERVAL_SETTINGS, { changedById: rootAdminUserId });

    this.logger?.info({
      action: 'adminPollConfig.reset.success',
    }, 'Reset poll interval config');
    return saved.value;
  }
}
