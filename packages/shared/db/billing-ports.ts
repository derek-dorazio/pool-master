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

/** Who a league's payment history line names as its payer: enough to show their name. */
export interface PaymentPayer {
  id: string;
  firstName: string;
  lastName: string;
  username: string;
  email: string;
}

/** One line of a league's payment history (#987), with its payer when they still exist. */
export interface LeaguePaymentRecord {
  id: string;
  contestId: string | null;
  payer: PaymentPayer | null;
  amountCents: number;
  description: string;
  paidAt: Date;
}

/** One payment a user made (#987), with the league it was made in. */
export interface PayerPaymentRecord {
  id: string;
  league: { id: string; name: string; leagueCode: string };
  amountCents: number;
  description: string;
  paidAt: Date;
}

export interface LeaguePaymentRepository {
  /** The league's payment history, newest first. */
  listForLeague(leagueId: string): Promise<LeaguePaymentRecord[]>;
  /** Every payment the user made, in any league, newest first. */
  listForPayer(userId: string): Promise<PayerPaymentRecord[]>;
}
