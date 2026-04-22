/**
 * Scoring Engine — evaluates a ScoringConfig against participant data to produce points.
 *
 * Pure functions: no I/O, no side effects. Takes config + data, returns scores.
 */

import type { ServiceLogger } from '../../../core/logger';
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

export function evaluateCondition(
  condition: RuleCondition,
  value: number,
  logger?: ServiceLogger,
): boolean {
  let matches: boolean;
  switch (condition.operator) {
    case 'eq':
      matches = value === condition.value;
      break;
    case 'gt':
      matches = value > condition.value;
      break;
    case 'gte':
      matches = value >= condition.value;
      break;
    case 'lt':
      matches = value < condition.value;
      break;
    case 'lte':
      matches = value <= condition.value;
      break;
    case 'between':
      matches = value >= condition.value && value <= (condition.value2 ?? condition.value);
      break;
    default:
      matches = false;
      break;
  }
  logger?.debug(
    { action: 'scoringEngine.evaluateCondition', data: { operator: condition.operator, value, threshold: condition.value, threshold2: condition.value2, matches } },
    'Evaluated scoring rule condition',
  );
  return matches;
}

// --- 03-002: Stat Rules ---

export function evaluateStatRules(
  rules: StatRule[],
  stats: StatDeltas,
  logger?: ServiceLogger,
): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.stat_key];
    if (statValue === undefined) continue;

    if (rule.condition && !evaluateCondition(rule.condition, statValue, logger)) {
      continue;
    }

    const unitSize = rule.unit_size ?? 1;
    points += Math.floor(statValue / unitSize) * rule.points_per_unit * unitSize;
  }

  logger?.info(
    { action: 'scoringEngine.evaluateStatRules', data: { ruleCount: rules.length, statCount: Object.keys(stats).length, points } },
    'Evaluated scoring stat rules',
  );
  return points;
}

// --- 03-003: Position Rules ---

export function evaluatePositionRules(
  rules: PositionRule[],
  position: number | undefined,
  totalPositions?: number,
  logger?: ServiceLogger,
): number {
  if (position === undefined) {
    logger?.debug(
      { action: 'scoringEngine.evaluatePositionRules.noPosition', data: { ruleCount: rules.length, totalPositions } },
      'Skipped position rule evaluation because no position was provided',
    );
    return 0;
  }

  for (const rule of rules) {
    // Exact position match
    if (rule.position !== undefined) {
      if (rule.position === 'LAST' && totalPositions !== undefined && position === totalPositions) {
        logger?.info(
          { action: 'scoringEngine.evaluatePositionRules.lastPlace', data: { position, totalPositions, points: rule.points } },
          'Matched last-place scoring rule',
        );
        return rule.points;
      }
      if (rule.position === 'CUT') {
        continue; // CUT handled by DNF logic
      }
      if (typeof rule.position === 'number' && position === rule.position) {
        logger?.info(
          { action: 'scoringEngine.evaluatePositionRules.exact', data: { position, points: rule.points } },
          'Matched exact-position scoring rule',
        );
        return rule.points;
      }
    }

    // Position range match
    if (rule.position_range) {
      const [low, high] = rule.position_range;
      if (position >= low && position <= high) {
        logger?.info(
          { action: 'scoringEngine.evaluatePositionRules.range', data: { position, range: rule.position_range, points: rule.points } },
          'Matched position-range scoring rule',
        );
        return rule.points;
      }
    }
  }

  logger?.debug(
    { action: 'scoringEngine.evaluatePositionRules.noMatch', data: { position, totalPositions, ruleCount: rules.length } },
    'No position scoring rule matched',
  );
  return 0;
}

// --- 03-004: Bonus Rules ---

export function evaluateBonusRules(
  rules: BonusRule[],
  stats: StatDeltas,
  logger?: ServiceLogger,
): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.trigger.stat_key];
    if (statValue === undefined) continue;

    if (evaluateCondition(rule.trigger.condition, statValue, logger)) {
      points += rule.points;
    }
  }

  logger?.info(
    { action: 'scoringEngine.evaluateBonusRules', data: { ruleCount: rules.length, statCount: Object.keys(stats).length, points } },
    'Evaluated scoring bonus rules',
  );
  return points;
}

// --- 03-004: Penalty Rules ---

export function evaluatePenaltyRules(
  rules: PenaltyRule[],
  stats: StatDeltas,
  logger?: ServiceLogger,
): number {
  let points = 0;

  for (const rule of rules) {
    const statValue = stats[rule.trigger];
    if (statValue !== undefined && statValue > 0) {
      points += rule.points; // points are already negative
    }
  }

  logger?.info(
    { action: 'scoringEngine.evaluatePenaltyRules', data: { ruleCount: rules.length, statCount: Object.keys(stats).length, points } },
    'Evaluated scoring penalty rules',
  );
  return points;
}

// --- 03-005: Multiplier Rules ---

export function applyMultiplierRules(
  rules: MultiplierRule[],
  breakdown: { statPoints: number; positionPoints: number },
  slotId?: string,
  stats?: StatDeltas,
  logger?: ServiceLogger,
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

  logger?.info(
    { action: 'scoringEngine.applyMultiplierRules', data: { ruleCount: rules.length, slotId: slotId ?? null, total } },
    'Applied scoring multiplier rules',
  );
  return total;
}

// --- 03-006: DNF / Missed Cut Handling ---

