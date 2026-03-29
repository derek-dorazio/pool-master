import { BudgetPickEngine } from '../../../packages/core-api/src/modules/drafts/engine/budget-pick-engine';
import type { BudgetPickState, BudgetParticipant } from '../../../packages/core-api/src/modules/drafts/engine/budget-pick-engine';

const participants: BudgetParticipant[] = [
  { participantId: 'p1', cost: 30 },
  { participantId: 'p2', cost: 25 },
  { participantId: 'p3', cost: 20 },
  { participantId: 'p4', cost: 15 },
  { participantId: 'p5', cost: 10 },
];

function createState(overrides: Partial<BudgetPickState> = {}): BudgetPickState {
  return {
    contestId: 'contest-1',
    budget: 100,
    rosterSize: 4,
    participants,
    entries: [],
    ...overrides,
  };
}

describe('BudgetPickEngine', () => {
  const engine = new BudgetPickEngine();

  describe('validatePick', () => {
    it('accepts valid pick within budget', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 'p3');
      expect(result.valid).toBe(true);
      expect(result.remainingBudget).toBe(80);
    });

    it('rejects participant not in pool', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 'unknown');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not in the pool');
    });

    it('rejects when roster is full', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [
            { participantId: 'p5', cost: 10, pickedAt: new Date() },
            { participantId: 'p4', cost: 15, pickedAt: new Date() },
            { participantId: 'p3', cost: 20, pickedAt: new Date() },
            { participantId: 'p2', cost: 25, pickedAt: new Date() },
          ],
          totalSpent: 70,
          isComplete: true,
        }],
      });
      const result = engine.validatePick(state, 'entry-a', 'p1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('full');
    });

    it('rejects duplicate participant on same entry', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ participantId: 'p1', cost: 30, pickedAt: new Date() }],
          totalSpent: 30,
          isComplete: false,
        }],
      });
      const result = engine.validatePick(state, 'entry-a', 'p1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already on your roster');
    });

    it('rejects when cost exceeds remaining budget', () => {
      const state = createState({
        budget: 40,
        entries: [{
          entryId: 'entry-a',
          picks: [{ participantId: 'p2', cost: 25, pickedAt: new Date() }],
          totalSpent: 25,
          isComplete: false,
        }],
      });
      const result = engine.validatePick(state, 'entry-a', 'p1');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exceeds remaining budget');
    });

    it('rejects when pick would make remaining slots unfillable', () => {
      const state = createState({
        budget: 50,
        rosterSize: 3,
      });
      // Picking p1 (30) leaves 20 for 2 slots, but cheapest available is p5 (10) × 2 = 20
      // So picking p1 is borderline valid (20 >= 20)
      const result1 = engine.validatePick(state, 'entry-a', 'p1');
      expect(result1.valid).toBe(true);

      // But with budget 45, picking p1 (30) leaves 15 for 2 slots, cheapest × 2 = 20 > 15
      const tightState = createState({ budget: 45, rosterSize: 3 });
      const result2 = engine.validatePick(tightState, 'entry-a', 'p1');
      expect(result2.valid).toBe(false);
      expect(result2.reason).toContain('slots');
    });

    it('allows same participant on different entries (non-exclusive)', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ participantId: 'p1', cost: 30, pickedAt: new Date() }],
          totalSpent: 30,
          isComplete: false,
        }],
      });
      const result = engine.validatePick(state, 'entry-b', 'p1');
      expect(result.valid).toBe(true);
    });
  });

  describe('applyPick', () => {
    it('adds pick and updates spent total', () => {
      const state = createState();
      const newState = engine.applyPick(state, 'entry-a', 'p3');

      const entry = newState.entries.find((e) => e.entryId === 'entry-a');
      expect(entry!.picks).toHaveLength(1);
      expect(entry!.totalSpent).toBe(20);
      expect(entry!.isComplete).toBe(false);
    });

    it('marks entry complete when roster is full', () => {
      let state = createState({ rosterSize: 2 });
      state = engine.applyPick(state, 'entry-a', 'p5');
      state = engine.applyPick(state, 'entry-a', 'p4');

      const entry = state.entries.find((e) => e.entryId === 'entry-a');
      expect(entry!.isComplete).toBe(true);
      expect(entry!.totalSpent).toBe(25);
    });

    it('does not mutate original state', () => {
      const state = createState();
      const newState = engine.applyPick(state, 'entry-a', 'p1');
      expect(state.entries).toHaveLength(0);
      expect(newState.entries).toHaveLength(1);
    });
  });

  describe('getRemainingBudget', () => {
    it('returns full budget for new entry', () => {
      const state = createState();
      expect(engine.getRemainingBudget(state, 'entry-a')).toBe(100);
    });

    it('returns correct remaining after picks', () => {
      const state = createState({
        entries: [{
          entryId: 'entry-a',
          picks: [{ participantId: 'p1', cost: 30, pickedAt: new Date() }],
          totalSpent: 30,
          isComplete: false,
        }],
      });
      expect(engine.getRemainingBudget(state, 'entry-a')).toBe(70);
    });
  });

  describe('getAffordableParticipants', () => {
    it('returns all participants for new entry with large budget', () => {
      const state = createState();
      const affordable = engine.getAffordableParticipants(state, 'entry-a');
      expect(affordable).toHaveLength(5);
    });

    it('excludes already-picked and over-budget participants', () => {
      const state = createState({
        budget: 35,
        entries: [{
          entryId: 'entry-a',
          picks: [{ participantId: 'p4', cost: 15, pickedAt: new Date() }],
          totalSpent: 15,
          isComplete: false,
        }],
      });
      const affordable = engine.getAffordableParticipants(state, 'entry-a');
      // Budget remaining = 20. p1(30) too expensive, p4 already picked.
      // Affordable: p2(25)? No, 25>20. p3(20) yes. p5(10) yes.
      expect(affordable.map((p) => p.participantId)).toEqual(['p3', 'p5']);
    });
  });
});
