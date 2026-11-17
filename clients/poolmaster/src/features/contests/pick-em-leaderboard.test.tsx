import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import { bracketLeagueContextFixture } from './test/bracket-fixtures';
import {
  NFL_TEAMS,
  pickEmContestFixture,
  pickEmEventFieldFixture,
  pickEmLeaderboardFixture,
  pickEmWeekFixture,
  week1Games,
  week2EventGamesFixture,
  weekPick,
} from './test/pick-em-fixtures';

const {
  getPickEmLeaderboardMock,
  getContestLeaderboardMock,
  getContestMock,
  getEventBracketMock,
  getGamePicksMock,
  getLeagueMock,
  listEventParticipantsMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getPickEmLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listEventParticipantsMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getPickEmLeaderboard: getPickEmLeaderboardMock,
  getContest: getContestMock,
  getContestLeaderboard: getContestLeaderboardMock,
  // #1751 — an opened entry lists the current week's games, named from the week's field, and the
  // viewer's own entries show their picks from their own picks read.
  getEventBracket: getEventBracketMock,
  getGamePicks: getGamePicksMock,
  getLeague: getLeagueMock,
  listEventParticipants: listEventParticipantsMock,
});

vi.mock('@/features/auth/auth-context', () => ({
  useAuth: () => ({
    isAuthenticated: true,
    isLoading: false,
    isRootAdmin: false,
    user: {
      id: 'user-1',
      email: 'member@example.com',
      username: 'member@example.com',
      firstName: 'Morgan',
      lastName: 'Member',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-15T00:00:00.000Z',
    },
    clearSession: vi.fn(),
  }),
}));

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function EntryDestination() {
  const { entryId } = useParams<{ entryId: string }>();
  return <div data-testid="entry-destination">{entryId}</div>;
}

