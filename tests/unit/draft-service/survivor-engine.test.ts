import { SurvivorEngine } from '../../../packages/core-api/src/modules/drafts/engine/survivor-engine';
import type {
  SurvivorState,
  SurvivorConfig,
  SurvivorEntryState,
} from '../../../packages/core-api/src/modules/drafts/engine/survivor-engine';

function createConfig(overrides: Partial<SurvivorConfig> = {}): SurvivorConfig {
  return {
    survivorStyle: 'LIVE_PICK',
    totalPeriods: 17,
    picksPerPeriod: 1,
    oneEntityPerSeason: true,
    strikesBeforeElimination: 0,
    buybacksAllowed: false,
    ...overrides,
  };
}

function createState(overrides: Partial<SurvivorState> = {}): SurvivorState {
  return {
    contestId: 'contest-1',
    config: createConfig(),
    currentPeriod: 1,
    entries: [],
    ...overrides,
  };
}

function entryWithPicks(
  entryId: string,
  picks: Array<{ period: number; participantId: string; isCorrect?: boolean }>,
): SurvivorEntryState {
  return {
    entryId,
    picks: picks.map((p) => ({
      period: p.period,
      participantId: p.participantId,
      pickedAt: new Date(),
      isCorrect: p.isCorrect,
      isReplacement: false,
    })),
    strikes: 0,
    isEliminated: false,
    hasBoughtBack: false,
  };
}

