import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { eventRoundsResponse, TOURNAMENT_ROUND_SLOTS } from './test/round-slots';
import { homeAwayMatchFixture, type HomeAwayMatchFixture } from './test/match-fixtures';
import { Sport } from '@poolmaster/shared/domain';
import { sportPlay } from '@/test/sport-play';
import { AuthProvider } from '@/features/auth/auth-provider';
import {
  apiSuccess,
  buildCurrentUser,
  buildLeague,
  buildLeagueMembership,
  buildLeagueSquadMember,
  getLeagueByCodeData,
} from '@/features/leagues/test/fixtures';
import { ContestLeaderboardPage } from './contest-leaderboard-page';
import * as contestLeaderboard from './contest-leaderboard';

const {
  getContestMock,
  getCurrentUserMock,
  getContestLeaderboardMock,
  getEventBracketMock,
  getEventMock,
  getLeagueMock,
  listEventRoundsMock,
  mockLogger,
  refreshTokenMock,
} = vi.hoisted(() => {
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
    getCurrentUserMock: vi.fn(),
    getContestLeaderboardMock: vi.fn(),
    getEventBracketMock: vi.fn(),
    getEventMock: vi.fn(),
    getLeagueMock: vi.fn(),
    listEventRoundsMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
  };
});

bindApiMocks({
  getContest: getContestMock,
  getUser: getCurrentUserMock,
  getContestLeaderboard: getContestLeaderboardMock,
  getEvent: getEventMock,
  getEventBracket: getEventBracketMock,
  getLeague: getLeagueMock,
  listEventRounds: listEventRoundsMock,
  refreshToken: refreshTokenMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

/** The page's address and how it last moved, so a test can tell a replace from a push. */
function AddressProbe() {
  const location = useLocation();
  return <div data-testid="address">{`${location.search}|${useNavigationType()}`}</div>;
}

function renderLeaderboard(search = '') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
      <MemoryRouter
        initialEntries={[{ pathname: '/league/BIGDAWGS/contests/contest-1', search }]}
      >
        <Routes>
          <Route
            element={<><ContestLeaderboardPage /><AddressProbe /></>}
            path="/league/:leagueCode/contests/:contestId"
          />
          <Route
            element={<div data-testid="contest-entry-page" />}
            path="/league/:leagueCode/contests/:contestId/entries/:entryId"
          />
        </Routes>
      </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function participant(overrides: {
  id: string;
  name: string;
  eventScoreToPar?: number | null;
  standingStatus?: 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETE' | 'WITHDRAWN' | 'ELIMINATED';
  displayPosition?: string;
  rounds?: Array<{
    roundNumber: number;
    status: 'FINISHED' | 'DID_NOT_FINISH' | 'DISQUALIFIED' | 'DID_NOT_START' | null;
    periodsCompleted?: number | null;
    strokes?: number;
    scoreToPar?: number;
  }>;
}) {
  return {
    id: overrides.id,
    sportEventId: 'event-1',
    participantId: `participant-${overrides.id}`,
    status: 'ACTIVE',
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
        },
      },
    rounds: (overrides.rounds ?? []).map((round) => ({
      id: `round-${overrides.id}-${round.roundNumber}`,
      sportEventRoundId: `event-round-${round.roundNumber}`,
      roundNumber: round.roundNumber,
      status: round.status,
      periodsCompleted: round.periodsCompleted === undefined ? (round.status === null ? null : 18) : round.periodsCompleted,
      completedAt: null,
      golf: round.strokes === undefined || round.scoreToPar === undefined
        ? null
        : { strokes: round.strokes, scoreToPar: round.scoreToPar },
    })),
    affiliatedWithSportLeague: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    updatedAt: '2026-04-01T00:00:00.000Z',
  };
}

type ContestStatusFixture = 'OPEN' | 'ACTIVE' | 'COMPLETED';

function contestResponse(status: ContestStatusFixture, myEntryIds: string[] = []) {
  return {
    data: {
      contest: {
        id: 'contest-1',
        name: 'Masters Pick 6',
        status,
        contestType: 'ROSTER',
        selectionType: 'TIERED',
        leagueId: 'league-1',
        sport: 'GOLF',
        entryCount: 1,
        myEntryIds,
        endsAt: '2026-04-14T23:00:00.000Z',
        sportEvents: [{
          sportEventId: 'event-1',
          name: 'The Masters',
          startDate: '2026-04-09T12:00:00.000Z',
          ...sportPlay(Sport.GOLF),
          status: status === 'OPEN' ? 'SCHEDULED' : status === 'ACTIVE' ? 'IN_PROGRESS' : 'COMPLETED',
        }],
      },
    },
  };
}

