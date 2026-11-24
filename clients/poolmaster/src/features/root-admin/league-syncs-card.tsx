import { enumLabel } from '@poolmaster/shared/display-strings';
import { ProviderSyncKind } from '@poolmaster/shared/domain';
import {
  Button,
  QueryState,
  SectionCard,
  SectionRow,
  SectionRows,
  showToast,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { syncLeagueEvents } from '@/lib/api';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { lastRunText, syncModeText } from './league-syncs-text';
import { SyncHealthChip } from './sync-health-chip';
import { useSportLeagueSyncsQuery } from './use-sport-league-page';

const logger = getLogger().child({ feature: 'root-admin-league-page' });

/**
 * The Events tab's Syncs card (#1866): one row per sync that feeds the league's events, with its
 * health, last and next run. The event list offers Sync now; the field and live scores syncs
 * gain theirs with #1835.
 */
export function LeagueSyncsCard({ isSynced, sportLeagueId }: { isSynced: boolean; sportLeagueId: string }) {
  const preferences = useDisplayPreferences();
  const syncsQuery = useSportLeagueSyncsQuery(sportLeagueId);
  const syncNow = useInvalidatingMutation({
    mutationFn: async () => {
      const response = await syncLeagueEvents({ path: { sportLeagueId }, body: {} });
      if (!response.data?.job) throwApiError(response.error, 'Sync now response is missing data.');
      return response.data.job;
    },
    invalidates: [QueryKeys.rootAdmin.manageSport.leagueSyncs(sportLeagueId)],
    onSuccess: () => showToast({ title: 'Event list sync queued', tone: 'success' }),
    onError: (error) => {
      logger.warn({ action: 'leaguePage.syncNow.failed', data: { sportLeagueId }, err: error }, 'Sync now was refused');
      showToast({ title: extractErrorMessage(error, { fallback: 'We could not queue the sync right now.' }), tone: 'danger' });
    },
  });

  return (
    <SectionCard headingLevel={3} testId="root-admin-league-syncs" title="Syncs">
      <QueryState
        error={extractErrorMessage(syncsQuery.error, { fallback: 'We could not load the syncs right now.' })}
        loading="Loading syncs..."
        query={syncsQuery}
        size="inline"
        testId="root-admin-league-syncs-state"
      >
        {(syncs) => (
          <SectionRows>
            {syncs.map((sync) => (
              <SectionRow
                actions={sync.kind === ProviderSyncKind.EVENTS && isSynced ? (
                  <Button
                    data-testid="root-admin-league-sync-now"
                    disabled={syncNow.isPending}
                    onClick={() => syncNow.mutate()}
                    size="sm"
                    variant="secondary"
                  >
                    Sync now
                  </Button>
                ) : undefined}
                aside={<SyncHealthChip health={sync.health} />}
                facts={lastRunText(sync, preferences)}
                key={sync.kind}
                name={enumLabel('ProviderSyncKind', sync.kind)}
                note={syncModeText(sync)}
                testId={`root-admin-league-sync-${sync.kind}`}
              />
            ))}
          </SectionRows>
        )}
      </QueryState>
    </SectionCard>
  );
}
