/**
 * Golf-roster scoring configuration per plans/117 §11.1.
 *
 * Drives the per-pick round filter applied by `scoreGolfRoster`. Each
 * entry's contribution rows include only the rounds selected by this
 * config; the entry's totalScore is then SUM(contribution) across all
 * picks across all surviving rounds.
 */

export type GolfRosterRoundsRule =
  | 'ALL'
  | { kind: 'TOP_N_BEST'; topN: number }
  | { kind: 'SPECIFIC_ROUNDS'; rounds: readonly number[] };

export interface GolfRosterScoringConfig {
  /**
   * Which per-pick rounds count toward the entry total.
   * - `'ALL'`: every round counts (standard 4-round PGA tournament).
   * - `{ kind: 'TOP_N_BEST', topN }`: keep the N rounds with the best
   *   (lowest) `scoreToPar`; ties broken by round number ascending.
   * - `{ kind: 'SPECIFIC_ROUNDS', rounds }`: keep only the listed rounds
   *   (e.g., `[3, 4]` for weekend-only contests).
   */
  roundsCount: GolfRosterRoundsRule;
}

export const DEFAULT_GOLF_ROSTER_SCORING_CONFIG: GolfRosterScoringConfig = {
  roundsCount: 'ALL',
};
