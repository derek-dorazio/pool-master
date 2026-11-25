import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { EventPage, MovedPage } from './event-page';
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
          <Route element={<EventPage />} path="/play/:sportUrlSegment/:urlSegment" />
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
  it('shows Championship Weekend\'s hook, its date, and a card per way to play, the bracket saying when it opens', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    expect(await screen.findByTestId('event-page-name')).toHaveTextContent('Championship Weekend');
    expect(screen.getByTestId('event-page-hook')).toHaveTextContent('Four teams, two games, one Sunday.');
    expect(screen.getByTestId('event-page-when')).toHaveTextContent('Picks close at the first kickoff');
    expect(getEventPageMock).toHaveBeenCalledWith(expect.objectContaining({ path: { sportUrlSegment: 'american-football', urlSegment: 'championship-weekend' } }));

    expect(screen.getByTestId('event-page-offer-nfl-bracket-second-chance-doubling')).toHaveTextContent('Bracket');
    expect(screen.getByTestId('event-page-offer-nfl-bracket-second-chance-doubling-opens')).toHaveTextContent('Opens when the four teams are set');
    expect(screen.getByTestId('event-page-offer-nfl-squares-start')).toHaveTextContent('Start with Squares');
    expect(await screen.findByTestId('event-page-gift')).toHaveTextContent('Premium free for 6 months');
    expect(screen.getByTestId('event-page-disclaimer')).toHaveTextContent('Not affiliated with the NFL or any sports league.');
  });

  it('shows no gift chip while the plan list offers no preview', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: null, paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    expect(await screen.findByTestId('event-page-name')).toHaveTextContent('Championship Weekend');
    await vi.waitFor(() => expect(listLeaguePlansMock).toHaveBeenCalled());
    // Let the resolved plan list render before checking that it adds nothing.
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    expect(screen.queryByTestId('event-page-gift')).not.toBeInTheDocument();
  });

  it('heads the page with its sport\'s photo, the same file as the email header, as decoration the screen reader skips', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    const photo = await screen.findByTestId('event-page-photo');
    expect(photo).toHaveAttribute('src', '/email/sports/american-football.jpg');
    expect(photo).toHaveAttribute('alt', '');
  });

  it('sends every button to the start flow with its page and contest setup, the top one with the headline offer\'s', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    const start = '/start?sport=american-football&page=championship-weekend&template=';
    expect(await screen.findByTestId('event-page-start')).toHaveAttribute('href', `${start}template-nfl-bracket-second-chance-doubling`);
    expect(screen.getByTestId('event-page-offer-nfl-bracket-second-chance-doubling-start')).toHaveTextContent('Start your league now');
    expect(screen.getByTestId('event-page-offer-nfl-squares-start')).toHaveAttribute('href', `${start}template-nfl-squares`);
  });

  it('links the sport\'s next event page after this one under Next up', async () => {
    const superBowl = championshipWeekendFixture({
      id: 'page-sb',
      urlSegment: 'super-bowl',
      path: '/play/american-football/super-bowl',
      offers: [championshipWeekendFixture().offers[0]].map((offer) => ({ ...offer, nextSlot: { ...offer.nextSlot, startDate: '2027-02-07T23:30:00.000Z' } })),
    });
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture(), superBowl] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    const nextUp = await screen.findByTestId('event-page-next-up');
    expect(nextUp).toHaveTextContent('Super bowl');
    expect(screen.getByRole('link', { name: 'See ways to play' })).toHaveAttribute('href', '/play/american-football/super-bowl');
    expect(listEventPagesMock).toHaveBeenCalledWith(expect.objectContaining({ query: { sport: 'AMERICAN_FOOTBALL', upcoming: 'true' } }));
  });

  it('says when the next slot is not on the schedule yet for a page between seasons', async () => {
    getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture({ offers: [] }) } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
    renderPage();

    expect(await screen.findByTestId('event-page-between-seasons')).toBeInTheDocument();
    expect(screen.queryByTestId('event-page-offers')).not.toBeInTheDocument();
  });

  it('sends a retired page with a successor to the successor\'s address', async () => {
    const retired = championshipWeekendFixture({ id: 'page-old', urlSegment: 'conference-weekend', path: '/play/american-football/conference-weekend', isActive: false, offers: [], redirectTo: { sport: 'AMERICAN_FOOTBALL', sportName: 'American football', sportUrlSegment: 'american-football', urlSegment: 'championship-weekend', path: '/play/american-football/championship-weekend' } });
    getEventPageMock.mockImplementation((options: { path?: { urlSegment?: string } }) => ({
      data: { eventPage: options.path?.urlSegment === 'conference-weekend' ? retired : championshipWeekendFixture() },
    }));
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    listLeaguePlansMock.mockResolvedValue({ data: { plans: [], previewPeriodMonths: 6, previewPlan: 'PREMIUM', paymentsEnabled: false, expansionPrices: {} } });
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

  it('says an address with no page has moved, whether the API has no page there or the address could name none, without asking for that one', async () => {
    getEventPageMock.mockResolvedValue({ error: { error: { code: 'EVENT_PAGE_NOT_FOUND', message: 'There is no event page at that address.' } }, status: 404 });
    const { unmount } = renderPage('/play/american-football/no-such-page');
    expect(await screen.findByTestId('event-page-moved')).toBeInTheDocument();
    unmount();

    getEventPageMock.mockClear();
    renderPage('/play/American_Football/championship-weekend');
    expect(screen.getByTestId('event-page-moved')).toBeInTheDocument();
    expect(getEventPageMock).not.toHaveBeenCalled();
  });

  it('keeps the Clutch Card\'s old address as an inactive page that links to How to Play, reading no event page', () => {
    render(
      <MemoryRouter initialEntries={['/play/clutch-card']}>
        <Routes>
          <Route element={<MovedPage />} path="/play/clutch-card" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('event-page-moved')).toHaveTextContent('This page has moved');
    expect(screen.getByRole('link', { name: 'See every way to play' })).toHaveAttribute('href', '/how-to-play');
    expect(getEventPageMock).not.toHaveBeenCalled();
  });

  it('shows an error, not the moved page, when the page cannot load, and Retry reads the page again', async () => {
    getEventPageMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down.' } }, status: 500 });
    renderPage();

    expect(await screen.findByTestId('event-page-error')).toHaveTextContent("We couldn't load this event.");
    const reads = getEventPageMock.mock.calls.length;
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(getEventPageMock.mock.calls.length).toBeGreaterThan(reads));
  });
});
