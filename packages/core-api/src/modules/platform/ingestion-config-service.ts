/**
 * IngestionConfigService — admin-configurable lifecycle-aware ingestion policy
 * management used by the scheduler and root-admin configuration routes.
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
import type { PlatformRuntimeConfigRepository } from '@poolmaster/shared/db';

type FeedPolicyKey = keyof Omit<IngestionScheduleConfigBody, 'scheduledSports'>;

const DEFAULT_INGESTION_CONFIG: IngestionScheduleConfig = {
  scheduledSports: [Sport.GOLF],
  healthCheck: {
    enabled: true,
    intervalMinutes: 5,
  },
  eventSchedule: {
    enabled: true,
    intervalMinutes: 1440,
    lookaheadDays: 365,
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
  eventResults: {
    enabled: true,
    intervalMinutes: 30,
  },
  perSportOverrides: {},
};

let currentConfig: IngestionScheduleConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
const INGESTION_RUNTIME_CONFIG_KEY = 'INGESTION_SCHEDULE_CONFIG';

/**
 * Feed policies that no longer exist (#125 retired `participantRankings` with the
 * PARTICIPANTRANKINGS feed). A config persisted before the retirement still carries them, at
 * the top level and inside per-sport overrides. They are dropped before the stored config is
 * parsed so it loads with its live settings intact rather than being judged invalid and reset
 * to defaults.
 */
const RETIRED_FEED_POLICY_KEYS = ['participantRankings'] as const;

export class IngestionConfigService {
  private initialized = false;
  private readonly repository?: PlatformRuntimeConfigRepository;
  private readonly logger?: FastifyBaseLogger;

  constructor(
    repositoryOrLogger?: PlatformRuntimeConfigRepository | FastifyBaseLogger,
    logger?: FastifyBaseLogger,
  ) {
    if (repositoryOrLogger && 'findByKey' in repositoryOrLogger) {
      this.repository = repositoryOrLogger;
      this.logger = logger;
      return;
    }

    this.repository = undefined;
    this.logger = repositoryOrLogger;
  }

  async bootstrap(): Promise<void> {
    await this.ensureLoaded();
  }

  async getConfig(): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.get.start',
    }, 'Loading ingestion config');
    this.logger?.info({
      action: 'adminIngestionConfig.get.success',
    }, 'Loaded ingestion config');
    return deepCopy(currentConfig);
  }

  async updateConfig(
    partial: IngestionScheduleConfigOverride,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating ingestion config');

    currentConfig = {
      ...mergeBasePolicies(currentConfig, partial),
      perSportOverrides: deepCopy(currentConfig).perSportOverrides,
    };
    await this.persist(rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.update.success',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updated ingestion config');
    return deepCopy(currentConfig);
  }

  async getPerSportConfig(sport: string): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.getPerSport.start',
      data: { sport },
    }, 'Loading per-sport ingestion config');

    const baseConfig = deepCopy(currentConfig);
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
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.setOverride.start',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Setting per-sport ingestion override');

    const existingOverride = currentConfig.perSportOverrides[sport] ?? {};
    currentConfig = {
      ...currentConfig,
      perSportOverrides: {
        ...currentConfig.perSportOverrides,
        [sport]: mergeOverride(existingOverride, config),
      },
    };
    await this.persist(rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.setOverride.success',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Set per-sport ingestion override');
    return deepCopy(currentConfig);
  }

  async clearPerSportOverride(
    sport: string,
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.clearOverride.start',
      data: { sport },
    }, 'Clearing per-sport ingestion override');

    const remainingOverrides = { ...currentConfig.perSportOverrides };
    delete remainingOverrides[sport];
    currentConfig = {
      ...currentConfig,
      perSportOverrides: remainingOverrides,
    };
    await this.persist(rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.clearOverride.success',
      data: { sport },
    }, 'Cleared per-sport ingestion override');
    return deepCopy(currentConfig);
  }

  async resetDefaults(
    rootAdminUserId: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.reset.start',
    }, 'Resetting ingestion config');

    currentConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
    await this.persist(rootAdminUserId);

    this.logger?.info({
      action: 'adminIngestionConfig.reset.success',
    }, 'Reset ingestion config');
    return deepCopy(currentConfig);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (!this.repository) {
      this.initialized = true;
      return;
    }

    const existing = await this.repository.findByKey(INGESTION_RUNTIME_CONFIG_KEY);
    if (!existing) {
      await this.repository.create({
        configKey: INGESTION_RUNTIME_CONFIG_KEY,
        configJson: DEFAULT_INGESTION_CONFIG,
      });
      currentConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
      this.initialized = true;
      return;
    }

    const withoutRetired = withoutRetiredFeedPolicies(existing.configJson);
    const parsed = IngestionScheduleConfigSchema.safeParse(withoutRetired.config);
    if (!parsed.success) {
      this.logger?.warn({
        action: 'adminIngestionConfig.bootstrap.invalidPersistedConfig',
        issues: parsed.error.issues,
      }, 'Persisted ingestion schedule config was invalid; reverting to defaults');
      currentConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
      await this.repository.update({
        configKey: INGESTION_RUNTIME_CONFIG_KEY,
        configJson: currentConfig,
        updatedById: existing.updatedById,
      });
      this.initialized = true;
      return;
    }

    currentConfig = deepCopy(parsed.data);
    if (withoutRetired.removed) {
      this.logger?.info({
        action: 'adminIngestionConfig.bootstrap.retiredFeedPoliciesRemoved',
        data: { retiredKeys: RETIRED_FEED_POLICY_KEYS },
      }, 'Removed retired feed policies from the persisted ingestion schedule config');
      await this.repository.update({
        configKey: INGESTION_RUNTIME_CONFIG_KEY,
        configJson: currentConfig,
        updatedById: existing.updatedById,
      });
    }
    this.initialized = true;
  }

  private async persist(updatedById?: string): Promise<void> {
    if (!this.repository) {
      return;
    }

    await this.repository.update({
      configKey: INGESTION_RUNTIME_CONFIG_KEY,
      configJson: currentConfig,
      updatedById: updatedById ?? null,
    });
  }
}

