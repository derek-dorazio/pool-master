import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContestDetailPage } from './contest-detail-page';

const {
  enterContestMock,
  getContestMock,
  getContestEntryMock,
  getLeagueMock,
  getStandingsMock,
  leaveContestMock,
  listContestEntriesMock,
  mockLogger,
  updateContestEntryMock,
} = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    enterContestMock: vi.fn(),
    getContestMock: vi.fn(),
    getContestEntryMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getStandingsMock: vi.fn(),
    leaveContestMock: vi.fn(),
    listContestEntriesMock: vi.fn(),
    mockLogger: logger,
    updateContestEntryMock: vi.fn(),
  };
});

vi.mock('@/lib/api', () => ({
  enterContest: (...args: unknown[]) => enterContestMock(...args),
  getContest: (...args: unknown[]) => getContestMock(...args),
  getContestEntry: (...args: unknown[]) => getContestEntryMock(...args),
  getLeague: (...args: unknown[]) => getLeagueMock(...args),
  getStandings: (...args: unknown[]) => getStandingsMock(...args),
  leaveContest: (...args: unknown[]) => leaveContestMock(...args),
  listContestEntries: (...args: unknown[]) => listContestEntriesMock(...args),
  updateContestEntry: (...args: unknown[]) => updateContestEntryMock(...args),
}));

vi.mock('@/features/auth/auth-provider', () => ({
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
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function renderContestDetailPage() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/contests/contest-1', state: { leagueCode: 'BIGDAWGS' } }]}
      >
        <Routes>
          <Route element={<ContestDetailPage />} path="/contests/:contestId" />
          <Route element={<div data-testid="contest-entry-page" />} path="/contests/:contestId/entries/:entryId" />
          <Route element={<div data-testid="my-entries-page" />} path="/league/:leagueCode/entries" />
          <Route element={<div data-testid="league-team-page" />} path="/league/:leagueCode/team" />
          <Route
            element={<div data-testid="contest-manage-page" />}
            path="/league/:leagueCode/contests/:contestId/manage"
          />
          <Route element={<div data-testid="league-page" />} path="/league/:leagueCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeCommonMocks(overrides?: {
  contestStatus?: 'DRAFT' | 'OPEN' | 'DRAFTING' | 'LOCKED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  selectionType?: 'SNAKE_DRAFT' | 'TIERED' | 'BUDGET_PICK' | 'OPEN_SELECTION' | 'PICK_EM' | 'BRACKET_PICK_EM';
  role?: 'MEMBER' | 'COMMISSIONER';
}) {
  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status: overrides?.contestStatus ?? 'OPEN',
        contestType: 'SINGLE_EVENT',
        selectionType: overrides?.selectionType ?? 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: 3,
      },
    },
  });

  getStandingsMock.mockResolvedValue({
    data: {
      standings: [
        {
          entryId: 'entry-1',
          rank: 1,
          totalScore: 42,
          entryName: 'Birdie Hunters Entry 1',
          ownerDisplayName: 'Morgan Member',
          ownerId: 'user-1',
          previousRank: 1,
          movement: 'same',
          isEliminated: false,
          lastUpdatedAt: '2026-04-15T00:00:00.000Z',
        },
      ],
      total: 1,
      page: 1,
      pageSize: 50,
      contestId: 'contest-1',
    },
  });

  getContestEntryMock.mockResolvedValue({
    data: {
      contestId: 'contest-1',
      entry: {
        id: 'entry-1',
        contestId: 'contest-1',
        squadId: 'squad-1',
        squadName: 'Birdie Hunters',
        entryNumber: 1,
        name: 'Birdie Hunters Entry 1',
        status: 'ACTIVE',
        tiebreakerValue: 271,
        totalScore: 42,
        standingsPosition: 1,
        isEliminated: false,
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
        participants: [
          {
            rosterPickId: 'pick-1',
            sportEventParticipantId: 'sep-1',
            participantId: 'participant-1',
            participantName: 'Scottie Scheffler',
            participantStatus: 'ACTIVE',
            position: null,
            teamAffiliation: 'USA',
            contestPoints: -11,
            pickedAt: '2026-04-15T00:00:00.000Z',
            latestPerformance: {
              scoreToPar: -11,
              thru: 'F',
              round1: 70,
              round2: 74,
              round3: 65,
              round4: 68,
            },
          },
        ],
      },
    },
  });

  getLeagueMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        role: overrides?.role ?? 'MEMBER',
      },
    },
  });
}

