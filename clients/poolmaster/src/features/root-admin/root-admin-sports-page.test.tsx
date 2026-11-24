import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SportLeagueOverviewDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportsPage } from './root-admin-sports-page';
import { sportsCountLine } from './sport-league-overview-text';
import { platformPricingProfilesFixture, providerMappingFixture, providerSummaryFixture, sportLeagueFixture, STANDARD_PLATFORM_PRICING_PROFILE_ID } from './sport-test-fixtures';
import { buildLeagueOpenFindingsPath } from './sync-findings-links';

// /manage/sports, the root admin's landing page (#1848): every sport league in one grid.

const {
  getProviderSyncRunMock,
  getSportLeagueMock,
  listPlatformPricingProfilesMock,
  listProvidersMock,
  listSportLeagueOverviewsMock,
  listPlatformTierProfilesMock,
  mockLogger,
  updateSportLeagueMock,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockReturnValue(logger);
  return {
    getProviderSyncRunMock: vi.fn(),
    getSportLeagueMock: vi.fn(),
    listPlatformPricingProfilesMock: vi.fn(),
    listProvidersMock: vi.fn(),
    listSportLeagueOverviewsMock: vi.fn(),
    listPlatformTierProfilesMock: vi.fn(),
    mockLogger: logger,
    updateSportLeagueMock: vi.fn(),
  };
});