/**
 * Drops `RETIRED_FEED_POLICY_KEYS` from a persisted config, top level and per-sport overrides.
 * A per-sport override left with no keys is dropped too: an empty override is not a valid one.
 * Anything that is not the expected object shape passes through untouched for the schema to
 * judge.
 */
function withoutRetiredFeedPolicies(configJson: unknown): { config: unknown; removed: boolean } {
  if (!isPlainObject(configJson)) {
    return { config: configJson, removed: false };
  }

  let removed = false;
  const stripRetired = (value: Record<string, unknown>): Record<string, unknown> => {
    const next = { ...value };
    for (const key of RETIRED_FEED_POLICY_KEYS) {
      if (key in next) {
        delete next[key];
        removed = true;
      }
    }
    return next;
  };

  const config = stripRetired(configJson);
  if (isPlainObject(config.perSportOverrides)) {
    const overrides: Record<string, unknown> = {};
    for (const [sport, override] of Object.entries(config.perSportOverrides)) {
      if (!isPlainObject(override)) {
        overrides[sport] = override;
        continue;
      }
      const next = stripRetired(override);
      if (Object.keys(next).length > 0) {
        overrides[sport] = next;
      }
    }
    config.perSportOverrides = overrides;
  }

  return { config, removed };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepCopy(config: IngestionScheduleConfig): IngestionScheduleConfig {
  return {
    healthCheck: { ...config.healthCheck },
    scheduledSports: [...config.scheduledSports],
    eventSchedule: { ...config.eventSchedule },
    eventParticipants: { ...config.eventParticipants },
    eventLiveScores: { ...config.eventLiveScores },
    eventResults: { ...config.eventResults },
    perSportOverrides: Object.fromEntries(
      Object.entries(config.perSportOverrides ?? {}).map(([sport, override]) => [
        sport,
        mergeOverride({}, override),
      ]),
    ),
  };
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
    eventSchedule: mergePolicy(config.eventSchedule, override.eventSchedule),
    eventParticipants: mergePolicy(config.eventParticipants, override.eventParticipants),
    eventLiveScores: mergePolicy(config.eventLiveScores, override.eventLiveScores),
    eventResults: mergePolicy(config.eventResults, override.eventResults),
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
    'eventSchedule',
    'eventParticipants',
    'eventLiveScores',
    'eventResults',
  ];
}