/** The leaderboard read, with the entry's total as a parameter so two reads can differ. */
function leaderboardResponse(entryTotalScore = -5) {
  return {
    data: {
      contestId: 'contest-1',
      sportEventId: 'event-1',
      sport: 'GOLF',
      ...sportPlay(Sport.GOLF),
      scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
      countingRule: { type: 'BEST_N', count: 1, pickCount: 6 },
      upsetBonus: false,
      unplayedRoundToPar: 8,
      currentRound: null,
      participants: [
        participant({
          id: 'sep-1',
          name: 'Rory McIlroy',
          eventScoreToPar: -5,
          rounds: [
            { roundNumber: 1, status: 'FINISHED', strokes: 68, scoreToPar: -3 },
            { roundNumber: 2, status: null, strokes: 34, scoreToPar: -2 },
          ],
        }),
        participant({
          id: 'sep-2',
          name: 'Scottie Scheffler',
          eventScoreToPar: 1,
          rounds: [{ roundNumber: 1, status: 'FINISHED', strokes: 72, scoreToPar: 1 }],
        }),
      ],
      entries: [{
        entryId: 'entry-1',
        entryName: 'Birdie Hunters Entry 1',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Birdie Hunters',
        position: 1,
        displayPosition: 'T1',
        countingPickLimit: 1,
        scoredPickCount: 2,
        totalScore: entryTotalScore,
        events: [{ sportEventId: 'event-1', totalScore: entryTotalScore, position: 1, displayPosition: 'T1' }],
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
        entryName: 'Chalk Talk',
        entryNumber: 1,
        squadId: 'squad-2',
        squadName: 'Eagle Eyes',
        picks: [{ ...base.entries[0].picks[0], pickId: 'pick-3' }],
      },
    ],
  };
}

/** `count` single-pick entries, ranked in order, each on its own team (`squad-N`). */
function leaderboardWithEntries(count: number) {
  const base = leaderboardResponse().data;
  return {
    ...base,
    entries: Array.from({ length: count }, (_, index) => ({
      ...base.entries[0],
      entryId: `entry-${index + 1}`,
      entryName: `Team ${index + 1} Entry 1`,
      squadId: `squad-${index + 1}`,
      squadName: `Team ${index + 1}`,
      position: index + 1,
      displayPosition: String(index + 1),
      picks: [{ ...base.entries[0].picks[0], pickId: `pick-${index + 1}` }],
    })),
  };
}

function primeMocks(opts?: {
  contestStatus?: ContestStatusFixture;
  leaderboard?: Record<string, unknown>;
  leaderboardError?: { code: string; message: string };
  /** The viewer's team (Birdie Hunters, which holds entry-1, unless a test says otherwise), and its entries in this contest. */
  mySquadId?: string | null;
  myEntryIds?: string[];
}) {
  getContestMock.mockReset();
  getContestLeaderboardMock.mockReset();
  listEventRoundsMock.mockReset();
  getContestMock.mockResolvedValue(contestResponse(opts?.contestStatus ?? 'ACTIVE', opts?.myEntryIds));
  getCurrentUserMock.mockResolvedValue(apiSuccess({ user: buildCurrentUser() }));
  refreshTokenMock.mockResolvedValue({ data: null });
  const mySquadId = opts?.mySquadId === undefined ? 'squad-1' : opts.mySquadId;
  getLeagueMock.mockResolvedValue(apiSuccess(getLeagueByCodeData(buildLeague(), {
    membership: buildLeagueMembership({ role: 'MEMBER' }),
    squadMembership: mySquadId ? buildLeagueSquadMember({ squadId: mySquadId }) : null,
  })));

  if (opts?.leaderboardError) {
    getContestLeaderboardMock.mockResolvedValue({
      error: { error: opts.leaderboardError },
      response: { status: 400 },
    });
    return;
  }

  getContestLeaderboardMock.mockResolvedValue(
    opts?.leaderboard ? { data: opts.leaderboard } : leaderboardResponse(),
  );
}

describe('ContestLeaderboardPage', () => {
  it('holds a placeholder header with no tab row while the contest loads, since a contest page has no tabs', async () => {
    primeMocks();
    getContestMock.mockReturnValue(new Promise(() => {}));

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-pending-header')).toHaveAttribute('aria-hidden', 'true');
    expect(screen.queryByTestId('contest-leaderboard-pending-header-tabs')).not.toBeInTheDocument();
  });

  it('gives a board without stat lines, such as golf, no Stats switches and no Show all stats', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(screen.queryByTestId('contest-leaderboard-stats-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-toggle-all-stats')).not.toBeInTheDocument();
  });

  function teamPicksBoard() {
    const base = leaderboardResponse().data;
    const teamRow = (id: string, name: string) => ({ ...participant({ id, name }), standing: null, rounds: [] });
    const knockoutPick = (pickId: string, sportEventParticipantId: string, knockout: Record<string, unknown>) => ({
      ...base.entries[0].picks[0], pickId, sportEventParticipantId, golf: null, knockout,
    });
    return {
      ...base,
      sport: 'BASKETBALL',
      ...sportPlay(Sport.BASKETBALL),
      scoringDefinitionId: 'KNOCKOUT_ROUND_POINTS',
      upsetBonus: true,
      unplayedRoundToPar: null,
      currentRound: null,
      participants: [teamRow('sep-1', 'Vermont'), teamRow('sep-2', 'Gonzaga'), teamRow('sep-3', 'Arizona'), teamRow('sep-4', 'Duke')],
      entries: [{
        ...base.entries[0],
        totalScore: 7,
        picks: [
          knockoutPick('pick-1', 'sep-1', { points: 1, wins: 1, upsetBonusPoints: 0, isAlive: false }),
          knockoutPick('pick-2', 'sep-4', { points: 6, wins: 1, upsetBonusPoints: 3, isAlive: true }),
        ],
      }],
    };
  }

  function primeTeamPicksGames() {
    const match = (matchNumber: number, roundNumber: number, homeId: string, awayId: string, result: HomeAwayMatchFixture) => homeAwayMatchFixture({
      id: `match-${String(roundNumber)}-${String(matchNumber)}`, sportEventId: 'event-1', roundNumber, matchNumber,
      home: homeId, away: awayId, isNeutralSite: true, scheduledDate: '2026-03-21T18:00:00.000Z', ...result,
    });
    getEventMock.mockResolvedValue({ data: { event: { id: 'event-1', sport: 'BASKETBALL', sportLeagueId: null, rounds: 6 } } });
    getEventBracketMock.mockResolvedValue({ data: { matches: [
      match(1, 1, 'sep-1', 'sep-2', { status: 'COMPLETED', winnerSide: 'HOME', homeScore: 81, awayScore: 76 }),
      match(1, 2, 'sep-1', 'sep-3', { status: 'COMPLETED', winnerSide: 'AWAY', homeScore: 70, awayScore: 74 }),
      match(2, 1, 'sep-4', 'sep-2', { status: 'COMPLETED', winnerSide: 'HOME', homeScore: 90, awayScore: 60 }),
    ] } });
    // The tournament's rounds are named by their slots.
    listEventRoundsMock.mockResolvedValue(eventRoundsResponse('event-1', TOURNAMENT_ROUND_SLOTS));
  }

  it('shows a team-picks board\'s Status as In or Out with the round it went out in, its upset bonus as +N, and its latest game under its name', async () => {
    primeMocks({ leaderboard: teamPicksBoard() });
    primeTeamPicksGames();

    renderLeaderboard();

    // With no sport league to name them, the rounds take basketball's own names.
    expect(await screen.findByText('Out · Round of 32')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-pick-status-entry-1-pick-2')).toHaveTextContent('In');
    expect(screen.getByTestId('contest-leaderboard-column-headers')).toHaveTextContent('Upset');
    expect(screen.getByTestId('contest-leaderboard-pick-upset-bonus-entry-1-pick-2')).toHaveTextContent('+3');
    expect(screen.getByTestId('contest-leaderboard-pick-upset-bonus-entry-1-pick-1')).toHaveTextContent('—');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-stats')).toHaveTextContent('Round of 32: lost to Arizona 70–\u206074');
  });

  it('shows the loading state, never "Round 2", until a team-picks board\'s round names have loaded', async () => {
    primeMocks({ leaderboard: teamPicksBoard() });
    primeTeamPicksGames();
    let releaseRounds: () => void = () => undefined;
    listEventRoundsMock.mockImplementation(() => new Promise((resolve) => {
      releaseRounds = () => resolve(eventRoundsResponse('event-1', TOURNAMENT_ROUND_SLOTS));
    }));

    renderLeaderboard();

    await waitFor(() => expect(listEventRoundsMock).toHaveBeenCalled());
    expect(screen.getByText('Loading contest leaderboard...')).toBeInTheDocument();
    expect(screen.queryByText(/Round 2/)).not.toBeInTheDocument();

    releaseRounds();

    expect(await screen.findByText('Out · Round of 32')).toBeInTheDocument();
  });

  it('names a team-picks board\'s rounds "Round N" when the event\'s rounds cannot be read, rather than loading for ever', async () => {
    primeMocks({ leaderboard: teamPicksBoard() });
    primeTeamPicksGames();
    listEventRoundsMock.mockResolvedValue({ error: { error: { code: 'INTERNAL_ERROR', message: 'rounds unavailable' } } });

    renderLeaderboard();

    expect(await screen.findByText('Out · Round 2')).toBeInTheDocument();
  });

  /** The team-picks board with a second entry, Rival, holding the same picks. */
  function teamPicksBoardWithRival() {
    const board = teamPicksBoard();
    const [mine] = board.entries;
    const rival = { ...mine, entryId: 'entry-2', entryName: 'Rival', squadId: 'squad-rival', squadName: 'Rival', position: 2, displayPosition: '2', picks: mine.picks.map((pick) => ({ ...pick, pickId: `rival-${pick.pickId}` })) };
    return { ...board, entries: [mine, rival] };
  }

  it('puts one Stats switch on each entry, on for the viewer\'s own, that shows every pick\'s latest game under its name', async () => {
    primeMocks({ leaderboard: teamPicksBoardWithRival() });
    primeTeamPicksGames();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1-stats')).toHaveTextContent('Round of 32: lost to Arizona');
    expect(screen.getByTestId('contest-leaderboard-stats-entry-1')).toBeChecked();

    fireEvent.click(screen.getByTestId('contest-leaderboard-stats-entry-1'));

    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1-stats')).not.toBeInTheDocument();
    // The picks stay listed with their scores: the switch hides the stats, not the entry.
    expect(screen.getByTestId('contest-leaderboard-pick-status-entry-1-pick-2')).toHaveTextContent('In');
  });

  it('opens a closed entry when its Stats switch is turned on, so its stats show', async () => {
    primeMocks({ leaderboard: teamPicksBoardWithRival() });
    primeTeamPicksGames();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1-stats');
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-2-rival-pick-1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-leaderboard-stats-entry-2'));

    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-rival-pick-1-stats')).toHaveTextContent('Round of 32: lost to Arizona');
  });

  it('turns on every opened entry\'s stats from Show all stats, then off again from Hide all stats', async () => {
    primeMocks({ leaderboard: teamPicksBoardWithRival() });
    primeTeamPicksGames();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1-stats');
    fireEvent.click(screen.getByTestId('contest-leaderboard-toggle-all'));
    fireEvent.click(screen.getByTestId('contest-leaderboard-toggle-all-stats'));

    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-stats')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-rival-pick-1-stats')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-toggle-all-stats')).toHaveTextContent('Hide all stats');

    fireEvent.click(screen.getByTestId('contest-leaderboard-toggle-all-stats'));

    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1-stats')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-2-rival-pick-1-stats')).not.toBeInTheDocument();
  });

  it('strikes through a non-counting pick\'s stat line along with its name', async () => {
    const board = teamPicksBoard();
    primeMocks({ leaderboard: { ...board, entries: board.entries.map((entry) => ({ ...entry, picks: entry.picks.map((pick) => ({ ...pick, isCounting: false, isDropped: true })) })) } });
    primeTeamPicksGames();

    renderLeaderboard();

    const statLine = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1-stats');
    // The line sits inside the struck-through name cell, so the strike and slant carry over to it.
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).toContainElement(statLine);
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).toHaveClass('italic', 'line-through');
  });

  it('opens a team\'s Wins to every game it played', async () => {
    primeMocks({ leaderboard: teamPicksBoard() });
    primeTeamPicksGames();

    renderLeaderboard();

    fireEvent.click(await screen.findByTestId('contest-leaderboard-pick-wins-entry-1-pick-1-peek'));

    const callout = screen.getByTestId('contest-leaderboard-pick-wins-entry-1-pick-1-peek-callout');
    expect(callout).toHaveTextContent('First Roundbeat Gonzaga 81–\u206076');
    expect(callout).toHaveTextContent('Round of 32lost to Arizona 70–\u206074');
  });

  it('tints a hovered pick row\'s pinned cells too, over their opaque background', async () => {
    primeMocks();

    renderLeaderboard();

    const row = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    const hoverTint = 'group-hover/pick:[background-image:linear-gradient(var(--table-row-hover-surface),var(--table-row-hover-surface))]';
    expect(row).toHaveClass('group/pick');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-position')).toHaveClass('bg-background', hoverTint);
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).toHaveClass('bg-background', hoverTint);
  });

  it('puts a roster board in the shared section titled Standings, the same frame as every other format', async () => {
    primeMocks();

    renderLeaderboard();

    const section = await screen.findByRole('region', { name: 'Standings' });
    expect(within(section).getByTestId('contest-leaderboard-board')).toBeInTheDocument();
    expect(within(section).getByTestId('contest-leaderboard-search')).toBeInTheDocument();
  });

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

  it('keeps a minimum width for the name column, so a name never squeezes to nothing on a phone', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    const tracks = screen.getByTestId('contest-leaderboard-column-headers').style.gridTemplateColumns.split(' ');
    // Position, name, total, then the family's columns: the name track's minimum is a real width.
    expect(tracks[1]).toMatch(/^minmax\((?!0[,)])[\d.]+(px|rem),/);
  });

  it('lets the board scroll sideways inside its own box, its columns kept at their minimum widths, rather than squeezing them', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    const board = screen.getByTestId('contest-leaderboard-board');
    expect(board).toHaveClass('overflow-x-auto');
    expect(within(board).getByTestId('contest-leaderboard-board-content')).toHaveClass('min-w-min');
    expect(within(board).getByTestId('contest-leaderboard-column-headers')).toBeInTheDocument();
    expect(within(board).getByTestId('contest-leaderboard-entries')).toBeInTheDocument();
  });

  it('keeps each entry\'s bar, with its total and chevron, at the board\'s visible width while the columns scroll', async () => {
    primeMocks();

    renderLeaderboard();

    const toggle = await screen.findByTestId('contest-leaderboard-entry-toggle-entry-1');
    // The board measures its visible width for the parts pinned inside it.
    expect(screen.getByTestId('contest-leaderboard-board')).toHaveClass('[container-type:inline-size]');
    const bar = screen.getByTestId('contest-leaderboard-entry-bar-entry-1');
    expect(within(bar).getByTestId('contest-leaderboard-entry-toggle-entry-1')).toBe(toggle);
    expect(bar).toHaveClass('sticky', 'left-0', 'w-[calc(100cqw-2px)]');
    expect(bar).toHaveTextContent('-5');
  });

  it('pins Pos and the golfer\'s name to the left, in the heads and on every pick row, while the score columns scroll', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-position')).toHaveClass('sticky', 'left-0');
    // The name sits right of Pos by Pos's own width, which the board sets once for its grid too.
    expect(screen.getByTestId('contest-leaderboard-board')).toHaveClass('[--pos-width:36px]');
    expect(screen.getByTestId('contest-leaderboard-column-headers').style.gridTemplateColumns).toMatch(/^minmax\(var\(--pos-width\),/);
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).toHaveClass('sticky', 'left-[calc(var(--pos-width)+24px)]');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).toHaveTextContent('Rory McIlroy');
    const heads = within(screen.getByTestId('contest-leaderboard-column-headers'));
    expect(heads.getByText('Pos')).toHaveClass('sticky', 'left-0');
    expect(heads.getByText('Golfer')).toHaveClass('sticky', 'left-[calc(var(--pos-width)+24px)]');
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

  it('shows THR as the holes the feed reports mid-round, F when the round\'s side status is finished, CUT when eliminated, WD when withdrawn and a dash before tee-off', async () => {
    primeMocks({
      leaderboard: leaderboardWithGolfers([
        { id: 'sep-1', name: 'Mid Round', eventScoreToPar: -2, rounds: [{ roundNumber: 2, status: null, periodsCompleted: 12, strokes: 40, scoreToPar: -2 }] },
        { id: 'sep-2', name: 'Finished', eventScoreToPar: -1, rounds: [{ roundNumber: 2, status: 'FINISHED', periodsCompleted: 18, strokes: 71, scoreToPar: -1 }] },
        { id: 'sep-3', name: 'Missed Cut', eventScoreToPar: 6, standingStatus: 'ELIMINATED' },
        { id: 'sep-4', name: 'Withdrew', eventScoreToPar: 3, standingStatus: 'WITHDRAWN', rounds: [{ roundNumber: 2, status: null, periodsCompleted: 7, strokes: 30, scoreToPar: 3 }] },
        { id: 'sep-5', name: 'Not Started', eventScoreToPar: 0, standingStatus: 'ACTIVE', rounds: [{ roundNumber: 2, status: null, periodsCompleted: null }] },
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

  it('names each entry alone on its bar with an (i) for its team, and opening the (i) leaves the row as it was', async () => {
    primeMocks({ leaderboard: leaderboardWithTwoEntries() });

    renderLeaderboard();

    const bar = await screen.findByTestId('contest-leaderboard-entry-entry-2');
    expect(bar).toHaveTextContent('Chalk Talk');
    expect(bar).not.toHaveTextContent('Eagle Eyes');
    fireEvent.click(within(bar).getByRole('button', { name: 'About Chalk Talk' }));

    expect(screen.getByTestId('contest-leaderboard-entry-toggle-entry-2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('contest-leaderboard-entry-peek-entry-2-callout')).toBeInTheDocument();
  });

  it('opens the viewer\'s own entry and leaves everyone else\'s closed', async () => {
    primeMocks({ leaderboard: leaderboardWithTwoEntries() });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-entry-toggle-entry-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('contest-leaderboard-entry-toggle-entry-2')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-2-pick-3')).not.toBeInTheDocument();
  });

  it('opens every entry with Show all details, closes them with Hide all details, and still lets one bar toggle afterwards', async () => {
    primeMocks({ leaderboard: leaderboardWithTwoEntries() });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    const toggleAll = screen.getByTestId('contest-leaderboard-toggle-all');
    // One of two is open, so the toolbar offers to open them all.
    expect(toggleAll).toHaveTextContent('Show all details');

    fireEvent.click(toggleAll);
    expect(toggleAll).toHaveTextContent('Hide all details');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-pick-3')).toBeInTheDocument();

    fireEvent.click(toggleAll);
    expect(toggleAll).toHaveTextContent('Show all details');
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-2-pick-3')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('contest-leaderboard-entry-toggle-entry-2'));
    expect(screen.getByTestId('contest-leaderboard-pick-entry-2-pick-3')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
  });

  it('keeps a collapsed entry collapsed across a live poll', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      primeMocks({ contestStatus: 'ACTIVE' });
      renderLeaderboard();
      fireEvent.click(await screen.findByTestId('contest-leaderboard-entry-toggle-entry-1'));
      const callsBefore = getContestLeaderboardMock.mock.calls.length;

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getContestLeaderboardMock.mock.calls.length).toBeGreaterThan(callsBefore);
      expect(screen.queryByTestId('contest-leaderboard-pick-entry-1-pick-1')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows a cut golfer\'s unplayed rounds in italics as the contest\'s unplayed-round score against par, their contest total, and a note explaining it', async () => {
    const leaderboard = leaderboardWithGolfers([
      {
        id: 'sep-1',
        name: 'Cut Golfer',
        eventScoreToPar: 2,
        standingStatus: 'ELIMINATED',
        rounds: [
          { roundNumber: 1, status: 'FINISHED', strokes: 72, scoreToPar: 0 },
          { roundNumber: 2, status: 'FINISHED', strokes: 74, scoreToPar: 2 },
        ],
      },
    ]);
    leaderboard.entries[0].picks[0].golf = { scoreToPar: 22, unplayedRoundNumbers: [3, 4] };
    // The contest's own setting, not 80 strokes: each unplayed round reads +10.
    primeMocks({ leaderboard: { ...leaderboard, unplayedRoundToPar: 10 } });

    renderLeaderboard();

    const row = await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(row).toHaveTextContent('+22');
    const roundThree = screen.getByTestId('contest-leaderboard-pick-round-entry-1-pick-1-3');
    expect(roundThree).toHaveTextContent('+10');
    expect(roundThree).toHaveClass('italic');
    expect(roundThree).toHaveAccessibleName('Round 3 not played, counts as +10 against par');
    expect(screen.getByTestId('contest-leaderboard-pick-round-entry-1-pick-1-2')).not.toHaveClass('italic');
    expect(screen.getByTestId('contest-leaderboard-unplayed-note')).toHaveTextContent('count as +10 against par');
  });

  it('shows no unplayed-rounds note when every golfer played their rounds', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(screen.queryByTestId('contest-leaderboard-unplayed-note')).not.toBeInTheDocument();
  });

  it('lists every pick of a best-4-of-6 entry, striking through and italicising the two that do not count, and states the rule once in the header', async () => {
    const golfers = [
      { id: 'sep-1', name: 'Scottie Scheffler', eventScoreToPar: -9 },
      { id: 'sep-2', name: 'Rory McIlroy', eventScoreToPar: -5 },
      { id: 'sep-3', name: 'Ludvig Aberg', eventScoreToPar: -4 },
      { id: 'sep-4', name: 'Viktor Hovland', eventScoreToPar: 3 },
      { id: 'sep-5', name: 'Rickie Fowler', eventScoreToPar: 4 },
      { id: 'sep-6', name: 'Jordan Spieth', eventScoreToPar: 6 },
    ];
    const board = leaderboardWithGolfers(golfers);
    primeMocks({
      leaderboard: {
        ...board,
        countingRule: { type: 'BEST_N', count: 4, pickCount: 6 },
        upsetBonus: false,
        entries: board.entries.map((entry) => ({
          ...entry,
          countingPickLimit: 4,
          picks: entry.picks.map((pick, index) => ({ ...pick, isCounting: index < 4, isDropped: index >= 4 })),
        })),
      },
    });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-6');
    const names = golfers.map((_, index) => screen.getByTestId(`contest-leaderboard-pick-entry-1-pick-${index + 1}-name`));
    expect(names.map((name) => name.classList.contains('line-through') && name.classList.contains('italic')))
      .toEqual([false, false, false, false, true, true]);
    expect(screen.getByTestId('contest-leaderboard-counting-rule')).toHaveTextContent('Best 4 of 6 golfers count');
    expect(screen.getByTestId('contest-leaderboard-entry-entry-1')).not.toHaveTextContent(/count ·|scored/);
  });

  it('takes the rule\'s "of M" from the contest\'s full entry, not from the entries on the board, so short entries cannot shrink it', async () => {
    const golfers = [
      { id: 'sep-1', name: 'Scottie Scheffler', eventScoreToPar: -9 },
      { id: 'sep-2', name: 'Rory McIlroy', eventScoreToPar: -5 },
    ];
    primeMocks({ leaderboard: { ...leaderboardWithGolfers(golfers), countingRule: { type: 'BEST_N', count: 4, pickCount: 6 } } });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-counting-rule')).toHaveTextContent('Best 4 of 6 golfers count');
  });

  it('states no rule when the full entry\'s size is not known yet, rather than guess at it', async () => {
    const golfers = [{ id: 'sep-1', name: 'Scottie Scheffler', eventScoreToPar: -9 }];
    primeMocks({ leaderboard: { ...leaderboardWithGolfers(golfers), countingRule: { type: 'BEST_N', count: 4, pickCount: null } } });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-1');
    expect(screen.queryByTestId('contest-leaderboard-counting-rule')).not.toBeInTheDocument();
  });

  it('strikes through no pick and states no rule when every pick counts', async () => {
    const golfers = [
      { id: 'sep-1', name: 'Scottie Scheffler', eventScoreToPar: -9 },
      { id: 'sep-2', name: 'Rory McIlroy', eventScoreToPar: null },
    ];
    primeMocks({ leaderboard: { ...leaderboardWithGolfers(golfers), countingRule: { type: 'BEST_N', count: 2, pickCount: 2 } } });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-pick-entry-1-pick-2');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-1-name')).not.toHaveClass('line-through');
    expect(screen.getByTestId('contest-leaderboard-pick-entry-1-pick-2-name')).not.toHaveClass('line-through');
    expect(screen.queryByTestId('contest-leaderboard-counting-rule')).not.toBeInTheDocument();
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

  it('shows the current-round cue the response it already fetched names', async () => {
    primeMocks({ leaderboard: { ...leaderboardResponse().data, currentRound: { roundNumber: 2, isComplete: false } } });

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
    // A golf board reads no games, so it passes no games context; the contest's status says whether it is live.
    expect(buildLeaderboardView).toHaveBeenCalledWith(
      expect.objectContaining({ contestId: 'contest-1', scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL' }),
      undefined,
      expect.objectContaining({ isLive: true }),
    );
    buildLeaderboardView.mockRestore();
  });

  it('omits the round cue before any round is scored', async () => {
    primeMocks({
      leaderboard: {
        contestId: 'contest-1',
        sportEventId: 'event-1',
        sport: 'GOLF',
        ...sportPlay(Sport.GOLF),
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        countingRule: { type: 'BEST_N', count: 1, pickCount: 6 },
        upsetBonus: false,
        unplayedRoundToPar: 8,
        currentRound: null,
        participants: [participant({
          id: 'sep-1',
          name: 'Rory McIlroy',
          rounds: [{ roundNumber: 1, status: null }],
        })],
        entries: [],
        asOf: null,
      },
    });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-entries');
    expect(screen.queryByTestId('contest-leaderboard-round-cue')).not.toBeInTheDocument();
  });

  it('says No entries in one line rather than rendering an empty table when nobody entered', async () => {
    primeMocks({
      leaderboard: {
        contestId: 'contest-1',
        sportEventId: 'event-1',
        sport: 'GOLF',
        ...sportPlay(Sport.GOLF),
        scoringDefinitionId: 'GOLF_RELATIVE_TO_PAR_TOTAL',
        countingRule: { type: 'BEST_N', count: 1, pickCount: 6 },
        upsetBonus: false,
        unplayedRoundToPar: 8,
        currentRound: null,
        participants: [],
        entries: [],
        asOf: null,
      },
    });

    renderLeaderboard();

    expect(await screen.findByText('No entries.')).toBeInTheDocument();
  });

  it('explains that picks are not revealed yet instead of showing a bare failure', async () => {
    primeMocks({
      leaderboardError: {
        code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN',
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

    fireEvent.click(await screen.findByTestId('contest-leaderboard-settled-note'));
    expect(await screen.findByTestId('contest-leaderboard-settled-note-card')).toHaveTextContent(
      'Entry standings are frozen at settlement',
    );
  });

  it('says the settled note\'s live scores are the picks\', never a "team" score that could read as a member\'s team', async () => {
    primeMocks({ contestStatus: 'COMPLETED' });

    renderLeaderboard();

    fireEvent.click(await screen.findByTestId('contest-leaderboard-settled-note'));
    const note = await screen.findByTestId('contest-leaderboard-settled-note-card');
    expect(note).toHaveTextContent("each pick's score shows current event data and can differ after a late score correction.");
    expect(note).not.toHaveTextContent(/team/i);
  });

  it('opens a settled contest on its winners banner, the leader named with their total', async () => {
    primeMocks({ contestStatus: 'COMPLETED' });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-winners-winner-names')).toHaveTextContent('Birdie Hunters Entry 1');
  });

  it('shows no winners banner while the contest is live', async () => {
    primeMocks({ contestStatus: 'ACTIVE' });

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-position-entry-1');
    expect(screen.queryByTestId('contest-winners')).not.toBeInTheDocument();
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
      const liveCallsBefore = getContestLeaderboardMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getContestLeaderboardMock.mock.calls.length).toBeGreaterThan(liveCallsBefore);
      unmount();

      primeMocks({ contestStatus: 'COMPLETED' });
      getContestLeaderboardMock.mockClear();
      renderLeaderboard();
      await screen.findByTestId('contest-leaderboard-position-entry-1');
      const settledCallsBefore = getContestLeaderboardMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(getContestLeaderboardMock.mock.calls.length).toBe(settledCallsBefore);
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
      const callsWhileOpen = getContestLeaderboardMock.mock.calls.length;

      // The contest read that sees ACTIVE reads the leaderboard straight away, not one interval on.
      await vi.advanceTimersByTimeAsync(30_000);
      const callsOnceLive = getContestLeaderboardMock.mock.calls.length;
      expect(callsOnceLive).toBeGreaterThan(callsWhileOpen);

      await vi.advanceTimersByTimeAsync(30_000);
      expect(getContestLeaderboardMock.mock.calls.length).toBeGreaterThan(callsOnceLive);
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
      getContestLeaderboardMock.mockResolvedValueOnce({
        error: {
          error: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' },
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
      expect(screen.queryByTestId('contest-leaderboard-settled-note')).not.toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(await screen.findByTestId('contest-leaderboard-settled-note')).toBeInTheDocument();

      const leaderboardCallsOnceSettled = getContestLeaderboardMock.mock.calls.length;
      const contestCallsOnceSettled = getContestMock.mock.calls.length;
      await vi.advanceTimersByTimeAsync(90_000);
      expect(getContestLeaderboardMock.mock.calls.length).toBe(leaderboardCallsOnceSettled);
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
      getContestLeaderboardMock.mockImplementation(() =>
        Promise.resolve(leaderboardResponse(Date.now() >= settlesAt ? -12 : -4)));
      renderLeaderboard();
      expect(await screen.findByText('Birdie Hunters Entry 1')).toBeInTheDocument();
      expect(screen.getByText('-4')).toBeInTheDocument();

      await vi.advanceTimersByTimeAsync(90_000);
      expect(await screen.findByTestId('contest-leaderboard-settled-note')).toBeInTheDocument();
      expect(await screen.findByTestId('contest-leaderboard-total-entry-1')).toHaveTextContent('-12');
      expect(screen.queryByText('-4')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows no Entries / Leaderboard / My entry tabs: the contest page is the leaderboard once live', async () => {
    primeMocks();

    renderLeaderboard();

    await screen.findByTestId('contest-leaderboard-entry-entry-1');
    expect(screen.queryByTestId('contest-menu-leaderboard')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-menu-entries')).not.toBeInTheDocument();
  });

  it('finds an entry by its entry name or its team\'s name, and says so when nothing matches', async () => {
    primeMocks({ leaderboard: leaderboardWithTwoEntries() });

    renderLeaderboard();

    const search = await screen.findByRole('searchbox', { name: 'Find an entry' });
    // "Chalk Talk" belongs to Eagle Eyes, a name the row no longer shows: search still knows it.
    fireEvent.change(search, { target: { value: 'eagle' } });

    expect(screen.getByTestId('contest-leaderboard-entry-entry-2')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-entry-entry-1')).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'chalk' } });
    expect(screen.getByTestId('contest-leaderboard-entry-entry-2')).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'Nobody' } });

    expect(screen.getByTestId('contest-leaderboard-no-match')).toBeInTheDocument();
  });

  it('shows every entry in the server\'s order, with no pages', async () => {
    primeMocks({ leaderboard: leaderboardWithEntries(30) });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-entry-entry-1')).toBeInTheDocument();
    expect(screen.getAllByTestId(/^contest-leaderboard-entry-entry-\d+$/).map((row) => row.getAttribute('data-testid')))
      .toEqual(Array.from({ length: 30 }, (_, index) => `contest-leaderboard-entry-entry-${String(index + 1)}`));
    expect(screen.queryByRole('button', { name: 'Next' })).not.toBeInTheDocument();
  });

  /** Thirty entries, of which the viewer's team (squad-mine) holds those placed 3, 17 and 28. */
  function boardWithMyEntriesAt(places: number[]) {
    const board = leaderboardWithEntries(30);
    return {
      ...board,
      entries: board.entries.map((entry) => (places.includes(entry.position)
        ? { ...entry, squadId: 'squad-mine', squadName: 'My Team', entryName: `My Team Entry ${String(entry.position)}` }
        : entry)),
    };
  }

  it('narrows the board to the viewer\'s entries with My entries on, each at its real place, and writes ?mine=1', async () => {
    primeMocks({ leaderboard: boardWithMyEntriesAt([3, 17, 28]), mySquadId: 'squad-mine' });

    renderLeaderboard();
    // The switch needs the viewer's team, which the league context read brings after the contest.
    fireEvent.click(await screen.findByTestId('contest-leaderboard-my-entries'));

    expect(screen.getByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.getAllByTestId(/^contest-leaderboard-entry-entry-\d+$/).map((row) => row.getAttribute('data-testid')))
      .toEqual(['contest-leaderboard-entry-entry-3', 'contest-leaderboard-entry-entry-17', 'contest-leaderboard-entry-entry-28']);
    expect(screen.getByTestId('contest-leaderboard-position-entry-28')).toHaveTextContent('28');
  });

  it('keeps My entries on across a reload, from ?mine=1 in the address', async () => {
    primeMocks({ leaderboard: boardWithMyEntriesAt([3, 17, 28]), mySquadId: 'squad-mine' });

    renderLeaderboard('?mine=1');

    expect(await screen.findByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.getByTestId('contest-leaderboard-entry-entry-28')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-entry-entry-1')).not.toBeInTheDocument();
  });

  it('searches within the viewer\'s entries while My entries is on, and shows the whole board, theirs marked, once it is off', async () => {
    primeMocks({ leaderboard: boardWithMyEntriesAt([3, 17, 28]), mySquadId: 'squad-mine' });

    renderLeaderboard('?mine=1');
    fireEvent.change(await screen.findByRole('searchbox', { name: 'Find an entry' }), { target: { value: 'Entry 17' } });

    expect(screen.getAllByTestId(/^contest-leaderboard-entry-entry-\d+$/)).toHaveLength(1);
    expect(screen.getByTestId('contest-leaderboard-entry-entry-17')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Find an entry' }), { target: { value: '' } });
    fireEvent.click(screen.getByTestId('contest-leaderboard-my-entries'));

    expect(screen.getByTestId('contest-leaderboard-entry-entry-1')).toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-entry-entry-3')).toHaveTextContent('Yours');
    expect(screen.getAllByTestId(/^contest-leaderboard-entry-entry-\d+$/)).toHaveLength(30);
  });

  it('offers no My entries switch when the viewer has no entry on the leaderboard, and shows the whole board even with ?mine=1', async () => {
    primeMocks({ mySquadId: 'squad-elsewhere' });

    renderLeaderboard('?mine=1');

    await screen.findByTestId('contest-leaderboard-entry-entry-1');
    // The viewer's team comes from the league context; the answer is only meaningful once it has.
    await waitFor(() => expect(getLeagueMock).toHaveBeenCalled());
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByTestId('contest-leaderboard-my-entries')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-entry-entry-1')).toBeInTheDocument();
  });

  it('opens the entry a link names (?entry=), scrolled into view, and drops ?entry= by replace once it is closed', async () => {
    const scrolled: Element[] = [];
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scrollIntoView(this: Element) {
      scrolled.push(this);
    });
    primeMocks({ leaderboard: leaderboardWithEntries(30) });

    renderLeaderboard('?entry=entry-28');

    const toggle = await screen.findByTestId('contest-leaderboard-entry-toggle-entry-28');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(scrolled).toEqual([screen.getByTestId('contest-leaderboard-entry-entry-28')]);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByTestId('address')).toHaveTextContent(/^\|REPLACE$/);
    scroll.mockRestore();
  });

  it('ignores a linked entry the board doesn\'t show, another team\'s under My entries or an unknown id, opening the first entry', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks({ leaderboard: boardWithMyEntriesAt([3, 17, 28]), mySquadId: 'squad-mine' });

    renderLeaderboard('?mine=1&entry=entry-2');

    expect(await screen.findByTestId('contest-leaderboard-my-entries')).toBeChecked();
    expect(screen.queryByTestId('contest-leaderboard-entry-entry-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('contest-leaderboard-entry-toggle-entry-3')).toHaveAttribute('aria-expanded', 'true');
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('ignores an entry id the contest doesn\'t hold, showing every row as it starts', async () => {
    const scroll = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    primeMocks({ leaderboard: leaderboardWithEntries(30) });

    renderLeaderboard('?entry=entry-unknown');

    expect(await screen.findByTestId('contest-leaderboard-entry-toggle-entry-1')).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByTestId('contest-leaderboard-entry-toggle-entry-2')).toHaveAttribute('aria-expanded', 'false');
    expect(scroll).not.toHaveBeenCalled();
    scroll.mockRestore();
  });

  it('shows a server failure with no refusal code under the generic error, and logs it', async () => {
    getContestMock.mockReset();
    getContestLeaderboardMock.mockReset();
    getContestMock.mockResolvedValue(contestResponse('ACTIVE'));
    getContestLeaderboardMock.mockResolvedValue({ error: undefined, response: { status: 500 } });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-error')).toBeInTheDocument();
    expect(screen.getByText('We couldn\'t load this leaderboard.')).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'contestLeaderboard.load.failed' }),
      'Contest leaderboard failed to load',
    );
  });

  it('puts the refusal code in the error\'s test id, so a refusal can be told apart from a failure', async () => {
    primeMocks({ leaderboardError: { code: 'CONTEST_LEADERBOARD_PICKS_HIDDEN', message: 'Picks are hidden.' } });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-error-CONTEST_LEADERBOARD_PICKS_HIDDEN')).toBeInTheDocument();
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
  });
});

describe('ContestLeaderboardPage — a contest of two events', () => {
  const MASTERS = { sportEventId: 'event-1', name: 'The Masters', startDate: '2026-04-09T12:00:00.000Z', status: 'COMPLETED' };
  const PGA = { sportEventId: 'event-2', name: 'PGA Championship', startDate: '2026-05-14T12:00:00.000Z', status: 'IN_PROGRESS' };

  function primeTwoEventMocks({ pgaPosition = 3 }: { pgaPosition?: number } = {}) {
    const base = leaderboardResponse(-3).data;
    primeMocks({
      leaderboard: {
        ...base,
        sportEventId: 'event-2',
        entries: [{
          ...base.entries[0],
          events: [
            { sportEventId: 'event-1', totalScore: -5, position: 1, displayPosition: 'T1' },
            { sportEventId: 'event-2', totalScore: 2, position: pgaPosition, displayPosition: String(pgaPosition) },
          ],
        }],
      },
    });
    const contest = contestResponse('ACTIVE');
    getContestMock.mockResolvedValue({
      data: { contest: { ...contest.data.contest, sportEvents: [MASTERS, PGA] } },
    });
  }

  it('shows each entry\'s place and score in every event it played, by event name, under its contest total', async () => {
    primeTwoEventMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-events-entry-1')).toHaveTextContent(
      'The Masters: T1, -5 · PGA Championship: 3, +2',
    );
    expect(screen.getByTestId('contest-leaderboard-total-entry-1')).toHaveTextContent('-3');
  });

  it('marks the winner of a final event with a trophy, and no winner yet in an event still being played', async () => {
    primeTwoEventMocks({ pgaPosition: 1 });

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-event-winner-event-1-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-event-winner-event-2-entry-1')).not.toBeInTheDocument();
  });

  it('shows no per-event line for a contest of one event', async () => {
    primeMocks();

    renderLeaderboard();

    expect(await screen.findByTestId('contest-leaderboard-total-entry-1')).toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-events-entry-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('contest-leaderboard-event-switcher')).not.toBeInTheDocument();
  });

  it('reads the other event\'s picks when the event switcher moves to it, asking for that event by id', async () => {
    primeTwoEventMocks();

    renderLeaderboard();

    const switcher = await screen.findByTestId('contest-leaderboard-event-switcher');
    expect(switcher).toHaveValue('event-2');
    fireEvent.change(switcher, { target: { value: 'event-1' } });

    await waitFor(() => expect(getContestLeaderboardMock).toHaveBeenCalledWith(expect.objectContaining({
      query: { sportEventId: 'event-1' },
    })));
  });
});
