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
 * - **Against the spread** (#720) a correct pick names the team that covers: the home team's
 *   score plus its spread beats the away team's. A game that lands exactly on the spread is a
 *   push, and every pick on it earns nothing, as does a game completed without its scores, which
 *   cannot be measured against the spread. A game ended early (#825: a retirement, walkover or
 *   default) has no real final score, so its winner covers whatever the score and spread.
 *   Contest setup refuses a week with a game missing its spread, and a released game's spread
 *   can't be cleared, so every game of such a contest has one.
 * - **A cancelled game** is not one of the week's games, so a pick on it is not scored or counted,
 *   even when it was made before the cancellation. A confidence pool keeps the other picks' values
 *   as they were submitted, unrenumbered, so nobody's ranking moves after kickoff.
 * - **The tiebreaker** is the total points of the game the week's slot names as its tiebreaker
 *   (#2048), both teams together: the week's last kickoff, Monday night, by the slot rule. Among
 *   entries with the same points, the one closest to it ranks first (`rankPredictionStandings`).
 */
import {
  MatchEnding,
  MatchSide,
  MatchStatus,
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
  if (pick.predictedResult === PredictedResult.TIE) return game.winnerSide === null;
  if (game.winnerSide === null) return false;
  const winner = game.winnerSide === MatchSide.HOME ? game.homeSportEventParticipantId : game.awaySportEventParticipantId;
  return winner === pick.sportEventParticipantId;
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
  if (game.ending !== MatchEnding.PLAYED && game.winnerSide !== null) {
    return game.winnerSide === MatchSide.HOME ? game.homeSportEventParticipantId : game.awaySportEventParticipantId;
  }
  if (game.homeScore === null || game.awayScore === null || game.homeSpread === null) return null;
  const margin = game.homeScore + game.homeSpread - game.awayScore;
  if (margin === 0) return null;
  return margin > 0 ? game.homeSportEventParticipantId : game.awaySportEventParticipantId;
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
 * The tiebreaker game among `games` (#2048): the one game its slot names as the slot's tiebreaker,
 * which `SlotTiebreakerService` chooses by the one rule. Null while no game's slot names it among
 * these, or when games of two slots each name one (a guess per slot is slice 18b's).
 */
export function slotTiebreakerGame<Match extends Pick<SportEventRoundMatch, 'id' | 'slot'>>(games: readonly Match[]): Match | null {
  const named = games.filter((game) => game.slot.tiebreakerMatchId === game.id);
  return named.length === 1 ? named[0] : null;
}

/** A played game's combined score, both teams together: what a tiebreaker guesses. Null until it completes. */
export function gameTotalPoints(game: SportEventRoundMatch | null): number | null {
  if (game?.status !== MatchStatus.COMPLETED || game.homeScore === null || game.awayScore === null) {
    return null;
  }
  return game.homeScore + game.awayScore;
}
