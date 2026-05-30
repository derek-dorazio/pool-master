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
  source: string;
  path: string;
  recordType: string;
  identifier: string;
  name: string;
  status: string;
  metrics: string;
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

function toDisplayValue(value: unknown) {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function buildRecordMetrics(record: Record<string, unknown>) {
  const metricKeys = [
    'ranking',
    'rank',
    'odds',
    'score',
    'scoreToPar',
    'strokes',
    'currentRound',
    'finishPosition',
    'totalScore',
    'totalStrokes',
  ];

  return metricKeys.flatMap((key) => {
    const value = record[key];
    return value === undefined || value === null ? [] : [`${key}: ${String(value)}`];
  }).join(' · ');
}

function buildEvidenceRow(input: {
  index: number;
  path: string;
  record: Record<string, unknown>;
  recordType: string;
  source: string;
}): SyncRunEvidenceRow {
  const identifier =
    toDisplayValue(input.record.eventId)
    || toDisplayValue(input.record.externalId)
    || toDisplayValue(input.record.contestantId)
    || toDisplayValue(input.record.participantExternalId)
    || toDisplayValue(input.record.id)
    || `row-${input.index + 1}`;

  return {
    id: `${input.path}-${input.recordType}-${identifier}-${input.index}`,
    source: input.source,
    path: input.path,
    recordType: input.recordType,
    identifier,
    name: toDisplayValue(input.record.name) || toDisplayValue(input.record.displayName) || 'No name',
    status: toDisplayValue(input.record.status) || toDisplayValue(input.record.result) || 'No status',
    metrics: buildRecordMetrics(input.record) || 'No metrics',
  };
}

function extractContestants(
  raw: Record<string, unknown>,
): Array<{ record: Record<string, unknown>; recordType: string }> {
  const directContestants = raw.contestants;
  if (Array.isArray(directContestants)) {
    return directContestants
      .filter(isRecord)
      .map((record) => ({ record, recordType: 'Participant' }));
  }

  const event = raw.event;
  if (!isRecord(event)) {
    return [];
  }

  const field = event.field;
  const feeds = event.feeds;
  const fieldContestants = isRecord(field) && Array.isArray(field.contestants)
    ? field.contestants.filter(isRecord).map((record) => ({ record, recordType: 'Field participant' }))
    : [];
  const odds = isRecord(feeds) && isRecord(feeds.odds) && Array.isArray(feeds.odds.contestants)
    ? feeds.odds.contestants.filter(isRecord).map((record) => ({ record, recordType: 'Odds participant' }))
    : [];
  const rankings = isRecord(feeds) && isRecord(feeds.rankings) && Array.isArray(feeds.rankings.contestants)
    ? feeds.rankings.contestants.filter(isRecord).map((record) => ({ record, recordType: 'Ranking participant' }))
    : [];
  const results = isRecord(feeds) && isRecord(feeds.results) && Array.isArray(feeds.results.contestants)
    ? feeds.results.contestants.filter(isRecord).map((record) => ({ record, recordType: 'Result participant' }))
    : [];

  return [...fieldContestants, ...odds, ...rankings, ...results];
}

function buildRunEvidenceRows(run: ProviderSyncRun | null): SyncRunEvidenceRow[] {
  const providerPayload = run ? getPayloadSection(run.payload, 'providerPayload') : null;
  const rawCaptures = providerPayload?.raw;
  if (!Array.isArray(rawCaptures)) {
    return [];
  }

  return rawCaptures.flatMap((capture, captureIndex) => {
    if (!isRecord(capture)) {
      return [];
    }

    const raw = capture.raw;
    if (!isRecord(raw)) {
      return [];
    }

    const path = toDisplayValue(capture.path) || `capture-${captureIndex + 1}`;
    const source = toDisplayValue(capture.operation) || 'provider payload';
    const rows: SyncRunEvidenceRow[] = [];
    const events = raw.events;

    if (Array.isArray(events)) {
      rows.push(...events.filter(isRecord).map((record, index) =>
        buildEvidenceRow({
          index,
          path,
          record,
          recordType: 'Event',
          source,
        }),
      ));
    }

    if (isRecord(raw.event)) {
      rows.push(buildEvidenceRow({
        index: 0,
        path,
        record: raw.event,
        recordType: 'Event detail',
        source,
      }));
    }

    rows.push(...extractContestants(raw).map(({ record, recordType }, index) =>
      buildEvidenceRow({
        index,
        path,
        record,
        recordType,
        source,
      }),
    ));

    const rounds = raw.rounds;
    if (Array.isArray(rounds)) {
      rows.push(...rounds.filter(isRecord).map((record, index) =>
        buildEvidenceRow({
          index,
          path,
          record,
          recordType: 'Live score',
          source,
        }),
      ));
    }

    return rows;
  });
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
  const evidenceEmptyMessage = providerPayload?.rawCaptured === true
    ? 'This provider captured raw payload data, but Sync Center does not yet expose run-specific detail rows for that provider shape. Use the Payloads tab to inspect the raw provider payload.'
    : 'No run-specific detail rows were captured for this sync.';

  const evidenceColumns = useMemo(
    () => [
      evidenceColumnHelper.accessor('recordType', {
        header: 'Type',
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
      evidenceColumnHelper.accessor('status', {
        header: 'Status',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('metrics', {
        header: 'Metrics',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
      }),
      evidenceColumnHelper.accessor('path', {
        header: 'Source path',
        cell: ({ getValue }) => <span className="text-muted-foreground">{getValue()}</span>,
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
