import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  getLeagueByCodeData,
  listLeagueSquadsData,
} from '@/features/leagues/test/fixtures';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { ManageContestsPage } from './manage-contests-page';
import { buildContest, buildSportEvent } from './test/contest-admin-fixtures';

const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getEvent: getEventMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContests: listContestsMock,
  listLeagueSquads: listLeagueSquadsMock,
  refreshToken: refreshTokenMock,
});

function renderManageContestsPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/league/BIGDAWGS/admin/contests']}>
          <Routes>
            <Route element={<MemberRouteGuard />}>
              <Route element={<CommissionerRouteGuard />} path="/league/:leagueCode/admin">
                <Route element={<CommissionerToolsLayout />}>
                  <Route element={<ManageContestsPage />} path="contests" />
                </Route>
              </Route>
            </Route>
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
            <Route element={<div data-testid="welcome-destination" />} path="/welcome" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const masters = buildSportEvent({ id: 'event-1', name: 'The Masters', startDate: '2099-04-09T12:40:00.000Z' });
const heritage = buildSportEvent({ id: 'event-2', name: 'RBC Heritage', startDate: '2099-04-16T12:00:00.000Z' });
const players = buildSportEvent({ id: 'event-3', name: 'The Players', startDate: '2099-03-12T12:00:00.000Z' });

function primeCommonMocks({
  isRootAdmin = false,
  leagueActive = true,
  leagueRole = 'COMMISSIONER',
}: {
  isRootAdmin?: boolean;
  leagueActive?: boolean;
  leagueRole?: 'COMMISSIONER' | 'MEMBER';
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive: leagueActive }),
    { membership: buildLeagueMembership({ role: leagueRole }) },
  )));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
    buildLeagueSquad({ id: 'team-1' }),
    buildLeagueSquad({ id: 'team-2', name: 'Second Team' }),
    buildLeagueSquad({ id: 'team-3', name: 'Retired Rockets', isActive: false }),
  ])));
  getEventMock.mockImplementation(({ path }: { path: { eventId: string } }) => {
    const event = [masters, heritage, players].find((candidate) => candidate.id === path.eventId);
    return event ? apiSuccess({ event }) : { error: { error: { code: 'NOT_FOUND', message: 'No event' } }, status: 404 };
  });
}

