/**
 * Ports for the platform and ingestion cluster (#205): the sync-run history and the
 * runtime-tunable platform settings.
 */

import type {
  PlatformRuntimeConfig,
  ProviderSyncRun,
  ProviderSyncRunStatus,
  Sport,
} from '../domain';

export type ProviderSyncRunCreate = Omit<ProviderSyncRun, 'id' | 'createdAt'> & { createdAt?: Date };

export interface ProviderSyncRunUpdate {
  status: ProviderSyncRunStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  payload: Record<string, unknown>;
}

/**
 * Filters narrow the list; nothing pages it (§16). The `createdAt` window is required
 * because the history is append-only and unbounded — the window is the bound.
 */
export interface ProviderSyncRunFilters {
  providerId?: string;
  sport?: Sport;
  status?: ProviderSyncRunStatus;
  createdFrom: Date;
  createdTo: Date;
}

export interface ProviderSyncRunRepository {
  create(input: ProviderSyncRunCreate): Promise<ProviderSyncRun>;
  update(id: string, update: ProviderSyncRunUpdate): Promise<void>;
  /** Runs not yet started first (a null start sorts first), then newest start, then newest submission. */
  findAll(filters: ProviderSyncRunFilters): Promise<ProviderSyncRun[]>;
}

export interface PlatformRuntimeConfigRepository {
  findByKey(configKey: string): Promise<PlatformRuntimeConfig | null>;
  create(input: { configKey: string; configJson: unknown; updatedById?: string | null }): Promise<PlatformRuntimeConfig>;
  /** Writes the document for `configKey`, creating it on first write. */
  update(input: { configKey: string; configJson: unknown; updatedById?: string | null }): Promise<PlatformRuntimeConfig>;
}
