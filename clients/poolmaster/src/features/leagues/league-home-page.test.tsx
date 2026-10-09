import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  listLeagueSquadsData,
} from './test/fixtures';

const getCurrentUserMock = vi.fn();
const getEventMock = vi.fn();
const getGolfContestLeaderboardMock = vi.fn();
const getLeagueByCodeMock = vi.fn();
const listContestEntriesMock = vi.fn();
const listContestsMock = vi.fn();
const listLeagueSquadsMock = vi.fn();
const refreshTokenMock = vi.fn();

bindApiMocks({
  getUser: getCurrentUserMock,
  getEvent: getEventMock,
  getGolfContestLeaderboard: getGolfContestLeaderboardMock,
  getLeagueByCode: getLeagueByCodeMock,
  listContestEntries: listContestEntriesMock,
  listContests: listContestsMock,
  listLeagueSquads: listLeagueSquadsMock,
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
        navigate('/league/NEWDOGS');
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
    scoringEngine: 'STROKE_PLAY',
    leagueId: 'league-1',
    sportEventId,
    sport: 'GOLF',
    entryCount: 4,
    isExclusive: false,
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
    status,
    picksCount: 6,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

function entryList(contestId: string, entries: ReturnType<typeof entry>[]) {
  return apiSuccess({
    contestId,
    total: entries.length,
    isJoined: false,
    myEntryId: null,
    myEntryIds: [],
    picksRevealed: false,
    entries,
  });
}

function standing(position: number, squadId: string, squadName: string, totalScoreToPar: number) {
  return {
    entryId: `entry-${squadId}`,
    entryName: `${squadName} entry`,
    entryNumber: 1,
    squadId,
    squadName,
    status: 'SUBMITTED',
    position,
    displayPosition: String(position),
    countingPickLimit: 4,
    scoredPickCount: 4,
    golf: { totalScoreToPar },
    picks: [],
  };
}

function primeMocks({
  contests = [] as ReturnType<typeof contest>[],
  entriesByContest = {} as Record<string, ReturnType<typeof entry>[]>,
  eventStarts = {} as Record<string, string>,
  isActive = true,
  hasTeam = true,
}: {
  contests?: ReturnType<typeof contest>[];
  entriesByContest?: Record<string, ReturnType<typeof entry>[]>;
  eventStarts?: Record<string, string>;
  isActive?: boolean;
  hasTeam?: boolean;
} = {}) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague({ isActive, memberCount: 12, activeContestCount: 2 }),
    {
      membership: buildLeagueMembership({ role: 'MEMBER' }),
      squadMembership: hasTeam ? buildLeagueSquadMember() : null,
    },
  )));
  listContestsMock.mockResolvedValue(apiSuccess({ contests }));
  listLeagueSquadsMock.mockResolvedValue(apiSuccess(listLeagueSquadsData(
    hasTeam ? [buildLeagueSquad({ members: [buildLeagueSquadMember()] })] : [],
  )));
  listContestEntriesMock.mockImplementation(({ path }: { path: { contestId: string } }) =>
    entryList(path.contestId, entriesByContest[path.contestId] ?? []),
  );
  getEventMock.mockImplementation(({ path }: { path: { eventId: string } }) => apiSuccess({
    event: {
      id: path.eventId,
      startDate: eventStarts[path.eventId] ?? '2026-05-01T12:00:00.000Z',
      endDate: null,
    },
  }));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const mock of [
    getCurrentUserMock, getEventMock, getGolfContestLeaderboardMock, getLeagueByCodeMock,
    listContestEntriesMock, listContestsMock, listLeagueSquadsMock, refreshTokenMock,
  ]) {
    mock.mockReset();
  }
});

