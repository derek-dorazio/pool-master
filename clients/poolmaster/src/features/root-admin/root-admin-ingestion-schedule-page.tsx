import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminGetIngestionSchedule,
  adminResetIngestionSchedule,
  adminUpdateIngestionSchedule,
} from '@/lib/api';
import {
  AdminConfigPage,
  Button,
  FormField,
  FormEditorSection,
  Input,
  Tile,
} from '@/features/shared/ui';
import {
  cloneIngestionConfig,
  extractAdminErrorMessage,
  INGESTION_POLICY_FIELDS,
  toPositiveNumber,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './root-admin-sync-config-utils';
import { QueryKeys } from '@/lib/query-keys';
import { createMutationHook } from '@/lib/mutation-hooks';

type IngestionEditableField =
  | 'enabled'
  | 'intervalMinutes'
  | 'intervalSeconds'
  | 'lookaheadDays'
  | 'leadDaysBeforeStart';

export function RootAdminIngestionSchedulePage() {
  const [draft, setDraft] = useState<IngestionScheduleConfig | null>(null);

  const ingestionConfigQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.ingestionConfig,
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

  const ingestionConfigMutation = createMutationHook({
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
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig],
  });

  const resetIngestionConfigMutation = createMutationHook({
    mutationFn: async () => {
      const response = await adminResetIngestionSchedule();
      if (!response.data) {
        throw response.error ?? new Error('Ingestion schedule reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: async (data) => {
      setDraft(cloneIngestionConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig],
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

  const pageState = ingestionConfigQuery.isError
    ? 'error'
    : ingestionConfigQuery.isLoading || !draft
      ? 'loading'
      : 'ready';

  return (
    <AdminConfigPage
      errorBody={extractAdminErrorMessage(
        ingestionConfigQuery.error,
        'We could not load ingestion schedule configuration right now.',
      )}
      header={{
        actions: (
          <Button
            disabled={resetIngestionConfigMutation.isPending}
            onClick={() => resetIngestionConfigMutation.mutate()}
            type="button"
            variant="secondary"
          >
            {resetIngestionConfigMutation.isPending
              ? 'Resetting...'
              : 'Reset ingestion schedule'}
          </Button>
        ),
        breadcrumbs: [
          { href: '/manage/sync-config', label: 'Sync Configuration' },
          { label: 'Global Ingestion Schedule' },
        ],
        description:
          'Control the default cadence and lifecycle windows that scheduled ingestion uses across sports before per-sport overrides apply.',
        title: 'Global Ingestion Schedule',
      }}
      loadingBody="Loading ingestion schedule configuration..."
      state={pageState}
      testId="root-admin-ingestion-schedule-page"
    >
      {draft ? (
        <FormEditorSection
          footer={(
            <Button
              data-testid="root-admin-ingestion-page-save"
              disabled={ingestionConfigMutation.isPending}
              onClick={() => ingestionConfigMutation.mutate(draft)}
              type="button"
            >
              {ingestionConfigMutation.isPending
                ? 'Saving...'
                : 'Save ingestion schedule'}
            </Button>
          )}
          title="Schedule policies"
        >
          <div className="space-y-3">
            {INGESTION_POLICY_FIELDS.map((field) => {
              const extraKey = 'extraKey' in field ? field.extraKey : undefined;
              const extraLabel =
                'extraLabel' in field ? field.extraLabel : undefined;

              return (
                <Tile key={field.key} padding="sm" radius="lg" variant="subtle">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2">
                      <div className="text-sm font-medium">{field.label}</div>
                      <Tile
                        padding="sm"
                        radius="md"
                        variant="default"
                      >
                        <label className="flex h-5 items-center justify-between gap-3 text-sm text-foreground">
                          <span>Enabled</span>
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
                        </label>
                      </Tile>
                    </div>
                    <FormField label={field.intervalLabel}>
                      <Input
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
                    </FormField>
                    {extraKey ? (
                      <FormField label={extraLabel}>
                        <Input
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
                      </FormField>
                    ) : (
                      <div />
                    )}
                  </div>
                </Tile>
              );
            })}
          </div>
        </FormEditorSection>
      ) : null}
    </AdminConfigPage>
  );
}
