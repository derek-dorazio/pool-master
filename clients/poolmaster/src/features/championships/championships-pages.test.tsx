import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquadMember,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { ChampionshipPage } from './championship-page';
import { ChampionshipsLayout, ChampionshipsRedirect } from './championships-layout';
import { CupSquadPointsPage } from './cup-squad-points-page';
import { PointsRacePage } from './points-race-page';
import { TrophyCasePage } from './trophy-case-page';
import {
  buildChampionshipStanding,
  buildCup,
  buildCupContest,
  buildCupStanding,
  buildRunningChampionship,
  buildRunningCup,
} from './test/fixtures';

const { getChampionshipMock, getCupSquadPointsMock, getCurrentUserMock, getLeagueByCodeMock, listCupsMock, refreshTokenMock } = vi.hoisted(() => ({
  getChampionshipMock: vi.fn(),
  getCupSquadPointsMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getLeagueByCodeMock: vi.fn(),
  listCupsMock: vi.fn(),
  refreshTokenMock: vi.fn(),
}));

bindApiMocks({
  getChampionship: getChampionshipMock,
  getCupSquadPoints: getCupSquadPointsMock,
  getLeagueByCode: getLeagueByCodeMock,
  getUser: getCurrentUserMock,
  listCups: listCupsMock,
  refreshToken: refreshTokenMock,
});

const NOW = new Date('2026-09-01T12:00:00.000Z');

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderChampionships(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route element={<ChampionshipsRedirect />} path="/league/:leagueCode/championships" />
            <Route element={<ChampionshipsLayout />} path="/league/:leagueCode/championships/:year">
              <Route element={<ChampionshipPage />} index />
              <Route element={<TrophyCasePage />} path="trophies" />
              <Route element={<PointsRacePage />} path="race" />
              <Route element={<PointsRacePage />} path="race/:sportLeagueId" />
              <Route element={<CupSquadPointsPage />} path="race/:sportLeagueId/squads/:squadId" />
            </Route>
            <Route element={<div data-testid="leaderboard" />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeViewer(cups = [buildRunningCup()], championship = buildRunningChampionship()) {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership({ role: 'MEMBER' }), squadMembership: buildLeagueSquadMember() },
  )));
  listCupsMock.mockResolvedValue(apiSuccess({ cups }));
  getChampionshipMock.mockResolvedValue(apiSuccess({ championship }));
}

const NFL_CUP = buildCup({
  id: 'cup-nfl',
  sportLeagueId: 'sport-league-nfl',
  sportLeagueName: 'NFL',
  name: '2026 NFL Cup',
  standings: [buildCupStanding({ points: 2000, wins: 2, contestsCounted: 2, pointsAfter: [1000, 2000] })],
  contests: [
    buildCupContest({ contestId: 'nfl-1', winners: [{ squadId: 'team-1', squadName: 'Casey Crushers' }] }),
    buildCupContest({ contestId: 'nfl-2', winners: [{ squadId: 'team-1', squadName: 'Casey Crushers' }] }),
  ],
});

/** A cup with one counted contest, which the Trophy case doesn't show yet. */
const NBA_CUP = buildCup({
  id: 'cup-nba',
  sportLeagueId: 'sport-league-nba',
  sportLeagueName: 'NBA',
  name: '2026 NBA Cup',
  standings: [buildCupStanding({ points: 1000, wins: 1, contestsCounted: 1, pointsAfter: [1000] })],
  contests: [buildCupContest({ contestId: 'nba-1', winners: [{ squadId: 'team-1', squadName: 'Casey Crushers' }] })],
});

/** A cup whose only contest is still live. */
const NHL_CUP = buildCup({
  id: 'cup-nhl',
  sportLeagueId: 'sport-league-nhl',
  sportLeagueName: 'NHL',
  name: '2026 NHL Cup',
  standings: [buildCupStanding()],
  contests: [buildCupContest({ contestId: 'nhl-1', status: 'ACTIVE', count: 'NOT_FINAL', completedAt: null })],
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  for (const mock of [getChampionshipMock, getCupSquadPointsMock, getCurrentUserMock, getLeagueByCodeMock, listCupsMock, refreshTokenMock]) {
    mock.mockReset();
  }
});

