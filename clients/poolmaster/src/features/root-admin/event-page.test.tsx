import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityJobDto,
  SportEventContestDto,
  SportEventOverviewDto,
  SportLeagueOverviewDto,
} from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { EventActivityTab } from './event-activity-tab';
import { EventContestsTab } from './event-contests-tab';
import { EventFieldTab } from './event-field-tab';
import { EventPageLayout } from './event-page-layout';
import { EventRoundsTab } from './event-rounds-tab';
import { EventToolsTab } from './event-tools-tab';
import {
  passingReleaseChecks,
  pricingProfilesFixture,
  sportEventFixture,
  sportEventRoundFixture,
  sportLeagueFixture,
} from './sport-test-fixtures';

// The root admin's Event page (#1890): the header and its chips, the tab set, the ⚙ and Release
// checks dialogs, and the Contests, Activity and Rounds and matches tabs' grids.

const {
  getEventMock,
  getEventOverviewMock,
  listActivityMock,
  listEventContestsMock,
  listEventParticipantsMock,
  listEventRoundsMock,
  listPricingProfilesMock,
  listSportLeagueOverviewsMock,
  listSportLeaguesMock,
  listTierProfilesMock,
  mockLogger,
  rebuildEventLeaderboardsMock,
  refreshEventParticipantsMock,
  releaseEventMock,
  submitEventSyncMock,
  transitionEventMock,
  updateEventMock,
  updateEventRoundsMock,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return {
    getEventMock: vi.fn(),
    getEventOverviewMock: vi.fn(),
    listActivityMock: vi.fn(),
    listEventContestsMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    listEventRoundsMock: vi.fn(),
    listPricingProfilesMock: vi.fn(),
    listSportLeagueOverviewsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listTierProfilesMock: vi.fn(),
    mockLogger: logger,
    rebuildEventLeaderboardsMock: vi.fn(),
    refreshEventParticipantsMock: vi.fn(),
    releaseEventMock: vi.fn(),
    submitEventSyncMock: vi.fn(),
    transitionEventMock: vi.fn(),
    updateEventMock: vi.fn(),
    updateEventRoundsMock: vi.fn(),
  };
});

bindApiMocks({
  getEvent: getEventMock,
  getEventOverview: getEventOverviewMock,
  listActivity: listActivityMock,
  listEventContests: listEventContestsMock,
  listEventParticipants: listEventParticipantsMock,
  listEventRounds: listEventRoundsMock,
  listPricingProfiles: listPricingProfilesMock,
  listSportLeagueOverviews: listSportLeagueOverviewsMock,
  listSportLeagues: listSportLeaguesMock,
  listTierProfiles: listTierProfilesMock,
  rebuildEventLeaderboards: rebuildEventLeaderboardsMock,
  refreshEventParticipants: refreshEventParticipantsMock,
  releaseEvent: releaseEventMock,
  submitEventSync: submitEventSyncMock,
  transitionEvent: transitionEventMock,
  updateEvent: updateEventMock,
  updateEventRounds: updateEventRoundsMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const PGA = sportLeagueFixture({ id: 'league-1', name: 'PGA Tour' });

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'tour-1',
    externalId: 'feed-401',
    providerId: 'balldontlie',
    name: 'Rolling Weekend Invitational',
    venue: 'Mock Golf Club',
    location: 'Augusta, GA',
    startDate: '2026-05-07T12:00:00.000Z',
    endDate: '2026-05-10T22:00:00.000Z',
    status: 'SCHEDULED',
    rounds: 4,
    eventYear: 2026,
    sportLeagueId: 'league-1',
    syncScope: 'NONE',
    autoLifecycleEnabled: true,
    allowedTransitions: ['IN_PROGRESS', 'CANCELLED'],
    ...overrides,
  });
}

function eventOverview(overrides: Partial<SportEventOverviewDto> = {}): SportEventOverviewDto {
  return {
    syncHealth: 'OFF',
    syncs: [
      { kind: 'FIELD', health: 'OFF', mode: 'SCHEDULE', lastRun: null, nextRunAt: null },
      { kind: 'SCORES', health: 'OFF', mode: 'SCHEDULE', lastRun: null, nextRunAt: null },
    ],
    issues: [],
    releaseMode: 'MANUAL',
    releaseAt: null,
    releaseAtKind: null,
    tierOrderBasis: 'ODDS',
    tierOrderCoversField: true,
    fieldFeed: [],
    eventPageSlug: null,
    ...overrides,
  };
}

