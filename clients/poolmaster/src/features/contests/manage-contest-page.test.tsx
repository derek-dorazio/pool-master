import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto, ContestManagementDetailDto, SportEventDto } from '@/lib/api';
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
import { EditContestPage } from './edit-contest-page';
import { ManageContestPage } from './manage-contest-page';
import {
  buildContest,
  buildContestEntry,
  buildManagedContest,
  buildSportEvent,
  buildTier,
} from './test/contest-admin-fixtures';

const deleteContestMock = vi.fn();
const getContestConfigurationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const openContestMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateContestConfigurationMock = vi.fn();
const updateContestMock = vi.fn();

bindApiMocks({
  deleteContest: deleteContestMock,
  getContestConfiguration: getContestConfigurationMock,
  getEvent: getEventMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContestEntries: listContestEntriesMock,
  listContests: listContestsMock,
  listLeagueSquads: listLeagueSquadsMock,
  openContest: openContestMock,
  refreshToken: refreshTokenMock,
  updateContest: updateContestMock,
  updateContestConfiguration: updateContestConfigurationMock,
});

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<MemberRouteGuard />}>
              <Route element={<CommissionerRouteGuard />} path="/league/:leagueCode/admin">
                <Route element={<CommissionerToolsLayout />}>
                  <Route element={<div data-testid="contests-list-destination" />} path="contests" />
                  <Route element={<ManageContestPage />} path="contests/:contestId" />
                  <Route element={<EditContestPage />} path="contests/:contestId/edit" />
                </Route>
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeMocks({
  contest = buildContest(),
  event = buildSportEvent(),
  managedContest = buildManagedContest(),
}: {
  contest?: ContestDto;
  event?: SportEventDto;
  managedContest?: ContestManagementDetailDto;
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership() },
  )));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData([
    buildLeagueSquad({ id: 'team-1' }),
    buildLeagueSquad({ id: 'team-2', name: 'Second Team' }),
    buildLeagueSquad({ id: 'team-3', name: 'Third Team' }),
  ])));
  listContestsMock.mockResolvedValue(apiSuccess({ contests: [contest] }));
  getContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: managedContest }));
  getEventMock.mockResolvedValue(apiSuccess({ event }));
  listContestEntriesMock.mockResolvedValue(apiSuccess({
    contestId: contest.id,
    total: 0,
    picksRevealed: false,
    entries: [],
  }));
}

afterEach(() => {
  for (const mock of [
    deleteContestMock, getContestConfigurationMock, getCurrentUserMock, getEventMock, getLeagueByCodeMock,
    listContestEntriesMock, listContestsMock, listLeagueSquadsMock, openContestMock, refreshTokenMock,
    updateContestConfigurationMock, updateContestMock,
  ]) {
    mock.mockReset();
  }
});

