import { getSportDefinition, SportEventStatus } from '@poolmaster/shared/domain';
import { Settings } from 'lucide-react';
import { useState } from 'react';
import { Navigate, Outlet, useLocation, useParams } from 'react-router';
import {
  Button,
  formatDateDisplay,
  PageHeader,
  PageTabs,
  QueryState,
  StatusBadge,
  Text,
  useDisplayPreferences,
  type PageLinkTab,
} from '@/features/shared/ui';
import type { SportEventDto, SportEventOverviewDto } from '@/lib/api';
import { extractErrorMessage } from '@/lib/errors';
import { eventPageTabs, type EventPageContext } from './event-page-context';
import { EventReleaseChecksDialog } from './event-release-checks-dialog';
import { EventSettingsDialog } from './event-settings-dialog';
import { isSyncedLeague } from './league-page-context';
import { useManageBreadcrumbOverride } from './manage-breadcrumb-context';
import { buildSportEventPath, buildSportLeaguePath, SPORTS_PATH } from './manage-navigation';
import { formatSportEventStatus, sportEventStatusTone } from './sport-admin-utils';
import { SportLeagueIssueChips } from './sport-league-issue-chips';
import { SyncHealthChip } from './sync-health-chip';
import { SyncRunByIdDialog } from './sync-run-by-id-dialog';
import { failedJobCount, useActivity } from './use-activity';
import { useSportEventOverviewQuery } from './use-event-page';
import { useSportLeaguesQuery } from './use-sport-catalog';
import { useSportEventQuery } from './use-sport-event';
import { useSportLeagueOverviewsQuery } from './use-sport-league-overviews';

/**
 * /manage/sports/:sport/events/:eventId, an event's own page (#1890), laid out as the League
 * page: the breadcrumb back to its league, the header with its status, sync health, issues and
 * release chips and its ⚙, then the tab row over the open tab. It opens on Field.
 */
export function EventPageLayout() {
  const { eventId = '' } = useParams<{ eventId: string }>();
  const eventQuery = useSportEventQuery(eventId);
  useManageBreadcrumbOverride(eventId || undefined, eventQuery.data?.name);

  return (
    <section data-testid="root-admin-event-page">
      <QueryState
        error={extractErrorMessage(eventQuery.error, { fallback: 'We could not load this event right now.' })}
        loading={'Loading event...'}
        query={eventQuery}
        size="tile"
        testId="root-admin-event-page-state"
      >
        {(event) => <LoadedEventPage event={event} />}
      </QueryState>
    </section>
  );
}

/** A Release chip shows only while the event is a draft: held when the last automatic try held it. */
function releaseChipText(event: Pick<SportEventDto, 'lastAutoReleaseCheck'>): string {
  return event.lastAutoReleaseCheck?.outcome === 'HELD' ? 'Release held ⤢' : 'Release ⤢';
}

/** The header's issue chips, less Release, which the Release chip beside them covers. */
function headerIssues(overview: SportEventOverviewDto): SportEventOverviewDto['issues'] {
  return overview.issues.filter((issue) => issue.type !== 'RELEASE');
}

