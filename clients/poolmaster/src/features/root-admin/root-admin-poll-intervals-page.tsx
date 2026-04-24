import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  adminGetPollIntervals,
  adminResetPollIntervals,
  adminUpdatePollIntervals,
} from '@/lib/api';
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
              Poll Intervals
            </h1>
            <p className="mt-3 max-w-3xl text-sm text-muted-foreground">
              Client-facing refresh guidance stored durably in runtime config.
              Update these intervals when the webapp should poll more or less
              aggressively for standings, draft, notification, and contest state
              changes.
            </p>
          </div>
          <button
            className="inline-flex items-center justify-center rounded-full border border-border px-4 py-2 text-sm font-medium text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            disabled={resetPollConfigMutation.isPending}
            onClick={() => resetPollConfigMutation.mutate()}
            type="button"
          >
            {resetPollConfigMutation.isPending ? 'Resetting...' : 'Reset poll intervals'}
          </button>
        </div>
      </div>

      <section className="rounded-[2rem] border border-border bg-card p-6">
        {pollConfigQuery.isLoading || !draft ? (
          <p className="text-sm text-muted-foreground">
            Loading poll interval configuration...
          </p>
        ) : pollConfigQuery.isError ? (
          <p className="text-sm text-rose-700">
            {extractAdminErrorMessage(
              pollConfigQuery.error,
              'We could not load poll interval configuration right now.',
            )}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {POLL_INTERVAL_FIELDS.map(([key, label]) => (
                <label className="text-sm text-muted-foreground" key={key}>
                  <span className="mb-2 block font-medium text-foreground">
                    {label}
                  </span>
                  <input
                    className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-sm text-foreground"
                    data-testid={`root-admin-poll-page-${key}`}
                    onChange={(event) => updateDraftValue(key, event.target.value)}
                    type="number"
                    value={draft[key]}
                  />
                </label>
              ))}
            </div>

            <div className="mt-5 flex justify-end">
              <button
                className="rounded-2xl bg-foreground px-5 py-3 text-sm font-medium text-background transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
                data-testid="root-admin-poll-page-save"
                disabled={pollConfigMutation.isPending}
                onClick={() => draft && pollConfigMutation.mutate(draft)}
                type="button"
              >
                {pollConfigMutation.isPending ? 'Saving...' : 'Save poll intervals'}
              </button>
            </div>
          </>
        )}
      </section>
    </section>
  );
}
