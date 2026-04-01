import { ScoringConfigSchema, SpecialSlotConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import type { ScoringConfig, TiebreakerConfig } from '@poolmaster/shared/domain/scoring-config';
import {
  evaluateTiebreaker,
  rankWithTiebreakers,
} from '../../../packages/core-api/src/modules/scoring/engine/tiebreaker';
import type { TiebreakerData } from '../../../packages/core-api/src/modules/scoring/engine/tiebreaker';
import {
  STAT_SCHEMAS,
  getStatSchema,
  listSports,
  validateStatKeys,
} from '../../../packages/core-api/src/modules/scoring/engine/stat-schemas';
import { scoreParticipant } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import { getTemplate, listTemplates } from '../../../packages/core-api/src/modules/scoring/templates/registry';

// ========================================================================
// 03-017: Special Roster Slot Configuration
// ========================================================================

describe('SpecialSlotConfig', () => {
  it('parses a captain slot config', () => {
    const slot = SpecialSlotConfigSchema.parse({
      slot_id: 'captain',
      slot_name: 'Captain',
      multiplier: 1.5,
      cost_multiplier: 1.5,
      max_per_roster: 1,
    });
    expect(slot.slot_id).toBe('captain');
    expect(slot.multiplier).toBe(1.5);
    expect(slot.cost_multiplier).toBe(1.5);
    expect(slot.max_per_roster).toBe(1);
  });

  it('parses a MVP slot with eligible positions', () => {
    const slot = SpecialSlotConfigSchema.parse({
      slot_id: 'mvp',
      slot_name: 'MVP',
      multiplier: 2.0,
      max_per_roster: 1,
      eligible_positions: ['QB', 'RB', 'WR'],
    });
    expect(slot.eligible_positions).toEqual(['QB', 'RB', 'WR']);
  });

  it('defaults max_per_roster to 1', () => {
    const slot = SpecialSlotConfigSchema.parse({
      slot_id: 'dd',
      slot_name: 'Double Down',
      multiplier: 2.0,
    });
    expect(slot.max_per_roster).toBe(1);
  });

  it('ScoringConfig includes special_slots', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'F1',
      scoring_type: 'CUMULATIVE',
      special_slots: [
        { slot_id: 'captain', slot_name: 'Captain', multiplier: 1.5 },
        { slot_id: 'double_down', slot_name: 'Double Down', multiplier: 2.0 },
      ],
    });
    expect(config.special_slots).toHaveLength(2);
  });

  it('captain slot multiplier applies to participant in captain slot', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'NFL',
      scoring_type: 'CUMULATIVE',
      stat_rules: [{ stat_key: 'passing_td', points_per_unit: 4 }],
      multiplier_rules: [{ applies_to: 'SLOT', slot_id: 'captain', multiplier: 1.5 }],
      special_slots: [{ slot_id: 'captain', slot_name: 'Captain', multiplier: 1.5 }],
    });

    const captainPlayer: ParticipantScoringData = {
      participantId: 'mahomes',
      stats: { passing_td: 3 },
      slotId: 'captain',
      isDNF: false,
    };

    const normalPlayer: ParticipantScoringData = {
      participantId: 'allen',
      stats: { passing_td: 3 },
      isDNF: false,
    };

    const captainResult = scoreParticipant(config, captainPlayer);
    const normalResult = scoreParticipant(config, normalPlayer);

    expect(captainResult.finalScore).toBe(18); // 12 * 1.5
    expect(normalResult.finalScore).toBe(12);  // 12, no multiplier
  });
});

// ========================================================================
// 03-018: Tiebreaker Chain Evaluation
// ========================================================================

