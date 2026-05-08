import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import { AuthProvider, useAuth } from './auth-provider';
import {
  AUTH_ME_QUERY_KEY,
  setAuthSessionUser,
  type AuthSessionUser,
} from './auth-session-cache';
import { QueryKeys } from '@/lib/query-keys';

const {
  getCurrentUserMock,
  logoutUserMock,
  mockLogger,
  refreshTokenMock,
} = vi.hoisted(() => {
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
    getCurrentUserMock: vi.fn(),
    logoutUserMock: vi.fn(),
    mockLogger: logger,
    refreshTokenMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  getCurrentUser: getCurrentUserMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
});

function buildUser(overrides?: Partial<AuthSessionUser>): AuthSessionUser {
  return {
    ...createUserBase(),
    ...overrides,
  };
}

function createUserBase(): AuthSessionUser {
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

function AuthProbe() {
  const auth = useAuth();

  return (
    <div>
      <div data-testid="auth-state">{auth.user?.id ?? 'guest'}</div>
      <div data-testid="auth-session-id">{auth.user?.sessionId ?? 'none'}</div>
      <button
        data-testid="auth-clear-session"
        onClick={() => {
          void auth.clearSession();
        }}
        type="button"
      >
        Clear session
      </button>
    </div>
  );
}

function renderAuthProvider(options?: { user?: AuthSessionUser }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });
  if (options?.user) {
    setAuthSessionUser(queryClient, options.user);
  }

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );

  return { ...utils, queryClient };
}

describe('AuthProvider', () => {
  afterEach(() => {
    getCurrentUserMock.mockReset();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
  });

  it('pool-master-rop.78.11 hydrates auth from the current-user query cache', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: buildUser(),
      },
    });

    const { queryClient } = renderAuthProvider();

    await screen.findByText('user-1');

    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)?.id).toBe('user-1');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.me.succeeded',
        data: expect.objectContaining({
          userId: 'user-1',
        }),
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.78.11 recovers the query-cached session through refresh', async () => {
    getCurrentUserMock
      .mockRejectedValueOnce(new Error('Unauthorized'))
      .mockResolvedValueOnce({
        data: {
          user: buildUser({
            id: 'user-2',
            sessionId: 'session-2',
          }),
        },
      });
    refreshTokenMock.mockResolvedValue({
      data: {
        sessionId: 'session-2',
      },
    });

    const { queryClient } = renderAuthProvider();

    await screen.findByText('user-2');

    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)?.sessionId).toBe('session-2');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.refresh.succeeded',
        data: expect.objectContaining({
          sessionId: 'session-2',
          userId: 'user-2',
        }),
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.78.11 clears query-cached auth when refresh returns no session data', async () => {
    getCurrentUserMock.mockRejectedValue(new Error('Unauthorized'));
    refreshTokenMock.mockResolvedValue({
      data: null,
    });

    const { queryClient } = renderAuthProvider({ user: buildUser() });

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('guest'));

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.refresh.missingSession',
      }),
      expect.any(String),
    );
  });

  // pool-master-dxd.12 — Auth refresh guard re-arms whenever meQuery.error
  // transitions, allowing repeated refresh attempts. The guard must stay armed
  // across me-query flaps that do NOT pass through a successful
  // refresh+refetch recovery — otherwise a flaky /auth/me endpoint will
  // repeatedly fire /auth/refresh and clear the user's local session each time
  // refresh fails.
  it('does not re-fire refresh on a me-query flap once the initial refresh attempt has resolved', async () => {
    getCurrentUserMock
      .mockRejectedValueOnce(new Error('Unauthorized'))
      .mockResolvedValueOnce({
        data: {
          user: buildUser(),
        },
      })
      .mockRejectedValueOnce(new Error('Unauthorized'));
    refreshTokenMock.mockResolvedValue({
      data: null,
    });

    const { queryClient } = renderAuthProvider();

    // Step 1: initial me failure → first refresh attempt (resolves with no
    // session data → clearSessionState).
    await waitFor(() => {
      expect(refreshTokenMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    });

    // Step 2: external invalidation that succeeds. This is the "recovery
    // without refresh" the bug used to re-arm on. The guard must absorb it.
    await queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me });
    await waitFor(() => {
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)?.id).toBe('user-1');
    });

    // Step 3: external invalidation that fails. With the broken guard this
    // triggers a second refresh attempt. With the fix the guard stays armed.
    await queryClient.invalidateQueries({ queryKey: QueryKeys.auth.me });

    // Allow any pending effects to flush before asserting the count.
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(refreshTokenMock).toHaveBeenCalledTimes(1);
  });

  it('clears local state even when the logout request fails', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: buildUser(),
      },
    });
    logoutUserMock.mockRejectedValue(new Error('Network failure'));

    const { queryClient } = renderAuthProvider();

    await screen.findByText('user-1');
    fireEvent.click(screen.getByTestId('auth-clear-session'));

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('guest'));

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.logout.failed',
      }),
      expect.any(String),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.logout.completed',
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.4 clears local state when generated logout returns an error envelope', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: buildUser(),
      },
    });
    logoutUserMock.mockResolvedValue({
      error: {
        code: 'AUTH_LOGOUT_FAILED',
        message: 'Logout failed',
      },
    });

    const { queryClient } = renderAuthProvider();

    await screen.findByText('user-1');
    fireEvent.click(screen.getByTestId('auth-clear-session'));

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('guest'));

    expect(queryClient.getQueryData(AUTH_ME_QUERY_KEY)).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.logout.failed',
        err: expect.objectContaining({
          code: 'AUTH_LOGOUT_FAILED',
          message: 'Logout failed',
        }),
      }),
      expect.any(String),
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.logout.completed',
      }),
      expect.any(String),
    );
  });
});
