import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PlanFeature, TeamIconKey, championshipYear } from '@poolmaster/shared/domain';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  getLeagueSquadFrom,
  updateLeagueSquadData,
} from '@/features/leagues/test/fixtures';
import { buildContestResult, buildSquadChampionship, buildSquadCup, buildSquadHistory, buildSquadYear } from '@/features/championships/test/fixtures';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';
import type { LeagueDto, SquadDto } from '@/lib/api';
import { QueryKeys } from '@/lib/query-keys';
import { MemberRouteGuard } from '@/routes/route-guards';
import { MyTeamEditPage } from './my-team-edit-page';
import { MyTeamPage } from './my-team-page';
import { TeamPage } from './team-page';

const createLeagueSquadMock = vi.fn();
const createSquadOwnerInvitationMock = vi.fn();
const getCurrentUserMock = vi.fn();
const getContestLeaderboardMock = vi.fn();
const getSquadYearMock = vi.fn();
const getSquadHistoryMock = vi.fn();
const listContestResultsMock = vi.fn();
const listRecordsMock = vi.fn();
const listPerpetualTrophiesMock = vi.fn();
const listMyContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listLeagueMembersMock = vi.fn();
const getLeagueSquadMock = vi.fn();
const listSquadOwnerInvitationsMock = vi.fn();
const refreshTokenMock = vi.fn();
const replaceSquadOwnerMock = vi.fn();
const revokeSquadOwnerInvitationMock = vi.fn();
const updateLeagueSquadMock = vi.fn();

bindApiMocks({
  createLeagueSquad: createLeagueSquadMock,
  createSquadOwnerInvitation: createSquadOwnerInvitationMock,
  getUser: getCurrentUserMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getSquadHistory: getSquadHistoryMock,
  getSquadYear: getSquadYearMock,
  listContestResults: listContestResultsMock,
  listMyContestEntries: listMyContestEntriesMock,
  listContests: listContestsMock,
  listPerpetualTrophies: listPerpetualTrophiesMock,
  listRecords: listRecordsMock,
  getLeagueByCode: getLeagueByCodeMock,
  listLeagueMembers: listLeagueMembersMock,
  getLeagueSquad: getLeagueSquadMock,
  listSquadOwnerInvitations: listSquadOwnerInvitationsMock,
  refreshToken: refreshTokenMock,
  replaceSquadOwner: replaceSquadOwnerMock,
  revokeSquadOwnerInvitation: revokeSquadOwnerInvitationMock,
  updateLeagueSquad: updateLeagueSquadMock,
});

function renderTeamRoutes(path = '/league/BIGDAWGS/team') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            {/* As in the app: league pages render once the signed-in user has loaded. */}
            <Route element={<MemberRouteGuard />}>
              <Route element={<MyTeamPage />} path="/league/:leagueCode/team" />
              <Route element={<MyTeamEditPage />} path="/league/:leagueCode/team/edit" />
              <Route element={<TeamPage />} path="/league/:leagueCode/teams/:teamId" />
              <Route element={<div data-testid="league-home-destination" />} path="/league/:leagueCode" />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

const coOwner = buildLeagueSquadMember({
  id: 'team-membership-2',
  userId: 'user-2',
  user: buildCurrentUser({ id: 'user-2', firstName: 'Jordan', lastName: 'Rivers' }),
});

const rivalTeam = buildLeagueSquad({
  id: 'team-2',
  name: 'Rival Squad',
  members: [buildLeagueSquadMember({
    id: 'team-membership-3',
    squadId: 'team-2',
    userId: 'user-3',
    user: buildCurrentUser({ id: 'user-3', firstName: 'Riley', lastName: 'Rival' }),
  })],
});

const pendingOwnerInvite = {
  id: 'owner-invite-1',
  leagueId: 'league-1',
  squadId: 'team-1',
  email: 'pending@example.com',
  status: 'PENDING',
  replacementForUserId: null,
  invitedBy: 'user-1',
  inviteCode: 'owner-code-1',
  expiresAt: '2026-11-01T00:00:00.000Z',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
};

