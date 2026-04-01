/**
 * Scoring Engine — evaluates a ScoringConfig against participant data to produce points.
 *
 * Pure functions: no I/O, no side effects. Takes config + data, returns scores.
 */

import type {
  BonusRule,
  MultiplierRule,
  PenaltyRule,
  PositionRule,
  RuleCondition,
  ScoringConfig,
  StatRule,
} from '@poolmaster/shared/domain/scoring-config';

// --- Input Types ---

/** Stat deltas for a single participant (stat_key → accumulated value). */
export type StatDeltas = Record<string, number>;

/** Data needed to score a single participant in a contest. */
export interface ParticipantScoringData {
  participantId: string;
  stats: StatDeltas;
  position?: number;
  totalPositions?: number;
  slotId?: string;
  isDNF: boolean;
  isMissedCut?: boolean;
}

/** Breakdown of how a participant's score was calculated. */
export interface ScoreBreakdown {
  participantId: string;
  statPoints: number;
  positionPoints: number;
  bonusPoints: number;
  penaltyPoints: number;
  multipliedTotal: number;
  dnfAdjustment: number;
  finalScore: number;
}

/** Result of scoring an entire entry (roster of participants). */
export interface EntryScoreResult {
  totalScore: number;
  participantBreakdowns: ScoreBreakdown[];
  countingParticipantIds: string[];
}

// --- Condition Evaluation ---

export function evaluateCondition(condition: RuleCondition, value: number): boolean {
  switch (condition.operator) {
    case 'eq':
      return value === condition.value;
    case 'gt':
      return value > condition.value;
    case 'gte':
      return value >= condition.value;
    case 'lt':
      return value < condition.value;
    case 'lte':
      return value <= condition.value;
    case 'between':
      return value >= condition.value && value <= (condition.value2 ?? condition.value);
    default:
      return false;
  }
}

// --- 03-002: Stat Rules ---

export function evaluateStatRules(rules: StatRule[], stats: StatDeltas): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.stat_key];
    if (statValue === undefined) continue;

    if (rule.condition && !evaluateCondition(rule.condition, statValue)) {
      continue;
    }

    const unitSize = rule.unit_size ?? 1;
    points += Math.floor(statValue / unitSize) * rule.points_per_unit * unitSize;
  }

  return points;
}

// --- 03-003: Position Rules ---

export function evaluatePositionRules(
  rules: PositionRule[],
  position: number | undefined,
  totalPositions?: number,
): number {
  if (position === undefined) return 0;

  for (const rule of rules) {
    // Exact position match
    if (rule.position !== undefined) {
      if (rule.position === 'LAST' && totalPositions !== undefined && position === totalPositions) {
        return rule.points;
      }
      if (rule.position === 'CUT') {
        continue; // CUT handled by DNF logic
      }
      if (typeof rule.position === 'number' && position === rule.position) {
        return rule.points;
      }
    }

    // Position range match
    if (rule.position_range) {
      const [low, high] = rule.position_range;
      if (position >= low && position <= high) {
        return rule.points;
      }
    }
  }

  return 0;
}

// --- 03-004: Bonus Rules ---

export function evaluateBonusRules(rules: BonusRule[], stats: StatDeltas): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.trigger.stat_key];
    if (statValue === undefined) continue;

    if (evaluateCondition(rule.trigger.condition, statValue)) {
      points += rule.points;
    }
  }

  return points;
}

// --- 03-004: Penalty Rules ---

export function evaluatePenaltyRules(
  rules: PenaltyRule[],
  stats: StatDeltas,
): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.trigger];
    if (statValue !== undefined && statValue > 0) {
      points += rule.points; // points are already negative
    }
  }

  return points;
}

// --- 03-005: Multiplier Rules ---

export function applyMultiplierRules(
  rules: MultiplierRule[],
  breakdown: { statPoints: number; positionPoints: number },
  slotId?: string,
  stats?: StatDeltas,
): number {
  let total = breakdown.statPoints + breakdown.positionPoints;

  for (const rule of rules) {
    switch (rule.applies_to) {
      case 'ALL':
        total *= rule.multiplier;
        break;
      case 'SLOT':
        if (slotId && rule.slot_id === slotId) {
          total *= rule.multiplier;
        }
        break;
      case 'STAT':
        // Stat-specific multipliers are applied during stat evaluation;
        // here we handle post-hoc stat multipliers on the total contribution
        if (rule.stat_key && stats && stats[rule.stat_key] !== undefined) {
          total *= rule.multiplier;
        }
        break;
      case 'POSITION':
        if (breakdown.positionPoints !== 0) {
          // Multiply only the position portion
          total = breakdown.statPoints + breakdown.positionPoints * rule.multiplier;
        }
        break;
    }
  }

  return total;
}

// --- 03-006: DNF / Missed Cut Handling ---

