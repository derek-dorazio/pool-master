import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Navigate, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ActivityJobDto,
  ContestConfigTemplateDto,
  SportLeagueEventOverviewDto,
  SportLeagueOverviewDto,
  SportLeagueParticipantOverviewDto,
  SportLeaguePhaseDefinitionDto,
  SportLeaguePositionDto,
  SportLeagueSyncDto,
} from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { LeagueActivityTab } from './league-activity-tab';
import { LeagueContestTemplatesTab } from './league-contest-templates-tab';
import { LeagueEventsTab } from './league-events-tab';
import { LeaguePageLayout } from './league-page-layout';
import { LeagueParticipantsTab } from './league-participants-tab';
import { LeagueStructureTab } from './league-structure-tab';
import { providerMappingFixture, sportLeagueFixture } from './sport-test-fixtures';

// The root admin's League page (#1866): the header, the tab set, and each tab's grid and dialog.

const {
  getSportLeagueStructureMock,
  listActivityMock,
  listContestConfigTemplatesMock,
  listProvidersMock,
  listSportLeagueEventOverviewsMock,
  listSportLeagueOverviewsMock,
  listSportLeagueParticipantOverviewsMock,
  listSportLeaguePositionsMock,
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
    getSportLeagueStructureMock: vi.fn(),
    listActivityMock: vi.fn(),
    listContestConfigTemplatesMock: vi.fn(),
    listProvidersMock: vi.fn(),
    listSportLeagueEventOverviewsMock: vi.fn(),
    listSportLeagueOverviewsMock: vi.fn(),
    listSportLeagueParticipantOverviewsMock: vi.fn(),
    listSportLeaguePositionsMock: vi.fn(),
    listSportLeaguesMock: vi.fn(),
    listSportLeagueSyncsMock: vi.fn(),
    mockLogger: logger,
    syncLeagueEventsMock: vi.fn(),
    updateContestConfigTemplateMock: vi.fn(),
    updateParticipantMock: vi.fn(),
  };
});

