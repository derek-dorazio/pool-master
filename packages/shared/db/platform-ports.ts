/**
 * Ports for the platform and ingestion cluster (#205): the sync-run history and the
 * runtime-tunable platform settings.
 */

import type {
  BackgroundJobRequest,
  PlatformRuntimeConfig,
  PlatformRuntimeConfigChange,
  ProviderCode,
  ProviderSyncRun,
  ProviderSyncRunCounts,
  ProviderSyncRunOutcome,
  ProviderSyncRunStatus,
  ProviderSyncRunWithDetails,
  Sport,
} from '../domain';

/**
 * A run to write. Its provider is named by its Provider code, which the write keys to the Provider
 * row (#2040); its event is `sportEventId`, whose provider id the run reads back as `eventId`.
 */
export type ProviderSyncRunCreate = Omit<ProviderSyncRun, 'id' | 'createdAt' | 'providerId' | 'providerName' | 'eventId' | 'sport'> & {
  providerCode: ProviderCode;
  createdAt?: Date;
};

export interface ProviderSyncRunUpdate extends ProviderSyncRunOutcome {
  status: ProviderSyncRunStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  /** The run's detailed diagnostics; omitted, the stored ones are kept. */
  details?: Record<string, unknown>;
  /** The background job running it (#1819), when a job picks up a run submitted before it; omitted, kept. */
  backgroundJobId?: string;
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
  /**
   * Writes the runs, in order, and the background job `job` builds from them, in one transaction
   * (#1441): a sync request's runs never exist without the job that runs them, nor the job
   * without its runs.
   */
  createWithJob(
    inputs: readonly ProviderSyncRunCreate[],
    job: (runs: ProviderSyncRun[]) => BackgroundJobRequest,
  ): Promise<ProviderSyncRun[]>;
  update(id: string, update: ProviderSyncRunUpdate): Promise<void>;
  /** Newest submission first, without the detailed diagnostics. */
  findAll(filters: ProviderSyncRunFilters): Promise<ProviderSyncRun[]>;
  /** One run with its detailed diagnostics, or null when there is no such run. */
  findById(id: string): Promise<ProviderSyncRunWithDetails | null>;
  /** The runs with these ids that exist, in one read, without the detailed diagnostics. */
  findManyByIds(ids: readonly string[]): Promise<ProviderSyncRun[]>;
  /** The runs these background jobs ran, in one read, without the detailed diagnostics (#1819). */
  findByBackgroundJobIds(backgroundJobIds: readonly string[]): Promise<ProviderSyncRun[]>;
  /**
   * Clears the detailed diagnostics of up to `limit` runs submitted before `before` that still
   * have them; returns how many. Open-ended, so a missed night or a backfilled run is still
   * cleared on the next pass.
   */
  clearDetailsBatchSubmittedBefore(before: Date, limit: number): Promise<number>;
  /** Deletes up to `limit` runs submitted before `before`; returns how many. One batch per call. */
  deleteBatchSubmittedBefore(before: Date, limit: number): Promise<number>;
  /**
   * Each Provider's runs submitted since `since` that have finished, and how many of them failed
   * (#1999), in one read. A Provider with no finished run there is left out.
   */
  countFinishedByProvider(since: Date): Promise<ProviderSyncRunCounts[]>;
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
  /** A setting's most recent changes, newest first. The limit is the bound: the history is append-only. */
  findRecentChanges(configKey: string, limit: number): Promise<PlatformRuntimeConfigChange[]>;
}
