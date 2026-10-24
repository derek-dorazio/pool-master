import type {
  BracketLeaderboardResponse,
  ContestDto,
  ContestEntryListResponse,
  GamePicksResponse,
  LeagueContextResponse,
} from '@/lib/api';
import { buildPlanEntitlements } from '@/features/plans/test/fixtures';

/**
 * Bracket contest fixtures (#721) in the generated contract's shapes: an eight-team basketball
 * bracket of three rounds. The East's games 1 and 2 and the West's games 3 and 4 open it; game 5
 * (East) and game 6 (West) follow; game 7, where the regions meet, is the final.
 */

type Game = GamePicksResponse['games'][number];
type Team = NonNullable<Game['predictedHome']>;

function team(key: string, name: string): Team {
  return { sportEventParticipantId: `sep-${key}`, participantId: `participant-${key}`, name };
}

export const TEAMS = {
  duke: team('duke', 'Duke'),
  vermont: team('vermont', 'Vermont'),
  houston: team('houston', 'Houston'),
  texas: team('texas', 'Texas'),
  kansas: team('kansas', 'Kansas'),
  akron: team('akron', 'Akron'),
  gonzaga: team('gonzaga', 'Gonzaga'),
  yale: team('yale', 'Yale'),
} as const;

/** Far enough ahead that "has not started" holds whatever day the suite runs. */
export const BRACKET_START = '2099-03-19T16:00:00.000Z';

export function bracketGame(overrides: Partial<Game> & Pick<Game, 'matchNumber' | 'roundNumber'>): Game {
  const { matchNumber } = overrides;
  return {
    sportEventMatchId: `match-${matchNumber}`,
    kickoff: BRACKET_START,
    status: 'SCHEDULED',
    isNeutralSite: true,
    regionLabel: null,
    homeSpread: null,
    home: null,
    away: null,
    predictedHome: null,
    predictedAway: null,
    locked: false,
    revealed: false,
    pick: null,
    ...overrides,
  };
}

/** A first-round game: its teams are the bracket's own, so they are also the ones offered. */
function openingGame(matchNumber: number, regionLabel: string, home: Team, away: Team): Game {
  return bracketGame({ matchNumber, roundNumber: 1, regionLabel, home, away, predictedHome: home, predictedAway: away });
}

/** The pick a game holds: its team, still pending until the games are played. */
export function gamePick(picked: Team, overrides: Partial<NonNullable<Game['pick']>> = {}): NonNullable<Game['pick']> {
  return {
    predictedResult: 'TEAM',
    sportEventParticipantId: picked.sportEventParticipantId,
    confidence: null,
    pickedAt: '2099-03-01T12:00:00.000Z',
    outcome: 'PENDING',
    points: null,
    ...overrides,
  };
}

/** The empty bracket: every first-round game offers its two teams, every later side waits. */
export function emptyBracketGames(): Game[] {
  return [
    openingGame(1, 'East', TEAMS.duke, TEAMS.vermont),
    openingGame(2, 'East', TEAMS.houston, TEAMS.texas),
    openingGame(3, 'West', TEAMS.kansas, TEAMS.akron),
    openingGame(4, 'West', TEAMS.gonzaga, TEAMS.yale),
    bracketGame({ matchNumber: 5, roundNumber: 2, regionLabel: 'East' }),
    bracketGame({ matchNumber: 6, roundNumber: 2, regionLabel: 'West' }),
    bracketGame({ matchNumber: 7, roundNumber: 3 }),
  ];
}

/**
 * A second-chance bracket's games (#721): only those from its starting round on, here the Elite
 * Eight, Final Four and final of a six-round bracket, numbered as the whole bracket numbers them.
 * The Elite Eight's teams are decided, so they are offered as the first round's are.
 */
export function secondChanceBracketGames(): Game[] {
  const eliteEight = (matchNumber: number, regionLabel: string, home: Team, away: Team) =>
    bracketGame({ matchNumber, roundNumber: 4, regionLabel, home, away, predictedHome: home, predictedAway: away });
  return [
    eliteEight(57, 'East', TEAMS.duke, TEAMS.vermont),
    eliteEight(58, 'East', TEAMS.houston, TEAMS.texas),
    eliteEight(59, 'West', TEAMS.kansas, TEAMS.akron),
    eliteEight(60, 'West', TEAMS.gonzaga, TEAMS.yale),
    bracketGame({ matchNumber: 61, roundNumber: 5 }),
    bracketGame({ matchNumber: 62, roundNumber: 5 }),
    bracketGame({ matchNumber: 63, roundNumber: 6 }),
  ];
}

/**
 * Every game picked: Duke, Houston, Kansas and Gonzaga through the first round, Duke and Kansas
 * through the second, and Duke to win the final.
 */
export function filledBracketGames(): Game[] {
  const [g1, g2, g3, g4] = emptyBracketGames();
  return [
    { ...g1, pick: gamePick(TEAMS.duke) },
    { ...g2, pick: gamePick(TEAMS.houston) },
    { ...g3, pick: gamePick(TEAMS.kansas) },
    { ...g4, pick: gamePick(TEAMS.gonzaga) },
    bracketGame({ matchNumber: 5, roundNumber: 2, regionLabel: 'East', predictedHome: TEAMS.duke, predictedAway: TEAMS.houston, pick: gamePick(TEAMS.duke) }),
    bracketGame({ matchNumber: 6, roundNumber: 2, regionLabel: 'West', predictedHome: TEAMS.kansas, predictedAway: TEAMS.gonzaga, pick: gamePick(TEAMS.kansas) }),
    bracketGame({ matchNumber: 7, roundNumber: 3, predictedHome: TEAMS.duke, predictedAway: TEAMS.kansas, pick: gamePick(TEAMS.duke) }),
  ];
}