describe('Championships', () => {
  it('opens the current year\'s Championship from the menu link, titled as the year\'s race', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships');

    expect(await screen.findByRole('heading', { name: '2026 Championship Race' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/championships\/2026$/);
    expect(await screen.findByTestId('championship')).toBeInTheDocument();
    expect(getChampionshipMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', year: '2026' } }));
  });

  it('titles a year that is over as its championships', async () => {
    primeViewer([]);

    renderChampionships('/league/BIGDAWGS/championships/2025/trophies');

    expect(await screen.findByRole('heading', { name: '2025 Championships' })).toBeInTheDocument();
  });

  it('sends a year that is not a year back to the current one', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/latest/trophies');

    expect(await screen.findByRole('heading', { name: '2026 Championship Race' })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/championships\/2026$/);
  });
});

describe('Championships › Championship', () => {
  it('names who leads the running year and by how much, with the contests still to count, and no podium yet', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-name')).toHaveTextContent('2026 Big Dawgs Cup');
    expect(screen.getByTestId('championship-standing')).toHaveTextContent('Birdie Bandits leads by 15 points with 2 contests to go.');
    expect(screen.getByText('The trophy is presented on 1 January. Contests still live then count toward 2027.')).toBeInTheDocument();
    expect(screen.queryByTestId('championship-podium')).not.toBeInTheDocument();
  });

  it('presents the trophy to the champion once the year is over, with 2nd and 3rd on the podium', async () => {
    primeViewer([], buildRunningChampionship({ year: 2025, name: '2025 Big Dawgs Cup', isOver: true, contestsToGo: 0 }));

    renderChampionships('/league/BIGDAWGS/championships/2025');

    expect(await screen.findByTestId('championship-standing')).toHaveTextContent('Birdie Bandits won with 245 points.');
    expect(screen.getByText('Champion')).toBeInTheDocument();
    const podium = within(screen.getByTestId('championship-podium'));
    expect(podium.getByTestId('championship-podium-1')).toHaveTextContent('Birdie Bandits');
    expect(podium.getByTestId('championship-podium-2')).toHaveTextContent('Casey Crushers');
    expect(podium.getByTestId('championship-podium-3')).toHaveTextContent('Fore Play');
  });

  it('puts squads tied for 1st on one step as champions, leaving out the 2nd step nobody holds', async () => {
    primeViewer([], buildRunningChampionship({
      isOver: true,
      contestsToGo: 0,
      standings: [
        buildChampionshipStanding({ squadId: 'team-2', squadName: 'Birdie Bandits', position: 1, displayPosition: 'T1', points: 1800 }),
        buildChampionshipStanding({ squadId: 'team-1', squadName: 'Casey Crushers', position: 1, displayPosition: 'T1', points: 1800 }),
        buildChampionshipStanding({ squadId: 'team-3', squadName: 'Fore Play', position: 3, displayPosition: '3', points: 900 }),
      ],
    }));

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-standing')).toHaveTextContent('Birdie Bandits and Casey Crushers share the championship.');
    expect(screen.getByText('Champions')).toBeInTheDocument();
    expect(screen.getByTestId('championship-podium-1')).toHaveTextContent('Birdie Bandits and Casey Crushers');
    expect(screen.queryByTestId('championship-podium-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('championship-podium-3')).toHaveTextContent('Fore Play');
  });

  it('shows each medal tile with its count and every squad holding it', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-tile-MOST_FIRSTS')).toHaveTextContent('Most 1sts2Birdie Bandits');
    expect(screen.getByTestId('championship-tile-MOST_PODIUMS')).toHaveTextContent('Most podiums3Birdie Bandits and Casey Crushers');
  });

  it('ranks the squads with points and their finishes 1st to 10th, the viewer marked', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    const row = within(await screen.findByTestId('championship-standing-team-1'));
    expect(row.getByText('230')).toBeInTheDocument();
    expect(row.getByText('You')).toBeInTheDocument();
    expect(screen.getByTestId('championship-progress')).toHaveTextContent('3 contests final');
    expect(screen.getByText(/Points table: Standard\./)).toBeInTheDocument();
  });

  it('says nobody leads before any contest has counted', async () => {
    primeViewer([], buildRunningChampionship({
      contestsCounted: 0,
      standings: [buildChampionshipStanding()],
      tiles: [{ tile: 'MOST_FIRSTS', count: 0, squads: [] }],
    }));

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-standing')).toHaveTextContent('No contest has counted in 2026 yet.');
    expect(screen.getByTestId('championship-tile-MOST_FIRSTS')).toHaveTextContent('Nobody yet');
  });

  it('says so when the championship cannot be loaded', async () => {
    primeViewer();
    getChampionshipMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-error')).toBeInTheDocument();
  });
});