describe('ContestDetailPage', () => {
  afterEach(() => {
    enterContestMock.mockReset();
    getContestMock.mockReset();
    getContestEntryMock.mockReset();
    getLeagueMock.mockReset();
    getStandingsMock.mockReset();
    leaveContestMock.mockReset();
    listContestEntriesMock.mockReset();
    updateContestEntryMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
  });

  it('links members to the dedicated My Entries page instead of rendering a personal entry tile', async () => {
    primeCommonMocks();
    listContestEntriesMock.mockResolvedValueOnce({
      data: {
        contestId: 'contest-1',
        total: 0,
        isJoined: false,
        myEntryId: '',
        entries: [],
      },
    });
    renderContestDetailPage();

    expect(await screen.findByTestId('contest-open-my-entries')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/entries',
    );
    expect(screen.queryByTestId('contest-my-entry')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-enter-entry')).not.toBeInTheDocument();
  });

  it('shows the contest load failure state when the contest query fails', async () => {
    getContestMock.mockRejectedValue(new Error('Contest missing'));
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 0,
        isJoined: false,
        myEntryId: '',
        entries: [],
      },
    });
    getStandingsMock.mockResolvedValue({
      data: {
        standings: [],
        total: 0,
        page: 1,
        pageSize: 50,
        contestId: 'contest-1',
      },
    });

    renderContestDetailPage();

    await screen.findByText("We couldn't load this contest.");
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'contestDetail.contest.failed',
      }),
      expect.any(String),
    );
  });

  it('highlights the current team entries in the list and supports multiple entries while open', async () => {
    primeCommonMocks();
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 3,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1', 'entry-3'],
        entries: [
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            squadName: 'Birdie Hunters',
            entryNumber: 1,
            name: 'Birdie Hunters Entry 1',
            status: 'ACTIVE',
            totalScore: 12,
            standingsPosition: 2,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'entry-3',
            contestId: 'contest-1',
            squadId: 'squad-1',
            squadName: 'Birdie Hunters',
            entryNumber: 2,
            name: 'Birdie Hunters Entry 2',
            status: 'ACTIVE',
            totalScore: 9,
            standingsPosition: 1,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
          {
            id: 'entry-2',
            contestId: 'contest-1',
            squadId: 'squad-2',
            squadName: 'Fairway Finders',
            entryNumber: 1,
            name: 'Fairway Finders Entry 1',
            status: 'ACTIVE',
            totalScore: 18,
            standingsPosition: 4,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });

    renderContestDetailPage();

    expect(await screen.findByTestId('contest-entry-entry-1')).toHaveTextContent('Birdie Hunters Entry 1');
    expect(screen.getByTestId('contest-entry-entry-3')).toHaveTextContent('Birdie Hunters Entry 2');
    expect(screen.getAllByText('Your team')).toHaveLength(2);
    expect(screen.queryByTestId('contest-entry-open-entry-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-entry-entry-2')).toHaveTextContent('Fairway Finders Entry 1');
  });

  it('expands leaderboard details when requested', async () => {
    primeCommonMocks();
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 1,
        isJoined: true,
        myEntryId: 'entry-1',
        myEntryIds: ['entry-1'],
        entries: [
          {
            id: 'entry-1',
            contestId: 'contest-1',
            squadId: 'squad-1',
            squadName: 'Birdie Hunters',
            entryNumber: 1,
            name: 'Birdie Hunters Entry 1',
            status: 'ACTIVE',
            totalScore: 42,
            standingsPosition: 1,
            isEliminated: false,
            createdAt: '2026-04-15T00:00:00.000Z',
            updatedAt: '2026-04-15T00:00:00.000Z',
          },
        ],
      },
    });

    renderContestDetailPage();

    expect(await screen.findByTestId('contest-leaderboard-entry-entry-1')).toHaveTextContent(
      'Birdie Hunters Entry 1',
    );

    fireEvent.click(screen.getByTestId('contest-toggle-leaderboard-details'));

    expect(await screen.findByTestId('contest-leaderboard-participant-entry-1-participant-1')).toHaveTextContent(
      'Scottie Scheffler',
    );
    expect(getContestEntryMock).toHaveBeenCalledWith({
      path: { contestId: 'contest-1', entryId: 'entry-1' },
    });
  });

  it('shows truthful locked-state copy when entry creation is no longer available', async () => {
    primeCommonMocks({ contestStatus: 'LOCKED', selectionType: 'PICK_EM' });
    listContestEntriesMock.mockResolvedValue({
      data: {
        contestId: 'contest-1',
        total: 3,
        isJoined: false,
        myEntryId: '',
        entries: [],
      },
    });

    renderContestDetailPage();

    expect(await screen.findByTestId('contest-open-my-entries')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-enter-entry')).not.toBeInTheDocument();
    expect(screen.getByText(/Contest Home now stays focused on rules, all entries, and the leaderboard/)).toBeInTheDocument();
  });
});