function rowOrder() {
  return within(screen.getByTestId('manage-contests-table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.getAttribute('data-testid'));
}

describe('ManageContestsPage', () => {
  afterEach(() => {
    for (const mock of [getCurrentUserMock, getEventMock, getLeagueByCodeMock, listContestsMock, listLeagueSquadsMock, refreshTokenMock]) {
      mock.mockReset();
    }
  });

  it('shows each contest with its format, readable status, event and entries, and one action naming the next step', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', sportEventId: 'event-1' }),
        buildContest({ id: 'contest-2', name: 'Heritage Tiers', status: 'OPEN', sportEventId: 'event-2', entryCount: 1 }),
      ],
    }));

    renderManageContestsPage();

    const notOpen = within(await screen.findByTestId('manage-contests-row-contest-1'));
    expect(notOpen.getByText('Tiered')).toBeInTheDocument();
    expect(notOpen.getByText('Draft')).toBeInTheDocument();
    expect(await notOpen.findByText('The Masters')).toBeInTheDocument();
    expect(notOpen.getByText(/^Starts/)).toBeInTheDocument();
    expect(notOpen.getByText('Not open')).toBeInTheDocument();
    expect(notOpen.getByRole('link', { name: 'Finish setup' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1');

    const open = within(screen.getByTestId('manage-contests-row-contest-2'));
    expect(open.getByText('Open for entries')).toBeInTheDocument();
    expect(await open.findByText(/^Entries close/)).toBeInTheDocument();
    // Two of the league's three teams are active.
    expect(await open.findByText('of 2 teams')).toBeInTheDocument();
    expect(open.getByRole('link', { name: 'Manage' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-2');
    expect(screen.queryByText(/TIERED|STROKE_PLAY/)).not.toBeInTheDocument();
  });

  it('lists contests not yet open first, then by their event\'s start, soonest first', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'open-heritage', status: 'OPEN', sportEventId: 'event-2' }),
        buildContest({ id: 'live-players', status: 'ACTIVE', sportEventId: 'event-3' }),
        buildContest({ id: 'draft-heritage', status: 'DRAFT', sportEventId: 'event-2' }),
        buildContest({ id: 'draft-masters', status: 'DRAFT', sportEventId: 'event-1' }),
      ],
    }));

    renderManageContestsPage();

    await screen.findByTestId('manage-contests-row-open-heritage');
    await waitFor(() => expect(rowOrder()).toEqual([
      'manage-contests-row-draft-masters',
      'manage-contests-row-draft-heritage',
      'manage-contests-row-live-players',
      'manage-contests-row-open-heritage',
    ]));
  });

  it('keeps finished contests under History, with each switch counting its contests', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'contest-open', name: 'Heritage Tiers', status: 'OPEN', sportEventId: 'event-2' }),
        buildContest({ id: 'contest-final', name: 'Players Pick 6', status: 'COMPLETED', sportEventId: 'event-3' }),
      ],
    }));

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-row-contest-open')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-row-contest-final')).not.toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-filter-active')).toHaveTextContent('Active · 1');

    fireEvent.click(screen.getByTestId('manage-contests-filter-history'));

    expect(await screen.findByTestId('manage-contests-row-contest-final')).toHaveTextContent('Final');
    expect(screen.queryByTestId('manage-contests-row-contest-open')).not.toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-filter-history')).toHaveTextContent('History · 1');
  });

  it('finds a contest by its event\'s name as well as its own', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'contest-1', name: 'Spring Major', sportEventId: 'event-1' }),
        buildContest({ id: 'contest-2', name: 'Heritage Tiers', sportEventId: 'event-2' }),
      ],
    }));

    renderManageContestsPage();

    expect(await within(await screen.findByTestId('manage-contests-row-contest-1')).findByText('The Masters')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('manage-contests-search'), { target: { value: 'masters' } });

    expect(screen.getByTestId('manage-contests-row-contest-1')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-row-contest-2')).not.toBeInTheDocument();
  });

  it('shows 25 contests a page and pages to the rest', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: Array.from({ length: 30 }, (_, index) => buildContest({ id: `contest-${index}`, name: `Contest ${index}` })),
    }));

    renderManageContestsPage();

    await screen.findByTestId('manage-contests-row-contest-0');
    expect(screen.getAllByText('Finish setup')).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByText('Finish setup')).toHaveLength(5);
  });

  it('sends a member who opens Commissioner tools contests to League Home, without loading the contests', async () => {
    primeCommonMocks({ leagueRole: 'MEMBER' });
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    expect(await screen.findByTestId('league-home-destination')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-page')).not.toBeInTheDocument();
    expect(listContestsMock).not.toHaveBeenCalled();
  });

  it('lets a root admin who is not a commissioner manage the league\'s contests', async () => {
    primeCommonMocks({ isRootAdmin: true, leagueRole: 'MEMBER' });
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-empty')).toBeInTheDocument();
  });

  it('marks Contests as the current tool in the Commissioner tools menu', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    expect(await screen.findByTestId('commissioner-tools-menu-contests')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('commissioner-tools-menu-settings')).not.toHaveAttribute('aria-current');
  });

  it('offers a commissioner of an active league Create contest when the league has none', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    const empty = within(await screen.findByTestId('manage-contests-empty'));
    expect(empty.getByText('No contests yet')).toBeInTheDocument();
    expect(empty.getByRole('link', { name: 'Create contest' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/new');
    expect(screen.getByTestId('manage-contests-create-link')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/new');
  });

  it('marks an inactive league and offers no way to create a contest in it', async () => {
    primeCommonMocks({ leagueActive: false });
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-empty')).toBeInTheDocument();
    expect(screen.getByText('League inactive')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Create contest' })).not.toBeInTheDocument();
  });

  it('shows an error instead of an empty list when the contest list fails to load', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } },
      status: 500,
    });

    renderManageContestsPage();

    expect(await screen.findByText("We couldn't load contests for this league.")).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-empty')).not.toBeInTheDocument();
  });

  it('shows the league load error with a way back when the league cannot be read', async () => {
    primeCommonMocks();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'No league' } },
      status: 404,
    });

    renderManageContestsPage();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
    expect(screen.queryByTestId('manage-contests-page')).not.toBeInTheDocument();
    expect(listContestsMock).not.toHaveBeenCalled();
  });
});
