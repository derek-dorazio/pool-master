import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import { bracketLeagueContextFixture } from './test/bracket-fixtures';
import {
  pickEmContestFixture,
  pickEmEntriesFixture,
  pickEmLeaderboardFixture,
} from './test/pick-em-fixtures';

const {
  getPickEmLeaderboardMock,
  getContestLeaderboardMock,
  getContestMock,
  getLeagueMock,
  listContestEntriesMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getPickEmLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getPickEmLeaderboard: getPickEmLeaderboardMock,
  getContest: getContestMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getLeague: getLeagueMock,
  listContestEntries: listContestEntriesMock,
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

function primeMocks(board = pickEmLeaderboardFixture()) {
  getContestMock.mockResolvedValue({ data: { contest: pickEmContestFixture({ status: 'ACTIVE' }) } });
  getPickEmLeaderboardMock.mockResolvedValue({ data: board });
  listContestEntriesMock.mockResolvedValue({ data: pickEmEntriesFixture({ picksRevealed: true }) });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
}

describe('Pick\'em contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getPickEmLeaderboardMock, getContestLeaderboardMock, getContestMock, getLeagueMock, listContestEntriesMock]) {
      mock.mockReset();
    }
  });

  it('ranks the season total with a column per week, marks each week\'s winner, and never reads the roster leaderboard', async () => {
    primeMocks();
    renderLeaderboard();

    const table = await screen.findByTestId('pick-em-leaderboard-table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent.replace('↕', ''))).toEqual(
      expect.arrayContaining(['Place', 'Entry', 'Season', 'Week 1 (final)', 'Week 2 (live)']),
    );
    expect(screen.getByTestId('pick-em-leaderboard-place-entry-2')).toHaveTextContent('1');
    expect(screen.getByTestId('pick-em-leaderboard-total-entry-2')).toHaveTextContent('3 pts');
    expect(screen.getByTestId('pick-em-leaderboard-week-week-1-entry-2')).toHaveTextContent('2 pts');
    expect(screen.getByTestId('pick-em-leaderboard-winner-week-1-entry-2')).toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-leaderboard-winner-week-2-entry-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('pick-em-leaderboard-mode')).toHaveTextContent('Straight up');
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('shows a dash for a week the entry did not submit, and the viewer\'s best place', async () => {
    primeMocks();
    renderLeaderboard();

    expect(await screen.findByTestId('pick-em-leaderboard-week-week-1-entry-1')).toHaveTextContent('—');
    expect(screen.getByTestId('pick-em-leaderboard-my-best')).toHaveTextContent('Your best: 2 · Morgan’s Picks, 1 pt');
  });

  it('lists entries unranked before the first kickoff and says points show from then', async () => {
    const before = pickEmLeaderboardFixture();
    primeMocks({
      ...before,
      weeks: before.weeks.map((week) => ({ ...week, status: 'SCHEDULED', started: false, settled: false, winnerEntryIds: [], tiebreakerTotalPoints: null })),
      entries: before.entries.map((entry) => ({
        ...entry,
        position: null,
        displayPosition: null,
        totalPoints: 0,
        weeks: entry.weeks.map((week) => ({ ...week, points: null, position: null, displayPosition: null, weeklyWinner: false })),
      })),
    });
    renderLeaderboard();

    expect(await screen.findByTestId('pick-em-leaderboard-not-started')).toHaveTextContent('Points show from the first kickoff.');
    expect(screen.getByTestId('pick-em-leaderboard-place-entry-2')).toHaveTextContent('—');
    expect(screen.queryByTestId('pick-em-leaderboard-my-best')).not.toBeInTheDocument();
  });

  it('links each entry to its weeks of picks', async () => {
    primeMocks();
    renderLeaderboard();

    fireEvent.click(await screen.findByTestId('pick-em-leaderboard-entry-link-entry-2'));
    expect(await screen.findByTestId('entry-destination')).toHaveTextContent('entry-2');
  });
});
