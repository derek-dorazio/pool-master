/**
 * IngestionConfigService — admin-configurable ingestion schedule management.
 *
 * Provides runtime configuration for the ingestion scheduler intervals
 * with optional per-sport overrides. Replaces hardcoded intervals in
 * the IngestionScheduler.
 */

import { logAdminAction } from './admin-audit-service';
import type { FastifyBaseLogger } from 'fastify';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IngestionScheduleConfig {
  healthCheckIntervalMinutes: number;       // default 5
  scheduleSyncIntervalHours: number;        // default 6
  participantSyncIntervalHours: number;     // default 12
  rankingSyncIntervalHours: number;         // default 24
  liveScorePollingIntervalSeconds: number;  // default 30
  perSportOverrides?: Record<string, Partial<IngestionScheduleConfig>>;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_INGESTION_CONFIG: IngestionScheduleConfig = {
  healthCheckIntervalMinutes: 5,
  scheduleSyncIntervalHours: 6,
  participantSyncIntervalHours: 12,
  rankingSyncIntervalHours: 24,
  liveScorePollingIntervalSeconds: 30,
  perSportOverrides: {},
};

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

let currentConfig: IngestionScheduleConfig = {
  ...DEFAULT_INGESTION_CONFIG,
  perSportOverrides: { ...DEFAULT_INGESTION_CONFIG.perSportOverrides },
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IngestionConfigService {
  constructor(private readonly logger?: FastifyBaseLogger) {}
  /**
   * Returns the current ingestion schedule configuration.
   */
  async getConfig(): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.get.start',
    }, 'Loading ingestion config');
    this.logger?.info({
      action: 'adminIngestionConfig.get.success',
    }, 'Loaded ingestion config');
    return deepCopy(currentConfig);
  }

  /**
   * Merges partial updates into the current configuration.
   * Does not affect perSportOverrides — use setPerSportOverride for that.
   */
  async updateConfig(
    partial: Partial<Omit<IngestionScheduleConfig, 'perSportOverrides'>>,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.update.start',
      data: {
        keys: Object.keys(partial),
      },
    }, 'Updating ingestion config');
    const before = deepCopy(currentConfig);
    const { ...updates } = partial;
    currentConfig = { ...currentConfig, ...updates };

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

  /**
   * Returns the effective config for a specific sport, merging global
   * config with any sport-specific overrides.
   */
  async getPerSportConfig(sport: string): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.getPerSport.start',
      data: { sport },
    }, 'Loading per-sport ingestion config');
    const override = currentConfig.perSportOverrides?.[sport];
    if (!override) {
      this.logger?.info({
        action: 'adminIngestionConfig.getPerSport.globalFallback',
        data: { sport },
      }, 'No per-sport override found; returning global ingestion config');
      return deepCopy(currentConfig);
    }
    const config = {
      ...deepCopy(currentConfig),
      ...override,
    };
    this.logger?.info({
      action: 'adminIngestionConfig.getPerSport.success',
      data: { sport },
    }, 'Loaded per-sport ingestion config');
    return config;
  }

  /**
   * Sets a sport-specific override. Only the specified fields are overridden;
   * unset fields fall through to the global config.
   */
  async setPerSportOverride(
    sport: string,
    config: Partial<Omit<IngestionScheduleConfig, 'perSportOverrides'>>,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.setOverride.start',
      data: {
        sport,
        keys: Object.keys(config),
      },
    }, 'Setting per-sport ingestion override');
    const before = deepCopy(currentConfig);
    if (!currentConfig.perSportOverrides) {
      currentConfig.perSportOverrides = {};
    }
    currentConfig.perSportOverrides[sport] = {
      ...currentConfig.perSportOverrides[sport],
      ...config,
    };

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

  /**
   * Resets all schedules (including per-sport overrides) to defaults.
   */
  async resetDefaults(
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<IngestionScheduleConfig> {
    this.logger?.debug({
      action: 'adminIngestionConfig.reset.start',
    }, 'Resetting ingestion config');
    const before = deepCopy(currentConfig);
    currentConfig = {
      ...DEFAULT_INGESTION_CONFIG,
      perSportOverrides: { ...DEFAULT_INGESTION_CONFIG.perSportOverrides },
    };

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
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function deepCopy(config: IngestionScheduleConfig): IngestionScheduleConfig {
  return {
    ...config,
    perSportOverrides: config.perSportOverrides
      ? Object.fromEntries(
        Object.entries(config.perSportOverrides).map(([k, v]) => [k, { ...v }]),
      )
      : {},
  };
}