function primeTeam({
  isMember = true,
  isRootAdmin = false,
  league = {},
  role = 'MEMBER',
  squadId = 'team-1',
  squads = [buildLeagueSquad(), rivalTeam],
}: {
  isMember?: boolean;
  isRootAdmin?: boolean;
  league?: Partial<LeagueDto>;
  role?: 'COMMISSIONER' | 'MEMBER';
  squadId?: string | null;
  squads?: SquadDto[];
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser({ isRootAdmin }) }));
  refreshTokenMock.mockResolvedValue({ data: null });
  const context = getLeagueByCodeData(buildLeague(league), {
    membership: buildLeagueMembership({ role }),
    squadMembership: squadId ? buildLeagueSquadMember({ squadId }) : null,
  });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(isMember ? context : { ...context, membership: null }));
  getLeagueSquadMock.mockImplementation(getLeagueSquadFrom(squads));
  listLeagueMembersMock.mockResolvedValue(apiSuccess({
    members: [
      buildLeagueMembership({ id: 'm-1', userId: 'user-1', role }),
      buildLeagueMembership({ id: 'm-3', userId: 'user-3', role: 'COMMISSIONER' }),
    ],
  }));
  listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [] }));
  listContestsMock.mockResolvedValue(apiSuccess({ contests: [] }));
  getSquadYearMock.mockResolvedValue(apiSuccess({ squadYear: buildSquadYear({ championship: null, cups: [] }) }));
  listContestResultsMock.mockResolvedValue(apiSuccess({ contests: [] }));
  getSquadHistoryMock.mockResolvedValue(apiSuccess({ squadHistory: buildSquadHistory({ medals: { firsts: 0, seconds: 0, thirds: 0 }, trophies: [], years: [] }) }));
  listRecordsMock.mockResolvedValue(apiSuccess({ records: [] }));
  listPerpetualTrophiesMock.mockResolvedValue(apiSuccess({ trophies: [] }));
}

function contest(id: string, name: string, status: 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED') {
  return {
    id,
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    sportEvents: [{ sportEventId: `event-${id}`, sequence: 1, name: `Event ${id}`, startDate: '2099-04-09T12:40:00.000Z', status: 'SCHEDULED' }],
    sport: 'GOLF',
    entryCount: 4,
  };
}

function teamEntry(contestId: string, status: 'DRAFT' | 'SUBMITTED', squadId = 'team-1') {
  return {
    id: `${contestId}-${squadId}`,
    contestId,
    squadId,
    squadName: squadId,
    entryNumber: 1,
    name: `${squadId} entry`,
    events: [{ sportEventId: `event-${contestId}`, status, submittedAt: status === 'SUBMITTED' ? '2026-04-02T00:00:00.000Z' : null }],
    picksCount: 6,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

function primeContests(
  contests: ReturnType<typeof contest>[],
  entriesByContest: Record<string, ReturnType<typeof teamEntry>[]>,
) {
  listContestsMock.mockResolvedValue(apiSuccess({ contests }));
  // The viewer's team's (team-1's) entries across the league's current contests, in one read (#1197).
  listMyContestEntriesMock.mockResolvedValue(apiSuccess({
    entries: Object.values(entriesByContest).flat().filter((entry) => entry.squadId === 'team-1'),
  }));
}

afterEach(() => {
  for (const mock of [
    createLeagueSquadMock, createSquadOwnerInvitationMock, getCurrentUserMock, getLeagueByCodeMock,
    listLeagueMembersMock, getLeagueSquadMock, listSquadOwnerInvitationsMock, refreshTokenMock,
    replaceSquadOwnerMock, revokeSquadOwnerInvitationMock, updateLeagueSquadMock,
    getContestLeaderboardMock, listMyContestEntriesMock, listContestsMock, getSquadYearMock, getSquadHistoryMock, listContestResultsMock, listRecordsMock, listPerpetualTrophiesMock,
  ]) {
    mock.mockReset();
  }
});

describe('My team', () => {
  it('shows the viewer\'s squad by its name with Edit, an All years link, its owners and Leave league', async () => {
    primeTeam();

    renderTeamRoutes();

    const identity = await screen.findByTestId('my-team-identity');
    expect(identity).toHaveTextContent('Casey Crushers');
    expect(identity).toHaveTextContent('1 owner');
    expect(screen.getByTestId('my-team-edit')).toHaveTextContent('Edit');
    expect(screen.getByTestId('my-team-edit')).toHaveAttribute('href', '/league/BIGDAWGS/team/edit');
    expect(screen.getByTestId('my-team-history-link')).toHaveAttribute('href', '/league/BIGDAWGS/history');
    expect(screen.getByTestId('my-team-history-link')).toHaveTextContent('All years');
    expect(within(screen.getByTestId('my-team-owners')).getByText('Casey Commissioner')).toBeInTheDocument();
    expect(screen.getByTestId('leave-league-section')).toBeInTheDocument();
  });

  it('makes the team read-only while the league is inactive', async () => {
    primeTeam({ league: { isActive: false } });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-league-inactive')).toBeInTheDocument();
    expect(screen.getByTestId('my-team-edit')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('textbox', { name: 'Co-owner email' })).toBeDisabled();
  });

  it('does not offer the name-and-icon form while the viewer\'s squad is still loading', async () => {
    primeTeam();
    getLeagueSquadMock.mockReturnValue(new Promise(() => undefined));

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('create-team-page')).not.toBeInTheDocument();
  });

  it('shows an error instead of the name-and-icon form when the viewer\'s squad fails to load', async () => {
    primeTeam();
    getLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Teams are unavailable right now.' } },
      status: 500,
    });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-error')).toHaveTextContent('Teams are unavailable right now.');
    expect(screen.queryByTestId('create-team-page')).not.toBeInTheDocument();
  });

  it('shows the load-error copy with a way back to welcome when the league cannot be loaded', async () => {
    primeTeam();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'League not found.' } },
      status: 404,
    });

    renderTeamRoutes();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });
});

