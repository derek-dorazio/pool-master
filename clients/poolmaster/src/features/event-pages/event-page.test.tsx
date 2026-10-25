import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventPage } from './event-page';
import { championshipWeekendFixture } from './event-page-test-fixtures';

const { authState, getEventPageMock, listEventPagesMock, listLeaguePlansMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: false, isLoading: false, isRootAdmin: false, user: null },
    getEventPageMock: vi.fn(),
    listEventPagesMock: vi.fn(),
    listLeaguePlansMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({ getEventPage: getEventPageMock, listEventPages: listEventPagesMock, listLeaguePlans: listLeaguePlansMock });

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
}

function renderPage(entry = '/play/american-football/championship-weekend') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<EventPage />} path="/play/:sport/:pageSlug" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  getEventPageMock.mockReset();
  listEventPagesMock.mockReset();
  listLeaguePlansMock.mockReset();
  authState.isAuthenticated = false;
});

describe('Event page', () => {
  it('shows Championship Weekend\'s hook, its date, and a card per way to play, the Clutch Card saying when it opens', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    expect(await screen.findByTestId('event-page-name')).toHaveTextContent('Championship Weekend');
    expect(screen.getByTestId('event-page-hook')).toHaveTextContent('Four teams, two games, one Sunday.');
    expect(screen.getByTestId('event-page-when')).toHaveTextContent('Picks close at the first kickoff');
    expect(getEventPageMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sport: 'AMERICAN_FOOTBALL', pageSlug: 'championship-weekend' } }));

    const clutchCard = screen.getByTestId('event-page-offer-championship-weekend-tiered-redzone');
    expect(clutchCard).toHaveTextContent('Clutch Card');
    expect(clutchCard).toHaveTextContent('New');
    expect(screen.getByTestId('event-page-offer-championship-weekend-tiered-redzone-opens')).toHaveTextContent('Opens when the four teams are set');
    expect(screen.getByTestId('event-page-offer-nfl-bracket-second-chance-doubling-start')).toHaveTextContent('Start with Bracket');
    expect(screen.getByTestId('event-page-offer-nfl-squares-start')).toHaveTextContent('Start with Squares');
    expect(await screen.findByTestId('event-page-gift')).toHaveTextContent('6-month preview period');
    expect(screen.getByTestId('event-page-disclaimer')).toHaveTextContent('Not affiliated with the NFL or any sports league.');
  });

  it('sends a signed-out visitor\'s buttons to sign-up, and a signed-in one\'s to their leagues', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, paymentsEnabled: false, expansionPrices: {} } });
    const { unmount } = renderPage();

    expect(await screen.findByTestId('event-page-start')).toHaveAttribute('href', '/');
    expect(screen.getByTestId('event-page-offer-championship-weekend-tiered-redzone-start')).toHaveTextContent('Start your league now');
    unmount();

    authState.isAuthenticated = true;
    renderPage();
    expect(await screen.findByTestId('event-page-start')).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('event-page-offer-championship-weekend-tiered-redzone-start')).not.toBeInTheDocument();
  });

  it('links the sport\'s next event page after this one under Next up', async () => {
    const superBowl = championshipWeekendFixture({
      id: 'page-sb',
      slug: 'super-bowl',
      offers: [championshipWeekendFixture().offers[0]].map((offer) => ({ ...offer, edition: { ...offer.edition, startDate: '2027-02-07T23:30:00.000Z' } })),
    });
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture(), superBowl] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    const nextUp = await screen.findByTestId('event-page-next-up');
    expect(nextUp).toHaveTextContent('Super bowl');
    expect(screen.getByRole('link', { name: 'See ways to play' })).toHaveAttribute('href', '/play/american-football/super-bowl');
  });

  it('says when the next edition is not on the schedule yet for a page between seasons', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture({ offers: [] }) } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    expect(await screen.findByTestId('event-page-between-seasons')).toBeInTheDocument();
    expect(screen.queryByTestId('event-page-offers')).not.toBeInTheDocument();
  });

  it('sends a retired page with a successor to the successor\'s address', async () => {
    const retired = championshipWeekendFixture({ id: 'page-old', slug: 'conference-weekend', isActive: false, offers: [], redirectTo: { sport: 'AMERICAN_FOOTBALL', slug: 'championship-weekend' } });
    getEventPageMock.mockImplementation((options: { path?: { pageSlug?: string } }) => ({
      data: { eventPage: options.path?.pageSlug === 'conference-weekend' ? retired : championshipWeekendFixture() },
    }));
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, paymentsEnabled: false, expansionPrices: {} } });
    renderPage('/play/american-football/conference-weekend');

    expect(await screen.findByTestId('event-page-name')).toHaveTextContent('Championship Weekend');
    expect(screen.getByTestId('location')).toHaveTextContent('/play/american-football/championship-weekend');
  });

  it('says a retired page with no successor has moved, linking to How to Play', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture({ isActive: false, offers: [] }) } });
    renderPage();

    expect(await screen.findByTestId('event-page-moved')).toHaveTextContent('This page has moved');
    expect(screen.getByRole('link', { name: 'See every way to play' })).toHaveAttribute('href', '/how-to-play');
  });

  it('says an address with no page has moved, whether the API has no page there or the sport is unknown', async () => {
    getEventPageMock.mockResolvedValue({ error: { error: { code: 'EVENT_PAGE_NOT_FOUND', message: 'There is no event page at that address.' } }, status: 404 });
    const { unmount } = renderPage('/play/american-football/no-such-page');
    expect(await screen.findByTestId('event-page-moved')).toBeInTheDocument();
    unmount();

    renderPage('/play/curling/championship-weekend');
    expect(screen.getByTestId('event-page-moved')).toBeInTheDocument();
  });

  it('shows an error, not the moved page, when the page cannot load', async () => {
    getEventPageMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down.' } }, status: 500 });
    renderPage();

    expect(await screen.findByTestId('event-page-error')).toHaveTextContent('Event unavailable');
  });
});
