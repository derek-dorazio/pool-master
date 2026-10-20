import type {
  ContestDto,
  ContestEntryListResponse,
  GamePicksResponse,
  PickEmLeaderboardResponse,
  SurvivorLeaderboardResponse,
} from '@/lib/api';

/**
 * Pick'em contest fixtures (#718) in the generated contract's shapes: an NFL pick'em of two
 * weeks. Week 1 has three games: the Bills at the Chiefs and the Cowboys at the Eagles on Sunday,
 * and the Bears at the Packers on Monday night, the week's last game and so its tiebreaker game.
 */

type Game = GamePicksResponse['games'][number];
type Team = NonNullable<Game['home']>;

function team(key: string, name: string): Team {
  return { sportEventParticipantId: `sep-${key}`, participantId: `participant-${key}`, name };
}

export const NFL_TEAMS = {
  bills: team('bills', 'Bills'),
  chiefs: team('chiefs', 'Chiefs'),
  cowboys: team('cowboys', 'Cowboys'),
  eagles: team('eagles', 'Eagles'),
  bears: team('bears', 'Bears'),
  packers: team('packers', 'Packers'),
} as const;

/** Far enough ahead that "has not kicked off" holds whatever day the suite runs. */
export const WEEK_1_START = '2099-09-13T17:00:00.000Z';
export const WEEK_2_START = '2099-09-20T17:00:00.000Z';

function game(matchNumber: number, kickoff: string, away: Team, home: Team, overrides: Partial<Game> = {}): Game {
  return {
    sportEventMatchId: `match-${matchNumber}`,
    matchNumber,
    roundNumber: 1,
    kickoff,
    status: 'SCHEDULED',
    isNeutralSite: false,
    regionLabel: null,
    homeSpread: null,
    home,
    away,
    predictedHome: home,
    predictedAway: away,
    locked: false,
    revealed: false,
    pick: null,
    ...overrides,
  };
}

/** The pick a game holds: its team, still pending until the game is played. */
export function weekPick(picked: Team, overrides: Partial<NonNullable<Game['pick']>> = {}): NonNullable<Game['pick']> {
  return {
    sportEventParticipantId: picked.sportEventParticipantId,
    confidence: null,
    pickedAt: '2099-09-01T12:00:00.000Z',
    outcome: 'PENDING',
    points: null,
    ...overrides,
  };
}

/**
 * Week 1's games, listed out of kickoff order on purpose: Monday's game is game 1 by number.
 * `overrides` are applied by game number.
 */
export function week1Games(overrides: Partial<Record<1 | 2 | 3, Partial<Game>>> = {}): Game[] {
  return [
    game(1, '2099-09-15T00:15:00.000Z', NFL_TEAMS.bears, NFL_TEAMS.packers, overrides[1]),
    game(2, WEEK_1_START, NFL_TEAMS.bills, NFL_TEAMS.chiefs, overrides[2]),
    game(3, '2099-09-13T20:25:00.000Z', NFL_TEAMS.cowboys, NFL_TEAMS.eagles, overrides[3]),
  ];
}

export function pickEmWeekFixture(overrides: Partial<GamePicksResponse> = {}): GamePicksResponse {
  const games = overrides.games ?? week1Games();
  return {
    contestId: 'contest-1',
    entryId: 'entry-1',
    entryName: 'Morgan’s Picks',
    sportEventId: 'week-1',
    selectionType: 'PICK_EM',
    mode: 'STRAIGHT_UP',
    againstTheSpread: false,
    survivor: null,
    status: 'DRAFT',
    submittedAt: null,
    ownEntry: true,
    canSubmit: false,
    pickedCount: games.filter((each) => each.pick !== null).length,
    gameCount: games.length,
    tiebreakerMatchId: 'match-1',
    tiebreakerValue: null,
    points: 0,
    maxPossiblePoints: games.length,
    games,
    ...overrides,
  };
}

/** A two-week NFL pick'em contest, open and not started unless told otherwise. */
export function pickEmContestFixture(overrides: Partial<ContestDto> = {}): ContestDto {
  return {
    id: 'contest-1',
    leagueId: 'league-1',
    sport: 'AMERICAN_FOOTBALL',
    name: 'Big Dawgs Pick’em',
    status: 'OPEN',
    contestFormat: 'PREDICTION',
    selectionType: 'PICK_EM',
    sportEvents: [
      { sportEventId: 'week-1', sequence: 1, name: 'Week 1', startDate: WEEK_1_START, status: 'SCHEDULED' },
      { sportEventId: 'week-2', sequence: 2, name: 'Week 2', startDate: WEEK_2_START, status: 'SCHEDULED' },
    ],
    ...overrides,
  };
}

