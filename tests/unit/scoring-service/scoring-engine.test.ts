import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import {
  applyCountingMethod,
  applyMultiplierRules,
  evaluateBonusRules,
  evaluateCondition,
  evaluatePenaltyRules,
  evaluatePositionRules,
  evaluateStatRules,
  handleDNF,
  scoreEntry,
  scoreParticipant,
} from '../../../packages/scoring-service/src/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/scoring-service/src/engine/scoring-engine';

// --- Helpers ---

function buildConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return ScoringConfigSchema.parse({
    sport: 'TEST',
    scoring_type: 'CUMULATIVE',
    ...overrides,
  });
}

function buildParticipant(overrides: Partial<ParticipantScoringData> = {}): ParticipantScoringData {
  return {
    participantId: 'p1',
    stats: {},
    isDNF: false,
    ...overrides,
  };
}

// ========================================================================
// 03-001: ScoringConfig Zod Schema
// ========================================================================

describe('ScoringConfigSchema', () => {
  it('parses a minimal config with defaults', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'NFL',
      scoring_type: 'CUMULATIVE',
    });

    expect(config.sport).toBe('NFL');
    expect(config.scoring_type).toBe('CUMULATIVE');
    expect(config.stat_rules).toEqual([]);
    expect(config.position_rules).toEqual([]);
    expect(config.bonus_rules).toEqual([]);
    expect(config.penalty_rules).toEqual([]);
    expect(config.multiplier_rules).toEqual([]);
    expect(config.dnf_handling).toBe('ZERO');
    expect(config.counting_method).toBe('ALL');
    expect(config.lower_is_better).toBe(false);
  });

  it('parses a full config with all rule types', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'GOLF',
      scoring_type: 'STROKE_PLAY',
      stat_rules: [
        { stat_key: 'total_strokes', points_per_unit: 1, description: 'Strokes' },
      ],
      position_rules: [
        { position: 1, points: 30 },
        { position_range: [2, 5], points: 15 },
      ],
      bonus_rules: [
        { trigger: { stat_key: 'birdies', condition: { operator: 'gte', value: 5 } }, points: 3 },
      ],
      penalty_rules: [
        { trigger: 'double_bogey', points: -1 },
      ],
      multiplier_rules: [
        { applies_to: 'SLOT', slot_id: 'captain', multiplier: 1.5 },
      ],
      dnf_handling: 'MISSED_CUT_SCORE',
      missed_event_score: 80,
      counting_method: 'BEST_N',
      best_n: 4,
      lower_is_better: true,
    });

    expect(config.stat_rules).toHaveLength(1);
    expect(config.position_rules).toHaveLength(2);
    expect(config.bonus_rules).toHaveLength(1);
    expect(config.penalty_rules).toHaveLength(1);
    expect(config.multiplier_rules).toHaveLength(1);
    expect(config.dnf_handling).toBe('MISSED_CUT_SCORE');
    expect(config.missed_event_score).toBe(80);
    expect(config.counting_method).toBe('BEST_N');
    expect(config.best_n).toBe(4);
    expect(config.lower_is_better).toBe(true);
  });

  it('rejects invalid scoring_type', () => {
    expect(() =>
      ScoringConfigSchema.parse({ sport: 'NFL', scoring_type: 'INVALID' }),
    ).toThrow();
  });

  it('rejects invalid dnf_handling', () => {
    expect(() =>
      ScoringConfigSchema.parse({ sport: 'NFL', scoring_type: 'CUMULATIVE', dnf_handling: 'BAD' }),
    ).toThrow();
  });

  it('parses bracket config with round rules', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'NCAA_BASKETBALL',
      scoring_type: 'BRACKET',
      bracket_round_rules: [
        { round: 1, round_name: 'Round of 64', points_per_correct: 1 },
        { round: 2, round_name: 'Round of 32', points_per_correct: 2 },
      ],
      upset_bonus_config: { type: 'SEED_DIFFERENCE', apply_round_multiplier: false },
    });

    expect(config.bracket_round_rules).toHaveLength(2);
    expect(config.upset_bonus_config?.type).toBe('SEED_DIFFERENCE');
  });
});

// ========================================================================
// Condition Evaluation
// ========================================================================

