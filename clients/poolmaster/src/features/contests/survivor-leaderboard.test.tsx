import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import { bracketLeagueContextFixture } from './test/bracket-fixtures';
import {
  NFL_TEAMS,
  pickEmContestFixture,
  playoffSurvivorContestFixture,
  playoffSurvivorLeaderboardFixture,
  survivorLeaderboardFixture,
  survivorWeekFixture,
  week1Games,
  weekPick,
} from './test/pick-em-fixtures';
import type { SurvivorLeaderboardResponse } from '@/lib/api';

type SurvivorPick = SurvivorLeaderboardResponse['entries'][number]['weeks'][number];

const {
  getSurvivorLeaderboardMock,
  getPickEmLeaderboardMock,
  getContestLeaderboardMock,
  getContestMock,
  getLeagueMock,
  getGamePicksMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    getSurvivorLeaderboardMock: vi.fn(),
    getPickEmLeaderboardMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getContestMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getGamePicksMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getSurvivorLeaderboard: getSurvivorLeaderboardMock,
  getPickEmLeaderboard: getPickEmLeaderboardMock,
  getContest: getContestMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getLeague: getLeagueMock,
  getGamePicks: getGamePicksMock,
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

function renderLeaderboard(search = '') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1/leaderboard', search }]}>
        <Routes>
          <Route element={<ContestLeaderboardPage />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks(
  board = survivorLeaderboardFixture(),
  contest = pickEmContestFixture({ status: 'ACTIVE', selectionType: 'SURVIVOR' }),
) {
  getContestMock.mockResolvedValue({ data: { contest } });
  getSurvivorLeaderboardMock.mockResolvedValue({ data: board });
  getLeagueMock.mockResolvedValue({ data: bracketLeagueContextFixture() });
  getGamePicksMock.mockResolvedValue({ data: survivorWeekFixture({ sportEventId: 'week-2', status: 'DRAFT' }) });
}

/** The headers of the board's columns, as read. */
async function headers(): Promise<string[]> {
  const table = await screen.findByTestId('survivor-leaderboard-table');
  return within(table).getAllByRole('columnheader').map((header) => header.textContent.replace('↕', ''));
}

describe('Survivor contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getSurvivorLeaderboardMock, getPickEmLeaderboardMock, getContestLeaderboardMock, getContestMock, getLeagueMock, getGamePicksMock]) {
      mock.mockReset();
    }
  });

  it('marks a cancelled week with the shared Cancelled chip rather than words in its heading', async () => {
    const board = survivorLeaderboardFixture();
    primeMocks({ ...board, weeks: [{ ...board.weeks[0], status: 'CANCELLED' }, ...board.weeks.slice(1)] });
    renderLeaderboard();

    expect(await screen.findByTestId('survivor-leaderboard-week-week-1-schedule')).toHaveTextContent('Cancelled');
    expect(screen.queryByText(/\(cancelled\)/)).not.toBeInTheDocument();
  });

  it('highlights the row of the entry a link names (?entry=) as the one to look at', async () => {
    primeMocks();
    renderLeaderboard('?entry=entry-1');

    expect(await screen.findByTestId('survivor-leaderboard-row-entry-1')).toHaveAttribute('aria-current', 'true');
  });

  it('heads the board Entry, Status, Weeks, then the weeks newest first with the week under way marked live, and reads neither the pick\'em nor the roster leaderboard', async () => {
    primeMocks();
    renderLeaderboard();

    expect(await headers()).toEqual(['Entry', 'Status', 'Weeks', 'Week 2Live', 'Week 1']);
    expect(screen.getByTestId('survivor-leaderboard-place-entry-1')).toHaveTextContent('1');
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-1')).toHaveTextContent(/^In$/);
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-2')).toHaveTextContent('Out · Week 2');
    expect(screen.getByTestId('survivor-leaderboard-survived-entry-2')).toHaveTextContent('1');
    expect(screen.getByTestId('survivor-leaderboard-still-in')).toHaveTextContent('1 entry still in.');
    expect(getPickEmLeaderboardMock).not.toHaveBeenCalled();
    expect(getContestLeaderboardMock).not.toHaveBeenCalled();
  });

  it('shows each week\'s team green once survived and red once lost, and locks another\'s pick until its game kicks off', async () => {
    primeMocks();
    renderLeaderboard();

    await screen.findByTestId('survivor-leaderboard-table');
    const survived = screen.getByTestId('survivor-leaderboard-week-week-1-entry-1');
    expect(survived).toHaveTextContent('Chiefs');
    expect(survived).toHaveAttribute('data-state', 'survived');
    const lost = screen.getByTestId('survivor-leaderboard-week-week-2-entry-2');
    expect(lost).toHaveTextContent('Bears');
    expect(lost).toHaveAttribute('data-state', 'lost');
    const hidden = screen.getByTestId('survivor-leaderboard-week-week-2-entry-1');
    expect(hidden).toHaveAttribute('data-state', 'hidden');
    expect(within(hidden).getByLabelText('Hidden until kickoff')).toBeInTheDocument();
  });

  it('shows the viewer\'s own submitted pick in the week under way before it kicks off, reading only its own entry\'s picks', async () => {
    primeMocks();
    getGamePicksMock.mockResolvedValue({
      data: survivorWeekFixture({ sportEventId: 'week-2', status: 'SUBMITTED', games: week1Games({ 3: { pick: weekPick(NFL_TEAMS.eagles) } }) }),
    });
    renderLeaderboard();

    await waitFor(() => expect(screen.getByTestId('survivor-leaderboard-week-week-2-entry-1')).toHaveTextContent('Eagles'));
    expect(screen.getByTestId('survivor-leaderboard-week-week-2-entry-1')).toHaveAttribute('data-state', 'pending');
    expect(getGamePicksMock).toHaveBeenCalledTimes(1);
    expect(getGamePicksMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1', entryId: 'entry-1', sportEventId: 'week-2' } }));
  });

  it('opens an entry to its weeks newest first, each game with how it went, a lost week saying it put the entry out', async () => {
    const board = survivorLeaderboardFixture();
    const [morgan, chalk] = board.entries;
    const game = (side: 'HOME' | 'AWAY', teamScore: number, opponentScore: number) => ({
      opponent: 'Packers', opponentShortName: 'GB', side, isNeutralSite: false, scheduledDate: '2026-09-13T17:00:00.000Z',
      status: 'COMPLETED' as const, teamScore, opponentScore,
    });
    const chalkWeeks: SurvivorPick[] = [
      { sportEventId: 'week-1', roundNumber: 1, outcome: 'SURVIVED', team: 'Bills', teamShortName: 'BUF', game: game('HOME', 27, 20) },
      { sportEventId: 'week-2', roundNumber: 1, outcome: 'ELIMINATED', team: 'Bears', teamShortName: 'CHI', game: game('AWAY', 20, 24) },
    ];
    primeMocks(survivorLeaderboardFixture({ entries: [morgan, { ...chalk, weeks: chalkWeeks }] as typeof board.entries }));
    renderLeaderboard();

    // The viewer's own entry starts open; another's opens on its ▼.
    await waitFor(() => expect(screen.getByTestId('survivor-leaderboard-toggle-entry-1')).toHaveAttribute('aria-expanded', 'true'));
    fireEvent.click(screen.getByTestId('survivor-leaderboard-toggle-entry-2'));

    const rows = screen.getAllByTestId(/^survivor-leaderboard-detail-week-\d-entry-2$/).map((row) => row.getAttribute('data-testid'));
    expect(rows).toEqual(['survivor-leaderboard-detail-week-2-entry-2', 'survivor-leaderboard-detail-week-1-entry-2']);
    expect(screen.getByTestId('survivor-leaderboard-game-week-2-entry-2')).toHaveTextContent('CHI at GB✗ Lost 20–⁠24 · Out');
    expect(screen.getByTestId('survivor-leaderboard-game-week-1-entry-2')).toHaveTextContent('BUF v GB✓ Won 27–⁠20');
    expect(screen.getByTestId('survivor-leaderboard-week-week-1-entry-2')).toHaveTextContent('BUF');
  });

  it('lists an opened entry\'s latest six weeks and opens its earlier weeks from one line', async () => {
    const weeks = Array.from({ length: 8 }, (_, index) => ({
      sportEventId: `week-${index + 1}`, weekNumber: index + 1, roundNumber: 1, roundCount: 1, name: `Week ${index + 1}`,
      startDate: '2026-09-10T00:00:00.000Z', status: 'COMPLETED' as const, started: true, aliveCount: 1,
    }));
    const board = survivorLeaderboardFixture();
    const [morgan] = board.entries;
    primeMocks(survivorLeaderboardFixture({
      weeks,
      entries: [{
        ...morgan,
        weeksSurvived: 8,
        weeks: weeks.map((week) => ({ sportEventId: week.sportEventId, roundNumber: 1, outcome: 'SURVIVED' as const, team: 'Chiefs', teamShortName: 'KC', game: null })),
      }],
    }));
    renderLeaderboard();

    // The viewer's own entry starts open.
    expect(await screen.findAllByTestId(/^survivor-leaderboard-detail-week-\d-entry-1$/)).toHaveLength(6);
    expect(screen.getByTestId('survivor-leaderboard-detail-week-3-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('survivor-leaderboard-detail-week-2-entry-1')).not.toBeInTheDocument();
    expect(screen.getByTestId('survivor-leaderboard-earlier-entry-1')).toHaveTextContent('Weeks 1–2 ›');
  });

  it('heads a playoff survivor pool by its round names and says the round an entry went out in', async () => {
    primeMocks(playoffSurvivorLeaderboardFixture(), playoffSurvivorContestFixture());
    renderLeaderboard();

    expect(await headers()).toEqual(['Entry', 'Status', 'Weeks', 'Super Bowl', 'Conference ChampionshipLive']);
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-2')).toHaveTextContent('Out · Conference Championship');
    expect(screen.getByTestId('survivor-leaderboard-week-playoffs-round-1-entry-1')).toHaveTextContent('Bills');
  });

  it('reads "In · 1 life left" for an entry that lost a life it stays in with, and shows that week red as lost', async () => {
    const board = survivorLeaderboardFixture();
    const [morgan, chalk] = board.entries;
    primeMocks(survivorLeaderboardFixture({
      entries: [
        {
          ...morgan,
          livesLeft: 1,
          livesLost: 1,
          weeks: [
            { sportEventId: 'week-1', roundNumber: 1, outcome: 'LIFE_LOST', team: 'Chiefs', teamShortName: null, game: null },
            { sportEventId: 'week-2', roundNumber: 1, outcome: 'PENDING', team: null, teamShortName: null, game: null },
          ],
        },
        chalk,
      ],
    }));
    renderLeaderboard();

    await screen.findByTestId('survivor-leaderboard-table');
    expect(screen.getByTestId('survivor-leaderboard-standing-entry-1')).toHaveTextContent('In · 1 life left');
    expect(screen.getByTestId('survivor-leaderboard-week-week-1-entry-1')).toHaveAttribute('data-state', 'lost');
  });

  it('reads "In · 2 lives" for an entry in a two-life contest that has lost no week', async () => {
    const board = survivorLeaderboardFixture();
    const [morgan, chalk] = board.entries;
    primeMocks(survivorLeaderboardFixture({ entries: [{ ...morgan, livesLeft: 2 }, chalk] }));
    renderLeaderboard();

    expect(await screen.findByTestId('survivor-leaderboard-standing-entry-1')).toHaveTextContent('In · 2 lives');
  });
});
