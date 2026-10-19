import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import { bracketLeagueContextFixture } from './test/bracket-fixtures';
import { pickEmContestFixture, pickEmEntriesFixture, survivorLeaderboardFixture } from './test/pick-em-fixtures';

const {
  getSurvivorLeaderboardMock,
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
    getSurvivorLeaderboardMock: vi.fn(),
    getPickEmLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getSurvivorLeaderboard: getSurvivorLeaderboardMock,
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

function renderLeaderboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/league/BIGDAWGS/contests/contest-1/leaderboard']}>
        <Routes>
          <Route element={<ContestLeaderboardPage />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks(board = survivorLeaderboardFixture()) {
  getContestMock.mockResolvedValue({ data: { contest: pickEmContestFixture({ status: 'ACTIVE', selectionType: 'SURVIVOR' }) } });
  getSurvivorLeaderboardMock.mockResolvedValue({ data: board });
  listContestEntriesMock.mockResolvedValue({ data: pickEmEntriesFixture({ picksRevealed: true }) });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
}

describe('Survivor contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getSurvivorLeaderboardMock, getPickEmLeaderboardMock, getContestLeaderboardMock, getContestMock, getLeagueMock, listContestEntriesMock]) {
      mock.mockReset();
    }
  });

  it('lists entries still in first with the week each other entry went out, and reads neither the pick\'em nor the roster leaderboard', async () => {
    primeMocks();
    renderLeaderboard();

    const table = await screen.findByTestId('survivor-leaderboard-table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent.replace('↕', ''))).toEqual(
      expect.arrayContaining(['Place', 'Entry', 'Status', 'Weeks survived', 'Week 1 (2 in)', 'Week 2 (2 in)']),
    );
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-1')).toHaveTextContent('In');
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-2')).toHaveTextContent('Out in week 2');
    expect(screen.getByTestId('survivor-leaderboard-survived-entry-2')).toHaveTextContent('1');
    expect(screen.getByTestId('survivor-leaderboard-still-in')).toHaveTextContent('1 entry still in.');
    expect(getPickEmLeaderboardMock).not.toHaveBeenCalled();
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('shows each week\'s picked team and how it went, and keeps a pick hidden until its game kicks off', async () => {
    primeMocks();
    renderLeaderboard();

    await screen.findByTestId('survivor-leaderboard-table');
    expect(screen.getByTestId('survivor-leaderboard-week-week-1-entry-1')).toHaveTextContent('ChiefsSurvived');
    expect(screen.getByTestId('survivor-leaderboard-week-week-2-entry-2')).toHaveTextContent('BearsOut');
    expect(screen.getByTestId('survivor-leaderboard-week-week-2-entry-1')).toHaveTextContent('Shown at kickoffPending');
  });
});
