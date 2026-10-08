import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPollIntervals, resetPollIntervals, updatePollIntervals } from '@/lib/api';
import {
  AdminConfigPage,
  Button,
  FormEditorSection,
  FormField,
  Input,
  LinkButton,
} from '@/features/shared/ui';
import {
  clonePollConfig,
  extractAdminErrorMessage,
  toPositiveNumber,
  type PollIntervalConfig,
} from './root-admin-sync-config-utils';
import { QueryKeys } from '@/lib/query-keys';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { throwApiError } from '@/lib/errors';

const POLL_INTERVAL_FIELDS = [
  ['standings', 'Standings'],
  ['draft', 'Draft'],
  ['contestStatus', 'Contest status'],
  ['notifications', 'Notifications'],
  ['default', 'Default'],
] as const satisfies ReadonlyArray<
  readonly [keyof PollIntervalConfig, string]
>;

export function RootAdminPollIntervalsPage() {
  const [draft, setDraft] = useState<PollIntervalConfig | null>(null);

  const pollConfigQuery = useQuery({
    queryKey: QueryKeys.rootAdmin.pollConfig,
    queryFn: async (): Promise<PollIntervalConfig> => {
      const response = await getPollIntervals();
      if (!response.data) {
        throwApiError(response.error, 'Poll interval response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });
  const configSource = useMemo(
    () => pollConfigQuery.data ? clonePollConfig(pollConfigQuery.data) : null,
    [pollConfigQuery.data],
  );

  useEffect(() => {
    if (!configSource || draft) {
      return;
    }

    setDraft(configSource);
  }, [configSource, draft]);

  const pollConfigMutation = useInvalidatingMutation({
    mutationFn: async (nextDraft: PollIntervalConfig) => {
      const response = await updatePollIntervals({
        body: nextDraft,
      });

      if (!response.data) {
        throwApiError(response.error, 'Poll interval update response is missing data.');
      }

      return response.data;
    },
    onSuccess: (data) => {
      setDraft(clonePollConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.pollConfig, QueryKeys.rootAdmin.settings],
  });

  const resetPollConfigMutation = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await resetPollIntervals();
      if (!response.data) {
        throwApiError(response.error, 'Poll interval reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: (data) => {
      setDraft(clonePollConfig(data));
    },
    invalidates: [QueryKeys.rootAdmin.pollConfig, QueryKeys.rootAdmin.settings],
  });

  function updateDraftValue(key: keyof PollIntervalConfig, value: string) {
    setDraft((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        [key]: toPositiveNumber(value),
      };
    });
  }

  const pageState = pollConfigQuery.isError
      ? 'error'
      : pollConfigQuery.isLoading || !draft
        ? 'loading'
        : 'ready';

  return (
    <AdminConfigPage
      errorBody={extractAdminErrorMessage(
        pollConfigQuery.error,
        'We could not load poll interval configuration right now.',
      )}
      header={{
        actions: (
          <>
            <LinkButton to="/manage/sync-config" variant="secondary">
              Back to Sync Configuration
            </LinkButton>
            <Button
              disabled={resetPollConfigMutation.isPending}
              onClick={() => resetPollConfigMutation.mutate()}
              type="button"
              variant="secondary"
            >
              {resetPollConfigMutation.isPending ? 'Resetting...' : 'Reset poll intervals'}
            </Button>
          </>
        ),
        description: 'How often the app refreshes standings, drafts, notifications, and contests.',
        title: 'Poll Intervals',
      }}
      loadingBody="Loading poll interval configuration..."
      state={pageState}
      testId="root-admin-poll-intervals-page"
    >
      {draft ? (
        <FormEditorSection
          footer={(
            <Button
              data-testid="root-admin-poll-page-save"
              disabled={pollConfigMutation.isPending}
              onClick={() => pollConfigMutation.mutate(draft)}
              type="button"
            >
              {pollConfigMutation.isPending ? 'Saving...' : 'Save poll intervals'}
            </Button>
          )}
          title="Poll interval values"
        >
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {POLL_INTERVAL_FIELDS.map(([key, label]) => (
              <FormField key={key} label={label}>
                <Input
                  data-testid={`root-admin-poll-page-${key}`}
                  onChange={(event) => updateDraftValue(key, event.target.value)}
                  type="number"
                  value={draft[key]}
                />
              </FormField>
            ))}
          </div>
        </FormEditorSection>
      ) : null}
    </AdminConfigPage>
  );
}
