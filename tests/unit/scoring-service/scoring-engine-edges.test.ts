/**
 * Unit tests — Scoring Engine edge cases
 *
 * Covers uncovered lines in scoring-engine.ts:
 * - DNF handling with MISSED_CUT_SCORE method (line ~186)
 * - Counting method with lower_is_better=true
 * - Position rule with type: 'LAST'
 * - Empty stats object for a participant
 * - Bonus rule where condition is not met
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import {
  applyCountingMethod,
  applyMultiplierRules,
  evaluateBonusRules,
  evaluatePositionRules,
  handleDNF,
  scoreParticipant,
} from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';

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
// Edge case tests
// ========================================================================

describe('Scoring Engine Edge Cases', () => {
  describe('DNF handling — MISSED_CUT_SCORE method', () => {
    it('returns the configured missed_event_score when participant has missed cut', () => {
      const config = buildConfig({
        dnf_handling: 'MISSED_CUT_SCORE',
        missed_event_score: 10,
      });
      const participant = buildParticipant({
        isDNF: false,
        isMissedCut: true,
      });

      const result = handleDNF(config, participant, 50);
      expect(result.score).toBe(10);
      expect(result.excluded).toBe(false);
    });

    it('returns 0 when MISSED_CUT_SCORE is configured but missed_event_score is not set', () => {
      const config = buildConfig({
        dnf_handling: 'MISSED_CUT_SCORE',
        // missed_event_score intentionally omitted
      });
      const participant = buildParticipant({
        isDNF: true,
      });

      const result = handleDNF(config, participant, 50);
      expect(result.score).toBe(0);
      expect(result.excluded).toBe(false);
    });
  });

  describe('Counting method with lower_is_better=true', () => {
    it('BEST_N selects the lowest N scores when lower_is_better is true', () => {
      const config = buildConfig({
        counting_method: 'BEST_N',
        best_n: 2,
        lower_is_better: true,
      });

      const scores = [
        { participantId: 'p1', score: 72, excluded: false },
        { participantId: 'p2', score: 68, excluded: false },
        { participantId: 'p3', score: 75, excluded: false },
      ];

      const result = applyCountingMethod(config, scores);
      // lower_is_better sorts ascending, so best 2 are 68 and 72
      expect(result.countingIds).toHaveLength(2);
      expect(result.countingIds).toContain('p2');
      expect(result.countingIds).toContain('p1');
      expect(result.totalScore).toBe(68 + 72);
    });
  });

  describe('Position rule with type LAST', () => {
    it('awards points to the participant in last position', () => {
      const rules = [
        { position: 'LAST' as const, points: -5 },
      ];

      // Position 10 out of 10 = last
      const result = evaluatePositionRules(rules, 10, 10);
      expect(result).toBe(-5);
    });

    it('does not award LAST points when participant is not in last position', () => {
      const rules = [
        { position: 'LAST' as const, points: -5 },
      ];

      const result = evaluatePositionRules(rules, 5, 10);
      expect(result).toBe(0);
    });
  });

  describe('Empty stats object for a participant', () => {
    it('scores a participant with empty stats as zero across all categories', () => {
      const config = buildConfig({
        stat_rules: [
          { stat_key: 'PASSING_YARDS', points_per_unit: 1, unit_size: 25 },
        ],
        bonus_rules: [
          { trigger: { stat_key: 'TOUCHDOWNS', condition: { operator: 'gte', value: 3 } }, points: 5 },
        ],
        penalty_rules: [
          { trigger: 'INTERCEPTIONS', points: -2 },
        ],
      });
      const participant = buildParticipant({ stats: {} });

      const breakdown = scoreParticipant(config, participant);
      expect(breakdown.statPoints).toBe(0);
      expect(breakdown.bonusPoints).toBe(0);
      expect(breakdown.penaltyPoints).toBe(0);
      expect(breakdown.finalScore).toBe(0);
    });
  });

  describe('Bonus rule where condition is not met', () => {
    it('does not award bonus when stat value fails condition check', () => {
      const rules = [
        {
          trigger: { stat_key: 'TOUCHDOWNS', condition: { operator: 'gte' as const, value: 3 } },
          points: 10,
        },
      ];

      // Player only has 2 TDs — condition is gte 3, so bonus should NOT fire
      const result = evaluateBonusRules(rules, { TOUCHDOWNS: 2 });
      expect(result).toBe(0);
    });

    it('awards bonus when stat value meets condition', () => {
      const rules = [
        {
          trigger: { stat_key: 'TOUCHDOWNS', condition: { operator: 'gte' as const, value: 3 } },
          points: 10,
        },
      ];

      const result = evaluateBonusRules(rules, { TOUCHDOWNS: 3 });
      expect(result).toBe(10);
    });
  });

  describe('Multiplier rule with applies_to STAT (lines 186-189)', () => {
    it('applies STAT multiplier when the stat_key exists in participant stats', () => {
      const rules = [
        { applies_to: 'STAT' as const, stat_key: 'PASSING_YARDS', multiplier: 2 },
      ];

      const result = applyMultiplierRules(
        rules,
        { statPoints: 10, positionPoints: 5 },
        undefined,
        { PASSING_YARDS: 300 },
      );
      // (10 + 5) * 2 = 30
      expect(result).toBe(30);
    });

    it('does not apply STAT multiplier when stat_key is missing from stats', () => {
      const rules = [
        { applies_to: 'STAT' as const, stat_key: 'PASSING_YARDS', multiplier: 2 },
      ];

      const result = applyMultiplierRules(
        rules,
        { statPoints: 10, positionPoints: 5 },
        undefined,
        { RUSHING_YARDS: 100 }, // different stat key
      );
      // No multiplier applied: 10 + 5 = 15
      expect(result).toBe(15);
    });
  });
});
