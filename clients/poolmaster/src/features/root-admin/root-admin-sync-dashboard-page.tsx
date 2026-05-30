import { createColumnHelper } from '@tanstack/react-table';
import { Search } from 'lucide-react';
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tile,
} from '@/features/shared/ui';
import {
  buildCompactStatsSummary,
  buildPayloadSummary,
  buildStatsSummary,
  formatRequestedFeed,
  getPayloadSection,
  getPayloadWarnings,
  getProviderName,
  type ProviderSummary,
  type ProviderSyncRun,
  formatJsonPayload,
} from './root-admin-sync-utils';
import { extractErrorMessage } from '@/lib/errors';
import { QueryKeys } from '@/lib/query-keys';

const syncRunColumnHelper = createColumnHelper<ProviderSyncRun>();
type SyncRunEvidenceRow = {
  id: string;
  disposition: 'UNCHANGED' | 'CREATED' | 'UPDATED' | 'DELETED';
  entityType: string;
  identifier: string;
  name: string;
  providerId: string;
  eventId: string;
  participantId: string;
  detailsPayload: unknown;
};

const evidenceColumnHelper = createColumnHelper<SyncRunEvidenceRow>();

const WORKFLOW_STEPS = [
  'Schedule',
  'Participants',
  'World rankings',
  'Mock state',
  'Live scores',
] as const;

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
  const warnings = getPayloadWarnings(run.payload);
  const severity = getPayloadSeverity(run.payload);
  if (severity === 'WARNING' || warnings.length > 0) {
    return 'warning';
  }
  if (severity === 'ERROR') {
    return 'danger';
  }

  return getStatusTone(run.status);
}

