/**
 * Pick'em scoring (#717): a week's picks scored against its games' results in both modes, the
 * week's tiebreaker game, and the ranking that breaks level points with the tiebreaker.
 */
import { expect } from '@jest/globals';
import { MatchSide, MatchStatus, PickEmMode, PickOutcome, type SportEventMatch } from '@poolmaster/shared/domain';
import { rankPredictionStandings } from '../../../packages/core-api/src/modules/scoring-families/head-to-head/bracket-picks';
import {
  gameTotalPoints,
  scoreGamePicks,
  weekTiebreakerGame,
  type GamePick,
} from '../../../packages/core-api/src/modules/scoring-families/head-to-head/game-picks';

const T0 = new Date('2026-09-01T00:00:00.000Z');
const SUNDAY = new Date('2026-09-13T17:00:00.000Z');
const MONDAY = new Date('2026-09-15T00:15:00.000Z');

function game(matchNumber: number, overrides: Partial<SportEventMatch> = {}): SportEventMatch {
  return {
    id: `game-${matchNumber}`,
    sportEventId: 'week-1',
    roundNumber: 1,
    matchNumber,
    homeSportEventParticipantId: `home-${matchNumber}`,
    awaySportEventParticipantId: `away-${matchNumber}`,
    isNeutralSite: false,
    scheduledDate: SUNDAY,
    status: MatchStatus.SCHEDULED,
    winnerSide: null,
    homeScore: null,
    awayScore: null,
    advancesToMatchId: null,
    advancesToSide: null,
    regionLabel: null,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const played = (matchNumber: number, winnerSide: MatchSide | null, homeScore: number, awayScore: number) =>
  game(matchNumber, { status: MatchStatus.COMPLETED, winnerSide, homeScore, awayScore });

const pick = (matchNumber: number, side: 'home' | 'away', confidence: number | null = null): GamePick => ({
  sportEventMatchId: `game-${matchNumber}`,
  sportEventParticipantId: `${side}-${matchNumber}`,
  confidence,
});

/** Game 1 won by the home team, game 2 by the away team, game 3 a 20-20 tie, game 4 still to play. */
const WEEK = [
  played(1, MatchSide.HOME, 24, 17),
  played(2, MatchSide.AWAY, 10, 13),
  played(3, null, 20, 20),
  game(4, { scheduledDate: MONDAY }),
];

describe('scoreGamePicks — a straight-up week', () => {
  it('earns 1 point for each correct pick and nothing for a lost game or a tie, with the game still to play as the only point left to win', () => {
    const score = scoreGamePicks(WEEK, [pick(1, 'home'), pick(2, 'home'), pick(3, 'home'), pick(4, 'away')], PickEmMode.STRAIGHT_UP);

    expect(score).toMatchObject({ points: 1, maxPossiblePoints: 2, correctPickCount: 1, decidedPickCount: 3 });
    expect([...score.picks]).toEqual([
      ['game-1', { outcome: PickOutcome.CORRECT, points: 1 }],
      ['game-2', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-3', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-4', { outcome: PickOutcome.PENDING, points: null }],
    ]);
  });
});

describe('scoreGamePicks — a confidence week', () => {
  it('earns a correct pick its confidence value, so the most possible adds the values of the picks still pending', () => {
    const score = scoreGamePicks(WEEK, [pick(1, 'home', 2), pick(2, 'away', 4), pick(3, 'away', 1), pick(4, 'home', 3)], PickEmMode.CONFIDENCE);

    expect(score).toMatchObject({ points: 6, maxPossiblePoints: 9, correctPickCount: 2 });
  });

  it('does not score or count a pick on a game no longer in the week, keeping the other picks\' values as submitted', () => {
    // Game 2 was cancelled after the week was submitted, so it is no longer one of the week's games.
    const week = WEEK.filter((each) => each.id !== 'game-2');
    const score = scoreGamePicks(week, [pick(1, 'home', 2), pick(2, 'away', 4), pick(3, 'away', 1), pick(4, 'home', 3)], PickEmMode.CONFIDENCE);

    expect(score).toMatchObject({ points: 2, maxPossiblePoints: 5, decidedPickCount: 2 });
    expect(score.picks.has('game-2')).toBe(false);
  });
});

describe('weekTiebreakerGame', () => {
  it('takes the game that kicks off last, the Monday night game', () => {
    expect(weekTiebreakerGame(WEEK, SUNDAY)?.id).toBe('game-4');
  });

  it('takes the highest game number among games that kick off together, and gives a game with no time the event\'s start', () => {
    const week = [game(1, { scheduledDate: null }), game(2), game(3)];
    expect(weekTiebreakerGame(week, new Date('2026-09-11T00:20:00.000Z'))?.id).toBe('game-3');
  });

  it('finds none in a week with no games', () => {
    expect(weekTiebreakerGame([], SUNDAY)).toBeNull();
  });
});

describe('gameTotalPoints', () => {
  it('adds both teams\' points of a played game, and has none for a game still to play', () => {
    expect(gameTotalPoints(played(1, MatchSide.HOME, 24, 17))).toBe(41);
    expect(gameTotalPoints(game(4))).toBeNull();
    expect(gameTotalPoints(null)).toBeNull();
  });
});

describe('rankPredictionStandings — the week\'s tiebreaker', () => {
  const standings = [
    { entryId: 'far', points: 9, tiebreakerValue: 30 },
    { entryId: 'close', points: 9, tiebreakerValue: 44 },
    { entryId: 'none', points: 9, tiebreakerValue: null },
    { entryId: 'top', points: 11, tiebreakerValue: null },
  ];

  it('ranks level points by the tiebreaker closest to the tiebreaker game\'s total, an entry without one after those with one', () => {
    expect(rankPredictionStandings(standings, 41).map((rank) => [rank.entryId, rank.displayPosition])).toEqual([
      ['top', '1'], ['close', '2'], ['far', '3'], ['none', '4'],
    ]);
  });

  it('leaves level points sharing a place until the tiebreaker game is played', () => {
    expect(rankPredictionStandings(standings, null).map((rank) => [rank.entryId, rank.displayPosition])).toEqual([
      ['top', '1'], ['far', 'T2'], ['close', 'T2'], ['none', 'T2'],
    ]);
  });
});
