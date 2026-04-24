import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminGetIngestionSchedule,
  adminResetIngestionSchedule,
  adminUpdateIngestionSchedule,
} from '@/lib/api';
import {
  cloneIngestionConfig,
  extractAdminErrorMessage,
  INGESTION_POLICY_FIELDS,
  toPositiveNumber,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './root-admin-sync-config-utils';

type IngestionEditableField =
  | 'enabled'
  | 'intervalMinutes'
  | 'intervalSeconds'
  | 'lookaheadDays'
  | 'leadDaysBeforeStart';

export function RootAdminIngestionSchedulePage() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<IngestionScheduleConfig | null>(null);

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

    setDraft(cloneIngestionConfig(ingestionConfigQuery.data));
  }, [ingestionConfigQuery.data]);

  const ingestionConfigMutation = useMutation({
    mutationFn: async (nextDraft: IngestionScheduleConfig) => {
      const response = await adminUpdateIngestionSchedule({
        body: {
          healthCheck: nextDraft.healthCheck,
          eventSchedule: nextDraft.eventSchedule,
          eventParticipants: nextDraft.eventParticipants,
          participantRankings: nextDraft.participantRankings,
          eventLiveScores: nextDraft.eventLiveScores,
          eventResults: nextDraft.eventResults,
        },
      });

      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setDraft(cloneIngestionConfig(data));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
      });
    },
  });

  const resetIngestionConfigMutation = useMutation({
    mutationFn: async () => {
      const response = await adminResetIngestionSchedule();
      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: async (data) => {
      setDraft(cloneIngestionConfig(data));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'ingestion-config'],
      });
    },
  });

  function updateDraftValue(
    key: IngestionPolicyKey,
    field: IngestionEditableField,
    value: boolean | string,
  ) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      const currentPolicy = current[key];
      const nextValue = typeof value === 'boolean' ? value : toPositiveNumber(value);

      return {
        ...current,
        [key]: {
          ...currentPolicy,
          [field]: nextValue,
        },
      };
    });
  }

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-ingestion-schedule-page"
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
              Global Ingestion Schedule
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Control the default cadence and lifecycle windows that scheduled
              ingestion uses across sports before per-sport overrides apply.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={resetIngestionConfigMutation.isPending}
            onClick={() => resetIngestionConfigMutation.mutate()}
            type="button"
          >
            {resetIngestionConfigMutation.isPending
              ? 'Resetting...'
              : 'Reset ingestion schedule'}
          </button>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {ingestionConfigQuery.isLoading || !draft ? (
          <p className="text-sm text-muted-foreground">
            Loading ingestion schedule configuration...
          </p>
        ) : ingestionConfigQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractAdminErrorMessage(
              ingestionConfigQuery.error,
              'We could not load ingestion schedule configuration right now.',
            )}
          </p>
        ) : (
          <>
            <div className="space-y-3">
              {INGESTION_POLICY_FIELDS.map((field) => {
                const extraKey = 'extraKey' in field ? field.extraKey : undefined;
                const extraLabel =
                  'extraLabel' in field ? field.extraLabel : undefined;

                return (
                  <div
                    className="rounded-2xl border border-border bg-background p-4"
                    key={field.key}
                  >
                    <div className="grid gap-3 md:grid-cols-4">
                      <label className="text-sm text-muted-foreground">
                        <span className="mb-2 block font-medium text-foreground">
                          {field.label}
                        </span>
                        <div className="flex h-[52px] items-center justify-between rounded-2xl border border-border bg-card px-4">
                          <span className="text-sm text-foreground">Enabled</span>
                          <input
                            checked={draft[field.key].enabled}
                            data-testid={`root-admin-ingestion-page-${field.key}-enabled`}
                            onChange={(event) =>
                              updateDraftValue(
                                field.key,
                                'enabled',
                                event.target.checked,
                              )}
                            type="checkbox"
                          />
                        </div>
                      </label>
                      <label className="text-sm text-muted-foreground">
                        <span className="mb-2 block font-medium text-foreground">
                          {field.intervalLabel}
                        </span>
                        <input
                          className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                          data-testid={`root-admin-ingestion-page-${field.key}-${field.intervalKey}`}
                          onChange={(event) =>
                            updateDraftValue(
                              field.key,
                              field.intervalKey as IngestionEditableField,
                              event.target.value,
                            )}
                          type="number"
                          value={draft[field.key][field.intervalKey] ?? ''}
                        />
                      </label>
                      {extraKey ? (
                        <label className="text-sm text-muted-foreground">
                          <span className="mb-2 block font-medium text-foreground">
                            {extraLabel}
                          </span>
                          <input
                            className="w-full rounded-2xl border border-border bg-card px-4 py-3 text-sm text-foreground"
                            data-testid={`root-admin-ingestion-page-${field.key}-${extraKey}`}
                            onChange={(event) =>
                              updateDraftValue(
                                field.key,
                                extraKey as IngestionEditableField,
                                event.target.value,
                              )}
                            type="number"
                            value={draft[field.key][extraKey] ?? ''}
                          />
                        </label>
                      ) : (
                        <div />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-ingestion-page-save"
                disabled={ingestionConfigMutation.isPending}
                onClick={() => draft && ingestionConfigMutation.mutate(draft)}
                type="button"
              >
                {ingestionConfigMutation.isPending
                  ? 'Saving...'
                  : 'Save ingestion schedule'}
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
