import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminGetPollIntervals,
  adminResetPollIntervals,
  adminUpdatePollIntervals,
} from '@/lib/api';
import {
  Button,
  ErrorState,
  FormField,
  Input,
  LinkButton,
  LoadingState,
  PageHeader,
  Tile,
} from '@/features/shared/ui';
import {
  clonePollConfig,
  extractAdminErrorMessage,
  toPositiveNumber,
  type PollIntervalConfig,
} from './root-admin-sync-config-utils';

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
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<PollIntervalConfig | null>(null);

  const pollConfigQuery = useQuery({
    queryKey: ['poolmaster', 'root-admin', 'poll-config'],
    queryFn: async (): Promise<PollIntervalConfig> => {
      const response = await adminGetPollIntervals();
      if (!response.data) {
        throw response.error ?? new Error('Poll interval response is missing data.');
      }
      return response.data;
    },
    retry: false,
  });

  useEffect(() => {
    if (!pollConfigQuery.data) {
      return;
    }

    setDraft(clonePollConfig(pollConfigQuery.data));
  }, [pollConfigQuery.data]);

  const pollConfigMutation = useMutation({
    mutationFn: async (nextDraft: PollIntervalConfig) => {
      const response = await adminUpdatePollIntervals({
        body: nextDraft,
      });

      if (!response.data) {
        throw response.error ?? new Error('Poll interval update response is missing data.');
      }

      return response.data;
    },
    onSuccess: async (data) => {
      setDraft(clonePollConfig(data));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'poll-config'],
      });
    },
  });

  const resetPollConfigMutation = useMutation({
    mutationFn: async () => {
      const response = await adminResetPollIntervals();
      if (!response.data) {
        throw response.error ?? new Error('Poll interval reset response is missing data.');
      }
      return response.data;
    },
    onSuccess: async (data) => {
      setDraft(clonePollConfig(data));
      await queryClient.invalidateQueries({
        queryKey: ['poolmaster', 'root-admin', 'poll-config'],
      });
    },
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

  return (
    <section
      className="space-y-6"
      data-testid="root-admin-poll-intervals-page"
    >
      <PageHeader
        actions={(
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
        )}
        description="Client-facing refresh guidance stored durably in runtime config. Update these intervals when the webapp should poll more or less aggressively for standings, draft, notification, and contest state changes."
        title="Poll Intervals"
      />

      {pollConfigQuery.isLoading || !draft ? (
        <LoadingState body="Loading poll interval configuration..." />
      ) : pollConfigQuery.isError ? (
        <ErrorState
          body={extractAdminErrorMessage(
            pollConfigQuery.error,
            'We could not load poll interval configuration right now.',
          )}
        />
      ) : (
        <Tile>
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

          <div className="mt-5 flex justify-end">
            <Button
              data-testid="root-admin-poll-page-save"
              disabled={pollConfigMutation.isPending}
              onClick={() => draft && pollConfigMutation.mutate(draft)}
              type="button"
            >
              {pollConfigMutation.isPending ? 'Saving...' : 'Save poll intervals'}
            </Button>
          </div>
        </Tile>
      )}
    </section>
  );
}