function leagueOverview(overrides: Partial<SportLeagueOverviewDto> = {}): SportLeagueOverviewDto {
  return {
    id: 'league-1',
    sport: 'GOLF',
    name: 'PGA Tour',
    parentSportLeagueId: null,
    kind: 'REAL',
    providerId: null,
    isActive: true,
    syncHealth: 'OFF',
    issues: [],
    season: null,
    nextEventStartsAt: null,
    eventCount: 1,
    ...overrides,
  };
}

function contest(overrides: Partial<SportEventContestDto> = {}): SportEventContestDto {
  return {
    id: '00000000-0000-4000-8000-0000000000c1',
    name: 'Office Majors Pool',
    status: 'OPEN',
    leagueId: '00000000-0000-4000-8000-0000000000l1',
    leagueCode: 'HOOPS',
    leagueName: 'Office Hoops',
    contestTemplateId: null,
    contestTemplateName: null,
    entryCount: 12,
    createdAt: '2026-04-20T12:00:00.000Z',
    ...overrides,
  };
}

function job(overrides: Partial<ActivityJobDto> = {}): ActivityJobDto {
  const at = new Date(Date.now() - 60_000).toISOString();
  return {
    id: '00000000-0000-4000-8000-00000000a001',
    type: 'SYNC_EVENT_FIELD',
    kind: 'SYNC',
    status: 'SUCCEEDED',
    sportLeagueId: 'league-1',
    sportEventId: 'tour-1',
    sportLeague: { id: 'league-1', name: 'PGA Tour' },
    sportEvent: { id: 'tour-1', name: 'Rolling Weekend Invitational' },
    attempts: 1,
    runAt: at,
    createdAt: at,
    completedAt: at,
    lastError: null,
    trigger: 'SCHEDULE',
    startedBy: null,
    startedAt: at,
    durationSeconds: 8,
    changedCount: 3,
    errorType: null,
    result: null,
    syncRunIds: [],
    ...overrides,
  } as ActivityJobDto;
}

function refusal(code: string, message: string, status = 422) {
  return { error: { error: { code, message } }, response: { status } };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderEventPage(path: string, {
  event = tournament(),
  overview = eventOverview(),
  synced = false,
}: { event?: ReturnType<typeof tournament>; overview?: SportEventOverviewDto; synced?: boolean } = {}) {
  getEventMock.mockResolvedValue({ data: { event } });
  getEventOverviewMock.mockResolvedValue({ data: { overview } });
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [synced ? { ...PGA, eventSyncProviderId: 'balldontlie' } : PGA] } });
  listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: [leagueOverview(synced ? { providerId: 'balldontlie' } : {})] } });
  listTierProfilesMock.mockResolvedValue({ data: { tierProfiles: [{ id: PGA.tierProfileId, name: 'Six tiers', tiers: [], sportLeagueCount: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] } });
  listPricingProfilesMock.mockResolvedValue({ data: { pricingProfiles: pricingProfilesFixture() } });
  listActivityMock.mockResolvedValue({ data: { jobs: [] } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: [] } });
  listEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<EventPageLayout />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<Navigate replace to="field" />} index />
            <Route element={<EventFieldTab />} path="field" />
            <Route element={<EventRoundsTab />} path="rounds" />
            <Route element={<EventContestsTab />} path="contests" />
            <Route element={<EventActivityTab />} path="activity" />
            <Route element={<EventToolsTab />} path="tools" />
            <Route element={<Navigate replace to="../field" relative="path" />} path="edit" />
            <Route element={<Navigate replace to="../field" relative="path" />} path="tiers" />
            <Route element={<Navigate replace to="../rounds" relative="path" />} path="results" />
            <Route element={<Navigate replace to="../rounds" relative="path" />} path="schedule" />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tabLabels(): string[] {
  return within(screen.getByRole('navigation', { name: 'Event views' })).getAllByRole('link').map((link) => link.textContent);
}

async function openSettings() {
  await userEvent.click(await screen.findByTestId('root-admin-event-settings', {}, { timeout: 5_000 }));
  return screen.findByTestId('root-admin-event-settings-dialog');
}

async function openSettingsEdit() {
  const dialog = await openSettings();
  await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-edit'));
  return dialog;
}

