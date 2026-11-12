import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { Toaster } from '@/features/shared/ui';
import { AuthProvider } from '@/features/auth/auth-provider';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { ManageContestsPage } from './manage-contests-page';
import type { ContestDto, SportEventDto } from '@/lib/api';
import { buildContest, buildSportEvent } from './test/contest-admin-fixtures';

const deleteContestMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestFinishedYearsMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const openContestMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  deleteContest: deleteContestMock,
  getEvent: getEventMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContestFinishedYears: listContestFinishedYearsMock,
  listContests: listContestsMock,
  listLeagueSquads: listLeagueSquadsMock,
  openContest: openContestMock,
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
                  <Route element={<div data-testid="manage-contest-destination" />} path="contests/:contestId" />
                </Route>
              </Route>
            </Route>
            <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
            <Route element={<div data-testid="welcome-destination" />} path="/welcome" />
            <Route element={<div data-testid="member-contest-destination" />} path="/league/:leagueCode/contests/:contestId/*" />
          </Routes>
          <Toaster />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

const masters = buildSportEvent({ id: 'event-1', name: 'The Masters', startDate: '2099-04-09T12:40:00.000Z' });
const heritage = buildSportEvent({ id: 'event-2', name: 'RBC Heritage', startDate: '2099-04-16T12:00:00.000Z' });
const players = buildSportEvent({ id: 'event-3', name: 'The Players', startDate: '2099-03-12T12:00:00.000Z' });

/** A listed contest on `event`: the contest list carries the event's name and start. */
function onEvent(event: SportEventDto): Pick<ContestDto, 'sportEvents'> {
  return {
    sportEvents: [{ sportEventId: event.id, sequence: 1, name: event.name, startDate: event.startDate, endDate: null, status: event.status, participantType: null, scoringFamily: null }],
  };
}

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
    // Two active teams; a third, inactive one is not counted (#1165).
    { membership: buildLeagueMembership({ role: leagueRole }), activeTeamCount: 2 },
  )));
  listContestFinishedYearsMock.mockResolvedValue(apiSuccess({ years: [] }));
}

/** The server's current contests, and its finished ones by the year they went final in. */
function primeContests(current: ContestDto[], finishedByYear: Record<number, ContestDto[]> = {}) {
  listContestsMock.mockImplementation(({ query }: { query?: { finishedYear?: number } }) => Promise.resolve(apiSuccess({
    contests: query?.finishedYear === undefined ? current : finishedByYear[query.finishedYear] ?? [],
  })));
  listContestFinishedYearsMock.mockResolvedValue(apiSuccess({
    years: Object.keys(finishedByYear).map(Number).sort((left, right) => right - left),
  }));
}

function rowOrder() {
  return within(screen.getByTestId('manage-contests-table'))
    .getAllByRole('row')
    .slice(1)
    .map((row) => row.getAttribute('data-testid'));
}

