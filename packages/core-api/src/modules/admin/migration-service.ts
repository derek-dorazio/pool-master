/**
 * MigrationService — in-memory migration runner for admin tooling.
 *
 * Provides a catalogue of available data migrations and tracks run progress.
 * Each migration can be started, monitored, and cancelled. Runs are tracked
 * with progress counters (total, processed, succeeded, failed).
 */

import { logAdminAction } from './admin-audit-service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Migration {
  id: string;
  name: string;
  description: string;
  estimatedRecords: number;
  lastRunAt?: Date;
  lastRunStatus?: MigrationRunStatus;
}

export type MigrationRunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

export interface MigrationRunProgress {
  totalRecords: number;
  processed: number;
  succeeded: number;
  failed: number;
  percentage: number;
}

export interface MigrationRun {
  runId: string;
  migrationId: string;
  status: MigrationRunStatus;
  progress: MigrationRunProgress;
  dryRun: boolean;
  startedAt: Date;
  completedAt?: Date;
  startedBy: string;
  errors: { recordId: string; error: string }[];
}

export interface StartMigrationInput {
  migrationId: string;
  dryRun?: boolean;
  batchSize?: number;
  tenantIds?: string[];
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class MigrationNotFoundError extends Error {
  constructor(id: string) {
    super(`Migration not found: ${id}`);
    this.name = 'MigrationNotFoundError';
  }
}

export class MigrationRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Migration run not found: ${runId}`);
    this.name = 'MigrationRunNotFoundError';
  }
}

export class MigrationAlreadyRunningError extends Error {
  constructor(migrationId: string) {
    super(`Migration already running: ${migrationId}`);
    this.name = 'MigrationAlreadyRunningError';
  }
}

// ---------------------------------------------------------------------------
// Available migrations catalogue
// ---------------------------------------------------------------------------

const AVAILABLE_MIGRATIONS: Migration[] = [
  {
    id: 'backfill-analytics',
    name: 'Backfill Analytics Data',
    description: 'Backfill analytics aggregates for contests created before the analytics engine was deployed.',
    estimatedRecords: 12_500,
  },
  {
    id: 'recompute-records',
    name: 'Recompute History Records',
    description: 'Re-compute league and player history records from raw scoring data.',
    estimatedRecords: 45_000,
  },
  {
    id: 'recalculate-pricing',
    name: 'Recalculate Budget Pricing',
    description: 'Re-calculate all budget pick pricing based on current rankings and projections.',
    estimatedRecords: 8_200,
  },
  {
    id: 'reindex-search',
    name: 'Reindex Search Data',
    description: 'Rebuild the full-text search index for users, leagues, and contests.',
    estimatedRecords: 32_000,
  },
];

// ---------------------------------------------------------------------------
// In-memory store
// ---------------------------------------------------------------------------

const runs = new Map<string, MigrationRun>();

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MigrationService {
  /**
   * Lists all available migrations with their last-run info.
   */
  async listMigrations(): Promise<Migration[]> {
    // Attach last-run data from in-memory store
    return AVAILABLE_MIGRATIONS.map((m) => {
      const lastRun = this.findLastRun(m.id);
      return {
        ...m,
        lastRunAt: lastRun?.completedAt ?? lastRun?.startedAt,
        lastRunStatus: lastRun?.status,
      };
    });
  }

  /**
   * Starts a new migration run. Mock execution completes instantly with
   * simulated progress for demonstration purposes.
   */
  async startRun(
    input: StartMigrationInput,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<MigrationRun> {
    const migration = AVAILABLE_MIGRATIONS.find((m) => m.id === input.migrationId);
    if (!migration) throw new MigrationNotFoundError(input.migrationId);

    // Prevent duplicate running migrations
    for (const run of runs.values()) {
      if (run.migrationId === input.migrationId && run.status === 'RUNNING') {
        throw new MigrationAlreadyRunningError(input.migrationId);
      }
    }

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const total = migration.estimatedRecords;
    const failCount = Math.floor(total * 0.002); // simulate 0.2% failure rate

    const run: MigrationRun = {
      runId,
      migrationId: input.migrationId,
      status: 'COMPLETED',
      dryRun: input.dryRun ?? false,
      progress: {
        totalRecords: total,
        processed: total,
        succeeded: total - failCount,
        failed: failCount,
        percentage: 100,
      },
      startedAt: new Date(),
      completedAt: new Date(),
      startedBy: adminUserId,
      errors: failCount > 0
        ? [{ recordId: `rec-${Math.random().toString(36).slice(2, 8)}`, error: 'Simulated transient failure' }]
        : [],
    };

    runs.set(runId, run);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'migration.run',
      resourceType: 'MIGRATION',
      resourceId: input.migrationId,
      description: `Started migration "${migration.name}" (run ${runId}, dryRun=${run.dryRun})`,
      afterState: { runId, status: run.status, processed: run.progress.processed },
    });

    return run;
  }

  /**
   * Returns details for a specific migration run.
   */
  async getRunDetail(runId: string): Promise<MigrationRun> {
    const run = runs.get(runId);
    if (!run) throw new MigrationRunNotFoundError(runId);
    return run;
  }

  /**
   * Cancels a running migration. Only RUNNING migrations can be cancelled.
   */
  async cancelRun(
    runId: string,
    adminUserId: string,
    adminUserEmail: string,
  ): Promise<MigrationRun> {
    const run = runs.get(runId);
    if (!run) throw new MigrationRunNotFoundError(runId);

    if (run.status !== 'RUNNING') {
      // Already completed/cancelled — return as-is
      return run;
    }

    run.status = 'CANCELLED';
    run.completedAt = new Date();
    runs.set(runId, run);

    await logAdminAction({
      adminUserId,
      adminUserEmail,
      action: 'migration.cancel',
      resourceType: 'MIGRATION',
      resourceId: run.migrationId,
      description: `Cancelled migration run ${runId}`,
      afterState: { runId, status: run.status },
    });

    return run;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private findLastRun(migrationId: string): MigrationRun | undefined {
    let latest: MigrationRun | undefined;
    for (const run of runs.values()) {
      if (run.migrationId !== migrationId) continue;
      if (!latest || run.startedAt > latest.startedAt) {
        latest = run;
      }
    }
    return latest;
  }
}