describe('Event page header and tabs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('heads an event with its name, status, dates and venue and a breadcrumb to its league, and opens on Field', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1');

    // The first render loads the page's modules, which is slow on a loaded runner.
    expect(await screen.findByRole('heading', { level: 1, name: 'Rolling Weekend Invitational' }, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-event-header-status-slot')).toHaveTextContent('Scheduled');
    expect(screen.getByTestId('root-admin-event-dates')).toHaveTextContent('Mock Golf Club');
    expect(await screen.findByRole('link', { name: 'PGA Tour' })).toHaveAttribute('href', '/manage/sports/golf/leagues/league-1');
    expect(screen.getByRole('link', { name: 'Sports' })).toHaveAttribute('href', '/manage/sports');
    await waitFor(() => expect(screen.getByTestId('root-admin-event-tab-field')).toHaveAttribute('aria-current', 'page'));
  });

  it('shows Tools only on an event of a league no provider syncs', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/contests');
    listEventContestsMock.mockResolvedValue({ data: { contests: [] } });

    await screen.findByTestId('root-admin-event-header', {}, { timeout: 5_000 });
    await waitFor(() => expect(tabLabels()).toEqual(['Field', 'Rounds and matches', 'Contests', 'Activity', 'Tools']));
  });

  it('leaves Tools off a synced league\'s event and sends its old Tools link to Field', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/tools', { synced: true });

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events/tour-1/field'), { timeout: 5_000 });
    expect(tabLabels()).toEqual(['Field', 'Rounds and matches', 'Contests', 'Activity']);
  });

  it('sends the old edit and results links to Field and to Rounds and matches', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/results');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events/tour-1/rounds'), { timeout: 5_000 });
  });

  it('sends the old schedule page link to Rounds and matches, where each round\'s dialog reschedules it', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/schedule');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events/tour-1/rounds'), { timeout: 5_000 });
  });

  it('sends the old tiers page link to Field, where tiers and prices now live', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/tiers');

    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/manage/sports/golf/events/tour-1/field'), { timeout: 5_000 });
  });

  it('shows the server\'s reason in place of the page when the event cannot be loaded', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');
    getEventMock.mockResolvedValue(refusal('SPORT_EVENT_NOT_FOUND', 'Sport event tour-1 was not found.', 404));

    expect(await screen.findByText('Sport event tour-1 was not found.', {}, { timeout: 5_000 })).toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-event-settings')).not.toBeInTheDocument();
  });

  it('chips the event\'s sync health and its sync issues, leaving the release issue to the Release chip', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', {
      event: tournament({ status: 'DRAFT', lastAutoReleaseCheck: { checkedAt: '2026-05-01T10:00:00.000Z', outcome: 'HELD', failedChecks: ['TIERS_ASSIGNED'] } }),
      overview: eventOverview({
        syncHealth: 'ERROR',
        issues: [
          { type: 'SYNC', count: 1, items: [{ label: 'Field sync failed', occurredAt: '2026-05-01T09:00:00.000Z', target: { type: 'SYNC_RUN', id: 'run-1' }, syncKind: 'FIELD' }] },
          { type: 'RELEASE', count: 1, items: [{ label: 'Rolling Weekend Invitational', occurredAt: '2026-05-01T10:00:00.000Z', target: { type: 'SPORT_EVENT', id: 'tour-1' }, failedChecks: ['TIERS_ASSIGNED'] }] },
        ],
      }),
    });

    const facts = await screen.findByTestId('root-admin-event-facts', {}, { timeout: 5_000 });
    expect(await within(facts).findByText('Sync 1')).toBeInTheDocument();
    expect(within(facts).queryByText('Release 1')).not.toBeInTheDocument();
    expect(within(facts).getByTestId('root-admin-event-release-chip')).toHaveTextContent('Release held ⤢');
  });

  it('shows no Release chip once the event is released', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    await screen.findByTestId('root-admin-event-facts', {}, { timeout: 5_000 });
    expect(screen.queryByTestId('root-admin-event-release-chip')).not.toBeInTheDocument();
  });

  it('counts the event\'s failed jobs on the Activity tab and shows its jobs there, read for the event alone', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/activity');
    listActivityMock.mockResolvedValue({
      data: { jobs: [job(), job({ id: '00000000-0000-4000-8000-00000000a002', status: 'FAILED', errorType: 'RATE_LIMITED', lastError: '429', completedAt: null })] },
    });

    expect(await screen.findByTestId('activity-job-00000000-0000-4000-8000-00000000a001', {}, { timeout: 5_000 })).toBeInTheDocument();
    const [options] = listActivityMock.mock.calls[0] as [{ query: Record<string, string> }];
    expect(options.query['sportEventId']).toBe('tour-1');
    await waitFor(() => expect(screen.getByTestId('root-admin-event-tab-activity')).toHaveTextContent('Activity 1'));
  });
});

