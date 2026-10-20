import { MatchStatus } from './enums';
import { SQUARES_GRID_SIZE } from './contest-rules';
import type { SportEventMatch } from './sport-catalog-types';

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
 * The game's scoring moments entered so far: each period's end but the last, as the admin entered
 * it, then the final score once the game is completed. Nothing is added up (design Q3.1).
 */
export function squaresScoringMoments(
  game: Pick<SportEventMatch, 'status' | 'homeScore' | 'awayScore' | 'periodScores'>,
  periodCount: number,
): SquaresScoringMoment[] {
  const moments: SquaresScoringMoment[] = game.periodScores
    .filter((score) => score.periodNumber < periodCount)
    .map(({ periodNumber, homeScore, awayScore }) => ({ periodNumber, homeScore, awayScore }));
  if (game.status === MatchStatus.COMPLETED && game.homeScore !== null && game.awayScore !== null) {
    moments.push({ periodNumber: periodCount, homeScore: game.homeScore, awayScore: game.awayScore });
  }
  return moments.sort((left, right) => left.periodNumber - right.periodNumber);
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