describe('My team › My entries', () => {
  it('offers Make your picks for an open contest the team has not entered, and Finish your picks for a draft', async () => {
    primeTeam();
    primeContests(
      [contest('c-open', 'Masters Pool', 'OPEN'), contest('c-draft', 'PGA Pool', 'OPEN')],
      { 'c-draft': [teamEntry('c-draft', 'DRAFT')] },
    );

    renderTeamRoutes();

    const open = await screen.findByTestId('my-team-entry-action-c-open');
    expect(open).toHaveTextContent('Make your picks');
    expect(open).toHaveAttribute('href', '/league/BIGDAWGS/contests/c-open');
    expect(await screen.findByText('Finish your picks')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/c-draft/entries/c-draft-team-1',
    );
  });

  it('shows the team\'s place in a live contest it entered, links to the leaderboard, and leaves out live contests it did not enter', async () => {
    primeTeam();
    primeContests(
      [contest('c-live', 'Masters Pool', 'ACTIVE'), contest('c-other', 'Other Pool', 'ACTIVE')],
      { 'c-live': [teamEntry('c-live', 'SUBMITTED')], 'c-other': [teamEntry('c-other', 'SUBMITTED', 'team-9')] },
    );
    getContestLeaderboardMock.mockResolvedValue(apiSuccess({
      contestId: 'c-live',
      sportEventId: 'event-c-live',
      sport: 'GOLF',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 4 },
      participants: [],
      entries: [
        { entryId: 'e-9', entryName: 'Leaders', entryNumber: 1, squadId: 'team-9', squadName: 'Leaders', position: 1, displayPosition: '1', countingPickLimit: 4, scoredPickCount: 0, totalScore: -8, events: [], picks: [] },
        { entryId: 'e-1', entryName: 'Mine', entryNumber: 1, squadId: 'team-1', squadName: 'Casey Crushers', position: 2, displayPosition: 'T2', countingPickLimit: 4, scoredPickCount: 0, totalScore: -3, events: [], picks: [] },
      ],
      asOf: '2026-04-11T18:00:00.000Z',
    }));

    renderTeamRoutes();

    await waitFor(() => expect(screen.getByTestId('my-team-entry-rank-c-live')).toHaveTextContent('Place T2'));
    expect(screen.getByTestId('my-team-entry-action-c-live')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/c-live/leaderboard',
    );
    expect(screen.queryByTestId('my-team-entry-c-other')).not.toBeInTheDocument();
  });

  it('says no contests are open or live when there are none, and leaves out drafts and finished ones', async () => {
    primeTeam();
    primeContests([contest('c-draft', 'Draft', 'DRAFT'), contest('c-done', 'Done', 'COMPLETED')], {});

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-entries-none')).toHaveTextContent('No contests are open or live right now.');
  });

  it('says the team\'s place could not be checked when the live leaderboard read fails, not that it is unranked', async () => {
    primeTeam();
    primeContests([contest('c-live', 'Masters Pool', 'ACTIVE')], { 'c-live': [teamEntry('c-live', 'SUBMITTED')] });
    getContestLeaderboardMock.mockResolvedValue({
      error: { error: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } },
    });

    renderTeamRoutes();

    await waitFor(() => expect(screen.getByTestId('my-team-entry-rank-c-live')).toHaveTextContent('We couldn\'t check your place.'));
    expect(screen.getByTestId('my-team-entry-rank-c-live')).not.toHaveTextContent('Not ranked yet');
  });

  it('says the contests could not load rather than showing none', async () => {
    primeTeam();
    listContestsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL', message: 'Down' } } });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-entries-error')).toBeInTheDocument();
  });
});

