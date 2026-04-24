import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminGetIngestionSchedule,
  adminResetSportIngestionOverride,
  adminSetSportIngestionOverride,
} from '@/lib/api';
import { ALL_SYNC_SPORT_OPTIONS, type SyncSport } from './root-admin-sync-utils';
import {
  buildSportOverrideDraft,
  cloneIngestionConfig,
  extractAdminErrorMessage,
  INGESTION_POLICY_FIELDS,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './root-admin-sync-config-utils';

export function RootAdminSportOverridesPage() {
  const queryClient = useQueryClient();
  const [overrideSport, setOverrideSport] = useState<SyncSport>('GOLF');
  const [ingestionDraft, setIngestionDraft] =
    useState<IngestionScheduleConfig | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<
    Record<IngestionPolicyKey, boolean> | null
  >(null);

  const ingestionConfigQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
    queryFn: async (): Promise<IngestionScheduleConfig> => {
      const response = await adminGetIngestionSchedule();
      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });

  useEffect(() => {
    if (!ingestionConfigQuery.data) {
      return;
    }

    const nextDraft = cloneIngestionConfig(ingestionConfigQuery.data);
    setIngestionDraft(nextDraft);
    setOverrideDraft(buildSportOverrideDraft(nextDraft, overrideSport));
  }, [ingestionConfigQuery.data, overrideSport]);

  const sportOverrideMutation = useMutation({
    mutationFn: async (input: {
      sport: SyncSport;
      draft: Record<IngestionPolicyKey, boolean>;
    }) => {
      const response = await adminSetSportIngestionOverride({
        path: { sport: input.sport },
        body: {
          healthCheck: { enabled: input.draft.healthCheck },
          eventSchedule: { enabled: input.draft.eventSchedule },
          eventParticipants: { enabled: input.draft.eventParticipants },
          participantRankings: { enabled: input.draft.participantRankings },
          eventLiveScores: { enabled: input.draft.eventLiveScores },
          eventResults: { enabled: input.draft.eventResults },
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport override update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      const nextDraft = cloneIngestionConfig(data);
      setIngestionDraft(nextDraft);
      setOverrideDraft(buildSportOverrideDraft(nextDraft, overrideSport));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
      });
    },
  });

  const resetSportOverrideMutation = useMutation({
    mutationFn: async (sport: SyncSport) => {
      const response = await adminResetSportIngestionOverride({
        path: { sport },
      });

      if (!response.data) {
        throw response.error ?? new Error('Sport override reset response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      const nextDraft = cloneIngestionConfig(data);
      setIngestionDraft(nextDraft);
      setOverrideDraft(buildSportOverrideDraft(nextDraft, overrideSport));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
      });
    },
  });

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sport-overrides-page"
    >
      <div className="rounded-[2rem] border border-border bg-card p-6">
        <Link
          className="text-sm font-medium text-primary transition hover:opacity-80"
          to="/manage/sync-config"
        >
          Back to Sync Configuration
        </Link>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-foreground">
              Sport Ingestion Overrides
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Enable or disable automated feed policies for an individual sport
              without changing the global cadence for every other sport.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={resetSportOverrideMutation.isPending}
            onClick={() => resetSportOverrideMutation.mutate(overrideSport)}
            type="button"
          >
            {resetSportOverrideMutation.isPending
              ? 'Resetting...'
              : 'Reset selected sport'}
          </button>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        <label className="block text-sm text-muted-foreground">
          <span className="mb-2 block font-medium text-foreground">Sport</span>
          <select
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
            data-testid="root-admin-sport-overrides-sport"
            onChange={(event) => setOverrideSport(event.target.value as SyncSport)}
            value={overrideSport}
          >
            {ALL_SYNC_SPORT_OPTIONS.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </select>
        </label>

        {ingestionConfigQuery.isLoading || !overrideDraft || !ingestionDraft ? (
          <p className="mt-4 text-sm text-muted-foreground">
            Loading sport override configuration...
          </p>
        ) : ingestionConfigQuery.isError ? (
          <p className="mt-4 text-sm text-rose-700">
            {extractAdminErrorMessage(
              ingestionConfigQuery.error,
              'We could not load ingestion schedule configuration right now.',
            )}
          </p>
        ) : (
          <>
            <div className="mt-4 space-y-3">
              {INGESTION_POLICY_FIELDS.map((field) => (
                <label
                  className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-background px-4 py-3 text-sm"
                  key={field.key}
                >
                  <span className="font-medium text-foreground">{field.label}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground">
                      Global: {ingestionDraft[field.key].enabled ? 'On' : 'Off'}
                    </span>
                    <input
                      checked={overrideDraft[field.key]}
                      data-testid={`root-admin-sport-overrides-${field.key}`}
                      onChange={(event) =>
                        setOverrideDraft((current) =>
                          current
                            ? {
                                ...current,
                                [field.key]: event.target.checked,
                              }
                            : current,
                        )}
                      type="checkbox"
                    />
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-sport-overrides-save"
                disabled={sportOverrideMutation.isPending || !overrideDraft}
                onClick={() =>
                  overrideDraft &&
                  sportOverrideMutation.mutate({
                    sport: overrideSport,
                    draft: overrideDraft,
                  })}
                type="button"
              >
                {sportOverrideMutation.isPending
                  ? 'Saving...'
                  : 'Save sport override'}
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