function getRunStatusLabel(run: ProviderSyncRun) {
  const warnings = getPayloadWarnings(run.payload);
  if (run.status === 'COMPLETED' && (getPayloadSeverity(run.payload) === 'WARNING' || warnings.length > 0)) {
    return 'COMPLETED WITH WARNINGS';
  }

  return run.status;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function getPayloadSeverity(payload: Record<string, unknown>) {
  const outcome = payload.outcome;
  if (!isRecord(outcome)) {
    return null;
  }

  const severity = outcome.severity;
  return severity === 'SUCCESS' || severity === 'WARNING' || severity === 'ERROR'
    ? severity
    : null;
}

function buildRunEvidenceRows(run: ProviderSyncRun | null): SyncRunEvidenceRow[] {
  const writeRows = run?.payload.writeDiagnostics?.rows;
  if (!writeRows) {
    return [];
  }

  return writeRows.map((row) => ({
    id: row.id,
    disposition: row.disposition,
    entityType: row.entityType,
    identifier: row.internalId ?? row.externalId ?? row.participantExternalId ?? row.id,
    name: row.name ?? 'No name',
    providerId: row.providerId ?? 'No provider',
    eventId: row.externalId ?? 'No event',
    participantId: row.participantExternalId ?? 'No participant',
    detailsPayload: {
      disposition: row.disposition,
      entityType: row.entityType,
      providerId: row.providerId ?? null,
      externalId: row.externalId ?? null,
      participantExternalId: row.participantExternalId ?? null,
      internalId: row.internalId ?? null,
      name: row.name ?? null,
      ...(row.before === undefined ? {} : { before: row.before }),
      ...(row.after === undefined ? {} : { after: row.after }),
    },
  }));
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
  const payloadStats = payloadRun ? buildStatsSummary(payloadRun.payload) : [];
  const payloadWarnings = payloadRun ? getPayloadWarnings(payloadRun.payload) : [];
  const evidenceRows = useMemo(() => buildRunEvidenceRows(payloadRun), [payloadRun]);
  const requestPayload = payloadRun ? getPayloadSection(payloadRun.payload, 'requestPayload') : null;
  const providerPayload = payloadRun ? getPayloadSection(payloadRun.payload, 'providerPayload') : null;
  const jobPayload = payloadRun ? getPayloadSection(payloadRun.payload, 'jobPayload') : null;
  const evidenceEmptyMessage = [
    'No normalized PoolMaster write rows were captured for this sync.',
    providerPayload?.rawCaptured === true ? 'Use the Payloads tab to inspect the raw provider payload.' : null,
  ].filter(Boolean).join(' ');

  const evidenceColumns = useMemo(
    () => [
      evidenceColumnHelper.accessor('disposition', {
        header: 'Operation',
        cell: ({ getValue }) => (
          <StatusBadge tone={getValue() === 'UPDATED' || getValue() === 'CREATED' || getValue() === 'DELETED' ? 'warning' : 'neutral'}>
            {getValue()}
          </StatusBadge>
        ),
      }),
      evidenceColumnHelper.accessor('entityType', {
        header: 'Entity',
        cell: ({ getValue }) => <span className="text-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('name', {
        header: 'Name',
        cell: ({ getValue }) => <span className="text-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('identifier', {
        header: 'Identifier',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('participantId', {
        header: 'Participant',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('providerId', {
        header: 'Provider',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.display({
        id: 'details',
        header: 'Details',
        cell: ({ row }) => (
          <Button
            aria-label={`View JSON details for ${row.original.name}`}
            className="inline-flex items-center gap-2"
            onClick={() => setJsonPayload({
              title: `${row.original.disposition} ${row.original.entityType}`,
              payload: row.original.detailsPayload,
            })}
            type="button"
            variant="secondary"
          >
            <Search aria-hidden="true" className="size-4" />
            View JSON
          </Button>
        ),
      }),
    ],
    [],
  );

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
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="flex flex-wrap gap-2" data-testid="root-admin-sync-workflow-sequence">
            {WORKFLOW_STEPS.map((step) => (
              <StatusBadge key={step} tone="neutral">
                {step}
              </StatusBadge>
            ))}
          </div>
          <div className="flex flex-wrap gap-3">
            <LinkButton
              data-testid="root-admin-open-run-sport-sync-page"
              to="/manage/sync/run-sport-sync"
              variant="primary"
            >
              Run sport sync
            </LinkButton>
            <LinkButton
              data-testid="root-admin-open-run-event-sync-page"
              to="/manage/sync/run-event-sync"
              variant="subtle"
            >
              Run event sync
            </LinkButton>
          </div>
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
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="payloads">Payloads</TabsTrigger>
              </TabsList>
              <TabsContent className="mt-4 space-y-4" value="summary">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {buildPayloadSummary(payloadRun.payload)}
                  </p>
                  {payloadWarnings.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {payloadWarnings.map((warning, index) => (
                        <Alert key={`${warning.code}-${index}`} tone="warning">
                          {warning.message}
                        </Alert>
                      ))}
                    </div>
                  ) : null}
                </div>

                {payloadStats.length > 0 ? (
                  <MetricGrid className="md:grid-cols-3">
                    {payloadStats.map((stat) => (
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
              </TabsContent>
              <TabsContent className="mt-4" value="details">
                <DataGrid
                  columns={evidenceColumns}
                  data={evidenceRows}
                  emptyMessage={evidenceEmptyMessage}
                  filterTestIdPrefix="root-admin-sync-detail-filter"
                  getRowId={(row) => row.id}
                  rowTestId={(row) => `root-admin-sync-detail-row-${row.id}`}
                  tableTestId="root-admin-sync-detail-grid"
                />
              </TabsContent>
              <TabsContent className="mt-4 space-y-3" value="payloads">
                <div className="flex flex-wrap gap-3">
                  {requestPayload ? (
                    <Button
                      onClick={() => setJsonPayload({
                        title: 'Request payload',
                        payload: requestPayload,
                      })}
                      type="button"
                      variant="secondary"
                    >
                      Show request payload
                    </Button>
                  ) : null}
                  {jobPayload ? (
                    <Button
                      onClick={() => setJsonPayload({
                        title: 'Job payload',
                        payload: jobPayload,
                      })}
                      type="button"
                      variant="secondary"
                    >
                      Show job payload
                    </Button>
                  ) : null}
                  {providerPayload ? (
                    <Button
                      onClick={() => setJsonPayload({
                        title: 'Provider payload',
                        payload: providerPayload,
                      })}
                      type="button"
                      variant="secondary"
                    >
                      Show provider payload
                    </Button>
                  ) : null}
                </div>
                {!requestPayload && !jobPayload && !providerPayload ? (
                  <p className="text-sm text-muted-foreground">
                    No request, job, or provider payload was captured for this run.
                  </p>
                ) : null}
              </TabsContent>
            </Tabs>
          ) : null
        }
        details={
          payloadRun
            ? [
                { id: 'status', label: 'Status', value: getRunStatusLabel(payloadRun) },
                { id: 'feed', label: 'Feed', value: formatRequestedFeed(payloadRun.payload) },
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
