import { enumLabel } from '@poolmaster/shared/display-strings';
import { ProviderSyncKind, SportLeagueSyncHealth, type EventSyncKind } from '@poolmaster/shared/domain';
import { refreshEventParticipants, submitEventSync, type SportEventDto, type SportEventOverviewDto } from '@/lib/api';
import {
  Button,
  LoadingState,
  SectionCard,
  SectionRow,
  SectionRows,
  showToast,
  useDisplayPreferences,
} from '@/features/shared/ui';
import { extractErrorMessage, throwApiError } from '@/lib/errors';
import { getLogger } from '@/lib/logger';
import { useInvalidatingMutation } from '@/lib/mutation-hooks';
import { QueryKeys } from '@/lib/query-keys';
import { lastRunText, syncModeText } from './league-syncs-text';
import { SyncHealthChip } from './sync-health-chip';
import { fieldWriteKeys } from './use-sport-event';

const logger = getLogger().child({ feature: 'root-admin-event-page' });

/** Queues one run of the event's field or live scores sync, as its provider's own. */
async function queueEventSync(event: SportEventDto, kind: EventSyncKind): Promise<void> {
  if (kind === ProviderSyncKind.FIELD) {
    const response = await refreshEventParticipants({ path: { eventId: event.id } });
    if (!response.data?.syncRuns) throwApiError(response.error, 'Field sync response is missing data.');
    return;
  }
  const response = await submitEventSync({ path: { eventId: event.id }, body: { kinds: [ProviderSyncKind.SCORES] } });
  if (!response.data) throwApiError(response.error, 'Live scores sync response is missing data.');
}

/**
 * One tab's Syncs section on the Event page (#1890): the event's own field or live scores sync,
 * with its health, last and next run, and Sync now while a provider syncs it. Read from the
 * page's overview, which re-reads once a queued run is written.
 */
export function EventSyncsCard({
  event,
  kind,
  overview,
}: {
  event: SportEventDto;
  kind: EventSyncKind;
  overview: SportEventOverviewDto | undefined;
}) {
  const preferences = useDisplayPreferences();
  const sync = overview?.syncs.find((candidate) => candidate.kind === kind);
  const syncNow = useInvalidatingMutation({
    mutationFn: () => queueEventSync(event, kind),
    invalidates: [QueryKeys.rootAdmin.manageSport.eventOverview(event.id), ...(kind === ProviderSyncKind.FIELD ? fieldWriteKeys(event.id) : [])],
    onSuccess: () => showToast({ title: `${enumLabel('ProviderSyncKind', kind)} sync queued`, tone: 'success' }),
    onError: (error) => {
      logger.warn({ action: 'eventPage.syncNow.failed', data: { eventId: event.id, kind }, err: error }, 'Sync now was refused');
      showToast({ title: extractErrorMessage(error, { fallback: 'We could not queue the sync right now.' }), tone: 'danger' });
    },
  });

  return (
    <SectionCard headingLevel={3} testId={`root-admin-event-syncs-${kind}`} title="Syncs">
      {sync === undefined ? (
        <LoadingState body="Loading syncs..." size="inline" />
      ) : (
        <SectionRows>
          <SectionRow
            actions={sync.health === SportLeagueSyncHealth.OFF ? undefined : (
              <Button
                data-testid={`root-admin-event-sync-now-${kind}`}
                disabled={syncNow.isPending}
                onClick={() => syncNow.mutate()}
                size="sm"
                variant="secondary"
              >
                Sync now
              </Button>
            )}
            aside={<SyncHealthChip health={sync.health} />}
            facts={lastRunText(sync, preferences)}
            name={enumLabel('ProviderSyncKind', kind)}
            note={syncModeText(sync)}
            testId={`root-admin-event-sync-${kind}`}
          />
        </SectionRows>
      )}
    </SectionCard>
  );
}
