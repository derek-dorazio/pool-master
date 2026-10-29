import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import {
  bracketContestFixture,
  bracketLeaderboardFixture,
  bracketLeagueContextFixture,
} from './test/bracket-fixtures';

const {
  getBracketLeaderboardMock,
  getContestLeaderboardMock,
  getContestMock,
  getLeagueMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getBracketLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getLeagueMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getBracketLeaderboard: getBracketLeaderboardMock,
  getContest: getContestMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getLeague: getLeagueMock,
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

function renderLeaderboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/contests/contest-1/leaderboard']}>
        <Routes>
          <Route element={<ContestLeaderboardPage />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
          <Route element={<EntryDestination />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks() {
  getContestMock.mockResolvedValue({ data: { contest: bracketContestFixture({ status: 'ACTIVE' }) } });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
}

describe('Bracket contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getBracketLeaderboardMock, getContestLeaderboardMock, getContestMock, getLeagueMock]) {
      mock.mockReset();
    }
  });

  it('ranks a bracket contest\'s entries from the bracket board with place, entry and its group\'s name, points, max possible, correct picks and tiebreaker, and never reads the roster board', async () => {
    primeMocks();
    getBracketLeaderboardMock.mockResolvedValue({ data: bracketLeaderboardFixture() });
    renderLeaderboard();

    const leader = await screen.findByTestId('bracket-leaderboard-row-entry-2');
    expect(within(leader).getByTestId('bracket-leaderboard-place-entry-2')).toHaveTextContent('1');
    expect(leader).toHaveTextContent('Chalk All The Way');
    expect(leader).toHaveTextContent('Derek’s Great Golf Guys');
    expect(within(leader).getByTestId('bracket-leaderboard-points-entry-2')).toHaveTextContent('12 pts');
    expect(within(leader).getByTestId('bracket-leaderboard-max-entry-2')).toHaveTextContent('20 pts');
    expect(within(leader).getByTestId('bracket-leaderboard-correct-entry-2')).toHaveTextContent('5 of 7');
    expect(within(leader).getByTestId('bracket-leaderboard-tiebreaker-entry-2')).toHaveTextContent('141');

    const mine = screen.getByTestId('bracket-leaderboard-row-entry-1');
    expect(mine).toHaveTextContent('Yours');
    expect(within(mine).getByTestId('bracket-leaderboard-tiebreaker-entry-1')).toHaveTextContent('—');
    expect(screen.getByTestId('bracket-leaderboard-my-best')).toHaveTextContent('Your best: 2 · Derek’s Bracket, 8 pts');
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
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