function renderLeaderboard(search = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1/leaderboard', search }]}>
        <Routes>
          <Route element={<ContestLeaderboardPage />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
          <Route element={<EntryDestination />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Week 2 as the event's games read returns it: the Sunday games played, Monday's still to come. */
const WEEK_2_GAMES = week2EventGamesFixture({
  1: { status: 'COMPLETED', winnerSide: 'HOME', homeScore: 27, awayScore: 20 },
  2: { status: 'COMPLETED', winnerSide: 'HOME', homeScore: 31, awayScore: 17 },
});

/** The viewer's own week 2 picks, as their picks read returns them: Monday's pick included. */
function ownWeek2Picks() {
  return pickEmWeekFixture({
    sportEventId: 'week-2',
    status: 'SUBMITTED',
    games: week1Games({
      1: { sportEventMatchId: 'week2-game-3', pick: weekPick(NFL_TEAMS.packers) },
      2: { sportEventMatchId: 'week2-game-1', status: 'COMPLETED', pick: weekPick(NFL_TEAMS.bills, { outcome: 'BUSTED', points: 0 }) },
      3: { sportEventMatchId: 'week2-game-2', status: 'COMPLETED', pick: weekPick(NFL_TEAMS.eagles, { outcome: 'CORRECT', points: 1 }) },
    }),
  });
}

function primeMocks(board = pickEmLeaderboardFixture()) {
  getContestMock.mockResolvedValue({ data: { contest: pickEmContestFixture({ status: 'ACTIVE' }) } });
  getPickEmLeaderboardMock.mockResolvedValue({ data: board });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
  getEventBracketMock.mockResolvedValue({ data: { matches: WEEK_2_GAMES } });
  listEventParticipantsMock.mockResolvedValue({ data: { participants: pickEmEventFieldFixture('week-2') } });
  getGamePicksMock.mockResolvedValue({ data: ownWeek2Picks() });
}

describe('Pick\'em contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getPickEmLeaderboardMock, getContestLeaderboardMock, getContestMock, getLeagueMock, getEventBracketMock, getGamePicksMock, listEventParticipantsMock]) {
      mock.mockReset();
    }
  });

  it('heads the board Entry, Season, then the weeks newest first with the current one live, and never reads the roster leaderboard', async () => {
    primeMocks();
    renderLeaderboard();

    const table = await screen.findByTestId('pick-em-leaderboard-table');
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent.replace('↕', ''))).toEqual(['Entry', 'Season', 'Week 2Live', 'Week 1']);
    expect(screen.getByTestId('pick-em-leaderboard-week-week-2-live')).toBeInTheDocument();
    expect(screen.getByTestId('pick-em-leaderboard-place-entry-2')).toHaveTextContent('1');
    expect(screen.getByTestId('pick-em-leaderboard-total-entry-2')).toHaveTextContent('3 pts');
    expect(screen.getByTestId('pick-em-leaderboard-mode')).toHaveTextContent('Straight up');
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('highlights the row of the entry a link names (?entry=) and scrolls it into view', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks();
    renderLeaderboard('?entry=entry-1');

    const row = await screen.findByTestId('pick-em-leaderboard-row-entry-1');
    expect(row).toHaveAttribute('aria-current', 'true');
    expect(screen.getByTestId('pick-em-leaderboard-row-entry-2')).not.toHaveAttribute('aria-current');
    expect(scroll).toHaveBeenCalledTimes(1);
    scroll.mockRestore();
  });

  it('shows each week\'s picks right with a medal for the week\'s top three, a dash for a week not submitted, and the viewer\'s best place', async () => {
    primeMocks();
    renderLeaderboard();

    expect(await screen.findByTestId('pick-em-leaderboard-week-week-1-entry-2')).toHaveTextContent('2🥇');
    expect(screen.getByTestId('pick-em-leaderboard-week-week-2-entry-1')).toHaveTextContent('1🥇');
    expect(screen.getByTestId('pick-em-leaderboard-week-week-1-entry-1')).toHaveTextContent('—');
    expect(screen.queryByTestId('pick-em-leaderboard-week-week-1-entry-1-medal')).not.toBeInTheDocument();
    expect(screen.getByTestId('pick-em-leaderboard-my-best')).toHaveTextContent('Your best: 2 · Morgan’s Picks, 1 pt');
    // In the Standings title bar, beside the title, not above the board among the page's notes.
    expect(within(screen.getByRole('region', { name: 'Standings' })).getByTestId('pick-em-leaderboard-my-best')).toBeInTheDocument();
  });

  it('opens a week\'s count to how the week went: picks right of its games, the place among the entries placed, and the teams missed', async () => {
    primeMocks();
    renderLeaderboard();

    // Once the viewer's league has loaded the board stops re-rendering its rows.
    await screen.findByTestId('pick-em-leaderboard-my-best');
    fireEvent.click(screen.getByTestId('pick-em-leaderboard-week-week-2-entry-2-peek'));

    const peek = await screen.findByTestId('pick-em-leaderboard-week-week-2-entry-2-peek-callout');
    expect(peek).toHaveTextContent('Week 2');
    expect(peek).toHaveTextContent('Right1 of 3');
    expect(peek).toHaveTextContent('PlaceT1st of 2');
    expect(peek).toHaveTextContent('MissedDAL');
  });

  it('opens the viewer\'s own entry to the current week\'s games with its picks, Monday\'s too before it kicks off, and leaves another\'s closed', async () => {
    primeMocks();
    renderLeaderboard();

    const mondayPick = await screen.findByTestId('pick-em-leaderboard-pick-week2-game-3-entry-1');
    expect(mondayPick).toHaveTextContent('GB');
    expect(mondayPick).toHaveAttribute('data-outcome', 'PENDING');
    expect(screen.getByTestId('pick-em-leaderboard-game-week2-game-1-entry-1')).toHaveTextContent(/BUF at KC.*KC 27–\u206020/);
    expect(screen.getByTestId('pick-em-leaderboard-pick-week2-game-1-entry-1')).toHaveAttribute('data-outcome', 'BUSTED');
    expect(screen.getByTestId('pick-em-leaderboard-toggle-entry-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('pick-em-leaderboard-toggle-entry-2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('pick-em-leaderboard-game-week2-game-1-entry-2')).not.toBeInTheDocument();
  });

  it('opens another entry to its picks on the games that have kicked off, marked right or missed, and never shows its pick on a game still to come', async () => {
    primeMocks();
    renderLeaderboard();

    fireEvent.click(await screen.findByTestId('pick-em-leaderboard-toggle-entry-2'));

    const right = await screen.findByTestId('pick-em-leaderboard-pick-week2-game-1-entry-2');
    expect(right).toHaveTextContent('KC');
    expect(within(right).getByLabelText('Right')).toBeInTheDocument();
    const missed = screen.getByTestId('pick-em-leaderboard-pick-week2-game-2-entry-2');
    expect(missed).toHaveTextContent('DAL');
    expect(within(missed).getByLabelText('Missed')).toBeInTheDocument();
    // Monday's game is listed with its kickoff, and no pick: the board holds none until it kicks off.
    expect(screen.getByTestId('pick-em-leaderboard-game-week2-game-3-entry-2')).toHaveTextContent('CHI at GB');
    expect(screen.queryByTestId('pick-em-leaderboard-pick-week2-game-3-entry-2')).not.toBeInTheDocument();
    // Only the viewer's own picks are read; another entry's come from the board alone.
    expect(getGamePicksMock).toHaveBeenCalledTimes(1);
    expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'week-2' } }));
  });

  it('opens every entry with Show all details, then closes them with Hide all details', async () => {
    primeMocks();
    renderLeaderboard();

    fireEvent.click(await screen.findByTestId('pick-em-leaderboard-toggle-all'));
    await waitFor(() => expect(screen.getByTestId('pick-em-leaderboard-toggle-entry-2')).toHaveAttribute('aria-expanded', 'true'));
    expect(screen.getByTestId('pick-em-leaderboard-toggle-all')).toHaveTextContent('Hide all details');

    fireEvent.click(screen.getByTestId('pick-em-leaderboard-toggle-all'));
    expect(screen.getByTestId('pick-em-leaderboard-toggle-entry-1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('pick-em-leaderboard-game-week2-game-1-entry-1')).not.toBeInTheDocument();
  });

  it('lists entries unranked and unopenable before the first kickoff, reading no games, and says points show from then', async () => {
    const before = pickEmLeaderboardFixture();
    primeMocks({
      ...before,
      currentWeekId: 'week-1',
      weeks: before.weeks.map((week) => ({ ...week, status: 'SCHEDULED', started: false, settled: false, winnerEntryIds: [], tiebreakerTotalPoints: null })),
      entries: before.entries.map((entry) => ({
        ...entry,
        position: null,
        displayPosition: null,
        totalPoints: 0,
        weeks: entry.weeks.map((week) => ({ ...week, points: null, position: null, displayPosition: null, weeklyWinner: false, correctPickCount: null, missedPicks: [] })),
        currentWeekPicks: [],
      })),
    });
    renderLeaderboard();

    expect(await screen.findByTestId('pick-em-leaderboard-not-started')).toHaveTextContent('Points show from the first kickoff.');
    expect(screen.getByTestId('pick-em-leaderboard-place-entry-2')).toHaveTextContent('—');
    expect(screen.queryByTestId('pick-em-leaderboard-my-best')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-leaderboard-toggle-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('pick-em-leaderboard-week-week-1-live')).not.toBeInTheDocument();
    expect(getEventBracketMock).not.toHaveBeenCalled();
    expect(getGamePicksMock).not.toHaveBeenCalled();
  });

  it('links each entry to its weeks of picks', async () => {
    primeMocks();
    renderLeaderboard();

    // Once the viewer's league has loaded the board stops re-rendering its rows.
    await screen.findByTestId('pick-em-leaderboard-my-best');
    fireEvent.click(screen.getByTestId('pick-em-leaderboard-entry-link-entry-2'));
    expect(await screen.findByTestId('entry-destination')).toHaveTextContent('entry-2');
  });
});
