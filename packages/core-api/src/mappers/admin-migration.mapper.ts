import type {
  MigrationDefinitionDto,
  MigrationListResponse,
  MigrationRunDto,
  MigrationRunErrorDto,
  MigrationRunResponse,
} from '@poolmaster/shared/dto';
import type {
  Migration,
  MigrationRun,
} from '../modules/admin/migration-service';

function toIsoString(value: Date | undefined): string | null {
  return value ? value.toISOString() : null;
}

export function toMigrationDefinitionDto(migration: Migration): MigrationDefinitionDto {
  return {
    id: migration.id,
    name: migration.name,
    description: migration.description,
    estimatedRecords: migration.estimatedRecords,
    lastRunAt: toIsoString(migration.lastRunAt),
    lastRunStatus: migration.lastRunStatus ?? null,
  };
}

function toMigrationRunErrorDto(
  error: MigrationRun['errors'][number],
  timestamp: Date,
): MigrationRunErrorDto {
  return {
    recordId: error.recordId,
    error: error.error,
    timestamp: timestamp.toISOString(),
  };
}

export function toMigrationRunDto(run: MigrationRun): MigrationRunDto {
  return {
    id: run.runId,
    migrationId: run.migrationId,
    migrationName: run.migrationName,
    status: run.status,
    dryRun: run.dryRun,
    progress: {
      totalRecords: run.progress.totalRecords,
      processed: run.progress.processed,
      succeeded: run.progress.succeeded,
      failed: run.progress.failed,
      percentage: run.progress.percentage,
    },
    startedAt: run.startedAt.toISOString(),
    completedAt: toIsoString(run.completedAt),
    startedBy: {
      id: run.startedBy,
      email: run.startedByUser.email,
      name: run.startedByUser.name,
    },
    errors: run.errors.map((error) => toMigrationRunErrorDto(error, run.completedAt ?? run.startedAt)),
  };
}

export function toMigrationListResponse(data: {
  available: Migration[];
  activeRuns: MigrationRun[];
  recentHistory: MigrationRun[];
}): MigrationListResponse {
  return {
    available: data.available.map(toMigrationDefinitionDto),
    activeRuns: data.activeRuns.map((run) => toMigrationRunDto(run)),
    recentHistory: data.recentHistory.map((run) => toMigrationRunDto(run)),
  };
}

export function toMigrationRunResponse(run: MigrationRun): MigrationRunResponse {
  return {
    run: toMigrationRunDto(run),
  };
}
