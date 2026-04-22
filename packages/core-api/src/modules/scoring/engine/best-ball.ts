/**
 * Best-ball scoring: from N participants in an entry, only count the best M scores.
 *
 * Used primarily in golf (e.g., pick 6 golfers, use best 4 scores).
 * Also applicable to NASCAR (pick 4 drivers, use best 3) and other formats.
 *
 * "Best" depends on scoring direction:
 *   - lowerIsBetter = true  → lowest scores are best (stroke play golf)
 *   - lowerIsBetter = false → highest scores are best (points-based)
 */

export interface BestBallInput {
  participantId: string;
  score: number;
}

export interface BestBallResult {
  countingParticipantIds: string[];
  droppedParticipantIds: string[];
  totalScore: number;
}

/**
 * Apply best-ball scoring: select the best N scores from the full roster.
 *
 * @param participantScores - All participant scores in the entry
 * @param bestBallN - Number of scores to count (use best N)
 * @param lowerIsBetter - If true, lowest scores are best (golf stroke play);
 *                        if false, highest scores are best (points-based)
 * @returns The counting participant IDs, dropped IDs, and summed total
 */
export function applyBestBall(
  participantScores: BestBallInput[],
  bestBallN: number,
  lowerIsBetter: boolean = true,
  logger?: ServiceLogger,
): BestBallResult {
  if (participantScores.length === 0) {
    logger?.warn(
      { action: 'bestBall.apply.noParticipants', data: { bestBallN, lowerIsBetter } },
      'Best-ball scoring received no participant scores',
    );
    return { countingParticipantIds: [], droppedParticipantIds: [], totalScore: 0 };
  }

  // Clamp N to the number of participants available
  const n = Math.min(bestBallN, participantScores.length);

  // Sort: best first
  const sorted = [...participantScores].sort((a, b) =>
    lowerIsBetter ? a.score - b.score : b.score - a.score,
  );

  const counting = sorted.slice(0, n);
  const dropped = sorted.slice(n);

  const result = {
    countingParticipantIds: counting.map((p) => p.participantId),
    droppedParticipantIds: dropped.map((p) => p.participantId),
    totalScore: counting.reduce((sum, p) => sum + p.score, 0),
  };
  logger?.info(
    { action: 'bestBall.apply.success', data: { participantCount: participantScores.length, bestBallN, countingParticipantCount: result.countingParticipantIds.length, droppedParticipantCount: result.droppedParticipantIds.length, totalScore: result.totalScore } },
    'Applied best-ball scoring',
  );
  return result;
}
import type { ServiceLogger } from '../../../core/logger';