describe('evaluateCondition', () => {
  it.each([
    ['eq', 5, 5, true],
    ['eq', 5, 4, false],
    ['gt', 5, 6, true],
    ['gt', 5, 5, false],
    ['gte', 5, 5, true],
    ['gte', 5, 4, false],
    ['lt', 5, 4, true],
    ['lt', 5, 5, false],
    ['lte', 5, 5, true],
    ['lte', 5, 6, false],
  ] as const)('%s: value=%d, test=%d → %s', (op, threshold, value, expected) => {
    expect(evaluateCondition({ operator: op, value: threshold }, value)).toBe(expected);
  });

  it('evaluates between operator', () => {
    expect(evaluateCondition({ operator: 'between', value: 3, value2: 7 }, 5)).toBe(true);
    expect(evaluateCondition({ operator: 'between', value: 3, value2: 7 }, 3)).toBe(true);
    expect(evaluateCondition({ operator: 'between', value: 3, value2: 7 }, 7)).toBe(true);
    expect(evaluateCondition({ operator: 'between', value: 3, value2: 7 }, 2)).toBe(false);
    expect(evaluateCondition({ operator: 'between', value: 3, value2: 7 }, 8)).toBe(false);
  });
});

// ========================================================================
// 03-002: Stat Rules
// ========================================================================

describe('evaluateStatRules', () => {
  it('calculates points for simple stat rules', () => {
    const rules = [
      { stat_key: 'passing_td', points_per_unit: 4 },
      { stat_key: 'interception_thrown', points_per_unit: -2 },
    ];
    const stats = { passing_td: 3, interception_thrown: 1 };

    expect(evaluateStatRules(rules, stats)).toBe(10); // 3*4 + 1*(-2)
  });

  it('handles unit_size (e.g. 1pt per 25 passing yards)', () => {
    const rules = [
      { stat_key: 'passing_yards', points_per_unit: 0.04, unit_size: 1 },
    ];
    // 300 yards * 0.04 = 12 points
    expect(evaluateStatRules(rules, { passing_yards: 300 })).toBe(12);
  });

  it('ignores stats not present in deltas', () => {
    const rules = [
      { stat_key: 'rushing_td', points_per_unit: 6 },
      { stat_key: 'fumble_lost', points_per_unit: -2 },
    ];
    expect(evaluateStatRules(rules, { rushing_td: 2 })).toBe(12);
  });

  it('applies conditional stat rules', () => {
    const rules = [
      {
        stat_key: 'rushing_yards',
        points_per_unit: 0.1,
        condition: { operator: 'gte' as const, value: 50 },
      },
    ];
    // Only scores if rushing_yards >= 50
    expect(evaluateStatRules(rules, { rushing_yards: 100 })).toBe(10);
    expect(evaluateStatRules(rules, { rushing_yards: 49 })).toBe(0);
  });

  it('returns 0 for empty rules', () => {
    expect(evaluateStatRules([], { foo: 10 })).toBe(0);
  });

  it('returns 0 for empty stats', () => {
    const rules = [{ stat_key: 'points', points_per_unit: 1 }];
    expect(evaluateStatRules(rules, {})).toBe(0);
  });
});

// ========================================================================
// 03-003: Position Rules
// ========================================================================

describe('evaluatePositionRules', () => {
  const rules = [
    { position: 1, points: 25 },
    { position: 2, points: 18 },
    { position: 3, points: 15 },
    { position_range: [4, 10] as [number, number], points: 5 },
  ];

  it('returns points for exact position match', () => {
    expect(evaluatePositionRules(rules, 1)).toBe(25);
    expect(evaluatePositionRules(rules, 2)).toBe(18);
    expect(evaluatePositionRules(rules, 3)).toBe(15);
  });

  it('returns points for position within range', () => {
    expect(evaluatePositionRules(rules, 4)).toBe(5);
    expect(evaluatePositionRules(rules, 7)).toBe(5);
    expect(evaluatePositionRules(rules, 10)).toBe(5);
  });

  it('returns 0 for unmatched position', () => {
    expect(evaluatePositionRules(rules, 11)).toBe(0);
  });

  it('returns 0 for undefined position', () => {
    expect(evaluatePositionRules(rules, undefined)).toBe(0);
  });

  it('handles LAST position', () => {
    const lastRules = [{ position: 'LAST' as const, points: -10 }];
    expect(evaluatePositionRules(lastRules, 20, 20)).toBe(-10);
    expect(evaluatePositionRules(lastRules, 19, 20)).toBe(0);
  });
});