describe('Event page syncs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  const syncedOverview = eventOverview({
    syncHealth: 'OK',
    syncs: [
      { kind: 'FIELD', health: 'OK', mode: 'SCHEDULE', lastRun: { id: 'run-1', status: 'COMPLETED', createdAt: '2026-05-01T09:00:00.000Z', startedAt: '2026-05-01T09:00:00.000Z', summary: null, changedCount: 4 }, nextRunAt: null },
      { kind: 'SCORES', health: 'NOT_RUN_YET', mode: 'WEBHOOK', lastRun: null, nextRunAt: null },
    ],
  });

  it('shows the field sync on Field with its last run, and Sync now queues a field sync', async () => {
    refreshEventParticipantsMock.mockResolvedValue({ data: { syncRuns: [] } });
    renderEventPage('/manage/sports/golf/events/tour-1/field', { overview: syncedOverview, synced: true });

    const row = await screen.findByTestId('root-admin-event-sync-FIELD', {}, { timeout: 5_000 });
    expect(row).toHaveTextContent('Field');
    expect(row).toHaveTextContent('4 changed');
    await userEvent.click(within(row).getByTestId('root-admin-event-sync-now-FIELD'));

    await waitFor(() => expect(refreshEventParticipantsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'tour-1' } })));
  });

  it('shows the live scores sync on Rounds and matches, and Sync now asks the provider for the event\'s live scores by its feed id', async () => {
    submitEventSyncMock.mockResolvedValue({ data: { syncRuns: [] } });
    renderEventPage('/manage/sports/golf/events/tour-1/rounds', { overview: syncedOverview, synced: true });

    const row = await screen.findByTestId('root-admin-event-sync-SCORES', {}, { timeout: 5_000 });
    expect(row).toHaveTextContent('Follows the webhook');
    await userEvent.click(within(row).getByTestId('root-admin-event-sync-now-SCORES'));

    await waitFor(() => expect(submitEventSyncMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { sport: 'GOLF', eventId: 'feed-401' },
      body: { providerId: 'balldontlie', feeds: ['EVENTLIVESCORES'] },
    })));
  });

  it('offers no Sync now on a sync that is off', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    expect(await screen.findByTestId('root-admin-event-sync-FIELD', {}, { timeout: 5_000 })).toHaveTextContent('Not scheduled');
    expect(screen.queryByTestId('root-admin-event-sync-now-FIELD')).not.toBeInTheDocument();
  });
});

