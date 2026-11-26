/**
 * Pick'em scoring (#717, plans/knockout-and-pickem-design.md §5.5): a week's game picks scored
 * against the games' results. The pure rules, all here:
 *
 * - **A correct pick** names the game's winner. It earns 1 point in a straight-up pool, and its
 *   confidence value in a confidence pool.
 * - **A pick on a lost game, or a team pick on a tie,** earns nothing. A tie has no winner, so every
 *   team pick on it is wrong (an NFL tie scores 0).
 * - **A tie pick** (#792), in a sport that offers one (soccer's draw), is correct when the game ends
 *   level and wrong when either team wins. It is worth what a team pick is.
 * - **Against the spread** (#720) a correct pick names the team that covers: side 1's score plus
 *   its spread (the spread is side 1's, #2046) beats side 2's. A game that lands exactly on the spread is a
 *   push, and every pick on it earns nothing, as does a game completed without its scores, which
 *   cannot be measured against the spread. A game ended early (#825: a retirement, walkover or
 *   default) has no real final score, so its winner covers whatever the score and spread.
 *   Contest setup refuses a week with a game missing its spread, and a released game's spread
 *   can't be cleared, so every game of such a contest has one.
 * - **A cancelled game** is not one of the week's games, so a pick on it is not scored or counted,
 *   even when it was made before the cancellation. A confidence pool keeps the other picks' values
 *   as they were submitted, unrenumbered, so nobody's ranking moves after kickoff.
 * - **The tiebreaker** is the total points of the week's last game by kickoff, both teams together
 *   (Monday night). Among entries with the same points, the one closest to it ranks first
 *   (`rankPredictionStandings`).
 */
import {
  compareMatchPlaces,
  MatchEnding,
  MatchStatus,
  endedTied,
  matchScoreOf,
  matchSpread,
  opposingSideOf,
  winnerParticipantId,
  PickEmMode,
  PickOutcome,
  PredictedResult,
  type PredictedChoice,
  type SportEventRoundMatch,
} from '@poolmaster/shared/domain';
import type { BracketScore, ScoredBracketPick } from './bracket-picks';

/**
 * One pick'em pick: the team an entry says wins one game, or a tie (#792), with its confidence
 * value in a confidence pool.
 */
export type GamePick = PredictedChoice & {
  sportEventRoundMatchId: string;
  confidence: number | null;
};

/**
 * Whether a completed game's result is what the pick says: its team won, or for a tie pick, the
 * game ended level. Its one caller asks only of a completed game.
 */
function pickCameTrue(game: SportEventRoundMatch, pick: GamePick): boolean {
  if (pick.predictedResult === PredictedResult.TIE) return endedTied(game);
  const winner = winnerParticipantId(game);
  return winner !== null && winner === pick.sportEventParticipantId;
}

/** How a pick'em pool scores its picks: weighted by its mode, and against the spread or straight up. */
export interface GamePickScoring {
  mode: PickEmMode;
  againstTheSpread: boolean;
}

/**
 * The team a completed game's result says covered its spread (#720); null for a push, and for a
 * game without both scores and a spread to measure them by. The winner of a game ended early (#825).
 * Undefined for a game still to be decided.
 */
function coverOf(game: SportEventRoundMatch): string | null | undefined {
  if (game.status !== MatchStatus.COMPLETED) return undefined;
  const winner = winnerParticipantId(game);
  if (game.ending !== MatchEnding.PLAYED && winner !== null) return winner;
  const spread = matchSpread(game);
  const spreadSide = game.sides.find((side) => side.spread !== null);
  if (spread === null || spreadSide === undefined) return null;
  const otherSide = opposingSideOf(game, spreadSide.sideNumber);
  const score = matchScoreOf(game, spreadSide.sideNumber);
  const otherScore = matchScoreOf(game, otherSide.sideNumber);
  if (score === null || otherScore === null) return null;
  const margin = score + spread - otherScore;
  if (margin === 0) return null;
  return margin > 0 ? spreadSide.sportEventParticipantId : otherSide.sportEventParticipantId;
}

/** What a pick is worth when it is correct: 1 straight up, its confidence value in a confidence pool. */
function pickValue(pick: GamePick, mode: PickEmMode): number {
  return mode === PickEmMode.CONFIDENCE ? pick.confidence ?? 0 : 1;
}

/**
 * Scores an entry's picks for a week against its games. `games` are the week's games, cancelled
 * ones left out, each completed game with its result; a pick on a game not among them scores
 * nothing and is not counted.
 */
export function scoreGamePicks(
  games: readonly SportEventRoundMatch[],
  picks: readonly GamePick[],
  { mode, againstTheSpread }: GamePickScoring,
): BracketScore {
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const scored = new Map<string, ScoredBracketPick>();
  let points = 0;
  let pendingPoints = 0;
  let correctPickCount = 0;
  for (const pick of picks) {
    const game = gamesById.get(pick.sportEventRoundMatchId);
    if (!game) continue;
    const value = pickValue(pick, mode);
    // A sport with tie picks has no spread pools (contest setup refuses them), so a pick against
    // the spread always names a team.
    const cover = againstTheSpread ? coverOf(game) : undefined;
    if (game.status !== MatchStatus.COMPLETED) {
      scored.set(game.id, { outcome: PickOutcome.PENDING, points: null });
      pendingPoints += value;
    } else if (againstTheSpread && cover === null) {
      scored.set(game.id, { outcome: PickOutcome.PUSH, points: 0 });
    } else if (againstTheSpread ? cover === pick.sportEventParticipantId : pickCameTrue(game, pick)) {
      scored.set(game.id, { outcome: PickOutcome.CORRECT, points: value });
      points += value;
      correctPickCount += 1;
    } else {
      scored.set(game.id, { outcome: PickOutcome.BUSTED, points: 0 });
    }
  }
  return {
    points,
    maxPossiblePoints: points + pendingPoints,
    correctPickCount,
    decidedPickCount: [...scored.values()].filter((pick) => pick.outcome !== PickOutcome.PENDING).length,
    picks: scored,
  };
}

/**
 * The week's tiebreaker game: its last game by kickoff, the last in game order (round, then number
 * within it) among games that kick off together. A game with no time of its own kicks off at `eventStart`. Null for a week with
 * no games.
 */
export function weekTiebreakerGame<Match extends Pick<SportEventRoundMatch, 'scheduledDate' | 'roundNumber' | 'matchNumber'>>(
  games: readonly Match[],
  eventStart: Date,
): Match | null {
  const kickoff = (game: Match) => (game.scheduledDate ?? eventStart).getTime();
  return games.reduce<Match | null>((last, game) => (
    last === null || kickoff(game) > kickoff(last) || (kickoff(game) === kickoff(last) && compareMatchPlaces(game, last) > 0)
      ? game
      : last
  ), null);
}

/** A played game's combined score, both teams together: what a tiebreaker guesses. Null until it completes. */
export function gameTotalPoints(game: SportEventRoundMatch | null): number | null {
  if (game?.status !== MatchStatus.COMPLETED) return null;
  const scores = game.sides.map((side) => matchScoreOf(game, side.sideNumber));
  return scores.length === 0 || scores.some((score) => score === null) ? null : scores.reduce<number>((total, score) => total + (score ?? 0), 0);
}
