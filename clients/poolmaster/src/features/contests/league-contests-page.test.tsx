import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueContestHistoryPage } from './league-contest-history-page';
import { LeagueContestsPage } from './league-contests-page';

const getCurrentUserMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listMyContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const logoutUserMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listMyContestEntries: listMyContestEntriesMock,
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
/** The viewer's team's entries across the league's current contests, as the my-entries read returns them (#1197). */
function myEntries(contestIds: string[]) {
  return {
    data: {
      entries: contestIds.map((contestId) => ({
        id: `${contestId}-entry-1`,
        contestId,
        squadId: 'team-1',
        squadName: 'Team team-1',
        entryNumber: 1,
        name: 'Team team-1 Entry 1',
        events: [{ sportEventId: 'event-1', status: 'SUBMITTED', submittedAt: '2026-04-15T00:00:00.000Z' }],
        picksCount: 6,
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      })),
    },
  };
}

/** The one event a listed golf contest covers, as the contest list carries it (#713). */
function listedEvents() {
  return [{ sportEventId: 'event-1', sequence: 1, name: 'The Masters', startDate: '2099-04-09T12:40:00.000Z', status: 'SCHEDULED' }];
}

function contest(id: string, name: string, status: 'OPEN' | 'ACTIVE' | 'COMPLETED' = 'OPEN') {
  return {
    id,
    name,
    status,
    contestType: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    sport: 'GOLF',
    sportEvents: listedEvents(),
    entryCount: 4,
  };
}

describe('LeagueContestsPage', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listMyContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('shows the current contests the list returns on Active Contests, with no history section', async () => {
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
            leagueId: 'league-1',
            sport: 'GOLF',
            sportEvents: listedEvents(),
            entryCount: 12,
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
    expect(listContestsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
    expect(listContestsMock.mock.calls[0]?.[0]).not.toHaveProperty('query');
    expect(screen.getByTestId('league-contest-contest-1')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );    // The team's entries are read only for the My contests filter.
    expect(listMyContestEntriesMock).not.toHaveBeenCalled();
  });
});

describe('LeagueContestsPage, beyond the default list', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listMyContestEntriesMock.mockReset();
    listContestsMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('keeps contest setup out of the member Contests page, even for a commissioner', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-active')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Manage contests/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create contest/i })).not.toBeInTheDocument();
  });

  it('says the league has no active contests when the list returns none current', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

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
        ],
      },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries(['contest-3']));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByRole('radio', { name: 'My contests' })).toBeChecked();
    expect(await screen.findByTestId('league-contest-contest-3')).toBeInTheDocument();
    expect(screen.queryByTestId('league-contest-contest-1')).not.toBeInTheDocument();
    // One read for the team's entries across the league, not one per contest (#1197).
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('says the viewer has no entries under "My Contests" when they have entered none', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByText('You don’t have entries in any active contests yet.')).toBeInTheDocument();
  });

  it('shows an error under "My Contests" when reading the team\'s entries fails, rather than claiming it has none', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listMyContestEntriesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByText("We couldn't load your contests.")).toBeInTheDocument();
    expect(screen.queryByText('You don’t have entries in any active contests yet.')).not.toBeInTheDocument();
  });
});