describe('Event page Rounds and matches tab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  function seedRounds() {
    listEventRoundsMock.mockResolvedValue({
      data: {
        rounds: [
          sportEventRoundFixture({ id: 'r1', sportEventId: 'tour-1', roundNumber: 1, status: 'COMPLETED', resultCount: 70, completedAt: '2026-05-07T22:00:00.000Z' }),
          sportEventRoundFixture({ id: 'r2', sportEventId: 'tour-1', roundNumber: 2, status: 'SCHEDULED', resultCount: 0, completedAt: null }),
        ],
      },
    });
  }

  async function openRound(roundNumber: number) {
    const row = await screen.findByTestId(`root-admin-event-round-${String(roundNumber)}`, {}, { timeout: 5_000 });
    await userEvent.click(within(row).getByRole('button', { name: /Open details/ }));
    return screen.findByTestId('root-admin-event-round-dialog');
  }

  it('lists each round with its start, status, results and when it settled, and the event\'s results tools on an event no provider syncs', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/rounds');
    seedRounds();

    const roundOne = await screen.findByTestId('root-admin-event-round-1', {}, { timeout: 5_000 });
    expect(roundOne).toHaveTextContent('Completed');
    expect(roundOne).toHaveTextContent('70');
    expect(screen.getByTestId('root-admin-event-round-2')).toHaveTextContent('Scheduled');
    expect(await screen.findByTestId('root-admin-golf-tournament-scores-page')).toBeInTheDocument();
  });

  it('opens a round\'s dialog with its facts, and Edit reschedules that one round, a blank end cleared', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/rounds');
    seedRounds();
    updateEventRoundsMock.mockResolvedValue({ data: { rounds: [] } });

    const dialog = await openRound(1);
    expect(within(dialog).getByTestId('root-admin-event-round-dialog-status')).toHaveTextContent('Completed');
    expect(within(dialog).getByTestId('root-admin-event-round-dialog-results')).toHaveTextContent('70');
    expect(within(dialog).getByTestId('root-admin-event-round-dialog-ends')).toHaveTextContent('Not set');
    await userEvent.click(within(dialog).getByTestId('root-admin-event-round-dialog-edit'));
    fireEvent.change(screen.getByTestId('root-admin-event-round-dialog-edit-starts'), { target: { value: '2026-05-09T12:00' } });
    await userEvent.click(screen.getByTestId('root-admin-event-round-dialog-save'));

    await waitFor(() => expect(updateEventRoundsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'tour-1' },
      body: { rounds: [{ roundNumber: 1, scheduledDate: expect.stringMatching(/^2026-05-09T/) as string, scheduledEndAt: null }] },
    })));
    expect(await screen.findByTestId('root-admin-event-round-dialog-edit')).toBeInTheDocument();
  });

  it('offers Settle again on a round with results, which after its confirm queues one rebuild of the event\'s boards', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/rounds', { synced: true });
    seedRounds();
    rebuildEventLeaderboardsMock.mockResolvedValue({ data: undefined, response: new Response(null, { status: 204 }) });

    const dialog = await openRound(1);
    await userEvent.click(within(dialog).getByTestId('root-admin-event-round-dialog-settle-again'));
    await userEvent.click(await screen.findByTestId('root-admin-event-round-dialog-settle-again-confirm'));

    await waitFor(() => expect(rebuildEventLeaderboardsMock).toHaveBeenCalledWith({ path: { eventId: 'tour-1' } }));
    expect(await screen.findByTestId('root-admin-event-round-dialog')).toBeInTheDocument();
  });

  it('offers no Settle again on a round with no results yet', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/rounds');
    seedRounds();

    const dialog = await openRound(2);
    expect(within(dialog).queryByTestId('root-admin-event-round-dialog-settle-again')).not.toBeInTheDocument();
  });

  it('on a synced event offers no rescheduling and none of the results tools, whose results are the feed\'s', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/rounds', { synced: true });
    seedRounds();

    const dialog = await openRound(2);
    expect(within(dialog).queryByTestId('root-admin-event-round-dialog-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('root-admin-golf-tournament-scores-page')).not.toBeInTheDocument();
  });
});

describe('Event page Contests tab', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('lists every contest on the event with its league, template, status and entries, and ⤢ opens one with links to it and its league', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/contests');
    listEventContestsMock.mockResolvedValue({
      data: { contests: [contest(), contest({ id: '00000000-0000-4000-8000-0000000000c2', name: 'Pick 6', status: 'DRAFT', contestTemplateId: '00000000-0000-4000-8000-0000000000t1', contestTemplateName: 'Pick 6', entryCount: 0 })] },
    });

    const row = await screen.findByTestId('root-admin-event-contest-00000000-0000-4000-8000-0000000000c1', {}, { timeout: 5_000 });
    expect(row).toHaveTextContent('Office Hoops');
    expect(row).toHaveTextContent('Open');
    expect(row).toHaveTextContent('None');
    expect(screen.getByTestId('root-admin-event-contest-00000000-0000-4000-8000-0000000000c2')).toHaveTextContent('Set up');
    expect(screen.getByTestId('root-admin-event-contests-count')).toHaveTextContent('2 contests');

    await userEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-event-contest-dialog');
    expect(within(dialog).getByTestId('root-admin-event-contest-dialog-entries')).toHaveTextContent('12');
    expect(within(dialog).getByTestId('root-admin-event-contest-dialog-open-contest'))
      .toHaveAttribute('href', '/league/HOOPS/contests/00000000-0000-4000-8000-0000000000c1');
    expect(within(dialog).getByTestId('root-admin-event-contest-dialog-open-league'))
      .toHaveAttribute('href', '/manage/customers/leagues?league=00000000-0000-4000-8000-0000000000l1');
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('says so when no contest runs on the event', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/contests');
    listEventContestsMock.mockResolvedValue({ data: { contests: [] } });

    expect(await screen.findByText('No contests on this event yet.', {}, { timeout: 5_000 })).toBeInTheDocument();
  });
});

