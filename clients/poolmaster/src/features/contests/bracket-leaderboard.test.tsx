import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import {
  bracketContestFixture,
  bracketLeaderboardFixture,
  bracketLeagueContextFixture,
  filledBracketGames,
  gamePicksFixture,
} from './test/bracket-fixtures';

const {
  getBracketLeaderboardMock,
  getContestLeaderboardMock,
  getContestMock,
  getEventMock,
  getGamePicksMock,
  getLeagueMock,
  getSportLeagueMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getBracketLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getEventMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getSportLeagueMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getBracketLeaderboard: getBracketLeaderboardMock,
  getContest: getContestMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getEvent: getEventMock,
  getGamePicks: getGamePicksMock,
  getLeague: getLeagueMock,
  getSportLeague: getSportLeagueMock,
});

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'member@example.com',
      username: 'member@example.com',
      firstName: 'Morgan',
      lastName: 'Member',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function EntryDestination() {
  const { entryId } = useParams<{ entryId: string }>();
  return <div data-testid="entry-destination">{entryId}</div>;
}

/** The page's address and how it last moved, so a test can tell a replace from a push. */
function AddressProbe() {
  const location = useLocation();
  return <div data-testid="address">{`${location.search}|${useNavigationType()}`}</div>;
}

function renderLeaderboard(search = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1/leaderboard', search }]}>
        <Routes>
          <Route element={<><ContestLeaderboardPage /><AddressProbe /></>} path="/league/:leagueCode/contests/:contestId/leaderboard" />
          <Route element={<EntryDestination />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks() {
  getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: 'ACTIVE' }) } });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
  getEventMock.mockResolvedValue({ data: { event: { id: 'event-1', sport: 'BASKETBALL', sportLeagueId: 'sport-league-1', startDate: '2099-03-19T16:00:00.000Z' } } });
  getSportLeagueMock.mockResolvedValue({ data: { sportLeague: { id: 'sport-league-1', name: 'NCAA Men', roundNames: [] } } });
}

