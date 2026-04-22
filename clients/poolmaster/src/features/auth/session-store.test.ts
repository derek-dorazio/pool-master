import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './session-store';

const { mockLogger } = vi.hoisted(() => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };

  logger.child.mockImplementation(() => logger);

  return {
    mockLogger: logger,
  };
});

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function createUser(overrides?: Partial<ReturnType<typeof buildUser>>) {
  return {
    ...buildUser(),
    ...overrides,
  };
}

function buildUser() {
  return {
    id: 'user-1',
    username: 'derek',
    email: 'derek@example.com',
    firstName: 'Derek',
    lastName: 'Dorazio',
    isActive: true,
    isRootAdmin: false,
    createdAt: '2026-04-22T00:00:00.000Z',
    sessionId: 'session-1',
  };
}

describe('session-store', () => {
  afterEach(() => {
    useSessionStore.getState().clearSession();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
  });

  it('reuses the existing session id when setting a user without one', () => {
    useSessionStore.getState().setSessionId('session-1');
    useSessionStore.getState().setSession({
      id: 'user-1',
      username: 'derek',
      email: 'derek@example.com',
      firstName: 'Derek',
      lastName: 'Dorazio',
      isActive: true,
      isRootAdmin: false,
      createdAt: '2026-04-22T00:00:00.000Z',
    } as any);

    expect(useSessionStore.getState().user?.sessionId).toBe('session-1');
    expect(useSessionStore.getState().sessionId).toBe('session-1');
    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.session.set',
      }),
      expect.any(String),
    );
  });

  it('clears both the user and session id together', () => {
    useSessionStore.getState().setSession(
      createUser({
        sessionId: 'session-9',
      }),
    );

    useSessionStore.getState().clearSession();

    expect(useSessionStore.getState().user).toBeNull();
    expect(useSessionStore.getState().sessionId).toBeNull();
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.session.cleared',
        data: expect.objectContaining({
          hadUser: true,
          hadSessionId: true,
        }),
      }),
      expect.any(String),
    );
  });
});
