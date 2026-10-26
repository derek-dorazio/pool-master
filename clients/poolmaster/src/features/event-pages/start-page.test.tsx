import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LeagueRole } from '@poolmaster/shared/domain';
import { bindApiMocks } from '@/test/msw-api';
import { buildLeague, buildLeagueMembership, listLeaguesData } from '@/features/leagues/test/fixtures';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import { championshipWeekendFixture } from './event-page-test-fixtures';
import { StartPage } from './start-page';

const { authState, getEventPageMock, listContestsMock, listLeaguesMock, listSportLeaguesUsedMock, mockLogger } = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    authState: { isAuthenticated: true, isLoading: false, isRootAdmin: false, user: null },
    getEventPageMock: vi.fn(),
    listContestsMock: vi.fn(),
    listLeaguesMock: vi.fn(),
    listSportLeaguesUsedMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getEventPage: getEventPageMock,
  listContests: listContestsMock,
  listLeagues: listLeaguesMock,
  listSportLeaguesUsed: listSportLeaguesUsedMock,
});

vi.mock('@/features/auth/auth-context', () => ({ useAuth: () => authState }));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

const SQUARES = '/start?sport=american-football&page=championship-weekend&template=template-nfl-squares';
const CLUTCH_CARD = '/start?sport=american-football&page=championship-weekend&template=template-championship-weekend-tiered-redzone';

function LocationProbe() {
  const location = useLocation();
  return (
    <p data-testid="location" data-state={JSON.stringify(location.state)}>{`${location.pathname}${location.search}`}</p>
  );
}