// ========================================================================
// 03-004: Bonus & Penalty Rules
// ========================================================================

describe('evaluateBonusRules', () => {
  it('awards bonus when condition is met', () => {
    const rules = [
      {
        trigger: { stat_key: 'passing_yards', condition: { operator: 'gte' as const, value: 300 } },
        points: 3,
      },
    ];
    expect(evaluateBonusRules(rules, { passing_yards: 350 })).toBe(3);
  });

  it('does not award bonus when condition is not met', () => {
    const rules = [
      {
        trigger: { stat_key: 'passing_yards', condition: { operator: 'gte' as const, value: 300 } },
        points: 3,
      },
    ];
    expect(evaluateBonusRules(rules, { passing_yards: 250 })).toBe(0);
  });

  it('awards multiple bonuses independently', () => {
    const rules = [
      {
        trigger: { stat_key: 'passing_yards', condition: { operator: 'gte' as const, value: 300 } },
        points: 3,
      },
      {
        trigger: { stat_key: 'rushing_yards', condition: { operator: 'gte' as const, value: 100 } },
        points: 3,
      },
    ];
    expect(evaluateBonusRules(rules, { passing_yards: 350, rushing_yards: 120 })).toBe(6);
  });

  it('ignores bonuses for missing stats', () => {
    const rules = [
      {
        trigger: { stat_key: 'rushing_yards', condition: { operator: 'gte' as const, value: 100 } },
        points: 3,
      },
    ];
    expect(evaluateBonusRules(rules, {})).toBe(0);
  });
});

describe('evaluatePenaltyRules', () => {
  it('applies penalty when stat is present and > 0', () => {
    const rules = [{ trigger: 'spots_lost_10_plus', points: -5 }];
    expect(evaluatePenaltyRules(rules, { spots_lost_10_plus: 1 })).toBe(-5);
  });

  it('does not apply penalty when stat is 0', () => {
    const rules = [{ trigger: 'spots_lost_10_plus', points: -5 }];
    expect(evaluatePenaltyRules(rules, { spots_lost_10_plus: 0 })).toBe(0);
  });

  it('does not apply penalty when stat is missing', () => {
    const rules = [{ trigger: 'spots_lost_10_plus', points: -5 }];
    expect(evaluatePenaltyRules(rules, {})).toBe(0);
  });
});

// ========================================================================
// 03-005: Multiplier Rules
// ========================================================================

describe('applyMultiplierRules', () => {
  it('applies ALL multiplier to entire score', () => {
    const rules = [{ applies_to: 'ALL' as const, multiplier: 2.0 }];
    expect(applyMultiplierRules(rules, { statPoints: 10, positionPoints: 5 })).toBe(30);
  });

  it('applies SLOT multiplier when slot matches', () => {
    const rules = [{ applies_to: 'SLOT' as const, slot_id: 'captain', multiplier: 1.5 }];
    expect(applyMultiplierRules(rules, { statPoints: 10, positionPoints: 0 }, 'captain')).toBe(15);
  });

  it('does not apply SLOT multiplier when slot does not match', () => {
    const rules = [{ applies_to: 'SLOT' as const, slot_id: 'captain', multiplier: 1.5 }];
    expect(applyMultiplierRules(rules, { statPoints: 10, positionPoints: 0 }, 'bench')).toBe(10);
  });

  it('applies POSITION multiplier to position points only', () => {
    const rules = [{ applies_to: 'POSITION' as const, multiplier: 2.0 }];
    expect(applyMultiplierRules(rules, { statPoints: 10, positionPoints: 5 })).toBe(20);
    // statPoints(10) + positionPoints(5) * 2.0 = 20
  });

  it('returns base total when no rules match', () => {
    expect(applyMultiplierRules([], { statPoints: 10, positionPoints: 5 })).toBe(15);
  });
});

// ========================================================================
// 03-006: DNF / Missed Cut Handling
// ========================================================================