describe('My team › This year', () => {
  const YEAR = championshipYear(new Date());

  it('shows the squad\'s championship place of N, its gap and movement, its own medal counts and matrix row, its cups on show and its counted contests', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue(apiSuccess({
      squadYear: buildSquadYear({
        cups: [
          buildSquadCup(),
          buildSquadCup({ cupId: 'cup-2', sportLeagueId: 'nfl', name: '2026 NFL Cup', status: 'CROWNED', contestsCounted: 1 }, { trophy: 'CHAMPION' }),
          buildSquadCup({ cupId: 'cup-3', sportLeagueId: 'nba', name: '2026 NBA Cup', contestsCounted: 1 }),
        ],
      }),
    }));
    listContestResultsMock.mockResolvedValue(apiSuccess({
      contests: [buildContestResult({ squadFinish: { place: 2, displayPlace: '2', points: 800 } })],
    }));

    renderTeamRoutes();

    const standing = await screen.findByTestId('squad-year-championship-standing');
    expect(screen.getByText(`${YEAR} so far`)).toBeInTheDocument();
    expect(standing).toHaveTextContent('2nd of 3 · 180 points · 6 behind 1st');
    expect(screen.getByTestId('squad-year-championship')).toHaveAttribute('href', `/league/BIGDAWGS/championships/${YEAR}`);
    expect(screen.getByTestId('squad-year-championship')).toHaveTextContent('▲1');
    expect(screen.getByTestId('squad-year-tile-firsts')).toHaveTextContent('1');
    expect(screen.getByTestId('squad-year-tile-played')).toHaveTextContent('2');
    expect(screen.getByTestId('championship-standing-team-1')).toBeInTheDocument();
    expect(screen.queryByTestId('championship-standings-search')).not.toBeInTheDocument();
    // A crowned cup always shows; an open one only once two of its contests have counted.
    expect(screen.getByTestId('squad-year-cup-cup-1')).toHaveTextContent('1st of 3 · 160 points');
    expect(screen.getByTestId('squad-year-cup-cup-1')).toHaveAttribute('href', `/league/BIGDAWGS/championships/${YEAR}/race/pga-tour/squads/team-1`);
    expect(screen.getByTestId('squad-year-cup-cup-2')).toHaveTextContent('Champion');
    expect(screen.queryByTestId('squad-year-cup-cup-3')).not.toBeInTheDocument();
    expect(await screen.findByTestId('squad-year-contest-contest-1')).toHaveTextContent('2 · 80 pts');
    expect(screen.getByTestId('squad-year-contests-heading')).toHaveTextContent(`Contests Casey Crushers played in ${YEAR}`);
    expect(listContestResultsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { year: YEAR, squadId: 'team-1' } }));
  });

  it('narrows its contests to one place when a count in its matrix row is tapped, and shows them all again', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue(apiSuccess({ squadYear: buildSquadYear() }));

    renderTeamRoutes();
    // Every read has landed, so the grid is not re-rendered under the click.
    await screen.findByTestId('squad-history-trophies-none');

    fireEvent.click(await screen.findByTestId('championship-cell-team-1-2'));

    await waitFor(() => expect(screen.getByTestId('squad-year-contests-heading')).toHaveTextContent(`Contests Casey Crushers finished 2nd in ${YEAR}`));
    await waitFor(() => expect(listContestResultsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { year: YEAR, squadId: 'team-1', place: 2 } })));
    fireEvent.click(screen.getByTestId('squad-year-contests-clear'));
    await waitFor(() => expect(screen.getByTestId('squad-year-contests-heading')).toHaveTextContent(`Contests Casey Crushers played in ${YEAR}`));
  });

  it('says when nothing has counted yet, and leaves the championship card off for a squad with no row', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue(apiSuccess({ squadYear: buildSquadYear({ championship: buildSquadChampionship({ contestsCounted: 0, pointsBehindLeader: 0 }, { played: 0 }), cups: [] }) }));

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-year-championship-standing')).toHaveTextContent('No championship contest has counted yet');
    expect(await screen.findByTestId('squad-year-contests-empty')).toHaveTextContent(`Casey Crushers hasn't placed in a counted contest in ${YEAR} yet.`);
  });

  it('says the squad\'s year could not load rather than showing an empty one', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-year-error')).toBeInTheDocument();
    expect(screen.queryByTestId('squad-year-championship')).not.toBeInTheDocument();
  });

  it('shows another team\'s year on its page, read for that team', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue(apiSuccess({ squadYear: buildSquadYear({ squadId: 'team-2', championship: buildSquadChampionship({ pointsBehindLeader: 0 }, { squadId: 'team-2', squadName: 'Rival Squad', position: 1, displayPosition: '1' }) }) }));

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('squad-year-championship-standing')).toHaveTextContent('1st of 3 · 180 points · Leads');
    expect(getSquadYearMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', squadId: 'team-2' }, query: { year: YEAR } }));
  });
});

