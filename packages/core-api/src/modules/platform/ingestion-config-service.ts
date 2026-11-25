/**
 * IngestionConfigService — admin-configurable lifecycle-aware ingestion policy, stored as the
 * INGESTION_SCHEDULE_CONFIG settings group (#450) and read by the scheduler on every tick and by
 * the root-admin configuration routes.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  IngestionAlwaysOnSchedulePolicy,
  IngestionFeedSchedulePolicy,
  IngestionScheduleConfig,
  IngestionScheduleConfigPatch,
} from '@poolmaster/shared/dto/config.dto';
import { IngestionScheduleConfigSchema } from '@poolmaster/shared/dto/config.dto';
import { ProviderSyncKind } from '@poolmaster/shared/domain';
import type { AppSettingsService } from './app-settings-service';
import { defineSettingsGroup } from './settings-group';

export const INGESTION_SCHEDULE_SETTINGS = defineSettingsGroup<IngestionScheduleConfig>({
  key: 'INGESTION_SCHEDULE_CONFIG',
  title: 'Ingestion schedule',
  description: 'How often each provider feed runs: one schedule for every sport league.',
  schema: IngestionScheduleConfigSchema,
  defaults: () => ({
    // The synced sport leagues' events sync, every six hours (#1871; was a constant).
    [ProviderSyncKind.EVENTS]: {
      enabled: true,
      intervalMinutes: 360,
    },
    // The field sync has no switch (#2086): it always runs, for synced sport leagues.
    [ProviderSyncKind.FIELD]: {
      intervalMinutes: 360,
      lookaheadDays: 14,
    },
    [ProviderSyncKind.SCORES]: {
      enabled: true,
      intervalSeconds: 300,
    },
  }),
});

export class IngestionConfigService {
  constructor(
    private readonly settings: AppSettingsService,
    private readonly logger?: FastifyBaseLogger,
  ) {}

  // The reads return promises for the scheduler's and the routes' sake; the read itself is
  // synchronous. Each is built in an executor so a throw still arrives as a rejection.
  getConfig(): Promise<IngestionScheduleConfig> {
    return new Promise((resolve) => {
      this.logger?.debug({
        action: 'adminIngestionConfig.get.start',
      }, 'Loading ingestion config');
      const config = this.current();
      this.logger?.info({
        action: 'adminIngestionConfig.get.success',
      }, 'Loaded ingestion config');
      resolve(config);
    });
  }

  async updateConfig(
    partial: IngestionScheduleConfigPatch,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating ingestion config');

    const saved = await this.update((current) => applyPatch(current, partial), rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.update.success',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updated ingestion config');
    return saved;
  }

  async resetDefaults(
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.reset.start',
    }, 'Resetting ingestion config');

    const saved = await this.settings.reset(INGESTION_SCHEDULE_SETTINGS, { changedById: rootAdminUserId });

    this.logger?.info({
      action: 'adminIngestionConfig.reset.success',
    }, 'Reset ingestion config');
    return saved.value;
  }

  private current(): IngestionScheduleConfig {
    return this.settings.get(INGESTION_SCHEDULE_SETTINGS);
  }

  /** Applies a partial change to the stored version, never over another task's newer save. */
  private async update(
    change: (current: IngestionScheduleConfig) => IngestionScheduleConfig,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    const saved = await this.settings.update(INGESTION_SCHEDULE_SETTINGS, change, { changedById: rootAdminUserId });
    return saved.value;
  }
}

function applyPatch(
  config: IngestionScheduleConfig,
  patch: IngestionScheduleConfigPatch,
): IngestionScheduleConfig {
  return {
    [ProviderSyncKind.EVENTS]: mergePolicy(config.EVENTS, patch.EVENTS),
    [ProviderSyncKind.FIELD]: mergePolicy(config.FIELD, patch.FIELD),
    [ProviderSyncKind.SCORES]: mergePolicy(config.SCORES, patch.SCORES),
  };
}

function mergePolicy<P extends IngestionFeedSchedulePolicy | IngestionAlwaysOnSchedulePolicy>(
  base: P,
  patch?: Partial<P>,
): P {
  return {
    ...base,
    ...patch,
  };
}