bindApiMocks({
  getSportLeagueStructure: getSportLeagueStructureMock,
  listActivity: listActivityMock,
  listContestConfigTemplates: listContestConfigTemplatesMock,
  listProviders: listProvidersMock,
  listSportLeagueEventOverviews: listSportLeagueEventOverviewsMock,
  listSportLeagueOverviews: listSportLeagueOverviewsMock,
  listSportLeagueParticipantOverviews: listSportLeagueParticipantOverviewsMock,
  listSportLeaguePositions: listSportLeaguePositionsMock,
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

const NBA = sportLeagueFixture({ id: 'nba', sport: 'BASKETBALL', name: 'NBA', selectedProviderMapping: providerMappingFixture(), currentEventYear: 2027 });
const SUMMER = sportLeagueFixture({ id: 'summer', sport: 'BASKETBALL', name: 'Summer League' });

function overview(overrides: Partial<SportLeagueOverviewDto>): SportLeagueOverviewDto {
  return {
    id: 'nba',
    sport: 'BASKETBALL',
    name: 'NBA',
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
  overview({ id: 'summer', name: 'Summer League', providerId: null, syncHealth: 'OFF' }),
];

function sync(kind: SportLeagueSyncDto['kind']): SportLeagueSyncDto {
  return { kind, health: 'OK', mode: 'SCHEDULE', lastRun: null };
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

function job(overrides: Partial<ActivityJobDto>): ActivityJobDto {
  const at = new Date(Date.now() - 60_000).toISOString();
  return {
    id: '00000000-0000-4000-8000-00000000a001',
    type: 'SYNC_LEAGUE_EVENTS',
    kind: 'SYNC',
    status: 'SUCCEEDED',
    sportLeagueId: 'nba',
    sportEventId: null,
    sportLeague: { id: 'nba', name: 'NBA' },
    sportEvent: null,
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
  };
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

const STRUCTURE_MAPPING = {
  providerId: '00000000-0000-4000-8000-00000000b001', providerName: 'BALLDONTLIE', providerLeagueCode: 'nba', providerLeagueName: 'NBA',
} as const;
const STRUCTURE_SLOT: Omit<SportLeaguePhaseDefinitionDto['slots'][number], 'id' | 'key' | 'slotKind'> = {
  weekNumber: null, name: null, awardsTrophy: false, squaresEligible: false, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED', providerMappings: [],
};
const STRUCTURE: SportLeaguePhaseDefinitionDto[] = [
  { id: '00000000-0000-4000-8000-00000000c001', phase: 'PRESEASON', isSynced: false, slots: [] },
  {
    id: '00000000-0000-4000-8000-00000000c002', phase: 'REGULAR', isSynced: true, slots: [{
      ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d001', key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, squaresEligible: true,
      providerMappings: [{ ...STRUCTURE_MAPPING, id: '00000000-0000-4000-8000-00000000e001', matchType: 'CALENDAR_WEEK', providerValue: null }],
    }],
  },
  {
    id: '00000000-0000-4000-8000-00000000c003', phase: 'POSTSEASON', isSynced: true, slots: [
      { ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d002', key: 'SEMIFINAL', slotKind: 'SEMIFINAL', seriesFormat: 'BEST_OF', seriesGames: 7 },
      {
        ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d003', key: 'FINAL', slotKind: 'FINAL', name: 'NBA Finals', awardsTrophy: true, seriesFormat: 'BEST_OF', seriesGames: 7,
        providerMappings: [{ ...STRUCTURE_MAPPING, id: '00000000-0000-4000-8000-00000000e002', matchType: 'PROVIDER_CODE', providerValue: 'POST:5' }],
      },
    ],
  },
];
const POSITION_CODE = { provider: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerLeagueName: 'NFL' } as const;
const POSITIONS: SportLeaguePositionDto[] = [
  { id: '00000000-0000-4000-8000-00000000f001', code: 'QB', displayOrder: 1, isFieldEligible: true, providerCodes: [{ ...POSITION_CODE, providerCode: 'QB' }] },
  { id: '00000000-0000-4000-8000-00000000f002', code: 'K', displayOrder: 2, isFieldEligible: false, providerCodes: [] },
];

function renderLeaguePage(path: string) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [NBA, SUMMER] } });
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
            <Route element={<LeagueActivityTab />} path="activity" />
            <Route element={<LeagueContestTemplatesTab />} path="contest-templates" />
            <Route element={<LeagueStructureTab />} path="structure" />
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

  it('heads a synced league with its name, On, sync health and provider, opens on Events, and leaves out the Tools tab', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba');

    // The first render loads the page's modules, which is slow on a loaded runner.
    expect(await screen.findByRole('heading', { level: 1, name: 'NBA' }, { timeout: 5_000 })).toBeInTheDocument();
    const facts = await screen.findByTestId('root-admin-league-facts');
    expect(within(facts).getByText('OK')).toBeInTheDocument();
    expect(within(facts).getByText('BALLDONTLIE')).toBeInTheDocument();
    expect(tabLabels()).toEqual(['Events', 'Participants', 'Activity', 'Contest templates', 'Structure']);
    // The league's bare address opens its Events tab.
    await waitFor(() => expect(screen.getByTestId('root-admin-league-tab-events')).toHaveAttribute('aria-current', 'page'));
  });

  it('adds the Tools tab on a league no provider syncs, and offers no Sync now there', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/summer/events');

    await screen.findByTestId('root-admin-league-sync-EVENTS');
    expect(tabLabels()).toEqual(['Events', 'Participants', 'Activity', 'Contest templates', 'Structure', 'Tools']);
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
    expect(screen.getByTestId('root-admin-league-sync-FIELD')).toHaveTextContent('Field');
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

  it('gives a league\'s Participants grid Team and Position when a participant has them', async () => {
    listSportLeagueParticipantOverviewsMock.mockResolvedValue({
      data: { participants: [participant({ id: 'p-jt', name: 'Jayson Tatum', participantType: 'INDIVIDUAL', shortName: null, teamAffiliation: 'Celtics', role: 'F' })] },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/participants');

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

  it('lists the league\'s phases and its slots in the API\'s order, each named by its proper name or the word for its kind, opens a slot to read with no Edit, and closes it on Escape', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    const phasesTable = await screen.findByTestId('root-admin-league-structure-phases-table');
    expect(getSportLeagueStructureMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'nba' } }));
    expect(within(phasesTable).getByTestId('root-admin-league-structure-phase-PRESEASON')).toHaveTextContent('No');
    const slots = within(screen.getByTestId('root-admin-league-structure-slots-table')).getAllByTestId(/^root-admin-league-structure-slot-/);
    expect(slots.map((row) => row.getAttribute('data-testid'))).toEqual(['WEEK_1', 'SEMIFINAL', 'FINAL'].map((key) => `root-admin-league-structure-slot-${key}`));
    ['Week 1', 'Semifinal', 'NBA Finals'].forEach((label, index) => expect(slots[index]).toHaveTextContent(label));
    expect(within(screen.getByTestId('root-admin-league-structure-slot-FINAL')).getByText('Best of · 7 games')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-league-structure-slot-WEEK_1')).getByText('BALLDONTLIE nba · Calendar week')).toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-slot-FINAL')).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-structure-slot');
    expect(within(dialog).getByTestId('root-admin-league-structure-slot-mappings')).toHaveTextContent('BALLDONTLIE nba · Provider code POST:5');
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-slot')).not.toBeInTheDocument());
  });

  it('opens a phase to read with its slot count, closes it on Escape, and says so when a slot has no provider', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    const regular = await screen.findByTestId('root-admin-league-structure-phase-REGULAR');
    await userEvent.click(within(regular).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-structure-phase');
    expect(within(dialog).getByTestId('root-admin-league-structure-phase-facts')).toHaveTextContent(/Regular season.*Yes.*1/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-phase')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-slot-SEMIFINAL')).getByRole('button', { name: 'Open details' }));
    expect(await screen.findByTestId('root-admin-league-structure-slot-mappings')).toHaveTextContent('No provider');
  });

  it('lists the league\'s positions in the API\'s order with whether each is picked into fields and its provider codes, and opens one to read with no Edit', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: [] } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: POSITIONS } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    const table = await screen.findByTestId('root-admin-league-structure-positions-table');
    expect(listSportLeaguePositionsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'nba' } }));
    const rows = within(table).getAllByTestId(/^root-admin-league-structure-position-/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['QB', 'K'].map((code) => `root-admin-league-structure-position-${code}`));
    expect(rows[0]).toHaveTextContent(/QB.*Yes.*BALLDONTLIE nfl · QB/);
    expect(rows[1]).toHaveTextContent(/K.*No/);

    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-structure-position');
    expect(within(dialog).getByTestId('root-admin-league-structure-position-codes')).toHaveTextContent('No provider');
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('root-admin-league-structure-position-facts')).toHaveTextContent(/K.*No/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-position')).not.toBeInTheDocument());

    await userEvent.click(within(rows[0]).getByRole('button', { name: 'Open details' }));
    expect(await screen.findByTestId('root-admin-league-structure-position-facts')).toHaveTextContent(/QB.*Yes.*BALLDONTLIE nfl · QB/);
  });

  it('says the positions could not load while the league\'s phases and slots still show', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    listSportLeaguePositionsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    expect(await screen.findByTestId('root-admin-league-structure-positions-state-error')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-league-structure-phases-table')).toBeInTheDocument();
  });

  it('says the phases and slots could not load while the league\'s positions still show', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'down' } } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: POSITIONS } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    expect(await screen.findByTestId('root-admin-league-structure-state-error')).toBeInTheDocument();
    expect(await screen.findByTestId('root-admin-league-structure-position-QB')).toBeInTheDocument();
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

  it('shows the league\'s jobs on the Activity tab, without the Sport league column, and counts the failed ones on its tab', async () => {
    listActivityMock.mockResolvedValue({
      data: {
        jobs: [
          job({}),
          job({ id: '00000000-0000-4000-8000-00000000a002', status: 'FAILED', errorType: 'RATE_LIMITED', lastError: '429', completedAt: null }),
          job({ id: '00000000-0000-4000-8000-00000000a003', status: 'FAILED', errorType: 'RATE_LIMITED', lastError: '429', completedAt: null }),
        ],
      },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/activity');

    expect(await screen.findByTestId('activity-job-00000000-0000-4000-8000-00000000a001', {}, { timeout: 5_000 })).toBeInTheDocument();
    const [options] = listActivityMock.mock.calls[0] as [{ query: Record<string, string> }];
    expect(options.query['sportLeagueId']).toBe('nba');
    expect(columnHeaders('activity-grid-table')).not.toContain('Sport league');
    await waitFor(() => expect(screen.getByTestId('root-admin-league-tab-activity')).toHaveTextContent('Activity 2'));
    expect(within(screen.getByTestId('root-admin-league-tab-activity')).getByText('2')).toHaveAttribute('title', expect.stringContaining('Started window'));
  });
});