describe('My team › Trophies and past years', () => {
  const YEAR = championshipYear(new Date());

  it('shows the squad\'s contest medals and every trophy it won, each opening where it was won', async () => {
    primeTeam();
    getSquadHistoryMock.mockResolvedValue(apiSuccess({ squadHistory: buildSquadHistory() }));

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-medal-firsts')).toHaveTextContent('4');
    expect(screen.getByTestId('squad-history-medal-seconds')).toHaveTextContent('2');
    expect(screen.getByTestId('squad-history-medal-thirds')).toHaveTextContent('1');
    const championship = screen.getByTestId('squad-history-trophy-2025-championship');
    expect(championship).toHaveTextContent('2025 Derek\'s Pool Cup · Runner-up');
    expect(championship).toHaveAttribute('href', '/league/BIGDAWGS/championships/2025');
    const cup = screen.getByTestId('squad-history-trophy-2025-cup-nfl');
    expect(cup).toHaveTextContent('2025 NFL Cup · Champion');
    expect(cup).toHaveAttribute('href', '/league/BIGDAWGS/championships/2025/race/nfl');
  });

  it('says the shelf is empty rather than showing nothing when the squad has won no trophy', async () => {
    primeTeam();

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-trophies-none')).toHaveTextContent('No trophies yet.');
    expect(screen.queryByTestId('squad-history-years')).not.toBeInTheDocument();
  });

  it('lists each year the squad placed in with its championship place and cup finishes, and opens a year here from the strip or the picker', async () => {
    primeTeam();
    getSquadHistoryMock.mockResolvedValue(apiSuccess({ squadHistory: buildSquadHistory() }));

    renderTeamRoutes();

    const past = await screen.findByTestId('squad-history-year-2025');
    expect(past).toHaveTextContent('2025');
    expect(past).toHaveTextContent('Championship 2nd of 12 · 2025 NFL Cup champion');
    // The running year has nothing placed yet, so the strip leaves it out.
    expect(screen.queryByTestId(`squad-history-year-${YEAR}`)).not.toBeInTheDocument();

    fireEvent.click(past);

    await waitFor(() => expect(getSquadYearMock).toHaveBeenCalledWith(expect.objectContaining({ query: { year: 2025 } })));
    expect(screen.getByTestId('squad-history-year')).toHaveValue('2025');
    fireEvent.change(screen.getByTestId('squad-history-year'), { target: { value: String(YEAR) } });
    await waitFor(() => expect(screen.getByTestId('squad-history-year')).toHaveValue(String(YEAR)));
  });

  it('shows the records the squad holds, with when it set each, and leaves out the ones another squad holds', async () => {
    primeTeam();
    const mine = { squadId: 'team-1', squadName: 'Casey Crushers', squadIconKey: 'CAPTAIN_SMILE_FIELD' } as const;
    const rival = { squadId: 'team-2', squadName: 'Rival Squad', squadIconKey: 'CAPTAIN_SMILE_FIELD' } as const;
    listRecordsMock.mockResolvedValue(apiSuccess({ records: [
      {
        type: 'MOST_WINS_IN_A_YEAR',
        best: { value: 4, holders: [{ squad: rival, year: 2025, contestId: null, contestName: null }, { squad: mine, year: 2024, contestId: null, contestName: null }] },
        nextBest: null,
      },
      {
        type: 'MOST_WINS_ALL_TIME',
        best: { value: 9, holders: [{ squad: rival, year: null, contestId: null, contestName: null }] },
        nextBest: { value: 7, holders: [{ squad: mine, year: null, contestId: null, contestName: null }] },
      },
      {
        type: 'BIGGEST_FIELD_WON',
        best: { value: 48, holders: [{ squad: mine, year: 2025, contestId: 'contest-1', contestName: 'Masters Pick 6' }] },
        nextBest: null,
      },
    ] }));

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-record-MOST_WINS_IN_A_YEAR')).toHaveTextContent('Most wins in a year4 wins · 2024');
    expect(screen.getByTestId('squad-record-BIGGEST_FIELD_WON')).toHaveTextContent('Biggest field won48 entries · Masters Pick 6 (2025)');
    // Next best is not a record held, so the all-time count stays on the record book only.
    expect(screen.queryByTestId('squad-record-MOST_WINS_ALL_TIME')).not.toBeInTheDocument();
  });

  it('puts each perpetual trophy plate the squad won in its trophy case, and none it did not win', async () => {
    primeTeam();
    const mine = { squadId: 'team-1', squadName: 'Casey Crushers', squadIconKey: 'CAPTAIN_SMILE_FIELD' } as const;
    const rival = { squadId: 'team-2', squadName: 'Rival Squad', squadIconKey: 'CAPTAIN_SMILE_FIELD' } as const;
    listPerpetualTrophiesMock.mockResolvedValue(apiSuccess({ trophies: [{
      eventSeriesId: '11111111-1111-4111-8111-111111111111',
      seriesName: 'Super Bowl',
      sportLeagueName: 'NFL',
      selectionType: 'SQUARES',
      plates: [
        { year: 2025, contestId: 'bowl-2025', winners: [mine, rival] },
        { year: 2024, contestId: 'bowl-2024', winners: [rival] },
      ],
    }] }));

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-plate-bowl-2025')).toHaveTextContent('2025 Super Bowl Squares (NFL)');
    expect(screen.queryByTestId('squad-history-plate-bowl-2024')).not.toBeInTheDocument();
    // A plate is a trophy, so the empty shelf's note gives way to it.
    expect(screen.queryByTestId('squad-history-trophies-none')).not.toBeInTheDocument();
  });

  it('shows no records section for a squad that holds none', async () => {
    primeTeam();

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-trophies-none')).toBeInTheDocument();
    await waitFor(() => expect(listRecordsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('squad-records')).not.toBeInTheDocument();
  });

  it('says the trophies could not load, and still shows the year', async () => {
    primeTeam();
    getSquadYearMock.mockResolvedValue(apiSuccess({ squadYear: buildSquadYear() }));
    getSquadHistoryMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-error')).toBeInTheDocument();
    expect(await screen.findByTestId('squad-year-championship-standing')).toBeInTheDocument();
  });
});

describe('My team › Create team', () => {
  it('creates the member\'s squad with the name and icon they chose, in one request, then shows it', async () => {
    primeTeam({ role: 'COMMISSIONER', squadId: null, squads: [] });
    createLeagueSquadMock.mockImplementation(() => {
      // Once the team exists, the league context names it as the viewer's own.
      primeTeam({ role: 'COMMISSIONER', squads: [buildLeagueSquad({ name: 'Ocean Winkers' })] });
      return Promise.resolve(apiSuccess(updateLeagueSquadData(buildLeagueSquad({ name: 'Ocean Winkers' }))));
    });

    renderTeamRoutes();

    expect(await screen.findByRole('heading', { name: 'Choose your name and icon' })).toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Your name in this league' });
    expect(name).toHaveValue("Casey Commissioner");
    fireEvent.change(name, { target: { value: 'Ocean Winkers' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.CAPTAIN_WINK_OCEAN}`));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(createLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1' },
      body: { name: 'Ocean Winkers', iconKey: TeamIconKey.CAPTAIN_WINK_OCEAN },
    })));
    expect(await screen.findByTestId('my-team-identity')).toHaveTextContent('Ocean Winkers');
  });

  it('offers the name-and-icon form without reading any team when the viewer has none yet', async () => {
    primeTeam({ squadId: null, squads: [] });

    renderTeamRoutes();

    expect(await screen.findByTestId('create-team-page')).toBeInTheDocument();
    expect(getLeagueSquadMock).not.toHaveBeenCalled();
  });

  it('shows the reason and keeps the typed name when saving the chosen name fails', async () => {
    primeTeam({ squadId: null, squads: [] });
    createLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_NAME_TAKEN', message: 'Team name is already taken.' } },
    });

    renderTeamRoutes();

    fireEvent.change(await screen.findByTestId('create-team-name'), { target: { value: 'Derek Squad' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Team name is already taken.')).toBeInTheDocument();
    expect(screen.getByTestId('create-team-name')).toHaveValue('Derek Squad');
  });

  it('says why the member cannot choose a name while the league is inactive', async () => {
    primeTeam({ league: { isActive: false }, squadId: null, squads: [] });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-league-inactive')).toHaveTextContent('you can\'t choose your name in it');
    expect(screen.getByTestId('create-team-save')).toBeDisabled();
  });

  it('tells a root admin who is not a member that they are not playing in this league, with no name-and-icon form', async () => {
    primeTeam({ isMember: false, isRootAdmin: true, squadId: null });

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-none')).toHaveTextContent("You aren't playing in this league");
    expect(screen.queryByTestId('create-team-page')).not.toBeInTheDocument();
    expect(screen.queryByTestId('leave-league-section')).not.toBeInTheDocument();
  });
});

describe('My team › Owners', () => {
  it('invites a co-owner by email, confirms it, and clears the field', async () => {
    primeTeam();
    createSquadOwnerInvitationMock.mockResolvedValue(apiSuccess({ invitation: { ...pendingOwnerInvite, email: 'friend@example.com' } }));

    renderTeamRoutes();

    const emailField = await screen.findByRole('textbox', { name: 'Co-owner email' });
    fireEvent.change(emailField, { target: { value: ' friend@example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('Co-owner invite created.')).toBeInTheDocument();
    expect(createSquadOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { email: 'friend@example.com' },
    }));
    expect(emailField).toHaveValue('');
  });

  it('shows the reason and keeps the email when a co-owner invite is rejected', async () => {
    primeTeam();
    createSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_MEMBER_EXISTS', message: 'That person already belongs to this league.' } },
    });

    renderTeamRoutes();

    fireEvent.change(await screen.findByRole('textbox', { name: 'Co-owner email' }), { target: { value: 'member@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Invite' }));

    expect(await screen.findByText('That person already belongs to this league.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Co-owner email' })).toHaveValue('member@example.com');
  });

  it('replaces another owner with an invitation to the replacement email, but never offers to replace the viewer', async () => {
    primeTeam({ squads: [buildLeagueSquad({ members: [buildLeagueSquadMember(), coOwner], memberCount: 2 })] });
    replaceSquadOwnerMock.mockResolvedValue(apiSuccess({
      invitation: { ...pendingOwnerInvite, email: 'new@example.com', replacementForUserId: 'user-2' },
    }));

    renderTeamRoutes();

    await screen.findByTestId('my-team-owners');
    expect(screen.getAllByRole('button', { name: 'Replace owner' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Replace owner' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement owner email' }), { target: { value: 'new@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    await waitFor(() => expect(replaceSquadOwnerMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1', userId: 'user-2' },
      body: { email: 'new@example.com' },
    })));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Replacement owner email' })).not.toBeInTheDocument());
  });

  it('shows a failed replacement\'s reason and keeps the Replace owner form open with the email', async () => {
    primeTeam({ squads: [buildLeagueSquad({ members: [buildLeagueSquadMember(), coOwner], memberCount: 2 })] });
    replaceSquadOwnerMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_EMAIL_IN_LEAGUE', message: 'That person is already in this league.' } },
    });

    renderTeamRoutes();

    fireEvent.click(await screen.findByRole('button', { name: 'Replace owner' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Replacement owner email' }), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));

    expect(await screen.findByText('That person is already in this league.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Replacement owner email' })).toHaveValue('taken@example.com');
  });

  it('names each owner without their account id and words pending invites as Pending and Replacement invite', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({
      invitations: [{ ...pendingOwnerInvite, replacementForUserId: 'user-2' }],
    }));

    renderTeamRoutes();

    const invite = await screen.findByTestId('my-team-owner-invitation-owner-invite-1');
    expect(invite).toHaveTextContent('Pending · Replacement invite');
    expect(invite).not.toHaveTextContent('PENDING');
    expect(screen.getByTestId('my-team-member-user-1')).not.toHaveTextContent('user-1');
  });

  it('shows the reason when revoking a pending owner invite fails', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockResolvedValue(apiSuccess({ invitations: [pendingOwnerInvite] }));
    revokeSquadOwnerInvitationMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_OWNER_INVITATION_NOT_PENDING', message: 'That invite was already accepted.' } },
    });

    renderTeamRoutes();

    expect(await screen.findByText('pending@example.com')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));

    expect(await screen.findByText('That invite was already accepted.')).toBeInTheDocument();
    expect(revokeSquadOwnerInvitationMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', invitationId: 'owner-invite-1' },
    }));
  });

  it('warns that pending owner invitations could not be loaded rather than showing none', async () => {
    primeTeam();
    listSquadOwnerInvitationsMock.mockRejectedValue(new Error('Invitations unavailable'));

    renderTeamRoutes();

    expect(await screen.findByTestId('my-team-owners-invitations-error'))
      .toHaveTextContent('Owner invitations are temporarily unavailable');
  });
});

describe('My team › Edit team', () => {
  it('saves the name and icon in one request and returns to My team', async () => {
    primeTeam();
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData(buildLeagueSquad({ name: 'Renamed' }))));

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('edit-team-name')).toHaveValue('Casey Crushers');
    fireEvent.change(screen.getByTestId('edit-team-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByTestId('my-team-page')).toBeInTheDocument();
    expect(updateLeagueSquadMock).toHaveBeenCalledTimes(1);
    expect(updateLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', squadId: 'team-1' },
      body: { name: 'Renamed', iconKey: TeamIconKey.HELMET_BOLT_MIDNIGHT },
    }));
  });

  it('re-reads the league context after a rename, so the league menu shows the new name', async () => {
    primeTeam();
    updateLeagueSquadMock.mockResolvedValue(apiSuccess(updateLeagueSquadData(buildLeagueSquad({ name: 'Renamed' }))));

    const { queryClient } = renderTeamRoutes('/league/BIGDAWGS/team/edit');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByTestId('edit-team-save'));

    await screen.findByTestId('my-team-page');
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: QueryKeys.leagues.detail('BIGDAWGS') }),
    ));
  });

  it('shows the reason and keeps the typed name and chosen icon when saving is rejected', async () => {
    primeTeam();
    updateLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'SQUAD_NAME_TAKEN', message: 'Another team in this league already uses that name.' } },
    });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'Rival Squad' } });
    fireEvent.click(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`));
    fireEvent.click(screen.getByTestId('edit-team-save'));

    expect(await screen.findByText('Another team in this league already uses that name.')).toBeInTheDocument();
    expect(screen.getByTestId('edit-team-name')).toHaveValue('Rival Squad');
    expect(screen.getByTestId(`team-icon-${TeamIconKey.HELMET_BOLT_MIDNIGHT}`)).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps an unsaved name when the team refetches with new server data', async () => {
    primeTeam();
    const { queryClient } = renderTeamRoutes('/league/BIGDAWGS/team/edit');

    fireEvent.change(await screen.findByTestId('edit-team-name'), { target: { value: 'My draft name' } });
    getLeagueSquadMock.mockImplementation(getLeagueSquadFrom([
      buildLeagueSquad({ name: 'Renamed elsewhere' }),
      rivalTeam,
    ]));
    await queryClient.refetchQueries({ queryKey: QueryKeys.leagueTeams.detail('league-1', 'team-1') });

    await waitFor(() => expect(getLeagueSquadMock).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('edit-team-name')).toHaveValue('My draft name');
  });

  it('sends the edit link back to My team while the league is inactive', async () => {
    primeTeam({ league: { isActive: false } });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('my-team-league-inactive')).toBeInTheDocument();
    expect(screen.queryByTestId('edit-team-page')).not.toBeInTheDocument();
  });

  it('sends the edit link back to My team when the viewer has no team yet', async () => {
    primeTeam({ squadId: null, squads: [] });

    renderTeamRoutes('/league/BIGDAWGS/team/edit');

    expect(await screen.findByTestId('create-team-page')).toBeInTheDocument();
  });
});

