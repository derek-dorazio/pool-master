import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import {
  DRAWN_DIGITS,
  squaresBoardFixture,
  squaresContestFixture,
  squaresEntryFixture,
  squaresGameFixture,
  squaresLeagueContextFixture,
} from './test/squares-fixtures';

const {
  claimSquaresBoxMock,
  clearSquaresBoxMock,
  drawSquaresNumbersMock,
  getContestMock,
  getLeagueMock,
  getSquaresBoardMock,
  getContestEntryMock,
  mockLogger,
} = vi.hoisted(() => {
  const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn(), child: vi.fn() };
  logger.child.mockImplementation(() => logger);
  return {
    claimSquaresBoxMock: vi.fn(),
    clearSquaresBoxMock: vi.fn(),
    drawSquaresNumbersMock: vi.fn(),
    getContestMock: vi.fn(),
    getLeagueMock: vi.fn(),
    getSquaresBoardMock: vi.fn(),
    getContestEntryMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  claimSquaresBox: claimSquaresBoxMock,
  clearSquaresBox: clearSquaresBoxMock,
  drawSquaresNumbers: drawSquaresNumbersMock,
  getContest: getContestMock,
  getLeague: getLeagueMock,
  getSquaresBoard: getSquaresBoardMock,
  getContestEntry: getContestEntryMock,
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

function renderPage(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<ContestEntryPage />} path="/league/:leagueCode/contests/:contestId/entries/:entryId" />
          <Route element={<ContestLeaderboardPage />} path="/league/:leagueCode/contests/:contestId/leaderboard" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks({
  board = squaresBoardFixture(),
  contest = squaresContestFixture(),
  role = 'MEMBER',
}: {
  board?: ReturnType<typeof squaresBoardFixture>;
  contest?: ReturnType<typeof squaresContestFixture>;
  role?: 'MEMBER' | 'COMMISSIONER';
} = {}) {
  getContestMock.mockResolvedValue({ data: { contest } });
  getSquaresBoardMock.mockResolvedValue({ data: board });
  getContestEntryMock.mockImplementation(({ path }: { path: { entryId: string } }) => Promise.resolve({ data: squaresEntryFixture(path.entryId) }));
  getLeagueMock.mockResolvedValue({ data: squaresLeagueContextFixture(role) });
}

const box = (rowIndex: number, columnIndex: number) => screen.getByTestId(`squares-box-${rowIndex}-${columnIndex}`);
/** What a screen reader reaches for a box: its peek's button once it opens a peek, else the box itself. */
const boxControl = (rowIndex: number, columnIndex: number) => screen.queryByTestId(`squares-box-${rowIndex}-${columnIndex}-peek`) ?? box(rowIndex, columnIndex);

describe('Squares contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      claimSquaresBoxMock, clearSquaresBoxMock, drawSquaresNumbersMock, getContestMock,
      getLeagueMock, getSquaresBoardMock, getContestEntryMock,
    ]) {
      mock.mockReset();
    }
  });

  it('offers the viewer\'s entry\'s name to change on the grid page while entries are open, the contest page having no Rename', async () => {
    primeMocks();
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    expect(await screen.findByTestId('contest-entry-rename-input')).toBeInTheDocument();
  });

  it('shows each claimed box by its entry\'s initials with the full name kept for screen readers, the viewer\'s own marked, the team bands, "?" digits and no tabs before the draw, and a line per entry of the viewer\'s with its count', async () => {
    primeMocks();
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    await screen.findByTestId('squares-grid');
    expect(box(0, 0)).toHaveTextContent('MM');
    expect(boxControl(0, 0)).toHaveAccessibleName(/Morgan’s Madness/);
    expect(box(0, 0)).toHaveAttribute('data-mine', 'true');
    expect(box(1, 1)).toHaveTextContent('DG');
    expect(boxControl(1, 1)).toHaveAccessibleName(/Derek’s Great Golf Guys/);
    expect(box(1, 1)).not.toHaveAttribute('data-mine');
    expect(screen.getByTestId('squares-home-team')).toHaveTextContent('Eagles');
    expect(screen.getByTestId('squares-away-team')).toHaveTextContent('Chiefs');
    expect(screen.getByTestId('squares-row-digit-0')).toHaveTextContent('?');
    expect(screen.getByTestId('squares-column-digit-9')).toHaveTextContent('?');
    expect(screen.queryByTestId('squares-tabs')).not.toBeInTheDocument();
    expect(screen.getByTestId('squares-entry-line-entry-1')).toHaveTextContent('Morgan’s MadnessYours1 of 2 boxes');
    expect(screen.queryByTestId('squares-entry-line-entry-2')).not.toBeInTheDocument();
    expect(screen.queryByTestId('squares-draw')).not.toBeInTheDocument();
    expect(screen.queryByTestId('squares-claim-for')).not.toBeInTheDocument();
  });

  it('claims an empty box for the viewer\'s own entry on a tap and shows the board the server answers with', async () => {
    primeMocks();
    const claimed = squaresBoardFixture({
      boxes: [...squaresBoardFixture().boxes, { rowIndex: 4, columnIndex: 7, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' }],
    });
    claimSquaresBoxMock.mockResolvedValue({ data: claimed });
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    fireEvent.click(await screen.findByTestId('squares-box-4-7'));

    await waitFor(() => expect(box(4, 7)).toHaveTextContent('MM'));
    expect(claimSquaresBoxMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1', rowIndex: '4', columnIndex: '7' },
      body: { contestEntryId: 'entry-1' },
    }));
    expect(screen.getByTestId('squares-entry-line-entry-1-count')).toHaveTextContent('2 of 2 boxes');
  });

  it('clears the viewer\'s own box on a tap, and leaves another entry\'s box and every empty box untappable once the box limit is reached', async () => {
    const full = squaresBoardFixture({
      maxSquaresPerEntry: 1,
    });
    primeMocks({ board: full });
    clearSquaresBoxMock.mockResolvedValue({ data: squaresBoardFixture({ maxSquaresPerEntry: 1, boxes: full.boxes.slice(1) }) });
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    await screen.findByTestId('squares-grid');
    expect(box(1, 1).tagName).not.toBe('BUTTON');
    expect(box(5, 5).tagName).not.toBe('BUTTON');

    fireEvent.click(box(0, 0));

    await waitFor(() => expect(box(0, 0)).toHaveTextContent(''));
    expect(clearSquaresBoxMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1', rowIndex: '0', columnIndex: '0' } }));
  });

  it('says a box someone else claimed first is taken and reads the grid again', async () => {
    primeMocks();
    claimSquaresBoxMock.mockResolvedValue({
      error: { error: { code: 'SQUARES_BOX_TAKEN', message: 'That box is taken.' } },
      response: new Response(null, { status: 409 }),
    });
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    fireEvent.click(await screen.findByTestId('squares-box-2-2'));

    expect(await screen.findByTestId('squares-box-error')).toHaveTextContent('Someone claimed that box first.');
    await waitFor(() => expect(getSquaresBoardMock).toHaveBeenCalledTimes(2));
  });

  it('claims for the entry on screen when a commissioner opens another member\'s entry, until they choose another', async () => {
    primeMocks({ role: 'COMMISSIONER' });
    claimSquaresBoxMock.mockResolvedValue({ data: squaresBoardFixture() });
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-2');

    expect(await screen.findByTestId('squares-claim-for')).toHaveValue('entry-2');
    expect(screen.getByTestId('squares-entry-line-entry-2')).toHaveTextContent('Derek’s Great Golf Guys1 of 2 boxes');
    expect(screen.getByTestId('squares-entry-line-entry-2')).not.toHaveTextContent('Yours');
    fireEvent.click(box(6, 3));
    await waitFor(() => expect(claimSquaresBoxMock).toHaveBeenCalledWith(expect.objectContaining({ body: { contestEntryId: 'entry-2' } })));
  });

  it('lets a commissioner claim a box for another entry they choose, and draw the numbers after a confirm, after which the digits show and no box can be tapped', async () => {
    primeMocks({ role: 'COMMISSIONER' });
    claimSquaresBoxMock.mockResolvedValue({ data: squaresBoardFixture() });
    const drawn = squaresBoardFixture({ claimsOpen: false, drawOpen: false, digits: DRAWN_DIGITS });
    drawSquaresNumbersMock.mockResolvedValue({ data: drawn });
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    fireEvent.change(await screen.findByTestId('squares-claim-for'), { target: { value: 'entry-2' } });
    expect(screen.getByTestId('squares-entry-line-entry-2-count')).toHaveTextContent('1 of 2 boxes');
    fireEvent.click(box(6, 3));
    await waitFor(() => expect(claimSquaresBoxMock).toHaveBeenCalledWith(expect.objectContaining({ body: { contestEntryId: 'entry-2' } })));

    fireEvent.click(screen.getByTestId('squares-draw'));
    // The draw re-reads the contest, and the board under it, which the server then answers drawn.
    getSquaresBoardMock.mockResolvedValue({ data: drawn });
    fireEvent.click(await screen.findByTestId('squares-draw-confirm'));

    await waitFor(() => expect(screen.getByTestId('squares-column-digit-0')).toHaveTextContent('3'));
    expect(screen.getByTestId('squares-row-digit-9')).toHaveTextContent('9');
    expect(drawSquaresNumbersMock).toHaveBeenCalledWith(expect.objectContaining({ path: { contestId: 'contest-1' } }));
    expect(box(5, 5).tagName).not.toBe('BUTTON');
    expect(screen.queryByTestId('squares-draw')).not.toBeInTheDocument();
    expect(screen.queryByTestId('squares-entry-lines')).not.toBeInTheDocument();
  });
});

