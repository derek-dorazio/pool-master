import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminListProviders,
  adminSyncProviderEventData,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';
import {
  EVENT_SYNC_PRESETS,
  formatJsonPayload,
  getEventSyncPreset,
  getSupportedSyncSports,
  type EventSyncPresetId,
  type EventSyncSubmission,
  type ProviderSummary,
  type SyncSport,
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

export function RootAdminRunEventSyncPage() {
  const logger = useLogger().child({
    feature: 'root-admin-run-event-sync-page',
  });
  const queryClient = useQueryClient();
  const [eventSyncSport, setEventSyncSport] = useState<SyncSport>('GOLF');
  const [eventSyncPresetId, setEventSyncPresetId] = useState<EventSyncPresetId>(
    'EVENTPARTICIPANTS',
  );
  const [eventSyncEventId, setEventSyncEventId] = useState('');

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

  const supportedSyncSports = useMemo(
    () => getSupportedSyncSports(providersQuery.data),
    [providersQuery.data],
  );

  useEffect(() => {
    if (!supportedSyncSports.includes(eventSyncSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setEventSyncSport(fallbackSport);
      }
    }
  }, [eventSyncSport, supportedSyncSports]);

  const eventSyncMutation = useMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      eventId: string;
      presetId: EventSyncPresetId;
    }): Promise<EventSyncSubmission> => {
      const preset = getEventSyncPreset(input.presetId);
      const response = await adminSyncProviderEventData({
        path: {
          sport: input.sport,
          eventId: input.eventId,
        },
        body: {
          feeds: [...preset.feeds],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Event sync response is missing the result payload.');
      }

      return response.data;
    },
    onMutate: (input) => {
      const preset = getEventSyncPreset(input.presetId);
      logger.debug(
        {
          action: 'rootAdmin.eventSync.started',
          data: {
            sport: input.sport,
            eventId: input.eventId,
            requestedFeeds: preset.feeds,
          },
        },
        'Starting manual provider event sync',
      );
    },
    onSuccess: async (result) => {
      logger.info(
        {
          action: 'rootAdmin.eventSync.submitted',
          data: {
            sport: result.sport,
            eventId: result.eventId,
            requestedFeeds: result.requestedFeeds,
            syncRunCount: result.syncRuns.length,
          },
        },
        'Submitted manual provider event sync',
      );
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'],
      });
    },
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.eventSync.failed',
            data: {
              sport: eventSyncSport,
              eventId: eventSyncEventId.trim(),
            },
            err: error,
          },
          'Manual provider event sync failed unexpectedly',
        );
        return;
      }

      logger.warn(
        {
          action: 'rootAdmin.eventSync.failed',
          data: {
            sport: eventSyncSport,
            eventId: eventSyncEventId.trim(),
          },
        },
        'Manual provider event sync failed',
      );
    },
  });

  const selectedPreset = getEventSyncPreset(eventSyncPresetId);

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-run-event-sync-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Sync
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              Run event sync
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Use this action when a specific event needs a targeted refresh for
              participants, live scores, or final results.
            </p>
          </div>
          <Link
            className="inline-flex items-center justify-center rounded-2xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm font-medium text-foreground transition hover:border-primary/40 hover:bg-primary/15"
            to="/manage/sync"
          >
            Back to Sync dashboard
          </Link>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <div className="space-y-3">
          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Preset</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-event-sync-preset"
              disabled={eventSyncMutation.isPending}
              onChange={(event) =>
                setEventSyncPresetId(event.target.value as EventSyncPresetId)}
              value={eventSyncPresetId}
            >
              {EVENT_SYNC_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Sport</span>
            <select
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-event-sync-sport"
              disabled={eventSyncMutation.isPending}
              onChange={(event) =>
                setEventSyncSport(event.target.value as SyncSport)}
              value={eventSyncSport}
            >
              {supportedSyncSports.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-muted-foreground">
            <span className="mb-2 block font-medium text-foreground">Event ID</span>
            <input
              className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
              data-testid="root-admin-event-sync-event-id"
              disabled={eventSyncMutation.isPending}
              onChange={(event) => setEventSyncEventId(event.target.value)}
              placeholder="golf-masters-2026"
              value={eventSyncEventId}
            />
          </label>

          <div className="rounded-[1.5rem] border border-border bg-background p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Requested feeds</p>
            <p className="mt-2">{selectedPreset.feeds.join(' · ')}</p>
          </div>

          {providersQuery.isError ? (
            <p className="text-sm text-muted-foreground">
              {extractErrorMessage(
                providersQuery.error,
                'Provider health context is unavailable, so the sport list is using fallback options.',
              )}
            </p>
          ) : null}

          <button
            className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            data-testid="root-admin-event-sync-now"
            disabled={eventSyncMutation.isPending || eventSyncEventId.trim().length === 0}
            onClick={() =>
              eventSyncMutation.mutate({
                sport: eventSyncSport,
                eventId: eventSyncEventId.trim(),
                presetId: eventSyncPresetId,
              })}
            type="button"
          >
            {eventSyncMutation.isPending ? 'Syncing...' : 'Run event sync'}
          </button>

          {eventSyncMutation.isError ? (
            <p className="text-sm text-rose-700">
              {extractErrorMessage(
                eventSyncMutation.error,
                'We could not submit the event sync right now.',
              )}
            </p>
          ) : null}

          {eventSyncMutation.isSuccess ? (
            <div
              className="rounded-[1.5rem] border border-border bg-background p-4 text-sm text-muted-foreground"
              data-testid="root-admin-event-sync-response"
            >
              <p className="font-medium text-foreground">Latest API payload</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {formatJsonPayload(eventSyncMutation.data)}
              </pre>
            </div>
          ) : null}
        </div>
      </section>
    </section>
  );
}
