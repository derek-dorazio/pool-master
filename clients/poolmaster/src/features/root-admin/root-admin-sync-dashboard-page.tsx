import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listProviderSyncRuns } from '@/lib/api';
import {
  formatDateTimeDisplay,
  LinkButton,
  PageHeader,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { throwApiError } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';
import { plural } from '@/lib/plural';
import { ProviderSyncRunStatus } from '@poolmaster/shared/domain';
import type { ProviderSyncRun } from './root-admin-sync-utils';
import { SYNC_PATH, UNMAPPED_COMPETITORS_PATH } from './manage-navigation';
import { SyncRunDialog } from './sync-run-dialog';
import { SyncRunHistory } from './sync-run-history';
import { SyncStatusSection } from './sync-status-section';
import { useProvidersQuery } from './use-providers-query';

/**
 * /manage/sync: the run counts in the header with its two actions, the sync order and provider
 * health, and the recent runs; a run opens its detail dialog. Each section is its own file.
 */
export function RootAdminSyncDashboardPage() {
  const displayPreferences = useDisplayPreferences();
  const [openRun, setOpenRun] = useState<ProviderSyncRun | null>(null);
  const providersQuery = useProvidersQuery();

  const syncRunsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providerSyncRuns,
    queryFn: async (): Promise<ProviderSyncRun[]> => {
      // #205 — no row limit: the server's default window (the past six hours) bounds the list.
      const response = await listProviderSyncRuns();

      if (!response.data?.syncRuns) {
        throwApiError(response.error, 'Provider sync run response is missing data.');
      }

      return response.data.syncRuns;
    },
    retry: false,
  });

  const recentRuns = useMemo(() => syncRunsQuery.data ?? [], [syncRunsQuery.data]);
  const summary = useMemo(() => {
    // poolmaster-allow-list-lookup: the runs listed on this screen, capped by the server's six-hour window
    const runsWith = (status: ProviderSyncRunStatus) => recentRuns.filter((run) => run.status === status).length;
    return {
      submitted: runsWith(ProviderSyncRunStatus.SUBMITTED),
      running: runsWith(ProviderSyncRunStatus.IN_PROGRESS),
      failed: runsWith(ProviderSyncRunStatus.FAILED),
      completed: runsWith(ProviderSyncRunStatus.COMPLETED),
      lastStartedAt: recentRuns.at(0)?.startedAt ?? recentRuns.at(0)?.createdAt ?? null,
    };
  }, [recentRuns]);

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sync-dashboard-page"
    >
      <PageHeader
        actions={(
          <>
            <LinkButton
              data-testid="root-admin-open-unmapped-participants-page"
              to={UNMAPPED_COMPETITORS_PATH}
              variant="subtle"
            >
              Unmapped competitors
            </LinkButton>
            <LinkButton
              data-testid="root-admin-open-run-event-sync-page"
              to={`${SYNC_PATH}/run-event-sync`}
              variant="primary"
            >
              Run event sync
            </LinkButton>
          </>
        )}
        meta={summary.lastStartedAt ? (
          <span data-testid="root-admin-sync-latest-start">
            Latest start {formatDateTimeDisplay(summary.lastStartedAt, displayPreferences)}
          </span>
        ) : undefined}
        status={syncRunsQuery.data ? (
          <span data-testid="root-admin-sync-counts">
            {plural(recentRuns.length, 'recent run')} · {summary.completed} completed · {summary.running} in progress · {summary.submitted} submitted
            {summary.failed > 0 ? ` · ${summary.failed} failed` : null}
          </span>
        ) : undefined}
        testId="root-admin-sync-header"
        title="Sync"
      />
      <SyncStatusSection providers={providersQuery.data} providersFailed={providersQuery.isError} />
      <SyncRunHistory onOpenRun={setOpenRun} providers={providersQuery.data} runsQuery={syncRunsQuery} />
      {openRun ? (
        <SyncRunDialog onClose={() => setOpenRun(null)} providers={providersQuery.data} run={openRun} />
      ) : null}
    </section>
  );
}