describe('handleDNF', () => {
  it('returns raw score for non-DNF participant', () => {
    const config = buildConfig();
    const participant = buildParticipant();
    expect(handleDNF(config, participant, 25)).toEqual({ score: 25, excluded: false });
  });

  it('ZERO: returns 0 for DNF', () => {
    const config = buildConfig({ dnf_handling: 'ZERO' });
    const participant = buildParticipant({ isDNF: true });
    expect(handleDNF(config, participant, 25)).toEqual({ score: 0, excluded: false });
  });

  it('EXCLUDE: returns 0 and marks excluded', () => {
    const config = buildConfig({ dnf_handling: 'EXCLUDE' });
    const participant = buildParticipant({ isDNF: true });
    expect(handleDNF(config, participant, 25)).toEqual({ score: 0, excluded: true });
  });

  it('LAST_PLACE: returns last-place position points', () => {
    const config = buildConfig({
      dnf_handling: 'LAST_PLACE',
      position_rules: [
        { position: 1, points: 25 },
        { position_range: [2, 20], points: 1 },
      ],
    });
    const participant = buildParticipant({ isDNF: true });
    expect(handleDNF(config, participant, 25, 20)).toEqual({ score: 1, excluded: false });
  });

  it('PENALTY: returns missed_event_points', () => {
    const config = buildConfig({ dnf_handling: 'PENALTY', missed_event_points: -5 });
    const participant = buildParticipant({ isDNF: true });
    expect(handleDNF(config, participant, 25)).toEqual({ score: -5, excluded: false });
  });

  it('MISSED_CUT_SCORE: returns missed_event_score (golf)', () => {
    const config = buildConfig({ dnf_handling: 'MISSED_CUT_SCORE', missed_event_score: 80 });
    const participant = buildParticipant({ isMissedCut: true, isDNF: false });
    // isMissedCut triggers DNF handling too
    expect(handleDNF(config, participant, 25)).toEqual({ score: 80, excluded: false });
  });
});

// ========================================================================
// 03-007: Counting Methods
// ========================================================================

describe('applyCountingMethod', () => {
  const scores = [
    { participantId: 'p1', score: 20, excluded: false },
    { participantId: 'p2', score: 15, excluded: false },
    { participantId: 'p3', score: 10, excluded: false },
    { participantId: 'p4', score: 5, excluded: false },
  ];

  it('ALL: sums all scores', () => {
    const config = buildConfig({ counting_method: 'ALL' });
    const result = applyCountingMethod(config, scores);
    expect(result.totalScore).toBe(50);
    expect(result.countingIds).toHaveLength(4);
  });

  it('BEST_N: takes best N scores (highest)', () => {
    const config = buildConfig({ counting_method: 'BEST_N', best_n: 2 });
    const result = applyCountingMethod(config, scores);
    expect(result.totalScore).toBe(35); // 20 + 15
    expect(result.countingIds).toEqual(['p1', 'p2']);
  });

  it('BEST_N with lower_is_better: takes lowest N scores', () => {
    const config = buildConfig({
      counting_method: 'BEST_N',
      best_n: 2,
      lower_is_better: true,
    });
    const result = applyCountingMethod(config, scores);
    expect(result.totalScore).toBe(15); // 5 + 10
    expect(result.countingIds).toEqual(['p4', 'p3']);
  });

  it('DROP_LOWEST_N: drops worst N scores', () => {
    const config = buildConfig({ counting_method: 'DROP_LOWEST_N', drop_lowest_n: 1 });
    const result = applyCountingMethod(config, scores);
    expect(result.totalScore).toBe(45); // 20 + 15 + 10 (drop 5)
    expect(result.countingIds).toHaveLength(3);
  });

  it('excludes participants marked as excluded', () => {
    const withExcluded = [
      ...scores,
      { participantId: 'p5', score: 0, excluded: true },
    ];
    const config = buildConfig({ counting_method: 'ALL' });
    const result = applyCountingMethod(config, withExcluded);
    expect(result.totalScore).toBe(50);
    expect(result.countingIds).not.toContain('p5');
  });

  it('returns 0 for all excluded', () => {
    const allExcluded = scores.map((s) => ({ ...s, excluded: true }));
    const config = buildConfig({ counting_method: 'ALL' });
    const result = applyCountingMethod(config, allExcluded);
    expect(result.totalScore).toBe(0);
    expect(result.countingIds).toHaveLength(0);
  });
});

// ========================================================================
// Integration: scoreParticipant + scoreEntry
// ========================================================================