describe('Tiebreaker evaluation', () => {
  const entryA: TiebreakerData = {
    entryId: 'a',
    totalScore: 100,
    tiebreakerPrediction: 145,
    correctPicks: 30,
    submittedAt: new Date('2026-03-20T10:00:00Z'),
    bestSingleScore: 50,
    birdieCount: 20,
    lowestRound: 65,
    headToHeadWins: 5,
    totalWins: 10,
  };

  const entryB: TiebreakerData = {
    entryId: 'b',
    totalScore: 100,
    tiebreakerPrediction: 155,
    correctPicks: 28,
    submittedAt: new Date('2026-03-20T11:00:00Z'),
    bestSingleScore: 45,
    birdieCount: 18,
    lowestRound: 67,
    headToHeadWins: 3,
    totalWins: 8,
  };

  it('CHAMPIONSHIP_SCORE_PREDICTION: closer prediction wins', () => {
    const config: TiebreakerConfig = { primary: 'CHAMPIONSHIP_SCORE_PREDICTION' };
    // Actual score is 150 → A is 5 away, B is 5 away → tie
    expect(evaluateTiebreaker(config, entryA, entryB, 150)).toBe(0);
    // Actual 148 → A is 3 away, B is 7 → A wins
    expect(evaluateTiebreaker(config, entryA, entryB, 148)).toBe(-1);
    // Actual 160 → A is 15 away, B is 5 → B wins
    expect(evaluateTiebreaker(config, entryA, entryB, 160)).toBe(1);
  });

  it('MOST_CORRECT_PICKS: more picks wins', () => {
    const config: TiebreakerConfig = { primary: 'MOST_CORRECT_PICKS' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1); // A has 30 > 28
  });

  it('EARLIER_SUBMISSION: earlier time wins', () => {
    const config: TiebreakerConfig = { primary: 'EARLIER_SUBMISSION' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1); // A submitted earlier
  });

  it('BEST_SINGLE_SCORE: higher best score wins', () => {
    const config: TiebreakerConfig = { primary: 'BEST_SINGLE_SCORE' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1); // A has 50 > 45
  });

  it('MOST_BIRDIES: more birdies wins', () => {
    const config: TiebreakerConfig = { primary: 'MOST_BIRDIES' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1);
  });

  it('LOWEST_ROUND: lower round wins', () => {
    const config: TiebreakerConfig = { primary: 'LOWEST_ROUND' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1); // 65 < 67
  });

  it('HEAD_TO_HEAD_RECORD: more h2h wins wins', () => {
    const config: TiebreakerConfig = { primary: 'HEAD_TO_HEAD_RECORD' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1);
  });

  it('MOST_WINS: more wins wins', () => {
    const config: TiebreakerConfig = { primary: 'MOST_WINS' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1);
  });

  it('COIN_FLIP: returns 0 (unresolvable)', () => {
    const config: TiebreakerConfig = { primary: 'COIN_FLIP' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(0);
  });

  it('COMMISSIONER_DECISION: returns 0 (manual)', () => {
    const config: TiebreakerConfig = { primary: 'COMMISSIONER_DECISION' };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(0);
  });

  it('chain falls through primary to secondary', () => {
    const config: TiebreakerConfig = {
      primary: 'COIN_FLIP',           // unresolvable → 0
      secondary: 'MOST_CORRECT_PICKS', // A wins
    };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1);
  });

  it('chain falls through all three', () => {
    const config: TiebreakerConfig = {
      primary: 'COIN_FLIP',
      secondary: 'COMMISSIONER_DECISION',
      tertiary: 'EARLIER_SUBMISSION',
    };
    expect(evaluateTiebreaker(config, entryA, entryB)).toBe(-1);
  });
});

