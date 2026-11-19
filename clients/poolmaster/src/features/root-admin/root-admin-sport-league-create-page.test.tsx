import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminSportLeagueCreatePage } from './root-admin-sport-league-create-page';
import { pricingProfilesFixture, STANDARD_PRICING_PROFILE_ID } from './sport-test-fixtures';

// /manage/sports/golf/leagues/new, the New tour page; a new tour then shows on the Sports page.

const { createSportLeagueMock, listTierProfilesMock, listPricingProfilesMock, mockLogger } = vi.hoisted(
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
      createSportLeagueMock: vi.fn(),
      listTierProfilesMock: vi.fn(),
      listPricingProfilesMock: vi.fn(),
      mockLogger: logger,
    };
  },
);

bindApiMocks({
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
  return { id: 'pga', sportId: 'sport-golf', name: 'PGA Tour', matchKeyword: 'PGA', isActive: true, ...overrides };
}

function renderPage(path = '/manage/sports/golf/leagues/new') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<div data-testid="sports-page">Sports page</div>} path="/manage/sports" />
          <Route element={<RootAdminSportLeagueCreatePage />} path="/manage/sports/:sport/leagues/new" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('RootAdminSportLeagueCreatePage', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('creates a tour with the profiles chosen, then returns to the Sports page', async () => {
    seedProfiles();
    createSportLeagueMock.mockResolvedValue({
      data: { sportLeague: league({ id: 'new', name: 'DP World Tour' }) },
    });
    renderPage();

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
    expect(await screen.findByTestId('sports-page')).toBeInTheDocument();
  });

  it('keeps Create disabled until both a tier profile and a pricing profile are chosen', async () => {
    seedProfiles();
    renderPage();

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
    renderPage();

    await userEvent.type(
      await screen.findByTestId('root-admin-sport-league-list-new-name'),
      'PGA Tour',
    );
    await chooseProfiles();
    await userEvent.click(screen.getByTestId('root-admin-sport-league-list-new-save'));

    expect(await screen.findByText('A tour with this name already exists.')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-sport-league-create-page')).toBeInTheDocument();
  });

  it('returns to the Sports page from Cancel without creating anything', async () => {
    seedProfiles();
    renderPage();

    await userEvent.click(await screen.findByRole('link', { name: 'Cancel' }));

    expect(await screen.findByTestId('sports-page')).toBeInTheDocument();
    expect(createSportLeagueMock).not.toHaveBeenCalled();
  });

  it('blocks submit until the tour name is entered', async () => {
    seedProfiles();
    renderPage();

    expect(await screen.findByTestId('root-admin-sport-league-list-new-save')).toBeDisabled();
  });
});
