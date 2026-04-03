import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  MigrationListResponseSchema,
  MigrationRunResponseSchema,
  type MigrationListResponse,
  type MigrationRunResponse,
} from '@poolmaster/shared/dto';
import {
  client,
  adminCancelMigrationRun,
  adminGetMigrationRunDetail,
  adminListMigrations,
} from '@/lib/api';

type MigrationRun = MigrationRunResponse['run'];

export function useMigrations() {
  return useQuery({
    queryKey: ['migrations'],
    queryFn: async (): Promise<MigrationListResponse> => {
      const { data } = await adminListMigrations({ client });
      return MigrationListResponseSchema.parse(data);
    },
  });
}

export function useMigrationDetail(runId: string) {
  return useQuery({
    queryKey: ['migration-detail', runId],
    enabled: runId.length > 0,
    queryFn: async (): Promise<MigrationRun> => {
      const { data } = await adminGetMigrationRunDetail({ client, path: { runId } });
      return MigrationRunResponseSchema.parse(data).run;
    },
  });
}

export function useCancelMigrationRun() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (runId: string): Promise<MigrationRun> => {
      const { data } = await adminCancelMigrationRun({ client, path: { runId } });
      return MigrationRunResponseSchema.parse(data).run;
    },
    onSuccess: async (run) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['migrations'] }),
        queryClient.invalidateQueries({ queryKey: ['migration-detail', run.id] }),
      ]);
    },
  });
}
