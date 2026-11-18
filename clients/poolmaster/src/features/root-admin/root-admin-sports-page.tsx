import { useMemo, useState } from 'react';
import { DataGrid, PageHeader, PageTabs, QueryState } from '@/features/shared/ui';
import { extractErrorMessage } from '@/lib/errors';
import { buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { sportLeagueOverviewColumns } from './sport-league-overview-columns';
import { sportsCountLine } from './sport-league-overview-text';
import { SportLeagueSettingsDialog } from './sport-league-settings-dialog';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { useProvidersQuery } from './use-providers-query';
import { useSportLeagueOverviewsQuery } from './use-sport-league-overviews';

/**
 * /manage/sports, the root admin's landing page (#1848): one grid of every sport league, grouped
 * by sport with each Clutch Card under its parent, showing what is healthy, what needs attention
 * and when it plays. A row opens the sport league; its ⚙ opens the league's settings here, and an
 * Issues chip's sync run opens here too.
 */
export function RootAdminSportsPage() {
  const overviewsQuery = useSportLeagueOverviewsQuery();
  const providersQuery = useProvidersQuery();
  const [settingsLeagueId, setSettingsLeagueId] = useState<string | null>(null);
  const [openSyncRunId, setOpenSyncRunId] = useState<string | null>(null);

  const overviews = overviewsQuery.data;
  const providers = providersQuery.data;
  const columns = useMemo(() => {
    const leagueNames = new Map((overviews ?? []).map((overview) => [overview.id, overview.name]));
    const providerNames = new Map((providers ?? []).map((provider) => [provider.providerId, provider.providerName]));
    return sportLeagueOverviewColumns({
      nameOfLeague: (sportLeagueId) => leagueNames.get(sportLeagueId),
      nameOfProvider: (providerId) => providerNames.get(providerId) ?? providerId,
      onOpenSettings: setSettingsLeagueId,
      onOpenSyncRun: setOpenSyncRunId,
    });
  }, [overviews, providers]);

  return (
    <section className="space-y-6" data-testid="root-admin-sports-page">
      <PageHeader
        meta={overviews ? <span data-testid="root-admin-sports-counts">{sportsCountLine(overviews)}</span> : undefined}
        tabs={(
          <PageTabs
            aria-label="Sports views"
            items={[{ isActive: true, label: 'Sport leagues', testId: 'root-admin-sports-tab-leagues', to: SPORTS_PATH }]}
            variant="link"
          />
        )}
        testId="root-admin-sports-header"
        title="Sports"
      />
      <QueryState
        error={extractErrorMessage(overviewsQuery.error, { fallback: 'We could not load the sport leagues right now.' })}
        loading="Loading sport leagues..."
        query={overviewsQuery}
        testId="root-admin-sports"
      >
        {(loaded) => (
          <DataGrid
            columns={columns}
            data={loaded}
            emptyMessage="No sport leagues yet."
            filterTestIdPrefix="root-admin-sports-filter"
            getRowId={(overview) => overview.id}
            getRowLink={(overview) => buildSportLeaguePath(overview.sport, overview.id)}
            rowTestId={(overview) => `root-admin-sports-row-${overview.id}`}
            tableTestId="root-admin-sports-table"
          />
        )}
      </QueryState>
      {settingsLeagueId === null ? null : (
        <SportLeagueSettingsDialog onClose={() => setSettingsLeagueId(null)} sportLeagueId={settingsLeagueId} />
      )}
      {openSyncRunId === null ? null : (
        <SyncRunByIdDialog onClose={() => setOpenSyncRunId(null)} syncRunId={openSyncRunId} />
      )}
    </section>
  );
}