describe('scoreParticipant', () => {
  it('combines stat, position, bonus, and penalty points', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'passing_td', points_per_unit: 4 },
        { stat_key: 'interception_thrown', points_per_unit: -2 },
      ],
      bonus_rules: [
        {
          trigger: { stat_key: 'passing_td', condition: { operator: 'gte', value: 3 } },
          points: 5,
        },
      ],
      position_rules: [{ position: 1, points: 10 }],
    });

    const participant = buildParticipant({
      stats: { passing_td: 3, interception_thrown: 1 },
      position: 1,
    });

    const result = scoreParticipant(config, participant);
    expect(result.statPoints).toBe(10);    // 3*4 + 1*(-2) = 10
    expect(result.positionPoints).toBe(10);
    expect(result.bonusPoints).toBe(5);
    expect(result.finalScore).toBe(25);
  });

  it('handles DNF participant', () => {
    const config = buildConfig({
      stat_rules: [{ stat_key: 'points', points_per_unit: 1 }],
      dnf_handling: 'ZERO',
    });

    const participant = buildParticipant({
      stats: { points: 30 },
      isDNF: true,
    });

    const result = scoreParticipant(config, participant);
    expect(result.finalScore).toBe(0);
  });
});

describe('scoreEntry', () => {
  it('scores a roster with BEST_N counting', () => {
    const config = buildConfig({
      sport: 'GOLF',
      scoring_type: 'STROKE_PLAY',
      stat_rules: [{ stat_key: 'total_strokes', points_per_unit: 1 }],
      counting_method: 'BEST_N',
      best_n: 2,
      lower_is_better: true,
    });

    const participants: ParticipantScoringData[] = [
      buildParticipant({ participantId: 'g1', stats: { total_strokes: 70 } }),
      buildParticipant({ participantId: 'g2', stats: { total_strokes: 68 } }),
      buildParticipant({ participantId: 'g3', stats: { total_strokes: 75 } }),
    ];

    const result = scoreEntry(config, participants);
    // Best 2 (lowest): 68 + 70 = 138
    expect(result.totalScore).toBe(138);
    expect(result.countingParticipantIds).toEqual(['g2', 'g1']);
  });

  it('excludes DNF participants with EXCLUDE policy', () => {
    const config = buildConfig({
      stat_rules: [{ stat_key: 'points', points_per_unit: 1 }],
      dnf_handling: 'EXCLUDE',
      counting_method: 'ALL',
    });

    const participants: ParticipantScoringData[] = [
      buildParticipant({ participantId: 'p1', stats: { points: 20 } }),
      buildParticipant({ participantId: 'p2', stats: { points: 15 }, isDNF: true }),
      buildParticipant({ participantId: 'p3', stats: { points: 10 } }),
    ];

    const result = scoreEntry(config, participants);
    expect(result.totalScore).toBe(30); // 20 + 10, p2 excluded
    expect(result.countingParticipantIds).not.toContain('p2');
  });

  it('scores NFL-style config end-to-end', () => {
    const config = buildConfig({
      sport: 'NFL',
      stat_rules: [
        { stat_key: 'passing_yards', points_per_unit: 0.04 },
        { stat_key: 'passing_td', points_per_unit: 4 },
        { stat_key: 'interception_thrown', points_per_unit: -2 },
        { stat_key: 'rushing_yards', points_per_unit: 0.1 },
        { stat_key: 'rushing_td', points_per_unit: 6 },
      ],
      bonus_rules: [
        {
          trigger: { stat_key: 'passing_yards', condition: { operator: 'gte', value: 300 } },
          points: 3,
        },
      ],
    });

    const qb = buildParticipant({
      participantId: 'mahomes',
      stats: {
        passing_yards: 350,
        passing_td: 3,
        interception_thrown: 1,
        rushing_yards: 40,
      },
    });

    const result = scoreParticipant(config, qb);
    // passing: 350 * 0.04 = 14
    // passing_td: 3 * 4 = 12
    // int: 1 * -2 = -2
    // rushing: 40 * 0.1 = 4
    // bonus: 3 (300+ passing yards)
    expect(result.statPoints).toBe(28);
    expect(result.bonusPoints).toBe(3);
    expect(result.finalScore).toBe(31);
  });
});
