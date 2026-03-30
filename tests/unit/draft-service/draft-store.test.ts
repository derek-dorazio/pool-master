import { DraftStore } from '../../../packages/core-api/src/modules/drafts/storage/draft-store';
import type { DraftState } from '../../../packages/core-api/src/modules/drafts/engine/snake-draft-engine';
import type { SessionState } from '../../../packages/core-api/src/modules/drafts/engine/draft-session-manager';

function makeSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'session-1',
    contestId: 'contest-1',
    status: 'LIVE',
    currentPickNumber: 1,
    currentEntryId: 'entry-a',
    startedAt: new Date(),
    pickDeadline: null,
    timePerPickSeconds: 60,
    ...overrides,
  };
}

function makeDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    contestId: 'contest-1',
    status: 'LIVE',
    entryIds: ['entry-a', 'entry-b'],
    rounds: 3,
    currentPickNumber: 1,
    picks: [],
    autoPickPolicy: 'BEST_AVAILABLE',
    ...overrides,
  };
}

describe('DraftStore', () => {
  let store: DraftStore;

  beforeEach(() => {
    store = new DraftStore();
  });

  it('stores and retrieves a session', async () => {
    const session = makeSession();
    await store.setSession('contest-1', session);
    const retrieved = await store.getSession('contest-1');
    expect(retrieved).toEqual(session);
  });

  it('returns undefined for missing session', async () => {
    expect(await store.getSession('nonexistent')).toBeUndefined();
  });

  it('stores and retrieves draft state', async () => {
    const state = makeDraftState();
    await store.setState('contest-1', state);
    expect(await store.getState('contest-1')).toEqual(state);
  });

  it('stores and retrieves available participants (defensive copy)', async () => {
    const ids = ['p1', 'p2', 'p3'];
    await store.setAvailableParticipants('contest-1', ids);

    // Mutating the original array should not affect the store
    ids.push('p4');
    const retrieved = await store.getAvailableParticipants('contest-1');
    expect(retrieved).toEqual(['p1', 'p2', 'p3']);
  });

  it('returns empty array for missing available participants', async () => {
    expect(await store.getAvailableParticipants('nonexistent')).toEqual([]);
  });

  it('has() reflects session existence', async () => {
    expect(store.has('contest-1')).toBe(false);
    await store.setSession('contest-1', makeSession());
    expect(store.has('contest-1')).toBe(true);
  });

  it('remove() deletes all data for a contest', async () => {
    await store.setSession('contest-1', makeSession());
    await store.setState('contest-1', makeDraftState());
    await store.setAvailableParticipants('contest-1', ['p1']);

    await store.remove('contest-1');

    expect(store.has('contest-1')).toBe(false);
    expect(await store.getState('contest-1')).toBeUndefined();
    expect(await store.getAvailableParticipants('contest-1')).toEqual([]);
  });

  it('clear() wipes everything', async () => {
    await store.setSession('c1', makeSession({ contestId: 'c1' }));
    await store.setSession('c2', makeSession({ contestId: 'c2' }));

    store.clear();

    expect(store.has('c1')).toBe(false);
    expect(store.has('c2')).toBe(false);
  });
});