function renderStart(entry: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route element={<StartPage />} path="/start" />
          <Route element={<p>elsewhere</p>} path="*" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function leagueRun(code: string, overrides: Parameters<typeof buildLeague>[0] = {}) {
  return buildLeague({ id: `league-${code}`, leagueCode: code, name: `${code} league`, ...overrides });
}

function primeLeagues(leagues: ReturnType<typeof buildLeague>[], role: LeagueRole = LeagueRole.COMMISSIONER) {
  getEventPageMock.mockResolvedValue({ data: { eventPage: championshipWeekendFixture() } });
  listLeaguesMock.mockResolvedValue({
    data: listLeaguesData(leagues, leagues.map((league) => buildLeagueMembership({ id: `m-${league.id}`, leagueId: league.id, role }))),
  });
  listContestsMock.mockResolvedValue({ data: { contests: [] } });
}

afterEach(() => {
  getEventPageMock.mockReset();
  listContestsMock.mockReset();
  listLeaguesMock.mockReset();
  listSportLeaguesUsedMock.mockReset();
  authState.isAuthenticated = true;
});

describe('Start from an event page', () => {
  it('sends a signed-out visitor to create an account, keeping the start as the way back', () => {
    authState.isAuthenticated = false;

    renderStart(SQUARES);

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/$/);
    expect(JSON.parse(screen.getByTestId('location').getAttribute('data-state') ?? '{}')).toEqual({ authMode: 'register', from: SQUARES });
  });

  it('takes the commissioner of one league straight to Create contest on the open offer\'s edition', async () => {
    primeLeagues([leagueRun('OFFICE')]);

    renderStart(SQUARES);

    expect(await screen.findByText(/admin\/contests\/new/)).toHaveTextContent(
      '/league/OFFICE/admin/contests/new?template=template-nfl-squares&event=event-nfl-squares',
    );
  });

  it('takes the commissioner of one league to its home when the offer is not open yet', async () => {
    primeLeagues([leagueRun('OFFICE')]);

    renderStart(CLUTCH_CARD);

    expect(await screen.findByText(/^\/league\/OFFICE\?/)).toHaveTextContent(
      '/league/OFFICE?sport=american-football&page=championship-weekend&template=template-championship-weekend-tiered-redzone',
    );
  });

  it('lists only the leagues the commissioner runs: Set up where it can, View where it has one, See plans where its year is used up', async () => {
    const capped = leagueRun('GOLF', { planEntitlements: buildPlanEntitlements({ caps: { ENTRIES_PER_CONTEST: null, SPORTS_LEAGUES_PER_YEAR: 5 } }) });
    primeLeagues([leagueRun('OFFICE'), leagueRun('FAMILY'), capped]);
    listContestsMock.mockImplementation(({ path }: { path: { id: string } }) => Promise.resolve({
      data: {
        contests: path.id === 'league-FAMILY'
          ? [{ id: 'contest-sq', selectionType: 'SQUARES', sportEvents: [{ sportEventId: 'event-nfl-squares', sequence: 1, name: 'NFL Playoffs' }] }]
          : [],
      },
    }));
    listSportLeaguesUsedMock.mockResolvedValue({ data: { seasonYear: 2027, sportLeagueIds: ['a', 'b', 'c', 'd', 'e'] } });

    renderStart(SQUARES);

    expect(await screen.findByTestId('start-league-OFFICE-set-up')).toHaveAttribute('href', '/league/OFFICE/admin/contests/new?template=template-nfl-squares&event=event-nfl-squares');
    expect(await screen.findByTestId('start-league-FAMILY-view')).toHaveAttribute('href', '/league/FAMILY/admin/contests/contest-sq');
    expect(await screen.findByTestId('start-league-GOLF-plans')).toHaveAttribute('href', '/league/GOLF/admin/plan');
    expect(screen.getByTestId('start-league-GOLF')).toHaveTextContent('sports leagues for 2027 are used');
    expect(screen.getByTestId('start-new-league')).toHaveTextContent('Start a new league instead');
  });

  it('offers no Set up while a league is being checked, and none when the check fails', async () => {
    primeLeagues([leagueRun('OFFICE'), leagueRun('FAMILY')]);
    listContestsMock.mockImplementation(({ path }: { path: { id: string } }) => (path.id === 'league-FAMILY'
      ? new Promise(() => undefined)
      : Promise.resolve({ error: { error: { code: 'INTERNAL_ERROR', message: 'boom' } }, response: { status: 500 } })));

    renderStart(SQUARES);

    expect(await screen.findByText(/We couldn't check this league/)).toHaveAttribute('data-testid', 'start-league-OFFICE-status');
    expect(screen.getByTestId('start-league-FAMILY-status')).toHaveTextContent('Checking this league');
    expect(screen.queryByTestId('start-league-OFFICE-set-up')).not.toBeInTheDocument();
    expect(screen.queryByTestId('start-league-FAMILY-set-up')).not.toBeInTheDocument();
  });

  it('tells a commissioner whose only leagues are inactive to reactivate one or start a new one', async () => {
    primeLeagues([leagueRun('OFFICE', { isActive: false })]);

    renderStart(SQUARES);

    const page = await screen.findByTestId('start-page');
    expect(page).toHaveTextContent('The leagues you run are inactive');
    expect(page).not.toHaveTextContent('Contests are started by a league\'s commissioner');
  });

  it('says so when the page link cannot be copied, so the button does not look dead', async () => {
    primeLeagues([leagueRun('OFFICE')], LeagueRole.MEMBER);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });

    renderStart(SQUARES);
    fireEvent.click(await screen.findByTestId('start-share-with-commissioner'));

    expect(await screen.findByTestId('start-share-failed')).toHaveTextContent('Couldn\'t copy the link');
  });

  it('offers a member who runs no league their own league or the page to send their commissioner', async () => {
    primeLeagues([leagueRun('OFFICE')], LeagueRole.MEMBER);

    renderStart(SQUARES);

    const page = await screen.findByTestId('start-page');
    expect(within(page).getByRole('heading')).toHaveTextContent('Start your own league');
    expect(screen.getByTestId('start-new-league')).toBeInTheDocument();
    expect(screen.getByTestId('start-share-with-commissioner')).toHaveTextContent('Share with your commissioner');
    expect(screen.queryByTestId('create-league-modal')).not.toBeInTheDocument();
  });

  it('opens Create league at once for someone with no league, saying the contest comes next', async () => {
    primeLeagues([]);

    renderStart(SQUARES);

    expect(await screen.findByTestId('create-league-next-step')).toHaveTextContent('Next: your Squares for Championship Weekend');
    expect(screen.queryByTestId('start-share-with-commissioner')).not.toBeInTheDocument();
  });

  it('says a setup no edition can take any more has started, and links back to the page', async () => {
    primeLeagues([leagueRun('OFFICE')]);

    renderStart('/start?sport=american-football&page=championship-weekend&template=template-gone');

    expect(await screen.findByTestId('start-offer-gone')).toHaveTextContent('This one has started');
  });
});
