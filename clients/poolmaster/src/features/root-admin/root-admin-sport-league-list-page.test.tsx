import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportLeagueCreatePage } from './root-admin-sport-league-create-page';
import { RootAdminSportLeagueListPage } from './root-admin-sport-league-list-page';
import { pricingProfilesFixture, STANDARD_PRICING_PROFILE_ID } from './sport-test-fixtures';

// /manage/sports/golf/leagues, the tours list, and its New tour page (pool-master-qqs).

const { listSportLeaguesMock, createSportLeagueMock, listTierProfilesMock, listPricingProfilesMock, mockLogger } = vi.hoisted(
  () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(),
    };
    logger.child.mockReturnValue(logger);
    return {
      listSportLeaguesMock: vi.fn(),
      createSportLeagueMock: vi.fn(),
      listTierProfilesMock: vi.fn(),
      listPricingProfilesMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
  listSportLeagues: listSportLeaguesMock,
  createSportLeague: createSportLeagueMock,
  listTierProfiles: listTierProfilesMock,
  listPricingProfiles: listPricingProfilesMock,
});

const GOLF_TIER_PROFILE_ID = '00000000-0000-4000-8000-0000000000a1';

/** The platform's profiles the New tour page offers. */
function seedProfiles() {
  listTierProfilesMock.mockResolvedValue({
    data: {
      tierProfiles: [{
        id: GOLF_TIER_PROFILE_ID, name: '6 tiers of 10', tierCount: 6, tierSize: 10, lastTier: 'ALL_REMAINING', lastTierMax: null,
        sportLeagueCount: 2, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      }],
    },
  });
  listPricingProfilesMock.mockResolvedValue({ data: { pricingProfiles: pricingProfilesFixture() } });
}

/** Picks the golf layout and Standard pricing, which the page asks for before it creates. */
async function chooseProfiles() {
  await screen.findByRole('option', { name: '6 tiers of 10' });
  await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-list-new-tier-profile'), '6 tiers of 10');
  await screen.findByRole('option', { name: 'Standard' });
  await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-list-new-pricing-profile'), 'Standard');
}

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function league(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pga',
    sportId: 'sport-golf',
    name: 'PGA Tour',
    matchKeyword: 'PGA',
    currentEventYear: 2026,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    affiliationCount: 144,
    sportEventCount: 3,
    ...overrides,
  };
}

