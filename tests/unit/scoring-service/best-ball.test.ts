import {
  applyBestBall,
  type BestBallInput,
} from '../../../packages/core-api/src/modules/scoring/engine/best-ball';

// --- Helpers ---

function makeScores(...pairs: [string, number][]): BestBallInput[] {
  return pairs.map(([participantId, score]) => ({ participantId, score }));
}

// ========================================================================
// Best-ball scoring engine
// ========================================================================

describe('applyBestBall', () => {
  it('keeps the best N scores from multiple players (higher is better)', () => {
    const scores = makeScores(['p1', 10], ['p2', 25], ['p3', 15], ['p4', 20]);
    const result = applyBestBall(scores, 2, false);

    expect(result.countingParticipantIds).toEqual(['p2', 'p4']);
    expect(result.droppedParticipantIds).toEqual(['p3', 'p1']);
    expect(result.totalScore).toBe(45);
  });

  it('keeps best N scores in lower-is-better mode (golf stroke play)', () => {
    const scores = makeScores(['p1', 72], ['p2', 68], ['p3', 75], ['p4', 70]);
    const result = applyBestBall(scores, 2, true);

    expect(result.countingParticipantIds).toEqual(['p2', 'p4']);
    expect(result.droppedParticipantIds).toEqual(['p1', 'p3']);
    expect(result.totalScore).toBe(138);
  });

  it('handles tied player scores — all tied players included/excluded consistently', () => {
    const scores = makeScores(['p1', 10], ['p2', 10], ['p3', 10]);
    const result = applyBestBall(scores, 2, false);

    // All scores equal, so best-2 picks the first two from sort-stable order
    expect(result.countingParticipantIds).toHaveLength(2);
    expect(result.droppedParticipantIds).toHaveLength(1);
    expect(result.totalScore).toBe(20);
  });

  it('returns empty result for 0 qualifying scores (empty input)', () => {
    const result = applyBestBall([], 3, false);

    expect(result.countingParticipantIds).toEqual([]);
    expect(result.droppedParticipantIds).toEqual([]);
    expect(result.totalScore).toBe(0);
  });

  it('handles all-DNF entries (all scores are 0)', () => {
    const scores = makeScores(['p1', 0], ['p2', 0], ['p3', 0]);
    const result = applyBestBall(scores, 2, false);

    expect(result.countingParticipantIds).toHaveLength(2);
    expect(result.droppedParticipantIds).toHaveLength(1);
    expect(result.totalScore).toBe(0);
  });

  it('clamps N to available participants when N exceeds roster size', () => {
    const scores = makeScores(['p1', 10], ['p2', 20]);
    const result = applyBestBall(scores, 5, false);

    expect(result.countingParticipantIds).toEqual(['p2', 'p1']);
    expect(result.droppedParticipantIds).toEqual([]);
    expect(result.totalScore).toBe(30);
  });

  it('defaults to lowerIsBetter when third argument is omitted', () => {
    const scores = makeScores(['p1', 72], ['p2', 68]);
    const result = applyBestBall(scores, 1);

    expect(result.countingParticipantIds).toEqual(['p2']);
    expect(result.totalScore).toBe(68);
  });
});