/** The contest's entries: the viewer's own (entry-1), which submitted week 2 only, and another member's (entry-2). */
export function pickEmEntriesFixture(overrides: Partial<ContestEntryListResponse> = {}): ContestEntryListResponse {
  const entry = (id: string, squadId: string, squadName: string, name: string, week2: 'DRAFT' | 'SUBMITTED') => ({
    id,
    contestId: 'contest-1',
    squadId,
    squadName,
    entryNumber: 1,
    name,
    events: [
      { sportEventId: 'week-1', status: 'DRAFT' as const, submittedAt: null },
      { sportEventId: 'week-2', status: week2, submittedAt: week2 === 'SUBMITTED' ? '2099-09-02T12:00:00.000Z' : null },
    ],
    tiebreakerValue: null,
    picksCount: 0,
    createdAt: '2099-09-01T12:00:00.000Z',
    updatedAt: '2099-09-01T12:00:00.000Z',
  });
  return {
    contestId: 'contest-1',
    total: 2,
    isJoined: true,
    myEntryId: 'entry-1',
    myEntryIds: ['entry-1'],
    picksRevealed: false,
    entries: [
      entry('entry-1', 'squad-1', 'Morgan’s Madness', 'Morgan’s Picks', 'SUBMITTED'),
      entry('entry-2', 'squad-2', 'Derek’s Great Golf Guys', 'Chalk All The Way', 'DRAFT'),
    ],
    ...overrides,
  };
}

/**
 * The season board after week 1 settled and with week 2 under way: Chalk All The Way won week 1
 * on the tiebreaker and leads the season; Morgan's Picks missed week 1 and is second.
 */
