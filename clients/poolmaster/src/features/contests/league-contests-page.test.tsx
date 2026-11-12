import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
const getContestLeaderboardMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listMyContestEntries: listMyContestEntriesMock,
  listContests: listContestsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  getContestLeaderboard: getContestLeaderboardMock,
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
  isMember = true,
  isRootAdmin = false,
  leagueRole = 'MEMBER',
}: {
  isMember?: boolean;
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
      membership: isMember ? {
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
      } : null,
      // The viewer owns team-1; each row says where that team's entry stands.
      squadMembership: isMember ? {
        id: 'team-membership-1',
        squadId: 'team-1',
        leagueId: 'league-1',
        userId: 'user-1',
        status: 'ACTIVE',
        joinedAt: '2026-04-15T00:00:00.000Z',
        createdAt: '2026-04-15T00:00:00.000Z',
        updatedAt: '2026-04-15T00:00:00.000Z',
      } : null,
    },
  });
}

/** A contest's entry list holding one entry for each of `squadIds`. */
/** The viewer's team's entries across the league's current contests, as the my-entries read returns them (#1197). */
function myEntries(contestIds: string[], places: Array<{ entryId: string; position: number; displayPosition: string }> = []) {
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
      places,
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

function resetMocks() {
  for (const mock of [getCurrentUserMock, getLeagueByCodeMock, listMyContestEntriesMock, listContestsMock, logoutUserMock, refreshTokenMock]) {
    mock.mockReset();
  }
}

describe('LeagueContestsPage', () => {
  afterEach(resetMocks);

  it('shows the current contests on the Current tab, with entry counts and no history section', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [{ ...contest('contest-1', 'Masters Pick 6'), entryCount: 12 }] } });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage();

    expect(await screen.findByRole('link', { name: 'Current' })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByTestId('league-contests-current')).toHaveTextContent('Masters Pick 6');
    expect(screen.getByTestId('league-contest-contest-1')).toHaveTextContent('12 entries');
    expect(screen.queryByTestId('league-contests-history')).not.toBeInTheDocument();
    expect(listContestsMock.mock.calls[0]?.[0]).not.toHaveProperty('query');
  });

  it('groups live contests before open ones, opening live on the leaderboard and open on Entries', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-1', 'Masters Pick 6'), contest('contest-3', 'US Open Pick 6', 'ACTIVE')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries(['contest-3']));

    renderLeagueContestsPage();

    const groups = await screen.findAllByRole('region', { name: /^(Live|Open)$/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Live', 'Open']);
    expect(screen.getByTestId('league-contest-contest-3')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-3/leaderboard');
    expect(screen.getByTestId('league-contest-contest-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
  });

  it('says on every row where the team\'s entry stands, reading the entries once for the league', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-1', 'Masters Pick 6'), contest('contest-3', 'US Open Pick 6', 'ACTIVE')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries(['contest-3']));

    renderLeagueContestsPage();

    expect(await screen.findByText('Your entry is submitted.')).toBeInTheDocument();
    expect(screen.getByTestId('league-contest-contest-1')).toHaveTextContent('You have not entered yet.');
    expect(getLeagueByCodeMock).toHaveBeenCalledTimes(1);
    expect(listContestsMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('shows the best place of the team\'s two entries on a live row, and how many it has, with no leaderboard read per row', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-1', 'Masters Pick 6'), contest('contest-3', 'US Open Pick 6', 'ACTIVE')] },
    });
    const response = myEntries(['contest-3'], [
      { entryId: 'contest-3-entry-1', position: 7, displayPosition: '7' },
      { entryId: 'contest-3-entry-2', position: 3, displayPosition: '3' },
    ]);
    const [first] = response.data.entries;
    response.data.entries.push({ ...first, id: 'contest-3-entry-2', entryNumber: 2, name: 'Team team-1 Entry 2' });
    listMyContestEntriesMock.mockResolvedValue(response);

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-contest-3-trailing')).toHaveTextContent('3rd');
    expect(screen.getByTestId('league-contest-contest-3')).toHaveTextContent(/Your 2 entries/);
    expect(screen.queryByTestId('league-contest-contest-1-trailing')).not.toBeInTheDocument();
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('says it could not check the entry, rather than that there is none, when the entries cannot be read', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listMyContestEntriesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderLeagueContestsPage();

    expect(await screen.findByText("We couldn't check your entry.")).toBeInTheDocument();
    expect(screen.queryByText('You have not entered yet.')).not.toBeInTheDocument();
  });

  it('shows a commissioner their contests still being set up under Set up, after the open contests', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({
      data: { contests: [{ ...contest('contest-2', 'PGA Draft'), status: 'DRAFT' }, contest('contest-1', 'Masters Pick 6')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage();

    const groups = await screen.findAllByRole('region', { name: /^(Open|Set up)$/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Open', 'Set up']);
    expect(screen.getByTestId('league-contest-contest-2')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-2');
  });

  it('shows a root admin looking into a league they are not in the drafts the server sends them', async () => {
    primeCommonMocks({ isMember: false, isRootAdmin: true });
    listContestsMock.mockResolvedValue({
      data: { contests: [{ ...contest('contest-2', 'PGA Draft'), status: 'DRAFT' }, contest('contest-1', 'Masters Pick 6')] },
    });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-group-draft')).toHaveTextContent('PGA Draft');
    expect(listMyContestEntriesMock).not.toHaveBeenCalled();
  });

  it('never shows a member a draft', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [{ ...contest('contest-2', 'PGA Draft'), status: 'DRAFT' }, contest('contest-1', 'Masters Pick 6')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-contest-1')).toBeInTheDocument();
    expect(screen.queryByTestId('league-contest-contest-2')).not.toBeInTheDocument();
  });

  it('tints the contest named by ?focus, the one the viewer came from', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-1', 'Masters Pick 6'), contest('contest-3', 'US Open Pick 6', 'ACTIVE')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?focus=contest-3');

    expect(await screen.findByTestId('league-contest-contest-3')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('league-contest-contest-1')).not.toHaveAttribute('data-highlighted');
  });

  it('just shows the list when ?focus names a contest that is not current', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('contest-1', 'Masters Pick 6')] } });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?focus=gone');

    expect(await screen.findByTestId('league-contest-contest-1')).not.toHaveAttribute('data-highlighted');
  });

  it('shows the whole Current list for an old My contests link', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      data: { contests: [contest('contest-1', 'Masters Pick 6'), contest('contest-3', 'US Open Pick 6', 'ACTIVE')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries(['contest-3']));

    renderLeagueContestsPage('/league/BIGDAWGS/contests?filter=my-entries');

    expect(await screen.findByTestId('league-contest-contest-1')).toBeInTheDocument();
    expect(screen.getByTestId('league-contest-contest-3')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Current' })).toHaveAttribute('aria-current', 'page');
  });

  it('offers only the Current and Past tabs, as links in the header, with no My contests tab and no sentence about the page', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    const tabs = within(await screen.findByRole('navigation', { name: 'Contests to show' }));
    expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual(['Current', 'Past']);
    expect(tabs.getByRole('link', { name: 'Past' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/history');
    expect(screen.queryByText('Live and open contests in this league.')).not.toBeInTheDocument();
  });

  it('links to How to play from the page header', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('contests-how-to-play')).toHaveAttribute('href', '/how-to-play');
  });
});

describe('LeagueContestsPage links', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    getLeagueByCodeMock.mockReset();
    listContestsMock.mockReset();
    refreshTokenMock.mockReset();
  });

  it('opens an open contest on its Entries and a live one on its Leaderboard', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [contest('open-1', 'Masters Pick 6'), contest('live-1', 'PGA Championship Tiers', 'ACTIVE')] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-open-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/open-1');
    expect(screen.getByTestId('league-contest-live-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-1/leaderboard');
  });
});

describe('LeagueContestsPage, beyond the default list', () => {
  afterEach(resetMocks);

  it('keeps contest setup out of the member Contests page, even for a commissioner', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contests-current')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Manage contests/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Create contest/i })).not.toBeInTheDocument();
  });

  it('says in one italic line, with no pointer to Past, that no contest is open or live when the list returns none current', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-empty')).toHaveTextContent('No open or live contests.');
    expect(screen.getByTestId('league-contest-empty')).toHaveClass('italic');
    expect(screen.getByTestId('league-contest-empty')).not.toHaveTextContent('Past');
  });

  it('shows an error instead of an empty list when the contest list fails to load', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderLeagueContestsPage();

    expect(await screen.findByText("We couldn't load contests for this league.")).toBeInTheDocument();
    expect(screen.queryByTestId('league-contests-current')).not.toBeInTheDocument();
  });
});
