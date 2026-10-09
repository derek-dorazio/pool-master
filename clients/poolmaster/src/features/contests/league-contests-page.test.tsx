import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueContestHistoryPage } from './league-contest-history-page';
import { LeagueContestsPage } from './league-contests-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContestEntries: listContestEntriesMock,
  listContests: listContestsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
});

function renderLeagueContestsPage(path = '/league/BIGDAWGS/contests') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<LeagueContestsPage />} path="/league/:leagueCode/contests" />
            <Route element={<LeagueContestHistoryPage />} path="/league/:leagueCode/contests/history" />
            <Route element={<div data-testid="contest-destination" />} path="/league/:leagueCode/contests/:contestId" />
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCommonMocks({
  isRootAdmin = false,
  leagueRole = 'MEMBER',
}: {
  isRootAdmin?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id: 'user-1',
        email: 'member@example.com',
        firstName: 'Mina',
        lastName: 'Member',
        isActive: true,
        isRootAdmin,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue({
    data: {
      league: {
        id: 'league-1',
        leagueCode: 'BIGDAWGS',
        name: 'Big Dawgs',
        description: 'A contest-ready league',
        isActive: true,
        iconKey: 'TROPHY',
        memberCount: 12,
        activeContestCount: 2,
        createdAt: '2026-04-15T00:00:00.000Z',
      },
      // #202 (A8) — the viewer's own membership, delivered once with the league context. It was
      // `memberType` and a `leagueRelationship` block on the league itself.
      membership: {
        id: 'league-membership-1',
        leagueId: 'league-1',
        userId: 'user-1',
        user: {
          id: 'user-1',
          email: 'member@example.com',
          username: 'member@example.com',
          firstName: 'Mina',
          lastName: 'Member',
          isActive: true,
          isRootAdmin,
          createdAt: '2026-04-15T00:00:00.000Z',
        },
        role: leagueRole,
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
      // The viewer owns team-1; the My contests view reads each contest's entries for it.
      squadMembership: {
        id: 'team-membership-1',
        squadId: 'team-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      },
    },
  });
}

/** A contest's entry list holding one entry for each of `squadIds`. */
function entryList(contestId: string, squadIds: string[]) {
  return {
    data: {
      contestId,
      total: squadIds.length,
      isJoined: squadIds.includes('team-1'),
      myEntryId: null,
      myEntryIds: [],
      picksRevealed: false,
      entries: squadIds.map((squadId, index) => ({
        id: `${contestId}-entry-${index}`,
        contestId,
        squadId,
        squadName: `Team ${squadId}`,
        entryNumber: 1,
        name: `Team ${squadId} Entry 1`,
        status: 'SUBMITTED',
        picksCount: 6,
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      })),
    },
  };
}

function contest(id: string, name: string, status: 'OPEN' | 'ACTIVE' | 'COMPLETED' = 'OPEN') {
  return {
    id,
    name,
    status,
    contestType: 'ROSTER',
    selectionType: 'TIERED',
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    sport: 'GOLF',
    entryCount: 4,
  };
}

describe('LeagueContestsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('pool-master-9ef shows active contests only on Active Contests', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 12,
          },
          {
            id: 'contest-2',
            name: 'Players Championship',
            status: 'COMPLETED',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 10,
          },
        ],
      },
    });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-page')).toBeInTheDocument();
    expect(screen.queryByText(/Contest cards and commissioner contest actions are available from League Home/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open League Home' })).not.toBeInTheDocument();

    expect(await screen.findByTestId('league-contests-active')).toHaveTextContent('Masters Pick 6');
    expect(screen.getByTestId('league-contests-active')).toHaveTextContent('12 entries');
    expect(screen.queryByTestId('league-contests-history')).not.toBeInTheDocument();
    expect(screen.queryByText('Players Championship')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-contest-contest-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
  });

  it('pool-master-9ef shows completed contests on Contest History', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          {
            id: 'contest-1',
            name: 'Masters Pick 6',
            status: 'OPEN',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 12,
          },
          {
            id: 'contest-2',
            name: 'Players Championship',
            status: 'COMPLETED',
            contestType: 'ROSTER',
            selectionType: 'TIERED',
            scoringEngine: 'STROKE_PLAY',
            leagueId: 'league-1',
            sport: 'GOLF',
            entryCount: 10,
          },
        ],
      },
    });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <MemoryRouter initialEntries={['/league/BIGDAWGS/contests/history']}>
            <Routes>
              <Route element={<LeagueContestHistoryPage />} path="/league/:leagueCode/contests/history" />
              <Route element={<div data-testid="contest-destination" />} path="/league/:leagueCode/contests/:contestId" />
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>,
    );

    expect(await screen.findByTestId('league-contest-history-page')).toBeInTheDocument();
    expect(await screen.findByTestId('league-contests-history')).toHaveTextContent('Players Championship');
    expect(screen.queryByText('Masters Pick 6')).not.toBeInTheDocument();
    expect(screen.getByTestId('league-history-contest-contest-2')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-2',
    );
  });
});

describe('LeagueContestsPage, beyond the default list', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('shows a plain member neither Manage Contests nor Create Contest', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-active')).toHaveTextContent('Masters Pick 6');
    expect(screen.queryByRole('link', { name: 'Manage Contests' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create Contest' })).not.toBeInTheDocument();
  });

  it('offers a commissioner Manage Contests and Create Contest', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByRole('link', { name: 'Manage Contests' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/manage',
    );
    expect(screen.getByRole('link', { name: 'Create Contest' })).toBeInTheDocument();
  });

  it('says the league has no active contests when only finished ones exist', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-2', 'Players Championship', 'COMPLETED')] },
    });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-active')).toHaveTextContent(
      'No active contests are available for this league yet.',
    );
  });

  it('shows an error instead of an empty list when the contest list fails to load', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderLeagueContestsPage();

    expect(await screen.findByText("We couldn't load contests for this league.")).toBeInTheDocument();
    expect(screen.queryByTestId('league-contests-active')).not.toBeInTheDocument();
  });

  it('lists only the active contests the viewer\'s team has entered under "My Contests"', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: {
        contests: [
          contest('contest-1', 'Masters Pick 6'),
          contest('contest-3', 'US Open Pick 6', 'ACTIVE'),
          contest('contest-2', 'Players Championship', 'COMPLETED'),
        ],
      },
    });
    listContestEntriesMock.mockImplementation(({ path }: { path: { contestId: string } }) =>
      entryList(path.contestId, path.contestId === 'contest-3' ? ['team-2', 'team-1'] : ['team-2']),
    );

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByRole('radio', { name: 'My contests' })).toBeChecked();
    expect(await screen.findByTestId('league-contest-contest-3')).toBeInTheDocument();
    expect(screen.queryByTestId('league-contest-contest-1')).not.toBeInTheDocument();
  });

  it('says the team has no entries under "My Contests" when it has entered none', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listContestEntriesMock.mockResolvedValue(entryList('contest-1', ['team-2']));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByText('Your team does not have entries in any active contests yet.')).toBeInTheDocument();
  });

  it('shows an error under "My Contests" when reading the team\'s entries fails, rather than claiming it has none', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listContestEntriesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByText("We couldn't load your contests.")).toBeInTheDocument();
    expect(screen.queryByText('Your team does not have entries in any active contests yet.')).not.toBeInTheDocument();
  });
});
