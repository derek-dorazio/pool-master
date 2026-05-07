/**
 * Unit tests for the pure golf-roster scoring rule per plans/117 §11.1.
 *
 * Pure-function coverage:
 *   - 'ALL' rule sums every completed round.
 *   - { TOP_N_BEST } keeps the N rounds with the lowest scoreToPar.
 *   - { SPECIFIC_ROUNDS } keeps only the listed rounds.
 *   - Non-COMPLETED rounds are dropped (PENDING / IN_PROGRESS / DNF / DSQ).
 *   - contribution always equals scoreToPar (golf-roster invariant).
 *   - Pure: same inputs always produce the same outputs (no `new Date()`,
 *     no random ids — the consumer wrapper applies persistence-time fields).
 */

import {
  scoreGolfRoster,
  type GolfRoundDetail,
} from '../../../packages/core-api/src/modules/scoring/engine/score-golf-roster';
import type { GolfRosterScoringConfig } from '@poolmaster/shared/domain';

const round = (
  n: number,
  scoreToPar: number,
  strokes: number = 72 + scoreToPar,
  status: GolfRoundDetail['status'] = 'COMPLETED',
): GolfRoundDetail => ({ round: n, strokes, scoreToPar, status });

describe('pool-master-rop.78.7 / plans/117 §11.1 — scoreGolfRoster', () => {
  describe("'ALL' rounds rule", () => {
    it('returns one contribution row per completed round, contribution = scoreToPar', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1), round(3, -3), round(4, 0)],
        rules: { roundsCount: 'ALL' },
      });
      expect(result).toEqual([
        { contestEntryPickId: 'pick-1', round: 1, strokes: 70, scoreToPar: -2, contribution: -2 },
        { contestEntryPickId: 'pick-1', round: 2, strokes: 73, scoreToPar: 1, contribution: 1 },
        { contestEntryPickId: 'pick-1', round: 3, strokes: 69, scoreToPar: -3, contribution: -3 },
        { contestEntryPickId: 'pick-1', round: 4, strokes: 72, scoreToPar: 0, contribution: 0 },
      ]);
    });

    it('drops rounds whose status is not COMPLETED', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [
          round(1, -2, 70, 'COMPLETED'),
          round(2, 0, 72, 'IN_PROGRESS'),
          round(3, 0, 72, 'PENDING'),
          round(4, 5, 77, 'DNF'),
        ],
        rules: { roundsCount: 'ALL' },
      });
      expect(result).toHaveLength(1);
      expect(result[0].round).toBe(1);
    });

    it('returns an empty array when no rounds are completed', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, 0, 72, 'IN_PROGRESS')],
        rules: { roundsCount: 'ALL' },
      });
      expect(result).toEqual([]);
    });
  });

  describe('TOP_N_BEST rounds rule', () => {
    it('keeps the N rounds with the lowest scoreToPar, sorted by round number on output', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 5), round(3, -3), round(4, 1)],
        rules: { roundsCount: { kind: 'TOP_N_BEST', topN: 2 } },
      });
      expect(result.map((r) => r.round)).toEqual([1, 3]);
      expect(result.every((r) => r.contribution === r.scoreToPar)).toBe(true);
    });

    it('breaks ties by round ascending so the result is deterministic', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, 0), round(2, 0), round(3, 0), round(4, 5)],
        rules: { roundsCount: { kind: 'TOP_N_BEST', topN: 2 } },
      });
      expect(result.map((r) => r.round)).toEqual([1, 2]);
    });

    it('returns all rounds when topN >= completed-round count', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1)],
        rules: { roundsCount: { kind: 'TOP_N_BEST', topN: 4 } },
      });
      expect(result).toHaveLength(2);
    });

    it('returns empty when topN is 0 or negative', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1)],
        rules: { roundsCount: { kind: 'TOP_N_BEST', topN: 0 } },
      });
      expect(result).toEqual([]);
    });
  });

  describe('SPECIFIC_ROUNDS rule', () => {
    it('keeps only the listed rounds (e.g., weekend-only [3, 4])', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1), round(3, -3), round(4, 0)],
        rules: { roundsCount: { kind: 'SPECIFIC_ROUNDS', rounds: [3, 4] } },
      });
      expect(result.map((r) => r.round)).toEqual([3, 4]);
    });

    it('returns empty when no completed rounds match the allow-list', () => {
      const result = scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1)],
        rules: { roundsCount: { kind: 'SPECIFIC_ROUNDS', rounds: [3, 4] } },
      });
      expect(result).toEqual([]);
    });
  });

  describe('purity', () => {
    it('produces identical output for identical input across two invocations', () => {
      const input = {
        pick: { id: 'pick-1' },
        detail: [round(1, -2), round(2, 1)] as readonly GolfRoundDetail[],
        rules: { roundsCount: 'ALL' } as GolfRosterScoringConfig,
      };
      const a = scoreGolfRoster(input);
      const b = scoreGolfRoster(input);
      expect(a).toEqual(b);
    });

    it('does not mutate the input detail array', () => {
      const detail = [round(2, 1), round(1, -2)];
      const before = [...detail];
      scoreGolfRoster({
        pick: { id: 'pick-1' },
        detail,
        rules: { roundsCount: { kind: 'TOP_N_BEST', topN: 1 } },
      });
      expect(detail).toEqual(before);
    });
  });
});
