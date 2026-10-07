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

/**
 * A save of one settings group. `expectedUpdatedAt` is the stored row's `updatedAt` the caller
 * last saw, or `null` when it saw no stored row; when it no longer matches, nothing is written.
 * Omitted, the save does not check.
 */
export interface PlatformRuntimeConfigSave {
  configKey: string;
  configJson: unknown;
  changedById: string | null;
  expectedUpdatedAt?: Date | null;
}

export type PlatformRuntimeConfigSaveResult =
  | { status: 'saved'; config: PlatformRuntimeConfig }
  | { status: 'conflict'; current: PlatformRuntimeConfig | null };

export interface PlatformRuntimeConfigRepository {
  /** Every stored settings document, in one query. */
  findAll(): Promise<PlatformRuntimeConfig[]>;
  /**
   * Writes the document for `configKey`, creating it on first save, and records one change in
   * the history, in one transaction.
   */
  save(input: PlatformRuntimeConfigSave): Promise<PlatformRuntimeConfigSaveResult>;
}