describe('Squares contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getContestMock, getLeagueMock, getSquaresBoardMock, getContestEntryMock]) {
      mock.mockReset();
    }
  });

  it('opens on the Winners tab once Final, listing Q1, Q2, Q3 and Final with the score, the box, and the winner with its (i), Yours and a tick on the viewer\'s, and tags a box that won twice Q1/Final', async () => {
    primeMocks({
      contest: squaresContestFixture({ status: 'COMPLETED' }),
      board: squaresBoardFixture({
        contestStatus: 'COMPLETED',
        claimsOpen: false,
        drawOpen: false,
        digits: DRAWN_DIGITS,
        game: squaresGameFixture({
          status: 'COMPLETED',
          homeScore: 23,
          awayScore: 10,
          periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 0 }, { periodNumber: 2, homeScore: 10, awayScore: 1 }, { periodNumber: 3, homeScore: 17, awayScore: 7 }],
        }),
        winners: [
          { periodNumber: 1, homeScore: 3, awayScore: 0, rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
          { periodNumber: 2, homeScore: 10, awayScore: 1, rowIndex: 1, columnIndex: 1, contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys' },
          { periodNumber: 3, homeScore: 17, awayScore: 7, rowIndex: 7, columnIndex: 9, contestEntryId: null, entryName: null },
          { periodNumber: 4, homeScore: 23, awayScore: 10, rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
        ],
      }),
    });
    renderPage('/league/BIGDAWGS/contests/contest-1/leaderboard');

    const winners = await screen.findByTestId('squares-winners');
    expect(['squares-winner-1', 'squares-winner-2', 'squares-winner-3', 'squares-winner-4'].map((id) => within(winners).getByTestId(id).textContent)).toEqual([
      'Q1Chiefs 0, Eagles 3Chiefs 0 · Eagles 3Morgan’s MadnessYoursWon',
      'Q2Chiefs 1, Eagles 10Chiefs 1 · Eagles 0Derek’s Great Golf Guys',
      'Q3Chiefs 7, Eagles 17Chiefs 7 · Eagles 7No winner',
      'FinalChiefs 10, Eagles 23Chiefs 0 · Eagles 3Morgan’s MadnessYoursWon',
    ]);
    expect(screen.getByTestId('squares-winner-1-won')).toBeInTheDocument();
    expect(screen.queryByTestId('squares-winner-2-won')).not.toBeInTheDocument();
    // Each winner has its (i) for its team; a box nobody held has none.
    expect(within(screen.getByTestId('squares-winner-1')).getByRole('button', { name: 'About Morgan’s Madness' })).toBeInTheDocument();
    expect(within(screen.getByTestId('squares-winner-3')).queryByRole('button')).not.toBeInTheDocument();
    expect(box(0, 0)).toHaveAttribute('data-winner', 'true');
    expect(box(0, 0)).toHaveTextContent('MMQ1/Final');
    expect(box(7, 9)).toHaveAttribute('data-winner', 'true');
    expect(box(7, 9)).toHaveTextContent('Q3');
    expect(box(5, 5)).not.toHaveAttribute('data-winner');
    expect(screen.queryByTestId('squares-standings-table')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-settled-note')).toBeInTheDocument();
  });

  it('opens on the Score tab while the game is played, with each quarter\'s points and the live one tinted, and marks the box winning now and its row and column', async () => {
    primeMocks({
      contest: squaresContestFixture({ status: 'ACTIVE' }),
      board: squaresBoardFixture({
        contestStatus: 'ACTIVE',
        claimsOpen: false,
        drawOpen: false,
        digits: DRAWN_DIGITS,
        game: squaresGameFixture({
          status: 'IN_PROGRESS',
          homeScore: 10,
          awayScore: 17,
          periodScores: [{ periodNumber: 1, homeScore: 3, awayScore: 7 }, { periodNumber: 2, homeScore: 10, awayScore: 14 }],
        }),
        boxes: [
          { rowIndex: 7, columnIndex: 1, contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys' },
          { rowIndex: 7, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
        ],
        winners: [
          { periodNumber: 1, homeScore: 3, awayScore: 7, rowIndex: 7, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
          { periodNumber: 2, homeScore: 10, awayScore: 14, rowIndex: 4, columnIndex: 1, contestEntryId: null, entryName: null },
        ],
      }),
    });
    renderPage('/league/BIGDAWGS/contests/contest-1/leaderboard');

    expect(await screen.findByTestId('squares-score-table')).toBeInTheDocument();
    expect(screen.queryByTestId('squares-winners')).not.toBeInTheDocument();
    expect(screen.getByTestId('squares-score-away')).toHaveTextContent(/^Chiefs773–17$/);
    expect(screen.getByTestId('squares-score-home')).toHaveTextContent(/^Eagles370–10$/);
    expect(screen.getByTestId('squares-score-head-3')).toHaveAttribute('data-live', 'true');
    expect(screen.getByTestId('squares-score-head-2')).not.toHaveAttribute('data-live');
    expect(box(7, 1)).toHaveAttribute('data-now', 'true');
    expect(box(7, 1)).toHaveTextContent('DGNow');
    expect(boxControl(7, 1)).toHaveAccessibleName(/winning now/);
    expect(box(7, 0)).toHaveTextContent('MMQ1');
    expect(box(7, 0)).not.toHaveAttribute('data-now');
    expect(screen.getByTestId('squares-row-digit-7')).toHaveClass('bg-done/20');
    expect(screen.getByTestId('squares-column-digit-1')).toHaveClass('bg-done/20');
    expect(screen.getByTestId('squares-row-digit-6')).not.toHaveClass('bg-done/20');

    fireEvent.mouseDown(screen.getByTestId('squares-tab-winners'));
    fireEvent.click(screen.getByTestId('squares-tab-winners'));
    expect(await screen.findByTestId('squares-winners')).toHaveTextContent('Q1Chiefs 7, Eagles 3');
  });

  it('shows a box\'s full entry name and its numbers on a tap once the numbers are drawn', async () => {
    primeMocks({
      board: squaresBoardFixture({ claimsOpen: false, drawOpen: false, digits: DRAWN_DIGITS }),
    });
    renderPage('/league/BIGDAWGS/contests/contest-1/leaderboard');

    fireEvent.click(await screen.findByTestId('squares-box-1-1-peek'));
    const callout = await screen.findByTestId('squares-box-1-1-peek-callout');
    expect(callout).toHaveTextContent('Derek’s Great Golf Guys');
    expect(callout).toHaveTextContent('Chiefs 1 · Eagles 0');
  });
});
