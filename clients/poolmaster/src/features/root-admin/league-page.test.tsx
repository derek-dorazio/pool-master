import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ContestConfigTemplateDto,
  SportLeagueEventOverviewDto,
  SportLeagueOverviewDto,
  SportLeagueParticipantOverviewDto,
  SportLeagueSyncDto,
} from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { LeagueContestTemplatesTab } from './league-contest-templates-tab';
import { LeagueEventsTab } from './league-events-tab';
import { LeaguePageLayout } from './league-page-layout';
import { LeagueParticipantsTab } from './league-participants-tab';
import { sportLeagueFixture } from './sport-test-fixtures';

// The root admin's League page (#1866): the header, the tab set, and each tab's grid and dialog.

const {
  listContestConfigTemplatesMock,
  listProvidersMock,
  listSportLeagueEventOverviewsMock,
  listSportLeagueOverviewsMock,
  listSportLeagueParticipantOverviewsMock,
  listSportLeaguesMock,
  listSportLeagueSyncsMock,
  mockLogger,
  syncLeagueEventsMock,
  updateContestConfigTemplateMock,
  updateParticipantMock,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return {
    listContestConfigTemplatesMock: vi.fn(),
    listProvidersMock: vi.fn(),
    listSportLeagueEventOverviewsMock: vi.fn(),
    listSportLeagueOverviewsMock: vi.fn(),
    listSportLeagueParticipantOverviewsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listSportLeagueSyncsMock: vi.fn(),
    mockLogger: logger,
    syncLeagueEventsMock: vi.fn(),
    updateContestConfigTemplateMock: vi.fn(),
    updateParticipantMock: vi.fn(),
  };
});

bindApiMocks({
  listContestConfigTemplates: listContestConfigTemplatesMock,
  listProviders: listProvidersMock,
  listSportLeagueEventOverviews: listSportLeagueEventOverviewsMock,
  listSportLeagueOverviews: listSportLeagueOverviewsMock,
  listSportLeagueParticipantOverviews: listSportLeagueParticipantOverviewsMock,
  listSportLeagues: listSportLeaguesMock,
  listSportLeagueSyncs: listSportLeagueSyncsMock,
  syncLeagueEvents: syncLeagueEventsMock,
  updateContestConfigTemplate: updateContestConfigTemplateMock,
  updateParticipant: updateParticipantMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const NBA = sportLeagueFixture({ id: 'nba', sport: 'BASKETBALL', name: 'NBA', eventSyncProviderId: 'balldontlie', currentEventYear: 2027 });
const FINALS = sportLeagueFixture({ id: 'finals', sport: 'BASKETBALL', name: 'NBA Finals Clutch Card', parentSportLeagueId: 'nba', parentRoundNumbers: [4] });
const SUMMER = sportLeagueFixture({ id: 'summer', sport: 'BASKETBALL', name: 'Summer League' });

function overview(overrides: Partial<SportLeagueOverviewDto>): SportLeagueOverviewDto {
  return {
    id: 'nba',
    sport: 'BASKETBALL',
    name: 'NBA',
    parentSportLeagueId: null,
    kind: 'REAL',
    providerId: 'balldontlie',
    isActive: true,
    syncHealth: 'OK',
    issues: [],
    season: null,
    nextEventStartsAt: null,
    eventCount: 2,
    ...overrides,
  };
}

const OVERVIEWS = [
  overview({}),
  overview({ id: 'finals', name: 'NBA Finals Clutch Card', parentSportLeagueId: 'nba', kind: 'CLUTCH_CARD' }),
  overview({ id: 'summer', name: 'Summer League', providerId: null, syncHealth: 'OFF' }),
];

function sync(kind: SportLeagueSyncDto['kind']): SportLeagueSyncDto {
  return { kind, health: 'OK', mode: 'SCHEDULE', lastRun: null, nextRunAt: null };
}

function event(overrides: Partial<SportLeagueEventOverviewDto>): SportLeagueEventOverviewDto {
  return {
    id: 'evt-1',
    name: 'NBA Cup 2027',
    eventYear: 2027,
    startDate: '2027-12-01T00:00:00.000Z',
    endDate: null,
    status: 'DRAFT',
    releaseMode: 'AUTO',
    releaseAt: '2027-11-24T00:00:00.000Z',
    releaseAtKind: 'PLANNED',
    lastReleaseCheck: null,
    fieldSize: null,
    issues: [],
    lastSyncedAt: null,
    ...overrides,
  };
}

function participant(overrides: Partial<SportLeagueParticipantOverviewDto>): SportLeagueParticipantOverviewDto {
  return {
    id: 'p-bos',
    name: 'Boston Celtics',
    participantType: 'TEAM',
    shortName: 'BOS',
    nationality: null,
    teamAffiliation: null,
    role: null,
    ranking: null,
    feedId: '2',
    lastInFeedAt: '2027-01-01T00:00:00.000Z',
    addedBy: 'FEED',
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function template(overrides: Partial<ContestConfigTemplateDto> = {}): ContestConfigTemplateDto {
  return {
    id: '00000000-0000-4000-8000-00000000c001',
    sport: 'BASKETBALL',
    sportLeagueId: 'nba',
    eventType: 'KNOCKOUT',
    contestFormat: 'PREDICTION',
    selectionType: 'BRACKET',
    templateKey: 'nba-bracket',
    name: 'Playoff bracket',
    description: 'Pick every series.',
    sortOrder: 1,
    isDefault: false,
    active: true,
    schemaVersion: 1,
    configuration: {} as ContestConfigTemplateDto['configuration'],
    ...overrides,
  };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderLeaguePage(path: string) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [NBA, FINALS, SUMMER] } });
  listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: OVERVIEWS } });
  listProvidersMock.mockResolvedValue({ data: { providers: [{ providerId: 'balldontlie', providerName: 'BALLDONTLIE', sportsCovered: ['BASKETBALL'] }] } });
  listSportLeagueSyncsMock.mockResolvedValue({ data: { syncs: [sync('EVENTS'), sync('FIELD'), sync('SCORES')] } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<LeaguePageLayout />} path="/manage/sports/:sport/leagues/:leagueId">
            <Route element={<Navigate replace to="events" />} index />
            <Route element={<LeagueEventsTab />} path="events" />
            <Route element={<LeagueParticipantsTab />} path="participants" />
            <Route element={<LeagueContestTemplatesTab />} path="contest-templates" />
            <Route element={<LocationProbe />} path="tools" />
          </Route>
          <Route element={<LocationProbe />} path="/manage/sports/:sport/events/:eventId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function tabLabels(): string[] {
  return within(screen.getByRole('navigation', { name: 'League views' })).getAllByRole('link').map((link) => link.textContent);
}

