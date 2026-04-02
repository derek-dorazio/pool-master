/**
 * Unit tests — Scoring Pipeline Error Paths
 *
 * Tests the scoring pipeline's behavior when given unexpected, empty,
 * or edge-case input. Covers stat-event-consumer, scoring-engine,
 * standings-rollup, and score-store error handling.
 */

import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import type { StatEvent } from '@poolmaster/shared/events/scoring';
import { EventBus } from '@poolmaster/shared/events/event-bus';
import {
  scoreParticipant,
  scoreEntry,
} from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import type { ParticipantScoringData } from '../../../packages/core-api/src/modules/scoring/engine/scoring-engine';
import {
  handleStatEvent,
} from '../../../packages/core-api/src/modules/scoring/consumer/stat-event-consumer';
import type { StatEventConsumerDeps } from '../../../packages/core-api/src/modules/scoring/consumer/stat-event-consumer';
import { assignRanks, StandingsRollup } from '../../../packages/core-api/src/modules/scoring/rollup/standings-rollup';
import type { ScoreStore } from '../../../packages/core-api/src/modules/scoring/storage/score-store';

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

function buildStatEvent(overrides: Partial<StatEvent> = {}): StatEvent {
  return {
    id: 'evt-1',
    type: 'stat.received',
    sourceService: 'ingestion-worker',
    timestamp: '2026-01-01T00:00:00Z',
    tenantId: 'tenant-1',
    eventId: 'evt-1',
    participantExternalId: 'ext-p1',
    statKey: 'passing_yards',
    statValue: 300,
    isCorrection: false,
    providerId: 'provider-1',
    ingestedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createMockScoreStore(overrides: Partial<ScoreStore> = {}): ScoreStore {
  return {
    appendParticipantScore: jest.fn().mockResolvedValue(undefined),
    appendEntryScore: jest.fn().mockResolvedValue(undefined),
    getEntryTotal: jest.fn().mockResolvedValue(0),
    getLeaderboard: jest.fn().mockResolvedValue([]),
    getEntryTimeline: jest.fn().mockResolvedValue([]),
    getParticipantScores: jest.fn().mockResolvedValue([]),
    clear: jest.fn(),
    ...overrides,
  } as unknown as ScoreStore;
}

function createMockContestLookup(
  contests: { contestId: string; scoringRules: ScoringConfig }[] = [],
  entries: { entryId: string; entryName: string; participantIds: string[] }[] = [],
) {
  return {
    findActiveContestsForParticipant: jest.fn().mockResolvedValue(
      contests.map((c) => ({
        contestId: c.contestId,
        scoringEngine: 'default',
        scoringRules: c.scoringRules,
      })),
    ),
    findEntriesWithParticipant: jest.fn().mockResolvedValue(entries),
    getScoringConfig: jest.fn().mockResolvedValue(undefined),
    clear: jest.fn(),
  };
}

// ========================================================================
// 1. handleStatEvent — participant not in any contest
// ========================================================================

describe('handleStatEvent error paths', () => {
  it('does nothing when participant is not in any contest', async () => {
    const eventBus = new EventBus();
    const scoreStore = createMockScoreStore();
    const contestLookup = createMockContestLookup([], []);

    const deps: StatEventConsumerDeps = {
      eventBus,
      scoreStore,
      contestLookup: contestLookup as any,
    };

    const event = buildStatEvent();

    // Should not throw
    await handleStatEvent(event, deps);

    // No scores should be stored
    expect(scoreStore.appendParticipantScore).not.toHaveBeenCalled();
    expect(scoreStore.appendEntryScore).not.toHaveBeenCalled();
  });
});

// ========================================================================
// 2-4. scoreParticipant — unexpected stat inputs
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
// 12. StandingsRollup.rollupContest — no registered contests
// ========================================================================

describe('StandingsRollup error paths', () => {
  it('rollupAll returns empty results when no contests are registered', async () => {
    const eventBus = new EventBus();
    const scoreStore = createMockScoreStore();
    const mockPrisma = {} as any;

    const rollup = new StandingsRollup({
      eventBus,
      scoreStore,
      prisma: mockPrisma,
    });

    // No contests registered — rollupAll should complete gracefully
    const results = await rollup.rollupAll();

    expect(results).toEqual([]);
    expect(scoreStore.getLeaderboard).not.toHaveBeenCalled();
  });
});
