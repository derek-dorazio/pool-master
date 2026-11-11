import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlanFeature } from '@poolmaster/shared/domain';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { LeagueHomePage } from './league-home-page';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquad,
  buildLeagueSquadMember,
  getLeagueByCodeData,
  getLeagueSquadFrom,
} from './test/fixtures';
import type { CupDto } from '@/lib/api';
import { buildRunningCup } from '@/features/championships/test/fixtures';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';

const getCurrentUserMock = vi.fn();
const getContestLeaderboardMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const getYearReviewMock = vi.fn();
const listMyContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listCupsMock = vi.fn();
const getLeagueSquadMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getLeagueByCode: getLeagueByCodeMock,
  getYearReview: getYearReviewMock,
  listMyContestEntries: listMyContestEntriesMock,
  listContests: listContestsMock,
  listCups: listCupsMock,
  getLeagueSquad: getLeagueSquadMock,
  refreshToken: refreshTokenMock,
});

const NOW = new Date('2026-04-10T12:00:00.000Z');

function HistoryStateProbe() {
  return <div data-testid="history-state">{JSON.stringify(useLocation().state ?? null)}</div>;
}

function GoToOtherLeague() {
  const navigate = useNavigate();
  return (
    <button onClick={() => {
        void navigate('/league/NEWDOGS');
      }} type="button">
      Other league
    </button>
  );
}

function renderLeagueHome(initialEntry: string | { pathname: string; state: unknown } = '/league/BIGDAWGS') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route
              element={(
                <>
                  <GoToOtherLeague />
                  <HistoryStateProbe />
                  <LeagueHomePage />
                </>
              )}
              path="/league/:leagueCode"
            />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

type ContestStatus = 'DRAFT' | 'OPEN' | 'ACTIVE' | 'COMPLETED';

function contest(id: string, name: string, status: ContestStatus, sportEventId = `event-${id}`) {
  return {
    id,
    name,
    status,
    contestFormat: 'ROSTER',
    selectionType: 'TIERED',
    leagueId: 'league-1',
    sportEvents: [{ sportEventId, sequence: 1, name: `Event ${sportEventId}`, startDate: '2026-05-01T12:00:00.000Z', status: 'SCHEDULED' }],
    sport: 'GOLF',
    entryCount: 4,
  };
}

function entry(contestId: string, squadId: string, status: 'DRAFT' | 'SUBMITTED' = 'SUBMITTED') {
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


function standing(position: number, squadId: string, entryName: string, totalScore: number) {
  return {
    entryId: `entry-${squadId}`,
    entryName,
    entryNumber: 1,
    squadId,
    squadName: `${entryName}'s team`,
    position,
    displayPosition: String(position),
    countingPickLimit: 4,
    scoredPickCount: 4,
    totalScore,
    events: [{ sportEventId: 'event-1', totalScore, position, displayPosition: String(position) }],
    picks: [],
  };
}

function liveLeaderboard(contestId: string, entries: ReturnType<typeof standing>[]) {
  return {
    contestId,
    sportEventId: `event-${contestId}`,
    sport: 'GOLF',
    scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
    countingRule: { type: 'BEST_N', count: 4 },
    participants: [],
    asOf: null,
    entries,
  };
}

function primeMocks({
  contests = [] as ReturnType<typeof contest>[],
  entriesByContest = {},
  cups = [] as CupDto[],
  eventStarts = {},
  isActive = true,
  hasTeam = true,
  role = 'MEMBER',
  features = Object.values(PlanFeature),
  description = null,
}: {
  description?: string | null;
  features?: PlanFeature[];
  contests?: ReturnType<typeof contest>[];
  cups?: CupDto[];
  entriesByContest?: Record<string, ReturnType<typeof entry>[]>;
  eventStarts?: Record<string, string>;
  isActive?: boolean;
  hasTeam?: boolean;
  role?: 'MEMBER' | 'COMMISSIONER';
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ description, isActive, memberCount: 12, activeContestCount: 2, planEntitlements: buildPlanEntitlements({ features }) }),
    {
      membership: buildLeagueMembership({ role }),
      squadMembership: hasTeam ? buildLeagueSquadMember() : null,
    },
  )));
  // The contest list carries each contest's event start, which is when its entries close.
  listContestsMock.mockResolvedValue(apiSuccess({
    contests: contests.map((listed) => ({
      ...listed,
      sportEvents: listed.sportEvents.map((sportEvent) => ({
        ...sportEvent,
        startDate: eventStarts[sportEvent.sportEventId] ?? sportEvent.startDate,
      })),
    })),
  }));
  getLeagueSquadMock.mockImplementation(getLeagueSquadFrom(
    hasTeam ? [buildLeagueSquad({ members: [buildLeagueSquadMember()] })] : [],
  ));
  listCupsMock.mockResolvedValue(apiSuccess({ cups }));
  getYearReviewMock.mockResolvedValue(apiSuccess({ yearReview: { year: 2025, status: 'READY', sentAt: null, sentByName: null } }));
  // The viewer's team's entries across the league's current contests, in one read (#1197).
  listMyContestEntriesMock.mockResolvedValue(apiSuccess({ entries: Object.values(entriesByContest).flat() }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const mock of [
    getCurrentUserMock, getContestLeaderboardMock, getLeagueByCodeMock, getYearReviewMock,
    listMyContestEntriesMock, listContestsMock, listCupsMock, getLeagueSquadMock, refreshTokenMock,
  ]) {
    mock.mockReset();
  }
});

