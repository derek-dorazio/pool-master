import { enumLabel } from '@poolmaster/shared/display-strings';
import { useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { PageHeader, PageTabs, Text, type PageLinkTab } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import { isSyncedLeague, LEAGUE_PAGE_TABS, type LeaguePageContext } from './league-page-context';
import { buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { OnOffChip } from './on-off-chip';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { providerText } from './sport-league-overview-columns';
import { SyncHealthChip } from './sync-health-chip';
import { SportLeaguePage } from './sport-league-page';
import { PageSettingsButton } from './page-settings-button';
import { SportLeagueSettingsDialog } from './sport-league-settings-dialog';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { failedJobCount, useActivity } from './use-activity';
import { useManagedSport } from './use-managed-sport';
import { useSportLeagueOverviewsQuery } from './use-sport-league-overviews';

/**
 * /manage/sports/:sport/leagues/:leagueId, a sport league's own page (#1866): the breadcrumb back
 * to Sports, the header with the league's chips and provider, its ⚙, then the tab row
 * over the open tab. The Activity tab counts the league's failed jobs once they are read.
 */
export function LeaguePageLayout() {
  return (
    <SportLeaguePage testId="root-admin-league-page">
      {(sportLeague) => <LoadedLeaguePage sportLeague={sportLeague} />}
    </SportLeaguePage>
  );
}

function LoadedLeaguePage({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport, sportUrlSegment } = useManagedSport();
  const { pathname } = useLocation();
  const overviewsQuery = useSportLeagueOverviewsQuery();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSyncRunId, setOpenSyncRunId] = useState<string | null>(null);
  const basePath = buildSportLeaguePath(sportUrlSegment, sportLeague.id);
  const openSegment = pathname.slice(basePath.length + 1).split('/')[0];
  // Held here, not in the Activity tab, so the jobs read stay with the page and its tab keeps its
  // count; it re-reads only while the tab is open.
  const activity = useActivity({ sportLeagueId: sportLeague.id }, { poll: openSegment === 'activity' });
  const failedCount = activity.query.data === undefined ? 0 : failedJobCount(activity.query.data);

  const overviews = overviewsQuery.data ?? [];
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const overview = overviews.find((candidate) => candidate.id === sportLeague.id);
  const isSynced = isSyncedLeague(sportLeague, overview);
  const items: PageLinkTab[] = LEAGUE_PAGE_TABS.map((tab) => ({
    ...(tab.segment === 'activity' && failedCount > 0
      ? { count: failedCount, countHint: 'Jobs that failed in the Activity grid\'s Started window, the past day unless you widen it' }
      : {}),
    isActive: openSegment === tab.segment,
    label: tab.label,
    testId: `root-admin-league-tab-${tab.segment}`,
    to: `${basePath}/${tab.segment}`,
  }));
  const context: LeaguePageContext = { sportLeague, overview, isSynced, activity };

  return (
    <div className="space-y-6">
      <PageHeader
        actions={<PageSettingsButton name={sportLeague.name} onClick={() => setSettingsOpen(true)} testId="root-admin-league-settings" />}
        breadcrumbs={[{ href: SPORTS_PATH, label: 'Sports' }, { label: enumLabel('Sport', sport) }]}
        meta={overview === undefined ? undefined : (
          <span className="inline-flex flex-wrap items-center gap-2" data-testid="root-admin-league-facts">
            <SyncHealthChip health={overview.syncHealth} />
            <SportLeagueIssueChips onOpenSyncRun={setOpenSyncRunId} overview={overview} />
            <Text tone="muted">
              {providerText(overview)}
            </Text>
          </span>
        )}
        status={<OnOffChip on={sportLeague.isActive} />}
        tabs={<PageTabs aria-label="League views" items={items} variant="link" />}
        testId="root-admin-league-header"
        title={sportLeague.name}
      />
      <Outlet context={context} />
      {settingsOpen ? <SportLeagueSettingsDialog onClose={() => setSettingsOpen(false)} sportLeagueId={sportLeague.id} /> : null}
      {openSyncRunId === null ? null : <SyncRunByIdDialog onClose={() => setOpenSyncRunId(null)} syncRunId={openSyncRunId} />}
    </div>
  );
}
