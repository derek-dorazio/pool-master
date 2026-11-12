import { useState } from 'react';
import { resetIngestionSchedule, updateIngestionSchedule } from '@/lib/api';
import {
  Notice,
  Button,
  Checkbox,
  FormEditorSection,
  FormField,
  HelpTip,
  Input,
  PageHeader,
  QueryState,
  SectionCard,
  Tile,
} from '@/features/shared/ui';
import {
  cloneIngestionConfig,
  INGESTION_POLICY_FIELDS,
  toPositiveNumber,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './ingestion-settings-utils';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { useIngestionScheduleQuery } from './use-ingestion-schedule-query';

type IngestionEditableField =
  | 'enabled'
  | 'intervalMinutes'
  | 'intervalSeconds'
  | 'lookaheadDays';

export function RootAdminIngestionSchedulePage() {
  // Null until the admin edits, saves or resets: the form shows the loaded schedule until then,
  // and a refetch never overwrites an edit (rules/react-ui-rules.md §5 Server Data Form-State Hazard).
  const [edits, setEdits] = useState<IngestionScheduleConfig | null>(null);

  const ingestionConfigQuery = useIngestionScheduleQuery();
  const configSource = ingestionConfigQuery.data ?? null;
  const draft = edits ?? configSource;

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
      setEdits(cloneIngestionConfig(data));
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
      setEdits(cloneIngestionConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig, QueryKeys.rootAdmin.settings],
  });

  function updateDraftValue(
    key: IngestionPolicyKey,
    field: IngestionEditableField,
    value: boolean | string,
  ) {
    setEdits((edited) => {
      const current = edited ?? configSource;
      if (!current) {
        return edited;
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
    <section className="space-y-6" data-testid="root-admin-ingestion-schedule-page">
      <PageHeader
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
        testId="root-admin-ingestion-schedule-header"
        title="Global Ingestion Schedule"
        titleAside={(
          <HelpTip label="About the ingestion schedule" testId="root-admin-ingestion-schedule-help">
            Control the default cadence and lifecycle windows that scheduled ingestion uses across
            sports before per-sport overrides apply.
          </HelpTip>
        )}
      />
      {ingestionConfigMutation.isError || resetIngestionConfigMutation.isError ? (
        <Notice
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
        </Notice>
      ) : null}
      <QueryState
        error={extractErrorMessage(ingestionConfigQuery.error, { fallback: 'We could not load ingestion schedule configuration right now.' })}
        loading="Loading ingestion schedule configuration..."
        query={{
          data: draft ?? undefined,
          isError: ingestionConfigQuery.isError,
          refetch: ingestionConfigQuery.refetch,
        }}
        size="tile"
        testId="root-admin-ingestion-schedule"
      >
        {(loadedDraft) => (
        <FormEditorSection
          footer={(
            <Button
              data-testid="root-admin-ingestion-page-save"
              disabled={ingestionConfigMutation.isPending}
              onClick={() => {
                resetIngestionConfigMutation.reset();
                ingestionConfigMutation.mutate(loadedDraft);
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
                <SectionCard headingLevel={3} key={field.key} padded title={field.label}>
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="space-y-2">
                      <Tile
                        padding="sm"
                        radius="md"
                        variant="default"
                      >
                        <label className="flex h-5 items-center justify-between gap-3 text-sm text-foreground">
                          <span>Enabled</span>
                          <Checkbox
                            checked={loadedDraft[field.key].enabled}
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
                            field.intervalKey,
                            event.target.value,
                          )}
                        type="number"
                        value={loadedDraft[field.key][field.intervalKey] ?? ''}
                      />
                    </FormField>
                    {extraKey ? (
                      <FormField label={extraLabel}>
                        <Input
                          data-testid={`root-admin-ingestion-page-${field.key}-${extraKey}`}
                          onChange={(event) =>
                            updateDraftValue(
                              field.key,
                              extraKey,
                              event.target.value,
                            )}
                          type="number"
                          value={loadedDraft[field.key][extraKey] ?? ''}
                        />
                      </FormField>
                    ) : (
                      <div />
                    )}
                  </div>
                </SectionCard>
              );
            })}
          </div>
        </FormEditorSection>
        )}
      </QueryState>
    </section>
  );
}
