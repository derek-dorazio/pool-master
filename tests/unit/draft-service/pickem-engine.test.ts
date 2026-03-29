import { PickEmEngine } from '../../../packages/core-api/src/modules/drafts/engine/pickem-engine';
import type { PickEmState, PickEmConfig } from '../../../packages/core-api/src/modules/drafts/engine/pickem-engine';

function createConfig(overrides: Partial<PickEmConfig> = {}): PickEmConfig {
  return {
    totalPeriods: 17,
    matchupsPerPeriod: 4,
    pointsPerCorrect: 10,
    confidenceWeighted: false,
    exactOrderBonus: 0,
    ...overrides,
  };
}

function createState(overrides: Partial<PickEmState> = {}): PickEmState {
  return {
    contestId: 'contest-1',
    config: createConfig(),
    currentPeriod: 1,
    entries: [],
    ...overrides,
  };
}

describe('PickEmEngine', () => {
  const engine = new PickEmEngine();

  describe('validatePeriodPicks', () => {
    it('accepts valid picks', () => {
      const state = createState();
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'team-1' },
        { matchupIndex: 1, predictedWinnerId: 'team-3' },
        { matchupIndex: 2, predictedWinnerId: 'team-5' },
        { matchupIndex: 3, predictedWinnerId: 'team-7' },
      ]);
      expect(result.valid).toBe(true);
    });

    it('rejects wrong number of picks', () => {
      const state = createState();
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'team-1' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('4');
    });

    it('rejects duplicate matchup indices', () => {
      const state = createState({ config: createConfig({ matchupsPerPeriod: 2 }) });
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'team-1' },
        { matchupIndex: 0, predictedWinnerId: 'team-2' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Duplicate');
    });

    it('rejects already-submitted period', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ period: 1, matchupIndex: 0, predictedWinnerId: 'x', pickedAt: new Date() }],
          totalScore: 0,
        }],
        config: createConfig({ matchupsPerPeriod: 1 }),
      });
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'y' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already submitted');
    });

    it('validates unique confidence weights', () => {
      const state = createState({ config: createConfig({ confidenceWeighted: true, matchupsPerPeriod: 3 }) });
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'a', confidenceWeight: 1 },
        { matchupIndex: 1, predictedWinnerId: 'b', confidenceWeight: 1 },
        { matchupIndex: 2, predictedWinnerId: 'c', confidenceWeight: 3 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('unique');
    });

    it('validates confidence weight range', () => {
      const state = createState({ config: createConfig({ confidenceWeighted: true, matchupsPerPeriod: 2 }) });
      const result = engine.validatePeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'a', confidenceWeight: 0 },
        { matchupIndex: 1, predictedWinnerId: 'b', confidenceWeight: 5 },
      ]);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('between 1');
    });
  });

  describe('submitPeriodPicks', () => {
    it('adds picks for new entry', () => {
      const state = createState({ config: createConfig({ matchupsPerPeriod: 2 }) });
      const newState = engine.submitPeriodPicks(state, 'entry-a', 1, [
        { matchupIndex: 0, predictedWinnerId: 'team-1' },
        { matchupIndex: 1, predictedWinnerId: 'team-3' },
      ]);
      expect(newState.entries).toHaveLength(1);
      expect(newState.entries[0].picks).toHaveLength(2);
    });

    it('appends picks to existing entry', () => {
      const state = createState({
        config: createConfig({ matchupsPerPeriod: 1 }),
        entries: [{
          entryId: 'entry-a',
          picks: [{ period: 1, matchupIndex: 0, predictedWinnerId: 'x', pickedAt: new Date() }],
          totalScore: 0,
        }],
        currentPeriod: 2,
      });
      const newState = engine.submitPeriodPicks(state, 'entry-a', 2, [
        { matchupIndex: 0, predictedWinnerId: 'y' },
      ]);
      expect(newState.entries[0].picks).toHaveLength(2);
    });
  });

  describe('resolvePeriod', () => {
    it('scores correct picks and advances period', () => {
      const state = createState({
        config: createConfig({ matchupsPerPeriod: 2, pointsPerCorrect: 10 }),
        entries: [{
          entryId: 'entry-a',
          picks: [
            { period: 1, matchupIndex: 0, predictedWinnerId: 'team-1', pickedAt: new Date() },
            { period: 1, matchupIndex: 1, predictedWinnerId: 'team-4', pickedAt: new Date() },
          ],
          totalScore: 0,
        }],
      });

      const resolved = engine.resolvePeriod(state, 1, [
        { matchupIndex: 0, winnerId: 'team-1' },
        { matchupIndex: 1, winnerId: 'team-3' },
      ]);

      const entry = resolved.entries[0];
      expect(entry.picks[0].isCorrect).toBe(true);
      expect(entry.picks[0].pointsEarned).toBe(10);
      expect(entry.picks[1].isCorrect).toBe(false);
      expect(entry.picks[1].pointsEarned).toBe(0);
      expect(entry.totalScore).toBe(10);
      expect(resolved.currentPeriod).toBe(2);
    });

    it('uses confidence weight as points when weighted', () => {
      const state = createState({
        config: createConfig({ confidenceWeighted: true, matchupsPerPeriod: 2 }),
        entries: [{
          entryId: 'entry-a',
          picks: [
            { period: 1, matchupIndex: 0, predictedWinnerId: 'a', confidenceWeight: 2, pickedAt: new Date() },
            { period: 1, matchupIndex: 1, predictedWinnerId: 'b', confidenceWeight: 1, pickedAt: new Date() },
          ],
          totalScore: 0,
        }],
      });

      const resolved = engine.resolvePeriod(state, 1, [
        { matchupIndex: 0, winnerId: 'a' },
        { matchupIndex: 1, winnerId: 'x' },
      ]);

      expect(resolved.entries[0].totalScore).toBe(2);
    });
  });

  describe('getLeaderboard', () => {
    it('returns entries sorted by score descending', () => {
      const state = createState({
        entries: [
          { entryId: 'a', picks: [], totalScore: 30 },
          { entryId: 'b', picks: [], totalScore: 50 },
          { entryId: 'c', picks: [], totalScore: 40 },
        ],
      });
      const lb = engine.getLeaderboard(state);
      expect(lb.map((e) => e.entryId)).toEqual(['b', 'c', 'a']);
      expect(lb[0].rank).toBe(1);
      expect(lb[2].rank).toBe(3);
    });
  });
});
