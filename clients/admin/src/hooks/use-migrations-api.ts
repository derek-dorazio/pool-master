import { useQuery } from '@tanstack/react-query';
import { client, adminListMigrations, adminGetMigrationRunDetail } from '@/lib/api';

export interface Migration {
  id: string;
  name: string;
  description: string;
  lastRunAt: string | null;
  lastStatus: 'Completed' | 'Failed' | 'Running' | 'Never Run';
}

export interface MigrationRun {
  id: string;
  migrationName: string;
  status: 'Running' | 'Completed' | 'Failed';
  progress: number;
  totalRecords: number;
  processedRecords: number;
  succeededRecords: number;
  failedRecords: number;
  startedBy: string;
  startedAt: string;
  completedAt: string | null;
  duration: string;
  estimatedRemaining?: string;
  errors: MigrationError[];
}

export interface MigrationError {
  recordId: string;
  error: string;
  timestamp: string;
}

export interface MigrationsData {
  available: Migration[];
  activeRuns: MigrationRun[];
  recentHistory: MigrationRun[];
}

export function useMigrations() {
  return useQuery({
    queryKey: ['migrations'],
    queryFn: async () => {
      const { data } = await adminListMigrations({ client });
      return data;
    },
  });
}

export function useMigrationDetail(id: string) {
  return useQuery({
    queryKey: ['migration-detail', id],
    queryFn: async () => {
      const { data } = await adminGetMigrationRunDetail({ client, path: { runId: id } });
      return data;
    },
  });
}
