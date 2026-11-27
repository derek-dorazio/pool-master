import { MatchSide, MatchStatus, PeriodKind, SlotKind } from './enums';
import { gameNumbered, gameScoreOf, hasPeriodScores, runningPeriodScores, sideNumberOfMatchSide } from './match-sides';
import { SQUARES_GRID_SIZE } from './contest-rules';
import { isMatchUnplayed } from './match-status';
import type { SportEventRoundMatch, SportEventRoundMatchGame } from './sport-catalog-types';

/**
 * Squares pools (#711, plans/super-bowl-squares.md): a 10x10 grid on one game. A box is a grid
 * position; the digits along each side come from the draw. Rows are the away team's digits and
 * columns the home team's (design Q3.9).
 */

/** A claimed box of a squares grid. Only claimed boxes exist; every other box is empty. */
export interface ContestEntrySquare {
  contestId: string;
  contestEntryId: string;
  rowIndex: number;
  columnIndex: number;
  /** Who claimed it: the entry's member, or the commissioner for them. Null once that user is gone. */
  claimedByUserId: string | null;
  claimedAt: Date;
}

/** A squares contest's digits: 0 to 9 shuffled once for the rows and once for the columns. */
export interface ContestSquaresDraw {
  contestId: string;
  seed: string;
  /** The away team's last digit at each row position. */
  rowDigits: readonly number[];
  /** The home team's last digit at each column position. */
  columnDigits: readonly number[];
  drawnByUserId: string | null;
  drawnAt: Date;
}

/**
 * One scoring moment of the game: the score at the end of a period, or, as the last period, the
 * final score, overtime included (design Q3.1, Q3.8).
 */
export interface SquaresScoringMoment {
  /** 1 to the game's period count; the count itself is the final score. */
  periodNumber: number;
  homeScore: number;
  awayScore: number;
}

/** A scoring moment's winning box, and the entry holding it, or none when nobody claimed it. */
export interface SquaresWinner extends SquaresScoringMoment {
  rowIndex: number;
  columnIndex: number;
  contestEntryId: string | null;
}

/** A settled squares contest's frozen winner (design Q3.7). */
export interface ContestSquaresWinner extends SquaresWinner {
  contestId: string;
  settledAt: Date;
}

/**
 * The game's scoring moments entered so far: the running score at each period's end but the last
 * (`runningPeriodScores`, the one sum), then the final score once the game is completed. Rows are
 * side 1's digits and columns side 2's, the home team's where the sync placed the teams, until
 * #2019 names them by side.
 */
export function squaresScoringMoments(
  game: Pick<SportEventRoundMatch, 'status' | 'games'>,
  periodCount: number,
): SquaresScoringMoment[] {
  const gameOne = gameNumbered(game, 1);
  if (gameOne === null) return [];
  const side = (totals: ReadonlyMap<number, number>, sideNumber: number) => totals.get(sideNumber) ?? 0;
  const moments: SquaresScoringMoment[] = runningPeriodScores(gameOne)
    .filter((period) => period.kind === PeriodKind.REGULAR && period.periodNumber < periodCount)
    .map(({ periodNumber, totals }) => ({ periodNumber, homeScore: side(totals, sideNumberOfMatchSide(MatchSide.HOME)), awayScore: side(totals, sideNumberOfMatchSide(MatchSide.AWAY)) }));
  const homeScore = gameScoreOf(gameOne, sideNumberOfMatchSide(MatchSide.HOME));
  const awayScore = gameScoreOf(gameOne, sideNumberOfMatchSide(MatchSide.AWAY));
  if (game.status === MatchStatus.COMPLETED && homeScore !== null && awayScore !== null) {
    moments.push({ periodNumber: periodCount, homeScore, awayScore });
  }
  return moments.sort((left, right) => left.periodNumber - right.periodNumber);
}

/**
 * Whether every scoring moment of a decided game is in: a score for each quarter before the last,
 * and the final. A squares contest waits for all of them before it settles (#711).
 */
export function hasEverySquaresScoringMoment(moments: readonly SquaresScoringMoment[], periodCount: number): boolean {
  return new Set(moments.map((moment) => moment.periodNumber)).size === periodCount;
}

/**
 * Each scoring moment's winning box: the row whose digit is the away score's last digit, the column
 * whose digit is the home score's, and the entry holding that box, if any (design Q3.6).
 */
export function squaresWinners(
  draw: Pick<ContestSquaresDraw, 'rowDigits' | 'columnDigits'>,
  moments: readonly SquaresScoringMoment[],
  boxes: readonly Pick<ContestEntrySquare, 'rowIndex' | 'columnIndex' | 'contestEntryId'>[],
): SquaresWinner[] {
  return moments.map((moment) => {
    const rowIndex = draw.rowDigits.indexOf(moment.awayScore % SQUARES_GRID_SIZE);
    const columnIndex = draw.columnDigits.indexOf(moment.homeScore % SQUARES_GRID_SIZE);
    const box = boxes.find((each) => each.rowIndex === rowIndex && each.columnIndex === columnIndex);
    return { ...moment, rowIndex, columnIndex, contestEntryId: box?.contestEntryId ?? null };
  });
}

/** A Game a squares contest can be played on (#2050), with the match it is a Game of. */
export interface SquaresGameChoice {
  game: SportEventRoundMatchGame;
  match: SportEventRoundMatch;
}

/**
 * The Games a squares contest can be played on (#711, #2050), from an event's head-to-head
 * matches: a Game of a slot that takes squares (`squaresEligible`: a two-legged tie or a short
 * series says no), still to kick off (a postponed Game too), with no period score in. The final's
 * Games come first, then by kickoff, round, match and game number, so the first is the default:
 * Game 1 of the soonest match. Create contest lists these, and create accepts only one of them.
 */
export function squaresGameChoices(matches: readonly SportEventRoundMatch[], now: Date): SquaresGameChoice[] {
  const kickoff = ({ game }: SquaresGameChoice) => game.scheduledDate?.getTime() ?? Number.POSITIVE_INFINITY;
  const isFinal = ({ match }: SquaresGameChoice) => Number(match.slot.slotKind === SlotKind.FINAL);
  return matches
    .filter((match) => match.slot.squaresEligible)
    .flatMap((match) => match.games.map((game) => ({ game, match })))
    .filter(({ game }) => isMatchUnplayed(game.status)
      && !hasPeriodScores({ games: [game] })
      && (game.scheduledDate === null || game.scheduledDate.getTime() > now.getTime()))
    .sort((left, right) => isFinal(right) - isFinal(left)
      || kickoff(left) - kickoff(right)
      || left.match.roundNumber - right.match.roundNumber
      || left.match.matchNumber - right.match.matchNumber
      || left.game.gameNumber - right.game.gameNumber);
}
