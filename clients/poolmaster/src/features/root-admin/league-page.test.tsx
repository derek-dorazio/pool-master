import { QueryClientProvider } from '@tanstack/react-query';
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
  SportLeagueSeasonDto,
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
import { providerMappingFixture, sportLeagueFixture, sportsQueryClient } from './sport-test-fixtures';

// The root admin's League page (#1866): the header, the tab set, and each tab's grid and dialog.

const {
  getSportLeagueStructureMock,
  listActivityMock,
  listContestConfigTemplatesMock,
  listProvidersMock,
  listSportLeagueEventOverviewsMock,
  listSportLeagueOverviewsMock,
  listSportLeagueParticipantOverviewsMock,
  listSportLeagueSeasonsMock,
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
    listSportLeagueSeasonsMock: vi.fn(),
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
  listSportLeagueSeasons: listSportLeagueSeasonsMock,
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

const NBA = sportLeagueFixture({ id: 'nba', sport: 'BASKETBALL', name: 'NBA', selectedProviderMapping: providerMappingFixture(), currentSeasonId: 's2027', timeZone: 'America/New_York' });
const SUMMER = sportLeagueFixture({ id: 'summer', sport: 'BASKETBALL', name: 'Summer League' });

function overview(overrides: Partial<SportLeagueOverviewDto>): SportLeagueOverviewDto {
  return {
    id: 'nba',
    sport: 'BASKETBALL',
    sportUrlSegment: 'basketball',
    sportDisplayOrder: 1,
    name: 'NBA',
    providerId: 'balldontlie',
    providerName: 'BALLDONTLIE',
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
  overview({ id: 'summer', name: 'Summer League', providerId: null, providerName: null, syncHealth: 'OFF' }),
];

function season(id: string, year: number, overrides: Partial<SportLeagueSeasonDto> = {}): SportLeagueSeasonDto {
  return {
    id, name: `${year - 1}-${String(year).slice(2)}`, championshipYear: year,
    startsAt: `${year - 1}-10-01T00:00:00.000Z`, endsAt: `${year}-06-30T00:00:00.000Z`,
    isCurrent: false, providerMappings: [], phases: [], slotsNeedingDates: 0, ...overrides,
  };
}

const SEASONS = [
  season('s2027', 2027, {
    isCurrent: true,
    providerMappings: [{ id: 'm1', providerId: 'balldontlie', providerName: 'BALLDONTLIE', providerLeagueCode: 'nba', providerSeasonId: '2026' }],
    phases: [{
      id: 'p-reg', phase: 'REGULAR', isSynced: true, status: 'IN_PROGRESS', competitions: [{
        id: 'sc-reg', sportLeagueCompetitionId: 'c-reg', code: 'REGULAR', orderIndex: 1, status: 'IN_PROGRESS', championParticipantId: null, slotsNeedingDates: 0,
        slots: [{
          id: 'slot-week-1', slotDefinitionId: 'def-week-1', key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, name: null,
          startsAt: '2026-10-20T00:00:00.000Z', endsAt: '2026-10-26T00:00:00.000Z', status: 'SCHEDULED',
          seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED', isTestData: false, label: null, window: null, sportEventId: null, takesTestEvent: false, placedByWindow: false, needsDates: false,
        }],
      }],
    }],
  }),
  season('s2026', 2026),
];

function sync(kind: SportLeagueSyncDto['kind']): SportLeagueSyncDto {
  return { kind, health: 'OK', mode: 'SCHEDULE', lastRun: null };
}

function event(overrides: Partial<SportLeagueEventOverviewDto>): SportLeagueEventOverviewDto {
  return {
    id: 'evt-1',
    name: 'NBA Cup 2027',
    sportLeagueSeasonId: 's2027',
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
    abbreviation: null,
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
    sportLeagueId: 'nba',
    coverageMode: 'ALL_LISTED',
    slots: [],
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
const STRUCTURE_SLOT: Omit<SportLeaguePhaseDefinitionDto['competitions'][number]['slots'][number], 'id' | 'key' | 'slotKind'> = {
  weekNumber: null, name: null, awardsTrophy: false, squaresEligible: false, isNeutralSite: false, seriesFormat: 'SINGLE_GAME', seriesGames: 1, pairing: 'FIXED',
  matchFormat: 'HEAD_TO_HEAD', canEndTied: false, periodUnit: 'QUARTER', periodCount: 4, providerMappings: [],
};
const STRUCTURE: SportLeaguePhaseDefinitionDto[] = [
  { id: '00000000-0000-4000-8000-00000000c001', phase: 'PRESEASON', isSynced: false, competitions: [{ id: '00000000-0000-4000-8000-00000000a101', code: 'PRESEASON', orderIndex: 1, slots: [] }] },
  {
    id: '00000000-0000-4000-8000-00000000c002', phase: 'REGULAR', isSynced: true, competitions: [{
      id: '00000000-0000-4000-8000-00000000a102', code: 'REGULAR', orderIndex: 1, slots: [{
        ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d001', key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, squaresEligible: true,
        providerMappings: [{ ...STRUCTURE_MAPPING, id: '00000000-0000-4000-8000-00000000e001', matchType: 'CALENDAR_WEEK', providerValue: null }],
      }],
    }],
  },
  {
    id: '00000000-0000-4000-8000-00000000c003', phase: 'POSTSEASON', isSynced: true, competitions: [{
      id: '00000000-0000-4000-8000-00000000a103', code: 'PLAYOFFS', orderIndex: 1, slots: [
        { ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d002', key: 'SEMIFINAL', slotKind: 'SEMIFINAL', seriesFormat: 'BEST_OF', seriesGames: 7, isNeutralSite: true },
        {
          ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d003', key: 'FINAL', slotKind: 'FINAL', name: 'NBA Finals', awardsTrophy: true, seriesFormat: 'BEST_OF', seriesGames: 7,
          providerMappings: [{ ...STRUCTURE_MAPPING, id: '00000000-0000-4000-8000-00000000e002', matchType: 'PROVIDER_CODE', providerValue: 'POST:5' }],
        },
      ],
    }],
  },
];
const POSITION_CODE = { provider: 'BALLDONTLIE', providerLeagueCode: 'nfl', providerLeagueName: 'NFL' } as const;
const POSITIONS: SportLeaguePositionDto[] = [
  { id: '00000000-0000-4000-8000-00000000f001', code: 'QB', displayOrder: 1, isFieldEligible: true, providerCodes: [{ ...POSITION_CODE, providerCode: 'QB' }] },
  { id: '00000000-0000-4000-8000-00000000f002', code: 'K', displayOrder: 2, isFieldEligible: false, providerCodes: [] },
];

function renderLeaguePage(path: string, seasons: SportLeagueSeasonDto[] = SEASONS) {
  listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [NBA, SUMMER] } });
  listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: OVERVIEWS } });
  listProvidersMock.mockResolvedValue({ data: { providers: [{ providerId: 'balldontlie', providerName: 'BALLDONTLIE' }] } });
  listSportLeagueSyncsMock.mockResolvedValue({ data: { syncs: [sync('EVENTS'), sync('FIELD'), sync('SCORES')] } });
  listSportLeagueSeasonsMock.mockResolvedValue({ data: { seasons } });
  const queryClient = sportsQueryClient();
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

  it('heads a synced league with its name, On, sync health and provider, opens on Events, with no Tools tab', async () => {
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

  it('warns above every tab while a Season has slots that need dates, and leads to the Structure tab', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/events', [{ ...SEASONS[0], slotsNeedingDates: 1 }, SEASONS[1]]);

    expect(await screen.findByTestId('root-admin-league-slot-dates-notice')).toHaveTextContent('2026-27 (1)');
    await userEvent.click(screen.getByTestId('root-admin-league-slot-dates-open'));
    await waitFor(() => expect(screen.getByTestId('root-admin-league-tab-structure')).toHaveAttribute('aria-current', 'page'));
  });

  it('shows no slot dates warning on a league whose Seasons have every date they need', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/events');

    await screen.findByTestId('root-admin-league-sync-EVENTS');
    expect(screen.queryByTestId('root-admin-league-slot-dates-notice')).not.toBeInTheDocument();
  });

  it('shows the same tabs on a league no provider syncs, with no Tools tab, and offers no Sync now there', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({ data: { events: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/summer/events');

    await screen.findByTestId('root-admin-league-sync-EVENTS');
    expect(tabLabels()).toEqual(['Events', 'Participants', 'Activity', 'Contest templates', 'Structure']);
    expect(screen.queryByTestId('root-admin-league-sync-now')).not.toBeInTheDocument();
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

  it('opens the Events grid on the current season, with every column and a link to make a test event in the league, and a row leads to its event page', async () => {
    listSportLeagueEventOverviewsMock.mockResolvedValue({
      data: { events: [event({ id: 'evt-old', name: 'NBA Cup 2026', sportLeagueSeasonId: 's2026', status: 'COMPLETED', releaseMode: 'MANUAL', releaseAtKind: 'ACTUAL' }), event({})] },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/events');

    const row = await screen.findByTestId('root-admin-league-event-evt-1');
    expect(screen.queryByTestId('root-admin-league-event-evt-old')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-league-events-filter-summary')).toHaveTextContent('Season');
    expect(screen.getByTestId('root-admin-league-events-count')).toHaveTextContent('2 events');
    expect(screen.getByTestId('root-admin-league-events-new-test-event')).toHaveAttribute('href', '/manage/sports/basketball/events/new?sportLeagueId=nba');
    expect(columnHeaders('root-admin-league-events-table')).toEqual(
      expect.arrayContaining(['Event', 'Season', 'Starts', 'Status', 'Release', 'Release date', 'Field', 'Issues', 'Last synced']),
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

  it('gives a league\'s Participants grid an Abbreviation column when a team has one', async () => {
    listSportLeagueParticipantOverviewsMock.mockResolvedValue({
      data: { participants: [participant({ abbreviation: 'BOS' })] },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/participants');

    await screen.findByTestId('root-admin-league-participant-p-bos');
    expect(columnHeaders('root-admin-league-participants-table')).toEqual(expect.arrayContaining(['Abbreviation']));
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

  it('lists the league\'s phases with their competitions and its slots in the API\'s order, each named by its proper name or the word for its kind and showing its competition, opens a slot to read with whether it is a neutral site and no Edit, and closes it on Escape', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    const phasesTable = await screen.findByTestId('root-admin-league-structure-phases-table');
    expect(getSportLeagueStructureMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'nba' } }));
    expect(within(phasesTable).getByTestId('root-admin-league-structure-phase-PRESEASON')).toHaveTextContent('No');
    expect(within(phasesTable).getByTestId('root-admin-league-structure-phase-POSTSEASON')).toHaveTextContent('PLAYOFFS');
    const slots = within(screen.getByTestId('root-admin-league-structure-slots-table')).getAllByTestId(/^root-admin-league-structure-slot-/);
    expect(slots.map((row) => row.getAttribute('data-testid'))).toEqual(['WEEK_1', 'SEMIFINAL', 'FINAL'].map((key) => `root-admin-league-structure-slot-${key}`));
    ['Week 1', 'Semifinal', 'NBA Finals'].forEach((label, index) => expect(slots[index]).toHaveTextContent(label));
    expect(within(screen.getByTestId('root-admin-league-structure-slot-FINAL')).getByText('Best of · 7 games')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-league-structure-slot-FINAL')).getByText('PLAYOFFS')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-league-structure-slot-WEEK_1')).getByText('BALLDONTLIE nba · Calendar week')).toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-slot-FINAL')).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-structure-slot');
    expect(within(dialog).getByTestId('root-admin-league-structure-slot-mappings')).toHaveTextContent('BALLDONTLIE nba · Provider code POST:5');
    expect(dialog).toHaveTextContent(/Neutral site\s*No/);
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-slot')).not.toBeInTheDocument());
  });

  it('shows a neutral-site slot as one, a slot no provider matches as matched by none, and a squares slot as one, each in its slot\'s view', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    await userEvent.click(within(await screen.findByTestId('root-admin-league-structure-slot-SEMIFINAL')).getByRole('button', { name: 'Open details' }));
    const semifinal = await screen.findByTestId('root-admin-league-structure-slot');
    expect(semifinal).toHaveTextContent(/Neutral site\s*Yes/);
    expect(within(semifinal).getByTestId('root-admin-league-structure-slot-mappings')).toHaveTextContent('No provider');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-slot')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-slot-WEEK_1')).getByRole('button', { name: 'Open details' }));
    expect(await screen.findByTestId('root-admin-league-structure-slot')).toHaveTextContent(/Squares\s*Yes/);
  });

  it('lists the league\'s Seasons latest first under its time zone, opens one to read with its provider ids and no Edit, and lists the current Season\'s slots', async () => {
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases: STRUCTURE } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    const seasonsTable = await screen.findByTestId('root-admin-league-structure-seasons-table');
    expect(listSportLeagueSeasonsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportLeagueId: 'nba' } }));
    expect(screen.getByTestId('root-admin-league-structure-seasons-facts')).toHaveTextContent('America/New_York');
    expect(within(seasonsTable).getAllByTestId(/^root-admin-league-structure-season-\d+$/).map((row) => row.getAttribute('data-testid')))
      .toEqual(['root-admin-league-structure-season-2027', 'root-admin-league-structure-season-2026']);
    expect(within(screen.getByTestId('root-admin-league-structure-season-slots-table')).getByTestId('root-admin-league-structure-season-slot-slot-week-1')).toHaveTextContent('Week 1');

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-season-2027')).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-structure-season');
    expect(dialog).toHaveTextContent('BALLDONTLIE nba · 2026');
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });

  it('shows each slot\'s match format, whether its games can end tied and its periods, in the grid and its dialog', async () => {
    const phases: SportLeaguePhaseDefinitionDto[] = [{
      id: '00000000-0000-4000-8000-00000000c010', phase: 'REGULAR', isSynced: true, competitions: [{
        id: '00000000-0000-4000-8000-00000000a110', code: 'REGULAR', orderIndex: 1, slots: [
          { ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d010', key: 'WEEK_1', slotKind: 'WEEK', weekNumber: 1, canEndTied: true, periodUnit: 'HALF', periodCount: 2 },
          { ...STRUCTURE_SLOT, id: '00000000-0000-4000-8000-00000000d011', key: 'MONACO', slotKind: 'TOURNAMENT', name: 'Monaco Grand Prix', matchFormat: 'FIELD', periodUnit: null, periodCount: null },
        ],
      }],
    }];
    getSportLeagueStructureMock.mockResolvedValue({ data: { phases } });
    listSportLeaguePositionsMock.mockResolvedValue({ data: { positions: [] } });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/structure');

    expect(await screen.findByTestId('root-admin-league-structure-slot-WEEK_1')).toHaveTextContent(/Head to head.*Yes.*Halves · 2/);
    const race = screen.getByTestId('root-admin-league-structure-slot-MONACO');
    expect(race).toHaveTextContent(/Field.*No.*No periods/);

    await userEvent.click(within(race).getByRole('button', { name: 'Open details' }));
    expect(await screen.findByTestId('root-admin-league-structure-slot-facts')).toHaveTextContent(/Format.*Field.*Can tie.*No.*Periods.*No periods/);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-structure-slot')).not.toBeInTheDocument());

    await userEvent.click(within(screen.getByTestId('root-admin-league-structure-slot-WEEK_1')).getByRole('button', { name: 'Open details' }));
    expect(await screen.findByTestId('root-admin-league-structure-slot-facts')).toHaveTextContent(/Format.*Head to head.*Can tie.*Yes.*Periods.*Halves · 2/);
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

  it('shows the league default switched off as Default and Off, keeps the dialog open with the refusal when its save is refused, and closes on Escape', async () => {
    listContestConfigTemplatesMock.mockResolvedValue({ data: { templates: [template({ isDefault: true, active: false })] } });
    updateContestConfigTemplateMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_CONFIG_TEMPLATE_NOT_FOUND', message: 'Contest template not found.' } },
      response: { status: 404 },
    });
    renderLeaguePage('/manage/sports/basketball/leagues/nba/contest-templates');

    const row = await screen.findByTestId('root-admin-league-contest-template-nba-bracket');
    expect(within(row).getByText('Default')).toBeInTheDocument();
    expect(within(row).getByText('Off')).toBeInTheDocument();

    await userEvent.click(within(row).getByRole('button', { name: 'Open details' }));
    const dialog = await screen.findByTestId('root-admin-league-contest-template');
    expect(within(dialog).getByTestId('root-admin-league-contest-template-default')).toHaveTextContent('Yes');
    expect(within(dialog).getByTestId('root-admin-league-contest-template-status')).toHaveTextContent('Off');

    await userEvent.click(within(dialog).getByTestId('root-admin-league-contest-template-edit'));
    await userEvent.selectOptions(within(dialog).getByTestId('root-admin-league-contest-template-status-input'), 'on');
    await userEvent.click(within(dialog).getByTestId('root-admin-league-contest-template-save'));

    await waitFor(() => expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'leaguePage.contestTemplate.failed' }),
      'Contest template update was refused',
    ));
    expect(updateContestConfigTemplateMock).toHaveBeenCalledWith(expect.objectContaining({ body: { active: true } }));
    expect(screen.getByTestId('root-admin-league-contest-template')).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('root-admin-league-contest-template')).not.toBeInTheDocument());
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
