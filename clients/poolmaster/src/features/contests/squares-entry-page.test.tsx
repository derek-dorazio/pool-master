import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestEntryPage } from './contest-entry-page';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import {
  DRAWN_DIGITS,
  squaresBoardFixture,
  squaresContestFixture,
  squaresEntriesFixture,
  squaresLeagueContextFixture,
} from './test/squares-fixtures';

const {
  claimSquaresBoxMock,
  clearSquaresBoxMock,
  drawSquaresNumbersMock,
  getContestMock,
  getLeagueMock,
  getSquaresBoardMock,
  listContestEntriesMock,
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
    listContestEntriesMock: vi.fn(),
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
  listContestEntries: listContestEntriesMock,
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
  role = 'MEMBER' as 'MEMBER' | 'COMMISSIONER',
} = {}) {
  getContestMock.mockResolvedValue({ data: { contest } });
  getSquaresBoardMock.mockResolvedValue({ data: board });
  listContestEntriesMock.mockResolvedValue({ data: squaresEntriesFixture() });
  getLeagueMock.mockResolvedValue({ data: squaresLeagueContextFixture(role) });
}

const box = (rowIndex: number, columnIndex: number) => screen.getByTestId(`squares-box-${rowIndex}-${columnIndex}`);

describe('Squares contest entry page', () => {
  afterEach(() => {
    for (const mock of [
      claimSquaresBoxMock, clearSquaresBoxMock, drawSquaresNumbersMock, getContestMock,
      getLeagueMock, getSquaresBoardMock, listContestEntriesMock,
    ]) {
      mock.mockReset();
    }
  });

  it('shows the grid with each claimed box under its entry\'s name, the viewer\'s own highlighted, the team names on the edges, no digits before the draw, and the viewer\'s claimed count', async () => {
    primeMocks();
    renderPage('/league/BIGDAWGS/contests/contest-1/entries/entry-1');

    await screen.findByTestId('squares-grid');
    expect(box(0, 0)).toHaveTextContent('Morgan’s Madness');
    expect(box(0, 0)).toHaveAttribute('data-mine', 'true');
    expect(box(1, 1)).toHaveTextContent('Derek’s Great Golf Guys');
    expect(box(1, 1)).not.toHaveAttribute('data-mine');
    expect(screen.getByTestId('squares-home-team')).toHaveTextContent('Eagles');
    expect(screen.getByTestId('squares-away-team')).toHaveTextContent('Chiefs');
    expect(screen.getByTestId('squares-row-digit-0')).toHaveTextContent('');
    expect(screen.getByTestId('squares-claimed-count')).toHaveTextContent('1 of 2 boxes claimed');
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

    await waitFor(() => expect(box(4, 7)).toHaveTextContent('Morgan’s Madness'));
    expect(claimSquaresBoxMock).toHaveBeenCalledWith(expect.objectContaining({
      path: { contestId: 'contest-1', rowIndex: '4', columnIndex: '7' },
      body: { contestEntryId: 'entry-1' },
    }));
    expect(screen.getByTestId('squares-claimed-count')).toHaveTextContent('2 of 2 boxes claimed');
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
    expect(screen.getByTestId('squares-claimed-count')).toHaveTextContent('Derek’s Great Golf Guys: 1 of 2 boxes claimed');
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
    expect(screen.getByTestId('squares-claimed-count')).toHaveTextContent('Derek’s Great Golf Guys: 1 of 2 boxes claimed');
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
  });
});

describe('Squares contest leaderboard', () => {
  afterEach(() => {
    for (const mock of [getContestMock, getLeagueMock, getSquaresBoardMock, listContestEntriesMock]) {
      mock.mockReset();
    }
  });

  it('lists Q1, Halftime, Q3 and Final with each winner or No winner, outlines the winning boxes, and places the entries once Final', async () => {
    primeMocks({
      contest: squaresContestFixture({ status: 'COMPLETED' }),
      board: squaresBoardFixture({
        contestStatus: 'COMPLETED',
        claimsOpen: false,
        drawOpen: false,
        digits: DRAWN_DIGITS,
        winners: [
          { periodNumber: 1, homeScore: 3, awayScore: 0, rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
          { periodNumber: 2, homeScore: 10, awayScore: 1, rowIndex: 1, columnIndex: 1, contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys' },
          { periodNumber: 3, homeScore: 17, awayScore: 7, rowIndex: 7, columnIndex: 9, contestEntryId: null, entryName: null },
          { periodNumber: 4, homeScore: 23, awayScore: 10, rowIndex: 0, columnIndex: 0, contestEntryId: 'entry-1', entryName: 'Morgan’s Madness' },
        ],
        entries: [
          { contestEntryId: 'entry-1', entryName: 'Morgan’s Madness', boxCount: 1, periodsWon: 2, displayPosition: '1' },
          { contestEntryId: 'entry-2', entryName: 'Derek’s Great Golf Guys', boxCount: 1, periodsWon: 1, displayPosition: '2' },
        ],
      }),
    });
    renderPage('/league/BIGDAWGS/contests/contest-1/leaderboard');

    const winners = await screen.findByTestId('squares-winners');
    expect(within(winners).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Q1Morgan’s MadnessChiefs 0, Eagles 3',
      'HalftimeDerek’s Great Golf GuysChiefs 1, Eagles 10',
      'Q3No winnerChiefs 7, Eagles 17',
      'FinalMorgan’s MadnessChiefs 10, Eagles 23',
    ]);
    expect(box(0, 0)).toHaveAttribute('data-winner', 'true');
    expect(box(7, 9)).toHaveAttribute('data-winner', 'true');
    expect(box(5, 5)).not.toHaveAttribute('data-winner');
    expect(screen.getByTestId('squares-standing-place-entry-1')).toHaveTextContent('1');
    expect(screen.getByTestId('squares-standing-won-entry-1')).toHaveTextContent('2');
    expect(screen.getByTestId('contest-leaderboard-settled-note')).toBeInTheDocument();
  });
});
