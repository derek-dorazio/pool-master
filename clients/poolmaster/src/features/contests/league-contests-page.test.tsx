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
      // The viewer owns team-1; each row says where that team's entry stands.
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

    expect(await screen.findByRole('radio', { name: 'Current' })).toBeChecked();
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

    const groups = await screen.findAllByRole('region', { name: /^(Live|Open for entries)$/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Live', 'Open for entries']);
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

  it('shows a commissioner their drafts under Draft, after the open contests', async () => {
    primeCommonMocks({ leagueRole: 'COMMISSIONER' });
    listContestsMock.mockResolvedValue({
      data: { contests: [{ ...contest('contest-2', 'PGA Draft'), status: 'DRAFT' }, contest('contest-1', 'Masters Pick 6')] },
    });
    listMyContestEntriesMock.mockResolvedValue(myEntries([]));

    renderLeagueContestsPage();

    const groups = await screen.findAllByRole('region', { name: /^(Open for entries|Draft)$/ });
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Open for entries', 'Draft']);
    expect(screen.getByTestId('league-contest-contest-2')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-2');
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
    expect(screen.getByRole('radio', { name: 'Current' })).toBeChecked();
  });

  it('offers only the Current and Past tabs, with no My contests tab', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    const radios = await screen.findAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('aria-label') ?? radio.textContent)).toEqual(['Current', 'Past']);
  });

  it('links to How to play from the page header', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('contests-how-to-play')).toHaveAttribute('href', '/how-to-play');
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

  it('says no contest is open or live, pointing to Past, when the list returns none current', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({ data: { contests: [] } });

    renderLeagueContestsPage();

    expect(await screen.findByTestId('league-contest-empty')).toHaveTextContent(
      'No contests are open or live right now. Finished ones are under Past.',
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
    expect(screen.queryByTestId('league-contests-current')).not.toBeInTheDocument();
  });
});
