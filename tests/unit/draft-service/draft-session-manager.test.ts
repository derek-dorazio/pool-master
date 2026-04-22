import {
  startSession,
  pauseSession,
  resumeSession,
  completeSession,
  extendCurrentTurn,
  isPickExpired,
  transitionSession,
} from '../../../packages/core-api/src/modules/drafts/engine/draft-session-manager';
import type { SessionState } from '../../../packages/core-api/src/modules/drafts/engine/draft-session-manager';

function createSession(overrides: Partial<SessionState> = {}): SessionState {
  return {
    sessionId: 'session-1',
    contestId: 'contest-1',
    status: 'PENDING',
    currentPickNumber: 0,
    currentEntryId: null,
    startedAt: null,
    currentTurnStartedAt: null,
    timePerPickSeconds: 60,
    ...overrides,
  };
}

describe('transitionSession', () => {
  it('allows PENDING → LIVE', () => {
    const result = transitionSession(createSession(), 'LIVE');
    expect(result.success).toBe(true);
  });

  it('allows LIVE → PAUSED', () => {
    const result = transitionSession(createSession({ status: 'LIVE' }), 'PAUSED');
    expect(result.success).toBe(true);
  });

  it('allows LIVE → COMPLETE', () => {
    const result = transitionSession(createSession({ status: 'LIVE' }), 'COMPLETE');
    expect(result.success).toBe(true);
  });

  it('allows PAUSED → LIVE', () => {
    const result = transitionSession(createSession({ status: 'PAUSED' }), 'LIVE');
    expect(result.success).toBe(true);
  });

  it('rejects PENDING → COMPLETE', () => {
    const result = transitionSession(createSession(), 'COMPLETE');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('Cannot transition');
  });

  it('rejects COMPLETE → anything', () => {
    const result = transitionSession(createSession({ status: 'COMPLETE' }), 'LIVE');
    expect(result.success).toBe(false);
  });
});

describe('startSession', () => {
  it('transitions to LIVE and sets pick number to 1', () => {
    const session = startSession(createSession());
    expect(session.status).toBe('LIVE');
    expect(session.currentPickNumber).toBe(1);
    expect(session.startedAt).toBeInstanceOf(Date);
    expect(session.currentTurnStartedAt).toBeInstanceOf(Date);
  });

  it('records current turn start time when the session starts', () => {
    const session = startSession(createSession({ timePerPickSeconds: 120 }));
    expect(session.currentTurnStartedAt!.getTime()).toBe(session.startedAt!.getTime());
  });

  it('throws when starting from non-PENDING state', () => {
    expect(() => startSession(createSession({ status: 'LIVE' }))).toThrow();
  });
});

describe('pauseSession', () => {
  it('transitions to PAUSED and clears deadline', () => {
    const session = pauseSession(createSession({
      status: 'LIVE',
      currentTurnStartedAt: new Date(),
    }));
    expect(session.status).toBe('PAUSED');
    expect(session.currentTurnStartedAt).toBeNull();
  });

  it('throws when pausing from non-LIVE state', () => {
    expect(() => pauseSession(createSession({ status: 'PENDING' }))).toThrow();
  });
});

describe('resumeSession', () => {
  it('transitions to LIVE and sets new deadline', () => {
    const session = resumeSession(createSession({ status: 'PAUSED' }));
    expect(session.status).toBe('LIVE');
    expect(session.currentTurnStartedAt).toBeInstanceOf(Date);
  });

  it('throws when resuming from non-PAUSED state', () => {
    expect(() => resumeSession(createSession({ status: 'PENDING' }))).toThrow();
  });
});

describe('completeSession', () => {
  it('transitions to COMPLETE', () => {
    const session = completeSession(createSession({ status: 'LIVE' }));
    expect(session.status).toBe('COMPLETE');
    expect(session.currentTurnStartedAt).toBeNull();
  });
});

describe('extendCurrentTurn', () => {
  it('shifts the current turn start time by given seconds', () => {
    const currentTurnStartedAt = new Date();
    const session = createSession({ status: 'LIVE', currentTurnStartedAt });
    const extended = extendCurrentTurn(session, 30);
    expect(extended.currentTurnStartedAt!.getTime()).toBe(currentTurnStartedAt.getTime() + 30000);
  });

  it('throws when not LIVE', () => {
    expect(() =>
      extendCurrentTurn(createSession({ status: 'PAUSED' }), 30),
    ).toThrow();
  });

  it('throws when there is no current turn start time', () => {
    expect(() =>
      extendCurrentTurn(createSession({ status: 'LIVE', currentTurnStartedAt: null }), 30),
    ).toThrow('No current turn start time to extend');
  });
});

describe('isPickExpired', () => {
  it('returns false when not LIVE', () => {
    expect(isPickExpired(createSession({ status: 'PAUSED' }))).toBe(false);
  });

  it('returns false when deadline is in the future', () => {
    const session = createSession({
      status: 'LIVE',
      currentTurnStartedAt: new Date(),
    });
    expect(isPickExpired(session)).toBe(false);
  });

  it('returns true when deadline has passed', () => {
    const session = createSession({
      status: 'LIVE',
      currentTurnStartedAt: new Date(Date.now() - 61000),
    });
    expect(isPickExpired(session)).toBe(true);
  });
});
