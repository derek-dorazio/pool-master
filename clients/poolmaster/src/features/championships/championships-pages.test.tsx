import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  buildContestResult,
  buildCup,
  buildCupContest,
  buildCupStanding,
  buildRunningChampionship,
  buildRunningCup,
  buildRunningCupProjection,
} from './test/fixtures';

const { crownCupMock, getChampionshipMock, getCupProjectionMock, getCupSquadPointsMock, getCurrentUserMock, getLeagueByCodeMock, listChampionshipYearsMock, listContestResultsMock, listCupSeasonsMock, listCupsMock, refreshTokenMock } = vi.hoisted(() => ({
  crownCupMock: vi.fn(),
  getChampionshipMock: vi.fn(),
  getCupProjectionMock: vi.fn(),
  getCupSquadPointsMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  getLeagueByCodeMock: vi.fn(),
  listChampionshipYearsMock: vi.fn(),
  listContestResultsMock: vi.fn(),
  listCupSeasonsMock: vi.fn(),
  listCupsMock: vi.fn(),
  refreshTokenMock: vi.fn(),
}));

bindApiMocks({
  crownCup: crownCupMock,
  getChampionship: getChampionshipMock,
  getCupProjection: getCupProjectionMock,
  getCupSquadPoints: getCupSquadPointsMock,
  getLeagueByCode: getLeagueByCodeMock,
  getUser: getCurrentUserMock,
  listChampionshipYears: listChampionshipYearsMock,
  listContestResults: listContestResultsMock,
  listCupSeasons: listCupSeasonsMock,
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

function primeViewer(cups = [buildRunningCup()], championship = buildRunningChampionship(), role: 'MEMBER' | 'COMMISSIONER' = 'MEMBER') {
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  getLeagueByCodeMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(
    buildLeague(),
    { membership: buildLeagueMembership({ role }), squadMembership: buildLeagueSquadMember() },
  )));
  listCupsMock.mockResolvedValue(apiSuccess({ cups }));
  getCupProjectionMock.mockResolvedValue(apiSuccess({ projection: buildRunningCupProjection() }));
  listChampionshipYearsMock.mockResolvedValue(apiSuccess({ years: [{ year: 2026, isOver: false, leaders: [] }, { year: 2024, isOver: true, leaders: [] }] }));
  listCupSeasonsMock.mockResolvedValue(apiSuccess({ seasonYears: [2026, 2025] }));
  getChampionshipMock.mockResolvedValue(apiSuccess({ championship }));
  listContestResultsMock.mockResolvedValue(apiSuccess({ contests: YEAR_CONTESTS }));
}

/** The year's final contests, newest first: a counted one, a not-counted one, one rained out. */
const YEAR_CONTESTS = [
  buildContestResult({ contestId: 'contest-3', name: 'Rained Out Open', completedAt: '2026-07-20T22:00:00.000Z', count: 'NO_RESULT', rankedEntryCount: 0, winners: [] }),
  buildContestResult({ contestId: 'contest-2', name: 'Fun Squares', sportLeagueName: 'NFL', completedAt: '2026-05-17T22:00:00.000Z', count: 'NOT_COUNTED', rankedEntryCount: 1 }),
  buildContestResult(),
];

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

/** The NFL cup once crowned: the viewer's Casey Crushers champions, Birdie Bandits runners-up. */
const CROWNED_NFL_CUP = buildCup({
  ...NFL_CUP,
  status: 'CROWNED',
  crownedAt: '2026-02-12T15:00:00.000Z',
  standings: [
    buildCupStanding({ points: 2000, wins: 2, contestsCounted: 2, pointsAfter: [1000, 2000], trophy: 'CHAMPION' }),
    buildCupStanding({ squadId: 'team-2', squadName: 'Birdie Bandits', position: 2, displayPosition: '2', points: 1600, pointsAfter: [800, 1600], trophy: 'RUNNER_UP' }),
  ],
  contests: [...NFL_CUP.contests, buildCupContest({ contestId: 'nfl-3', name: 'Pro Bowl Picks', count: 'AFTER_CROWNING' })],
});

/** Last season's PGA Tour cup: every contest final, never crowned. */
const PAST_PGA_CUP = buildCup({
  ...buildRunningCup(),
  seasonYear: 2025,
  name: '2025 PGA Tour Cup',
  contests: buildRunningCup().contests.filter((contest) => contest.count !== 'NOT_FINAL'),
});