describe('League Home', () => {
  it('shows the league once, compactly: name, code and counts', async () => {
    primeMocks();

    renderLeagueHome();

    const identity = within(await screen.findByTestId('league-home-identity'));
    expect(identity.getByRole('heading', { name: 'Big Dawgs' })).toBeInTheDocument();
    expect(identity.getByText('BIGDAWGS')).toBeInTheDocument();
    expect(identity.getByRole('button', { name: 'Copy league code' })).toBeInTheDocument();
    expect(identity.getByText('12 members · 2 active contests')).toBeInTheDocument();
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
    expect(within(screen.getByTestId('league-home-other-contests')).getByText('US Open Pick 6')).toBeInTheDocument();
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

  it('puts nothing up next once a contest\'s cutoff has passed, even while it still reads open', async () => {
    primeMocks({
      contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')],
      eventStarts: { 'event-open-1': '2026-04-10T11:00:00.000Z' },
    });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-other-contests')).findByText('RBC Heritage Tiers')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-up-next')).not.toBeInTheDocument();
  });

  it('shows the top five of a live contest the team is in, adding the team\'s own row when it ranks lower', async () => {
    primeMocks({
      contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE')],
      entriesByContest: { 'live-1': [entry('live-1', 'team-1')] },
    });
    getGolfContestLeaderboardMock.mockResolvedValue(apiSuccess({
      contestId: 'live-1',
      sportEventId: 'event-live-1',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N_GOLFERS', count: 4 },
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
    expect(myRow).toHaveTextContent('· you');
    expect(standings.getByRole('link', { name: /Full leaderboard/ })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/live-1/leaderboard',
    );
  });

  it('shows no live standings for a live contest the team has no entry in', async () => {
    primeMocks({ contests: [contest('live-1', 'Masters Pick 6', 'ACTIVE')] });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-other-contests')).findByText('Your team has not entered')).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-live-standings')).not.toBeInTheDocument();
    expect(getGolfContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('shows the member\'s team with its owners and a link to My team', async () => {
    primeMocks();

    renderLeagueHome();

    const team = within(await screen.findByTestId('league-home-your-team'));
    expect(await team.findByText('Casey Crushers')).toBeInTheDocument();
    expect(team.getByText('Casey Commissioner')).toBeInTheDocument();
    expect(team.getByRole('link', { name: /Go to My team/ })).toHaveAttribute('href', '/league/BIGDAWGS/team');
  });

  it('asks a member with no team to create one, rather than offering picks', async () => {
    primeMocks({ hasTeam: false, contests: [contest('open-1', 'RBC Heritage Tiers', 'OPEN')] });

    renderLeagueHome();

    expect(await within(await screen.findByTestId('league-home-your-team')).findByRole('link', { name: /Create your team/ })).toBeInTheDocument();
    const upNext = within(await screen.findByTestId('league-home-up-next'));
    expect(upNext.getByRole('link', { name: 'View contest' })).toBeInTheDocument();
    expect(listContestEntriesMock).not.toHaveBeenCalled();
  });

  it('says so when no contest is open or live, and points to all contests', async () => {
    primeMocks({ contests: [contest('done', 'Players Championship', 'COMPLETED'), contest('draft', 'Draft', 'DRAFT')] });

    renderLeagueHome();

    const empty = within(await screen.findByTestId('league-home-no-contests'));
    expect(empty.getByText(/No contests are open or live right now/)).toBeInTheDocument();
    expect(empty.getByRole('link', { name: 'All contests' })).toHaveAttribute('href', '/league/BIGDAWGS/contests');
  });

  it('shows an error instead of an empty page when the contests cannot be loaded', async () => {
    primeMocks();
    listContestsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Boom' } } });

    renderLeagueHome();

    expect(await screen.findByText("We couldn't load this league's contests.")).toBeInTheDocument();
    expect(screen.queryByTestId('league-home-no-contests')).not.toBeInTheDocument();
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

  it('tells a member who just joined that their team name and icon did not save, pointing them to My team', async () => {
    primeMocks();

    renderLeagueHome(joinedWithFailedTeamSetup);

    const notice = await screen.findByTestId('league-team-setup-failed');
    expect(notice).toHaveTextContent("We couldn't save your team name and icon.");
    expect(within(notice).getByRole('link', { name: 'My team' })).toHaveAttribute('href', '/league/BIGDAWGS/team');
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
