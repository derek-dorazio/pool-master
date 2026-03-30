import {
  OpenSelectionEngine,
  type OpenSelectionConfig,
  type OpenSelectionState,
} from '../../../packages/core-api/src/modules/drafts/engine/open-selection-engine';

const pool = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];

function makeConfig(overrides: Partial<OpenSelectionConfig> = {}): OpenSelectionConfig {
  return {
    pickCount: 3,
    isExclusive: false,
    poolParticipantIds: pool,
    ...overrides,
  };
}

function makeState(overrides: Partial<OpenSelectionState> = {}): OpenSelectionState {
  return {
    contestId: 'contest-1',
    config: makeConfig(),
    entries: [],
    ...overrides,
  };
}

describe('OpenSelectionEngine', () => {
  const engine = new OpenSelectionEngine();

  describe('validatePicks', () => {
    it('accepts valid picks', () => {
      const result = engine.validatePicks(['p1', 'p2', 'p3'], makeConfig());
      expect(result.valid).toBe(true);
    });

    it('rejects wrong pick count', () => {
      const result = engine.validatePicks(['p1', 'p2'], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('exactly 3');
    });

    it('rejects duplicate picks', () => {
      const result = engine.validatePicks(['p1', 'p1', 'p2'], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Duplicate');
    });

    it('rejects participant not in pool', () => {
      const result = engine.validatePicks(['p1', 'p2', 'p99'], makeConfig());
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('p99');
    });

    it('rejects pick after deadline', () => {
      const pastDeadline = new Date(Date.now() - 60_000);
      const config = makeConfig({ deadline: pastDeadline });
      const result = engine.validatePicks(['p1', 'p2', 'p3'], config);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('deadline');
    });

    it('rejects exclusive pick already taken by another entry', () => {
      const config = makeConfig({ isExclusive: true });
      const existing = [{ entryId: 'other', picks: ['p1', 'p2', 'p3'], isComplete: true }];
      const result = engine.validatePicks(['p1', 'p4', 'p5'], config, existing, 'me');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('p1');
    });

    it('allows exclusive re-submit for same entry', () => {
      const config = makeConfig({ isExclusive: true });
      const existing = [{ entryId: 'me', picks: ['p1', 'p2', 'p3'], isComplete: true }];
      const result = engine.validatePicks(['p1', 'p2', 'p3'], config, existing, 'me');
      expect(result.valid).toBe(true);
    });
  });

  describe('submitPicks', () => {
    it('returns success with entry on valid submission', () => {
      const state = makeState();
      const result = engine.submitPicks(state, 'entry-1', ['p1', 'p2', 'p3']);
      expect(result.success).toBe(true);
      expect(result.entry).toBeDefined();
      expect(result.entry!.entryId).toBe('entry-1');
      expect(result.entry!.isComplete).toBe(true);
    });

    it('returns failure on invalid picks', () => {
      const state = makeState();
      const result = engine.submitPicks(state, 'entry-1', ['p1']);
      expect(result.success).toBe(false);
    });
  });

  describe('applySubmission', () => {
    it('adds a new entry', () => {
      const state = makeState();
      const updated = engine.applySubmission(state, 'entry-1', ['p1', 'p2', 'p3']);
      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].entryId).toBe('entry-1');
    });

    it('replaces existing entry on re-submit', () => {
      const state = makeState({
        entries: [{ entryId: 'entry-1', picks: ['p1', 'p2', 'p3'], isComplete: true }],
      });
      const updated = engine.applySubmission(state, 'entry-1', ['p4', 'p5', 'p6']);
      expect(updated.entries).toHaveLength(1);
      expect(updated.entries[0].picks).toEqual(['p4', 'p5', 'p6']);
    });
  });

  describe('getAvailableParticipants', () => {
    it('returns full pool in non-exclusive mode', () => {
      const state = makeState({
        entries: [{ entryId: 'other', picks: ['p1', 'p2', 'p3'], isComplete: true }],
      });
      expect(engine.getAvailableParticipants(state, 'me')).toEqual(pool);
    });

    it('excludes taken participants in exclusive mode', () => {
      const state = makeState({
        config: makeConfig({ isExclusive: true }),
        entries: [{ entryId: 'other', picks: ['p1', 'p2', 'p3'], isComplete: true }],
      });
      expect(engine.getAvailableParticipants(state, 'me')).toEqual(['p4', 'p5', 'p6']);
    });
  });

  describe('isAllComplete', () => {
    it('returns true when all entries are complete', () => {
      const state = makeState({
        entries: [
          { entryId: 'a', picks: ['p1', 'p2', 'p3'], isComplete: true },
          { entryId: 'b', picks: ['p4', 'p5', 'p6'], isComplete: true },
        ],
      });
      expect(engine.isAllComplete(state)).toBe(true);
    });

    it('returns false when some entries are incomplete', () => {
      const state = makeState({
        entries: [
          { entryId: 'a', picks: ['p1', 'p2', 'p3'], isComplete: true },
          { entryId: 'b', picks: [], isComplete: false },
        ],
      });
      expect(engine.isAllComplete(state)).toBe(false);
    });
  });
});