describe('SurvivorEngine', () => {
  const engine = new SurvivorEngine();

  // =========================================================================
  // Validation
  // =========================================================================

  describe('validatePick', () => {
    it('accepts valid live pick for current period', () => {
      const state = createState();
      const result = engine.validatePick(state, 'entry-a', 'team-1', 1);
      expect(result.valid).toBe(true);
    });

    it('rejects eliminated entry', () => {
      const state = createState({
        entries: [{ entryId: 'entry-a', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false }],
      });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 1);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('eliminated');
    });

    it('rejects live pick for wrong period', () => {
      const state = createState({ currentPeriod: 3 });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 2);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('current period');
    });

    it('rejects locked pick after period 1 has started', () => {
      const state = createState({
        config: createConfig({ survivorStyle: 'LOCKED_PICK' }),
        currentPeriod: 2,
      });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 2);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('locked mode');
    });

    it('allows locked picks before period 1', () => {
      const state = createState({
        config: createConfig({ survivorStyle: 'LOCKED_PICK' }),
        currentPeriod: 1,
      });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 5);
      expect(result.valid).toBe(true);
    });

    it('rejects when period quota is full', () => {
      const state = createState({
        entries: [entryWithPicks('entry-a', [{ period: 1, participantId: 'team-1' }])],
      });
      const result = engine.validatePick(state, 'entry-a', 'team-2', 1);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('1/1');
    });

    it('allows double pick when picksPerPeriod is 2', () => {
      const state = createState({
        config: createConfig({ picksPerPeriod: 2 }),
        entries: [entryWithPicks('entry-a', [{ period: 1, participantId: 'team-1' }])],
      });
      const result = engine.validatePick(state, 'entry-a', 'team-2', 1);
      expect(result.valid).toBe(true);
    });

    it('rejects reused participant when oneEntityPerSeason is true', () => {
      const state = createState({
        currentPeriod: 2,
        entries: [entryWithPicks('entry-a', [{ period: 1, participantId: 'team-1', isCorrect: true }])],
      });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 2);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already used');
    });

    it('allows reuse when oneEntityPerSeason is false', () => {
      const state = createState({
        config: createConfig({ oneEntityPerSeason: false }),
        currentPeriod: 2,
        entries: [entryWithPicks('entry-a', [{ period: 1, participantId: 'team-1', isCorrect: true }])],
      });
      const result = engine.validatePick(state, 'entry-a', 'team-1', 2);
      expect(result.valid).toBe(true);
    });
  });

  // =========================================================================
  // Live Pick Submission
  // =========================================================================

  describe('submitLivePick', () => {
    it('adds pick for current period', () => {
      const state = createState();
      const newState = engine.submitLivePick(state, 'entry-a', 'team-1');

      expect(newState.entries).toHaveLength(1);
      expect(newState.entries[0].picks).toHaveLength(1);
      expect(newState.entries[0].picks[0].participantId).toBe('team-1');
      expect(newState.entries[0].picks[0].period).toBe(1);
    });

    it('applies multiplier from config', () => {
      const state = createState({
        config: createConfig({ multipliers: [1, 2, 3, 4] }),
      });
      const newState = engine.submitLivePick(state, 'entry-a', 'team-1');
      expect(newState.entries[0].picks[0].multiplier).toBe(1);
    });
  });

  // =========================================================================
  // Locked Pick Submission
  // =========================================================================

  describe('submitLockedPicks', () => {
    it('submits all picks at once', () => {
      const state = createState({
        config: createConfig({ survivorStyle: 'LOCKED_PICK', totalPeriods: 4 }),
      });
      const newState = engine.submitLockedPicks(state, 'entry-a', [
        { period: 1, participantId: 'team-1' },
        { period: 2, participantId: 'team-2' },
        { period: 3, participantId: 'team-3' },
        { period: 4, participantId: 'team-4' },
      ]);

      expect(newState.entries[0].picks).toHaveLength(4);
    });

    it('throws on invalid pick in the sequence', () => {
      const state = createState({
        config: createConfig({ survivorStyle: 'LOCKED_PICK', oneEntityPerSeason: true }),
      });
      expect(() =>
        engine.submitLockedPicks(state, 'entry-a', [
          { period: 1, participantId: 'team-1' },
          { period: 2, participantId: 'team-1' },
        ]),
      ).toThrow('already used');
    });
  });

  // =========================================================================
  // Period Resolution
  // =========================================================================

  describe('resolvePeriod', () => {
    it('marks correct picks and advances period', () => {
      const state = createState({
        entries: [
          entryWithPicks('entry-a', [{ period: 1, participantId: 'team-1' }]),
          entryWithPicks('entry-b', [{ period: 1, participantId: 'team-2' }]),
        ],
      });

      const winners = new Set(['team-1']);
      const resolved = engine.resolvePeriod(state, 1, winners);

      expect(resolved.currentPeriod).toBe(2);
      const entryA = resolved.entries.find((e) => e.entryId === 'entry-a')!;
      const entryB = resolved.entries.find((e) => e.entryId === 'entry-b')!;

      expect(entryA.picks[0].isCorrect).toBe(true);
      expect(entryA.isEliminated).toBe(false);

      expect(entryB.picks[0].isCorrect).toBe(false);
      expect(entryB.isEliminated).toBe(true);
    });

    it('uses strikes before eliminating', () => {
      const state = createState({
        config: createConfig({ strikesBeforeElimination: 1 }),
        entries: [entryWithPicks('entry-a', [{ period: 1, participantId: 'team-2' }])],
      });

      const resolved = engine.resolvePeriod(state, 1, new Set(['team-1']));
      const entry = resolved.entries[0];

      expect(entry.strikes).toBe(1);
      expect(entry.isEliminated).toBe(false);
    });

    it('eliminates after strikes are exhausted', () => {
      const state = createState({
        config: createConfig({ strikesBeforeElimination: 1 }),
        entries: [{
          entryId: 'entry-a',
          picks: [
            { period: 1, participantId: 'team-bad', pickedAt: new Date(), isCorrect: false, isReplacement: false },
            { period: 2, participantId: 'team-bad2', pickedAt: new Date(), isReplacement: false },
          ],
          strikes: 1,
          isEliminated: false,
          hasBoughtBack: false,
        }],
        currentPeriod: 2,
      });

      const resolved = engine.resolvePeriod(state, 2, new Set(['team-1']));
      expect(resolved.entries[0].strikes).toBe(2);
      expect(resolved.entries[0].isEliminated).toBe(true);
    });

    it('eliminates on missed pick', () => {
      const state = createState({
        entries: [{ entryId: 'entry-a', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false }],
      });

      const resolved = engine.resolvePeriod(state, 1, new Set(['team-1']));
      expect(resolved.entries[0].isEliminated).toBe(true);
    });

    it('skips already-eliminated entries', () => {
      const state = createState({
        entries: [{ entryId: 'entry-a', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false }],
      });

      const resolved = engine.resolvePeriod(state, 1, new Set(['team-1']));
      expect(resolved.entries[0].isEliminated).toBe(true);
    });
  });

  // =========================================================================
  // Buyback
  // =========================================================================

  describe('buyback', () => {
    it('reinstates eliminated entry', () => {
      const state = createState({
        config: createConfig({ buybacksAllowed: true }),
        entries: [{ entryId: 'entry-a', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false }],
      });

      const newState = engine.buyback(state, 'entry-a');
      expect(newState.entries[0].isEliminated).toBe(false);
      expect(newState.entries[0].hasBoughtBack).toBe(true);
    });

    it('throws when buybacks not allowed', () => {
      const state = createState({
        entries: [{ entryId: 'entry-a', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false }],
      });
      expect(() => engine.buyback(state, 'entry-a')).toThrow('not allowed');
    });

    it('throws on double buyback', () => {
      const state = createState({
        config: createConfig({ buybacksAllowed: true }),
        entries: [{ entryId: 'entry-a', picks: [], strikes: 2, isEliminated: true, hasBoughtBack: true }],
      });
      expect(() => engine.buyback(state, 'entry-a')).toThrow('already used');
    });
  });

  // =========================================================================
  // Replacement Pick (Multiplier Survivor)
  // =========================================================================

  describe('submitReplacementPick', () => {
    it('adds replacement at 1x multiplier', () => {
      const state = createState({
        config: createConfig({ multipliers: [1, 2, 3, 4] }),
        currentPeriod: 3,
        entries: [entryWithPicks('entry-a', [
          { period: 1, participantId: 'player-1' },
          { period: 2, participantId: 'player-1' },
        ])],
      });

      const newState = engine.submitReplacementPick(state, 'entry-a', 'player-2', 3);
      const replacement = newState.entries[0].picks[2];

      expect(replacement.participantId).toBe('player-2');
      expect(replacement.multiplier).toBe(1);
      expect(replacement.isReplacement).toBe(true);
    });
  });

  // =========================================================================
  // Helpers
  // =========================================================================

  describe('getSurvivors', () => {
    it('returns only non-eliminated entries', () => {
      const state = createState({
        entries: [
          { entryId: 'a', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
          { entryId: 'b', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false },
          { entryId: 'c', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
        ],
      });
      const survivors = engine.getSurvivors(state);
      expect(survivors.map((s) => s.entryId)).toEqual(['a', 'c']);
    });
  });

  describe('hasWinner', () => {
    it('returns true when exactly one survivor remains', () => {
      const state = createState({
        entries: [
          { entryId: 'a', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
          { entryId: 'b', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false },
        ],
      });
      expect(engine.hasWinner(state)).toBe(true);
    });

    it('returns false when multiple survivors remain', () => {
      const state = createState({
        entries: [
          { entryId: 'a', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
          { entryId: 'b', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
        ],
      });
      expect(engine.hasWinner(state)).toBe(false);
    });
  });

  describe('getPendingEntries', () => {
    it('returns entries that have not yet picked for current period', () => {
      const state = createState({
        entries: [
          entryWithPicks('a', [{ period: 1, participantId: 'team-1' }]),
          { entryId: 'b', picks: [], strikes: 0, isEliminated: false, hasBoughtBack: false },
          { entryId: 'c', picks: [], strikes: 1, isEliminated: true, hasBoughtBack: false },
        ],
      });
      const pending = engine.getPendingEntries(state);
      expect(pending.map((e) => e.entryId)).toEqual(['b']);
    });
  });
});
