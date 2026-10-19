/**
 * Pick'em scoring (#717, plans/knockout-and-pickem-design.md §5.5): a week's game picks scored
 * against the games' results. The pure rules, all here:
 *
 * - **A correct pick** names the game's winner. It earns 1 point in a straight-up pool, and its
 *   confidence value in a confidence pool.
 * - **A pick on a lost game, or on a tie,** earns nothing. A tie has no winner, so every pick on it
 *   is wrong (an NFL tie scores 0).
 * - **Against the spread** (#720) a correct pick names the team that covers: the home team's
 *   score plus its spread beats the away team's. A game that lands exactly on the spread is a
 *   push, and every pick on it earns nothing, as does a game completed without its scores, which
 *   cannot be measured against the spread. Release refuses a week with a game missing its spread,
 *   so every game of such a contest has one.
 * - **A cancelled game** is not one of the week's games, so a pick on it is not scored or counted,
 *   even when it was made before the cancellation. A confidence pool keeps the other picks' values
 *   as they were submitted, unrenumbered, so nobody's ranking moves after kickoff.
 * - **The tiebreaker** is the total points of the week's last game by kickoff, both teams together
 *   (Monday night). Among entries with the same points, the one closest to it ranks first
 *   (`rankPredictionStandings`).
 */
import {
  MatchSide,
  MatchStatus,
  PickEmMode,
  PickOutcome,
  type SportEventMatch,
} from '@poolmaster/shared/domain';
import type { BracketPick, BracketScore, ScoredBracketPick } from './bracket-picks';

/** One pick'em pick: the team an entry says wins one game, with its confidence value in a confidence pool. */
export interface GamePick extends BracketPick {
  confidence: number | null;
}

/** The team a completed game's result names the winner of; null for a tie, or a game still to be decided. */
function winnerOf(game: SportEventMatch): string | null {
  if (game.status !== MatchStatus.COMPLETED || game.winnerSide === null) return null;
  return game.winnerSide === MatchSide.HOME ? game.homeSportEventParticipantId : game.awaySportEventParticipantId;
}

/** How a pick'em pool scores its picks: weighted by its mode, and against the spread or straight up. */
export interface GamePickScoring {
  mode: PickEmMode;
  againstTheSpread: boolean;
}

/**
 * The team a completed game's result says covered its spread (#720); null for a push, and for a
 * game without both scores and a spread to measure them by. Undefined for a game still to be decided.
 */
function coverOf(game: SportEventMatch): string | null | undefined {
  if (game.status !== MatchStatus.COMPLETED) return undefined;
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
  games: readonly SportEventMatch[],
  picks: readonly GamePick[],
  { mode, againstTheSpread }: GamePickScoring,
): BracketScore {
  const gamesById = new Map(games.map((game) => [game.id, game]));
  const scored = new Map<string, ScoredBracketPick>();
  let points = 0;
  let pendingPoints = 0;
  let correctPickCount = 0;
  for (const pick of picks) {
    const game = gamesById.get(pick.sportEventMatchId);
    if (!game) continue;
    const value = pickValue(pick, mode);
    const right = againstTheSpread ? coverOf(game) : winnerOf(game);
    if (game.status !== MatchStatus.COMPLETED) {
      scored.set(game.id, { outcome: PickOutcome.PENDING, points: null });
      pendingPoints += value;
    } else if (againstTheSpread && right === null) {
      scored.set(game.id, { outcome: PickOutcome.PUSH, points: 0 });
    } else if (right === pick.sportEventParticipantId) {
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
 * The week's tiebreaker game: its last game by kickoff, the highest game number among games that
 * kick off together. A game with no time of its own kicks off at `eventStart`. Null for a week with
 * no games.
 */
export function weekTiebreakerGame<Match extends Pick<SportEventMatch, 'scheduledDate' | 'matchNumber'>>(
  games: readonly Match[],
  eventStart: Date,
): Match | null {
  const kickoff = (game: Match) => (game.scheduledDate ?? eventStart).getTime();
  return games.reduce<Match | null>((last, game) => (
    last === null || kickoff(game) > kickoff(last) || (kickoff(game) === kickoff(last) && game.matchNumber > last.matchNumber)
      ? game
      : last
  ), null);
}

/** A played game's combined score, both teams together: what a tiebreaker guesses. Null until it completes. */
export function gameTotalPoints(game: SportEventMatch | null): number | null {
  if (game?.status !== MatchStatus.COMPLETED || game.homeScore === null || game.awayScore === null) {
    return null;
  }
  return game.homeScore + game.awayScore;
}
