import { eventPlaysMatches, ProviderSyncKind } from '@poolmaster/shared/domain';
import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { useEventPage } from './event-page-context';
import { eventRoundColumns, type EventRoundRow } from './event-round-columns';
import { EventRoundDialog } from './event-round-dialog';
import { EventMatchesCard } from './event-matches-card';
import { EventSyncsCard } from './event-syncs-card';
import { getScoringFamilyAdminUi } from './scoring-family-admin';
import { roundLabels } from '@poolmaster/shared/display-strings';
import { useSportEventRoundsQuery } from './use-sport-event';

/**
 * The Event page's Rounds and matches tab (#1890): the event's live scores and results sync,
 * its rounds in one grid, each round's ⤢ opening its dialog, its matches where it plays any, then,
 * on an event no feed syncs, how its scoring family enters and corrects results. A synced
 * event's results are the feed's.
 */
export function EventRoundsTab() {
  const { event, isSynced, overview } = useEventPage();
  const roundsQuery = useSportEventRoundsQuery(event.id);
  const [openRoundId, setOpenRoundId] = useState<string | null>(null);
  const columns = useMemo(() => eventRoundColumns(), []);
  const { ResultsPanel } = getScoringFamilyAdminUi(event);
  const rows = useMemo<EventRoundRow[] | undefined>(
    () => {
      if (roundsQuery.data === undefined) return undefined;
      const nameOfRound = roundLabels(roundsQuery.data);
      return roundsQuery.data.map((round) => ({ ...round, label: nameOfRound(round.roundNumber) }));
    },
    [roundsQuery.data],
  );

  return (
    <div className="space-y-6" data-testid="root-admin-event-rounds-tab">
      <EventSyncsCard event={event} kind={ProviderSyncKind.SCORES} overview={overview} />
      <SectionCard headingLevel={3} padded testId="root-admin-event-rounds" title="Rounds">
        <QueryState
          error={extractErrorMessage(roundsQuery.error, { fallback: 'We could not load the rounds right now.' })}
          loading="Loading rounds..."
          query={{ data: rows, isError: roundsQuery.isError, refetch: roundsQuery.refetch }}
          testId="root-admin-event-rounds-state"
        >
          {(loaded) => {
            const openRound = loaded.find((round) => round.id === openRoundId);
            return (
              <>
                <DataGrid
                  columns={columns}
                  data={loaded}
                  emptyMessage="No rounds yet."
                  filterTestIdPrefix="root-admin-event-rounds-filter"
                  getRowId={(round) => round.id}
                  openRowDialog={(round) => setOpenRoundId(round.id)}
                  rowTestId={(round) => `root-admin-event-round-${String(round.roundNumber)}`}
                  tableTestId="root-admin-event-rounds-table"
                  urlKey="rounds"
                />
                {openRound === undefined ? null : (
                  <EventRoundDialog event={event} isSynced={isSynced} key={openRound.id} onClose={() => setOpenRoundId(null)} row={openRound} />
                )}
              </>
            );
          }}
        </QueryState>
      </SectionCard>
      {eventPlaysMatches(event) ? <EventMatchesCard event={event} /> : null}
      {isSynced || ResultsPanel === null ? null : <ResultsPanel event={event} />}
    </div>
  );
}