export function handleDNF(
  config: ScoringConfig,
  participant: ParticipantScoringData,
  rawScore: number,
  totalPositions?: number,
  logger?: ServiceLogger,
): { score: number; excluded: boolean } {
  if (!participant.isDNF && !participant.isMissedCut) {
    logger?.debug(
      { action: 'scoringEngine.handleDNF.noAdjustment', data: { participantId: participant.participantId, rawScore } },
      'DNF handling skipped because participant completed normally',
    );
    return { score: rawScore, excluded: false };
  }

  let result: { score: number; excluded: boolean };
  switch (config.dnf_handling) {
    case 'ZERO':
      result = { score: 0, excluded: false };
      break;

    case 'EXCLUDE':
      result = { score: 0, excluded: true };
      break;

    case 'LAST_PLACE': {
      const lastPlacePoints = totalPositions !== undefined
        ? evaluatePositionRules(config.position_rules, totalPositions, totalPositions, logger)
        : 0;
      result = { score: lastPlacePoints, excluded: false };
      break;
    }

    case 'PENALTY':
      result = { score: config.missed_event_points ?? 0, excluded: false };
      break;

    case 'MISSED_CUT_SCORE':
      result = { score: config.missed_event_score ?? 0, excluded: false };
      break;

    default:
      result = { score: 0, excluded: false };
      break;
  }
  logger?.warn(
    {
      action: 'scoringEngine.handleDNF.adjusted',
      data: {
        participantId: participant.participantId,
        isDNF: participant.isDNF,
        isMissedCut: participant.isMissedCut === true,
        dnfHandling: config.dnf_handling,
        adjustedScore: result.score,
        excluded: result.excluded,
      },
    },
    'Applied DNF or missed-cut scoring adjustment',
  );
  return result;
}

// --- 03-007: Counting Methods ---

export function applyCountingMethod(
  config: ScoringConfig,
  scores: Array<{ participantId: string; score: number; excluded: boolean }>,
  logger?: ServiceLogger,
): { totalScore: number; countingIds: string[] } {
  // Filter out excluded participants (DNF with EXCLUDE policy)
  const eligible = scores.filter((s) => !s.excluded);

  if (eligible.length === 0) {
    logger?.warn(
      { action: 'scoringEngine.applyCountingMethod.noEligibleScores', data: { countingMethod: config.counting_method, scoreCount: scores.length } },
      'No eligible participant scores were available for counting',
    );
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
  logger?: ServiceLogger,
): ScoreBreakdown {
  logger?.debug(
    { action: 'scoringEngine.scoreParticipant.start', data: { participantId: participant.participantId, statCount: Object.keys(participant.stats).length, isDNF: participant.isDNF, isMissedCut: participant.isMissedCut === true } },
    'Scoring participant',
  );
  const statPoints = evaluateStatRules(config.stat_rules, participant.stats, logger);
  const positionPoints = evaluatePositionRules(
    config.position_rules,
    participant.position,
    participant.totalPositions,
    logger,
  );
  const bonusPoints = evaluateBonusRules(config.bonus_rules, participant.stats, logger);
  const penaltyPoints = evaluatePenaltyRules(config.penalty_rules, participant.stats, logger);

  const baseTotal = statPoints + positionPoints + bonusPoints + penaltyPoints;

  const multipliedTotal =
    config.multiplier_rules.length > 0
      ? applyMultiplierRules(
          config.multiplier_rules,
          { statPoints: statPoints + bonusPoints + penaltyPoints, positionPoints },
          participant.slotId,
          participant.stats,
          logger,
        )
      : baseTotal;

  const { score: dnfScore } = handleDNF(
    config,
    participant,
    multipliedTotal,
    participant.totalPositions,
    logger,
  );

  const dnfAdjustment = (participant.isDNF || participant.isMissedCut)
    ? dnfScore - multipliedTotal
    : 0;

  const breakdown = {
    participantId: participant.participantId,
    statPoints,
    positionPoints,
    bonusPoints,
    penaltyPoints,
    multipliedTotal,
    dnfAdjustment,
    finalScore: participant.isDNF || participant.isMissedCut ? dnfScore : multipliedTotal,
  };
  logger?.info(
    { action: 'scoringEngine.scoreParticipant.success', data: { participantId: participant.participantId, finalScore: breakdown.finalScore, statPoints, positionPoints, bonusPoints, penaltyPoints } },
    'Scored participant',
  );
  return breakdown;
}

/** Score a full entry (roster of participants) with counting method applied. */
export function scoreEntry(
  config: ScoringConfig,
  participants: ParticipantScoringData[],
  logger?: ServiceLogger,
): EntryScoreResult {
  logger?.debug(
    { action: 'scoringEngine.scoreEntry.start', data: { participantCount: participants.length, countingMethod: config.counting_method } },
    'Scoring entry',
  );
  const breakdowns = participants.map((p) => scoreParticipant(config, p, logger));

  const scoredParticipants = breakdowns.map((b, i) => ({
    participantId: b.participantId,
    score: b.finalScore,
    excluded:
      (participants[i].isDNF || participants[i].isMissedCut === true) &&
      config.dnf_handling === 'EXCLUDE',
  }));

  const { totalScore, countingIds } = applyCountingMethod(config, scoredParticipants, logger);

  const result = {
    totalScore,
    participantBreakdowns: breakdowns,
    countingParticipantIds: countingIds,
  };
  logger?.info(
    { action: 'scoringEngine.scoreEntry.success', data: { participantCount: participants.length, totalScore, countingParticipantCount: countingIds.length } },
    'Scored entry',
  );
  return result;
}