function columnHeaders(tableTestId: string): string[] {
  return within(screen.getByTestId(tableTestId)).getAllByRole('columnheader').map((header) => header.textContent.trim()).filter(Boolean);
}

describe('League page', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('heads a synced league with its name, On, sync health, provider and Clutch Card, opens on Events, and leaves out the Tools tab', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba');

    // The first render loads the page's modules, which is slow on a loaded runner.
    expect(await screen.findByRole('heading', { level: 1, name: 'NBA' }, { timeout: 5_000 })).toBeInTheDocument();
    const facts = await screen.findByTestId('root-admin-league-facts');
    expect(within(facts).getByText('OK')).toBeInTheDocument();
    expect(within(facts).getByText('BALLDONTLIE')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-league-clutch-card-finals')).toHaveAttribute('href', '/manage/sports/basketball/leagues/finals');
    expect(tabLabels()).toEqual(['Events', 'Participants', 'Contest templates']);
    // The league's bare address opens its Events tab.
    await waitFor(() => expect(screen.getByTestId('root-admin-league-tab-events')).toHaveAttribute('aria-current', 'page'));
  });

  it('adds the Tools tab on a league no provider syncs, and offers no Sync now there', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/summer/events');

    await screen.findByTestId('root-admin-league-sync-EVENTS');
    expect(tabLabels()).toEqual(['Events', 'Participants', 'Contest templates', 'Tools']);
    expect(screen.queryByTestId('root-admin-league-sync-now')).not.toBeInTheDocument();
  });

  it('sends a synced league\'s old Tools link to its Events tab', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/tools');

    expect(await screen.findByTestId('root-admin-league-events-tab')).toBeInTheDocument();
  });

  it('shows the three syncs by name and queues the event list on Sync now', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    syncLeagueEventsMock.mockResolvedValue({ data: { job: { id: 'job-1' } } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/events');

    expect(await screen.findByTestId('root-admin-league-sync-EVENTS')).toHaveTextContent('Event list');
    expect(screen.getByTestId('root-admin-league-sync-FIELD')).toHaveTextContent('Fields');
    expect(screen.getByTestId('root-admin-league-sync-SCORES')).toHaveTextContent('Live scores and results');
    expect(screen.getByTestId('root-admin-league-sync-EVENTS')).toHaveTextContent('Never run');

    await userEvent.click(screen.getByTestId('root-admin-league-sync-now'));
    await waitFor(() => expect(syncLeagueEventsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'nba' } })));
  });

  it('opens the Events grid on the current season, with every column, and a row leads to its event page', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({
      data: { events: [event({ id: 'evt-old', name: 'NBA Cup 2026', eventYear: 2026, status: 'COMPLETED', releaseMode: 'MANUAL', releaseAtKind: 'ACTUAL' }), event({})] },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/events');

    const row = await screen.findByTestId('root-admin-league-event-evt-1');
    expect(screen.queryByTestId('root-admin-league-event-evt-old')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-league-events-filter-summary')).toHaveTextContent('Year');
    expect(screen.getByTestId('root-admin-league-events-count')).toHaveTextContent('2 events');
    expect(columnHeaders('root-admin-league-events-table')).toEqual(
      expect.arrayContaining(['Event', 'Year', 'Starts', 'Status', 'Release', 'Release date', 'Field', 'Issues', 'Last synced']),
    );
    expect(within(row).getByText('Auto')).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('root-admin-league-events-filter-summary-clear-all'));
    expect(await screen.findByTestId('root-admin-league-event-evt-old')).toBeInTheDocument();
  });

  it('gives a team league\'s Participants grid Short name, never Country, and opens a participant in view mode, then Edit and Save', async () => {
    listSportLeagueParticipantOverviewsMock.mockResolvedValue({ data: { participants: [participant({})] } });
    updateParticipantMock.mockResolvedValue({ data: { participant: { id: 'p-bos' } } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/participants');

    const row = await screen.findByTestId('root-admin-league-participant-p-bos');
    expect(columnHeaders('root-admin-league-participants-table')).toEqual(
      expect.arrayContaining(['Participant', 'Short name', 'Feed id', 'Last in feed', 'Added by', 'Added']),
    );
    expect(columnHeaders('root-admin-league-participants-table')).not.toContain('Country');

    await userEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-participant');
    expect(within(dialog).getByTestId('root-admin-league-participant-short-name')).toHaveTextContent('BOS');
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();

    await userEvent.click(within(dialog).getByTestId('root-admin-league-participant-edit'));
    expect(within(dialog).queryByTestId('root-admin-league-participant-name-input')).not.toBeInTheDocument();
    const shortName = within(dialog).getByTestId('root-admin-league-participant-shortName-input');
    await userEvent.clear(shortName);
    await userEvent.type(shortName, 'Celtics');
    await userEvent.click(within(dialog).getByTestId('root-admin-league-participant-save'));

    await waitFor(() => expect(updateParticipantMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'p-bos' },
      body: { shortName: 'Celtics' },
    })));
  });

  it('gives a Clutch Card\'s Participants grid Team and Position', async () => {
    listSportLeagueParticipantOverviewsMock.mockResolvedValue({
      data: { participants: [participant({ id: 'p-jt', name: 'Jayson Tatum', participantType: 'INDIVIDUAL', shortName: null, teamAffiliation: 'Celtics', role: 'F' })] },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/finals/participants');

    await screen.findByTestId('root-admin-league-participant-p-jt');
    expect(columnHeaders('root-admin-league-participants-table')).toEqual(expect.arrayContaining(['Team', 'Position']));
  });

  it('opens a contest template in view mode, and Edit then Cancel returns to view without saving', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template()] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/contest-templates');

    const row = await screen.findByTestId('root-admin-league-contest-template-nba-bracket');
    expect(listContestConfigTemplatesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sportLeagueId: 'nba' } }));
    expect(within(row).getByText('Bracket')).toBeInTheDocument();
    expect(within(row).getByText('On')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-contest-template');
    expect(within(dialog).getByTestId('root-admin-league-contest-template-status')).toHaveTextContent('On');

    await userEvent.click(within(dialog).getByTestId('root-admin-league-contest-template-edit'));
    await userEvent.selectOptions(within(dialog).getByTestId('root-admin-league-contest-template-status-input'), 'off');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(within(dialog).getByTestId('root-admin-league-contest-template-status')).toHaveTextContent('On');
    expect(updateContestConfigTemplateMock).not.toHaveBeenCalled();
  });

  it('saves a contest template\'s Default alone', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template()] } });
    updateContestConfigTemplateMock.mockResolvedValue({ data: { template: template({ isDefault: true }) } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/contest-templates');

    const row = await screen.findByTestId('root-admin-league-contest-template-nba-bracket');
    await userEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-contest-template');
    await userEvent.click(within(dialog).getByTestId('root-admin-league-contest-template-edit'));
    await userEvent.selectOptions(within(dialog).getByTestId('root-admin-league-contest-template-default-input'), 'yes');
    await userEvent.click(within(dialog).getByTestId('root-admin-league-contest-template-save'));

    await waitFor(() => expect(updateContestConfigTemplateMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { templateId: template().id },
      body: { isDefault: true },
    })));
  });
});
