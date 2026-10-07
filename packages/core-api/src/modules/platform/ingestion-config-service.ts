/**
 * IngestionConfigService — admin-configurable lifecycle-aware ingestion policy, stored as the
 * INGESTION_SCHEDULE_CONFIG settings group (#450) and read by the scheduler on every tick and by
 * the root-admin configuration routes.
 */

import type { FastifyBaseLogger } from 'fastify';
import { Sport } from '@poolmaster/shared/domain';
import type {
  IngestionFeedSchedulePolicy,
  IngestionScheduleConfig,
  IngestionScheduleConfigBody,
  IngestionScheduleConfigOverride,
} from '@poolmaster/shared/dto/config.dto';
import { IngestionScheduleConfigSchema } from '@poolmaster/shared/dto/config.dto';
import type { AppSettingsService } from './app-settings-service';
import { defineSettingsGroup } from './settings-group';

type FeedPolicyKey = keyof Omit<IngestionScheduleConfigBody, 'scheduledSports'>;

export const INGESTION_SCHEDULE_SETTINGS = defineSettingsGroup<IngestionScheduleConfig>({
  key: 'INGESTION_SCHEDULE_CONFIG',
  title: 'Ingestion schedule',
  description: 'Which sports sync on a schedule, and how often each provider feed runs.',
  schema: IngestionScheduleConfigSchema,
  defaults: () => ({
    scheduledSports: [Sport.GOLF],
    healthCheck: {
      enabled: true,
      intervalMinutes: 5,
    },
    eventParticipants: {
      enabled: false,
      intervalMinutes: 360,
      lookaheadDays: 14,
    },
    eventLiveScores: {
      enabled: true,
      intervalSeconds: 300,
    },
    perSportOverrides: {},
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
    partial: IngestionScheduleConfigOverride,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating ingestion config');

    const saved = await this.update((current) => ({
      ...mergeBasePolicies(current, partial),
      perSportOverrides: current.perSportOverrides,
    }), rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.update.success',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updated ingestion config');
    return saved;
  }

  getPerSportConfig(sport: string): Promise<IngestionScheduleConfig> {
    return new Promise((resolve) => resolve(this.perSportConfig(sport)));
  }

  private perSportConfig(sport: string): IngestionScheduleConfig {
    this.logger?.debug({
      action: 'adminIngestionConfig.getPerSport.start',
      data: { sport },
    }, 'Loading per-sport ingestion config');

    const baseConfig = this.current();
    const override = baseConfig.perSportOverrides?.[sport];
    if (!override) {
      this.logger?.info({
        action: 'adminIngestionConfig.getPerSport.globalFallback',
        data: { sport },
      }, 'No per-sport override found; returning global ingestion config');
      return baseConfig;
    }

    const merged = {
      ...mergeBasePolicies(baseConfig, override),
      perSportOverrides: baseConfig.perSportOverrides,
    };
    this.logger?.info({
      action: 'adminIngestionConfig.getPerSport.success',
      data: { sport },
    }, 'Loaded per-sport ingestion config');
    return merged;
  }

  async setPerSportOverride(
    sport: string,
    config: IngestionScheduleConfigOverride,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.setOverride.start',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Setting per-sport ingestion override');

    const saved = await this.update((current) => ({
      ...current,
      perSportOverrides: {
        ...current.perSportOverrides,
        [sport]: mergeOverride(current.perSportOverrides[sport] ?? {}, config),
      },
    }), rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.setOverride.success',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Set per-sport ingestion override');
    return saved;
  }

  async clearPerSportOverride(
    sport: string,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.clearOverride.start',
      data: { sport },
    }, 'Clearing per-sport ingestion override');

    const saved = await this.update((current) => {
      const remainingOverrides = { ...current.perSportOverrides };
      delete remainingOverrides[sport];
      return { ...current, perSportOverrides: remainingOverrides };
    }, rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.clearOverride.success',
      data: { sport },
    }, 'Cleared per-sport ingestion override');
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

function mergeBasePolicies(
  config: IngestionScheduleConfig,
  override: IngestionScheduleConfigOverride,
): IngestionScheduleConfigBody {
  return {
    scheduledSports: override.scheduledSports
      ? [...override.scheduledSports]
      : [...config.scheduledSports],
    healthCheck: mergePolicy(config.healthCheck, override.healthCheck),
    eventParticipants: mergePolicy(config.eventParticipants, override.eventParticipants),
    eventLiveScores: mergePolicy(config.eventLiveScores, override.eventLiveScores),
  };
}

function mergeOverride(
  existing: IngestionScheduleConfigOverride,
  incoming: IngestionScheduleConfigOverride,
): IngestionScheduleConfigOverride {
  const merged = {} as IngestionScheduleConfigOverride;
  for (const key of policyKeys()) {
    const nextPolicy = mergePolicyPatch(existing[key], incoming[key]);
    if (nextPolicy) {
      merged[key] = nextPolicy;
    }
  }
  return merged;
}

function mergePolicy(
  base: IngestionFeedSchedulePolicy,
  override?: Partial<IngestionFeedSchedulePolicy>,
): IngestionFeedSchedulePolicy {
  return {
    ...base,
    ...override,
  };
}

function mergePolicyPatch(
  existing?: Partial<IngestionFeedSchedulePolicy>,
  incoming?: Partial<IngestionFeedSchedulePolicy>,
): Partial<IngestionFeedSchedulePolicy> | undefined {
  if (!existing && !incoming) {
    return undefined;
  }

  return {
    ...(existing ?? {}),
    ...(incoming ?? {}),
  };
}

function policyKeys(): FeedPolicyKey[] {
  return [
    'healthCheck',
    'eventParticipants',
    'eventLiveScores',
  ];
}
