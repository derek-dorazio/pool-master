import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminPrepareSportSync,
  adminListProviderSyncRuns,
  adminListProviders,
  type AdminPrepareSportSyncResponses,
  type AdminListProviderSyncRunsResponses,
  type AdminListProvidersResponses,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';

type ProviderSyncRun = AdminListProviderSyncRunsResponses[200]['items'][number];
type ProviderSummary = AdminListProvidersResponses[200]['items'][number];
type SportSyncPreparation = AdminPrepareSportSyncResponses[201];

const SPORT_OPTIONS = [
  'GOLF',
  'NFL',
  'NBA',
  'F1',
  'NASCAR',
  'NCAA_BASKETBALL',
  'NCAA_HOCKEY',
  'NCAA_FOOTBALL',
  'TENNIS',
  'HORSE_RACING',
  'SOCCER',
  'NHL',
  'MLB',
  'UFC',
] as const;

const SYNC_STATUS_OPTIONS = ['RUNNING', 'COMPLETED', 'FAILED'] as const;

function extractErrorMessage(error: unknown) {
  if (!error || typeof error !== 'object') {
    return 'We could not load provider sync runs right now.';
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

  return 'We could not load provider sync runs right now.';
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

function getProviderName(
  providerId: string,
  providers: ProviderSummary[] | undefined,
) {
  return providers?.find((provider) => provider.providerId === providerId)?.providerName ?? providerId;
}

function buildPayloadSummary(payload: Record<string, unknown>) {
  const primaryTextFields = ['detail', 'message', 'summary', 'runType'] as const;
  for (const key of primaryTextFields) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  const metricPairs: Array<[string, string]> = [
    ['recordsProcessed', 'processed'],
    ['eventCount', 'events'],
    ['participantCount', 'participants'],
    ['errorCount', 'errors'],
    ['errors', 'errors'],
  ];

  const metrics = metricPairs.flatMap(([key, label]) => {
    const value = payload[key];
    if (typeof value === 'number') {
      return [`${value} ${label}`];
    }

    if (typeof value === 'string' && value.trim().length > 0) {
      return [`${label}: ${value}`];
    }

    return [];
  });

  if (metrics.length > 0) {
    return metrics.slice(0, 3).join(' · ');
  }

  const fallbackEntries = Object.entries(payload).flatMap(([key, value]) => {
    if (
      value === null
      || value === undefined
      || typeof value === 'object'
      || key.endsWith('At')
      || key === 'providerId'
      || key === 'eventId'
      || key === 'status'
    ) {
      return [];
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      return [`${key}: ${String(value)}`];
    }

    return [];
  });

  return fallbackEntries[0] ?? 'Payload captured for operational review.';
}

function getStatusClasses(status: ProviderSyncRun['status'] | ProviderSummary['status']) {
  switch (status) {
    case 'COMPLETED':
    case 'HEALTHY':
      return 'border-emerald-300 bg-emerald-50 text-emerald-900';
    case 'RUNNING':
      return 'border-sky-300 bg-sky-50 text-sky-900';
    case 'FAILED':
    case 'DOWN':
      return 'border-rose-300 bg-rose-50 text-rose-900';
    case 'DEGRADED':
      return 'border-amber-300 bg-amber-50 text-amber-900';
    default:
      return 'border-border bg-background text-foreground';
  }
}

export function RootAdminPage() {
  const logger = useLogger().child({
    feature: 'root-admin-page',
  });
  const queryClient = useQueryClient();
  const [providerFilter, setProviderFilter] = useState('ALL');
  const [sportFilter, setSportFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [syncSport, setSyncSport] = useState<(typeof SPORT_OPTIONS)[number]>('GOLF');

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
          sport: sportFilter === 'ALL'
            ? undefined
            : sportFilter as (typeof SPORT_OPTIONS)[number],
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
    const providerIdsFromHealth = (providersQuery.data ?? []).map((provider) => provider.providerId);
    return Array.from(new Set([...providerIdsFromHealth, ...providerIdsFromRuns])).sort();
  }, [providersQuery.data, recentRuns]);

  const summary = useMemo(() => {
    const running = recentRuns.filter((run) => run.status === 'RUNNING').length;
    const failed = recentRuns.filter((run) => run.status === 'FAILED').length;
    const completed = recentRuns.filter((run) => run.status === 'COMPLETED').length;
    return {
      running,
      failed,
      completed,
      lastStartedAt: recentRuns[0]?.startedAt ?? recentRuns[0]?.createdAt ?? null,
    };
  }, [recentRuns]);

  const syncMutation = useMutation({
    mutationFn: async (sport: (typeof SPORT_OPTIONS)[number]): Promise<SportSyncPreparation> => {
      const response = await adminPrepareSportSync({
        path: { sport },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport sync response is missing the preparation payload.');
      }

      return response.data;
    },
    onMutate: (sport) => {
      logger.debug(
        {
          action: 'rootAdmin.sync.started',
          data: {
            sport,
          },
        },
        'Starting manual provider sync preparation',
      );
    },
    onSuccess: async (preparation) => {
      logger.info(
        {
          action: 'rootAdmin.sync.succeeded',
          data: {
            sport: preparation.sport,
            providerCount: preparation.providerIds.length,
            eventsHydrated: preparation.eventsHydrated,
          },
        },
        'Prepared contest-ready sync data',
      );
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'providers'] }),
        queryClient.invalidateQueries({ queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'] }),
      ]);
    },
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.sync.failed',
            data: {
              sport: syncSport,
            },
            err: error,
          },
          'Manual provider sync preparation failed unexpectedly',
        );
        return;
      }

      logger.warn(
        {
          action: 'rootAdmin.sync.failed',
          data: {
            sport: syncSport,
          },
        },
        'Manual provider sync preparation failed',
      );
    },
  });

  useEffect(() => {
    if (!providersQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.providers.failed',
        err: providersQuery.error instanceof Error ? providersQuery.error : undefined,
      },
      'Provider health summary failed to load',
    );
  }, [logger, providersQuery.error, providersQuery.isError]);

  useEffect(() => {
    if (!syncRunsQuery.isError) {
      return;
    }

    logger.warn(
      {
        action: 'rootAdmin.syncRuns.failed',
        err: syncRunsQuery.error instanceof Error ? syncRunsQuery.error : undefined,
      },
      'Provider sync runs failed to load',
    );
  }, [logger, syncRunsQuery.error, syncRunsQuery.isError]);

  useEffect(() => {
    if (!providersQuery.data || !syncRunsQuery.data) {
      return;
    }

    logger.info(
      {
        action: 'rootAdmin.page.loaded',
        data: {
          providerCount: providersQuery.data.length,
          syncRunCount: syncRunsQuery.data.length,
        },
      },
      'Loaded root-admin sync visibility page',
    );
  }, [logger, providersQuery.data, syncRunsQuery.data]);

  if (syncRunsQuery.isLoading) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8" data-testid="root-admin-page">
        <p className="text-sm text-muted-foreground">Loading recent provider sync runs...</p>
      </section>
    );
  }

  if (syncRunsQuery.isError) {
    return (
      <section className="rounded-[2rem] border border-border bg-card p-8" data-testid="root-admin-page">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">Provider sync visibility</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {extractErrorMessage(syncRunsQuery.error)}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-6" data-testid="root-admin-page">
      <section className="rounded-[2rem] border border-border bg-card p-8">
        <span className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
          Root Admin
        </span>
        <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground">Provider sync visibility</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              Thin operational visibility into provider sync activity. Root admins can manually start a sport sync
              when imported event or participant data has not loaded yet, then review the resulting sync history below.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
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
                {SPORT_OPTIONS.map((sport) => (
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
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Recent runs</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{recentRuns.length}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Completed</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.completed}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Running</p>
            <p className="mt-2 text-3xl font-semibold text-foreground">{summary.running}</p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Latest start</p>
            <p className="mt-2 text-sm font-medium text-foreground">{formatDateTimeDisplay(summary.lastStartedAt)}</p>
          </div>
        </div>

        {providersQuery.data && providersQuery.data.length > 0 ? (
          <div className="mt-6 flex flex-wrap gap-3">
            {providersQuery.data.map((provider) => (
              <div
                className="rounded-full border border-border bg-background px-4 py-2 text-xs text-muted-foreground"
                key={provider.providerId}
              >
                <span className="font-medium text-foreground">{provider.providerName}</span>
                <span className={`ml-2 inline-flex rounded-full border px-2 py-0.5 ${getStatusClasses(provider.status)}`}>
                  {provider.status}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {providersQuery.isError ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Provider health context is temporarily unavailable, but sync runs are still shown below.
          </p>
        ) : null}
      </section>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h3 className="text-xl font-semibold text-foreground">Sync history</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Most recent runs are shown first. Use manual sync only when automatic ingestion has not populated contest-ready
              data yet or when operational troubleshooting is needed.
            </p>
          </div>
          <div className="rounded-[1.5rem] border border-border bg-background p-4 xl:min-w-[24rem]">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Manual event sync</p>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row">
              <label className="flex-1 text-sm text-muted-foreground">
                <span className="mb-2 block font-medium text-foreground">Sport</span>
                <select
                  className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                  data-testid="root-admin-sync-sport"
                  disabled={syncMutation.isPending}
                  onChange={(event) => setSyncSport(event.target.value as (typeof SPORT_OPTIONS)[number])}
                  value={syncSport}
                >
                  {SPORT_OPTIONS.map((sport) => (
                    <option key={sport} value={sport}>
                      {sport}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 sm:self-end"
                data-testid="root-admin-sync-now"
                disabled={syncMutation.isPending}
                onClick={() => syncMutation.mutate(syncSport)}
                type="button"
              >
                {syncMutation.isPending ? 'Syncing...' : 'Sync events now'}
              </button>
            </div>

            {syncMutation.isError ? (
              <p className="mt-3 text-sm text-rose-700">
                {extractErrorMessage(syncMutation.error)}
              </p>
            ) : null}

            {syncMutation.isSuccess ? (
              <p className="mt-3 text-sm text-emerald-700" data-testid="root-admin-sync-success">
                Prepared
                {' '}
                {syncMutation.data.sport}
                {' '}
                event data across
                {' '}
                {syncMutation.data.providerIds.length}
                {' '}
                provider
                {syncMutation.data.providerIds.length === 1 ? '' : 's'}
                {' '}
                with
                {' '}
                {syncMutation.data.eventsHydrated}
                {' '}
                hydrated event
                {syncMutation.data.eventsHydrated === 1 ? '' : 's'}
                .
              </p>
            ) : null}
          </div>
        </div>

        {recentRuns.length === 0 ? (
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-border bg-background p-6 text-sm text-muted-foreground">
            No sync runs matched the current filters.
          </div>
        ) : (
          <div className="mt-5 overflow-hidden rounded-[1.5rem] border border-border bg-background">
            <div className="overflow-x-auto">
              <table className="min-w-full border-collapse text-left text-sm" data-testid="root-admin-sync-history-table">
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
                      <td className="px-4 py-4 text-foreground">{formatDateTimeDisplay(run.startedAt ?? run.createdAt)}</td>
                      <td className="px-4 py-4 text-muted-foreground">{formatDateTimeDisplay(run.completedAt)}</td>
                      <td className="px-4 py-4">
                        <div className="font-medium text-foreground">{getProviderName(run.providerId, providersQuery.data)}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{run.providerId}</div>
                      </td>
                      <td className="px-4 py-4 text-foreground">{run.sport}</td>
                      <td className="px-4 py-4 text-muted-foreground">{formatEventValue(run.eventId)}</td>
                      <td className="px-4 py-4">
                        <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] ${getStatusClasses(run.status)}`}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground">{buildPayloadSummary(run.payload)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
