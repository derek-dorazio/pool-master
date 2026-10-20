import type { ContestEntrySquare, ContestSquaresDraw, ContestSquaresWinner } from '../domain';

/** A box claimed for an entry (#711), with the cap it may not pass. */
export interface ContestEntrySquareClaim {
  contestId: string;
  contestEntryId: string;
  rowIndex: number;
  columnIndex: number;
  claimedByUserId: string;
  /** The contest's box limit per entry: a claim past it is refused. */
  maxSquaresPerEntry: number;
}

/**
 * How a claim ended. A claim and the draw take the contest row lock, so they never interleave: a
 * claim either lands before the digits or is refused as drawn.
 */
export type ContestEntrySquareClaimResult = 'claimed' | 'taken' | 'limitReached' | 'drawn';

/** How clearing a box ended: refused once the digits are drawn, or nothing there to clear. */
export type ContestEntrySquareClearResult = 'cleared' | 'empty' | 'drawn';

/** The digits being recorded, and the event whose entry status the draw submits. */
export interface ContestSquaresDrawWrite extends Omit<ContestSquaresDraw, 'drawnAt'> {
  sportEventId: string;
  drawnAt: Date;
}

/** The claimed boxes, digits and frozen winners of squares contests (#711). */
export interface ContestSquaresRepository {
  /** The contest's claimed boxes, by row then column. */
  findSquares(contestId: string): Promise<ContestEntrySquare[]>;
  /** Claims an empty box for the entry, under the contest row lock. */
  claim(claim: ContestEntrySquareClaim): Promise<ContestEntrySquareClaimResult>;
  /** Clears a claimed box, under the contest row lock. */
  clear(contestId: string, rowIndex: number, columnIndex: number): Promise<ContestEntrySquareClearResult>;
  findDraw(contestId: string): Promise<ContestSquaresDraw | null>;
  /**
   * Records the digits and submits, for its event, every entry holding a box, in one transaction
   * under the contest row lock. 'alreadyDrawn' when the contest has its digits: nothing is written.
   */
  recordDraw(draw: ContestSquaresDrawWrite): Promise<'drawn' | 'alreadyDrawn'>;
  /** The contest's frozen winners, by period. */
  findWinners(contestId: string): Promise<ContestSquaresWinner[]>;
  /** Replaces the contest's frozen winners: settlement's one write. */
  replaceWinners(contestId: string, winners: readonly ContestSquaresWinner[]): Promise<void>;
}
