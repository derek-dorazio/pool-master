import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ProviderSummaryDto } from '@/lib/api';
import {
  Button,
  DataGrid,
  formatDateTimeDisplay,
  QueryState,
  SectionCard,
  StatusBadge,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import {
  buildCompactStatsSummary,
  buildPayloadSummary,
  formatRequestedFeed,
  getPayloadWarnings,
  getProviderName,
  type ProviderSyncRun,
} from './root-admin-sync-utils';
import { MANAGE_LIST_PAGE_SIZE } from './manage-navigation';
import { formatEventValue, getRunStatusLabel, getRunStatusTone, toSortableTimestamp } from './sync-run-status';

const syncRunColumnHelper = createColumnHelper<ProviderSyncRun>();

/** The Sync page's Recent runs: every run in the server's window, newest first, each one openable. */
export function SyncRunHistory({
  onOpenRun,
  providers,
  runsQuery,
}: {
  onOpenRun: (run: ProviderSyncRun) => void;
  providers: readonly ProviderSummaryDto[] | undefined;
  runsQuery: { data: ProviderSyncRun[] | undefined; error: Error | null; isError: boolean; refetch: () => unknown };
}) {
  const displayPreferences = useDisplayPreferences();

  const syncHistoryColumns = useMemo(
    () => [
      syncRunColumnHelper.accessor(
        (run) => formatDateTimeDisplay(run.startedAt ?? run.createdAt, displayPreferences),
        {
          id: 'started',
          header: 'Started',
          sortingFn: (left, right) =>
            toSortableTimestamp(left.original.startedAt ?? left.original.createdAt)
            - toSortableTimestamp(right.original.startedAt ?? right.original.createdAt),
          cell: ({ getValue }) => (
            <span className="text-foreground">{getValue()}</span>
          ),
        },
      ),
      syncRunColumnHelper.accessor(
        (run) => formatDateTimeDisplay(run.completedAt, displayPreferences),
        {
          id: 'completed',
          header: 'Completed',
          sortingFn: (left, right) =>
            toSortableTimestamp(left.original.completedAt)
            - toSortableTimestamp(right.original.completedAt),
          cell: ({ getValue }) => (
            <span className="text-muted-foreground">{getValue()}</span>
          ),
        },
      ),
      syncRunColumnHelper.accessor(
        (run) => `${getProviderName(run.providerId, providers)} ${run.providerId}`,
        {
          id: 'provider',
          header: 'Provider',
          cell: ({ row }) => (
            <div>
              <div className="font-medium text-foreground">
                {getProviderName(row.original.providerId, providers)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {row.original.providerId}
              </div>
            </div>
          ),
        },
      ),
      syncRunColumnHelper.accessor('sport', {
        header: 'Sport',
        cell: ({ getValue }) => (
          <span className="text-foreground">{getValue()}</span>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatRequestedFeed(run.payload), {
        id: 'feed',
        header: 'Feed',
        cell: ({ getValue }) => (
          <span className="text-foreground">{getValue()}</span>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatEventValue(run.eventId), {
        id: 'event',
        header: 'Event',
        cell: ({ getValue }) => (
          <span className="text-muted-foreground">{getValue()}</span>
        ),
      }),
      syncRunColumnHelper.accessor('status', {
        header: 'Status',
        cell: ({ row }) => (
          <StatusBadge tone={getRunStatusTone(row.original)}>
            {getRunStatusLabel(row.original)}
          </StatusBadge>
        ),
      }),
      syncRunColumnHelper.accessor((run) => buildPayloadSummary(run.payload), {
        id: 'summary',
        header: 'Summary',
        cell: ({ row }) => (
          <div className="text-muted-foreground">
            <div>{buildPayloadSummary(row.original.payload)}</div>
            <div className="mt-1 text-xs">
              {buildCompactStatsSummary(row.original.payload)}
            </div>
            {getPayloadWarnings(row.original.payload).length > 0 ? (
              <div className="mt-1 text-xs text-[color:var(--status-warning-text)]">
                {getPayloadWarnings(row.original.payload).length} warning
                {getPayloadWarnings(row.original.payload).length === 1 ? '' : 's'}
              </div>
            ) : null}
            <Button
              className="mt-2 h-auto rounded-none p-0 text-xs uppercase"
              onClick={() => onOpenRun(row.original)}
              type="button"
              variant="ghost"
            >
                View details
            </Button>
          </div>
        ),
      }),
    ],
    [displayPreferences, onOpenRun, providers],
  );

  return (
    <SectionCard bare title="Recent runs">
      <QueryState
        error={extractErrorMessage(runsQuery.error, { fallback: 'We could not load provider sync runs right now.' })}
        loading="Loading sync runs..."
        query={runsQuery}
        rows={3}
        testId="root-admin-sync-history"
      >
        {(runs) => (
          <DataGrid
            columns={syncHistoryColumns}
            data={runs}
            emptyMessage="No sync runs matched the current filters."
            getRowId={(run) => run.id}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            rowTestId={(run) => `root-admin-sync-run-${run.id}`}
            tableTestId="root-admin-sync-history-table"
          />
        )}
      </QueryState>
    </SectionCard>
  );
}
