import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import * as contestLeaderboard from './contest-leaderboard';

const { getContestMock, getGolfContestLeaderboardMock, mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    getContestMock: vi.fn(),
    getGolfContestLeaderboardMock: vi.fn(),
    mockLogger: logger,
  };
});

bindApiMocks({
  getContest: getContestMock,
  getGolfContestLeaderboard: getGolfContestLeaderboardMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderLeaderboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1/leaderboard' }]}
      >
        <Routes>
          <Route
            element={<ContestLeaderboardPage />}
            path="/league/:leagueCode/contests/:contestId/leaderboard"
          />
          <Route element={<div data-testid="contest-board" />} path="/league/:leagueCode/contests/:contestId" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function participant(overrides: {
  id: string;
  name: string;
  eventScoreToPar?: number | null;
  standingStatus?: 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETE' | 'WITHDRAWN' | 'ELIMINATED';
  displayPosition?: string;
  currentRoundThru?: number | null;
  rounds?: Array<{
    roundNumber: number;
    status: string;
    strokes?: number;
    scoreToPar?: number;
  }>;
}) {
  return {
    id: overrides.id,
    sportEventId: 'event-1',
    participantId: `participant-${overrides.id}`,
    isActive: true,
    inactiveReason: null,
    // Present on the event's own field rows and deliberately never rendered here.
    ranking: 1,
    oddsToWin: 750,
    seedNumber: 1,
    participant: {
      id: `participant-${overrides.id}`,
      sportId: 'sport-golf',
      name: overrides.name,
      participantType: 'INDIVIDUAL' as const,
      status: 'ACTIVE' as const,
      injuryStatus: { status: 'HEALTHY' as const },
      externalIds: {},
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    },
    valuation: {
      id: `valuation-${overrides.id}`,
      sportEventTierId: 'tier-1',
      tierOrderIndex: 0,
      tierAssignedSource: 'MANUAL' as const,
      price: 9500,
      priceAssignedSource: 'MANUAL' as const,
    },
    standing: overrides.eventScoreToPar === undefined || overrides.eventScoreToPar === null
      ? null
      : {
        id: `standing-${overrides.id}`,
        position: 1,
        displayPosition: overrides.displayPosition ?? '1',
        status: overrides.standingStatus ?? 'IN_PROGRESS',
        asOf: '2026-04-11T18:00:00.000Z',
        currentRound: 2,
        golf: {
          eventScoreToPar: overrides.eventScoreToPar,
          eventStrokes: 140,
          currentRoundThru: overrides.currentRoundThru === undefined ? 9 : overrides.currentRoundThru,
        },
      },
    rounds: (overrides.rounds ?? []).map((round) => ({
      id: `round-${overrides.id}-${round.roundNumber}`,
      sportEventRoundId: `event-round-${round.roundNumber}`,
      roundNumber: round.roundNumber,
      status: round.status,
      completedAt: null,
      golf: round.strokes === undefined || round.scoreToPar === undefined
        ? null
        : { strokes: round.strokes, scoreToPar: round.scoreToPar, thru: 18 },
    })),
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

type ContestStatusFixture = 'OPEN' | 'ACTIVE' | 'COMPLETED';

function contestResponse(status: ContestStatusFixture) {
  return {
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status,
        contestType: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: 1,
        endsAt: '2026-04-14T23:00:00.000Z',
      },
    },
  };
}

/** The leaderboard read, with the entry's total as a parameter so two reads can differ. */
function leaderboardResponse(entryTotalScoreToPar = -5) {
  return {
    data: {
      contestId: 'contest-1',
      sportEventId: 'event-1',
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N_GOLFERS', count: 1 },
      participants: [
        participant({
          id: 'sep-1',
          name: 'Rory McIlroy',
          eventScoreToPar: -5,
          rounds: [
            { roundNumber: 1, status: 'COMPLETED', strokes: 68, scoreToPar: -3 },
            { roundNumber: 2, status: 'IN_PROGRESS', strokes: 34, scoreToPar: -2 },
          ],
        }),
        participant({
          id: 'sep-2',
          name: 'Scottie Scheffler',
          eventScoreToPar: 1,
          rounds: [{ roundNumber: 1, status: 'COMPLETED', strokes: 72, scoreToPar: 1 }],
        }),
      ],
      entries: [{
        entryId: 'entry-1',
        entryName: 'Birdie Hunters Entry 1',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Birdie Hunters',
        status: 'ACTIVE',
        position: 1,
        displayPosition: 'T1',
        countingPickLimit: 1,
        scoredPickCount: 2,
        golf: { totalScoreToPar: entryTotalScoreToPar },
        picks: [
          {
            pickId: 'pick-1',
            sportEventParticipantId: 'sep-1',
            pickedAt: '2026-04-01T00:00:00.000Z',
            slot: 1,
            isCounting: true,
            isDropped: false,
            golf: { scoreToPar: -5, unplayedRoundNumbers: [] as number[] },
          },
          {
            pickId: 'pick-2',
            sportEventParticipantId: 'sep-2',
            pickedAt: '2026-04-01T00:00:00.000Z',
            slot: 2,
            isCounting: false,
            isDropped: true,
            golf: { scoreToPar: 1, unplayedRoundNumbers: [] as number[] },
          },
        ],
      }],
      asOf: '2026-04-11T18:00:00.000Z',
    },
  };
}

type GolferFixture = Parameters<typeof participant>[0];

/** One entry picking every golfer given, all counting, so each golfer gets a row. */
function leaderboardWithGolfers(golfers: GolferFixture[]) {
  const base = leaderboardResponse().data;
  return {
    ...base,
    participants: golfers.map((golfer) => participant(golfer)),
    entries: [{
      ...base.entries[0],
      countingPickLimit: golfers.length,
      scoredPickCount: golfers.length,
      picks: golfers.map((golfer, index) => ({
        pickId: `pick-${index + 1}`,
        sportEventParticipantId: golfer.id,
        pickedAt: '2026-04-01T00:00:00.000Z',
        slot: index + 1,
        isCounting: true,
        isDropped: false,
        golf: { scoreToPar: golfer.eventScoreToPar ?? null, unplayedRoundNumbers: [] as number[] },
      })),
    }],
  };
}

/** The default read plus a second entry, so toggling one can be told apart from toggling all. */
function leaderboardWithTwoEntries() {
  const base = leaderboardResponse().data;
  return {
    ...base,
    entries: [
      base.entries[0],
      {
        ...base.entries[0],
        entryId: 'entry-2',
        entryName: 'Eagle Eyes Entry 1',
        entryNumber: 1,
        squadId: 'squad-2',
        squadName: 'Eagle Eyes',
        picks: [{ ...base.entries[0].picks[0], pickId: 'pick-3' }],
      },
    ],
  };
}

function primeMocks(opts?: {
  contestStatus?: ContestStatusFixture;
  leaderboard?: Record<string, unknown>;
  leaderboardError?: { code: string; message: string };
}) {
  getContestMock.mockReset();
  getGolfContestLeaderboardMock.mockReset();
  getContestMock.mockResolvedValue(contestResponse(opts?.contestStatus ?? 'ACTIVE'));

  if (opts?.leaderboardError) {
    getGolfContestLeaderboardMock.mockResolvedValue({
      error: { error: opts.leaderboardError },
      response: { status: 400 },
    });
    return;
  }

  getGolfContestLeaderboardMock.mockResolvedValue(
    opts?.leaderboard ? { data: opts.leaderboard } : leaderboardResponse(),
  );
}

describe('ContestLeaderboardPage', () => {
  it('renders each entry\'s standing with a row per golfer, a total and one cell per round', async () => {
    primeMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-position-entry-1')).toHaveTextContent('T1');
    expect(screen.getByTestId('contest-leaderboard-total-entry-1')).toHaveTextContent('-5');

    const counting = screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(counting).toHaveTextContent('Rory McIlroy');
    // The completed round shows strokes, the round still being played shows to par.
    expect(counting).toHaveTextContent('68');
    expect(counting).toHaveTextContent('-2');

    expect(screen.getByText('R1')).toBeInTheDocument();
    expect(screen.getByText('R2')).toBeInTheDocument();
    expect(screen.getByText('Tot')).toBeInTheDocument();
  });

  it('heads the golfer columns POS, GOLFER, TOT, THR, then one per round, in that order', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    expect(screen.getByTestId('contest-leaderboard-column-headers')).toHaveTextContent('PosGolferTotThrR1R2');
  });

  it('shows each golfer\'s own tournament position under POS, apart from the entry\'s position', async () => {
    primeMocks({
      leaderboard: leaderboardWithGolfers([
        { id: 'sep-1', name: 'Rory McIlroy', eventScoreToPar: -5, displayPosition: 'T4' },
      ]),
    });

    renderLeaderboard();

    const row = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(row).toHaveTextContent(/^T4Rory McIlroy/);
    expect(screen.getByTestId('contest-leaderboard-position-entry-1')).toHaveTextContent('T1');
  });

  it('shows THR as the hole number mid-round, F when done, CUT when eliminated, WD when withdrawn and a dash before tee-off', async () => {
    primeMocks({
      leaderboard: leaderboardWithGolfers([
        { id: 'sep-1', name: 'Mid Round', eventScoreToPar: -2, currentRoundThru: 12, rounds: [{ roundNumber: 2, status: 'IN_PROGRESS', strokes: 40, scoreToPar: -2 }] },
        { id: 'sep-2', name: 'Finished', eventScoreToPar: -1, currentRoundThru: 18, rounds: [{ roundNumber: 2, status: 'COMPLETED', strokes: 71, scoreToPar: -1 }] },
        { id: 'sep-3', name: 'Missed Cut', eventScoreToPar: 6, standingStatus: 'ELIMINATED' },
        { id: 'sep-4', name: 'Withdrew', eventScoreToPar: 3, standingStatus: 'WITHDRAWN', currentRoundThru: 7 },
        { id: 'sep-5', name: 'Not Started', eventScoreToPar: 0, standingStatus: 'ACTIVE', currentRoundThru: null, rounds: [{ roundNumber: 2, status: 'PENDING' }] },
      ]),
    });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-thru-entry-1-pick-1');
    const thruCells = [1, 2, 3, 4, 5].map(
      (n) => screen.getByTestId(`contest-leaderboard-pick-thru-entry-1-pick-${n}`).textContent,
    );
    expect(thruCells).toEqual(['12', 'F', 'CUT', 'WD', '—']);
  });

  it('hides an entry\'s golfer rows when its bar is clicked and shows them again on a second click', async () => {
    primeMocks();

    renderLeaderboard();

    const toggle = await screen.findByTestId('contest-leaderboard-entry-toggle-entry-1');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    // The bar itself stays: position, name and total are still readable collapsed.
    expect(screen.getByTestId('contest-leaderboard-total-entry-1')).toHaveTextContent('-5');

    fireEvent.click(toggle);
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1')).toBeInTheDocument();
  });

  it('collapses every entry with Hide Details, expands them with Show Details, and still lets one bar toggle afterwards', async () => {
    primeMocks({ leaderboard: leaderboardWithTwoEntries() });

    renderLeaderboard();

    const toggleAll = await screen.findByTestId('contest-leaderboard-toggle-all');
    expect(toggleAll).toHaveTextContent('Hide Details');

    fireEvent.click(toggleAll);
    expect(toggleAll).toHaveTextContent('Show Details');
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-2-pick-3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-leaderboard-entry-toggle-entry-2'));
    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-pick-3')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    // Not every entry is collapsed any more, so the toolbar offers to hide them all again.
    expect(toggleAll).toHaveTextContent('Hide Details');

    fireEvent.click(toggleAll);
    fireEvent.click(toggleAll);
    expect(toggleAll).toHaveTextContent('Hide Details');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-pick-3')).toBeInTheDocument();
  });

  it('keeps a collapsed entry collapsed across a live poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      renderLeaderboard();
      fireEvent.click(await screen.findByTestId('contest-leaderboard-entry-toggle-entry-1'));
      const callsBefore = getGolfContestLeaderboardMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getGolfContestLeaderboardMock.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a cut golfer\'s unplayed rounds as 80 in italics, their contest total, and a note explaining the 80s', async () => {
    const leaderboard = leaderboardWithGolfers([
      {
        id: 'sep-1',
        name: 'Cut Golfer',
        eventScoreToPar: 2,
        standingStatus: 'ELIMINATED',
        rounds: [
          { roundNumber: 1, status: 'COMPLETED', strokes: 72, scoreToPar: 0 },
          { roundNumber: 2, status: 'MISSED_CUT', strokes: 74, scoreToPar: 2 },
        ],
      },
    ]);
    leaderboard.entries[0].picks[0].golf = { scoreToPar: 18, unplayedRoundNumbers: [3, 4] };
    primeMocks({ leaderboard });

    renderLeaderboard();

    const row = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(row).toHaveTextContent('+18');
    const roundThree = screen.getByTestId('contest-leaderboard-pick-round-entry-1-pick-1-3');
    expect(roundThree).toHaveTextContent('80');
    expect(roundThree).toHaveClass('italic');
    expect(roundThree).toHaveAccessibleName('Round 3 not played, counts as 80 strokes');
    expect(screen.getByTestId('contest-leaderboard-pick-round-entry-1-pick-1-2')).not.toHaveClass('italic');
    expect(screen.getByTestId('contest-leaderboard-unplayed-note')).toHaveTextContent('count as 80 strokes');
  });

  it('shows no unplayed-rounds note when every golfer played their rounds', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(screen.queryByTestId('contest-leaderboard-unplayed-note')).not.toBeInTheDocument();
  });

  it('strikes through a dropped pick and leaves a counting pick unstruck', async () => {
    primeMocks();

    renderLeaderboard();

    const dropped = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-2');
    expect(within(dropped).getByText('Scottie Scheffler')).toHaveClass('line-through');

    const counting = screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(within(counting).getByText('Rory McIlroy')).not.toHaveClass('line-through');
    expect(within(counting).getByText('-5')).not.toHaveClass('line-through');
  });

  it('never renders entry-selection metadata, even though the payload carries it', async () => {
    // Tier, price, ranking, odds and seed are all present on the mocked response. Their
    // absence here is what keeps this page format-agnostic (plan 126 §2).
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    const board = screen.getByTestId('contest-leaderboard');
    for (const selectionValue of ['9500', '750', 'tier-1', 'Tier', 'Odds', 'Price', 'Seed']) {
      expect(board).not.toHaveTextContent(selectionValue);
    }
  });

  it('shows the current-round cue derived from the response it already fetched', async () => {
    primeMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-round-cue'))
      .toHaveTextContent('Round 2 — In Progress');
  });

  it('derives the whole view through the shared module rather than shaping it inline', async () => {
    // The cue, the round columns and the pick-to-field join are covered once in
    // contest-leaderboard.test.ts. This only proves the page goes through them.
    primeMocks();
    const buildLeaderboardView = vi.spyOn(contestLeaderboard, 'buildLeaderboardView');

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    expect(buildLeaderboardView).toHaveBeenCalledWith(
      expect.objectContaining({ contestId: 'contest-1', scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' }),
    );
    buildLeaderboardView.mockRestore();
  });

  it('omits the round cue before any round is scored', async () => {
    primeMocks({
      leaderboard: {
        contestId: 'contest-1',
        sportEventId: 'event-1',
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        countingRule: { type: 'BEST_N_GOLFERS', count: 1 },
        participants: [participant({
          id: 'sep-1',
          name: 'Rory McIlroy',
          rounds: [{ roundNumber: 1, status: 'PENDING' }],
        })],
        entries: [],
        asOf: null,
      },
    });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-entries');
    expect(screen.queryByTestId('contest-leaderboard-round-cue')).not.toBeInTheDocument();
  });

  it('says the contest has no scored entries rather than rendering an empty table', async () => {
    primeMocks({
      leaderboard: {
        contestId: 'contest-1',
        sportEventId: 'event-1',
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        countingRule: { type: 'BEST_N_GOLFERS', count: 1 },
        participants: [],
        entries: [],
        asOf: null,
      },
    });

    renderLeaderboard();

    expect(await screen.findByText('No entries have been scored in this contest yet.'))
      .toBeInTheDocument();
  });

  it('explains that picks are not revealed yet instead of showing a bare failure', async () => {
    primeMocks({
      leaderboardError: {
        code: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN',
        message: 'Picks are hidden.',
      },
    });

    renderLeaderboard();

    expect(await screen.findByText(/Scores appear once picks are revealed/)).toBeInTheDocument();
  });

  it('explains a league-membership refusal in the viewer\'s terms', async () => {
    primeMocks({
      leaderboardError: {
        code: 'LEAGUE_MEMBERSHIP_REQUIRED',
        message: 'Active league membership required.',
      },
    });

    renderLeaderboard();

    expect(await screen.findByText(/Only members of this league/)).toBeInTheDocument();
  });

  it('notes the frozen result on a settled contest, where it can disagree with live scores', async () => {
    primeMocks({ contestStatus: 'COMPLETED' });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-settled-note')).toHaveTextContent(
      'Entry standings are frozen at settlement',
    );
  });

  it('labels a live contest "Live" in the live colour beside its name', async () => {
    primeMocks({ contestStatus: 'ACTIVE' });

    renderLeaderboard();

    await screen.findByRole('heading', { name: 'Masters Pick 6' });
    expect(screen.getByText('Live')).toHaveClass('shadow-[var(--shadow-red-pulse)]');
    expect(screen.queryByText('ACTIVE')).not.toBeInTheDocument();
  });

  it('labels a settled contest "Final" in its own final colour beside its name', async () => {
    primeMocks({ contestStatus: 'COMPLETED' });

    renderLeaderboard();

    await screen.findByRole('heading', { name: 'Masters Pick 6' });
    expect(screen.getByText('Final')).toHaveClass('bg-[var(--status-final-surface)]');
  });

  it('does not note a frozen result while the contest is live', async () => {
    primeMocks({ contestStatus: 'ACTIVE' });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();
  });

  it('refetches a live contest on the shared 30-second cadence, and a settled one never', async () => {
    // #112 — the same predicate and the same interval the contest board polls entries on.
    // `shouldPollContestEntries` is covered in contest-status.test.ts; this proves the wiring.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      const { unmount } = renderLeaderboard();
      await screen.findByTestId('contest-leaderboard-position-entry-1');
      const liveCallsBefore = getGolfContestLeaderboardMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getGolfContestLeaderboardMock.mock.calls.length).toBeGreaterThan(liveCallsBefore);
      unmount();

      primeMocks({ contestStatus: 'COMPLETED' });
      getGolfContestLeaderboardMock.mockClear();
      renderLeaderboard();
      await screen.findByTestId('contest-leaderboard-position-entry-1');
      const settledCallsBefore = getGolfContestLeaderboardMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getGolfContestLeaderboardMock.mock.calls.length).toBe(settledCallsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts polling the leaderboard without a reload when an open contest goes live', async () => {
    // #362 — the contest read itself refreshes while the contest is not terminal, so a page
    // opened before play notices the event start and begins the live poll on its own.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      getContestMock.mockResolvedValueOnce(contestResponse('OPEN'));
      renderLeaderboard();
      await screen.findByText('Birdie Hunters Entry 1');
      const callsWhileOpen = getGolfContestLeaderboardMock.mock.calls.length;

      // The contest read that sees ACTIVE reads the leaderboard straight away, not one interval on.
      await vi.advanceTimersByTimeAsync(30_000);
      const callsOnceLive = getGolfContestLeaderboardMock.mock.calls.length;
      expect(callsOnceLive).toBeGreaterThan(callsWhileOpen);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getGolfContestLeaderboardMock.mock.calls.length).toBeGreaterThan(callsOnceLive);
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the picks-hidden message with the live leaderboard without a reload when play starts', async () => {
    // #362 — a page opened while the contest is still open is refused by the leaderboard read.
    // Once the contest read sees it go live, the leaderboard poll retries and the entries render.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      getContestMock.mockResolvedValueOnce(contestResponse('OPEN'));
      getGolfContestLeaderboardMock.mockResolvedValueOnce({
        error: {
          error: { code: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' },
        },
        response: { status: 400 },
      });
      renderLeaderboard();
      expect(await screen.findByText(/Scores appear once picks are revealed/)).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(await screen.findByText('Birdie Hunters Entry 1')).toBeInTheDocument();
      expect(screen.queryByText(/Scores appear once picks are revealed/)).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows the settled note and stops polling without a reload when a live contest settles', async () => {
    // #362 — the page left open through settlement picks up COMPLETED and freezes.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'COMPLETED' });
      getContestMock.mockResolvedValueOnce(contestResponse('ACTIVE'));
      renderLeaderboard();
      await screen.findByText('Birdie Hunters Entry 1');
      expect(screen.queryByText(/Entry standings are frozen at settlement/)).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(await screen.findByText(/Entry standings are frozen at settlement/)).toBeInTheDocument();

      const leaderboardCallsOnceSettled = getGolfContestLeaderboardMock.mock.calls.length;
      const contestCallsOnceSettled = getContestMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(getGolfContestLeaderboardMock.mock.calls.length).toBe(leaderboardCallsOnceSettled);
      expect(getContestMock.mock.calls.length).toBe(contestCallsOnceSettled);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the final standings once at settlement, even when the last scores land between polls', async () => {
    // #362 review — the contest and leaderboard polls run on their own clocks. The final round
    // lands, and the contest settles, after one leaderboard poll and before the next contest read.
    // Once that read sees COMPLETED the leaderboard poll stops, so the page has to read the
    // leaderboard once more or the settled note sits over standings from before the last round.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      const settlesAt = Date.now() + 45_000;
      getContestMock.mockImplementation(() =>
        Promise.resolve(contestResponse(Date.now() >= settlesAt ? 'COMPLETED' : 'ACTIVE')));
      getGolfContestLeaderboardMock.mockImplementation(() =>
        Promise.resolve(leaderboardResponse(Date.now() >= settlesAt ? -12 : -4)));
      renderLeaderboard();
      expect(await screen.findByText('Birdie Hunters Entry 1')).toBeInTheDocument();
      expect(screen.getByText('-4')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(90_000);
      expect(await screen.findByText(/Entry standings are frozen at settlement/)).toBeInTheDocument();
      expect(await screen.findByText('-12')).toBeInTheDocument();
      expect(screen.queryByText('-4')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('links back to the contest board it was opened from', async () => {
    primeMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-back')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
  });

  it('shows a server failure with no refusal code under the generic error, and logs it', async () => {
    getContestMock.mockReset();
    getGolfContestLeaderboardMock.mockReset();
    getContestMock.mockResolvedValue(contestResponse('ACTIVE'));
    getGolfContestLeaderboardMock.mockResolvedValue({ error: undefined, response: { status: 500 } });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-error')).toBeInTheDocument();
    expect(screen.getByText('We couldn\'t load this leaderboard.')).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contestLeaderboard.load.failed' }),
      'Contest leaderboard failed to load',
    );
  });

  it('puts the refusal code in the error\'s test id, so a refusal can be told apart from a failure', async () => {
    primeMocks({ leaderboardError: { code: 'CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-error-CONTEST_GOLF_LEADERBOARD_PICKS_HIDDEN')).toBeInTheDocument();
  });

  it('says the contest could not load when the contest read fails even though the leaderboard loaded', async () => {
    primeMocks();
    getContestMock.mockReset();
    getContestMock.mockResolvedValue({ error: { error: { code: 'CONTEST_NOT_FOUND', message: 'Contest not found' } }, response: { status: 404 } });

    renderLeaderboard();

    expect(await screen.findByText('We couldn\'t load this contest.')).toBeInTheDocument();
  });

  it('shows an entry with no golfer rows as having no picks to show, instead of an empty block', async () => {
    const base = leaderboardResponse().data;
    primeMocks({ leaderboard: { ...base, entries: [{ ...base.entries[0], picks: [], scoredPickCount: 0 }] } });

    renderLeaderboard();

    const entry = await screen.findByTestId('contest-leaderboard-entry-entry-1');
    expect(entry).toHaveTextContent('This entry has no scored picks yet.');
    expect(entry).toHaveTextContent('0 scored');
  });
});