describe('Bracket contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getBracketLeaderboardMock, getContestLeaderboardMock, getContestMock, getEventMock, getGamePicksMock, getLeagueMock, getSportLeagueMock]) {
      mock.mockReset();
    }
  });

  it('ranks a bracket contest\'s entries from the bracket board with place, entry with its bracket icon and (i), champion, points, right picks and most possible, and never reads the roster board', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard();

    const leader = await screen.findByTestId('bracket-leaderboard-row-entry-2');
    expect(within(leader).getByTestId('bracket-leaderboard-place-entry-2')).toHaveTextContent('1');
    expect(leader).toHaveTextContent('Chalk All The Way');
    expect(leader).not.toHaveTextContent('Derek’s Great Golf Guys');
    expect(within(leader).getByRole('button', { name: 'About Chalk All The Way' })).toBeInTheDocument();
    expect(within(leader).getByRole('button', { name: 'View bracket: Chalk All The Way' })).toHaveAttribute('title', 'View bracket');
    expect(within(leader).getByTestId('bracket-leaderboard-champion-entry-2')).toHaveTextContent('1Duke');
    expect(within(leader).getByTestId('bracket-leaderboard-champion-entry-2')).toHaveAttribute('data-mark', 'none');
    expect(within(leader).getByTestId('bracket-leaderboard-points-entry-2')).toHaveTextContent('12');
    expect(within(leader).getByTestId('bracket-leaderboard-right-entry-2')).toHaveTextContent('5');
    expect(within(leader).getByTestId('bracket-leaderboard-max-entry-2')).toHaveTextContent('20');
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent.replace(/[^A-Za-z]/g, ''))).toEqual(['Place', 'Entry', 'Champion', 'Pts', 'Right', 'Max']);

    const mine = screen.getByTestId('bracket-leaderboard-row-entry-1');
    expect(mine).toHaveTextContent('Yours');
    expect(screen.getByTestId('bracket-leaderboard-my-best')).toHaveTextContent('Your best: 2 · Derek’s Bracket, 8 pts');
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('strikes an entry\'s champion through in red with a cross once that team is out', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard();

    // Once the viewer's league has loaded the board stops re-rendering its rows.
    await screen.findByText('Yours');
    const champion = screen.getByTestId('bracket-leaderboard-champion-entry-1');
    expect(champion).toHaveAttribute('data-mark', 'wrong');
    expect(within(champion).getByText('Houston')).toHaveClass('line-through');
    expect(within(champion).getByLabelText('Wrong')).toBeInTheDocument();
  });

  it('keeps the Entry column pinned while the board scrolls sideways, a long name cut short (whole on hover) so its (i) stays beside it', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard();

    const header = (await screen.findByRole('columnheader', { name: 'Entry' }));
    expect(header).toHaveClass('sticky', 'left-0');
    expect(within(screen.getByTestId('bracket-leaderboard-row-entry-2')).getAllByRole('cell')[1]).toHaveClass('sticky', 'left-0');
    expect(screen.getByRole('columnheader', { name: 'Champion' })).not.toHaveClass('sticky');
    const name = screen.getByTestId('bracket-leaderboard-entry-link-entry-2');
    expect(name).toHaveClass('truncate');
    expect(name).toHaveAttribute('title', 'Chalk All The Way');
  });

  it('opens an entry\'s whole bracket read-only in a dialog from its bracket icon, titled with the entry and its standing, and closes it from Close', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    getGamePicksMock.mockResolvedValue({
      data: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, status: 'SUBMITTED', tiebreakerValue: 141, games: filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true })) }),
    });
    renderLeaderboard();

    await screen.findByText('Yours');
    fireEvent.click(screen.getByTestId('bracket-leaderboard-open-entry-2'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Chalk All The Way' })).toBeInTheDocument();
    expect(within(dialog).queryByText('Yours')).not.toBeInTheDocument();
    expect(within(dialog).getByTestId('bracket-dialog-standing')).toHaveTextContent('1st · 12 pts · 5 right · 20 max · Champion: Duke');
    expect(await within(dialog).findByTestId('bracket-board')).toBeInTheDocument();
    expect(getGamePicksMock.mock.calls[0]?.[0]).toMatchObject({ path: { contestId: 'contest-1', entryId: 'entry-2', sportEventId: 'event-1' } });
    expect(within(dialog).queryByRole('button', { pressed: false })).not.toBeInTheDocument();

    // Radix tabs switch on the press, as a tap does.
    fireEvent.mouseDown(within(dialog).getByRole('tab', { name: 'National Championship' }));
    expect(within(dialog).getByTestId('bracket-champion')).toHaveTextContent('Duke');
    expect(within(dialog).getByTestId('bracket-view-tiebreaker')).toHaveTextContent('Tiebreaker: 141 total points in the final.');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the bracket of the entry a link names (?entry=) in its dialog, and drops ?entry= by replace when it closes', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    getGamePicksMock.mockResolvedValue({
      data: gamePicksFixture({ entryId: 'entry-2', entryName: 'Chalk All The Way', ownEntry: false, status: 'SUBMITTED', games: filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true })) }),
    });
    renderLeaderboard('?entry=entry-2');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Chalk All The Way' })).toBeInTheDocument();
    expect(screen.getByTestId('bracket-leaderboard-row-entry-2')).toHaveAttribute('aria-current', 'true');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByTestId('address')).toHaveTextContent(/^\|REPLACE$/);
  });

  it('opens no dialog for a linked entry My entries hides, or one the board doesn\'t hold', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard('?mine=1&entry=entry-2');

    // Once the viewer's league has loaded, My entries narrows the board to theirs.
    expect(await screen.findByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.queryByTestId('bracket-leaderboard-row-entry-2')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(getGamePicksMock).not.toHaveBeenCalled();
  });

  it('marks the viewer\'s own bracket as theirs in the dialog\'s title, with its champion as their champion', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    getGamePicksMock.mockResolvedValue({ data: gamePicksFixture({ status: 'SUBMITTED', games: filledBracketGames().map((game) => ({ ...game, locked: true, revealed: true })) }) });
    renderLeaderboard();

    await screen.findByText('Yours');
    fireEvent.click(screen.getByTestId('bracket-leaderboard-open-entry-1'));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: /Derek’s Bracket/ })).toHaveTextContent('Yours');
    expect(within(dialog).getByTestId('bracket-dialog-standing')).toHaveTextContent('2nd · 8 pts · 4 right · 16 max · Champion: Houston');
  });

  it('says so in the dialog when the bracket cannot be read, with a retry', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    getGamePicksMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'Boom.' } }, status: 500 });
    renderLeaderboard();

    await screen.findByText('Yours');
    fireEvent.click(screen.getByTestId('bracket-leaderboard-open-entry-2'));

    expect(await screen.findByTestId('bracket-dialog-error')).toBeInTheDocument();
  });

  it('opens an entry\'s filled bracket from its name on the board', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard();

    // Once the viewer's league has loaded the board stops re-rendering its rows.
    await screen.findByText('Yours');
    fireEvent.click(screen.getByTestId('bracket-leaderboard-entry-link-entry-2'));

    expect(await screen.findByTestId('entry-destination')).toHaveTextContent('entry-2');
  });

  it('says what the final scored once it is played, since tiebreakers are measured against it', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture({ finalTotalPoints: 138 }) });
    renderLeaderboard();

    expect(await screen.findByTestId('bracket-leaderboard-final-total')).toHaveTextContent('The final scored 138 total points');
  });

  it('says a cancelled event scores nothing in place of the frozen-standings note once the contest is Final', async () => {
    primeMocks();
    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: 'COMPLETED' }) } });
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture({ eventCancelled: true, gameCount: 0 }) });
    renderLeaderboard();

    expect(await screen.findByTestId('bracket-leaderboard-cancelled-note')).toHaveTextContent('This event was cancelled, so no bracket scores any points.');
    expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();
  });

  it('shows the picks-not-revealed state when the server refuses the board before the event starts', async () => {
    primeMocks();
    getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: 'OPEN' }) } });
    getBracketLeaderboardMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } },
      status: 400,
    });
    renderLeaderboard();

    const hidden = await screen.findByTestId('contest-leaderboard-error-CONTEST_LEADERBOARD_PICKS_HIDDEN');
    expect(hidden).toHaveTextContent('Scores appear once picks are revealed.');
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });
});