/** Last season's NFL cup, its playoffs still live in the new year. */
const PAST_NFL_CUP_STILL_LIVE = buildCup({
  ...NFL_CUP,
  seasonYear: 2025,
  name: '2025 NFL Cup',
  contests: [...NFL_CUP.contests, buildCupContest({ contestId: 'nfl-3', name: 'Playoff Picks', status: 'ACTIVE', count: 'NOT_FINAL', completedAt: null })],
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
  for (const mock of [crownCupMock, getChampionshipMock, getCupProjectionMock, getCupSquadPointsMock, getCurrentUserMock, getLeagueByCodeMock, listChampionshipYearsMock, listCupSeasonsMock, listCupsMock, refreshTokenMock]) {
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

  it('offers every year with a championship or a cup, and the current one, newest first, and moves the tab shown to the year chosen', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    const picker = await screen.findByRole('combobox', { name: 'Year' });
    await waitFor(() => expect(within(picker).getAllByRole('option').map((option) => option.textContent)).toEqual(['2026', '2025', '2024']));
    fireEvent.change(picker, { target: { value: '2025' } });

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/championships\/2025\/trophies$/);
    expect(await screen.findByRole('heading', { name: '2025 Championships' })).toBeInTheDocument();
  });

  it('takes the Points race to the chosen year\'s first cup, since the same sports league may have none then', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    fireEvent.change(await screen.findByRole('combobox', { name: 'Year' }), { target: { value: '2024' } });

    expect(screen.getByTestId('location')).toHaveTextContent(/^\/league\/BIGDAWGS\/championships\/2024\/race/);
    expect(screen.getByTestId('location')).not.toHaveTextContent('sport-league-pga');
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

  it('narrows the standings to the squads whose name matches the search', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    fireEvent.change(await screen.findByTestId('championship-standings-search'), { target: { value: 'fore' } });

    expect(screen.getByTestId('championship-standing-team-3')).toBeInTheDocument();
    expect(screen.queryByTestId('championship-standing-team-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('championship-standing-team-2')).not.toBeInTheDocument();
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

  it('lists the year\'s final contests newest first with sports league, winner and entries, marking one not counted and one without a result', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    const list = await screen.findByTestId('championship-contests');
    expect(screen.getByTestId('championship-contests-heading')).toHaveTextContent('Contests in 2026');
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('data-testid'))).toEqual([
      'championship-contest-contest-3',
      'championship-contest-contest-2',
      'championship-contest-contest-1',
    ]);
    expect(screen.getByTestId('championship-contest-contest-1')).toHaveTextContent('Masters Tiers');
    expect(screen.getByTestId('championship-contest-contest-1')).toHaveTextContent('Won by Birdie Bandits · 12 entries');
    expect(screen.getByTestId('championship-contest-contest-1')).toHaveTextContent('PGA Tour');
    expect(screen.getByTestId('championship-contest-contest-2')).toHaveTextContent('Not counted');
    expect(screen.getByTestId('championship-contest-contest-2')).toHaveTextContent('Won by Birdie Bandits · 1 entry');
    expect(screen.getByTestId('championship-contest-contest-3')).toHaveTextContent('No result');
    expect(screen.getByTestId('championship-contest-contest-3')).toHaveTextContent('Every event was cancelled, so nobody placed');
    expect(listContestResultsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1' }, query: { year: 2026 } }));
  });

  it('opens a contest\'s final leaderboard from its row', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026');

    fireEvent.click(await screen.findByTestId('championship-contest-contest-1'));

    expect(await screen.findByTestId('leaderboard')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/league/BIGDAWGS/contests/contest-1/leaderboard');
  });

  it('narrows the contests to a matrix cell\'s when its count is tapped, with the squad\'s place and points, and back to all of them', async () => {
    primeViewer();
    renderChampionships('/league/BIGDAWGS/championships/2026');
    const cell = await screen.findByTestId('championship-cell-team-1-2');
    listContestResultsMock.mockResolvedValue(apiSuccess({ contests: [
      buildContestResult({ contestId: 'contest-5', name: 'US Open Tiers', squadFinish: { place: 2, displayPlace: 'T2', points: 725 } }),
    ] }));

    fireEvent.click(cell);

    expect(await screen.findByTestId('championship-contest-contest-5')).toHaveTextContent('T2 · 72.5 pts');
    expect(screen.getByTestId('championship-contests-heading')).toHaveTextContent('Contests Casey Crushers finished 2nd in 2026');
    expect(screen.getByTestId('championship-cell-team-1-2')).toHaveAttribute('aria-pressed', 'true');
    expect(listContestResultsMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: { year: 2026, squadId: 'team-1', place: 2 } }));

    listContestResultsMock.mockResolvedValue(apiSuccess({ contests: YEAR_CONTESTS }));
    fireEvent.click(screen.getByTestId('championship-contests-clear'));

    expect(await screen.findByTestId('championship-contest-contest-3')).toBeInTheDocument();
    expect(screen.getByTestId('championship-contests-heading')).toHaveTextContent('Contests in 2026');
  });

  it('narrows the contests to every one a squad played when its Played count is tapped', async () => {
    primeViewer();
    renderChampionships('/league/BIGDAWGS/championships/2026');

    fireEvent.click(await screen.findByTestId('championship-played-team-3'));

    await waitFor(() => expect(screen.getByTestId('championship-contests-heading')).toHaveTextContent('Contests Fore Play played in 2026'));
    expect(listContestResultsMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: { year: 2026, squadId: 'team-3' } }));
  });

  it('keeps a cell\'s filter from a shared link, and ignores one naming a squad not in the standings', async () => {
    primeViewer();
    const { unmount } = renderChampionships('/league/BIGDAWGS/championships/2026?squad=team-2&place=1');

    expect(await screen.findByTestId('championship-contests-heading')).toHaveTextContent('Contests Birdie Bandits finished 1st in 2026');
    expect(listContestResultsMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: { year: 2026, squadId: 'team-2', place: 1 } }));
    unmount();

    renderChampionships('/league/BIGDAWGS/championships/2026?squad=team-9&place=1');

    expect(await screen.findByTestId('championship-contests-heading')).toHaveTextContent('Contests in 2026');
    expect(listContestResultsMock).toHaveBeenLastCalledWith(expect.objectContaining({ query: { year: 2026 } }));
  });

  it('says so when the year\'s contests cannot be loaded, keeping the standings', async () => {
    primeViewer();
    listContestResultsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderChampionships('/league/BIGDAWGS/championships/2026');

    expect(await screen.findByTestId('championship-contests-error')).toBeInTheDocument();
    expect(screen.getByTestId('championship-standing-team-1')).toBeInTheDocument();
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

  it('drops the progress from a past season\'s cup card once its season is over', async () => {
    primeViewer([PAST_PGA_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2025/trophies');

    const card = await screen.findByTestId('cup-card-cup-pga');
    expect(card).toHaveTextContent('2025 PGA Tour Cup');
    expect(within(card).queryByRole('progressbar')).not.toBeInTheDocument();
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

  it('offers the commissioner Ready to crown for a cup whose contests are all final, and none for one with a live contest', async () => {
    primeViewer([buildRunningCup(), NFL_CUP], undefined, 'COMMISSIONER');

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    expect(await screen.findByTestId('ready-to-crown-cup-nfl')).toHaveTextContent('2026 NFL Cup is ready to crownAll 2 NFL contests are final.');
    expect(screen.queryByTestId('ready-to-crown-cup-pga')).not.toBeInTheDocument();
  });

  it('never offers a member Ready to crown', async () => {
    primeViewer([NFL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');

    expect(await screen.findByTestId('cup-card-cup-nfl')).toBeInTheDocument();
    expect(screen.queryByTestId('ready-to-crown-cup-nfl')).not.toBeInTheDocument();
  });

  it('crowns the cup once the commissioner confirms, naming the winner first, and then shows it won', async () => {
    primeViewer([NFL_CUP], undefined, 'COMMISSIONER');
    crownCupMock.mockResolvedValue(apiSuccess({ cup: CROWNED_NFL_CUP }));

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');
    fireEvent.click(await screen.findByTestId('crown-cup-cup-nfl'));

    expect(screen.getByText(/^Casey Crushers takes the cup\. Crowning fixes the standings/)).toBeInTheDocument();
    listCupsMock.mockResolvedValue(apiSuccess({ cups: [CROWNED_NFL_CUP] }));
    fireEvent.click(screen.getByTestId('crown-cup-dialog-cup-nfl-confirm'));

    expect(await screen.findByText('Casey Crushers won · you were 1st')).toBeInTheDocument();
    expect(crownCupMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', cupId: 'cup-nfl' } }));
    expect(screen.queryByTestId('ready-to-crown-cup-nfl')).not.toBeInTheDocument();
  });

  it('says why when the cup cannot be crowned, keeping the dialog open', async () => {
    primeViewer([NFL_CUP], undefined, 'COMMISSIONER');
    crownCupMock.mockResolvedValue({
      error: { error: { code: 'CUP_HAS_UNFINISHED_CONTESTS', message: 'The cup cannot be crowned while Super Bowl Picks is not final.' } },
    });

    renderChampionships('/league/BIGDAWGS/championships/2026/trophies');
    fireEvent.click(await screen.findByTestId('crown-cup-cup-nfl'));
    fireEvent.click(screen.getByTestId('crown-cup-dialog-cup-nfl-confirm'));

    expect(await screen.findByText('The cup cannot be crowned while Super Bowl Picks is not final.')).toBeInTheDocument();
    expect(screen.getByTestId('crown-cup-dialog-cup-nfl')).toBeInTheDocument();
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

  it('greys where each squad would stand if the live contest ended now beside its place, naming the contest', async () => {
    primeViewer();

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    expect(await screen.findByTestId('cup-projected-team-1')).toHaveTextContent('1st · 265');
    expect(screen.getByTestId('cup-projected-team-2')).toHaveTextContent('2nd · 260');
    expect(screen.getByRole('columnheader', { name: /If it ended now/ })).toBeInTheDocument();
    expect(screen.getByTestId('cup-projection-note')).toHaveTextContent(
      'The greyed column shows where each squad would stand if Tour Championship Tiers ended now.',
    );
    expect(getCupProjectionMock).toHaveBeenCalledWith(expect.objectContaining({ path: { id: 'league-1', cupId: 'cup-pga' } }));
  });

  it('asks for no projection for a cup with no live contest, or a crowned one, and shows no projected column', async () => {
    primeViewer([NFL_CUP, CROWNED_NFL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-nfl');

    expect(await screen.findByTestId('points-race')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /If it ended now/ })).not.toBeInTheDocument();
    expect(getCupProjectionMock).not.toHaveBeenCalled();
  });

  it('keeps the standings and says so when the projection cannot be worked out', async () => {
    primeViewer();
    getCupProjectionMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'Down' } } });

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-pga');

    expect(await screen.findByTestId('cup-projection-error')).toBeInTheDocument();
    expect(screen.getByTestId('cup-standing-team-2')).toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: /If it ended now/ })).not.toBeInTheDocument();
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

  it('puts a crowned cup\'s podium above its standings, with its champion and crowning date, and no next contest', async () => {
    primeViewer([CROWNED_NFL_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2026/race/sport-league-nfl');

    expect(await screen.findByTestId('cup-podium-1')).toHaveTextContent('Casey Crushers');
    expect(screen.getByTestId('cup-podium-2')).toHaveTextContent('Birdie Bandits');
    expect(screen.getByTestId('points-race-summary')).toHaveTextContent(/^NFL · Crowned /);
    expect(screen.getByText('Champion')).toBeInTheDocument();
    expect(screen.queryByText('Next to count')).not.toBeInTheDocument();
    expect(screen.getByTestId('cup-contest-nfl-3')).toHaveTextContent('After crowning');
  });

  it('shows a past season\'s cup never crowned as not crowned, with no movement and no next contest', async () => {
    primeViewer([PAST_PGA_CUP]);

    renderChampionships('/league/BIGDAWGS/championships/2025/race/sport-league-pga');

    expect(await screen.findByTestId('cup-not-crowned')).toHaveTextContent('hasn\'t been crowned');
    expect(screen.getByTestId('points-race-summary')).toHaveTextContent('PGA Tour · Not crowned');
    expect(screen.getByTestId('points-race')).toHaveTextContent('Finished 1stBirdie Bandits');
    expect(screen.queryByText('Next to count')).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Move' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('cup-podium')).not.toBeInTheDocument();
  });

  it('keeps a past season\'s cup live while a contest of its season is still live, as NFL playoffs in the new year', async () => {
    primeViewer([PAST_NFL_CUP_STILL_LIVE]);

    renderChampionships('/league/BIGDAWGS/championships/2025/race/sport-league-nfl');

    expect(await screen.findByTestId('points-race')).toHaveTextContent('Next to countPlayoff PicksLive now');
    expect(screen.getByRole('columnheader', { name: 'Move' })).toBeInTheDocument();
    expect(screen.queryByTestId('cup-not-crowned')).not.toBeInTheDocument();
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
