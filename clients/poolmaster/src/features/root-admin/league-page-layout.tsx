import { getSportDefinition } from '@poolmaster/shared/domain';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { Button, LinkButton, PageHeader, PageTabs, Text, type PageLinkTab } from '@/features/shared/ui';
import type { SportLeagueDto } from '@/lib/api';
import { isSyncedLeague, leaguePageTabs, type LeaguePageContext } from './league-page-context';
import { buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { OnOffChip } from './on-off-chip';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { providerText } from './sport-league-overview-columns';
import { SyncHealthChip } from './sync-health-chip';
import { SportLeaguePage } from './sport-league-page';
import { SportLeagueSettingsDialog } from './sport-league-settings-dialog';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { useManagedSport } from './use-managed-sport';
import { useProvidersQuery } from './use-providers-query';
import { useSportLeagueOverviewsQuery } from './use-sport-league-overviews';

/**
 * /manage/sports/:sport/leagues/:leagueId, a sport league's own page (#1866): the breadcrumb back
 * to Sports, the header with the league's chips, provider and Clutch Cards, its ⚙, then the tab row
 * over the open tab.
 */
export function LeaguePageLayout() {
  return (
    <SportLeaguePage testId="root-admin-league-page">
      {(sportLeague) => <LoadedLeaguePage sportLeague={sportLeague} />}
    </SportLeaguePage>
  );
}

function LoadedLeaguePage({ sportLeague }: { sportLeague: SportLeagueDto }) {
  const { sport } = useManagedSport();
  const { pathname } = useLocation();
  const overviewsQuery = useSportLeagueOverviewsQuery();
  const providersQuery = useProvidersQuery();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSyncRunId, setOpenSyncRunId] = useState<string | null>(null);

  const overviews = overviewsQuery.data ?? [];
  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const overview = overviews.find((candidate) => candidate.id === sportLeague.id);
  // poolmaster-allow-list-lookup: the same few dozen sport leagues, for this league's Clutch Cards
  const clutchCards = overviews.filter((candidate) => candidate.parentSportLeagueId === sportLeague.id);
  const isSynced = isSyncedLeague(sportLeague, overview);
  const basePath = buildSportLeaguePath(sport, sportLeague.id);
  const tabs = leaguePageTabs(isSynced);
  const openSegment = pathname.slice(basePath.length + 1).split('/')[0];
  // A synced league has no Tools tab, so its old link lands on Events.
  if (openSegment === 'tools' && overview !== undefined && isSynced) {
    return <Navigate replace to={`${basePath}/events`} />;
  }

  const items: PageLinkTab[] = tabs.map((tab) => ({
    isActive: openSegment === tab.segment,
    label: tab.label,
    testId: `root-admin-league-tab-${tab.segment}`,
    to: `${basePath}/${tab.segment}`,
  }));
  const providerNames = new Map((providersQuery.data ?? []).map((provider) => [provider.providerId, provider.providerName]));
  const context: LeaguePageContext = { sportLeague, overview, isSynced };

  return (
    <div className="space-y-6">
      <PageHeader
        actions={(
          <Button
            aria-label={`${sportLeague.name} settings`}
            data-testid="root-admin-league-settings"
            onClick={() => setSettingsOpen(true)}
            size="sm"
            variant="icon"
          >
            <Settings aria-hidden size={16} />
          </Button>
        )}
        breadcrumbs={[{ href: SPORTS_PATH, label: 'Sports' }, { label: getSportDefinition(sport).name }]}
        meta={overview === undefined ? undefined : (
          <span className="inline-flex flex-wrap items-center gap-2" data-testid="root-admin-league-facts">
            <SyncHealthChip health={overview.syncHealth} />
            <SportLeagueIssueChips onOpenSyncRun={setOpenSyncRunId} overview={overview} />
            <Text tone="muted">
              {/* poolmaster-allow-list-lookup: the parent league's name, from the sport leagues already read */}
              {providerText(overview, (id) => overviews.find((candidate) => candidate.id === id)?.name, (id) => providerNames.get(id) ?? id)}
            </Text>
            {clutchCards.map((clutchCard) => (
              <LinkButton
                data-testid={`root-admin-league-clutch-card-${clutchCard.id}`}
                key={clutchCard.id}
                size="sm"
                to={buildSportLeaguePath(clutchCard.sport, clutchCard.id)}
                variant="link"
              >
                {clutchCard.name}
              </LinkButton>
            ))}
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
