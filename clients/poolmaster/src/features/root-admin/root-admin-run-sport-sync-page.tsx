import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminListProviders,
  adminPrepareSportSync,
} from '@/lib/api';
import { useLogger } from '@/lib/logger';
import {
  Alert,
  Button,
  FormField,
  LinkButton,
  Select,
  Tile,
} from '@/features/shared/ui';
import {
  formatJsonPayload,
  getSportSyncPreset,
  getSupportedSyncSports,
  SPORT_SYNC_PRESETS,
  type ProviderSummary,
  type SportSyncPresetId,
  type SportSyncSubmission,
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

export function RootAdminRunSportSyncPage() {
  const logger = useLogger().child({
    feature: 'root-admin-run-sport-sync-page',
  });
  const queryClient = useQueryClient();
  const [sportSyncSport, setSportSyncSport] = useState<SyncSport>('GOLF');
  const [sportSyncPresetId, setSportSyncPresetId] = useState<SportSyncPresetId>(
    'PREPARE_EVENT_DATA',
  );

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
    if (!supportedSyncSports.includes(sportSyncSport)) {
      const fallbackSport = supportedSyncSports[0];
      if (fallbackSport) {
        setSportSyncSport(fallbackSport);
      }
    }
  }, [sportSyncSport, supportedSyncSports]);

  const syncMutation = useMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      presetId: SportSyncPresetId;
    }): Promise<SportSyncSubmission> => {
      const preset = getSportSyncPreset(input.presetId);
      const response = await adminPrepareSportSync({
        path: { sport: input.sport },
        body: {
          feeds: [...preset.feeds],
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport sync response is missing the preparation payload.');
      }

      return response.data;
    },
    onMutate: (input) => {
      const preset = getSportSyncPreset(input.presetId);
      logger.debug(
        {
          action: 'rootAdmin.sync.started',
          data: {
            sport: input.sport,
            requestedFeeds: preset.feeds,
          },
        },
        'Starting manual provider sync preparation',
      );
    },
    onSuccess: async (preparation) => {
      logger.info(
        {
          action: 'rootAdmin.sync.submitted',
          data: {
            sport: preparation.sport,
            requestedFeeds: preparation.requestedFeeds,
            syncRunCount: preparation.syncRuns.length,
          },
        },
        'Submitted manual provider sport sync',
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: ['poolmaster', 'root-admin', 'providers'],
        }),
        queryClient.invalidateQueries({
          queryKey: ['poolmaster', 'root-admin', 'provider-sync-runs'],
        }),
      ]);
    },
    onError: (error) => {
      if (error instanceof Error) {
        logger.error(
          {
            action: 'rootAdmin.sync.failed',
            data: {
              sport: sportSyncSport,
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
            sport: sportSyncSport,
          },
        },
        'Manual provider sync preparation failed',
      );
    },
  });

  const selectedPreset = getSportSyncPreset(sportSyncPresetId);

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-run-sport-sync-page"
    >
      <Tile>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Sync
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-foreground">
              Run sport sync
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-muted-foreground">
              Use this action when provider-fed event or participant data has not
              populated as expected and you need to manually submit the relevant
              sport-level ingestion workflow.
            </p>
          </div>
          <LinkButton
            to="/manage/sync"
            variant="subtle"
          >
            Back to Sync dashboard
          </LinkButton>
        </div>
      </Tile>

      <Tile>
        <div className="space-y-3">
          <FormField label="Preset">
            <Select
              data-testid="root-admin-sport-sync-preset"
              disabled={syncMutation.isPending}
              onChange={(event) =>
                setSportSyncPresetId(event.target.value as SportSyncPresetId)}
              value={sportSyncPresetId}
            >
              {SPORT_SYNC_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </Select>
          </FormField>

          <FormField label="Sport">
            <Select
              data-testid="root-admin-sport-sync-sport"
              disabled={syncMutation.isPending}
              onChange={(event) =>
                setSportSyncSport(event.target.value as SyncSport)}
              value={sportSyncSport}
            >
              {supportedSyncSports.map((sport) => (
                <option key={sport} value={sport}>
                  {sport}
                </option>
              ))}
            </Select>
          </FormField>

          <Tile radius="lg">
            <p className="font-medium text-foreground">Requested feeds</p>
            <p className="mt-2">{selectedPreset.feeds.join(' · ')}</p>
          </Tile>

          {providersQuery.isError ? (
            <Alert>
              {extractErrorMessage(
                providersQuery.error,
                'Provider health context is unavailable, so the sport list is using fallback options.',
              )}
            </Alert>
          ) : null}

          <Button
            data-testid="root-admin-sport-sync-now"
            disabled={syncMutation.isPending}
            onClick={() =>
              syncMutation.mutate({
                sport: sportSyncSport,
                presetId: sportSyncPresetId,
              })}
          >
            {syncMutation.isPending ? 'Syncing...' : 'Run sport sync'}
          </Button>

          {syncMutation.isError ? (
            <Alert tone="danger">
              {extractErrorMessage(
                syncMutation.error,
                'We could not submit the sport sync right now.',
              )}
            </Alert>
          ) : null}

          {syncMutation.isSuccess ? (
            <Tile data-testid="root-admin-sport-sync-response" radius="lg">
              <p className="font-medium text-foreground">Latest API payload</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs">
                {formatJsonPayload(syncMutation.data)}
              </pre>
            </Tile>
          ) : null}
        </div>
      </Tile>
    </section>
  );
}