export function gamePicksFixture(overrides: Partial<GamePicksResponse> = {}): GamePicksResponse {
  const games = overrides.games ?? emptyBracketGames();
  return {
    contestId: 'contest-1',
    entryId: 'entry-1',
    entryName: 'Derek’s Bracket',
    sportEventId: 'event-1',
    selectionType: 'BRACKET',
    mode: null,
    againstTheSpread: false,
    tiePicksOffered: false,
    survivor: null,
    status: 'DRAFT',
    submittedAt: null,
    ownEntry: true,
    canSubmit: false,
    pickedCount: games.filter((game) => game.pick !== null).length,
    gameCount: games.length,
    tiebreakerMatchId: null,
    tiebreakerValue: null,
    points: 0,
    maxPossiblePoints: 0,
    games,
    ...overrides,
  };
}

/** A one-event basketball bracket contest, open and not started unless told otherwise. */
export function bracketContestFixture(overrides: Partial<ContestDto> = {}): ContestDto {
  return {
    id: 'contest-1',
    leagueId: 'league-1',
    entriesPerContest: null,
    sport: 'BASKETBALL',
    name: 'Big Dawgs Bracket',
    status: 'OPEN',
    contestFormat: 'PREDICTION',
    selectionType: 'BRACKET',
    sportEvents: [{ sportEventId: 'event-1', sequence: 1, name: 'March Madness', startDate: BRACKET_START, status: 'SCHEDULED' }],
    ...overrides,
  };
}

export function bracketLeaderboardFixture(overrides: Partial<BracketLeaderboardResponse> = {}): BracketLeaderboardResponse {
  return {
    contestId: 'contest-1',
    sportEventId: 'event-1',
    eventCancelled: false,
    gameCount: 7,
    finalTotalPoints: null,
    entries: [
      {
        entryId: 'entry-2',
        entryName: 'Chalk All The Way',
        entryNumber: 1,
        squadId: 'squad-2',
        squadName: 'Derek’s Great Golf Guys',
        position: 1,
        displayPosition: '1',
        points: 12,
        maxPossiblePoints: 20,
        correctPickCount: 5,
        tiebreakerValue: 141,
      },
      {
        entryId: 'entry-1',
        entryName: 'Derek’s Bracket',
        entryNumber: 1,
        squadId: 'squad-1',
        squadName: 'Morgan’s Madness',
        position: 2,
        displayPosition: '2',
        points: 8,
        maxPossiblePoints: 16,
        correctPickCount: 4,
        tiebreakerValue: null,
      },
    ],
    ...overrides,
  };
}

/** The contest's entries: the viewer's own (entry-1) and another member's (entry-2). */
export function bracketEntriesFixture(overrides: Partial<ContestEntryListResponse> = {}): ContestEntryListResponse {
  const entry = (id: string, squadId: string, squadName: string, name: string) => ({
    id,
    contestId: 'contest-1',
    squadId,
    squadName,
    entryNumber: 1,
    name,
    events: [{ sportEventId: 'event-1', status: 'DRAFT' as const, submittedAt: null }],
    tiebreakerValue: null,
    picksCount: 0,
    createdAt: '2099-03-01T12:00:00.000Z',
    updatedAt: '2099-03-01T12:00:00.000Z',
  });
  return {
    contestId: 'contest-1',
    total: 2,
    isJoined: true,
    myEntryId: 'entry-1',
    myEntryIds: ['entry-1'],
    picksRevealed: false,
    entries: [
      entry('entry-1', 'squad-1', 'Morgan’s Madness', 'Derek’s Bracket'),
      entry('entry-2', 'squad-2', 'Derek’s Great Golf Guys', 'Chalk All The Way'),
    ],
    ...overrides,
  };
}

const VIEWER = {
  id: 'user-1',
  email: 'member@example.com',
  username: 'member@example.com',
  firstName: 'Morgan',
  lastName: 'Member',
  isActive: true,
  isRootAdmin: false,
  createdAt: '2026-04-15T00:00:00.000Z',
};

/** The league as its context read returns it, with the viewer a member owning squad-1. */
export function bracketLeagueContextFixture(): LeagueContextResponse {
  return {
    league: {
      id: 'league-1',
      leagueCode: 'BIGDAWGS',
      name: 'Big Dawgs',
      description: null,
      isActive: true,
      iconKey: 'TROPHY',
      memberCount: 2,
      activeContestCount: 1,
      createdAt: '2026-04-15T00:00:00.000Z',
      cupName: 'Big Dawgs Cup',
      cupPointsScale: 'STANDARD',
      cupCustomPoints: [],
      hallOfLameVisible: true,
      planEntitlements: buildPlanEntitlements(),
      planRenewsAt: '2027-04-24T00:00:00.000Z',
      mutedSportLeagueIds: [],
      eventEmailDelivery: 'PER_EVENT',
    },
    membership: {
      id: 'league-membership-1',
      leagueId: 'league-1',
      userId: 'user-1',
      user: VIEWER,
      role: 'MEMBER',
      status: 'ACTIVE',
      joinedAt: '2026-04-15T00:00:00.000Z',
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
    squadMembership: {
      id: 'squad-membership-1',
      squadId: 'squad-1',
      leagueId: 'league-1',
      userId: 'user-1',
      user: VIEWER,
      status: 'ACTIVE',
      joinedAt: '2026-04-15T00:00:00.000Z',
      createdAt: '2026-04-15T00:00:00.000Z',
      updatedAt: '2026-04-15T00:00:00.000Z',
    },
  };
}