describe('League Home', () => {
  it('tells the commissioner last year\'s year in review is ready to send, and never asks for it for a member', async () => {
    primeMocks({ role: 'COMMISSIONER' });
    const { unmount } = renderLeagueHome();
    expect(await screen.findByTestId('year-review-ready')).toHaveTextContent('Your 2025 year in review is ready to send');
    unmount();

    getYearReviewMock.mockClear();
    primeMocks();
    renderLeagueHome();
    expect(await screen.findByTestId('league-home-identity')).toBeInTheDocument();
    expect(getYearReviewMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('year-review-ready')).not.toBeInTheDocument();
  });

  it('shows the league once, compactly: name and counts, with no league code members could not use', async () => {
    primeMocks();

    renderLeagueHome();

    const identity = within(await screen.findByTestId('league-home-identity'));
    expect(identity.getByRole('heading', { name: 'Big Dawgs' })).toBeInTheDocument();
    expect(screen.queryByText('BIGDAWGS')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy league code' })).not.toBeInTheDocument();
    expect(identity.getByText('12 members · 2 active contests')).toBeInTheDocument();
  });

  it("shows the commissioner's league description in the header, under the counts", async () => {
    primeMocks({ description: 'Saturday golf and Sunday football since 2009.' });

    renderLeagueHome();

    const identity = within(await screen.findByTestId('league-home-identity'));
    expect(identity.getByTestId('league-home-description')).toHaveTextContent('Saturday golf and Sunday football since 2009.');
  });

  it('shows no description line when the league has none', async () => {
    primeMocks({ description: '   ' });

    renderLeagueHome();

    await screen.findByTestId('league-home-identity');
    expect(screen.queryByTestId('league-home-description')).not.toBeInTheDocument();
  });

  it('puts the open contest that closes soonest up next, with a countdown to its cutoff', async () => {
    primeMocks({
      contests: [
        contest('later', 'US Open Pick 6', 'OPEN'),
        contest('sooner', 'RBC Heritage Tiers', 'OPEN'),
      ],
      eventStarts: {
        'event-later': '2026-04-20T12:00:00.000Z',
        'event-sooner': '2026-04-13T02:06:00.000Z',
      },
    });

    renderLeagueHome();

    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(await upNext.findByRole('heading', { name: 'RBC Heritage Tiers' })).toBeInTheDocument();
    expect(upNext.getByRole('timer')).toHaveAccessibleName('Entries close in 2 days 14 hours 6 minutes');
    expect(upNext.getByRole('link', { name: 'Make your picks' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/sooner',
    );
    expect(within(screen.getByTestId('league-home-current-contests')).getByText('US Open Pick 6')).toBeInTheDocument();
  });

  it('offers View entry up next once the team has submitted its entry', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1')] },
    });

    renderLeagueHome();

    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(await upNext.findByRole('link', { name: 'View entry' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/open-1/entries/open-1-team-1',
    );
    expect(upNext.getByText('Your entry is submitted.')).toBeInTheDocument();
  });

  it('offers to finish the picks when the team has an entry it has not submitted', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1', 'DRAFT')] },
    });

    renderLeagueHome();

    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(await upNext.findByRole('link', { name: 'Finish your picks' })).toBeInTheDocument();
  });

  it('reads the team\'s entries for every open and live contest in one league-wide request, not one per contest', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN'), contest('live-1', 'Masters Pick 6', 'ACTIVE')],
      entriesByContest: { 'open-1': [entry('open-1', 'team-1', 'DRAFT')] },
    });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-up-next')).findByRole('link', { name: 'Finish your picks' })).toBeInTheDocument();
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' } }));
  });

  it('does not offer to make picks while it is still checking whether the team has entered', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN')] });
    listMyContestEntriesMock.mockImplementation(() => new Promise(() => undefined));

    renderLeagueHome();

    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(await upNext.findByText('Checking your entry...')).toBeInTheDocument();
    expect(upNext.getByRole('link', { name: 'View contest' })).toHaveAttribute('href', '/league/BIGDAWGS/contests/open-1');
    expect(upNext.queryByRole('link', { name: 'Make your picks' })).not.toBeInTheDocument();
    expect(screen.getByTestId('league-home-current-contests')).not.toHaveTextContent('You have not entered yet.');
  });

  it('says it could not check the entry, rather than offering picks, when the entries cannot be loaded', async () => {
    primeMocks({ contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN')] });
    listMyContestEntriesMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'Entries unavailable' } },
    });

    renderLeagueHome();

    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(await upNext.findByText("We couldn't check your entry.")).toBeInTheDocument();
    expect(upNext.getByRole('link', { name: 'View contest' })).toBeInTheDocument();
    expect(upNext.queryByRole('link', { name: 'Make your picks' })).not.toBeInTheDocument();
    expect(screen.getByTestId('league-home-current-contests')).not.toHaveTextContent('You have not entered yet.');
  });

  it('puts nothing up next once a contest\'s cutoff has passed, even while it still reads open', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      eventStarts: { 'event-open-1': '2026-04-10T11:00:00.000Z' },
    });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-current-contests')).findByText('RBC Heritage Tiers')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-up-next')).not.toBeInTheDocument();
  });

  it('shows the top five of a live contest the team is in, adding the team\'s own row when it ranks lower', async () => {
    primeMocks({
      contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')] },
    });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess({
      contestId: 'live-1',
      sportEventId: 'event-live-1',
      sport: 'GOLF',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 4 },
      participants: [],
      asOf: null,
      entries: [
        standing(1, 'team-a', 'Bogey Men', -14),
        standing(2, 'team-b', 'Sand Trappers', -11),
        standing(3, 'team-c', 'Grip It', -10),
        standing(4, 'team-d', 'Mulligans', -8),
        standing(5, 'team-e', 'Fairway Fanatics', -7),
        standing(6, 'team-f', 'Birdie Sanders', -6),
        standing(7, 'team-1', 'Casey Crushers', -5),
      ],
    }));

    renderLeagueHome();

    const standings = within(await screen.findByTestId('league-home-live-standings'));
    expect(await standings.findByText('Bogey Men')).toBeInTheDocument();
    expect(standings.getByText('Fairway Fanatics')).toBeInTheDocument();
    expect(standings.queryByText('Birdie Sanders')).not.toBeInTheDocument();
    const myRow = standings.getByRole('row', { name: /Casey Crushers/ });
    expect(myRow).toHaveTextContent('7');
    expect(myRow).toHaveTextContent('Yours');
    expect(standings.getByRole('link', { name: /Full leaderboard/ })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/live-1/leaderboard',
    );
  });

  it('offers a chip for each live contest the team is in, switching the top five to the chosen one', async () => {
    primeMocks({
      contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE'), contest('live-2', 'NBA Finals Stars', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')], 'live-2': [entry('live-2', 'team-1')] },
    });
    getContestLeaderboardMock.mockImplementation(({ path }: { path: { contestId: string } }) => apiSuccess(liveLeaderboard(
      path.contestId,
      path.contestId === 'live-1' ? [standing(1, 'team-a', 'Bogey Men', -14)] : [standing(1, 'team-z', 'Net Gains', 22)],
    )));

    renderLeagueHome();

    const standings = within(await screen.findByTestId('league-home-live-standings'));
    expect(standings.getByRole('radio', { name: 'Masters Pick 6' })).toBeChecked();
    expect(standings.getByRole('radio', { name: 'NBA Finals Stars' })).not.toBeChecked();
    expect(await standings.findByText('Bogey Men')).toBeInTheDocument();
    expect(getContestLeaderboardMock).toHaveBeenCalledTimes(1);

    fireEvent.click(standings.getByRole('radio', { name: 'NBA Finals Stars' }));

    expect(await standings.findByText('Net Gains')).toBeInTheDocument();
    expect(standings.queryByText('Bogey Men')).not.toBeInTheDocument();
    expect(standings.getByRole('heading', { name: 'NBA Finals Stars · Top 5' })).toBeInTheDocument();
    expect(standings.getByRole('link', { name: /Full leaderboard/ })).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-2/leaderboard');
    expect(getContestLeaderboardMock).toHaveBeenCalledTimes(2);
    expect(getContestLeaderboardMock.mock.lastCall?.[0]).toMatchObject({ path: { contestId: 'live-2' } });
  });

  it('shows no chips when the team is in one live contest', async () => {
    primeMocks({
      contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE'), contest('live-2', 'NBA Finals Stars', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')] },
    });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess(liveLeaderboard('live-1', [standing(1, 'team-a', 'Bogey Men', -14)])));

    renderLeagueHome();

    const standings = within(await screen.findByTestId('league-home-live-standings'));
    expect(await standings.findByText('Bogey Men')).toBeInTheDocument();
    expect(standings.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(standings.getByRole('heading', { name: 'Masters Pick 6 · Top 5' })).toBeInTheDocument();
  });

  it('lists the other live and open contests under Current contests, live first, leaving out the one up next', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN'), contest('live-1', 'Masters Pick 6', 'ACTIVE')],
      eventStarts: { 'event-open-1': '2026-04-20T12:00:00.000Z', 'event-open-2': '2026-06-18T12:00:00.000Z' },
    });

    renderLeagueHome();

    const card = await screen.findByTestId('league-home-current-contests');
    expect(await within(card).findByTestId('league-home-contest-group-live')).toHaveTextContent('Masters Pick 6');
    expect(within(card).getByTestId('league-home-contest-group-open')).toHaveTextContent('US Open Pick 6');
    expect(within(card).queryByTestId('league-home-contest-open-1')).not.toBeInTheDocument();
    expect(within(card).getByTestId('league-home-contest-live-1')).toHaveAttribute('href', '/league/BIGDAWGS/contests/live-1/leaderboard');
  });

  it('makes one request each for the league, its contests, the team\'s entries and one live leaderboard', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN'), contest('open-2', 'US Open Pick 6', 'OPEN'), contest('live-1', 'Masters Pick 6', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')] },
    });
    getContestLeaderboardMock.mockResolvedValue(apiSuccess({
      contestId: 'live-1',
      sportEventId: 'event-live-1',
      sport: 'GOLF',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 4 },
      participants: [],
      asOf: null,
      entries: [standing(1, 'team-1', 'Casey Crushers', -5)],
    }));

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-live-standings')).findByText('Casey Crushers')).toBeInTheDocument();
    expect(getLeagueByCodeMock).toHaveBeenCalledTimes(1);
    expect(listContestsMock).toHaveBeenCalledTimes(1);
    expect(listMyContestEntriesMock).toHaveBeenCalledTimes(1);
    expect(getContestLeaderboardMock).toHaveBeenCalledTimes(1);
  });

  it('shows no live standings for a live contest the team has no entry in', async () => {
    primeMocks({ contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE')] });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-current-contests')).findByText('You have not entered yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-live-standings')).not.toBeInTheDocument();
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('shows the member\'s squad as a row with its owner count, not its owners\' names, and a My team footer link', async () => {
    primeMocks();

    renderLeagueHome();

    const team = within(await screen.findByTestId('league-home-your-team'));
    expect(await team.findByTestId('league-home-your-team-row')).toHaveTextContent('Casey Crushers1 owner');
    expect(team.queryByText('Casey Commissioner')).not.toBeInTheDocument();
    expect(team.getByRole('link', { name: /My team/ })).toHaveAttribute('href', '/league/BIGDAWGS/team');
    // One read of the viewer's own team, not the league's whole team list.
    expect(getLeagueSquadMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', squadId: 'team-1' } }));
  });

  it('shows the year\'s cups with who leads and the viewer\'s place, each opening its Points race', async () => {
    primeMocks({ cups: [buildRunningCup()] });

    renderLeagueHome();

    const cups = within(await screen.findByTestId('league-home-cups'));
    expect(listCupsMock).toHaveBeenCalledWith(expect.objectContaining({ query: { seasonYear: 2026 } }));
    expect(cups.getByRole('heading', { name: '2026 cups' })).toBeInTheDocument();
    expect(cups.getByTestId('league-home-cup-cup-pga')).toHaveTextContent('Birdie Bandits leads · you are 2nd · 3 of 4 final');
    expect(cups.getByTestId('league-home-cup-cup-pga')).toHaveAttribute('href', '/league/BIGDAWGS/championships/2026/race/sport-league-pga');
    expect(cups.getByRole('link', { name: /Trophy case/ })).toHaveAttribute('href', '/league/BIGDAWGS/championships/2026/trophies');
  });

  it('shows no cups card and asks for no cups on a plan without them', async () => {
    primeMocks({ cups: [buildRunningCup()], features: Object.values(PlanFeature).filter((feature) => feature !== PlanFeature.CUP_STANDINGS) });

    renderLeagueHome();

    await screen.findByTestId('league-home-your-team');
    expect(listCupsMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('league-home-cups')).not.toBeInTheDocument();
  });

  it('offers the commissioner no year in review on a plan without its email', async () => {
    primeMocks({ role: 'COMMISSIONER', features: Object.values(PlanFeature).filter((feature) => feature !== PlanFeature.EMAIL_YEAR_IN_REVIEW) });

    renderLeagueHome();

    await screen.findByTestId('league-home-identity');
    expect(getYearReviewMock).not.toHaveBeenCalled();
    expect(screen.queryByTestId('year-review-ready')).not.toBeInTheDocument();
  });

  it('shows no cups card before the league has a contest in the year', async () => {
    primeMocks();

    renderLeagueHome();

    await screen.findByTestId('league-home-your-team');
    await vi.waitFor(() => expect(listCupsMock).toHaveBeenCalled());
    expect(screen.queryByTestId('league-home-cups')).not.toBeInTheDocument();
  });

  it('asks a member with no squad to choose their name in this league, rather than offering picks', async () => {
    primeMocks({ hasTeam: false, contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-your-team')).findByRole('link', { name: /Choose your name/ })).toBeInTheDocument();
    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(upNext.getByRole('link', { name: 'View contest' })).toBeInTheDocument();
    expect(upNext.getByText(/Choose your name in this league to enter/)).toBeInTheDocument();
    expect(listMyContestEntriesMock).not.toHaveBeenCalled();
  });

  it('keeps the titled Current contests card with one italic line and an All contests link when no contest is open or live', async () => {
    primeMocks({ contests: [contest('done', 'Players Championship', 'COMPLETED'), contest('draft', 'Draft', 'DRAFT')] });

    renderLeagueHome();

    const card = within(await screen.findByTestId('league-home-current-contests'));
    expect(card.getByRole('heading', { name: 'Current contests' })).toBeInTheDocument();
    expect(card.getByTestId('league-home-contest-empty')).toHaveTextContent('No open or live contests.');
    expect(card.queryByRole('button')).not.toBeInTheDocument();
    expect(card.getByRole('link', { name: /All contests/ })).toHaveAttribute('href', '/league/BIGDAWGS/contests');
  });

  it('shows an error instead of an empty page when the contests cannot be loaded', async () => {
    primeMocks();
    listContestsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } } });

    renderLeagueHome();

    expect(await screen.findByText("We couldn't load this league's contests.")).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-current-contests')).not.toBeInTheDocument();
  });

  it('explains that an inactive league is read-only', async () => {
    primeMocks({ isActive: false });

    renderLeagueHome();

    expect(await screen.findByTestId('league-inactive-banner')).toHaveTextContent('This league is not currently active.');
  });

  it('shows the load-error copy with a way back to welcome when the league cannot be loaded', async () => {
    primeMocks();
    getLeagueByCodeMock.mockResolvedValue({
      error: { error: { code: 'LEAGUE_NOT_FOUND', message: 'Not found' } },
      response: { status: 404 },
    });

    renderLeagueHome();

    expect(await screen.findByRole('link', { name: 'Back to welcome' })).toHaveAttribute('href', '/welcome');
  });
});

describe('League Home after joining', () => {
  const joinedWithFailedTeamSetup = { pathname: '/league/BIGDAWGS', state: { teamSetupFailed: true } };

  it('tells a member who just joined that the name and icon they chose did not save, linking to where they can set them', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    const notice = await screen.findByTestId('league-team-setup-failed');
    expect(notice).toHaveTextContent("we couldn't save the name and icon you chose.");
    expect(within(notice).getByRole('link', { name: 'Set your name and icon' })).toHaveAttribute('href', '/league/BIGDAWGS/team');
  });

  it('shows the team-setup notice once, clearing it from history so Back or a reload does not bring it back', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    expect(await screen.findByTestId('league-team-setup-failed')).toBeInTheDocument();
    expect(await screen.findByTestId('history-state')).toHaveTextContent('null');
  });

  it('does not carry the team-setup notice to another league', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    expect(await screen.findByTestId('league-team-setup-failed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Other league' }));
    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument();
  });

  it('shows no team-setup notice on an ordinary visit', async () => {
    primeMocks();

    renderLeagueHome();

    await screen.findByTestId('league-home');
    expect(screen.queryByTestId('league-team-setup-failed')).not.toBeInTheDocument();
  });
});