describe('Event page Release checks dialog', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  const draft = (overrides: Parameters<typeof tournament>[0] = {}) =>
    tournament({ status: 'DRAFT', allowedTransitions: ['CANCELLED'], releaseChecks: passingReleaseChecks(), ...overrides });

  async function openReleaseChecks() {
    await userEvent.click(await screen.findByTestId('root-admin-event-release-chip', {}, { timeout: 5_000 }));
    return screen.findByTestId('root-admin-event-release-checks');
  }

  it('shows the release mode, when automatic release tries, its last try, and each check with its value', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', {
      event: draft({
        releaseChecks: passingReleaseChecks({ key: 'TIERS_ASSIGNED', passed: false, value: 3 }),
        lastAutoReleaseCheck: { checkedAt: '2026-05-01T10:00:00.000Z', outcome: 'HELD', failedChecks: ['TIERS_ASSIGNED'] },
      }),
      overview: eventOverview({ releaseMode: 'AUTO', releaseAt: '2026-04-30T12:00:00.000Z', releaseAtKind: 'PLANNED' }),
    });

    const dialog = await openReleaseChecks();
    expect(dialog).toHaveTextContent('Automatic');
    expect(dialog).toHaveTextContent('Hourly from');
    expect(dialog).toHaveTextContent('held');
    expect(within(dialog).getByTestId('root-admin-event-release-check-TIERS_ASSIGNED')).toHaveTextContent('3 participants without a tier');
    expect(within(dialog).getByTestId('root-admin-event-release-check-TIERS_ASSIGNED')).toContainElement(within(dialog).getByLabelText('Failed'));
    expect(within(dialog).getByTestId('root-admin-event-release-check-FIELD_LOADED')).toContainElement(
      within(within(dialog).getByTestId('root-admin-event-release-check-FIELD_LOADED')).getByLabelText('Passed'),
    );
    // A check the manual release needs fails, so Release now waits for it.
    expect(within(dialog).getByTestId('root-admin-sport-event-release')).toBeDisabled();
  });

  it('lets an admin release a draft only the automatic release still waits on, after confirming', async () => {
    releaseEventMock.mockResolvedValue({ data: { event: tournament({ status: 'SCHEDULED' }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field', {
      event: draft({ releaseChecks: passingReleaseChecks({ key: 'CONTEST_SETUPS_ON', passed: false, value: 0 }) }),
    });

    const dialog = await openReleaseChecks();
    expect(within(dialog).getByTestId('root-admin-event-release-check-CONTEST_SETUPS_ON')).toHaveTextContent('Automatic release only');
    expect(dialog).toHaveTextContent('Manual');
    expect(dialog).toHaveTextContent('Never');
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-release'));
    await userEvent.click(within(await screen.findByTestId('root-admin-sport-event-release-modal')).getByTestId('root-admin-sport-event-release-confirm'));

    await waitFor(() => expect(releaseEventMock).toHaveBeenCalledWith(expect.objectContaining({ path: { eventId: 'tour-1' } })));
  });

  it('explains a refused release in plain domain words, naming an event rather than the sport word', async () => {
    releaseEventMock.mockResolvedValue(refusal('SPORT_EVENT_ALREADY_STARTED', 'Sport event has already started.'));
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: draft() });

    const dialog = await openReleaseChecks();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-release'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-event-release-confirm'));

    expect(await screen.findByText('This event has already started, so it can no longer be released.')).toBeInTheDocument();
  });

  it('returns from the release confirmation\'s close button to the checks, without releasing', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: draft() });

    const dialog = await openReleaseChecks();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-release'));
    const modal = await screen.findByTestId('root-admin-sport-event-release-modal');
    await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

    expect(await screen.findByTestId('root-admin-event-release-checks')).toBeInTheDocument();
    expect(releaseEventMock).not.toHaveBeenCalled();
  });
});

