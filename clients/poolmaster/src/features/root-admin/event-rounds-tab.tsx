import { ProviderSyncKind } from '@poolmaster/shared/domain';
import { useMemo } from 'react';
import { DataGrid, LinkButton, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useEventPage } from './event-page-context';
import { eventRoundColumns, type EventRoundRow } from './event-round-columns';
import { EventSyncsCard } from './event-syncs-card';
import { buildSportEventPath } from './manage-navigation';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { useEventRoundLabel } from './use-sport-catalog';
import { useSportEventRoundsQuery } from './use-sport-event';

/**
 * The Event page's Rounds and matches tab (#1890): the event's live scores and results sync,
 * its rounds in one grid, then how its scoring family enters and corrects results.
 */
export function EventRoundsTab() {
  const { event, isSynced, overview } = useEventPage();
  const roundsQuery = useSportEventRoundsQuery(event.id);
  const roundLabel = useEventRoundLabel(event);
  const columns = useMemo(() => eventRoundColumns(), []);
  const { ResultsPanel } = getScoringFamilyAdminUi(event);
  const rows = useMemo<EventRoundRow[] | undefined>(
    () => roundsQuery.data?.map((round, _index, rounds) => ({ ...round, label: roundLabel(round.roundNumber, rounds.length) })),
    [roundLabel, roundsQuery.data],
  );

  return (
    <div className="space-y-6" data-testid="root-admin-event-rounds-tab">
      <EventSyncsCard event={event} kind={ProviderSyncKind.SCORES} overview={overview} />
      <SectionCard
        headingLevel={3}
        padded
        testId="root-admin-event-rounds"
        title="Rounds"
        trailing={isSynced ? undefined : (
          <LinkButton
            data-testid="root-admin-sport-event-rounds-edit"
            size="sm"
            to={`${buildSportEventPath(event.sport, event.id)}/schedule`}
            variant="secondary"
          >
            Edit schedule
          </LinkButton>
        )}
      >
        <QueryState
          error={extractErrorMessage(roundsQuery.error, { fallback: 'We could not load the rounds right now.' })}
          loading="Loading rounds..."
          query={{ data: rows, isError: roundsQuery.isError, refetch: roundsQuery.refetch }}
          testId="root-admin-event-rounds-state"
        >
          {(loaded) => (
            <DataGrid
              columns={columns}
              data={loaded}
              emptyMessage="No rounds yet."
              filterTestIdPrefix="root-admin-event-rounds-filter"
              getRowId={(round) => round.id}
              rowTestId={(round) => `root-admin-event-round-${String(round.roundNumber)}`}
              tableTestId="root-admin-event-rounds-table"
              urlKey="rounds"
            />
          )}
        </QueryState>
      </SectionCard>
      <ResultsPanel event={event} />
    </div>
  );
}
