import { PlanFeature, SelectionType } from '@poolmaster/shared/domain';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContestDto, ContestExpansionResponse, ContestManagementDetailDto, SportEventDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { CommissionerToolsLayout } from '@/features/leagues/commissioner-tools-layout';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import { CommissionerRouteGuard, MemberRouteGuard } from '@/routes/route-guards';
import { EditContestCupWeightPage } from './edit-contest-cup-weight-page';
import { EditContestPage } from './edit-contest-page';
import { ManageContestPage } from './manage-contest-page';
import {
  buildContest,
  buildContestEntry,
  buildContestSportEvent,
  buildManagedContest,
  buildSelectionState,
  buildSportEvent,
  buildTier,
} from './test/contest-admin-fixtures';

const deleteContestMock = vi.fn();
const expandContestMock = vi.fn();
const getContestExpansionMock = vi.fn();
const grantContestExpansionMock = vi.fn();
const getContestConfigurationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getSelectionStateMock = vi.fn();
const getSportLeagueMock = vi.fn();
const runContestDrawMock = vi.fn();
const setContestCupWeightMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const openContestMock = vi.fn();
const refreshTokenMock = vi.fn();
const updateContestConfigurationMock = vi.fn();
const updateContestMock = vi.fn();

bindApiMocks({
  deleteContest: deleteContestMock,
  expandContest: expandContestMock,
  getContestExpansion: getContestExpansionMock,
  grantContestExpansion: grantContestExpansionMock,
  getContestConfiguration: getContestConfigurationMock,
  getEvent: getEventMock,
  getUser: getCurrentUserMock,
  getLeagueByCode: getLeagueByCodeMock,
  getSelectionState: getSelectionStateMock,
  getSportLeague: getSportLeagueMock,
  runContestDraw: runContestDrawMock,
  setContestCupWeight: setContestCupWeightMock,
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
                  <Route element={<EditContestCupWeightPage />} path="contests/:contestId/cup-weight" />
                </Route>
              </Route>
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

/** A Free contest's entries: 12 of its plan's 20, with the Free price list's bands on offer. */
function buildExpansion(overrides: Partial<ContestExpansionResponse> = {}): ContestExpansionResponse {
  return {
    entriesPerContest: 20,
    entryCount: 12,
    expandedTo: null,
    expandable: true,
    paymentsEnabled: false,
    offers: [
      { entriesPerContest: 50, priceCents: 1000 },
      { entriesPerContest: 100, priceCents: 2000 },
    ],
    ...overrides,
  };
}

function primeMocks({
  contest = buildContest(),
  event = buildSportEvent(),
  managedContest = buildManagedContest(),
  features = Object.values(PlanFeature),
  expansion = buildExpansion(),
  isRootAdmin = false,
}: {
  features?: PlanFeature[];
  expansion?: ContestExpansionResponse;
  isRootAdmin?: boolean;
  contest?: ContestDto;
  event?: SportEventDto;
  managedContest?: ContestManagementDetailDto;
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ planEntitlements: buildPlanEntitlements({ features }) }),
    { membership: buildLeagueMembership(), activeTeamCount: 3 },
  )));
  listContestsMock.mockResolvedValue(apiSuccess({ contests: [contest] }));
  getContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: managedContest }));
  getEventMock.mockResolvedValue(apiSuccess({ event }));
  getContestExpansionMock.mockResolvedValue(apiSuccess(expansion));
  listContestEntriesMock.mockResolvedValue(apiSuccess({
    contestId: contest.id,
    total: 0,
    picksRevealed: false,
    entries: [],
  }));
}