describe('rankWithTiebreakers', () => {
  it('sorts by score descending then tiebreaker', () => {
    const entries: TiebreakerData[] = [
      { entryId: 'c', totalScore: 80, correctPicks: 10 },
      { entryId: 'a', totalScore: 100, correctPicks: 30 },
      { entryId: 'b', totalScore: 100, correctPicks: 28 },
      { entryId: 'd', totalScore: 90, correctPicks: 20 },
    ];

    const config: TiebreakerConfig = { primary: 'MOST_CORRECT_PICKS' };
    const ranked = rankWithTiebreakers(entries, config);

    expect(ranked.map((e) => e.entryId)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('works without tiebreaker config', () => {
    const entries: TiebreakerData[] = [
      { entryId: 'b', totalScore: 90 },
      { entryId: 'a', totalScore: 100 },
    ];

    const ranked = rankWithTiebreakers(entries, undefined);
    expect(ranked.map((e) => e.entryId)).toEqual(['a', 'b']);
  });
});

// ========================================================================
// 03-019: Sport Stat Schema Validation
// ========================================================================

describe('Stat schema validation', () => {
  it('listSports returns all defined sports', () => {
    const sports = listSports();
    expect(sports).toContain('NFL');
    expect(sports).toContain('NBA');
    expect(sports).toContain('GOLF');
    expect(sports).toContain('F1');
    expect(sports).toContain('NASCAR');
    expect(sports).toContain('TENNIS');
    expect(sports).toContain('SOCCER');
    expect(sports).toContain('HORSE_RACING');
    expect(sports).toContain('NCAA_BASKETBALL');
    expect(sports).toContain('MLB');
    expect(sports).toContain('UFC');
  });

  it('getStatSchema returns keys for known sport', () => {
    const nflKeys = getStatSchema('NFL');
    expect(nflKeys).toBeDefined();
    expect(nflKeys).toContain('passing_td');
    expect(nflKeys).toContain('rushing_yards');
  });

  it('getStatSchema returns undefined for unknown sport', () => {
    expect(getStatSchema('CRICKET')).toBeUndefined();
  });

  it('validates a correct NFL config with no errors', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'NFL',
      scoring_type: 'CUMULATIVE',
      stat_rules: [
        { stat_key: 'passing_td', points_per_unit: 4 },
        { stat_key: 'rushing_yards', points_per_unit: 0.1 },
      ],
      bonus_rules: [
        { trigger: { stat_key: 'passing_yards', condition: { operator: 'gte', value: 300 } }, points: 3 },
      ],
    });

    const errors = validateStatKeys(config);
    expect(errors).toHaveLength(0);
  });

  it('detects invalid stat_key in stat_rules', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'NFL',
      scoring_type: 'CUMULATIVE',
      stat_rules: [
        { stat_key: 'passing_td', points_per_unit: 4 },
        { stat_key: 'three_pointer_made', points_per_unit: 1 }, // NBA stat, not NFL
      ],
    });

    const errors = validateStatKeys(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('stat_rules');
    expect(errors[0].stat_key).toBe('three_pointer_made');
  });

  it('detects invalid bonus trigger stat_key', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'GOLF',
      scoring_type: 'CUMULATIVE',
      bonus_rules: [
        { trigger: { stat_key: 'home_runs', condition: { operator: 'gte', value: 1 } }, points: 5 },
      ],
    });

    const errors = validateStatKeys(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('bonus_rules');
  });

  it('detects invalid penalty trigger', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'F1',
      scoring_type: 'CUMULATIVE',
      penalty_rules: [
        { trigger: 'yellow_card', points: -1 }, // soccer stat, not F1
      ],
    });

    const errors = validateStatKeys(config);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('penalty_rules');
  });

  it('skips validation for unknown sport (custom leagues)', () => {
    const config = ScoringConfigSchema.parse({
      sport: 'CUSTOM_LEAGUE',
      scoring_type: 'CUMULATIVE',
      stat_rules: [{ stat_key: 'anything_goes', points_per_unit: 1 }],
    });

    const errors = validateStatKeys(config);
    expect(errors).toHaveLength(0);
  });

  it('validates all built-in templates have valid stat keys', () => {
    const templates = listTemplates();
    for (const { key } of templates) {
      const template = getTemplate(key)!;
      const config = ScoringConfigSchema.parse(template);
      const errors = validateStatKeys(config);
      expect(errors).toHaveLength(0);
    }
  });
});

// ========================================================================
// 03-020: Scoring Template Library
// ========================================================================

describe('Template library', () => {
  it('lists all templates with sport info', () => {
    const templates = listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(12);

    const sports = new Set(templates.map((t) => t.sport));
    expect(sports.size).toBeGreaterThanOrEqual(7);
  });

  it('getTemplate returns deep copy that can be modified', () => {
    const original = getTemplate('golf_relative_to_par');
    expect(original).toBeDefined();

    // Template configs are plain objects — modifying a spread copy
    // should not affect the registry
    const copy = { ...original!, stat_rules: [...original!.stat_rules] };
    copy.stat_rules.push({ stat_key: 'custom', points_per_unit: 99 });

    const fresh = getTemplate('golf_relative_to_par');
    expect(fresh!.stat_rules).not.toContainEqual(
      expect.objectContaining({ stat_key: 'custom' }),
    );
  });

  it('all templates group correctly by sport', () => {
    const templates = listTemplates();
    const bySport = new Map<string, string[]>();
    for (const t of templates) {
      const list = bySport.get(t.sport) ?? [];
      list.push(t.key);
      bySport.set(t.sport, list);
    }

    // NFL has 0 templates (player scoring deferred)
    expect(bySport.get('NFL')?.length ?? 0).toBe(0);
    // NCAA should have 4
    expect(bySport.get('NCAA_BASKETBALL')?.length).toBe(4);
    // Golf should have 2
    expect(bySport.get('GOLF')?.length).toBe(2);
  });
});