describe('Another team\'s page', () => {
  it('shows a member another squad and its owners read-only, with no Manage link', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('team-page-identity')).toHaveTextContent('Rival Squad');
    const owners = within(screen.getByTestId('team-page-owners'));
    expect(owners.getByRole('link', { name: 'Riley Rival' })).toHaveAttribute('href', '/users/user-3');
    expect(await owners.findByText('Commissioner')).toBeInTheDocument();
    expect(screen.queryByTestId('team-page-manage')).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('gives a commissioner a Manage link into Commissioner tools', async () => {
    primeTeam({ role: 'COMMISSIONER' });

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('team-page-manage')).toHaveAttribute('href', '/league/BIGDAWGS/admin/teams/team-2');
    expect(screen.getByTestId('team-page-manage')).toHaveTextContent('Manage');
  });

  it('opens My team when the link is to the viewer\'s own team', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/team-1');

    expect(await screen.findByTestId('my-team-identity')).toHaveTextContent('Casey Crushers');
  });

  it('says the member is not in this league when their squad does not exist, linking back to all members', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/missing-team');

    const notFound = await screen.findByTestId('team-page-not-found');
    expect(within(notFound).getByRole('link', { name: 'All members' })).toHaveAttribute('href', '/league/BIGDAWGS/teams');
  });

  it('reads only the team it shows, not every team in the league', async () => {
    primeTeam();

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    await screen.findByTestId('team-page-identity');
    expect(getLeagueSquadMock).toHaveBeenCalledTimes(1);
    expect(getLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', squadId: 'team-2' } }));
  });

  it('says the member could not be loaded, not that they left, when reading the team fails', async () => {
    primeTeam();
    getLeagueSquadMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Teams are unavailable right now.' } },
      status: 500,
    });

    renderTeamRoutes('/league/BIGDAWGS/teams/team-2');

    expect(await screen.findByTestId('team-page-error')).toHaveTextContent("We couldn't load this member.");
    expect(screen.queryByTestId('team-page-not-found')).not.toBeInTheDocument();
  });
});

