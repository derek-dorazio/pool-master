import { SnakeDraftEngine } from '../../../packages/core-api/src/modules/drafts/engine/snake-draft-engine';
import type { DraftState } from '../../../packages/core-api/src/modules/drafts/engine/snake-draft-engine';

function createDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    contestId: 'contest-1',
    status: 'LIVE',
    entryIds: ['entry-a', 'entry-b', 'entry-c', 'entry-d'],
    rounds: 3,
    currentPickNumber: 1,
    picks: [],
    autoPickPolicy: 'BEST_AVAILABLE',
    ...overrides,
  };
}

describe('SnakeDraftEngine', () => {
  const engine = new SnakeDraftEngine();

  describe('getCurrentEntryId', () => {
    it('returns first entry for pick 1', () => {
      const state = createDraftState();
      expect(engine.getCurrentEntryId(state)).toBe('entry-a');
    });

    it('returns last entry for pick 4 in 4-team draft', () => {
      const state = createDraftState({ currentPickNumber: 4 });
      expect(engine.getCurrentEntryId(state)).toBe('entry-d');
    });

    it('returns last entry for pick 5 (snake reversal)', () => {
      const state = createDraftState({ currentPickNumber: 5 });
      expect(engine.getCurrentEntryId(state)).toBe('entry-d');
    });

    it('returns first entry for pick 8 (end of round 2)', () => {
      const state = createDraftState({ currentPickNumber: 8 });
      expect(engine.getCurrentEntryId(state)).toBe('entry-a');
    });
  });

  describe('validatePick', () => {
    it('rejects pick when draft is not live', () => {
      const state = createDraftState({ status: 'PENDING' });
      const result = engine.validatePick(state, { entryId: 'entry-a', participantId: 'p1' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('not live');
    });

    it('rejects pick from wrong entry', () => {
      const state = createDraftState();
      const result = engine.validatePick(state, { entryId: 'entry-b', participantId: 'p1' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('Not your turn');
    });

    it('rejects already-drafted participant', () => {
      const state = createDraftState({
        picks: [{
          pickNumber: 1, round: 1, pickInRound: 1,
          entryId: 'entry-a', participantId: 'p1',
          autoPicked: false, pickedAt: new Date(),
        }],
        currentPickNumber: 2,
      });
      const result = engine.validatePick(state, { entryId: 'entry-b', participantId: 'p1' });
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('already drafted');
    });

    it('accepts valid pick', () => {
      const state = createDraftState();
      const result = engine.validatePick(state, { entryId: 'entry-a', participantId: 'p1' });
      expect(result.valid).toBe(true);
    });
  });

  describe('applyPick', () => {
    it('adds pick and advances pick number', () => {
      const state = createDraftState();
      const newState = engine.applyPick(state, { entryId: 'entry-a', participantId: 'p1' });

      expect(newState.picks).toHaveLength(1);
      expect(newState.picks[0].participantId).toBe('p1');
      expect(newState.picks[0].entryId).toBe('entry-a');
      expect(newState.picks[0].round).toBe(1);
      expect(newState.currentPickNumber).toBe(2);
      expect(newState.status).toBe('LIVE');
    });

    it('does not mutate original state', () => {
      const state = createDraftState();
      const newState = engine.applyPick(state, { entryId: 'entry-a', participantId: 'p1' });

      expect(state.picks).toHaveLength(0);
      expect(state.currentPickNumber).toBe(1);
      expect(newState).not.toBe(state);
    });

    it('marks draft as complete when last pick is made', () => {
      const state = createDraftState({
        entryIds: ['entry-a', 'entry-b'],
        rounds: 1,
        currentPickNumber: 2,
        picks: [{
          pickNumber: 1, round: 1, pickInRound: 1,
          entryId: 'entry-a', participantId: 'p1',
          autoPicked: false, pickedAt: new Date(),
        }],
      });

      const newState = engine.applyPick(state, { entryId: 'entry-b', participantId: 'p2' });
      expect(newState.status).toBe('COMPLETE');
    });

    it('records autoPicked flag', () => {
      const state = createDraftState();
      const newState = engine.applyPick(
        state,
        { entryId: 'entry-a', participantId: 'p1' },
        true,
      );
      expect(newState.picks[0].autoPicked).toBe(true);
    });
  });

  describe('resolveAutoPick', () => {
    it('picks from queue first with QUEUE_THEN_BEST policy', () => {
      const state = createDraftState({ autoPickPolicy: 'QUEUE_THEN_BEST' });
      const result = engine.resolveAutoPick(state, {
        entryId: 'entry-a',
        queue: ['p3', 'p1', 'p2'],
        availableParticipantIds: ['p1', 'p2', 'p3', 'p4'],
      });
      expect(result).toBe('p3');
    });

    it('falls back to best available when queue is empty', () => {
      const state = createDraftState({ autoPickPolicy: 'QUEUE_THEN_BEST' });
      const result = engine.resolveAutoPick(state, {
        entryId: 'entry-a',
        queue: [],
        availableParticipantIds: ['p1', 'p2'],
      });
      expect(result).toBe('p1');
    });

    it('skips taken participants from queue', () => {
      const state = createDraftState({
        autoPickPolicy: 'QUEUE_THEN_BEST',
        picks: [{
          pickNumber: 1, round: 1, pickInRound: 1,
          entryId: 'entry-a', participantId: 'p1',
          autoPicked: false, pickedAt: new Date(),
        }],
      });
      const result = engine.resolveAutoPick(state, {
        entryId: 'entry-b',
        queue: ['p1', 'p2'],
        availableParticipantIds: ['p1', 'p2', 'p3'],
      });
      expect(result).toBe('p2');
    });

    it('picks first available with BEST_AVAILABLE policy', () => {
      const state = createDraftState({ autoPickPolicy: 'BEST_AVAILABLE' });
      const result = engine.resolveAutoPick(state, {
        entryId: 'entry-a',
        queue: [],
        availableParticipantIds: ['p1', 'p2', 'p3'],
      });
      expect(result).toBe('p1');
    });

    it('returns null when no participants available', () => {
      const state = createDraftState({
        picks: [
          { pickNumber: 1, round: 1, pickInRound: 1, entryId: 'entry-a', participantId: 'p1', autoPicked: false, pickedAt: new Date() },
        ],
      });
      const result = engine.resolveAutoPick(state, {
        entryId: 'entry-b',
        queue: [],
        availableParticipantIds: ['p1'],
      });
      expect(result).toBeNull();
    });
  });

  describe('isComplete', () => {
    it('returns false when picks remain', () => {
      const state = createDraftState();
      expect(engine.isComplete(state)).toBe(false);
    });

    it('returns true when all picks are made', () => {
      const state = createDraftState({
        entryIds: ['a', 'b'],
        rounds: 1,
        currentPickNumber: 3,
      });
      expect(engine.isComplete(state)).toBe(true);
    });
  });

  describe('getEntryRoster', () => {
    it('returns only picks for the specified entry', () => {
      const state = createDraftState({
        picks: [
          { pickNumber: 1, round: 1, pickInRound: 1, entryId: 'entry-a', participantId: 'p1', autoPicked: false, pickedAt: new Date() },
          { pickNumber: 2, round: 1, pickInRound: 2, entryId: 'entry-b', participantId: 'p2', autoPicked: false, pickedAt: new Date() },
          { pickNumber: 3, round: 1, pickInRound: 3, entryId: 'entry-a', participantId: 'p3', autoPicked: false, pickedAt: new Date() },
        ],
      });
      const roster = engine.getEntryRoster(state, 'entry-a');
      expect(roster).toHaveLength(2);
      expect(roster.map((p) => p.participantId)).toEqual(['p1', 'p3']);
    });
  });
});