export function pickEmLeaderboardFixture(overrides: Partial<PickEmLeaderboardResponse> = {}): PickEmLeaderboardResponse {
  return {
    contestId: 'contest-1',
    mode: 'STRAIGHT_UP',
    againstTheSpread: false,
    weeks: [
      {
        sportEventId: 'week-1', name: 'Week 1', startDate: WEEK_1_START, status: 'COMPLETED',
        started: true, settled: true, gameCount: 3, tiebreakerTotalPoints: 41, winnerEntryIds: ['entry-2'],
      },
      {
        sportEventId: 'week-2', name: 'Week 2', startDate: WEEK_2_START, status: 'IN_PROGRESS',
        started: true, settled: false, gameCount: 3, tiebreakerTotalPoints: null, winnerEntryIds: [],
      },
    ],
    entries: [
      {
        entryId: 'entry-2', entryName: 'Chalk All The Way', entryNumber: 1, squadId: 'squad-2', squadName: 'Derek’s Great Golf Guys',
        position: 1, displayPosition: '1', totalPoints: 3,
        weeks: [
          { sportEventId: 'week-1', submitted: true, points: 2, position: 1, displayPosition: '1', weeklyWinner: true },
          { sportEventId: 'week-2', submitted: true, points: 1, position: 1, displayPosition: 'T1', weeklyWinner: false },
        ],
      },
      {
        entryId: 'entry-1', entryName: 'Morgan’s Picks', entryNumber: 1, squadId: 'squad-1', squadName: 'Morgan’s Madness',
        position: 2, displayPosition: '2', totalPoints: 1,
        weeks: [
          { sportEventId: 'week-1', submitted: false, points: null, position: null, displayPosition: null, weeklyWinner: false },
          { sportEventId: 'week-2', submitted: true, points: 1, position: 1, displayPosition: 'T1', weeklyWinner: false },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * A survivor week (#719) on week 1's games: one pick, no tiebreaker or points, and the Bills
 * already used in another week.
 */
export function survivorWeekFixture(overrides: Partial<GamePicksResponse> = {}): GamePicksResponse {
  return pickEmWeekFixture({
    selectionType: 'SURVIVOR',
    mode: null,
    survivor: { eliminatedInWeek: null, usedParticipantIds: [NFL_TEAMS.bills.participantId] },
    tiebreakerMatchId: null,
    points: null,
    maxPossiblePoints: null,
    ...overrides,
  });
}

/**
 * A survivor board in week 2: Morgan's Picks survived week 1 and is still in, its week 2 pick
 * not shown until its game kicks off; Chalk All The Way went out in week 2 on the Bears.
 */
export function survivorLeaderboardFixture(overrides: Partial<SurvivorLeaderboardResponse> = {}): SurvivorLeaderboardResponse {
  return {
    contestId: 'contest-1',
    weeks: [
      { sportEventId: 'week-1', weekNumber: 1, roundNumber: 1, roundCount: 1, name: 'Week 1', startDate: WEEK_1_START, status: 'COMPLETED', started: true, aliveCount: 2 },
      { sportEventId: 'week-2', weekNumber: 2, roundNumber: 1, roundCount: 1, name: 'Week 2', startDate: WEEK_2_START, status: 'IN_PROGRESS', started: true, aliveCount: 1 },
    ],
    entries: [
      {
        entryId: 'entry-1', entryName: 'Morgan’s Picks', entryNumber: 1, squadId: 'squad-1', squadName: 'Morgan’s Madness',
        alive: true, eliminatedInWeek: null, weeksSurvived: 1, position: 1, displayPosition: '1',
        weeks: [
          { sportEventId: 'week-1', roundNumber: 1, outcome: 'SURVIVED', team: 'Chiefs' },
          { sportEventId: 'week-2', roundNumber: 1, outcome: 'PENDING', team: null },
        ],
      },
      {
        entryId: 'entry-2', entryName: 'Chalk All The Way', entryNumber: 1, squadId: 'squad-2', squadName: 'Derek’s Great Golf Guys',
        alive: false, eliminatedInWeek: 2, weeksSurvived: 1, position: 2, displayPosition: '2',
        weeks: [
          { sportEventId: 'week-1', roundNumber: 1, outcome: 'SURVIVED', team: 'Bills' },
          { sportEventId: 'week-2', roundNumber: 1, outcome: 'ELIMINATED', team: 'Bears' },
        ],
      },
    ],
    ...overrides,
  };
}

/**
 * A playoff survivor pool (#785) on a two-round bracket, each round a week: the Bills beat the
 * Chiefs in round 1, the entry's pick there; round 2's two games are still to kick off and
 * unpicked. The entry submitted the playoffs with its round 1 pick.
 */
export function playoffSurvivorFixture(overrides: Partial<GamePicksResponse> = {}): GamePicksResponse {
  const [, billsAtChiefs] = week1Games();
  const games: Game[] = [
    { ...billsAtChiefs, matchNumber: 1, sportEventMatchId: 'match-1', status: 'COMPLETED', locked: true, revealed: true, pick: weekPick(NFL_TEAMS.bills, { outcome: 'CORRECT' }) },
    game(2, WEEK_2_START, NFL_TEAMS.bills, NFL_TEAMS.eagles, { roundNumber: 2 }),
    game(3, WEEK_2_START, NFL_TEAMS.bears, NFL_TEAMS.packers, { roundNumber: 2 }),
  ];
  return survivorWeekFixture({
    sportEventId: 'playoffs',
    status: 'SUBMITTED',
    submittedAt: '2099-09-01T12:00:00.000Z',
    survivor: { eliminatedInWeek: null, usedParticipantIds: [] },
    games,
    ...overrides,
  });
}

/** A survivor contest on one playoff event (#785). */
export function playoffSurvivorContestFixture(overrides: Partial<ContestDto> = {}): ContestDto {
  return pickEmContestFixture({
    selectionType: 'SURVIVOR',
    status: 'ACTIVE',
    sportEvents: [{ sportEventId: 'playoffs', sequence: 1, name: 'Playoffs', startDate: WEEK_1_START, status: 'IN_PROGRESS' }],
    ...overrides,
  });
}

/**
 * A playoff survivor board (#785) after round 1 of two: Morgan's Picks survived it on the Bills;
 * Chalk All The Way went out on the Chiefs.
 */
export function playoffSurvivorLeaderboardFixture(): SurvivorLeaderboardResponse {
  const week = (roundNumber: number, aliveCount: number, started: boolean) => ({
    sportEventId: 'playoffs', weekNumber: roundNumber, roundNumber, roundCount: 2, name: 'Playoffs',
    startDate: WEEK_1_START, status: 'IN_PROGRESS' as const, started, aliveCount,
  });
  return survivorLeaderboardFixture({
    weeks: [week(1, 1, true), week(2, 0, false)],
    entries: [
      {
        entryId: 'entry-1', entryName: 'Morgan’s Picks', entryNumber: 1, squadId: 'squad-1', squadName: 'Morgan’s Madness',
        alive: true, eliminatedInWeek: null, weeksSurvived: 1, position: 1, displayPosition: '1',
        weeks: [
          { sportEventId: 'playoffs', roundNumber: 1, outcome: 'SURVIVED', team: 'Bills' },
          { sportEventId: 'playoffs', roundNumber: 2, outcome: null, team: null },
        ],
      },
      {
        entryId: 'entry-2', entryName: 'Chalk All The Way', entryNumber: 1, squadId: 'squad-2', squadName: 'Derek’s Great Golf Guys',
        alive: false, eliminatedInWeek: 1, weeksSurvived: 0, position: 2, displayPosition: '2',
        weeks: [
          { sportEventId: 'playoffs', roundNumber: 1, outcome: 'ELIMINATED', team: 'Chiefs' },
          { sportEventId: 'playoffs', roundNumber: 2, outcome: null, team: null },
        ],
      },
    ],
  });
}
