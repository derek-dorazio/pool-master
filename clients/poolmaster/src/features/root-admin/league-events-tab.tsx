import { useMemo, useState } from 'react';
import { DataGrid, LinkButton, QueryState, SectionCard } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { plural } from '@/lib/plural';
import { defaultSeasonId, leagueEventColumns } from './league-event-columns';
import { useSportLeagueSeasonsQuery } from '@/features/contests/use-sport-league-seasons';
import { useLeaguePage } from './league-page-context';
import { LeagueSyncsCard } from './league-syncs-card';
import { buildSportEventPath, buildTestEventCreatePath } from './manage-navigation';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { useSportLeagueEventOverviewsQuery } from './use-sport-league-page';

/**
 * The League page's Events tab (#1866): the syncs that feed the league's events, then every event
 * of every Season in one grid, opening on the current Season. A row opens its event page; New test
 * event makes one on a test slot (#2004).
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
        trailing={(
          <div className="flex items-center gap-3">
            {events ? <span data-testid="root-admin-league-events-count">{plural(events.length, 'event')}</span> : null}
            <LinkButton
              data-testid="root-admin-league-events-new-test-event"
              size="sm"
              to={buildTestEventCreatePath(sportLeague.sportUrlSegment, sportLeague.id)}
              variant="secondary"
            >
              New test event
            </LinkButton>
          </div>
        )}
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
