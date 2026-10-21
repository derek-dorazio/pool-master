/**
 * Pick'em scoring (#717): a week's picks scored against its games' results in both modes, the
 * week's tiebreaker game, and the ranking that breaks level points with the tiebreaker.
 */
import { expect } from '@jest/globals';
import { MatchSide, MatchStatus, PickEmMode, PickOutcome, PredictedResult, type SportEventMatch } from '@poolmaster/shared/domain';
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
    homeSpread: null,
    periodScores: [],
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

const played = (matchNumber: number, winnerSide: MatchSide | null, homeScore: number, awayScore: number) =>
  game(matchNumber, { status: MatchStatus.COMPLETED, winnerSide, homeScore, awayScore });

const pick = (matchNumber: number, side: 'home' | 'away', confidence: number | null = null): GamePick => ({
  sportEventMatchId: `game-${matchNumber}`,
  predictedResult: PredictedResult.TEAM,
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
    const score = scoreGamePicks(WEEK, [pick(1, 'home'), pick(2, 'home'), pick(3, 'home'), pick(4, 'away')], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false });

    expect(score).toMatchObject({ points: 1, maxPossiblePoints: 2, correctPickCount: 1, decidedPickCount: 3 });
    expect([...score.picks]).toEqual([
      ['game-1', { outcome: PickOutcome.CORRECT, points: 1 }],
      ['game-2', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-3', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-4', { outcome: PickOutcome.PENDING, points: null }],
    ]);
  });
});

const tiePick = (matchNumber: number, confidence: number | null = null): GamePick => ({
  sportEventMatchId: `game-${matchNumber}`,
  predictedResult: PredictedResult.TIE,
  sportEventParticipantId: null,
  confidence,
});

describe('scoreGamePicks — tie picks (#792)', () => {
  it('scores a tie pick correct on the level game, busted on the games a team won, and pending on the game still to play', () => {
    const score = scoreGamePicks(WEEK, [tiePick(1), tiePick(2), tiePick(3), tiePick(4)], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false });

    expect(score).toMatchObject({ points: 1, maxPossiblePoints: 2, correctPickCount: 1, decidedPickCount: 3 });
    expect([...score.picks]).toEqual([
      ['game-1', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-2', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-3', { outcome: PickOutcome.CORRECT, points: 1 }],
      ['game-4', { outcome: PickOutcome.PENDING, points: null }],
    ]);
  });

  it('earns a correct tie pick its confidence value in a confidence week, as a team pick would', () => {
    const score = scoreGamePicks(WEEK, [pick(1, 'home', 1), tiePick(3, 3), tiePick(4, 2)], { mode: PickEmMode.CONFIDENCE, againstTheSpread: false });

    expect(score).toMatchObject({ points: 4, maxPossiblePoints: 6, correctPickCount: 2 });
    expect(score.picks.get('game-3')).toEqual({ outcome: PickOutcome.CORRECT, points: 3 });
  });
});

describe('scoreGamePicks — a confidence week', () => {
  it('earns a correct pick its confidence value, so the most possible adds the values of the picks still pending', () => {
    const score = scoreGamePicks(WEEK, [pick(1, 'home', 2), pick(2, 'away', 4), pick(3, 'away', 1), pick(4, 'home', 3)], { mode: PickEmMode.CONFIDENCE, againstTheSpread: false });

    expect(score).toMatchObject({ points: 6, maxPossiblePoints: 9, correctPickCount: 2 });
  });

  it('does not score or count a pick on a game no longer in the week, keeping the other picks\' values as submitted', () => {
    // Game 2 was cancelled after the week was submitted, so it is no longer one of the week's games.
    const week = WEEK.filter((each) => each.id !== 'game-2');
    const score = scoreGamePicks(week, [pick(1, 'home', 2), pick(2, 'away', 4), pick(3, 'away', 1), pick(4, 'home', 3)], { mode: PickEmMode.CONFIDENCE, againstTheSpread: false });

    expect(score).toMatchObject({ points: 2, maxPossiblePoints: 5, decidedPickCount: 2 });
    expect(score.picks.has('game-2')).toBe(false);
  });
});

// #720: margin = home score + home spread - away score; above zero the home team covers.
describe('scoreGamePicks — a week against the spread', () => {
  const spread = (matchNumber: number, homeSpread: number | null, homeScore: number, awayScore: number) =>
    game(matchNumber, {
      status: MatchStatus.COMPLETED,
      winnerSide: homeScore > awayScore ? MatchSide.HOME : homeScore < awayScore ? MatchSide.AWAY : null,
      homeScore,
      awayScore,
      homeSpread,
    });
  // Game 1: home favoured by 3.5 wins by 3, so the away team covers.
  // Game 2: home underdog at +6.5 loses by 4, so the home team covers.
  // Game 3: home favoured by 3 wins by 3, landing on the spread: a push.
  // Game 4: still to play.
  const ATS_WEEK = [
    spread(1, -3.5, 20, 17),
    spread(2, 6.5, 10, 14),
    spread(3, -3, 24, 21),
    game(4, { homeSpread: -7, scheduledDate: MONDAY }),
  ];

  it('scores the team that covers the spread, not the winner, and a game landing on the spread as a push worth nothing', () => {
    const score = scoreGamePicks(ATS_WEEK, [pick(1, 'home'), pick(2, 'home'), pick(3, 'home'), pick(4, 'away')], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true });

    expect(score).toMatchObject({ points: 1, maxPossiblePoints: 2, correctPickCount: 1, decidedPickCount: 3 });
    expect([...score.picks]).toEqual([
      ['game-1', { outcome: PickOutcome.BUSTED, points: 0 }],
      ['game-2', { outcome: PickOutcome.CORRECT, points: 1 }],
      ['game-3', { outcome: PickOutcome.PUSH, points: 0 }],
      ['game-4', { outcome: PickOutcome.PENDING, points: null }],
    ]);
  });

  it('pushes either side of a game landing on the spread', () => {
    const score = scoreGamePicks([spread(3, -3, 24, 21)], [pick(3, 'away')], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true });

    expect(score.picks.get('game-3')).toEqual({ outcome: PickOutcome.PUSH, points: 0 });
  });

  it('earns a covering pick its confidence value in a confidence pool, a push earning nothing and counting nothing toward the most possible', () => {
    const score = scoreGamePicks(ATS_WEEK, [pick(1, 'away', 4), pick(2, 'home', 1), pick(3, 'home', 3), pick(4, 'home', 2)], { mode: PickEmMode.CONFIDENCE, againstTheSpread: true });

    expect(score).toMatchObject({ points: 5, maxPossiblePoints: 7, correctPickCount: 2 });
  });

  it('pushes a played game with no spread or no score, since no side can be said to cover', () => {
    const noSpread = spread(1, null, 20, 17);
    const noScore = game(2, { status: MatchStatus.COMPLETED, winnerSide: MatchSide.HOME, homeSpread: -3 });
    const score = scoreGamePicks([noSpread, noScore], [pick(1, 'home'), pick(2, 'home')], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: true });

    expect([...score.picks.values()]).toEqual([
      { outcome: PickOutcome.PUSH, points: 0 },
      { outcome: PickOutcome.PUSH, points: 0 },
    ]);
  });

  it('ignores the spread in a pool picked straight up', () => {
    const score = scoreGamePicks(ATS_WEEK, [pick(1, 'home'), pick(3, 'home')], { mode: PickEmMode.STRAIGHT_UP, againstTheSpread: false });

    expect(score).toMatchObject({ points: 2, correctPickCount: 2 });
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