describe('Event page ⚙ dialog', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('shows the event\'s details with its league\'s tier and pricing profiles and the value its tiers are ordered by', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', { overview: eventOverview({ tierOrderBasis: 'RANKING', tierOrderCoversField: false }) });

    const dialog = await openSettings();
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-league')).toHaveTextContent('PGA Tour');
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-feed-id')).toHaveTextContent('None');
    expect(await within(dialog).findByText('Six tiers')).toBeInTheDocument();
    expect(await within(dialog).findByText('Standard')).toBeInTheDocument();
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-tier-order')).toHaveTextContent('Rank');
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-tier-order')).toHaveTextContent('those without go last');
  });

  it('offers Open event page › to the event page that offers its series, and no such action when none does', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', { overview: eventOverview({ eventPageSlug: 'the-masters' }) });

    const dialog = await openSettings();
    expect(await within(dialog).findByTestId('root-admin-event-settings-dialog-open-event-page')).toHaveAttribute('href', '/play/golf/the-masters');
  });

  it('leaves Open event page › off when no event page offers the event', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    expect(within(dialog).queryByTestId('root-admin-event-settings-dialog-open-event-page')).not.toBeInTheDocument();
  });

  it('says what the event was priced with, or that it is not priced yet', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', {
      event: tournament({ pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 30, floorSharePercent: 12, steepness: 4 } }),
    });

    const dialog = await openSettings();
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-priced-with')).toHaveTextContent(
      'Standard: $50,000 cap · $100 unit · best 30% · worst 12% · steepness 4',
    );
  });

  it('reads "Not set" for a missing venue, location and round count, and a synced event\'s feed id', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: tournament({ venue: null, location: null, rounds: null, providerSynced: true }) });

    const dialog = await openSettings();
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-venue')).toHaveTextContent('Not set');
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-location')).toHaveTextContent('Not set');
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-rounds')).toHaveTextContent('Not set');
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-feed-id')).toHaveTextContent('feed-401');
  });

  it('confirms and applies an allowed status move', async () => {
    transitionEventMock.mockResolvedValue({ data: { event: tournament({ status: 'IN_PROGRESS' }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-transition-IN_PROGRESS'));
    const modal = await screen.findByTestId('root-admin-sport-event-transition-modal');
    expect(within(modal).getByTestId('root-admin-sport-event-transition-confirm')).toHaveTextContent('Move to In Progress');
    await userEvent.click(within(modal).getByTestId('root-admin-sport-event-transition-confirm'));

    await waitFor(() => expect(transitionEventMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'tour-1' },
      body: { toStatus: 'IN_PROGRESS' },
    })));
  });

  it('shows the server\'s reason in the confirmation when a status move is refused', async () => {
    transitionEventMock.mockResolvedValue(refusal('INVALID_STATUS_TRANSITION', 'Cannot move a scheduled tournament to In Progress before round 1.'));
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-transition-IN_PROGRESS'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-event-transition-confirm'));

    expect(await screen.findByText('Cannot move a scheduled tournament to In Progress before round 1.')).toBeInTheDocument();
  });

  it('returns from the status move confirmation\'s close button to the details, without moving', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-transition-CANCELLED'));
    const modal = await screen.findByTestId('root-admin-sport-event-transition-modal');
    await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

    expect(await screen.findByTestId('root-admin-event-settings-dialog')).toBeInTheDocument();
    expect(transitionEventMock).not.toHaveBeenCalled();
  });

  it('offers no status moves when the event allows none', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: tournament({ status: 'COMPLETED', allowedTransitions: [] }) });

    const dialog = await openSettings();
    expect(within(dialog).queryByTestId(/root-admin-sport-event-transition-/)).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('root-admin-sport-event-auto-toggle')).toBeInTheDocument();
  });

  it('turns automatic lifecycle off after confirming', async () => {
    updateEventMock.mockResolvedValue({ data: { event: tournament({ autoLifecycleEnabled: false }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    expect(within(dialog).getByTestId('root-admin-sport-event-auto-toggle')).toHaveTextContent('Turn off');
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-auto-toggle'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-event-auto-confirm'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { eventId: 'tour-1' },
      body: { autoLifecycleEnabled: false },
    })));
  });

  it('offers to turn automatic lifecycle back on when it is off, and shows the server\'s reason when that is refused', async () => {
    updateEventMock.mockResolvedValue(refusal('SPORT_EVENT_LOCKED', 'This tournament is locked.', 409));
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: tournament({ autoLifecycleEnabled: false }) });

    const dialog = await openSettings();
    expect(dialog).toHaveTextContent('Every status move is made by hand.');
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-auto-toggle'));
    const confirm = await screen.findByTestId('root-admin-sport-event-auto-confirm');
    expect(confirm).toHaveTextContent('Turn on automatic lifecycle');
    await userEvent.click(confirm);

    expect(await screen.findByText('This tournament is locked.')).toBeInTheDocument();
    expect(updateEventMock).toHaveBeenCalledWith(expect.objectContaining({ body: { autoLifecycleEnabled: true } }));
  });

  it('returns from the automatic lifecycle confirmation\'s close button without saving', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettings();
    await userEvent.click(within(dialog).getByTestId('root-admin-sport-event-auto-toggle'));
    const modal = await screen.findByTestId('root-admin-sport-event-auto-modal');
    await userEvent.click(within(modal).getByRole('button', { name: /^Close / }));

    expect(await screen.findByTestId('root-admin-event-settings-dialog')).toBeInTheDocument();
    expect(updateEventMock).not.toHaveBeenCalled();
  });
});