export function handleDNF(
  config: ScoringConfig,
  participant: ParticipantScoringData,
  rawScore: number,
  totalPositions?: number,
): { score: number; excluded: boolean } {
  if (!participant.isDNF && !participant.isMissedCut) {
    return { score: rawScore, excluded: false };
  }

  switch (config.dnf_handling) {
    case 'ZERO':
      return { score: 0, excluded: false };

    case 'EXCLUDE':
      return { score: 0, excluded: true };

    case 'LAST_PLACE': {
      const lastPlacePoints = totalPositions !== undefined
        ? evaluatePositionRules(config.position_rules, totalPositions, totalPositions)
        : 0;
      return { score: lastPlacePoints, excluded: false };
    }

    case 'PENALTY':
      return { score: config.missed_event_points ?? 0, excluded: false };

    case 'MISSED_CUT_SCORE':
      return { score: config.missed_event_score ?? 0, excluded: false };

    default:
      return { score: 0, excluded: false };
  }
}

// --- 03-007: Counting Methods ---

export function applyCountingMethod(
  config: ScoringConfig,
  scores: Array<{ participantId: string; score: number; excluded: boolean }>,
): { totalScore: number; countingIds: string[] } {
  // Filter out excluded participants (DNF with EXCLUDE policy)
  const eligible = scores.filter((s) => !s.excluded);

  if (eligible.length === 0) {
    return { totalScore: 0, countingIds: [] };
  }

  // Sort: for lower_is_better (stroke play), ascending; otherwise descending
  const sorted = [...eligible].sort((a, b) =>
    config.lower_is_better ? a.score - b.score : b.score - a.score,
  );

  switch (config.counting_method) {
    case 'BEST_N': {
      const n = config.best_n ?? sorted.length;
      const counting = config.lower_is_better
        ? sorted.slice(0, n) // lowest N scores
        : sorted.slice(0, n); // highest N scores
      return {
        totalScore: counting.reduce((sum, s) => sum + s.score, 0),
        countingIds: counting.map((s) => s.participantId),
      };
    }

    case 'DROP_LOWEST_N': {
      const dropN = config.drop_lowest_n ?? 0;
      // Drop the worst N: for lower_is_better, drop highest; otherwise drop lowest
      const counting = config.lower_is_better
        ? sorted.slice(0, sorted.length - dropN)
        : sorted.slice(0, sorted.length - dropN);
      return {
        totalScore: counting.reduce((sum, s) => sum + s.score, 0),
        countingIds: counting.map((s) => s.participantId),
      };
    }

    case 'ALL':
    default:
      return {
        totalScore: eligible.reduce((sum, s) => sum + s.score, 0),
        countingIds: eligible.map((s) => s.participantId),
      };
  }
}

// --- Main Entry Point ---

/** Score a single participant against a config. */
export function scoreParticipant(
  config: ScoringConfig,
  participant: ParticipantScoringData,
): ScoreBreakdown {
  const statPoints = evaluateStatRules(config.stat_rules, participant.stats);
  const positionPoints = evaluatePositionRules(
    config.position_rules,
    participant.position,
    participant.totalPositions,
  );
  const bonusPoints = evaluateBonusRules(config.bonus_rules, participant.stats);
  const penaltyPoints = evaluatePenaltyRules(config.penalty_rules, participant.stats);

  const baseTotal = statPoints + positionPoints + bonusPoints + penaltyPoints;

  const multipliedTotal =
    config.multiplier_rules.length > 0
      ? applyMultiplierRules(
          config.multiplier_rules,
          { statPoints: statPoints + bonusPoints + penaltyPoints, positionPoints },
          participant.slotId,
          participant.stats,
        )
      : baseTotal;

  const { score: dnfScore } = handleDNF(
    config,
    participant,
    multipliedTotal,
    participant.totalPositions,
  );

  const dnfAdjustment = (participant.isDNF || participant.isMissedCut)
    ? dnfScore - multipliedTotal
    : 0;

  return {
    participantId: participant.participantId,
    statPoints,
    positionPoints,
    bonusPoints,
    penaltyPoints,
    multipliedTotal,
    dnfAdjustment,
    finalScore: participant.isDNF || participant.isMissedCut ? dnfScore : multipliedTotal,
  };
}

/** Score a full entry (roster of participants) with counting method applied. */
export function scoreEntry(
  config: ScoringConfig,
  participants: ParticipantScoringData[],
): EntryScoreResult {
  const breakdowns = participants.map((p) => scoreParticipant(config, p));

  const scoredParticipants = breakdowns.map((b) => ({
    participantId: b.participantId,
    score: b.finalScore,
    excluded: b.dnfAdjustment !== 0 && config.dnf_handling === 'EXCLUDE',
  }));

  const { totalScore, countingIds } = applyCountingMethod(config, scoredParticipants);

  return {
    totalScore,
    participantBreakdowns: breakdowns,
    countingParticipantIds: countingIds,
  };
}