afterEach(() => {
  for (const mock of [
    deleteContestMock, expandContestMock, getContestExpansionMock, grantContestExpansionMock, getContestConfigurationMock, getCurrentUserMock, getEventMock, getLeagueByCodeMock,
    getSelectionStateMock, getSportLeagueMock, runContestDrawMock, setContestCupWeightMock,
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
      managedContest: buildManagedContest({ sportEvents: [{ sportEventId: 'event-1', effectiveTiers: [buildTier(3, 14), buildTier(1, 8), buildTier(2, 1)] }] }),
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

  it('says in the same words as Create contest when opening is refused because the budget roster cannot be filled', async () => {
    primeMocks();
    openContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_BUDGET_UNFILLABLE', message: 'server sentence' } },
      status: 409,
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-open-to-league'));
    fireEvent.click(await screen.findByTestId('contest-open-confirm'));

    expect(await screen.findByTestId('contest-open-error')).toHaveTextContent(
      'Even the cheapest picks for every place cost more than the salary cap, so nobody could enter. Pick fewer per entry.',
    );
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
        buildContestEntry({ id: 'entry-3', squadId: 'team-2', events: [{ sportEventId: 'event-1', status: 'DRAFT', submittedAt: null }] }),
      ],
    }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByText('1 of 3 members have entered')).toBeInTheDocument();
    // The active team count comes with the league context, not from the team list.
    expect(listLeagueSquadsMock).not.toHaveBeenCalled();
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

describe('Commissioner tools › Contests › one contest › Entries', () => {
  it('shows the entries against the cap and each larger size with its price, free while payments are off', async () => {
    primeMocks();

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('contest-expansion-entries')).toHaveTextContent('12 of 20');
    expect(screen.getByTestId('contest-expansion-offer-50')).toHaveTextContent('Up to 50');
    expect(screen.getByTestId('contest-expansion-offer-50')).toHaveTextContent('$10, free while payments are off');
    expect(screen.getByTestId('contest-expansion-offer-100')).toHaveTextContent('$20, free while payments are off');
    expect(screen.queryByTestId('contest-expansion-full')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-expansion-grant')).not.toBeInTheDocument();
  });

  it('expands a full contest to the size chosen and then shows the new cap', async () => {
    primeMocks({ expansion: buildExpansion({ entryCount: 20 }) });
    const expanded = buildExpansion({
      entriesPerContest: 50,
      entryCount: 20,
      expandedTo: 50,
      offers: [{ entriesPerContest: 100, priceCents: 1000 }],
    });
    expandContestMock.mockResolvedValue(apiSuccess(expanded));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('contest-expansion-full')).toHaveTextContent('This contest is full at 20 entries.');
    getContestExpansionMock.mockResolvedValue(apiSuccess(expanded));
    fireEvent.click(screen.getByTestId('contest-expansion-expand-50'));

    await waitFor(() => expect(expandContestMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', contestId: 'contest-1' },
      body: { entriesPerContest: 50 },
    })));
    expect(await screen.findByTestId('contest-expansion-expanded-to')).toHaveTextContent('50 entries');
    expect(screen.getByTestId('contest-expansion-entries')).toHaveTextContent('20 of 50');
    expect(screen.queryByTestId('contest-expansion-full')).not.toBeInTheDocument();
  });

  it('keeps Expand off and says paying is not available yet while payments are on', async () => {
    primeMocks({ expansion: buildExpansion({ paymentsEnabled: true }) });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('contest-expansion-offer-50')).toHaveTextContent('$10');
    expect(screen.getByTestId('contest-expansion-offer-50')).not.toHaveTextContent('free while payments are off');
    expect(screen.getByTestId('contest-expansion-expand-50')).toBeDisabled();
    expect(screen.getByTestId('contest-expansion-checkout-unavailable')).toHaveTextContent('Paying for an expansion isn\'t available yet.');
  });

  it('shows the reason when an expansion is refused', async () => {
    primeMocks();
    expandContestMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_EXPANSION_CLOSED', message: 'server sentence' } },
      status: 409,
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByTestId('contest-expansion-expand-50'));

    expect(await screen.findByTestId('contest-expansion-expand-error')).toHaveTextContent('can no longer be expanded');
  });

  it('lets a root admin give any size free with a reason, and sends nothing until both are filled', async () => {
    primeMocks({ isRootAdmin: true });
    grantContestExpansionMock.mockResolvedValue(apiSuccess(buildExpansion({ entriesPerContest: 75, expandedTo: 75 })));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    await screen.findByTestId('contest-expansion-grant');
    fireEvent.change(screen.getByTestId('contest-expansion-grant-entries'), { target: { value: '75' } });
    expect(screen.getByTestId('contest-expansion-grant-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('contest-expansion-grant-reason'), { target: { value: 'Charity pool' } });
    fireEvent.click(screen.getByTestId('contest-expansion-grant-submit'));

    await waitFor(() => expect(grantContestExpansionMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', contestId: 'contest-1' },
      body: { entriesPerContest: 75, reason: 'Charity pool' },
    })));
  });
});

