/**
 * Pure golf-roster scoring rule per plans/117 §11.1.
 *
 * Signature:
 *   (input: { pick, detail, rules }) → ContestEntryPickGolfRosterContribution[]
 *
 * Pure: same inputs → same outputs. No DB access, no side effects, no time
 * lookups. The bus consumer that wraps this function applies advisory
 * locking + persistence (see live-score-consumer.ts).
 *
 * For golf-roster: contribution = scoreToPar (lowest total wins). The
 * `roundsCount` rule selects which per-pick rounds survive into the
 * contribution rows; only completed rounds are eligible.
 */

import type { GolfRosterScoringConfig, GolfRosterRoundsRule } from '@poolmaster/shared/domain';

export interface GolfRoundDetail {
  round: number;
  strokes: number;
  scoreToPar: number;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'DNF' | 'DSQ';
}

export interface GolfRosterScoringInput {
  pick: { id: string };
  detail: readonly GolfRoundDetail[];
  rules: GolfRosterScoringConfig;
}

export interface GolfRosterContributionRow {
  contestEntryPickId: string;
  round: number;
  strokes: number;
  scoreToPar: number;
  contribution: number;
}

export function scoreGolfRoster(input: GolfRosterScoringInput): GolfRosterContributionRow[] {
  const completed = input.detail.filter((round) => round.status === 'COMPLETED');
  const eligible = applyRoundsRule(completed, input.rules.roundsCount);
  return eligible
    .slice()
    .sort((a, b) => a.round - b.round)
    .map((round) => ({
      contestEntryPickId: input.pick.id,
      round: round.round,
      strokes: round.strokes,
      scoreToPar: round.scoreToPar,
      contribution: round.scoreToPar,
    }));
}

function applyRoundsRule(
  rounds: readonly GolfRoundDetail[],
  rule: GolfRosterRoundsRule,
): readonly GolfRoundDetail[] {
  if (rule === 'ALL') return rounds;
  if (rule.kind === 'TOP_N_BEST') {
    if (rule.topN <= 0) return [];
    if (rule.topN >= rounds.length) return rounds;
    // Sort ascending by scoreToPar (lower = better in golf), break ties by
    // round ascending. Then take the first N.
    return rounds
      .slice()
      .sort((a, b) => a.scoreToPar - b.scoreToPar || a.round - b.round)
      .slice(0, rule.topN);
  }
  // SPECIFIC_ROUNDS
  const allow = new Set(rule.rounds);
  return rounds.filter((r) => allow.has(r.round));
}
