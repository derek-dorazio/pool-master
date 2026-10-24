import type { LeaguePaymentKind } from '../domain';

/** A contest's expansion and entry count (#987), read together. */
export interface ContestExpansionState {
  /** The contest's highest expansion band, or null when it was never expanded. */
  expandedTo: number | null;
  /** Every entry the contest holds, drafts included: what its cap counts. */
  entryCount: number;
}

/** One expansion and its payment history line, written together (#987). */
export interface ContestExpansionWrite {
  contestId: string;
  leagueId: string;
  /** The band the contest is expanded to. */
  entriesPerContest: number;
  /** Who expanded it: the commissioner, or the root admin who gave it. */
  payerId: string;
  kind: LeaguePaymentKind;
  amountCents: number;
  /** The history line's description, from the band the contest had when the write took its lock. */
  describe: (expandedTo: number | null) => string;
}

/**
 * `notAbove`: under the contest's lock, the contest already had this band or a higher one (two
 * commissioners expanding at once); nothing is written.
 */
export type ContestExpansionWriteResult =
  | { status: 'expanded'; expandedTo: number }
  | { status: 'notAbove'; expandedTo: number };

export interface ContestExpansionRepository {
  findState(contestId: string): Promise<ContestExpansionState>;
  /** Each listed contest's highest expansion band; a contest never expanded is absent. */
  findHighestBands(contestIds: readonly string[]): Promise<Map<string, number>>;
  /**
   * Takes the contest's row lock, the one entries are counted under, then writes the payment
   * line and the expansion in one transaction when the band is above the contest's highest.
   */
  expand(write: ContestExpansionWrite): Promise<ContestExpansionWriteResult>;
}
