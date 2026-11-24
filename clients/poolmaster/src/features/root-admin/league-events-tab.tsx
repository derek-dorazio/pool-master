import { useMemo, useState } from 'react';
import { DataGrid, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { defaultSeasonId, leagueEventColumns } from './league-event-columns';
import { useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { useLeaguePage } from './league-page-context';
import { LeagueSyncsCard } from './league-syncs-card';
import { buildSportEventPath } from './manage-navigation';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { useSportLeagueEventOverviewsQuery } from './use-sport-league-page';

/**
 * The League page's Events tab (#1866): the syncs that feed the league's events, then every event
 * of every Season in one grid, opening on the current Season. A row opens its event page.
 */
export function LeagueEventsTab() {
  const { isSynced, sportLeague } = useLeaguePage();
  const eventsQuery = useSportLeagueEventOverviewsQuery(sportLeague.id);
  const [openSyncRunId, setOpenSyncRunId] = useState<string | null>(null);
  const seasonsQuery = useSportLeagueSeasonsQuery(sportLeague.id);
  const events = eventsQuery.data;
  const columns = useMemo(
    () => leagueEventColumns({
      initialSeasonId: defaultSeasonId(events ?? [], sportLeague.currentSeasonId),
      onOpenSyncRun: setOpenSyncRunId,
      seasons: seasonsQuery.data ?? [],
      sportUrlSegment: sportLeague.sportUrlSegment,
    }),
    [events, seasonsQuery.data, sportLeague.currentSeasonId, sportLeague.sportUrlSegment],
  );

  return (
    <div className="space-y-6" data-testid="root-admin-league-events-tab">
      <LeagueSyncsCard isSynced={isSynced} sportLeagueId={sportLeague.id} />
      <SectionCard
        headingLevel={3}
        padded
        testId="root-admin-league-events"
        title="Events"
        trailing={events ? <span data-testid="root-admin-league-events-count">{plural(events.length, 'event')}</span> : undefined}
      >
        <QueryState
          error={extractErrorMessage(eventsQuery.error, { fallback: 'We could not load the events right now.' })}
          loading="Loading events..."
          query={eventsQuery}
          testId="root-admin-league-events-state"
        >
          {(loaded) => (
            <DataGrid
              columns={columns}
              data={loaded}
              emptyMessage="No events yet."
              filterTestIdPrefix="root-admin-league-events-filter"
              getRowId={(event) => event.id}
              getRowLink={(event) => buildSportEventPath(sportLeague.sportUrlSegment, event.id)}
              rowTestId={(event) => `root-admin-league-event-${event.id}`}
              tableTestId="root-admin-league-events-table"
              urlKey="events"
            />
          )}
        </QueryState>
      </SectionCard>
      {openSyncRunId === null ? null : <SyncRunByIdDialog onClose={() => setOpenSyncRunId(null)} syncRunId={openSyncRunId} />}
    </div>
  );
}