describe('Commissioner tools › Contests › one random-draw contest', () => {
  const DRAWN_AT = '2099-04-08T15:00:00.000Z';

  function primeDrawMocks(drawnAt: string | null = null) {
    primeMocks({
      contest: buildContest({ name: 'Masters Sweepstake', selectionType: SelectionType.RANDOM_DRAW, status: 'OPEN', drawnAt }),
      managedContest: buildManagedContest({
        status: 'OPEN',
        configuration: {
          id: 'config-contest-1',
          contestId: 'contest-1',
          maxEntriesPerSquad: 1,
          selectionType: SelectionType.RANDOM_DRAW,
          picksPerEntry: 3,
          countedScores: 2,
        },
      }),
    });
    listContestEntriesMock.mockResolvedValue(apiSuccess({
      contestId: 'contest-1',
      total: 2,
      picksRevealed: false,
      entries: [
        buildContestEntry({ id: 'entry-1', squadId: 'team-1', events: [{ sportEventId: 'event-1', status: 'DRAFT', submittedAt: null }], picksCount: 0 }),
        buildContestEntry({ id: 'entry-2', squadId: 'team-2', events: [{ sportEventId: 'event-1', status: 'DRAFT', submittedAt: null }], picksCount: 0 }),
      ],
    }));
    // The room is never drawn here: the card must read the draw from the contest itself.
    getSelectionStateMock.mockResolvedValue(apiSuccess(buildSelectionState({ drawnAt: null })));
  }

  it('reads the random-draw rules and offers Run draw for an open contest not yet drawn', async () => {
    primeDrawMocks();

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByText('2 entries waiting for the draw')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Run draw' })).toBeInTheDocument();
    expect(screen.getByTestId('manage-contest-format')).toHaveTextContent('Quick pick');
    expect(screen.getByTestId('manage-contest-rules')).toHaveTextContent('The draw deals each entry 3 golfers at random. The best 2 scores count.');
    expect(screen.getByTestId('manage-contest-event-row')).toHaveTextContent('Entries close when you run the draw');
  });

  it('runs the draw only after a confirm that says it is final and closes entries, then shows when it ran', async () => {
    primeDrawMocks();
    runContestDrawMock.mockResolvedValue(apiSuccess(buildSelectionState({ drawnAt: DRAWN_AT })));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Run draw' }));
    const dialog = within(await screen.findByTestId('contest-run-draw-dialog'));
    expect(dialog.getByText(/deals each of the 2 entries 3 golfers at random/)).toBeInTheDocument();
    expect(dialog.getByText(/It’s final: it can’t be undone or run again. Entries close/)).toBeInTheDocument();
    expect(runContestDrawMock).not.toHaveBeenCalled();

    listContestsMock.mockResolvedValue(apiSuccess({ contests: [buildContest({
      name: 'Masters Sweepstake', selectionType: SelectionType.RANDOM_DRAW, status: 'OPEN', drawnAt: DRAWN_AT,
    })] }));
    fireEvent.click(dialog.getByTestId('contest-run-draw-confirm'));

    await waitFor(() => expect(runContestDrawMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { contestId: 'contest-1' } }),
    ));
    expect(await screen.findByText('The draw has run')).toBeInTheDocument();
    expect(screen.getByTestId('contest-draw-ran')).toHaveTextContent(/^Drawn .+ Every entry has its golfers/);
    expect(screen.queryByRole('button', { name: 'Run draw' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-run-draw-dialog')).not.toBeInTheDocument();
  });

  it('keeps the draw dialog open with plain copy when the draw is refused because the field is too small', async () => {
    primeDrawMocks();
    runContestDrawMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_DRAW_FIELD_TOO_SMALL', message: 'server sentence' } },
      status: 409,
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    fireEvent.click(await screen.findByRole('button', { name: 'Run draw' }));
    fireEvent.click(await screen.findByTestId('contest-run-draw-confirm'));

    expect(await screen.findByTestId('contest-run-draw-error')).toHaveTextContent(
      'The field isn’t big enough to deal every entry its share, so nothing was dealt.',
    );
    expect(screen.getByTestId('contest-run-draw-dialog')).toBeInTheDocument();
  });

  it('shows a drawn contest as drawn with no Run draw', async () => {
    primeDrawMocks(DRAWN_AT);

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByText('The draw has run')).toBeInTheDocument();
    expect(screen.getByText('Drawn · entries closed')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Run draw' })).not.toBeInTheDocument();
  });

  it('offers no way to add or change events, since a random draw deals one event once', async () => {
    primeDrawMocks();

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-event-row')).toHaveTextContent('The Masters');
    expect(screen.queryByTestId('manage-contest-events-edit')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add events' })).not.toBeInTheDocument();
  });
});

describe('Commissioner tools › Contests › one contest › its events', () => {
  it.each([
    ['tiered', SelectionType.TIERED, buildManagedContest()],
    ['budget', SelectionType.BUDGET_PICK, buildManagedContest({
      configuration: {
        id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 1,
        selectionType: SelectionType.BUDGET_PICK, rosterSize: 6, countedScores: 4, salaryCap: 50_000,
      },
    })],
  ] as const)('offers "Add events" on a single-event %s contest, linking to its event picker', async (_label, selectionType, managedContest) => {
    primeMocks({ contest: buildContest({ selectionType }), managedContest });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    const link = await screen.findByTestId('manage-contest-events-edit');
    expect(link).toHaveTextContent('Add events');
    expect(link).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1/events');
    expect(screen.getByTestId('manage-contest-event-row')).toHaveTextContent('Event');
  });

  it('lists every event of a multi-event contest in order and offers "Change events"', async () => {
    primeMocks({
      contest: buildContest({
        sportEvents: [
          buildContestSportEvent(),
          buildContestSportEvent({ sportEventId: 'event-2', sequence: 2, name: 'PGA Championship', startDate: '2099-05-14T12:00:00.000Z' }),
        ],
      }),
      managedContest: buildManagedContest({
        sportEvents: [
          { sportEventId: 'event-1', effectiveTiers: [buildTier(1, 8)] },
          { sportEventId: 'event-2', effectiveTiers: [buildTier(1, 9)] },
        ],
      }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-events-edit')).toHaveTextContent('Change events');
    const row = screen.getByTestId('manage-contest-event-row');
    expect(row).toHaveTextContent('Events (2)');
    const listed = within(screen.getByTestId('manage-contest-event-list')).getAllByRole('listitem');
    expect(listed.map((item) => item.textContent.split(' · ')[0])).toEqual(['The Masters', 'PGA Championship']);
  });

  it('offers no way to add or change events once the contest is final', async () => {
    primeMocks({
      contest: buildContest({ status: 'COMPLETED' }),
      managedContest: buildManagedContest({ status: 'COMPLETED' }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-event-row')).toHaveTextContent('The Masters');
    expect(screen.queryByTestId('manage-contest-events-edit')).not.toBeInTheDocument();
  });
});

describe('Commissioner tools › Contests › one contest › Cup weight', () => {
  it('shows how much an open contest counts toward its cup, with an Edit to change it', async () => {
    primeMocks({
      contest: buildContest({ status: 'OPEN' }),
      managedContest: buildManagedContest({ status: 'OPEN', cupWeight: 'BONUS' }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-cup-weight')).toHaveTextContent('Bonus (x1.5)');
    expect(screen.getByTestId('manage-contest-cup-weight-edit')).toHaveAttribute('href', '/league/BIGDAWGS/admin/contests/contest-1/cup-weight');
  });

  it('shows a final contest\'s cup weight as fixed, with no Edit', async () => {
    primeMocks({
      contest: buildContest({ status: 'COMPLETED' }),
      managedContest: buildManagedContest({ status: 'COMPLETED', cupWeight: 'DOUBLE' }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-cup-weight')).toHaveTextContent('Double (x2)');
    expect(screen.getByTestId('manage-contest-cup-weight-final')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contest-cup-weight-edit')).not.toBeInTheDocument();
  });

  it('saves the weight chosen and returns to the contest page, which shows it', async () => {
    primeMocks({ managedContest: buildManagedContest({ status: 'OPEN' }) });
    setContestCupWeightMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest({ status: 'OPEN', cupWeight: 'DOUBLE' }) }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/cup-weight');

    fireEvent.click(await screen.findByTestId('edit-cup-weight-DOUBLE'));
    expect(screen.getByTestId('edit-cup-weight-DOUBLE')).toBeChecked();
    getContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest({ status: 'OPEN', cupWeight: 'DOUBLE' }) }));
    fireEvent.click(screen.getByRole('button', { name: 'Save weight' }));

    expect(await screen.findByTestId('manage-contest-cup-weight')).toHaveTextContent('Double (x2)');
    expect(setContestCupWeightMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', contestId: 'contest-1' },
      body: { cupWeight: 'DOUBLE' },
    }));
  });

  it('stays on the form with the reason when the contest went final before the save', async () => {
    primeMocks({ managedContest: buildManagedContest({ status: 'ACTIVE' }) });
    setContestCupWeightMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_FINAL', message: 'This contest is final, so how much it counts is fixed.' } },
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/cup-weight');

    fireEvent.click(await screen.findByTestId('edit-cup-weight-NOT_COUNTED'));
    fireEvent.click(screen.getByRole('button', { name: 'Save weight' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('This contest is final, so how much it counts is fixed.');
    expect(screen.getByTestId('edit-cup-weight-page')).toBeInTheDocument();
  });

  it('leaves the cup weight off the contest page on a plan without championship settings', async () => {
    primeMocks({ managedContest: buildManagedContest({ status: 'OPEN' }), features: [PlanFeature.CHAMPIONSHIP] });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.queryByTestId('manage-contest-championships')).not.toBeInTheDocument();
  });

  it('shows the locked note on Cup weight on a plan without championship settings', async () => {
    primeMocks({ managedContest: buildManagedContest({ status: 'OPEN' }), features: [PlanFeature.CHAMPIONSHIP] });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/cup-weight');

    expect(await screen.findByTestId('plan-locked-CUP_SETTINGS')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-cup-weight-page')).not.toBeInTheDocument();
  });

  it('sends a commissioner who opens Cup weight on a final contest back to the contest page', async () => {
    primeMocks({
      contest: buildContest({ status: 'COMPLETED' }),
      managedContest: buildManagedContest({ status: 'COMPLETED' }),
    });

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/cup-weight');

    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-cup-weight-page')).not.toBeInTheDocument();
  });
});

describe('Commissioner tools › Contests › one contest › Edit', () => {
  it('saves the name and rules together, then returns to the contest page', async () => {
    primeMocks({
      managedContest: buildManagedContest({
        configuration: { id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 2, selectionType: 'TIERED', picksPerTier: 1, countedScores: 4 },
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
        body: { selectionType: 'TIERED', picksPerTier: 1, countedScores: 3 },
      }),
    ));
    expect(updateContestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: { contestId: 'contest-1' }, body: { name: 'Masters Best Four' } }),
    );
    expect(await screen.findByTestId('manage-contest-page')).toBeInTheDocument();
  });

  it('edits a budget contest\'s golfers per entry under the event\'s cap, which it shows but does not send', async () => {
    primeMocks({
      contest: buildContest({ selectionType: 'BUDGET_PICK' }),
      managedContest: buildManagedContest({
        configuration: {
          id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 1,
          selectionType: 'BUDGET_PICK', rosterSize: 6, countedScores: 4, salaryCap: 50_000,
        },
      }),
    });
    updateContestMock.mockResolvedValue(apiSuccess({ contest: buildContest() }));
    updateContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: buildManagedContest() }));

    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    expect(await screen.findByTestId('contest-budget-roster-size')).toHaveValue(6);
    expect(screen.getByTestId('contest-budget-salary-cap')).toHaveTextContent('$50,000 salary cap');
    fireEvent.change(screen.getByTestId('contest-budget-roster-size'), { target: { value: '5' } });
    fireEvent.click(screen.getByTestId('edit-contest-save'));

    await waitFor(() => expect(updateContestConfigurationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { selectionType: 'BUDGET_PICK', rosterSize: 5, countedScores: 4, maxEntriesPerSquad: 1 },
      }),
    ));
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

/** A six-round basketball tournament, not started unless told otherwise. */
function basketballEvent(overrides: Partial<SportEventDto> = {}) {
  return buildSportEvent({ sport: 'BASKETBALL', name: 'March Madness', venue: null, rounds: 6, tierCount: 4, ...overrides });
}

/** A basketball tournament under way: released with its field, only started. */
const UNDER_WAY: Partial<SportEventDto> = {
  status: 'IN_PROGRESS',
  startDate: '2026-03-19T16:00:00.000Z',
  readinessStatus: 'EVENT_STARTED',
  readinessReasons: ['EVENT_STARTED'],
  contestEligible: false,
};

function bracketContest(overrides: Partial<ContestDto> = {}) {
  return buildContest({
    name: 'Sweet 16 Second Chance',
    sport: 'BASKETBALL',
    contestFormat: 'PREDICTION',
    selectionType: SelectionType.BRACKET,
    sportEvents: [buildContestSportEvent({ name: 'March Madness' })],
    ...overrides,
  });
}

function bracketManagedContest(startsAtRound: number) {
  return buildManagedContest({
    configuration: { id: 'config-1', contestId: 'contest-1', maxEntriesPerSquad: 1, selectionType: SelectionType.BRACKET, startsAtRound },
  });
}

function primeBracketMocks(startsAtRound: number, { contest = bracketContest(), event = basketballEvent() } = {}) {
  primeMocks({ contest, event, managedContest: bracketManagedContest(startsAtRound) });
  getSportLeagueMock.mockResolvedValue(apiSuccess({ sportLeague: { id: event.sportLeagueId, name: 'NCAA Men', roundNames: [] } }));
}

describe('Commissioner tools › Contests › one second-chance bracket contest', () => {
  it('reads its rules from its starting round, and counts its event being under way as no bar to opening', async () => {
    primeBracketMocks(3, { event: basketballEvent(UNDER_WAY) });
    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    await waitFor(() => expect(screen.getByTestId('manage-contest-rules')).toHaveTextContent(
      'Second-chance bracket from the Sweet 16: pick the winner of every game from the Sweet 16 on, all the way to the final, before its first game.',
    ));
    const notStarted = screen.getByTestId('contest-readiness-not-started');
    expect(notStarted).toHaveAttribute('data-met', 'true');
    expect(notStarted).toHaveTextContent('Event under way · the bracket starts at the Sweet 16');
    expect(screen.getByTestId('contest-status-card')).toHaveTextContent('members can enter until the first game of the Sweet 16');
  });

  it('says an open second-chance bracket\'s entries close at its starting round\'s first game, with no countdown to the event\'s start', async () => {
    primeBracketMocks(3, { contest: bracketContest({ status: 'OPEN' }), event: basketballEvent(UNDER_WAY) });
    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    expect(await screen.findByTestId('contest-second-chance-close'))
      .toHaveTextContent('Entries close at the first game of the Sweet 16.');
    await screen.findByTestId('contest-stat-entries');
    expect(screen.queryByTestId('contest-stat-until-close')).not.toBeInTheDocument();
  });

  it('reads a full bracket\'s rules as the whole bracket, with the event\'s start as its close', async () => {
    primeBracketMocks(1);
    renderAt('/league/BIGDAWGS/admin/contests/contest-1');

    await waitFor(() => expect(screen.getByTestId('manage-contest-rules')).toHaveTextContent('Fill in the whole bracket before the first game'));
    expect(screen.getByTestId('contest-readiness-not-started')).toHaveAttribute('data-met', 'true');
    expect(screen.getByTestId('contest-status-card')).toHaveTextContent('members can enter until the opening tip-off');
  });
});

describe('Commissioner tools › Contests › one bracket contest › Edit', () => {
  it('offers a bracket whose event has not started only the full bracket, since its later rounds have no teams yet', async () => {
    primeBracketMocks(1);
    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    const startsAt = await screen.findByTestId('contest-bracket-starts-at-round');
    expect(startsAt).toHaveDisplayValue('Full bracket');
    expect(within(startsAt).getAllByRole('option').map((option) => option.textContent)).toEqual(['Full bracket']);
  });

  it('offers only the later rounds but the final once the bracket\'s event is under way, keeping the saved starting round, and saves the one chosen', async () => {
    primeBracketMocks(3, { event: basketballEvent(UNDER_WAY) });
    updateContestConfigurationMock.mockResolvedValue(apiSuccess({ contest: bracketManagedContest(4) }));
    updateContestMock.mockResolvedValue(apiSuccess({ contest: bracketContest() }));
    renderAt('/league/BIGDAWGS/admin/contests/contest-1/edit');

    const startsAt = await screen.findByTestId('contest-bracket-starts-at-round');
    expect(startsAt).toHaveDisplayValue('From the Sweet 16');
    expect(within(startsAt).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'From the Second Round',
      'From the Sweet 16',
      'From the Elite Eight',
      'From the Final Four',
    ]);
    fireEvent.change(startsAt, { target: { value: '4' } });
    expect(screen.getByTestId('contest-bracket-rules')).toHaveTextContent('Second-chance bracket from the Elite Eight');
    fireEvent.click(screen.getByTestId('edit-contest-save'));

    await waitFor(() => expect(updateContestConfigurationMock).toHaveBeenCalledWith(expect.objectContaining({
      body: { selectionType: 'BRACKET', startsAtRound: 4, maxEntriesPerSquad: 1 },
    })));
  });
});
