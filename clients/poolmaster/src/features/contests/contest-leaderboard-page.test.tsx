import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
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
        displayPosition: '1',
        status: 'IN_PROGRESS' as const,
        asOf: '2026-04-11T18:00:00.000Z',
        currentRound: 2,
        golf: {
          eventScoreToPar: overrides.eventScoreToPar,
          eventStrokes: 140,
          currentRoundThru: 9,
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

function primeMocks(opts?: {
  contestStatus?: 'ACTIVE' | 'COMPLETED' | 'LOCKED';
  leaderboard?: Record<string, unknown>;
  leaderboardError?: { code: string; message: string };
}) {
  getContestMock.mockResolvedValue({
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status: opts?.contestStatus ?? 'ACTIVE',
        contestType: 'ROSTER',
        selectionType: 'TIERED',
        scoringEngine: 'STROKE_PLAY',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: 1,
        endsAt: '2026-04-14T23:00:00.000Z',
      },
    },
  });

  if (opts?.leaderboardError) {
    getGolfContestLeaderboardMock.mockResolvedValue({
      error: { error: opts.leaderboardError },
      response: { status: 400 },
    });
    return;
  }

  getGolfContestLeaderboardMock.mockResolvedValue({
    data: opts?.leaderboard ?? {
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
        golf: { totalScoreToPar: -5 },
        picks: [
          {
            pickId: 'pick-1',
            sportEventParticipantId: 'sep-1',
            pickedAt: '2026-04-01T00:00:00.000Z',
            slot: 1,
            isCounting: true,
            isDropped: false,
          },
          {
            pickId: 'pick-2',
            sportEventParticipantId: 'sep-2',
            pickedAt: '2026-04-01T00:00:00.000Z',
            slot: 2,
            isCounting: false,
            isDropped: true,
          },
        ],
      }],
      asOf: '2026-04-11T18:00:00.000Z',
    },
  });
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
    expect(screen.getByText('Total')).toBeInTheDocument();
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

  it('links back to the contest board it was opened from', async () => {
    primeMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-back')).toHaveAttribute(
      'href',
      '/league/BIGDAWGS/contests/contest-1',
    );
  });
});