describe('Event page ⚙ dialog Edit', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('saves only the details an admin changed on an event no provider syncs, and returns to the details', async () => {
    updateEventMock.mockResolvedValue({ data: { event: tournament({ name: 'Renamed Invitational' }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    await userEvent.clear(within(dialog).getByTestId('root-admin-sport-event-edit-name'));
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-name'), 'Renamed Invitational');
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect(updateEventMock.mock.calls[0][0]).toMatchObject({ path: { eventId: 'tour-1' }, body: { name: 'Renamed Invitational' } });
    expect(await within(dialog).findByTestId('root-admin-event-settings-dialog-facts')).toBeInTheDocument();
  });

  it('leaves a provider-synced event\'s name, venue and dates out of the form, and saves only what an admin still owns', async () => {
    updateEventMock.mockResolvedValue({ data: { event: tournament({ providerSynced: true, location: 'Hoylake' }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field', { event: tournament({ providerSynced: true, syncScope: 'SCORES_ONLY' }) });

    const dialog = await openSettingsEdit();
    for (const field of ['name', 'venue', 'start', 'end']) {
      expect(within(dialog).queryByTestId(`root-admin-sport-event-edit-${field}`)).not.toBeInTheDocument();
    }
    await userEvent.clear(within(dialog).getByTestId('root-admin-sport-event-edit-location'));
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-location'), 'Hoylake');
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect((updateEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body).toEqual({ location: 'Hoylake' });
  });

  it('saves the par per round an admin enters, and sends null when it is cleared', async () => {
    updateEventMock.mockResolvedValue({ data: { event: tournament({ roundsPar: 72 }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    expect(within(dialog).getByTestId('root-admin-sport-event-edit-rounds-par')).toHaveValue('');
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-rounds-par'), '72');
    // The event read again after the save holds the new par.
    getEventMock.mockResolvedValue({ data: { event: tournament({ roundsPar: 72 }) } });
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));
    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect(updateEventMock.mock.calls[0][0]).toMatchObject({ body: { roundsPar: 72 } });

    await userEvent.click(await within(dialog).findByTestId('root-admin-event-settings-dialog-edit'));
    await userEvent.clear(within(dialog).getByTestId('root-admin-sport-event-edit-rounds-par'));
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(2));
    expect(updateEventMock.mock.calls[1][0]).toMatchObject({ body: { roundsPar: null } });
  });

  it('refuses a par per round outside 60 to 80, and a blank name, before saving', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-rounds-par'), '85');
    expect(await within(dialog).findByText('Par is a whole number from 60 to 80, or blank')).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByTestId('root-admin-sport-event-edit-rounds-par'));
    await userEvent.clear(within(dialog).getByTestId('root-admin-sport-event-edit-name'));

    expect(await within(dialog).findByText('Name is required')).toBeInTheDocument();
    expect(within(dialog).getByTestId('root-admin-event-settings-dialog-save')).toBeDisabled();
    expect(updateEventMock).not.toHaveBeenCalled();
  });

  it('clears the end date and the venue when the admin blanks them, rather than keeping the old ones', async () => {
    updateEventMock.mockResolvedValue({ data: { event: tournament({ endDate: null, venue: null }) } });
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    await userEvent.clear(within(dialog).getByLabelText('Ends'));
    await userEvent.clear(within(dialog).getByLabelText('Venue'));
    await userEvent.type(within(dialog).getByLabelText('Venue'), '   ');
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));

    await waitFor(() => expect(updateEventMock).toHaveBeenCalledTimes(1));
    expect((updateEventMock.mock.calls[0][0] as { body: Record<string, unknown> }).body).toEqual({ endDate: null, venue: null });
  });

  it('shows the server\'s reason when saving is refused, and stays on the form', async () => {
    updateEventMock.mockResolvedValue(refusal('VALIDATION_ERROR', 'The end date must be after the start date.'));
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-location'), ' North');
    await userEvent.click(within(dialog).getByTestId('root-admin-event-settings-dialog-save'));

    expect(await within(dialog).findByText('The end date must be after the start date.')).toBeInTheDocument();
    expect(within(dialog).getByTestId('root-admin-sport-event-edit-location')).toBeInTheDocument();
  });

  it('goes back to the details from Cancel without saving', async () => {
    renderEventPage('/manage/sports/golf/events/tour-1/field');

    const dialog = await openSettingsEdit();
    await userEvent.type(within(dialog).getByTestId('root-admin-sport-event-edit-location'), ' North');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(await within(dialog).findByTestId('root-admin-event-settings-dialog-location')).toHaveTextContent('Augusta, GA');
    expect(updateEventMock).not.toHaveBeenCalled();
  });
});
