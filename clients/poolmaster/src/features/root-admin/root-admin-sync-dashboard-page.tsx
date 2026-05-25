import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminListProviderSyncRuns,
  adminListProviders,
} from '@/lib/api';
import {
  Alert,
  Button,
  DataGrid,
  formatDateTimeDisplay,
  LinkButton,
  MetricGrid,
  MetricTile,
  ReadOnlyDetailModal,
  StatusBadge,
  Tile,
} from '@/features/shared/ui';
import {
  buildPayloadSummary,
  buildStatsSummary,
  getPayloadOutcome,
  getProviderName,
  type ProviderSummary,
  type ProviderSyncRun,
  formatJsonPayload,
} from './root-admin-sync-utils';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

const syncRunColumnHelper = createColumnHelper<ProviderSyncRun>();

function toSortableTimestamp(isoString: string | null | undefined) {
  if (!isoString) {
    return 0;
  }

  const parsed = Date.parse(isoString);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function formatEventValue(eventId: string | null | undefined) {
  if (!eventId || eventId.trim().length === 0) {
    return 'No event';
  }

  return eventId;
}

function getStatusTone(status: string) {
  switch (status) {
    case 'COMPLETED':
    case 'HEALTHY':
      return 'success';
    case 'FAILED':
    case 'UNHEALTHY':
      return 'danger';
    case 'IN_PROGRESS':
    case 'SUBMITTED':
      return 'warning';
    default:
      return 'neutral';
  }
}

function getRunStatusTone(run: ProviderSyncRun) {
  const outcome = getPayloadOutcome(run.payload);
  if (outcome?.severity === 'WARNING') {
    return 'warning';
  }
  if (outcome?.severity === 'ERROR') {
    return 'danger';
  }

  return getStatusTone(run.status);
}

function getRunStatusLabel(run: ProviderSyncRun) {
  const outcome = getPayloadOutcome(run.payload);
  if (run.status === 'COMPLETED' && outcome?.severity === 'WARNING') {
    return 'COMPLETED WITH WARNINGS';
  }

  return run.status;
}

function getPayloadSection(run: ProviderSyncRun | null, key: 'providerPayload' | 'jobPayload') {
  if (!run) {
    return null;
  }

  return run.payload[key] ?? null;
}

export function RootAdminSyncDashboardPage() {
  const [payloadRun, setPayloadRun] = useState<ProviderSyncRun | null>(null);
  const [jsonPayload, setJsonPayload] = useState<{
    title: string;
    payload: unknown;
  } | null>(null);
  const providersQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providers,
    queryFn: async (): Promise<ProviderSummary[]> => {
      const response = await adminListProviders();
      if (!response.data?.items) {
        throw response.error ?? new Error('Provider list response is missing data.');
      }
      return response.data.items;
    },
    retry: false,
  });

  const syncRunsQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.providerSyncRuns,
    queryFn: async (): Promise<ProviderSyncRun[]> => {
      const response = await adminListProviderSyncRuns({
        query: {
          limit: 25,
        },
      });

      if (!response.data?.items) {
        throw response.error ?? new Error('Provider sync run response is missing data.');
      }

      return response.data.items;
    },
    retry: false,
  });

  const recentRuns = syncRunsQuery.data ?? [];
  const summary = useMemo(() => {
    const submitted = recentRuns.filter((run) => run.status === 'SUBMITTED').length;
    const running = recentRuns.filter((run) => run.status === 'IN_PROGRESS').length;
    const failed = recentRuns.filter((run) => run.status === 'FAILED').length;
    const completed = recentRuns.filter((run) => run.status === 'COMPLETED').length;
    return {
      submitted,
      running,
      failed,
      completed,
      lastStartedAt: recentRuns[0]?.startedAt ?? recentRuns[0]?.createdAt ?? null,
    };
  }, [recentRuns]);

  const syncHistoryColumns = useMemo(
    () => [
      syncRunColumnHelper.accessor(
        (run) => formatDateTimeDisplay(run.startedAt ?? run.createdAt),
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
        (run) => formatDateTimeDisplay(run.completedAt),
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
        (run) => `${getProviderName(run.providerId, providersQuery.data)} ${run.providerId}`,
        {
          id: 'provider',
          header: 'Provider',
          cell: ({ row }) => (
            <div>
              <div className="font-medium text-foreground">
                {getProviderName(row.original.providerId, providersQuery.data)}
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
            <Button
              className="mt-2 h-auto rounded-none p-0 text-xs uppercase"
              onClick={() => setPayloadRun(row.original)}
              type="button"
              variant="ghost"
            >
                View details
            </Button>
          </div>
        ),
      }),
    ],
    [providersQuery.data],
  );

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sync-dashboard-page"
    >
      <Tile padding="lg">
        <div className="flex flex-wrap gap-3">
          <LinkButton
            data-testid="root-admin-open-run-sport-sync-page"
            to="/manage/sync/run-sport-sync"
            variant="subtle"
          >
            Open sport sync page
          </LinkButton>
          <LinkButton
            data-testid="root-admin-open-run-event-sync-page"
            to="/manage/sync/run-event-sync"
            variant="subtle"
          >
            Open event sync page
          </LinkButton>
        </div>
        <MetricGrid className="mt-6 md:grid-cols-5">
          <MetricTile label="Recent runs" value={recentRuns.length} />
          <MetricTile label="Submitted" value={summary.submitted} />
          <MetricTile label="Completed" value={summary.completed} />
          <MetricTile label="In progress" value={summary.running} />
          <MetricTile label="Latest start" value={formatDateTimeDisplay(summary.lastStartedAt)} />
        </MetricGrid>

        {providersQuery.data && providersQuery.data.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {providersQuery.data.map((provider) => (
              <StatusBadge key={provider.providerId} tone="neutral">
                <span className="font-medium text-foreground">
                  {provider.providerName}
                </span>
                <StatusBadge className="ml-2 px-2 py-0.5" tone={getStatusTone(provider.status)}>
                  {provider.status}
                </StatusBadge>
              </StatusBadge>
            ))}
          </div>
        ) : null}

        {providersQuery.isError ? (
          <Alert className="mt-4">
            Provider health context is temporarily unavailable, but sync runs are
            still shown below.
          </Alert>
        ) : null}
      </Tile>

      <Tile>
        {syncRunsQuery.isError ? (
          <Alert tone="danger">
            {extractErrorMessage(
              syncRunsQuery.error,
              { fallback: 'We could not load provider sync runs right now.' },
            )}
          </Alert>
        ) : null}

        {!syncRunsQuery.isError ? (
          <DataGrid
            columns={syncHistoryColumns}
            data={recentRuns}
            emptyMessage="No sync runs matched the current filters."
            getRowId={(run) => run.id}
            rowTestId={(run) => `root-admin-sync-run-${run.id}`}
            tableTestId="root-admin-sync-history-table"
          />
        ) : null}
      </Tile>
      <ReadOnlyDetailModal
        description="Provider sync run outcome, stats, warnings, and payload drill-downs."
        detailContent={
          payloadRun ? (
            <div className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {buildPayloadSummary(payloadRun.payload)}
                </p>
                {getPayloadOutcome(payloadRun.payload)?.warnings.length ? (
                  <div className="mt-3 space-y-2">
                    {getPayloadOutcome(payloadRun.payload)?.warnings.map((warning, index) => (
                      <Alert key={`${String((warning as { code?: unknown }).code)}-${index}`} tone="warning">
                        {String((warning as { message?: unknown }).message ?? 'Sync completed with a warning.')}
                      </Alert>
                    ))}
                  </div>
                ) : null}
              </div>

              {buildStatsSummary(payloadRun.payload).length > 0 ? (
                <MetricGrid className="md:grid-cols-3">
                  {buildStatsSummary(payloadRun.payload).map((stat) => (
                    <MetricTile
                      key={stat.key}
                      label={stat.label}
                      value={stat.value}
                    />
                  ))}
                </MetricGrid>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No canonical sync stats were captured for this run.
                </p>
              )}

              <div className="flex flex-wrap gap-3">
                {getPayloadSection(payloadRun, 'providerPayload') ? (
                  <Button
                    onClick={() => setJsonPayload({
                      title: 'Provider payload',
                      payload: getPayloadSection(payloadRun, 'providerPayload'),
                    })}
                    type="button"
                    variant="secondary"
                  >
                    Show provider payload
                  </Button>
                ) : null}
                {getPayloadSection(payloadRun, 'jobPayload') ? (
                  <Button
                    onClick={() => setJsonPayload({
                      title: 'Job payload',
                      payload: getPayloadSection(payloadRun, 'jobPayload'),
                    })}
                    type="button"
                    variant="secondary"
                  >
                    Show job payload
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null
        }
        details={
          payloadRun
            ? [
                { id: 'status', label: 'Status', value: getRunStatusLabel(payloadRun) },
                { id: 'sport', label: 'Sport', value: payloadRun.sport },
                { id: 'event', label: 'Event', value: formatEventValue(payloadRun.eventId) },
                {
                  id: 'provider',
                  label: 'Provider',
                  value: getProviderName(payloadRun.providerId, providersQuery.data),
                },
              ]
            : undefined
        }
        onCancel={() => setPayloadRun(null)}
        onCopy={() => {
          if (payloadRun && navigator.clipboard) {
            void navigator.clipboard.writeText(formatJsonPayload(payloadRun.payload));
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setPayloadRun(null);
          }
        }}
        open={Boolean(payloadRun)}
        testId="root-admin-sync-payload-modal"
        title="Sync run details"
      />
      <ReadOnlyDetailModal
        description="Raw JSON captured for root-admin sync investigation."
        detailContent={
          <pre className="whitespace-pre-wrap break-words">
            {formatJsonPayload(jsonPayload?.payload ?? null)}
          </pre>
        }
        onCancel={() => setJsonPayload(null)}
        onCopy={() => {
          if (jsonPayload && navigator.clipboard) {
            void navigator.clipboard.writeText(formatJsonPayload(jsonPayload.payload));
          }
        }}
        onOpenChange={(open) => {
          if (!open) {
            setJsonPayload(null);
          }
        }}
        open={Boolean(jsonPayload)}
        testId="root-admin-sync-json-payload-modal"
        title={jsonPayload?.title ?? 'Sync payload'}
      />
    </section>
  );
}