describe('Commissioner tools › Contests › one contest', () => {
  it('leads a contest not yet open with its readiness checks and Open to league, then its settings as rows', async () => {
    primeMocks();

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    const card = within(await screen.findByTestId('contest-status-card'));
    expect(card.getByText('Ready to open to the league')).toBeInTheDocument();
    expect(card.getByTestId('contest-readiness-field')).toHaveTextContent('89 golfers in 6 tiers');
    expect(card.getByTestId('contest-readiness-not-started')).toHaveAttribute('data-met', 'true');
    expect(card.getByTestId('contest-open-to-league')).toBeInTheDocument();
    expect(card.getByRole('link', { name: 'Preview as a member' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');

    expect(screen.getByTestId('manage-contest-format')).toHaveTextContent('Tiered');
    expect(screen.getByTestId('manage-contest-rules')).toHaveTextContent('Pick 1 golfer from each of 6 tiers. The best 4 scores count.');
    expect(screen.getByTestId('manage-contest-entries-per-team')).toHaveTextContent('1');
    expect(screen.getByTestId('manage-contest-event-row')).toHaveTextContent('The Masters · Augusta National');
    expect(screen.getByTestId('manage-contest-edit')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1/edit');
    expect(screen.getByTestId('contest-delete')).toHaveTextContent('Delete contest');
  });

  it('lists the event\'s tiers as Tier 1, Tier 2… with Tier 1 on top, each with its golfer count', async () => {
    primeMocks({
      managedContest: buildManagedContest({ effectiveTiers: [buildTier(3, 14), buildTier(1, 8), buildTier(2, 1)] }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    const tiers = within(await screen.findByTestId('contest-tiers'));
    const rows = tiers.getAllByTestId(/^contest-tier-\d$/);
    expect(rows.map((row) => row.getAttribute('data-testid'))).toEqual(['contest-tier-1', 'contest-tier-2', 'contest-tier-3']);
    expect(rows[0]).toHaveTextContent('Tier 1');
    expect(rows[0]).toHaveTextContent('8 golfers');
    expect(rows[1]).toHaveTextContent('1 golfer');
  });

  it('says a contest is not ready to open when its event has started', async () => {
    primeMocks({
      event: buildSportEvent({ readinessStatus: 'EVENT_STARTED', readinessReasons: ['EVENT_STARTED'], contestEligible: false }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByText('Not ready to open yet')).toBeInTheDocument();
    expect(screen.getByTestId('contest-readiness-not-started')).toHaveAttribute('data-met', 'false');
    expect(screen.getByTestId('contest-readiness-not-started')).toHaveTextContent('Event has started');
  });

  it('deletes a contest only after the confirm, then returns to the contest list', async () => {
    primeMocks();
    deleteContestMock.mockResolvedValue({ data: undefined });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-delete'));
    expect(await screen.findByTestId('contest-delete-dialog')).toBeInTheDocument();
    expect(deleteContestMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('contest-delete-dialog-confirm'));

    await waitFor(() => expect(deleteContestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { contestId: 'contest-1' } }),
    ));
    expect(await screen.findByTestId('contests-list-destination')).toBeInTheDocument();
  });

  it('keeps the delete dialog open with a message when the delete is refused', async () => {
    primeMocks();
    deleteContestMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR' } }, status: 500 });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-delete'));
    fireEvent.click(await screen.findByTestId('contest-delete-dialog-confirm'));

    expect(await screen.findByTestId('contest-delete-error')).toHaveTextContent('We could not delete that contest. Please try again.');
    expect(screen.queryByTestId('contests-list-destination')).not.toBeInTheDocument();
  });

  it('opens the contest only after the confirm, then shows its settings locked with no Edit or Delete', async () => {
    primeMocks();
    openContestMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest({ status: 'OPEN' }) }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-open-to-league'));
    expect(await screen.findByTestId('contest-open-dialog')).toBeInTheDocument();
    expect(openContestMock).not.toHaveBeenCalled();

    listContestsMock.mockResolvedValue(apiSuccess({ contests: [buildContest({ status: 'OPEN' })] }));
    getContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest({ status: 'OPEN' }) }));
    fireEvent.click(screen.getByTestId('contest-open-confirm'));

    await waitFor(() => expect(openContestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: 'league-1', contestId: 'contest-1' } }),
    ));
    expect(await screen.findByTestId('manage-contest-locked')).toHaveTextContent('Locked');
    expect(screen.queryByTestId('manage-contest-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-delete')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-open-to-league')).not.toBeInTheDocument();
  });

  it('shows the event-started copy in the open dialog when opening is refused for that reason', async () => {
    primeMocks();
    openContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_EVENT_ALREADY_STARTED', message: 'server sentence' } },
      status: 409,
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-open-to-league'));
    fireEvent.click(await screen.findByTestId('contest-open-confirm'));

    expect(await screen.findByTestId('contest-open-error')).toHaveTextContent(/already started/);
  });

  it('counts an open contest\'s teams with a submitted entry against the league\'s active teams', async () => {
    primeMocks({ contest: buildContest({ status: 'OPEN' }), managedContest: buildManagedContest({ status: 'OPEN' }) });
    listContestEntriesMock.mockResolvedValue(apiSuccess({
      contestId: 'contest-1',
      total: 3,
      picksRevealed: false,
      entries: [
        buildContestEntry({ id: 'entry-1', squadId: 'team-1' }),
        buildContestEntry({ id: 'entry-2', squadId: 'team-1', entryNumber: 2 }),
        buildContestEntry({ id: 'entry-3', squadId: 'team-2', status: 'DRAFT' }),
      ],
    }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByText('1 of 3 teams have entered')).toBeInTheDocument();
    expect(screen.getByTestId('contest-stat-entries')).toHaveTextContent('2');
    expect(screen.getByTestId('contest-stat-teams-to-go')).toHaveTextContent('2');
    expect(screen.getByRole('link', { name: 'View in league' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-1');
    expect(screen.queryByTestId('manage-contest-danger-zone')).not.toBeInTheDocument();
  });

  it.each([
    ['live', 'ACTIVE', 'Full leaderboard'],
    ['final', 'COMPLETED', 'See the results'],
  ] as const)('links a %s contest to its leaderboard', async (_label, status, linkName) => {
    primeMocks({ contest: buildContest({ status }), managedContest: buildManagedContest({ status }) });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByRole('link', { name: linkName })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1/leaderboard',
    );
    expect(screen.getByTestId('manage-contest-locked')).toBeInTheDocument();
  });

  it('says the contest is not in the league when the list has no such contest', async () => {
    primeMocks();
    listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-not-found')).toHaveTextContent("This contest isn't in this league");
  });
});

describe('Commissioner tools › Contests › one contest › Edit', () => {
  it('saves the name and rules together, then returns to the contest page', async () => {
    primeMocks({
      managedContest: buildManagedContest({
        configuration: { id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 2, picksPerTier: 1, countedScores: 4 },
      }),
    });
    updateContestMock.mockResolvedValue(apiSuccess({ contest: buildContest({ name: 'Masters Best Four' }) }));
    updateContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest() }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    expect(await screen.findByTestId('contest-name')).toHaveValue('Masters One-and-Done');
    expect(screen.getByTestId('contest-max-entries')).toHaveValue(2);
    expect(screen.getByText('The Masters', { exact: false })).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('contest-name'), { target: { value: 'Masters Best Four' } });
    fireEvent.change(screen.getByTestId('contest-tiered-counted-scores'), { target: { value: '3' } });
    fireEvent.click(screen.getByTestId('contest-max-entries-unlimited'));
    fireEvent.click(screen.getByTestId('edit-contest-save'));

    await waitFor(() => expect(updateContestConfigurationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: { id: 'league-1', contestId: 'contest-1' },
        body: { picksPerTier: 1, countedScores: 3 },
      }),
    ));
    expect(updateContestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { contestId: 'contest-1' }, body: { name: 'Masters Best Four' } }),
    );
    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
  });

  it('refuses more scores that count than golfers picked, without sending anything', async () => {
    primeMocks();

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    fireEvent.change(await screen.findByTestId('contest-tiered-counted-scores'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('edit-contest-save'));

    expect(await screen.findByText('Scores that count must be between 1 and the 6 golfers picked.')).toBeInTheDocument();
    expect(updateContestMock).not.toHaveBeenCalled();
    expect(updateContestConfigurationMock).not.toHaveBeenCalled();
  });

  it('leaves the name as it was when the rules are refused, and says the contest could not be saved', async () => {
    primeMocks();
    updateContestConfigurationMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR' } }, status: 500 });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    fireEvent.change(await screen.findByTestId('contest-name'), { target: { value: 'Masters Best Four' } });
    fireEvent.click(screen.getByTestId('edit-contest-save'));

    expect(await screen.findByText('We could not save that contest. Please try again.')).toBeInTheDocument();
    expect(updateContestConfigurationMock).toHaveBeenCalled();
    expect(updateContestMock).not.toHaveBeenCalled();
  });

  it('goes back to the contest page once the contest is open, since its settings are locked', async () => {
    primeMocks({ contest: buildContest({ status: 'OPEN' }), managedContest: buildManagedContest({ status: 'OPEN' }) });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    expect(await screen.findByTestId('manage-contest-locked')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-contest-page')).not.toBeInTheDocument();
  });
});
