import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventFieldTab } from './event-field-tab';
import { EventTabOutlet } from './test/event-tab-outlet';
import {
  fieldEntryFixture,
  participantFixture,
  platformPricingProfilesFixture,
  sportLeagueFixture,
  sportEventFixture,
  sportEventOverviewFixture,
  tierFixture,
  valuationFixture,
} from './sport-test-fixtures';

// The Field section's automatic tiers and prices (#1890), which replaced the tiers page's buttons.

const {
  getEventMock,
  listEventTiersMock,
  listEventParticipantsMock,
  autoAssignEventTiersMock,
  autoAssignEventPricesMock,
  updateEventParticipantsMock,
  listPlatformPricingProfilesMock,
  getSportLeagueMock,
  mockLogger,
} = vi.hoisted(() => {
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
    getEventMock: vi.fn(),
    listEventTiersMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    autoAssignEventTiersMock: vi.fn(),
    autoAssignEventPricesMock: vi.fn(),
    updateEventParticipantsMock: vi.fn(),
    listPlatformPricingProfilesMock: vi.fn(),
    getSportLeagueMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEvent: getEventMock,
  listEventTiers: listEventTiersMock,
  listEventParticipants: listEventParticipantsMock,
  autoAssignEventTiers: autoAssignEventTiersMock,
  autoAssignEventPrices: autoAssignEventPricesMock,
  updateEventParticipants: updateEventParticipantsMock,
  listPlatformPricingProfiles: listPlatformPricingProfilesMock,
  getSportLeague: getSportLeagueMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function tournament(overrides: Parameters<typeof sportEventFixture>[0] = {}) {
  return sportEventFixture({
    id: 'evt-1',
    name: 'The Open',
    venue: 'Royal Liverpool',
    location: 'Hoylake',
    startDate: '2026-07-16T08:00:00.000Z',
    endDate: '2026-07-19T20:00:00.000Z',
    status: 'DRAFT',
    rounds: 4,
    sportLeagueSeasonId: 'season-2026',
    championshipYear: 2026,
    sportLeagueId: 'league-1',
    autoLifecycleEnabled: true,
    participantCount: 3,
    tierCount: 2,
    adminCounts: { untieredParticipantCount: 0, unpricedParticipantCount: 0, emptyTierNumbers: [], contestCount: 0 },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    allowedTransitions: [],
    ...overrides,
  });
}

// #236: a golfer's tier and order are on its valuation; tiers carry no assignments.
function fieldEntry(
  sep: string,
  name: string,
  price: number | null = 9000,
  tierId: string | null = null,
  tierOrderIndex: number | null = null,
) {
  return fieldEntryFixture({
    id: sep,
    participantId: `p-${sep}`,
    participant: participantFixture({ id: `p-${sep}`, name }),
    ranking: 3,
    oddsToWin: 8,
    seedNumber: 3,
    valuation: valuationFixture({ sportEventTierId: tierId, tierOrderIndex, price }),
  });
}

function tier(n: number, tierNumber = n) {
  return tierFixture({ id: `tier-id-${n}`, sportEventId: 'evt-1', tierKey: `tier-${n}`, tierNumber });
}

function seed(overrides: { tournament?: Parameters<typeof tournament>[0] } = {}) {
  getEventMock.mockResolvedValue({
    data: { event: tournament(overrides.tournament) },
  });
  listEventParticipantsMock.mockResolvedValue({
    data: {
      participants: [
        fieldEntry('sep-1', 'Rory', 9000, 'tier-id-1', 0),
        fieldEntry('sep-2', 'Scottie', 9800, 'tier-id-1', 1),
        fieldEntry('sep-3', 'Jon', 8500),
      ],
    },
  });
  listEventTiersMock.mockResolvedValue({
    data: { tiers: [tier(1), tier(2), tier(3)] },
  });
  listPlatformPricingProfilesMock.mockResolvedValue({ data: { platformPricingProfiles: platformPricingProfilesFixture() } });
  getSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture() } });
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/manage/sports/golf/events/evt-1/field']}>
        <Routes>
          <Route element={<EventTabOutlet overview={sportEventOverviewFixture()} />} path="/manage/sports/:sport/events/:eventId">
            <Route element={<EventFieldTab />} path="field" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the Field section\'s automatic tiers and prices', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mockLogger.child.mockReturnValue(mockLogger);
  });

  it('auto-assigns tiers with one button behind a confirmation that names the value ordering the field, sending no source', async () => {
    seed();
    autoAssignEventTiersMock.mockResolvedValue({ data: null });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-tier-auto-tiers'));
    expect(screen.getByTestId('root-admin-tier-auto-tiers-modal')).toHaveTextContent('Ordered by odds, shortest first.');
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-tiers-confirm'));

    await waitFor(() =>
      expect(autoAssignEventTiersMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: {},
        }),
      ),
    );
  });

  it('prices the field with its sport league\'s profile, previewing the best and worst price in domain words, and with a changed one', async () => {
    seed({ tournament: { pricing: null } });
    autoAssignEventPricesMock.mockResolvedValue({ data: { participants: [] } });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('root-admin-tier-auto-prices')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-prices'));
    expect(screen.getByTestId('root-admin-tier-auto-prices-profile')).toHaveValue('Standard');
    expect(screen.getByTestId('root-admin-tier-auto-prices-salaryCap')).toHaveValue('50000');
    expect(screen.getByTestId('root-admin-tier-auto-prices-preview')).toHaveTextContent(
      'Best participant $12,000, worst $6,000, across 3 active participants.',
    );

    await userEvent.selectOptions(screen.getByTestId('root-admin-tier-auto-prices-profile'), 'Small');
    expect(screen.getByTestId('root-admin-tier-auto-prices-salaryCap')).toHaveValue('5000');
    await userEvent.clear(screen.getByTestId('root-admin-tier-auto-prices-steepness'));
    await userEvent.type(screen.getByTestId('root-admin-tier-auto-prices-steepness'), '1');
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-prices-confirm'));

    await waitFor(() =>
      expect(autoAssignEventPricesMock).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { eventId: 'evt-1' },
          body: { profileName: 'Small', salaryCap: 5000, unit: 10, topSharePercent: 24, floorSharePercent: 12, steepness: 1 },
        }),
      ),
    );
  });

  it('starts the price dialog on the sport league\'s pricing profile, not the first profile by name', async () => {
    seed({ tournament: { pricing: null } });
    const [small] = platformPricingProfilesFixture();
    getSportLeagueMock.mockResolvedValue({ data: { sportLeague: sportLeagueFixture({ platformPricingProfileId: small.id }) } });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('root-admin-tier-auto-prices')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-prices'));
    expect(screen.getByTestId('root-admin-tier-auto-prices-profile')).toHaveValue('Small');
    expect(screen.getByTestId('root-admin-tier-auto-prices-salaryCap')).toHaveValue('5000');
    const [request] = getSportLeagueMock.mock.calls[0] as [{ path: { sportLeagueId: string } }];
    expect(request.path.sportLeagueId).toBe('league-1');
  });

  it('auto-assigns tiers, and keeps the confirmation open with the reason when the server refuses', async () => {
    seed();
    autoAssignEventTiersMock.mockResolvedValue({
      error: { error: { code: 'SPORT_EVENT_TIERS_LOCKED', message: 'Tiers are locked for this tournament.' } },
      response: { status: 409 },
    });
    renderPage();

    await userEvent.click(await screen.findByTestId('root-admin-tier-auto-tiers'));
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-tiers-confirm'));

    await waitFor(() =>
      expect(autoAssignEventTiersMock).toHaveBeenCalledWith(
        expect.objectContaining({ body: {} }),
      ),
    );
    const modal = screen.getByTestId('root-admin-tier-auto-tiers-modal');
    expect(await within(modal).findByText('This event has been released, so its tiers and prices are locked.')).toBeInTheDocument();
  });

  it('refuses pricing values that contradict each other or are not numbers, naming the problem', async () => {
    seed();
    renderPage();

    await waitFor(() => expect(screen.getByTestId('root-admin-tier-auto-prices')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-prices'));
    const floor = screen.getByTestId('root-admin-tier-auto-prices-floorSharePercent');
    const confirm = screen.getByTestId('root-admin-tier-auto-prices-confirm');

    await userEvent.clear(floor);
    await userEvent.type(floor, '30');
    expect(screen.getByText('The worst seed\'s share can\'t be above the best seed\'s.')).toBeInTheDocument();
    expect(confirm).toBeDisabled();

    await userEvent.clear(screen.getByTestId('root-admin-tier-auto-prices-salaryCap'));
    await userEvent.type(screen.getByTestId('root-admin-tier-auto-prices-salaryCap'), '500.5');
    expect(screen.getByText('Enter whole dollars for the cap and rounding, and shares and steepness above 0.')).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    expect(autoAssignEventPricesMock).not.toHaveBeenCalled();
  });

  it('starts the price dialog from the values the event was last priced with', async () => {
    seed({ tournament: { pricing: { profileName: 'Standard', salaryCap: 50000, unit: 100, topSharePercent: 30, floorSharePercent: 12, steepness: 4 } } });
    renderPage();

    await waitFor(() => expect(screen.getByTestId('root-admin-tier-auto-prices')).toBeEnabled());
    await userEvent.click(screen.getByTestId('root-admin-tier-auto-prices'));
    expect(screen.getByTestId('root-admin-tier-auto-prices-topSharePercent')).toHaveValue('30');
    expect(screen.getByTestId('root-admin-tier-auto-prices-confirm')).toHaveTextContent('Replace prices');
  });
});