describe('Championships › Trophy case', () => {
  it('shows a card per cup with its leader, the viewer\'s place and how many contests are final, opening its Points race', async () => {
    primeViewer([buildRunningCup(), NFL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    const pga = await screen.findByTestId('cup-card-cup-pga');
    expect(pga).toHaveTextContent('2026 PGA Tour Cup');
    expect(pga).toHaveTextContent('Birdie Bandits leads · you are 2nd');
    expect(within(pga).getByRole('progressbar', { name: '3 of 4 contests final' })).toBeInTheDocument();
    expect(pga).toHaveAttribute('href', '/league/BIGDAWGS/championships/2026/race/sport-league-pga');
    expect(screen.getByTestId('cup-card-cup-nfl')).toHaveTextContent('Casey Crushers leads · you are 1st');
  });

  it('leaves off a cup until two of its contests have counted, explaining so when none has', async () => {
    primeViewer([NBA_CUP, NHL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    expect(await screen.findByTestId('trophy-case-empty')).toHaveTextContent('once two of its contests have counted');
    expect(screen.queryByTestId('cup-card-cup-nba')).not.toBeInTheDocument();
  });

  it('says so when the cups cannot be loaded', async () => {
    primeViewer();
    listCupsMock.mockRejectedValue(new Error('down'));

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    expect(await screen.findByTestId('trophy-case-error')).toBeInTheDocument();
  });
});

describe('Championships › Points race', () => {
  it('opens the year\'s first cup on show when the tab is chosen, offering a chip for each cup on show', async () => {
    primeViewer([NBA_CUP, buildRunningCup(), NFL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');
    fireEvent.click(await screen.findByTestId('championships-tab-race'));

    expect(await screen.findByTestId('points-race')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/championships/2026/race/sport-league-pga');
    expect(screen.getByTestId('cup-chip-sport-league-pga')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('cup-chip-sport-league-nfl')).not.toHaveAttribute('aria-current');
    expect(screen.queryByTestId('cup-chip-sport-league-nba')).not.toBeInTheDocument();
  });

  it('still opens a cup not yet on show from a link straight to it, with its own chip', async () => {
    primeViewer([NBA_CUP, buildRunningCup()]);

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-nba');

    expect(await screen.findByRole('heading', { name: '2026 NBA Cup' })).toBeInTheDocument();
    expect(screen.getByTestId('cup-chip-sport-league-nba')).toHaveAttribute('aria-current', 'page');
  });

  it('shows the leader, the viewer\'s place and gap, and the live contest as the next to count', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    const race = await screen.findByTestId('points-race');
    expect(race).toHaveTextContent('LeaderBirdie Bandits180 pts');
    expect(race).toHaveTextContent('You2nd15 behind');
    expect(race).toHaveTextContent('Next to countTour Championship TiersLive now');
  });

  it('ranks the squads with movement, points, wins and contests, each opening its cup points, the viewer marked', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    const leader = await screen.findByTestId('cup-standing-team-2');
    expect(within(leader).getByLabelText('Up 1 place')).toHaveTextContent('▲1');
    expect(leader).toHaveTextContent('180');
    const mine = screen.getByTestId('cup-standing-team-1');
    expect(within(mine).getByLabelText('Down 1 place')).toBeInTheDocument();
    expect(within(mine).getByText('You')).toBeInTheDocument();
    expect(within(mine).getByRole('link', { name: 'Casey Crushers' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/championships/2026/race/sport-league-pga/squads/team-1',
    );
  });

  it('draws the race of the top squads, the viewer\'s line heavier', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    const chart = await screen.findByTestId('cup-race-chart');
    expect(within(chart).getByRole('img')).toHaveAccessibleName(
      'Points after each counted contest. Birdie Bandits 180, Casey Crushers 165, Bogey Men 135.',
    );
    expect(screen.getByTestId('cup-race-line-team-1')).toHaveAttribute('stroke-width', '3.5');
    expect(screen.getByTestId('cup-race-line-team-2')).toHaveAttribute('stroke-width', '2');
  });

  it('gives the viewer\'s place no gap to the leader while nothing has counted, rather than "0 behind"', async () => {
    primeViewer([NHL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-nhl');

    const race = await screen.findByTestId('points-race');
    expect(race).toHaveTextContent('LeaderNobody yet');
    expect(race).toHaveTextContent('You1stNext to count');
    expect(race).not.toHaveTextContent('behind');
  });

  it('waits to draw the race until a contest has counted', async () => {
    primeViewer([NHL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-nhl');

    expect(await screen.findByText('The chart starts once a contest has counted.')).toBeInTheDocument();
    expect(screen.queryByTestId('cup-race-chart')).not.toBeInTheDocument();
  });

  it('lists every contest with its weight and state, a final or live one opening its leaderboard', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    const bonus = await screen.findByTestId('cup-contest-contest-2');
    expect(bonus).toHaveTextContent('Won by Birdie Bandits');
    expect(bonus).toHaveTextContent('x1.5');
    expect(bonus).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-2/leaderboard');
    expect(screen.getByTestId('cup-contest-contest-3')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('cup-contest-contest-4')).toHaveTextContent('Live');
    expect(screen.getByTestId('cup-contest-contest-4')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-4/leaderboard');
  });

  it('says the league has no such cup for a sports league it has none in that year', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-mlb');

    expect(await screen.findByTestId('points-race-no-cup')).toHaveTextContent('Cup not found');
  });
});

describe('Championships › a squad\'s cup points', () => {
  it('shows the squad\'s total and each counted contest with its place, weight and points, opening its leaderboard', async () => {
    primeViewer();
    getCupSquadPointsMock.mockResolvedValue(apiSuccess({
      squadPoints: {
        cupId: 'cup-pga',
        squadId: 'team-1',
        squadName: 'Casey Crushers',
        points: 1650,
        contests: [
          { contestId: 'contest-1', name: 'Masters Tiers', cupWeight: 'NORMAL', completedAt: '2026-04-13T22:00:00.000Z', place: 1, displayPlace: '1', rankedEntryCount: 12, points: 1000 },
          { contestId: 'contest-2', name: 'PGA Championship Budget', cupWeight: 'BONUS', completedAt: '2026-05-17T22:00:00.000Z', place: 4, displayPlace: 'T4', rankedEntryCount: 12, points: 650 },
          { contestId: 'contest-5', name: 'Skipped Open', cupWeight: 'NORMAL', completedAt: '2026-06-01T22:00:00.000Z', place: null, displayPlace: null, rankedEntryCount: 9, points: 0 },
        ],
      },
    }));

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga/squads/team-1');

    expect(await screen.findByTestId('cup-squad-points-total')).toHaveTextContent('165 pts');
    expect(getCupSquadPointsMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { id: 'league-1', cupId: 'cup-pga', squadId: 'team-1' },
    }));
    expect(screen.getByTestId('cup-squad-contest-contest-2')).toHaveTextContent('T4 of 12 · x1.5');
    expect(screen.getByTestId('cup-squad-contest-contest-2')).toHaveAttribute('href', '/league/BIGDAWGS/contests/contest-2/leaderboard');
    expect(screen.getByTestId('cup-squad-contest-contest-5')).toHaveTextContent('No entry');
    expect(screen.getByRole('link', { name: '2026 PGA Tour Cup' })).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/championships/2026/race/sport-league-pga',
    );
    expect(screen.getByTestId('championships-tab-race')).toBeChecked();
  });
});
