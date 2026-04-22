import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './auth-provider';
import { useSessionStore } from './session-store';

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
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

vi.mock('@/lib/api', () => ({
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
}));

function buildUser(overrides?: Partial<ReturnType<typeof createUserBase>>) {
  return {
    ...createUserBase(),
    ...overrides,
  };
}

function createUserBase() {
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

function renderAuthProvider() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    </QueryClientProvider>,
  );
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
    useSessionStore.getState().clearSession();
  });

  it('hydrates the session when the current-user query succeeds', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: buildUser(),
      },
    });

    renderAuthProvider();

    await screen.findByText('user-1');

    expect(useSessionStore.getState().user?.id).toBe('user-1');
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

  it('recovers the session through refresh when the current-user query initially fails', async () => {
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

    renderAuthProvider();

    await screen.findByText('user-2');

    expect(useSessionStore.getState().sessionId).toBe('session-2');
    expect(useSessionStore.getState().user?.sessionId).toBe('session-2');
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

  it('clears the session when refresh does not return replacement session data', async () => {
    useSessionStore.getState().setSession(buildUser());
    getCurrentUserMock.mockRejectedValue(new Error('Unauthorized'));
    refreshTokenMock.mockResolvedValue({
      data: null,
    });

    renderAuthProvider();

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('guest'));

    expect(useSessionStore.getState().user).toBeNull();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.refresh.missingSession',
      }),
      expect.any(String),
    );
  });

  it('clears local state even when the logout request fails', async () => {
    getCurrentUserMock.mockResolvedValue({
      data: {
        user: buildUser(),
      },
    });
    logoutUserMock.mockRejectedValue(new Error('Network failure'));

    renderAuthProvider();

    await screen.findByText('user-1');
    fireEvent.click(screen.getByTestId('auth-clear-session'));

    await waitFor(() => expect(screen.getByTestId('auth-state')).toHaveTextContent('guest'));

    expect(useSessionStore.getState().user).toBeNull();
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
});
