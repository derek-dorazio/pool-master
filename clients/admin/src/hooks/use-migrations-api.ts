import { useQuery } from '@tanstack/react-query';

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

const MOCK_DATA: MigrationsData = {
  available: [
    { id: 'mig-001', name: 'backfill-analytics', description: 'Backfill analytics for existing contests', lastRunAt: '2026-03-26T10:00:00Z', lastStatus: 'Running' },
    { id: 'mig-002', name: 'recompute-records', description: 'Re-compute league records and history', lastRunAt: '2026-03-25T08:00:00Z', lastStatus: 'Completed' },
    { id: 'mig-003', name: 'recalculate-pricing', description: 'Re-calculate budget pricing from rankings', lastRunAt: '2026-03-20T14:00:00Z', lastStatus: 'Failed' },
    { id: 'mig-004', name: 'reindex-search', description: 'Re-index search data', lastRunAt: null, lastStatus: 'Never Run' },
  ],
  activeRuns: [
    {
      id: 'run-001',
      migrationName: 'backfill-analytics',
      status: 'Running',
      progress: 65,
      totalRecords: 10000,
      processedRecords: 6500,
      succeededRecords: 6498,
      failedRecords: 2,
      startedBy: 'sarah.chen@poolmaster.io',
      startedAt: '2026-03-26T10:00:00Z',
      completedAt: null,
      duration: '4m 32s',
      estimatedRemaining: '2m 15s remaining',
      errors: [
        { recordId: 'cst_broken_001', error: 'Missing scoring template for legacy contest format', timestamp: '2026-03-26T10:02:15Z' },
        { recordId: 'cst_broken_002', error: 'Null reference: contest.league is undefined', timestamp: '2026-03-26T10:03:42Z' },
      ],
    },
  ],
  recentHistory: [
    {
      id: 'run-002',
      migrationName: 'recompute-records',
      status: 'Completed',
      progress: 100,
      totalRecords: 5200,
      processedRecords: 5200,
      succeededRecords: 5200,
      failedRecords: 0,
      startedBy: 'mike.johnson@poolmaster.io',
      startedAt: '2026-03-25T08:00:00Z',
      completedAt: '2026-03-25T08:12:30Z',
      duration: '12m 30s',
      errors: [],
    },
    {
      id: 'run-003',
      migrationName: 'recalculate-pricing',
      status: 'Failed',
      progress: 34,
      totalRecords: 8000,
      processedRecords: 2720,
      succeededRecords: 2680,
      failedRecords: 40,
      startedBy: 'sarah.chen@poolmaster.io',
      startedAt: '2026-03-20T14:00:00Z',
      completedAt: '2026-03-20T14:08:45Z',
      duration: '8m 45s',
      errors: [
        { recordId: 'prc_batch_17', error: 'Division by zero in pricing formula', timestamp: '2026-03-20T14:08:00Z' },
      ],
    },
    {
      id: 'run-004',
      migrationName: 'recompute-records',
      status: 'Completed',
      progress: 100,
      totalRecords: 3100,
      processedRecords: 3100,
      succeededRecords: 3100,
      failedRecords: 0,
      startedBy: 'admin@poolmaster.io',
      startedAt: '2026-03-18T09:00:00Z',
      completedAt: '2026-03-18T09:06:15Z',
      duration: '6m 15s',
      errors: [],
    },
  ],
};

export function useMigrations() {
  return useQuery({
    queryKey: ['migrations'],
    queryFn: async (): Promise<MigrationsData> => {
      await new Promise((r) => setTimeout(r, 200));
      return MOCK_DATA;
    },
  });
}

export function useMigrationDetail(id: string) {
  return useQuery({
    queryKey: ['migration-detail', id],
    queryFn: async (): Promise<MigrationRun> => {
      await new Promise((r) => setTimeout(r, 200));
      const all = [...MOCK_DATA.activeRuns, ...MOCK_DATA.recentHistory];
      return all.find((r) => r.id === id) ?? MOCK_DATA.activeRuns[0];
    },
  });
}
