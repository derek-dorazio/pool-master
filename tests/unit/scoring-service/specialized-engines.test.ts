import type { ScoringConfig } from '@poolmaster/shared/domain/scoring-config';
import { ScoringConfigSchema } from '@poolmaster/shared/domain/scoring-config';
import { applyBestBall } from '../../../packages/core-api/src/modules/scoring/engine/best-ball';
import {
  calculateRecords,
  evaluateMatchup,
  scoreHeadToHead,
} from '../../../packages/core-api/src/modules/scoring/engine/head-to-head-scoring';
import { scoreRotisserie } from '../../../packages/core-api/src/modules/scoring/engine/rotisserie-scoring';
import {
  scoreStrokePlayEntry,
  scoreStrokePlayParticipant,
} from '../../../packages/core-api/src/modules/scoring/engine/stroke-play-scoring';

function buildConfig(overrides: Partial<ScoringConfig> = {}): ScoringConfig {
  return ScoringConfigSchema.parse({
    sport: 'GOLF',
    scoring_type: 'STROKE_PLAY',
    ...overrides,
  });
}

describe('specialized scoring engines', () => {
  describe('applyBestBall', () => {
    it('returns empty output for empty input', () => {
      expect(applyBestBall([], 4)).toEqual({
        countingParticipantIds: [],
        droppedParticipantIds: [],
        totalScore: 0,
      });
    });
  });

  describe('stroke play scoring', () => {
    it('excludes non-finishers when DNF handling is EXCLUDE', () => {
      expect(
        scoreStrokePlayParticipant(
          {
            participantId: 'p1',
            roundStrokes: [72, 71],
            madecut: false,
            withdrew: false,
            totalRounds: 4,
          },
          80,
          'EXCLUDE',
        ),
      ).toEqual(
        expect.objectContaining({
          participantId: 'p1',
          excluded: true,
          totalStrokes: 0,
          missedCutRounds: 2,
        }),
      );
    });

    it('counts the best N stroke totals for an entry', () => {
      const result = scoreStrokePlayEntry(
        buildConfig({
          counting_method: 'BEST_N',
          best_n: 2,
          dnf_handling: 'MISSED_CUT_SCORE',
          missed_event_score: 80,
        }),
        [
          { participantId: 'p1', roundStrokes: [70, 70, 70, 70], madecut: true, withdrew: false, totalRounds: 4 },
          { participantId: 'p2', roundStrokes: [71, 71, 71, 71], madecut: true, withdrew: false, totalRounds: 4 },
          { participantId: 'p3', roundStrokes: [75, 75, 75, 75], madecut: true, withdrew: false, totalRounds: 4 },
        ],
      );

      expect(result.countingParticipants.map((participant) => participant.participantId)).toEqual([
        'p1',
        'p2',
      ]);
      expect(result.totalStrokes).toBe(280 + 284);
    });
  });

  describe('rotisserie scoring', () => {
    it('returns empty standings when no entries are provided', () => {
      expect(scoreRotisserie({ categories: ['points'] }, [])).toEqual([]);
    });

    it('handles ties and lower-is-better categories', () => {
      const results = scoreRotisserie(
        {
          categories: ['points', 'turnovers'],
          lower_is_better_categories: ['turnovers'],
        },
        [
          { entryId: 'a', categoryValues: { points: 100, turnovers: 10 } },
          { entryId: 'b', categoryValues: { points: 100, turnovers: 8 } },
          { entryId: 'c', categoryValues: { points: 90, turnovers: 12 } },
        ],
      );

      expect(results).toHaveLength(3);
      const entryA = results.find((entry) => entry.entryId === 'a');
      const entryB = results.find((entry) => entry.entryId === 'b');
      expect(entryA?.categoryRanks.points).toBe(2.5);
      expect(entryB?.categoryRanks.turnovers).toBe(3);
    });
  });

  describe('head-to-head scoring', () => {
    it('evaluates winners and ties for a single matchup', () => {
      expect(
        evaluateMatchup(
          { period: 1, entryIdA: 'a', entryIdB: 'b' },
          { period: 1, scores: { a: 100, b: 90 } },
        ),
      ).toEqual(
        expect.objectContaining({
          winnerId: 'a',
          scoreA: 100,
          scoreB: 90,
        }),
      );

      expect(
        evaluateMatchup(
          { period: 1, entryIdA: 'a', entryIdB: 'b' },
          { period: 1, scores: { a: 90, b: 90 } },
        ).winnerId,
      ).toBeNull();
    });

    it('calculates records and skips matchups without period scores', () => {
      const result = scoreHeadToHead(
        [
          { period: 1, entryIdA: 'a', entryIdB: 'b' },
          { period: 2, entryIdA: 'a', entryIdB: 'c' },
        ],
        [{ period: 1, scores: { a: 100, b: 95 } }],
        ['a', 'b', 'c'],
      );

      expect(result.matchupResults).toHaveLength(1);
      expect(result.matchupResults[0]?.winnerId).toBe('a');
      expect(result.standings.map((entry) => entry.entryId)).toContain('c');

      const records = calculateRecords(result.matchupResults, ['a', 'b', 'c']);
      expect(records.find((entry) => entry.entryId === 'a')?.wins).toBe(1);
      expect(records.find((entry) => entry.entryId === 'c')?.winPct).toBe(0);
    });
  });
});
