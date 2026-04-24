import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminListProviderSyncRuns,
  adminListProviders,
} from '@/lib/api';
import {
  ALL_SYNC_SPORT_OPTIONS,
  buildPayloadSummary,
  getProviderName,
  getProviderStatusClasses,
  getSyncRunStatusClasses,
  type ProviderSummary,
  type ProviderSyncRun,
  type SyncSport,
  SYNC_STATUS_OPTIONS,
  formatJsonPayload,
} from './root-admin-sync-utils';

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

function formatEventValue(eventId: string | null | undefined) {
  if (!eventId || eventId.trim().length === 0) {
    return 'No event';
  }

  return eventId;
}

export function RootAdminSyncDashboardPage() {
  const [providerFilter, setProviderFilter] = useState('ALL');
  const [sportFilter, setSportFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

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
    queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs', providerFilter, sportFilter, statusFilter],
    queryFn: async (): Promise<ProviderSyncRun[]> => {
      const response = await adminListProviderSyncRuns({
        query: {
          providerId: providerFilter === 'ALL' ? undefined : providerFilter,
          sport: sportFilter === 'ALL' ? undefined : sportFilter as SyncSport,
          status: statusFilter === 'ALL'
            ? undefined
            : statusFilter as (typeof SYNC_STATUS_OPTIONS)[number],
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
  const providerOptions = useMemo(() => {
    const providerIdsFromRuns = recentRuns.map((run) => run.providerId);
    const providerIdsFromHealth = (providersQuery.data ?? []).map(
      (provider) => provider.providerId,
    );
    return Array.from(
      new Set([...providerIdsFromHealth, ...providerIdsFromRuns]),
    ).sort();
  }, [providersQuery.data, recentRuns]);

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

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sync-dashboard-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Manage
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              Sync
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Operational visibility into provider sync activity. Use this
              dashboard to review provider health, filter recent sync history,
              and move into the dedicated manual-run pages when automatic
              ingestion needs help.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
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
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Provider</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-provider-filter"
              onChange={(event) => setProviderFilter(event.target.value)}
              value={providerFilter}
            >
              <option value="ALL">All providers</option>
              {providerOptions.map((providerId) => (
                <option key={providerId} value={providerId}>
                  {getProviderName(providerId, providersQuery.data)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Sport</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-sport-filter"
              onChange={(event) => setSportFilter(event.target.value)}
              value={sportFilter}
            >
              <option value="ALL">All sports</option>
              {ALL_SYNC_SPORT_OPTIONS.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Status</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-status-filter"
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="ALL">All statuses</option>
              {SYNC_STATUS_OPTIONS.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </label>
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
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-foreground">Sync history</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Most recent runs are shown first. Use manual sync only when
              automatic ingestion has not populated contest-ready data yet or
              when operational troubleshooting is needed.
            </p>
          </div>
        </div>

        {syncRunsQuery.isError ? (
          <p className="mt-4 text-sm text-rose-700">
            {extractErrorMessage(
              syncRunsQuery.error,
              'We could not load provider sync runs right now.',
            )}
          </p>
        ) : null}

        {recentRuns.length === 0 ? (
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
            No sync runs matched the current filters.
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-border bg-background">
            <div className="overflow-x-auto">
              <table
                className="min-w-full border-collapse text-left text-sm"
                data-testid="root-admin-sync-history-table"
              >
                <thead className="bg-card/70 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Started</th>
                    <th className="px-4 py-3 font-medium">Completed</th>
                    <th className="px-4 py-3 font-medium">Provider</th>
                    <th className="px-4 py-3 font-medium">Sport</th>
                    <th className="px-4 py-3 font-medium">Event</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Summary</th>
                  </tr>
                </thead>
                <tbody>
                  {recentRuns.map((run) => (
                    <tr
                      className="border-t border-border align-top"
                      data-testid={`root-admin-sync-run-${run.id}`}
                      key={run.id}
                    >
                      <td className="px-4 py-4 text-foreground">
                        {formatDateTimeDisplay(run.startedAt ?? run.createdAt)}
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatDateTimeDisplay(run.completedAt)}
                      </td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">
                          {getProviderName(run.providerId, providersQuery.data)}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          {run.providerId}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-foreground">{run.sport}</td>
                      <td className="px-4 py-4 text-muted-foreground">
                        {formatEventValue(run.eventId)}
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getSyncRunStatusClasses(run.status)}`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">
                        <div>{buildPayloadSummary(run.payload)}</div>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium uppercase tracking-[0.18em] text-primary">
                            View payload
                          </summary>
                          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words rounded-xl border border-border bg-card p-3">
                            {formatJsonPayload(run.payload)}
                          </pre>
                        </details>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
