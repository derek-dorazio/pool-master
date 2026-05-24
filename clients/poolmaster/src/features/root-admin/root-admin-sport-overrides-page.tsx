import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  adminGetIngestionSchedule,
  adminResetSportIngestionOverride,
  adminSetSportIngestionOverride,
} from '@/lib/api';
import {
  Button,
  Checkbox,
  ErrorState,
  FormField,
  LoadingState,
  PageHeader,
  Select,
  Tile,
} from '@/features/shared/ui';
import { ALL_SYNC_SPORT_OPTIONS, type SyncSport } from './root-admin-sync-utils';
import {
  buildSportOverrideDraft,
  cloneIngestionConfig,
  extractAdminErrorMessage,
  INGESTION_POLICY_FIELDS,
  type IngestionPolicyKey,
  type IngestionScheduleConfig,
} from './root-admin-sync-config-utils';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';

export function RootAdminSportOverridesPage() {
  const [overrideSport, setOverrideSport] = useState<SyncSport>('GOLF');
  const [ingestionDraft, setIngestionDraft] =
    useState<IngestionScheduleConfig | null>(null);
  const [overrideDraft, setOverrideDraft] = useState<
    Record<IngestionPolicyKey, boolean> | null
  >(null);

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
  const configSource = useMemo(
    () => ingestionConfigQuery.data ? cloneIngestionConfig(ingestionConfigQuery.data) : null,
    [ingestionConfigQuery.data],
  );

  useEffect(() => {
    if (!configSource) {
      return;
    }

    setIngestionDraft(configSource);
    setOverrideDraft(buildSportOverrideDraft(configSource, overrideSport));
  }, [configSource, overrideSport]);

  const sportOverrideMutation = useInvalidatingMutation({
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
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig],
  });

  const resetSportOverrideMutation = useInvalidatingMutation({
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
    },
    invalidates: [QueryKeys.rootAdmin.ingestionConfig],
  });

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-sport-overrides-page"
    >
      <PageHeader
        actions={(
          <Button
            disabled={resetSportOverrideMutation.isPending}
            onClick={() => resetSportOverrideMutation.mutate(overrideSport)}
            type="button"
            variant="secondary"
          >
            {resetSportOverrideMutation.isPending
              ? 'Resetting...'
              : 'Reset selected sport'}
          </Button>
        )}
        breadcrumbs={[
          { href: '/manage/sync-config', label: 'Sync Configuration' },
          { label: 'Sport Ingestion Overrides' },
        ]}
        description="Enable or disable automated feed policies for an individual sport without changing the global cadence for every other sport."
        title="Sport Ingestion Overrides"
      />

      <Tile>
        <FormField label="Sport">
          <Select
            data-testid="root-admin-sport-overrides-sport"
            onChange={(event) => setOverrideSport(event.target.value as SyncSport)}
            value={overrideSport}
          >
            {ALL_SYNC_SPORT_OPTIONS.map((sport) => (
              <option key={sport} value={sport}>
                {sport}
              </option>
            ))}
          </Select>
        </FormField>

        {ingestionConfigQuery.isLoading || !overrideDraft || !ingestionDraft ? (
          <div className="mt-4">
            <LoadingState
              body="Loading sport override configuration..."
              testId="root-admin-sport-overrides-loading"
            />
          </div>
        ) : ingestionConfigQuery.isError ? (
          <div className="mt-4">
            <ErrorState
              body={extractAdminErrorMessage(
                ingestionConfigQuery.error,
                'We could not load ingestion schedule configuration right now.',
              )}
              testId="root-admin-sport-overrides-error"
              title="Sport overrides unavailable"
            />
          </div>
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
                    <Checkbox
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
                    />
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <Button
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
              </Button>
            </div>
          </>
        )}
      </Tile>
    </section>
  );
}