bindApiMocks({
  getProviderSyncRun: getProviderSyncRunMock,
  getSportLeague: getSportLeagueMock,
  listPlatformPricingProfiles: listPlatformPricingProfilesMock,
  listProviders: listProvidersMock,
  listSportLeagueOverviews: listSportLeagueOverviewsMock,
  listPlatformTierProfiles: listPlatformTierProfilesMock,
  updateSportLeague: updateSportLeagueMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const PLATFORM_TIER_PROFILE_ID = '00000000-0000-4000-8000-0000000000a1';
const OTHER_PLATFORM_TIER_PROFILE_ID = '00000000-0000-4000-8000-0000000000a2';

function overview(overrides: Partial<SportLeagueOverviewDto> = {}): SportLeagueOverviewDto {
  return {
    id: 'mlb',
    sport: 'BASEBALL',
    name: 'MLB',
    providerId: 'balldontlie',
    isActive: true,
    syncHealth: 'OK',
    issues: [],
    season: { start: '2027-03-25T17:00:00.000Z', end: '2027-11-01T23:00:00.000Z' },
    nextEventStartsAt: '2027-03-25T17:00:00.000Z',
    eventCount: 3,
    ...overrides,
  };
}

/** Baseball's MLB, basketball's NBA with issues and the NCAA, and golf's PWHL-like league that is off. */
function overviews(): SportLeagueOverviewDto[] {
  return [
    overview(),
    overview({
      id: 'nba',
      sport: 'BASKETBALL',
      name: 'NBA',
      syncHealth: 'ERROR',
      nextEventStartsAt: null,
      eventCount: 2,
      issues: [
        {
          type: 'SYNC',
          count: 2,
          items: [
            { label: '429 rate limit', occurredAt: '2026-11-18T20:40:00.000Z', target: { type: 'SYNC_RUN', id: 'run-scores' }, syncKind: 'SCORES' },
            { label: 'timeout', occurredAt: '2026-11-18T18:02:00.000Z', target: { type: 'SYNC_RUN', id: 'run-field' }, syncKind: 'FIELD' },
          ],
        },
        {
          type: 'RELEASE',
          count: 1,
          items: [{
            label: 'NBA Cup 2027',
            occurredAt: '2026-11-18T19:00:00.000Z',
            target: { type: 'SPORT_EVENT', id: 'evt-cup' },
            failedChecks: ['TIERS_ASSIGNED', 'PRICES_ASSIGNED'],
          }],
        },
        {
          type: 'OVERDUE',
          count: 1,
          items: [{ label: 'NBA Cup 2026', occurredAt: '2020-01-01T00:00:00.000Z', target: { type: 'SPORT_EVENT', id: 'evt-late' } }],
        },
      ],
    }),
    overview({ id: 'ncaa', sport: 'BASKETBALL', name: "NCAA Men's Basketball", eventCount: 2 }),
    overview({ id: 'pwhl', sport: 'HOCKEY', name: 'PWHL', providerId: null, isActive: false, syncHealth: 'OFF', season: null, nextEventStartsAt: null, eventCount: 0 }),
  ];
}

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPage() {
  listProvidersMock.mockResolvedValue({ data: { providers: [providerSummaryFixture()] } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports']}>
        <Routes>
          <Route element={<RootAdminSportsPage />} path="/manage/sports" />
          <Route element={<LocationProbe />} path="/manage/sports/:sport/*" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function rowNames(): string[] {
  const table = screen.getByTestId('root-admin-sports-table');
  return within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[1].textContent);
}

describe('RootAdminSportsPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('lists the sport leagues in the order read and names each sport on its first row only', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();
    await screen.findByTestId('root-admin-sports-row-mlb');

    expect(rowNames()).toEqual(['MLB', 'NBA', "NCAA Men's Basketball"]);
    const sportCells = within(screen.getByTestId('root-admin-sports-table')).getAllByRole('row').slice(1)
      .map((row) => within(row).getAllByRole('cell')[0].textContent);
    expect(sportCells).toEqual(['Baseball', 'Basketball', '']);
  });

  it('heads the page Sports with its two tabs, Sport leagues marked and Profiles beside it', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();

    expect(await screen.findByRole('heading', { level: 1, name: 'Sports' })).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sports-tab-leagues')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('root-admin-sports-tab-profiles')).toHaveAttribute('href', '/manage/sports/profiles');
    expect(screen.getByTestId('root-admin-sports-tab-profiles')).not.toHaveAttribute('aria-current');
  });

  it('shows the count line of sports and sport leagues on, and each league\'s provider', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();

    expect(await screen.findByTestId('root-admin-sports-counts')).toHaveTextContent('3 sports · 3 of 4 sport leagues');
    expect(within(await screen.findByTestId('root-admin-sports-row-mlb')).getByText('BALLDONTLIE')).toBeInTheDocument();
  });

  it('starts filtered to On, hiding an Off sport league until Off is ticked, and says so above the grid', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();
    await screen.findByTestId('root-admin-sports-row-mlb');

    expect(screen.queryByTestId('root-admin-sports-row-pwhl')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sports-filter-summary')).toHaveTextContent('Status');

    await userEvent.click(screen.getByTestId('root-admin-sports-filter-summary-clear-all'));
    expect(await screen.findByTestId('root-admin-sports-row-pwhl')).toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sports-row-pwhl')).getByText('No provider')).toBeInTheDocument();
  });

  it('shows a chip per issue type with its count, and nothing for a league with none', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();
    await screen.findByTestId('root-admin-sports-row-nba');

    expect(screen.getByTestId('root-admin-sports-issue-nba-SYNC')).toHaveTextContent('Sync 2');
    expect(screen.getByTestId('root-admin-sports-issue-nba-RELEASE')).toHaveTextContent('Release 1');
    expect(screen.queryByTestId('root-admin-sports-issue-mlb-SYNC')).not.toBeInTheDocument();
    expect(within(screen.getByTestId('root-admin-sports-row-nba')).getByText('ERROR')).toBeInTheDocument();
  });

  it('sorts the Issues column by how many items each league has in all, not by its first chip, leagues with none last', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: [
      overview({ id: 'mlb', name: 'MLB', issues: [{ type: 'SYNC', count: 4, items: [] }] }),
      overview({ id: 'nhl', sport: 'HOCKEY', name: 'NHL', issues: [] }),
      overview({ id: 'nba', sport: 'BASKETBALL', name: 'NBA', issues: [{ type: 'OVERDUE', count: 1, items: [] }] }),
    ] } });
    renderPage();
    await screen.findByTestId('root-admin-sports-row-mlb');

    await userEvent.click(screen.getByTestId('data-grid-sort-issues'));
    expect(rowNames()).toEqual(['NBA', 'MLB', 'NHL']);
    await userEvent.click(screen.getByTestId('data-grid-sort-issues'));
    expect(rowNames()).toEqual(['MLB', 'NBA', 'NHL']);
  });

  it('lists a held release behind its chip with the failed checks, linking to its event', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-issue-nba-RELEASE-popover'));

    const item = await screen.findByTestId('root-admin-sports-issue-event-evt-cup');
    expect(item).toHaveTextContent('NBA Cup 2027');
    expect(item).toHaveTextContent('Every participant in a tier, Prices made failed');
    expect(item).toHaveAttribute('href', '/manage/sports/basketball/events/evt-cup');
  });

  it('lists an overdue event behind its chip with when it should have ended and how late it is, linking to its event', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();

    expect(await screen.findByTestId('root-admin-sports-issue-nba-OVERDUE')).toHaveTextContent('Overdue 1');
    await userEvent.click(screen.getByTestId('root-admin-sports-issue-nba-OVERDUE-popover'));

    const item = await screen.findByTestId('root-admin-sports-issue-event-evt-late');
    expect(item).toHaveTextContent('NBA Cup 2026');
    expect(item).toHaveTextContent(/Should have ended .* · \d+ days late/);
    expect(item).toHaveAttribute('href', '/manage/sports/basketball/events/evt-late');
  });

  it('counts a league\'s open sync findings by severity behind its Findings chip, each linking to Findings filtered to them', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({
      data: { sportLeagues: [overview({ id: 'mlb', name: 'MLB', issues: [{ type: 'FINDINGS', count: 3, items: [{ severity: 'ERROR', count: 1 }, { severity: 'WARNING', count: 2 }] }] })] },
    });
    renderPage();

    expect(await screen.findByTestId('root-admin-sports-issue-mlb-FINDINGS')).toHaveTextContent('Findings 3');
    await userEvent.click(screen.getByTestId('root-admin-sports-issue-mlb-FINDINGS-popover'));

    const errors = await screen.findByTestId('root-admin-sports-issue-findings-ERROR');
    expect(errors).toHaveTextContent('Error');
    expect(errors).toHaveTextContent('1 open');
    expect(errors).toHaveAttribute('href', buildLeagueOpenFindingsPath('mlb', 'ERROR'));
    expect(screen.getByTestId('root-admin-sports-issue-findings-WARNING')).toHaveTextContent('2 open');
  });

  it('opens a failed sync\'s run from behind its chip, staying on the page, and closes it again', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    getProviderSyncRunMock.mockResolvedValue({
      data: {
        id: 'run-field', providerId: 'balldontlie', sport: 'BASKETBALL', eventId: null, status: 'FAILED',
        startedAt: null, completedAt: null, createdAt: '2026-11-18T18:02:00.000Z', payload: {}, details: null,
      },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-issue-nba-SYNC-popover'));
    expect(await screen.findByText('Field sync failed')).toBeInTheDocument();
    expect(screen.getByText('Live scores and results sync failed')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('root-admin-sports-issue-run-run-field'));

    expect(await screen.findByTestId('root-admin-sync-payload-modal')).toBeInTheDocument();
    expect(getProviderSyncRunMock).toHaveBeenCalledWith(expect.objectContaining({ path: { syncRunId: 'run-field' } }));
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();

    await userEvent.click(within(screen.getByTestId('root-admin-sync-payload-modal')).getAllByRole('button', { name: /close/i })[0]);
    await waitFor(() => expect(screen.queryByTestId('root-admin-sync-payload-modal')).not.toBeInTheDocument());
  });

  it('opens a sport league\'s page from its row', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    renderPage();

    await userEvent.click(within(await screen.findByTestId('root-admin-sports-row-mlb')).getByText('BALLDONTLIE'));

    expect(await screen.findByTestId('location')).toHaveTextContent('/manage/sports/baseball/leagues/mlb');
  });

  it('opens a sport league\'s settings from its ⚙ without leaving the grid, showing them before Edit, and closes back to the grid', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB', selectedProviderMapping: providerMappingFixture() }) } });
    listPlatformTierProfilesMock.mockResolvedValue({ data: { platformTierProfiles: [{ id: PLATFORM_TIER_PROFILE_ID, name: '4 tiers of 3' }, { id: OTHER_PLATFORM_TIER_PROFILE_ID, name: '6 tiers of 5' }] } });
    listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: platformPricingProfilesFixture() } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));

    expect(await screen.findByText('MLB settings')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-settings-status')).toHaveTextContent('On');
    expect(await screen.findByTestId('root-admin-sport-league-settings-provider')).toHaveTextContent('BALLDONTLIE · PGA TOUR');
    expect(screen.getByTestId('root-admin-sport-league-settings-auto-release')).toHaveTextContent('7 days before start');
    expect(await screen.findByTestId('root-admin-sport-league-settings-tier-profile')).toHaveTextContent('4 tiers of 3');
    expect(screen.queryByTestId('root-admin-sport-league-settings-status-input')).not.toBeInTheDocument();
    expect(screen.queryByTestId('location')).not.toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /close/i })[0]);
    await waitFor(() => expect(screen.queryByText('MLB settings')).not.toBeInTheDocument());
  });

  it('saves only the settings changed on Edit, then shows them again', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    const mlb = sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB', selectedProviderMapping: providerMappingFixture() });
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: mlb } });
    listPlatformTierProfilesMock.mockResolvedValue({ data: { platformTierProfiles: [{ id: PLATFORM_TIER_PROFILE_ID, name: '4 tiers of 3' }, { id: OTHER_PLATFORM_TIER_PROFILE_ID, name: '6 tiers of 5' }] } });
    listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: platformPricingProfilesFixture() } });
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: { ...mlb, platformTierProfileId: OTHER_PLATFORM_TIER_PROFILE_ID, autoReleaseDaysBeforeStart: null } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-league-settings-edit'));
    await screen.findByRole('option', { name: '6 tiers of 5' });
    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-settings-tier-profile-input'), '6 tiers of 5');
    await userEvent.clear(screen.getByTestId('root-admin-sport-league-settings-auto-release-input'));
    await userEvent.click(screen.getByTestId('root-admin-sport-league-settings-save'));

    await waitFor(() => expect(updateSportLeagueMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { sportLeagueId: 'mlb' },
      body: { autoReleaseDaysBeforeStart: null, platformTierProfileId: OTHER_PLATFORM_TIER_PROFILE_ID },
    })));
    expect(await screen.findByTestId('root-admin-sport-league-settings-edit')).toBeInTheDocument();
  });

  it('keeps Save off on a second Edit right after a save, so nothing unchanged is sent', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    const mlb = sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB', selectedProviderMapping: providerMappingFixture() });
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: mlb } });
    listPlatformTierProfilesMock.mockResolvedValue({ data: { platformTierProfiles: [{ id: PLATFORM_TIER_PROFILE_ID, name: '4 tiers of 3' }, { id: OTHER_PLATFORM_TIER_PROFILE_ID, name: '6 tiers of 5' }] } });
    listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: platformPricingProfilesFixture() } });
    updateSportLeagueMock.mockResolvedValue({ data: { sportLeague: { ...mlb, platformTierProfileId: OTHER_PLATFORM_TIER_PROFILE_ID } } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-league-settings-edit'));
    await screen.findByRole('option', { name: '6 tiers of 5' });
    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-settings-tier-profile-input'), '6 tiers of 5');
    await userEvent.click(screen.getByTestId('root-admin-sport-league-settings-save'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-league-settings-edit'));

    expect(screen.getByTestId('root-admin-sport-league-settings-save')).toBeDisabled();
    expect(updateSportLeagueMock).toHaveBeenCalledTimes(1);
  });

  it('keeps Save off for an auto release outside 1 to 30 days, and Cancel goes back to the settings unsaved', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB', platformPricingProfileId: STANDARD_PLATFORM_PRICING_PROFILE_ID }) } });
    listPlatformTierProfilesMock.mockResolvedValue({ data: { platformTierProfiles: [] } });
    listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: [] } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-league-settings-edit'));
    const days = screen.getByTestId('root-admin-sport-league-settings-auto-release-input');
    await userEvent.clear(days);
    await userEvent.type(days, '45');

    expect(await screen.findByText('Enter 1 to 30 days, or leave it empty for no automatic release')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-settings-save')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByTestId('root-admin-sport-league-settings-auto-release')).toHaveTextContent('7 days before start');
    expect(updateSportLeagueMock).not.toHaveBeenCalled();
  });

  it('keeps the form open with the server\'s reason when the settings are refused', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture({ id: 'mlb', sport: 'BASEBALL', name: 'MLB' }) } });
    listPlatformTierProfilesMock.mockResolvedValue({ data: { platformTierProfiles: [] } });
    listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: [] } });
    updateSportLeagueMock.mockResolvedValue({
      error: { error: { code: 'PROVIDER_NOT_FOUND', message: 'BALLDONTLIE\'s mlb is switched off or not running.' } },
      response: { status: 422 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));
    await userEvent.click(await screen.findByTestId('root-admin-sport-league-settings-edit'));
    await screen.findByRole('option', { name: 'BALLDONTLIE · MLB' });
    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-settings-provider-input'), 'BALLDONTLIE · MLB');
    await userEvent.click(screen.getByTestId('root-admin-sport-league-settings-save'));

    expect(await screen.findByText('Provider not found.')).toBeInTheDocument();
    expect(updateSportLeagueMock).toHaveBeenCalledWith(expect.objectContaining({ body: { syncProviderLeagueId: '00000000-0000-4000-8000-0000000000c2' } }));
    expect(screen.getByTestId('root-admin-sport-league-settings-provider-input')).toBeInTheDocument();
  });

  it('says so in the settings dialog when the sport league cannot be read', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: overviews() } });
    getSportLeagueMock.mockResolvedValue({ error: { error: { code: 'SPORT_LEAGUE_NOT_FOUND', message: 'No such sport league.' } }, response: { status: 404 } });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-sports-settings-mlb'));

    expect(await screen.findByText('Sport league not found.')).toBeInTheDocument();
  });

  it('shows the empty line when there are no sport leagues', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage();

    expect(await screen.findByText('No sport leagues yet.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sports-counts')).toHaveTextContent('0 sports · 0 of 0 sport leagues');
  });

  it('says so when the sport leagues cannot be read', async () => {
    listSportLeagueOverviewsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Overview offline' } }, response: { status: 500 } });
    renderPage();

    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
  });
});

describe('sportsCountLine', () => {
  it('counts distinct sports and the sport leagues on out of all of them', () => {
    expect(sportsCountLine(overviews())).toBe('3 sports · 3 of 4 sport leagues');
    expect(sportsCountLine([overview()])).toBe('1 sport · 1 of 1 sport league');
  });
});
