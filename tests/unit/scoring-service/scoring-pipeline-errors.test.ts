/**
 * Unit tests — Scoring Pipeline Error Paths
 *
 * Tests the scoring pipeline's behavior when given unexpected, empty,
 * or edge-case input. Covers stat-event-consumer, scoring-engine,
 * and standings-rollup error handling.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { EventBus } from '@poolmaster/shared/events/event-bus';
import {
  scoreParticipant,
  scoreEntry,
} from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import { assignRanks, StandingsRollup } from '../../../packages/core-api/src/modules/scoring/rollup/standings-rollup';

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

// pool-master-rop.78.3 — handleStatEvent and the StatEvent contract
// were retired with the typed LiveScoreResult bus boundary (plans/117 §10.3).
// rop.78.7 reconstitutes the consumer against live_score.persisted; the
// equivalent error-path coverage moves to that slice.

// ========================================================================
// scoreParticipant — unexpected stat inputs
// ========================================================================

describe('scoreParticipant error paths', () => {
  it('returns 0 for an unknown stat_key not in config (no crash)', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'passing_yards', points_per_unit: 1 },
      ],
    });

    // Participant has a stat key that does NOT match any rule
    const participant = buildParticipant({
      stats: { rushing_yards: 100 },
    });

    const result = scoreParticipant(config, participant);

    // The unknown key produces 0 stat points — engine doesn't crash
    expect(result.statPoints).toBe(0);
    expect(result.finalScore).toBe(0);
  });

  it('returns finalScore = 0 with empty stats object', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'passing_yards', points_per_unit: 1 },
      ],
    });

    const participant = buildParticipant({ stats: {} });

    const result = scoreParticipant(config, participant);

    expect(result.statPoints).toBe(0);
    expect(result.finalScore).toBe(0);
  });

  it('correctly multiplies negative stat values', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'turnovers', points_per_unit: -2 },
      ],
    });

    const participant = buildParticipant({
      stats: { turnovers: -3 },
    });

    const result = scoreParticipant(config, participant);

    // Math.floor(-3 / 1) * (-2) * 1 = -3 * -2 = 6
    expect(result.statPoints).toBe(6);
    expect(result.finalScore).toBe(6);
  });
});

// ========================================================================
// 5-8. assignRanks — edge cases
// ========================================================================

describe('assignRanks error paths', () => {
  it('returns empty array for empty leaderboard', () => {
    const result = assignRanks([]);
    expect(result).toEqual([]);
  });

  it('assigns rank 1 to a single entry', () => {
    const result = assignRanks([{ entryId: 'e1', total: 42 }]);

    expect(result).toHaveLength(1);
    expect(result[0].rank).toBe(1);
    expect(result[0].totalScore).toBe(42);
    expect(result[0].isTied).toBe(false);
  });

  it('gives tied entries the same rank', () => {
    const result = assignRanks([
      { entryId: 'e1', total: 100 },
      { entryId: 'e2', total: 100 },
      { entryId: 'e3', total: 50 },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
    expect(result[1].isTied).toBe(true);
    // Third entry should be rank 3 (standard competition ranking)
    expect(result[2].rank).toBe(3);
    expect(result[2].isTied).toBe(false);
  });

  it('assigns rank 1 to all entries when all have the same score', () => {
    const result = assignRanks([
      { entryId: 'e1', total: 77 },
      { entryId: 'e2', total: 77 },
      { entryId: 'e3', total: 77 },
    ]);

    expect(result).toHaveLength(3);
    expect(result[0].rank).toBe(1);
    expect(result[1].rank).toBe(1);
    expect(result[2].rank).toBe(1);
    // First entry is not marked as tied (no previous entry), but 2nd and 3rd are
    expect(result[0].isTied).toBe(false);
    expect(result[1].isTied).toBe(true);
    expect(result[2].isTied).toBe(true);
  });
});

// ========================================================================
// 9. scoreEntry — BEST_N with DNF participant excluded
// ========================================================================

describe('scoreEntry error paths', () => {
  it('excludes DNF participant from BEST_N count', () => {
    const config = buildConfig({
      counting_method: 'BEST_N',
      best_n: 2,
      dnf_handling: 'EXCLUDE',
      stat_rules: [
        { stat_key: 'points', points_per_unit: 1 },
      ],
    });

    const participants: ParticipantScoringData[] = [
      buildParticipant({ participantId: 'p1', stats: { points: 10 } }),
      buildParticipant({ participantId: 'p2', stats: { points: 20 } }),
      buildParticipant({ participantId: 'p3', stats: { points: 15 }, isDNF: true }),
    ];

    const result = scoreEntry(config, participants);

    // p3 is DNF with EXCLUDE — should not count
    expect(result.countingParticipantIds).not.toContain('p3');
    // Best 2 of the eligible (p1=10, p2=20) → both count
    expect(result.countingParticipantIds).toContain('p1');
    expect(result.countingParticipantIds).toContain('p2');
    expect(result.totalScore).toBe(30); // 10 + 20
  });

  it('returns totalScore = 0 when all participants score 0', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'points', points_per_unit: 1 },
      ],
    });

    const participants: ParticipantScoringData[] = [
      buildParticipant({ participantId: 'p1', stats: { points: 0 } }),
      buildParticipant({ participantId: 'p2', stats: { points: 0 } }),
    ];

    const result = scoreEntry(config, participants);

    expect(result.totalScore).toBe(0);
    // All participants should still be counted (not excluded)
    expect(result.countingParticipantIds).toHaveLength(2);
    expect(result.participantBreakdowns).toHaveLength(2);
  });
});

// ========================================================================
// 11. scoreParticipant — config references keys not in stats
// ========================================================================

describe('scoreParticipant with missing stat keys', () => {
  it('returns 0 for stat_rules referencing keys not present in participant stats', () => {
    const config = buildConfig({
      stat_rules: [
        { stat_key: 'passing_yards', points_per_unit: 1 },
        { stat_key: 'rushing_yards', points_per_unit: 2 },
        { stat_key: 'receiving_yards', points_per_unit: 1 },
      ],
    });

    // Participant only has passing_yards — the other two are missing
    const participant = buildParticipant({
      stats: { passing_yards: 50 },
    });

    const result = scoreParticipant(config, participant);

    // Only passing_yards contributes: 50 * 1 = 50
    expect(result.statPoints).toBe(50);
    expect(result.finalScore).toBe(50);
  });
});

// ========================================================================
// 12. StandingsRollup — periodic-mode surface retired (pool-master-rop.78.8)
// ========================================================================

describe('StandingsRollup periodic-mode surface (retired in rop.78.8)', () => {
  it('does not expose `rollupAll` / periodic scheduler methods', () => {
    // Pre-rop.78.8 the rollup ran on a 30s setInterval and had a
    // `rollupAll` / `startPeriodicRollup` / `stopPeriodicRollup` /
    // `isRunning` / `getActiveContestIds` / `registerContest` /
    // `unregisterContest` surface. Plans/117 §11.3 retired the periodic
    // path so the substrate has a single event-driven write path.
    const rollup = new StandingsRollup({
      eventBus: new EventBus(),
      prisma: { contestEntry: { findMany: jest.fn() } } as any,
    });

    expect(rollup).not.toHaveProperty('rollupAll');
    expect(rollup).not.toHaveProperty('startPeriodicRollup');
    expect(rollup).not.toHaveProperty('stopPeriodicRollup');
    expect(rollup).not.toHaveProperty('isRunning');
    expect(rollup).not.toHaveProperty('getActiveContestIds');
    expect(rollup).not.toHaveProperty('registerContest');
    expect(rollup).not.toHaveProperty('unregisterContest');
  });
});