describe('My team › on a plan without trophies or past years', () => {
  const YEAR = championshipYear(new Date());
  const without = (...locked: PlanFeature[]) => ({
    planEntitlements: buildPlanEntitlements({ features: Object.values(PlanFeature).filter((feature) => !locked.includes(feature)) }),
  });

  it('shows the trophy shelf\'s name and a short note instead of the shelf, and still shows the squad\'s year', async () => {
    primeTeam({ league: without(PlanFeature.TROPHY_SHELF) });

    renderTeamRoutes();

    expect(await screen.findByTestId('plan-locked-TROPHY_SHELF')).toHaveTextContent('Trophy shelf');
    expect(screen.getByTestId('squad-year')).toBeInTheDocument();
    expect(getSquadHistoryMock).not.toHaveBeenCalled();
    expect(listPerpetualTrophiesMock).not.toHaveBeenCalled();
  });

  it('offers only the current year and no All years strip without past years', async () => {
    primeTeam({ league: without(PlanFeature.PAST_YEARS) });
    getSquadHistoryMock.mockResolvedValue(apiSuccess({ squadHistory: buildSquadHistory() }));

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-medal-firsts')).toBeInTheDocument();
    expect(within(screen.getByTestId('squad-history-year')).getAllByRole('option').map((option) => option.textContent)).toEqual([String(YEAR)]);
    expect(screen.queryByTestId('squad-history-years')).not.toBeInTheDocument();
  });

  it('asks for no records without the record book', async () => {
    primeTeam({ league: without(PlanFeature.RECORD_BOOK) });

    renderTeamRoutes();

    expect(await screen.findByTestId('squad-history-trophies-none')).toBeInTheDocument();
    expect(listRecordsMock).not.toHaveBeenCalled();
  });
});
