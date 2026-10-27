import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sportLeagueFixture } from '@/features/root-admin/sport-test-fixtures';
import { bindApiMocks } from '@/test/msw-api';
import { ClutchCardPage } from './clutch-card-page';
import { championshipWeekendFixture, offerFixture } from './event-page-test-fixtures';

const { listEventPagesMock, listSportLeaguesMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return { listEventPagesMock: vi.fn(), listSportLeaguesMock: vi.fn(), mockLogger: logger };
});

bindApiMocks({ listEventPages: listEventPagesMock, listSportLeagues: listSportLeaguesMock });

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const STAT_POOL_LEAGUES = [
  sportLeagueFixture({ id: 'cw', sport: 'AMERICAN_FOOTBALL', name: 'Championship Weekend', scoringFamily: 'COMPOSITE' }),
  sportLeagueFixture({ id: 'nba-finals', sport: 'BASKETBALL', name: 'NBA Finals', scoringFamily: 'COMPOSITE' }),
  sportLeagueFixture({ id: 'retired', sport: 'HOCKEY', name: 'Stanley Cup Final', scoringFamily: 'COMPOSITE', isActive: false }),
  sportLeagueFixture({ id: 'nfl', sport: 'AMERICAN_FOOTBALL', name: 'NFL', scoringFamily: 'HEAD_TO_HEAD' }),
  sportLeagueFixture({ id: 'other-world-series', sport: 'SOCCER', name: 'World Series', scoringFamily: 'COMPOSITE' }),
];

/** Championship Weekend's page with its Clutch Card offer played on the stat pool sport league `cw`. */
function championshipWeekendPage(state: 'OPEN' | 'NOT_YET') {
  const page = championshipWeekendFixture();
  return { ...page, offers: page.offers.map((offer) => (offer.isPrimary ? { ...offer, sportLeagueId: 'cw', state } : offer)) };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/play/clutch-card']}>
        <ClutchCardPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  listEventPagesMock.mockReset();
  listSportLeaguesMock.mockReset();
  mockLogger.warn.mockClear();
});