function renderPage(path = '/manage/sports/golf/leagues') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<RootAdminSportLeagueListPage />} path="/manage/sports/:sport/leagues" />
          <Route element={<RootAdminSportLeagueCreatePage />} path="/manage/sports/:sport/leagues/new" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('pool-master-qqs RootAdminSportLeagueListPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('pool-master-qqs, plans/147: renders tours with roster and tournament counts, current year, and a row link to the tour\'s page', async () => {
    listSportLeaguesMock.mockResolvedValue({
      data: {
        sportLeagues: [
          league(),
          league({
            id: 'liv',
            name: 'LIV Golf',
            isActive: false,
            affiliationCount: 54,
            sportEventCount: 1,
            currentEventYear: null,
          }),
        ],
      },
    });

    renderPage();

    expect(await screen.findByText('PGA Tour')).toBeInTheDocument();
    expect(screen.getByText('LIV Golf')).toBeInTheDocument();
    expect(screen.getByText('144')).toBeInTheDocument();
    expect(screen.getByText('54')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-row-pga')).toBeInTheDocument();
  });

  it('pool-master-qqs shows the empty state', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage();
    expect(
      await screen.findByText('No golf tours have been created yet.'),
    ).toBeInTheDocument();
  });

  it('pool-master-qqs surfaces the load error state', async () => {
    listSportLeaguesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL', message: 'Tour index offline' } },
      response: { status: 500 },
    });
    renderPage();
    expect(await screen.findByText('Tour index offline')).toBeInTheDocument();
  });

  it('pool-master-qqs creates a tour on the New tour page with the profiles chosen, then returns to the list showing it', async () => {
    seedProfiles();
    listSportLeaguesMock
      .mockResolvedValueOnce({ data: { sportLeagues: [] } })
      .mockResolvedValue({ data: { sportLeagues: [league({ id: 'new', name: 'DP World Tour' })] } });
    createSportLeagueMock.mockResolvedValue({
      data: { sportLeague: league({ id: 'new', name: 'DP World Tour' }) },
    });

    renderPage();
    await screen.findByText('No golf tours have been created yet.');

    await userEvent.click(screen.getByTestId('root-admin-sport-league-list-new'));
    await userEvent.type(
      await screen.findByTestId('root-admin-sport-league-list-new-name'),
      'DP World Tour',
    );
    await userEvent.type(
      screen.getByTestId('root-admin-sport-league-list-new-keyword'),
      'DP World',
    );
    await chooseProfiles();
    await userEvent.click(screen.getByTestId('root-admin-sport-league-list-new-save'));

    await waitFor(() =>
      expect(createSportLeagueMock).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            sport: 'GOLF',
            name: 'DP World Tour',
            matchKeyword: 'DP World',
            tierProfileId: GOLF_TIER_PROFILE_ID,
            pricingProfileId: STANDARD_PRICING_PROFILE_ID,
          },
        }),
      ),
    );
    expect(await screen.findByTestId('root-admin-sport-league-row-new')).toBeInTheDocument();
  });

  it('keeps Create disabled until both a tier profile and a pricing profile are chosen', async () => {
    seedProfiles();
    renderPage('/manage/sports/golf/leagues/new');

    await userEvent.type(await screen.findByTestId('root-admin-sport-league-list-new-name'), 'DP World Tour');
    await screen.findByRole('option', { name: '6 tiers of 10' });
    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-list-new-tier-profile'), '6 tiers of 10');
    expect(screen.getByTestId('root-admin-sport-league-list-new-save')).toBeDisabled();

    await userEvent.selectOptions(screen.getByTestId('root-admin-sport-league-list-new-pricing-profile'), 'Standard');
    await waitFor(() => expect(screen.getByTestId('root-admin-sport-league-list-new-save')).toBeEnabled());
    expect(createSportLeagueMock).not.toHaveBeenCalled();
  });

  it('keeps the New tour page open with the server\'s reason when creating the tour is refused', async () => {
    seedProfiles();
    createSportLeagueMock.mockResolvedValue({
      error: { error: { code: 'CONFLICT', message: 'A tour with this name already exists.' } },
      response: { status: 409 },
    });
    renderPage('/manage/sports/golf/leagues/new');

    await userEvent.type(
      await screen.findByTestId('root-admin-sport-league-list-new-name'),
      'PGA Tour',
    );
    await chooseProfiles();
    await userEvent.click(screen.getByTestId('root-admin-sport-league-list-new-save'));

    expect(await screen.findByText('A tour with this name already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-create-page')).toBeInTheDocument();
  });

  it('returns to the tours list from New tour\'s Cancel without creating anything', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage('/manage/sports/golf/leagues/new');

    await userEvent.click(await screen.findByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('root-admin-sport-league-list-page')).toBeInTheDocument();
    expect(createSportLeagueMock).not.toHaveBeenCalled();
  });

  it('narrows the tours list with the search box', async () => {
    listSportLeaguesMock.mockResolvedValue({
      data: { sportLeagues: [league(), league({ id: 'liv', name: 'LIV Golf', matchKeyword: 'LIV' })] },
    });
    renderPage();
    await screen.findByText('PGA Tour');

    await userEvent.type(screen.getByTestId('root-admin-sport-league-list-search'), 'LIV');

    await waitFor(() => expect(screen.queryByText('PGA Tour')).not.toBeInTheDocument());
    expect(screen.getByText('LIV Golf')).toBeInTheDocument();
  });

  it('pool-master-qqs blocks submit until the tour name is entered', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: [] } });
    renderPage();
    await screen.findByText('No golf tours have been created yet.');

    await userEvent.click(screen.getByTestId('root-admin-sport-league-list-new'));
    expect(await screen.findByTestId('root-admin-sport-league-list-new-save')).toBeDisabled();
  });
});
