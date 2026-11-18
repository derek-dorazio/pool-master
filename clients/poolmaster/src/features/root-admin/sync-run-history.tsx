import { createColumnHelper } from '@tanstack/react-table';
import { SportOrder } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import type { ProviderSummaryDto } from '@/lib/api';
import { DataGrid, QueryState, SectionCard, StatusBadge, Text } from '@/features/shared/ui';
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
import { formatEventValue, getRunStatusLabel, getRunStatusTone } from './sync-run-status';

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
  const syncHistoryColumns = useMemo(
    () => [
      syncRunColumnHelper.accessor((run) => run.startedAt ?? run.createdAt, {
        id: 'started',
        header: 'Started',
        meta: { info: 'When the sync run started, in your time zone.', type: { kind: 'datetime', direction: 'past' } },
      }),
      syncRunColumnHelper.accessor((run) => run.completedAt ?? null, {
        id: 'completed',
        header: 'Completed',
        meta: { info: 'When the sync run finished, in your time zone; blank while it is still running.', type: { kind: 'datetime', direction: 'past' } },
      }),
      syncRunColumnHelper.accessor(
        (run) => run.providerId,
        {
          id: 'provider',
          header: 'Provider',
          meta: { info: 'The data provider the run read from.', type: { kind: 'enum', label: (providerId) => getProviderName(providerId, providers) } },
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
        meta: { info: 'The sport the run synced.', type: { kind: 'enum', order: SportOrder } },
        cell: ({ getValue }) => (
          <Text>{getValue()}</Text>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatRequestedFeed(run.payload), {
        id: 'feed',
        header: 'Feed',
        meta: { info: 'Which provider feed the run asked for.', type: { kind: 'enum' } },
        cell: ({ getValue }) => (
          <Text>{getValue()}</Text>
        ),
      }),
      syncRunColumnHelper.accessor((run) => formatEventValue(run.eventId), {
        id: 'event',
        header: 'Event',
        meta: { info: 'The one event the run synced, if it was limited to one.', type: { kind: 'text' } },
        cell: ({ getValue }) => (
          <Text tone="muted">{getValue()}</Text>
        ),
      }),
      syncRunColumnHelper.accessor((run) => getRunStatusLabel(run), {
        id: 'status',
        header: 'Status',
        meta: { info: 'How the run ended, or that it is still running.', type: { kind: 'enum' } },
        cell: ({ row }) => (
          <StatusBadge tone={getRunStatusTone(row.original)}>
            {getRunStatusLabel(row.original)}
          </StatusBadge>
        ),
      }),
      syncRunColumnHelper.accessor((run) => buildPayloadSummary(run.payload), {
        id: 'summary',
        header: 'Summary',
        meta: { info: 'What the run changed, and any warnings it raised.', type: { kind: 'text' } },
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
          </div>
        ),
      }),
    ],
    [providers],
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
            openRowDialog={onOpenRun}
            pageSize={MANAGE_LIST_PAGE_SIZE}
            rowTestId={(run) => `root-admin-sync-run-${run.id}`}
            tableTestId="root-admin-sync-history-table"
          />
        )}
      </QueryState>
    </SectionCard>
  );
}