describe('Clutch Card page', () => {
  it('leads with the tagline and hook, and its example card adds up only the best four stars', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    renderPage();

    expect(await screen.findByTestId('clutch-card-tagline')).toHaveTextContent('The biggest stars on the biggest stage.Who will come in clutch?');
    expect(screen.getByTestId('clutch-card-hook')).toHaveTextContent('Championship games hit different.');
    expect(screen.getByTestId('clutch-card-example')).toHaveTextContent('Triple Threat');
    expect(screen.getByTestId('clutch-card-example-total')).toHaveTextContent('406');
    expect(screen.getByTestId('clutch-card-example-note')).toHaveTextContent('Example card. Triple Threat = points + rebounds + assists, each game.');
    expect(screen.getByTestId('clutch-card-see-cards')).toHaveAttribute('href', '#card-types');
    expect(screen.getByTestId('clutch-card-disclaimer')).toHaveTextContent('Not affiliated with any sports league.');
  });

  it('runs its sections in the approved order, card types first and how it plays just above the questions, each one its menu jumps to', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    renderPage();

    await screen.findByTestId('clutch-card-page');
    const sections = ['clutch-card-hero', 'clutch-card-types', 'clutch-card-calendar', 'clutch-card-why', 'clutch-card-how-it-plays', 'clutch-card-faq'].map((testId) => screen.getByTestId(testId));
    sections.slice(1).forEach((section, index) => {
      expect(sections[index].compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
    const menu = within(screen.getByTestId('clutch-card-menu')).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(menu).toEqual(['#card-types', '#calendar', '#how-it-plays', '#questions']);
    expect(screen.getByTestId('clutch-card-types')).toHaveAttribute('id', 'card-types');
    expect(screen.getByTestId('clutch-card-calendar')).toHaveAttribute('id', 'calendar');
    expect(screen.getByTestId('clutch-card-how-it-plays')).toHaveAttribute('id', 'how-it-plays');
    expect(screen.getByTestId('clutch-card-faq')).toHaveAttribute('id', 'questions');
    expect(screen.getByTestId('clutch-card-how-it-plays')).toHaveTextContent('Root for every score');
  });

  it('shows each sport\'s stat line by the app\'s own name and formula, and Hat Trick as coming', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    renderPage();

    const basketball = await screen.findByTestId('clutch-card-type-BASKETBALL');
    expect(basketball).toHaveTextContent('Triple Threat');
    expect(basketball).toHaveTextContent('points + rebounds + assists');
    expect(screen.getByTestId('clutch-card-type-AMERICAN_FOOTBALL')).toHaveTextContent('Redzone');
    expect(screen.getByTestId('clutch-card-type-HOCKEY')).toHaveTextContent('2 × goals + assists + shots on goal');
    expect(screen.getByTestId('clutch-card-type-BASEBALL')).toHaveTextContent('Box Score');
    const soccer = screen.getByTestId('clutch-card-type-SOCCER');
    expect(soccer).toHaveTextContent('Hat Trick');
    expect(soccer).toHaveTextContent('Coming soon');
  });

  it('marks a title round available only while its own sport\'s stat pool league of that name is active, linking it to the event page that offers it', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendPage('NOT_YET')] } });
    renderPage();

    const championshipWeekend = await screen.findByTestId('clutch-card-round-Championship Weekend');
    expect(championshipWeekend).toHaveAttribute('href', '/play/american-football/championship-weekend');
    expect(championshipWeekend).toHaveTextContent('Redzone');
    const nbaFinals = screen.getByTestId('clutch-card-round-NBA Finals');
    expect(nbaFinals.tagName).toBe('SPAN');
    expect(nbaFinals).toHaveClass('border-primary');
    expect(screen.getByTestId('clutch-card-round-Stanley Cup Final')).toHaveClass('border-dashed');
    expect(screen.getByTestId('clutch-card-round-WNBA Finals')).toHaveClass('border-dashed');
    expect(screen.getByTestId('clutch-card-round-World Series')).toHaveClass('border-dashed');
  });

  it('starts a pool on the open Clutch Card offer before one that opens later', async () => {
    const nbaFinalsPage = {
      ...championshipWeekendFixture({ id: 'page-nba', sport: 'BASKETBALL', slug: 'nba-finals' }),
      offers: [offerFixture('nba-finals-tiered-triple-threat', { sportLeagueId: 'nba-finals', isPrimary: true, state: 'OPEN', edition: { sportEventId: 'event-nba', name: 'NBA Finals', eventYear: 2027, startDate: '2027-06-03T00:30:00.000Z', endDate: null } })],
    };
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendPage('NOT_YET'), nbaFinalsPage] } });
    renderPage();

    const start = await screen.findByTestId('clutch-card-start');
    expect(start).toHaveTextContent('Start a Clutch Card pool');
    expect(start).toHaveAttribute('href', '/start?sport=basketball&page=nba-finals&template=template-nba-finals-tiered-triple-threat');
    expect(screen.getByTestId('clutch-card-closing-start')).toHaveAttribute('href', start.getAttribute('href'));
  });

  it('offers no start button while no event page offers a Clutch Card, pointing to How to Play instead', async () => {
    listSportLeaguesMock.mockResolvedValue({ data: { sportLeagues: STAT_POOL_LEAGUES } });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [championshipWeekendFixture()] } });
    renderPage();

    expect(await screen.findByTestId('clutch-card-closing-how-to-play')).toHaveAttribute('href', '/how-to-play');
    expect(screen.queryByTestId('clutch-card-start')).not.toBeInTheDocument();
  });

  it('says the calendar failed to load, and logs it, rather than showing every round as coming', async () => {
    listSportLeaguesMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down.' } }, status: 500 });
    listEventPagesMock.mockResolvedValue({ data: { eventPages: [] } });
    renderPage();

    const calendar = await screen.findByTestId('clutch-card-calendar');
    expect(await within(calendar).findByText('Calendar unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('clutch-card-round-NBA Finals')).not.toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ action: 'clutchCardPage.sportLeagues.failed' }), 'Sport leagues failed to load');
  });
});
