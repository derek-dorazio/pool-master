import { BracketEngine } from '../../../packages/draft-service/src/engine/bracket-engine';
import type { BracketState, BracketConfig, MatchPrediction } from '../../../packages/draft-service/src/engine/bracket-engine';

function createConfig(overrides: Partial<BracketConfig> = {}): BracketConfig {
  return {
    totalRounds: 4,
    roundValues: [1, 2, 4, 8],
    seriesLengthBonus: 1,
    correctScoreBonus: 0,
    ...overrides,
  };
}

function createState(overrides: Partial<BracketState> = {}): BracketState {
  return {
    contestId: 'contest-1',
    config: createConfig(),
    entries: [],
    ...overrides,
  };
}

const samplePredictions: MatchPrediction[] = [
  { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'team-a', predictedSeriesLength: 5 },
  { roundNumber: 1, matchNumber: 2, predictedWinnerId: 'team-c', predictedSeriesLength: 6 },
  { roundNumber: 2, matchNumber: 1, predictedWinnerId: 'team-a', predictedSeriesLength: 7 },
  { roundNumber: 3, matchNumber: 1, predictedWinnerId: 'team-a' },
];

describe('BracketEngine', () => {
  const engine = new BracketEngine();

  describe('validateBracket', () => {
    it('accepts valid bracket', () => {
      const state = createState();
      const result = engine.validateBracket(state, 'entry-a', samplePredictions);
      expect(result.valid).toBe(true);
    });

    it('rejects duplicate submission', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          predictions: samplePredictions,
          submittedAt: new Date(),
          totalScore: 0,
        }],
      });
      const result = engine.validateBracket(state, 'entry-a', samplePredictions);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already submitted');
    });

    it('rejects empty predictions', () => {
      const result = engine.validateBracket(createState(), 'entry-a', []);
      expect(result.valid).toBe(false);
    });

    it('rejects duplicate match predictions', () => {
      const dupes: MatchPrediction[] = [
        { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'a' },
        { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'b' },
      ];
      const result = engine.validateBracket(createState(), 'entry-a', dupes);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Duplicate');
    });

    it('rejects invalid round number', () => {
      const bad: MatchPrediction[] = [
        { roundNumber: 5, matchNumber: 1, predictedWinnerId: 'a' },
      ];
      const result = engine.validateBracket(createState(), 'entry-a', bad);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Invalid round');
    });
  });

  describe('submitBracket', () => {
    it('adds entry with predictions', () => {
      const state = createState();
      const newState = engine.submitBracket(state, 'entry-a', samplePredictions, 215);
      expect(newState.entries).toHaveLength(1);
      expect(newState.entries[0].predictions).toHaveLength(4);
      expect(newState.entries[0].tiebreakerValue).toBe(215);
    });

    it('does not mutate original state', () => {
      const state = createState();
      const newState = engine.submitBracket(state, 'entry-a', samplePredictions);
      expect(state.entries).toHaveLength(0);
      expect(newState.entries).toHaveLength(1);
    });
  });

  describe('scoreRound', () => {
    it('awards round value points for correct picks', () => {
      let state = createState();
      state = engine.submitBracket(state, 'entry-a', samplePredictions);

      const scored = engine.scoreRound(state, 1, [
        { roundNumber: 1, matchNumber: 1, winnerId: 'team-a', seriesLength: 5 },
        { roundNumber: 1, matchNumber: 2, winnerId: 'team-d', seriesLength: 6 },
      ]);

      const entry = scored.entries[0];
      const r1m1 = entry.predictions.find((p) => p.matchNumber === 1 && p.roundNumber === 1)!;
      const r1m2 = entry.predictions.find((p) => p.matchNumber === 2 && p.roundNumber === 1)!;

      expect(r1m1.isCorrect).toBe(true);
      expect(r1m1.pointsEarned).toBe(2); // round value 1 + series length bonus 1
      expect(r1m2.isCorrect).toBe(false);
      expect(r1m2.pointsEarned).toBe(0);
    });

    it('applies series length bonus only when correct', () => {
      let state = createState();
      state = engine.submitBracket(state, 'entry-a', [
        { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'a', predictedSeriesLength: 5 },
      ]);

      const scored = engine.scoreRound(state, 1, [
        { roundNumber: 1, matchNumber: 1, winnerId: 'a', seriesLength: 6 },
      ]);

      const pred = scored.entries[0].predictions[0];
      expect(pred.isCorrect).toBe(true);
      expect(pred.pointsEarned).toBe(1); // round value only, no series bonus (5 ≠ 6)
    });

    it('uses increasing round values', () => {
      let state = createState({ config: createConfig({ seriesLengthBonus: 0 }) });
      state = engine.submitBracket(state, 'entry-a', [
        { roundNumber: 2, matchNumber: 1, predictedWinnerId: 'a' },
      ]);

      const scored = engine.scoreRound(state, 2, [
        { roundNumber: 2, matchNumber: 1, winnerId: 'a' },
      ]);

      expect(scored.entries[0].predictions[0].pointsEarned).toBe(2); // roundValues[1]
    });

    it('calculates total score across all scored predictions', () => {
      let state = createState({ config: createConfig({ seriesLengthBonus: 0 }) });
      state = engine.submitBracket(state, 'entry-a', [
        { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'a' },
        { roundNumber: 1, matchNumber: 2, predictedWinnerId: 'c' },
      ]);

      const scored = engine.scoreRound(state, 1, [
        { roundNumber: 1, matchNumber: 1, winnerId: 'a' },
        { roundNumber: 1, matchNumber: 2, winnerId: 'c' },
      ]);

      expect(scored.entries[0].totalScore).toBe(2); // 1 + 1
    });
  });

  describe('getLeaderboard', () => {
    it('sorts by score descending', () => {
      const state = createState({
        entries: [
          { entryId: 'a', predictions: [], submittedAt: new Date(), totalScore: 10 },
          { entryId: 'b', predictions: [], submittedAt: new Date(), totalScore: 25 },
          { entryId: 'c', predictions: [], submittedAt: new Date(), totalScore: 15 },
        ],
      });
      const lb = engine.getLeaderboard(state);
      expect(lb.map((e) => e.entryId)).toEqual(['b', 'c', 'a']);
    });

    it('breaks ties by tiebreaker proximity', () => {
      const state = createState({
        entries: [
          { entryId: 'a', predictions: [], submittedAt: new Date(), totalScore: 20, tiebreakerValue: 200 },
          { entryId: 'b', predictions: [], submittedAt: new Date(), totalScore: 20, tiebreakerValue: 210 },
        ],
      });
      const lb = engine.getLeaderboard(state, 215);
      expect(lb[0].entryId).toBe('b'); // 210 is closer to 215
    });
  });

  describe('getEntrySummary', () => {
    it('returns per-round breakdown', () => {
      let state = createState({ config: createConfig({ seriesLengthBonus: 0 }) });
      state = engine.submitBracket(state, 'entry-a', [
        { roundNumber: 1, matchNumber: 1, predictedWinnerId: 'a' },
        { roundNumber: 1, matchNumber: 2, predictedWinnerId: 'c' },
        { roundNumber: 2, matchNumber: 1, predictedWinnerId: 'a' },
      ]);

      state = engine.scoreRound(state, 1, [
        { roundNumber: 1, matchNumber: 1, winnerId: 'a' },
        { roundNumber: 1, matchNumber: 2, winnerId: 'd' },
      ]);

      const summary = engine.getEntrySummary(state, 'entry-a');
      expect(summary).toHaveLength(2);
      expect(summary[0]).toEqual({ roundNumber: 1, correct: 1, total: 2, points: 1 });
      expect(summary[1]).toEqual({ roundNumber: 2, correct: 0, total: 1, points: 0 });
    });
  });
});
