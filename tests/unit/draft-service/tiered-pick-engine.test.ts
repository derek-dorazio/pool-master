import { TieredPickEngine } from '../../../packages/draft-service/src/engine/tiered-pick-engine';
import type { TieredPickState, TierDefinition } from '../../../packages/draft-service/src/engine/tiered-pick-engine';

const tiers: TierDefinition[] = [
  { tierId: 't1', tierName: 'Tier 1', tierNumber: 1, picksRequired: 1, participantIds: ['p1', 'p2', 'p3'] },
  { tierId: 't2', tierName: 'Tier 2', tierNumber: 2, picksRequired: 1, participantIds: ['p4', 'p5', 'p6'] },
  { tierId: 't3', tierName: 'Tier 3', tierNumber: 3, picksRequired: 1, participantIds: ['p7', 'p8', 'p9'] },
];

function createState(overrides: Partial<TieredPickState> = {}): TieredPickState {
  return {
    contestId: 'contest-1',
    tiers,
    entries: [],
    ...overrides,
  };
}

describe('TieredPickEngine', () => {
  const engine = new TieredPickEngine();

  describe('validatePick', () => {
    it('accepts valid pick from correct tier', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 't1', 'p2');
      expect(result.valid).toBe(true);
    });

    it('rejects pick from nonexistent tier', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 'bad-tier', 'p1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('rejects participant not in tier', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 't1', 'p7');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not in tier');
    });

    it('rejects when tier quota is already filled', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ tierId: 't1', participantId: 'p1', pickedAt: new Date() }],
          isComplete: false,
        }],
      });
      const result = engine.validatePick(state, 'entry-a', 't1', 'p2');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('1/1');
    });

    it('allows same participant picked by different entries (non-exclusive)', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ tierId: 't1', participantId: 'p1', pickedAt: new Date() }],
          isComplete: false,
        }],
      });
      const result = engine.validatePick(state, 'entry-b', 't1', 'p1');
      expect(result.valid).toBe(true);
    });
  });

  describe('applyPick', () => {
    it('adds pick to entry', () => {
      const state = createState();
      const newState = engine.applyPick(state, 'entry-a', 't1', 'p2');

      const entry = newState.entries.find((e) => e.entryId === 'entry-a');
      expect(entry).toBeDefined();
      expect(entry!.picks).toHaveLength(1);
      expect(entry!.picks[0].participantId).toBe('p2');
    });

    it('creates entry if it does not exist', () => {
      const state = createState();
      const newState = engine.applyPick(state, 'new-entry', 't1', 'p1');
      expect(newState.entries).toHaveLength(1);
      expect(newState.entries[0].entryId).toBe('new-entry');
    });

    it('marks entry as complete when all tiers filled', () => {
      let state = createState();
      state = engine.applyPick(state, 'entry-a', 't1', 'p1');
      state = engine.applyPick(state, 'entry-a', 't2', 'p4');
      state = engine.applyPick(state, 'entry-a', 't3', 'p7');

      const entry = state.entries.find((e) => e.entryId === 'entry-a');
      expect(entry!.isComplete).toBe(true);
    });

    it('does not mutate original state', () => {
      const state = createState();
      const newState = engine.applyPick(state, 'entry-a', 't1', 'p1');
      expect(state.entries).toHaveLength(0);
      expect(newState.entries).toHaveLength(1);
    });
  });

  describe('getRemainingTiers', () => {
    it('returns all tiers for new entry', () => {
      const state = createState();
      const remaining = engine.getRemainingTiers(state, 'entry-a');
      expect(remaining).toHaveLength(3);
    });

    it('returns unfilled tiers only', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ tierId: 't1', participantId: 'p1', pickedAt: new Date() }],
          isComplete: false,
        }],
      });
      const remaining = engine.getRemainingTiers(state, 'entry-a');
      expect(remaining).toHaveLength(2);
      expect(remaining.map((t) => t.tierId)).toEqual(['t2', 't3']);
    });

    it('returns empty array when all tiers filled', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [
            { tierId: 't1', participantId: 'p1', pickedAt: new Date() },
            { tierId: 't2', participantId: 'p4', pickedAt: new Date() },
            { tierId: 't3', participantId: 'p7', pickedAt: new Date() },
          ],
          isComplete: true,
        }],
      });
      const remaining = engine.getRemainingTiers(state, 'entry-a');
      expect(remaining).toHaveLength(0);
    });
  });

  describe('getTotalRosterSize', () => {
    it('sums picksRequired across tiers', () => {
      expect(engine.getTotalRosterSize(tiers)).toBe(3);
    });

    it('handles multi-pick tiers', () => {
      const multiTiers: TierDefinition[] = [
        { tierId: 't1', tierName: 'A', tierNumber: 1, picksRequired: 2, participantIds: [] },
        { tierId: 't2', tierName: 'B', tierNumber: 2, picksRequired: 3, participantIds: [] },
      ];
      expect(engine.getTotalRosterSize(multiTiers)).toBe(5);
    });
  });
});