describe('ManageContestsPage', () => {
  afterEach(() => {
    for (const mock of [deleteContestMock, openContestMock, getCurrentUserMock, getEventMock, getLeagueByCodeMock, listContestFinishedYearsMock, listContestsMock, listLeagueSquadsMock, refreshTokenMock]) {
      mock.mockReset();
    }
  });

  it('shows each contest with its format, readable status, event and entries, and no per-row Manage button', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', ...onEvent(masters) }),
        buildContest({ id: 'contest-2', name: 'Heritage Tiers', status: 'OPEN', ...onEvent(heritage), entryCount: 1 }),
      ],
    }));

    renderManageContestsPage();

    const notOpen = within(await screen.findByTestId('manage-contests-row-contest-1'));
    expect(notOpen.getByText('Tiered')).toBeInTheDocument();
    expect(notOpen.getByText('Set up')).toBeInTheDocument();
    expect(await notOpen.findByText('The Masters')).toBeInTheDocument();
    expect(notOpen.getByText(/^Starts/)).toBeInTheDocument();
    expect(notOpen.getByText('Not open')).toBeInTheDocument();
    expect(notOpen.getByRole('link', { name: /Masters One-and-Done/ })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1');
    expect(notOpen.queryByRole('link', { name: 'Finish setup' })).not.toBeInTheDocument();

    const open = within(screen.getByTestId('manage-contests-row-contest-2'));
    expect(open.getByText('Open')).toBeInTheDocument();
    expect(await open.findByText(/^Entries close/)).toBeInTheDocument();
    // The league context counts the active teams, so no team list is read.
    expect(await open.findByText('of 2 members')).toBeInTheDocument();
    expect(listLeagueSquadsMock).not.toHaveBeenCalled();
    expect(open.getByRole('link', { name: /Heritage Tiers/ })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-2');
    expect(open.queryByRole('link', { name: 'Manage' })).not.toBeInTheDocument();
    expect(screen.queryByText(/TIERED|STROKE_PLAY/)).not.toBeInTheDocument();
  });

  it('lists contests not yet open first, then by their event\'s start, soonest first', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'open-heritage', status: 'OPEN', ...onEvent(heritage) }),
        buildContest({ id: 'live-players', status: 'ACTIVE', ...onEvent(players) }),
        buildContest({ id: 'draft-heritage', status: 'DRAFT', ...onEvent(heritage) }),
        buildContest({ id: 'draft-masters', status: 'DRAFT', ...onEvent(masters) }),
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

  it('lists contests from the contest list alone, without reading each contest\'s event', async () => {
    primeCommonMocks();
    primeContests(
      [buildContest({ id: 'draft-heritage', status: 'DRAFT', ...onEvent(heritage) })],
      { 2099: [buildContest({ id: 'final-players', status: 'COMPLETED', ...onEvent(players) })] },
    );

    renderManageContestsPage();

    expect(await within(await screen.findByTestId('manage-contests-row-draft-heritage')).findByText('RBC Heritage')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('manage-contests-filter-history'));
    expect(await within(await screen.findByTestId('manage-contests-row-final-players')).findByText('The Players')).toBeInTheDocument();
    expect(getEventMock).not.toHaveBeenCalled();
  });

  it('says a contest has no event when the list carries none, and still lists the contest', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [buildContest({ id: 'contest-bare', name: 'Bare Pool', sportEvents: [] })],
    }));

    renderManageContestsPage();

    const row = within(await screen.findByTestId('manage-contests-row-contest-bare'));
    expect(row.getByText('No event')).toBeInTheDocument();
    expect(row.getByText('Bare Pool')).toBeInTheDocument();
  });

  it('keeps finished contests under History, one year at a time, asking for a year only once History is chosen', async () => {
    primeCommonMocks();
    primeContests(
      [buildContest({ id: 'contest-open', name: 'Heritage Tiers', status: 'OPEN', ...onEvent(heritage) })],
      { 2099: [buildContest({ id: 'contest-final', name: 'Players Pick 6', status: 'COMPLETED', ...onEvent(players) })] },
    );

    renderManageContestsPage();

    expect(await screen.findByTestId('manage-contests-row-contest-open')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-row-contest-final')).not.toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-filter-active')).toHaveTextContent('Active 1');
    expect(listContestsMock.mock.calls.map((call: unknown[]) => (call[0] as { query?: unknown }).query)).toEqual([undefined]);

    await userEvent.click(screen.getByTestId('manage-contests-filter-history'));

    expect(await screen.findByTestId('manage-contests-row-contest-final')).toHaveTextContent('Final');
    expect(screen.queryByTestId('manage-contests-row-contest-open')).not.toBeInTheDocument();
    expect(listContestsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { finishedYear: 2099 } }));
  });

  it('opens History on the newest year with finished contests and shows another year when it is picked', async () => {
    primeCommonMocks();
    primeContests([], {
      2098: [buildContest({ id: 'contest-older', name: 'Older Pool', status: 'COMPLETED', ...onEvent(masters) })],
      2099: [buildContest({ id: 'contest-newer', name: 'Newer Pool', status: 'COMPLETED', ...onEvent(players) })],
    });

    renderManageContestsPage();

    await userEvent.click(await screen.findByTestId('manage-contests-filter-history'));
    const picker = await screen.findByRole('combobox', { name: 'Season' });
    expect(picker).toBe(screen.getByTestId('manage-contests-history-year'));
    expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['2099', '2098']);
    expect(await screen.findByTestId('manage-contests-row-contest-newer')).toBeInTheDocument();

    fireEvent.change(picker, { target: { value: '2098' } });

    expect(await screen.findByTestId('manage-contests-row-contest-older')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-row-contest-newer')).not.toBeInTheDocument();
  });

  it('says a year\'s finished contests could not be loaded rather than showing none, keeping the views and search above it', async () => {
    primeCommonMocks();
    primeContests([buildContest({ id: 'contest-open', status: 'OPEN', ...onEvent(heritage) })], { 2099: [] });
    listContestsMock.mockImplementation(({ query }: { query?: { finishedYear?: number } }) => Promise.resolve(query?.finishedYear === undefined
      ? apiSuccess({ contests: [buildContest({ id: 'contest-open', status: 'OPEN', ...onEvent(heritage) })] })
      : { error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } }));

    renderManageContestsPage();

    await userEvent.click(await screen.findByTestId('manage-contests-filter-history'));

    expect(await screen.findByTestId('manage-contests-history-error')).toHaveTextContent('We couldn\'t load the contests finished in 2099.');
    expect(screen.getByRole('radio', { name: 'Active 1' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'History' })).toBeChecked();
    expect(screen.getByTestId('manage-contests-search')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contests-table')).not.toBeInTheDocument();
  });

  it('keeps what was typed in the search when the list moves from Active to History', async () => {
    primeCommonMocks();
    primeContests(
      [buildContest({ id: 'contest-open', name: 'Heritage Tiers', status: 'OPEN', ...onEvent(heritage) })],
      { 2099: [buildContest({ id: 'contest-final', name: 'Players Pick 6', status: 'COMPLETED', ...onEvent(players) })] },
    );

    renderManageContestsPage();

    await userEvent.type(await screen.findByTestId('manage-contests-search'), 'Players');
    await userEvent.click(screen.getByTestId('manage-contests-filter-history'));

    expect(await screen.findByTestId('manage-contests-row-contest-final')).toBeInTheDocument();
    expect(screen.getByTestId('manage-contests-search')).toHaveValue('Players');
  });

  it('finds a contest by its event\'s name as well as its own', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [
        buildContest({ id: 'contest-1', name: 'Spring Major', ...onEvent(masters) }),
        buildContest({ id: 'contest-2', name: 'Heritage Tiers', ...onEvent(heritage) }),
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
    expect(screen.getAllByRole('button', { name: /^Actions for Contest/ })).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getAllByRole('button', { name: /^Actions for Contest/ })).toHaveLength(5);
  });

  it('opens a contest\'s Manage page from a click anywhere on its row', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', ...onEvent(masters) })],
    }));

    renderManageContestsPage();
    await userEvent.click(within(await screen.findByTestId('manage-contests-row-contest-1')).getByText('Not open'));

    expect(await screen.findByTestId('manage-contest-destination')).toBeInTheDocument();
  });

  it('opens a contest in setup to the league from its "⋯" once the commissioner confirms, and says so', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', ...onEvent(masters) })],
    }));
    openContestMock.mockResolvedValue(apiSuccess({ contest: buildContest({ id: 'contest-1', status: 'OPEN' }) }));

    renderManageContestsPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Masters One-and-Done' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Open to league' }));
    expect(await screen.findByRole('dialog', { name: 'Open this contest to the league?' })).toBeInTheDocument();
    expect(openContestMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('contest-open-confirm'));

    await waitFor(() => expect(openContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', contestId: 'contest-1' } })));
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Masters One-and-Done is open to the league');
    expect(screen.queryByTestId('manage-contest-destination')).not.toBeInTheDocument();
  });

  it('deletes a contest in setup from its "⋯" once the commissioner confirms, says so, and stays on the list', async () => {
    primeCommonMocks();
    listContestsMock
      .mockResolvedValueOnce(apiSuccess({
        contests: [buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', ...onEvent(masters) })],
      }))
      .mockResolvedValue(apiSuccess({ contests: [] }));
    deleteContestMock.mockResolvedValue({ data: undefined });

    renderManageContestsPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Masters One-and-Done' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByRole('dialog', { name: 'Delete this contest?' })).toHaveTextContent('Masters One-and-Done will be removed for good.');
    await userEvent.click(screen.getByRole('button', { name: 'Delete contest' }));

    await waitFor(() => expect(deleteContestMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } })));
    expect(await screen.findByTestId('app-toast')).toHaveTextContent('Masters One-and-Done deleted');
    expect(screen.queryByTestId('manage-contest-destination')).not.toBeInTheDocument();
  });

  it('offers a contest members can see only a way to view it as they do, from its "⋯"', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [buildContest({ id: 'contest-2', name: 'Heritage Tiers', status: 'OPEN', ...onEvent(heritage) })],
    }));

    renderManageContestsPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Heritage Tiers' }));

    expect(screen.getAllByRole('menuitem')).toHaveLength(1);
    await userEvent.click(screen.getByRole('menuitem', { name: 'View as members see it' }));
    expect(await screen.findByTestId('member-contest-destination')).toBeInTheDocument();
  });

  it('offers no quick actions on a contest in setup while the league is inactive', async () => {
    primeCommonMocks({ leagueActive: false });
    listContestsMock.mockResolvedValue(apiSuccess({
      contests: [buildContest({ id: 'contest-1', name: 'Masters One-and-Done', status: 'DRAFT', ...onEvent(masters) })],
    }));

    renderManageContestsPage();

    await screen.findByTestId('manage-contests-row-contest-1');
    expect(screen.queryByRole('button', { name: 'Actions for Masters One-and-Done' })).not.toBeInTheDocument();
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

  it('offers a commissioner of an active league Create contest when the league has none, beside a way to browse every contest type', async () => {
    primeCommonMocks();
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderManageContestsPage();

    const empty = within(await screen.findByTestId('manage-contests-empty'));
    expect(empty.getByText('No contests yet')).toBeInTheDocument();
    expect(empty.getByRole('link', { name: 'Create contest' })).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/new');
    expect(screen.getByTestId('manage-contests-create-link')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/new');
    expect(screen.getByTestId('manage-contests-contest-types-link')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contest-types');
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