function LoadedEventPage({ event }: { event: SportEventDto }) {
  const { pathname } = useLocation();
  const preferences = useDisplayPreferences();
  const overviewQuery = useSportEventOverviewQuery(event.id);
  const leaguesQuery = useSportLeaguesQuery(event.sport);
  const overviewsQuery = useSportLeagueOverviewsQuery();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [releaseOpen, setReleaseOpen] = useState(false);
  const [openSyncRunId, setOpenSyncRunId] = useState<string | null>(null);
  const basePath = buildSportEventPath(event.sportUrlSegment, event.id);
  const openSegment = pathname.slice(basePath.length + 1).split('/')[0];
  // Held here, not in the Activity tab, so the tab keeps its failed count; it re-reads only while open.
  const activity = useActivity({ sportEventId: event.id }, { poll: openSegment === 'activity' });
  const failedCount = activity.query.data === undefined ? 0 : failedJobCount(activity.query.data);

  // poolmaster-allow-list-lookup: sport leagues are reference data, a few dozen rows that do not grow with history
  const sportLeague = leaguesQuery.data?.find((candidate) => candidate.id === event.sportLeagueId);
  // poolmaster-allow-list-lookup: the same few dozen sport leagues, for whether a provider syncs this one
  const leagueOverview = overviewsQuery.data?.find((candidate) => candidate.id === event.sportLeagueId);
  const isSynced = sportLeague === undefined && leagueOverview === undefined
    ? event.providerSynced
    : isSyncedLeague(sportLeague ?? { selectedProviderMapping: null }, leagueOverview);
  const overview = overviewQuery.data;

  // A synced event has no Tools tab, so its old link lands on Field.
  if (openSegment === 'tools' && isSynced) {
    return <Navigate replace to={`${basePath}/field`} />;
  }

  const items: PageLinkTab[] = eventPageTabs(isSynced).map((tab) => ({
    ...(tab.segment === 'activity' && failedCount > 0
      ? { count: failedCount, countHint: 'Jobs that failed in the Activity grid\'s Started window, the past day unless you widen it' }
      : {}),
    isActive: openSegment === tab.segment,
    label: tab.label,
    testId: `root-admin-event-tab-${tab.segment}`,
    to: `${basePath}/${tab.segment}`,
  }));
  const context: EventPageContext = { event, overview, sportLeague, isSynced, activity };
  const dates = event.endDate === null
    ? formatDateDisplay(event.startDate, preferences)
    : `${formatDateDisplay(event.startDate, preferences)} to ${formatDateDisplay(event.endDate, preferences)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        actions={(
          <Button
            aria-label={`${event.name} settings`}
            data-testid="root-admin-event-settings"
            onClick={() => setSettingsOpen(true)}
            size="sm"
            variant="icon"
          >
            <Settings aria-hidden size={16} />
          </Button>
        )}
        breadcrumbs={[
          { href: SPORTS_PATH, label: 'Sports' },
          { label: getSportDefinition(event.sport).name },
          ...(sportLeague === undefined ? [] : [{ href: buildSportLeaguePath(event.sportUrlSegment, sportLeague.id), label: sportLeague.name }]),
          { label: event.name },
        ]}
        meta={(
          <span className="inline-flex flex-wrap items-center gap-2" data-testid="root-admin-event-facts">
            {overview === undefined ? null : <SyncHealthChip health={overview.syncHealth} />}
            {overview === undefined || headerIssues(overview).length === 0 ? null : (
              <SportLeagueIssueChips
                onOpenSyncRun={setOpenSyncRunId}
                overview={{ id: event.id, issues: headerIssues(overview), name: event.name, sportUrlSegment: event.sportUrlSegment }}
              />
            )}
            {event.status === SportEventStatus.DRAFT ? (
              <Button
                data-testid="root-admin-event-release-chip"
                onClick={() => setReleaseOpen(true)}
                size="xs"
                variant={event.lastAutoReleaseCheck?.outcome === 'HELD' ? 'danger' : 'secondary'}
              >
                {releaseChipText(event)}
              </Button>
            ) : null}
            <Text data-testid="root-admin-event-dates" tone="muted">
              {[dates, event.venue].filter((part): part is string => part !== null && part !== '').join(' · ')}
            </Text>
          </span>
        )}
        status={(
          <StatusBadge tone={sportEventStatusTone(event.status)}>
            {formatSportEventStatus(event.status)}
          </StatusBadge>
        )}
        tabs={<PageTabs aria-label="Event views" items={items} variant="link" />}
        testId="root-admin-event-header"
        title={event.name}
      />
      <Outlet context={context} />
      {settingsOpen ? (
        <EventSettingsDialog event={event} onClose={() => setSettingsOpen(false)} overview={overview} sportLeague={sportLeague} />
      ) : null}
      {releaseOpen ? <EventReleaseChecksDialog event={event} onClose={() => setReleaseOpen(false)} overview={overview} /> : null}
      {openSyncRunId === null ? null : <SyncRunByIdDialog onClose={() => setOpenSyncRunId(null)} syncRunId={openSyncRunId} />}
    </div>
  );
}
