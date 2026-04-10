/**
 * MigrationService — persisted migration run tracking for admin tooling.
 *
 * Provides a catalogue of available data migrations and stores run state in
 * Prisma so the API reflects the real execution lifecycle instead of
 * simulating instant completion in memory.
 */

import type { PrismaClient } from '@prisma/client';
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

export type MigrationRunStatus = 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

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
  migrationName: string;
  status: MigrationRunStatus;
  progress: MigrationRunProgress;
  dryRun: boolean;
  startedAt: Date;
  completedAt?: Date;
  startedBy: string;
  startedByUser: {
    email: string;
    name: string;
  };
  errors: { recordId: string; error: string }[];
}

export interface StartMigrationInput {
  migrationId: string;
  dryRun?: boolean;
  batchSize?: number;
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

export class RootAdminUserNotFoundError extends Error {
  constructor(rootAdminUserId: string) {
    super(`Root admin user not found: ${rootAdminUserId}`);
    this.name = 'RootAdminUserNotFoundError';
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
// Service
// ---------------------------------------------------------------------------

export class MigrationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Lists all available migrations with their last-run info.
   */
  async listMigrations(): Promise<{
    available: Migration[];
    activeRuns: MigrationRun[];
    recentHistory: MigrationRun[];
  }> {
    const rows = await this.prisma.migrationRun.findMany({
      orderBy: { startedAt: 'desc' },
      include: { startedBy: true },
    });

    const runs = rows.map((row) => this.mapRowToRun(row));
    const available = AVAILABLE_MIGRATIONS.map((migration) => {
      const lastRun = runs.find((run) => run.migrationId === migration.id);
      return {
        ...migration,
        lastRunAt: lastRun?.completedAt ?? lastRun?.startedAt,
        lastRunStatus: lastRun?.status,
      };
    });

    return {
      available,
      activeRuns: runs.filter((run) => run.status === 'QUEUED' || run.status === 'RUNNING'),
      recentHistory: runs
        .filter((run) => run.status !== 'QUEUED' && run.status !== 'RUNNING')
        .slice(0, 20),
    };
  }

  /**
   * Starts a new migration run by creating a persisted queued run record.
   */
  async startRun(
    input: StartMigrationInput,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<MigrationRun> {
    const migration = AVAILABLE_MIGRATIONS.find((m) => m.id === input.migrationId);
    if (!migration) throw new MigrationNotFoundError(input.migrationId);

    const rootAdminUser = await this.prisma.user.findUnique({
      where: { id: rootAdminUserId },
      select: {
        id: true,
        email: true,
        displayName: true,
        isRootAdmin: true,
      },
    });
    if (!rootAdminUser || !rootAdminUser.isRootAdmin) {
      throw new RootAdminUserNotFoundError(rootAdminUserId);
    }

    const existingRun = await this.prisma.migrationRun.findFirst({
      where: {
        migrationId: input.migrationId,
        status: { in: ['QUEUED', 'RUNNING'] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (existingRun) {
      throw new MigrationAlreadyRunningError(input.migrationId);
    }

    const row = await this.prisma.migrationRun.create({
      data: {
        migrationId: input.migrationId,
        status: 'QUEUED',
        options: {
          dryRun: input.dryRun ?? false,
          batchSize: input.batchSize ?? null,
        },
        progress: {
          totalRecords: migration.estimatedRecords,
          processed: 0,
          succeeded: 0,
          failed: 0,
          percentage: 0,
        },
        errors: [],
        startedById: rootAdminUser.id,
      },
      include: { startedBy: true },
    });

    const run = this.mapRowToRun(row);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'migration.run',
      resourceType: 'MIGRATION',
      resourceId: input.migrationId,
      description: `Queued migration "${migration.name}" (run ${run.runId}, dryRun=${run.dryRun})`,
      afterState: { runId: run.runId, status: run.status, processed: run.progress.processed },
    });

    return run;
  }

  /**
   * Returns details for a specific migration run.
   */
  async getRunDetail(runId: string): Promise<MigrationRun> {
    const row = await this.prisma.migrationRun.findUnique({
      where: { id: runId },
      include: { startedBy: true },
    });
    if (!row) throw new MigrationRunNotFoundError(runId);
    return this.mapRowToRun(row);
  }

  /**
   * Cancels a running migration. Only RUNNING migrations can be cancelled.
   */
  async cancelRun(
    runId: string,
    rootAdminUserId: string,
    rootAdminEmail: string,
  ): Promise<MigrationRun> {
    const row = await this.prisma.migrationRun.findUnique({
      where: { id: runId },
      include: { startedBy: true },
    });
    if (!row) throw new MigrationRunNotFoundError(runId);

    const run = this.mapRowToRun(row);
    if (run.status !== 'QUEUED' && run.status !== 'RUNNING') {
      return run;
    }

    const updated = await this.prisma.migrationRun.update({
      where: { id: runId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
      include: { startedBy: true },
    });
    const cancelledRun = this.mapRowToRun(updated);

    await logAdminAction({
      actorUserId: rootAdminUserId,
      actorEmail: rootAdminEmail,
      action: 'migration.cancel',
      resourceType: 'MIGRATION_RUN',
      resourceId: runId,
      description: `Cancelled migration run ${runId}`,
      afterState: { runId, status: cancelledRun.status },
    });

    return cancelledRun;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private mapRowToRun(row: {
    id: string;
    migrationId: string;
    status: string;
    options: unknown;
    progress: unknown;
    errors: unknown;
    startedAt: Date;
    completedAt: Date | null;
    startedById: string;
    startedBy: { id: string; email: string; displayName: string };
  }): MigrationRun {
    const options = this.asRecord(row.options);
    const progressRecord = this.asRecord(row.progress);
    const errors = Array.isArray(row.errors)
      ? row.errors
          .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
          .map((entry) => ({
            recordId: typeof entry.recordId === 'string' ? entry.recordId : 'unknown',
            error: typeof entry.error === 'string' ? entry.error : 'Unknown error',
          }))
      : [];

    return {
      runId: row.id,
      migrationId: row.migrationId,
      migrationName: AVAILABLE_MIGRATIONS.find((migration) => migration.id === row.migrationId)?.name ?? row.migrationId,
      status: this.normalizeStatus(row.status),
      dryRun: Boolean(options.dryRun),
      progress: {
        totalRecords: this.asNumber(progressRecord.totalRecords),
        processed: this.asNumber(progressRecord.processed),
        succeeded: this.asNumber(progressRecord.succeeded),
        failed: this.asNumber(progressRecord.failed),
        percentage: this.asNumber(progressRecord.percentage),
      },
      startedAt: row.startedAt,
      completedAt: row.completedAt ?? undefined,
      startedBy: row.startedById,
      startedByUser: {
        email: row.startedBy.email,
        name: row.startedBy.displayName,
      },
      errors,
    };
  }

  private normalizeStatus(status: string): MigrationRunStatus {
    if (
      status === 'QUEUED' ||
      status === 'RUNNING' ||
      status === 'COMPLETED' ||
      status === 'FAILED' ||
      status === 'CANCELLED'
    ) {
      return status;
    }
    return 'FAILED';
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private asNumber(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
  }
}
