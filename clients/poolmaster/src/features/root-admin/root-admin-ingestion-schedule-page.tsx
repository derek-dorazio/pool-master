import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getIngestionSchedule, resetIngestionSchedule, updateIngestionSchedule } from '@/lib/api';
import {
  Alert,
  AsyncPage,
  Button,
  Checkbox,
  FormField,
  FormEditorSection,
  Input,
  Tile,
} from '@/features/shared/ui';
import {
  cloneIngestionConfig,
  INGESTION_POLICY_FIELDS,
  toPositiveNumber,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './root-admin-sync-config-utils';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { ManagePageIntro } from './manage-page-intro';

type IngestionEditableField =
  | 'enabled'
  | 'intervalMinutes'
  | 'intervalSeconds'
  | 'lookaheadDays';

export function RootAdminIngestionSchedulePage() {
  const [draft, setDraft] = useState<IngestionScheduleConfig | null>(null);

  const ingestionConfigQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.ingestionConfig,
    queryFn: async (): Promise<IngestionScheduleConfig> => {
      const response = await getIngestionSchedule();
      if (!response.data) {
        throwApiError(response.error, 'Ingestion schedule response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
  const configSource = useMemo(
    () => ingestionConfigQuery.data ? cloneIngestionConfig(ingestionConfigQuery.data) : null,
    [ingestionConfigQuery.data],
  );

  useEffect(() => {
    if (!configSource || draft) {
      return;
    }

    setDraft(configSource);
  }, [configSource, draft]);

  const ingestionConfigMutation = useInvalidatingMutation({
    mutationFn: async (nextDraft: IngestionScheduleConfig) => {
      const response = await updateIngestionSchedule({
        body: {
          healthCheck: nextDraft.healthCheck,
          eventParticipants: nextDraft.eventParticipants,
          eventLiveScores: nextDraft.eventLiveScores,
        },
      });

      if (!response.data) {
        throwApiError(response.error, 'Ingestion schedule update response is missing data.');
      }

      return response.data;
    },
    onSuccess: (data) => {
      setDraft(cloneIngestionConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig, QueryKeys.rootAdmin.settings],
  });

  const resetIngestionConfigMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await resetIngestionSchedule();
      if (!response.data) {
        throwApiError(response.error, 'Ingestion schedule reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: (data) => {
      setDraft(cloneIngestionConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig, QueryKeys.rootAdmin.settings],
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
    <AsyncPage
      errorBody={extractErrorMessage(ingestionConfigQuery.error, { fallback: 'We could not load ingestion schedule configuration right now.' })}
      loadingBody="Loading ingestion schedule configuration..."
      state={pageState}
      testId="root-admin-ingestion-schedule-page"
    >
      <ManagePageIntro
        actions={(
          <Button
            disabled={resetIngestionConfigMutation.isPending}
            onClick={() => {
              ingestionConfigMutation.reset();
              resetIngestionConfigMutation.mutate();
            }}
            type="button"
            variant="secondary"
          >
            {resetIngestionConfigMutation.isPending
              ? 'Resetting...'
              : 'Reset ingestion schedule'}
          </Button>
        )}
      >
        Control the default cadence and lifecycle windows that scheduled ingestion uses across
        sports before per-sport overrides apply.
      </ManagePageIntro>
      {ingestionConfigMutation.isError || resetIngestionConfigMutation.isError ? (
        <Alert
          className="mb-4"
          data-testid="root-admin-ingestion-page-error"
          tone="danger"
        >
          {ingestionConfigMutation.isError
            ? extractErrorMessage(ingestionConfigMutation.error, {
                fallback: 'We could not save the ingestion schedule.',
              })
            : extractErrorMessage(resetIngestionConfigMutation.error, {
                fallback: 'We could not reset the ingestion schedule.',
              })}
        </Alert>
      ) : null}
      {draft ? (
        <FormEditorSection
          footer={(
            <Button
              data-testid="root-admin-ingestion-page-save"
              disabled={ingestionConfigMutation.isPending}
              onClick={() => {
                resetIngestionConfigMutation.reset();
                ingestionConfigMutation.mutate(draft);
              }}
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
                          <Checkbox
                            checked={draft[field.key].enabled}
                            data-testid={`root-admin-ingestion-page-${field.key}-enabled`}
                            onChange={(event) =>
                              updateDraftValue(
                                field.key,
                                'enabled',
                                event.target.checked,
                              )}
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
    </AsyncPage>
  );
}
