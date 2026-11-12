import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import type { ProviderSummaryDto } from '@/lib/api';
import { Button, DataGrid, formatDateTimeDisplay, QueryState, SectionCard, StatusBadge, Text, useDisplayPreferences } from '@/features/shared/ui';
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
            <Text>{getValue()}</Text>
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
            <Text tone="muted">{getValue()}</Text>
          ),
        },
      ),
      syncRunColumnHelper.accessor(
        (run) => `${getProviderName(run.providerId, providers)} ${run.providerId}`,
        {
          id: 'provider',
          header: 'Provider',
          cell: ({ row }) => (
            <div className="flex flex-col gap-1">
              <Text variant="strong">{getProviderName(row.original.providerId, providers)}</Text>
              <Text variant="caption">{row.original.providerId}</Text>
            </div>
          ),
        },
      ),
      syncRunColumnHelper.accessor('sport', {
        header: 'Sport',
        cell: ({ getValue }) => (
          <Text>{getValue()}</Text>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatRequestedFeed(run.payload), {
        id: 'feed',
        header: 'Feed',
        cell: ({ getValue }) => (
          <Text>{getValue()}</Text>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatEventValue(run.eventId), {
        id: 'event',
        header: 'Event',
        cell: ({ getValue }) => (
          <Text tone="muted">{getValue()}</Text>
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
          <div className="flex flex-col items-start gap-1">
            <Text tone="muted">{buildPayloadSummary(row.original.payload)}</Text>
            <Text variant="caption">{buildCompactStatsSummary(row.original.payload)}</Text>
            {getPayloadWarnings(row.original.payload).length > 0 ? (
              <StatusBadge tone="warning">
                {getPayloadWarnings(row.original.payload).length} warning
                {getPayloadWarnings(row.original.payload).length === 1 ? '' : 's'}
              </StatusBadge>
            ) : null}
            <Button
              className="mt-1"
              onClick={() => onOpenRun(row.original)}
              type="button"
              variant="link"
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
