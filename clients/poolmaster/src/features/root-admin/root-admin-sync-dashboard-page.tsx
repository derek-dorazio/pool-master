import { createColumnHelper } from '@tanstack/react-table';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminListProviderSyncRuns,
  adminListProviders,
} from '@/lib/api';
import {
  buildPayloadSummary,
  getProviderName,
  getProviderStatusClasses,
  getSyncRunStatusClasses,
  type ProviderSummary,
  type ProviderSyncRun,
  formatJsonPayload,
} from './root-admin-sync-utils';
import { AdminDataGrid } from './admin-data-grid';

const syncRunColumnHelper = createColumnHelper<ProviderSyncRun>();

function extractErrorMessage(error: unknown, fallback: string) {
  if (!error || typeof error !== 'object') {
    return fallback;
  }

  const candidate = error as {
    error?: { message?: unknown };
    message?: unknown;
  };

  if (typeof candidate.error?.message === 'string') {
    return candidate.error.message;
  }

  if (typeof candidate.message === 'string') {
    return candidate.message;
  }

  return fallback;
}

function formatDateTimeDisplay(isoString: string | null | undefined) {
  if (!isoString) {
    return 'Unavailable';
  }

  const parsed = Date.parse(isoString);
  if (Number.isNaN(parsed)) {
    return 'Unavailable';
  }

  return new Date(parsed).toLocaleString();
}

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

export function RootAdminSyncDashboardPage() {
  const providersQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'providers'],
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
    queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'],
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
        cell: ({ getValue }) => (
          <span
            className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getSyncRunStatusClasses(getValue())}`}
          >
            {getValue()}
          </span>
        ),
      }),
      syncRunColumnHelper.accessor((run) => buildPayloadSummary(run.payload), {
        id: 'summary',
        header: 'Summary',
        cell: ({ row }) => (
          <div className="text-muted-foreground">
            <div>{buildPayloadSummary(row.original.payload)}</div>
            <details className="mt-2">
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.18em] text-primary">
                View payload
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-3">
                {formatJsonPayload(row.original.payload)}
              </pre>
            </details>
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
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-wrap gap-3">
          <Link
            className="inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            data-testid="root-admin-open-run-sport-sync-page"
            to="/manage/sync/run-sport-sync"
          >
            Open sport sync page
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            data-testid="root-admin-open-run-event-sync-page"
            to="/manage/sync/run-event-sync"
          >
            Open event sync page
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-5">
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Recent runs
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {recentRuns.length}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Submitted
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary.submitted}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Completed
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary.completed}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              In progress
            </p>
            <p className="mt-2 text-3xl font-semibold text-foreground">
              {summary.running}
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Latest start
            </p>
            <p className="mt-2 text-sm font-medium text-foreground">
              {formatDateTimeDisplay(summary.lastStartedAt)}
            </p>
          </div>
        </div>

        {providersQuery.data && providersQuery.data.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {providersQuery.data.map((provider) => (
              <div
                className="rounded-full border border-border bg-background px-4 py-2 text-xs text-muted-foreground"
                key={provider.providerId}
              >
                <span className="font-medium text-foreground">
                  {provider.providerName}
                </span>
                <span
                  className={`ml-2 inline-flex rounded-full border px-2 py-0.5 ${getProviderStatusClasses(provider.status)}`}
                >
                  {provider.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {providersQuery.isError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Provider health context is temporarily unavailable, but sync runs are
            still shown below.
          </p>
        ) : null}
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {syncRunsQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractErrorMessage(
              syncRunsQuery.error,
              'We could not load provider sync runs right now.',
            )}
          </p>
        ) : null}

        {!syncRunsQuery.isError ? (
          <AdminDataGrid
            columns={syncHistoryColumns}
            data={recentRuns}
            emptyMessage="No sync runs matched the current filters."
            getRowId={(run) => run.id}
            rowTestId={(run) => `root-admin-sync-run-${run.id}`}
            tableTestId="root-admin-sync-history-table"
          />
        ) : null}
      </section>
    </section>
  );
}
