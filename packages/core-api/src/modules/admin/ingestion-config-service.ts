/**
 * IngestionConfigService — admin-configurable lifecycle-aware ingestion policy
 * management used by the scheduler and root-admin configuration routes.
 */

import type { FastifyBaseLogger } from 'fastify';
import type {
  IngestionFeedSchedulePolicy,
  IngestionScheduleConfig,
  IngestionScheduleConfigBody,
  IngestionScheduleConfigOverride,
} from '@poolmaster/shared/dto/config.dto';
import { IngestionScheduleConfigSchema } from '@poolmaster/shared/dto/config.dto';
import { logAdminAction } from './admin-audit-service';
import type { PrismaPlatformRuntimeConfigRepository } from './platform-runtime-config-repository';

type FeedPolicyKey = keyof IngestionScheduleConfigBody;

const DEFAULT_INGESTION_CONFIG: IngestionScheduleConfig = {
  healthCheck: {
    enabled: true,
    intervalMinutes: 5,
  },
  eventSchedule: {
    enabled: true,
    intervalMinutes: 360,
    lookaheadDays: 30,
  },
  eventParticipants: {
    enabled: true,
    intervalMinutes: 720,
    leadDaysBeforeStart: 7,
  },
  participantRankings: {
    enabled: true,
    intervalMinutes: 1440,
  },
  eventLiveScores: {
    enabled: true,
    intervalSeconds: 30,
  },
  eventResults: {
    enabled: true,
    intervalMinutes: 30,
  },
  perSportOverrides: {},
};

let currentConfig: IngestionScheduleConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
const INGESTION_RUNTIME_CONFIG_KEY = 'INGESTION_SCHEDULE_CONFIG';

export class IngestionConfigService {
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
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating ingestion config');

    const before = deepCopy(currentConfig);
    currentConfig = {
      ...mergeBasePolicies(currentConfig, partial),
      perSportOverrides: deepCopy(currentConfig).perSportOverrides,
    };
    await this.persist(rootAdminUserId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'UPDATE_INGESTION_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'ingestion-schedule',
      description: 'Updated ingestion schedule configuration',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

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
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.setOverride.start',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Setting per-sport ingestion override');

    const before = deepCopy(currentConfig);
    const existingOverride = currentConfig.perSportOverrides[sport] ?? {};
    currentConfig = {
      ...currentConfig,
      perSportOverrides: {
        ...currentConfig.perSportOverrides,
        [sport]: mergeOverride(existingOverride, config),
      },
    };
    await this.persist(rootAdminUserId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'SET_INGESTION_SPORT_OVERRIDE',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: `ingestion-schedule:${sport}`,
      description: `Set ingestion schedule override for sport: ${sport}`,
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

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
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.clearOverride.start',
      data: { sport },
    }, 'Clearing per-sport ingestion override');

    const before = deepCopy(currentConfig);
    const remainingOverrides = { ...currentConfig.perSportOverrides };
    delete remainingOverrides[sport];
    currentConfig = {
      ...currentConfig,
      perSportOverrides: remainingOverrides,
    };
    await this.persist(rootAdminUserId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'CLEAR_INGESTION_SPORT_OVERRIDE',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: `ingestion-schedule:${sport}`,
      description: `Cleared ingestion schedule override for sport: ${sport}`,
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

    this.logger?.info({
      action: 'adminIngestionConfig.clearOverride.success',
      data: { sport },
    }, 'Cleared per-sport ingestion override');
    return deepCopy(currentConfig);
  }

  async resetDefaults(
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    await this.ensureLoaded();
    this.logger?.debug({
      action: 'adminIngestionConfig.reset.start',
    }, 'Resetting ingestion config');

    const before = deepCopy(currentConfig);
    currentConfig = deepCopy(DEFAULT_INGESTION_CONFIG);
    await this.persist(rootAdminUserId);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'RESET_INGESTION_CONFIG',
      resourceType: 'PLATFORM_CONFIG',
      resourceId: 'ingestion-schedule',
      description: 'Reset ingestion schedule configuration to defaults',
      beforeState: before as unknown as Record<string, unknown>,
      afterState: currentConfig as unknown as Record<string, unknown>,
    });

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

    const parsed = IngestionScheduleConfigSchema.safeParse(existing.configJson);
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

function deepCopy(config: IngestionScheduleConfig): IngestionScheduleConfig {
  return {
    healthCheck: { ...config.healthCheck },
    eventSchedule: { ...config.eventSchedule },
    eventParticipants: { ...config.eventParticipants },
    participantRankings: { ...config.participantRankings },
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
    healthCheck: mergePolicy(config.healthCheck, override.healthCheck),
    eventSchedule: mergePolicy(config.eventSchedule, override.eventSchedule),
    eventParticipants: mergePolicy(config.eventParticipants, override.eventParticipants),
    participantRankings: mergePolicy(config.participantRankings, override.participantRankings),
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
    'participantRankings',
    'eventLiveScores',
    'eventResults',
  ];
}
