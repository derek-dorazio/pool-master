import { useQuery } from '@tanstack/react-query';
import { getProviderSyncRun } from '@/lib/api';
import { ErrorState, LoadingState, ReadOnlyDetailModal } from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import type { ProviderSyncRunDetail } from './root-admin-sync-utils';
import { SyncRunDialog } from './sync-run-dialog';

/**
 * A sync run opened by its id, from a page that names a run without holding it (the Sports page's
 * Sync issues): the run's own dialog once it has loaded, and a short dialog saying so until then.
 */
export function SyncRunByIdDialog({ onClose, syncRunId }: { onClose: () => void; syncRunId: string }) {
  const runQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providerSyncRun(syncRunId),
    queryFn: async (): Promise<ProviderSyncRunDetail> => {
      const response = await getProviderSyncRun({ path: { syncRunId } });
      if (!response.data) {
        throwApiError(response.error, 'Provider sync run response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });

  if (runQuery.data) {
    return <SyncRunDialog onClose={onClose} run={runQuery.data} />;
  }
  return (
    <ReadOnlyDetailModal
      detailContent={runQuery.isError ? (
        <ErrorState
          body={extractErrorMessage(runQuery.error, { fallback: 'We could not load this sync run right now.' })}
          onRetry={() => void runQuery.refetch()}
          size="plain"
        />
      ) : <LoadingState body="Loading sync run..." size="plain" />}
      onCancel={onClose}
      onOpenChange={(open) => (open ? undefined : onClose())}
      open
      size="sm"
      testId="root-admin-sync-run-by-id"
      title="Sync run"
    />
  );
}
