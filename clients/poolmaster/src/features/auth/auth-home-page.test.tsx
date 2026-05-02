import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSessionStore } from './session-store';
import { AuthHomePage } from './auth-home-page';

const {
  fetchInvitationPreviewMock,
  fetchTeamOwnerInvitationPreviewMock,
  loginUserMock,
  mockLogger,
  registerUserMock,
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
    fetchInvitationPreviewMock: vi.fn(),
    fetchTeamOwnerInvitationPreviewMock: vi.fn(),
    loginUserMock: vi.fn(),
    mockLogger: logger,
    registerUserMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

vi.mock('@/lib/api', () => ({
  loginUser: (...args: unknown[]) => loginUserMock(...args),
  registerUser: (...args: unknown[]) => registerUserMock(...args),
}));

vi.mock('@/features/leagues/invitation-context-card', () => ({
  InvitationContextCard: ({
    title,
  }: {
    title: string;
  }) => <div data-testid="invitation-context-card">{title}</div>,
}));

vi.mock('@/features/leagues/invitation-preview', () => ({
  fetchInvitationPreview: (...args: unknown[]) => fetchInvitationPreviewMock(...args),
  getInvitationPreviewQueryKey: (inviteCode: string) => ['test', 'league-invite', inviteCode],
}));

vi.mock('@/features/teams/team-owner-invitation-preview', () => ({
  fetchTeamOwnerInvitationPreview: (...args: unknown[]) => fetchTeamOwnerInvitationPreviewMock(...args),
  getTeamOwnerInvitationPreviewQueryKey: (inviteCode: string) => ['test', 'team-invite', inviteCode],
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

function renderAuthHomePage(
  initialEntry:
    | string
    | {
      pathname: string;
      state?: unknown;
    } = '/',
) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<AuthHomePage />} path="/" />
          <Route element={<div data-testid="welcome-destination" />} path="/welcome" />
          <Route element={<div data-testid="manage-destination" />} path="/manage" />
          <Route element={<div data-testid="invite-destination" />} path="/invite/:inviteCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AuthHomePage', () => {
  afterEach(() => {
    loginUserMock.mockReset();
    registerUserMock.mockReset();
    fetchInvitationPreviewMock.mockReset();
    fetchTeamOwnerInvitationPreviewMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
    useSessionStore.getState().clearSession();
  });

  it('signs in successfully and navigates to the destination', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser(),
      },
    });

    renderAuthHomePage();

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    await screen.findByTestId('welcome-destination');

    expect(useSessionStore.getState().user?.id).toBe('user-1');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.succeeded',
        data: expect.objectContaining({
          destination: '/welcome',
          userId: 'user-1',
        }),
      }),
      expect.any(String),
    );
  });

  it('redirects root admins to /manage after login when there is no explicit destination', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser({ isRootAdmin: true }),
      },
    });

    renderAuthHomePage();

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    await screen.findByTestId('manage-destination');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.succeeded',
        data: expect.objectContaining({
          destination: '/manage',
          isRootAdmin: true,
        }),
      }),
      expect.any(String),
    );
  });

  it('still honors an explicit routeState.from for a root admin after login', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser({ isRootAdmin: true }),
      },
    });

    renderAuthHomePage({
      pathname: '/',
      state: {
        from: '/invite/LEAGUE123',
      },
    });

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    await screen.findByTestId('invite-destination');

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.succeeded',
        data: expect.objectContaining({
          destination: '/invite/LEAGUE123',
          isRootAdmin: true,
        }),
      }),
      expect.any(String),
    );
  });

  it('shows a server error when registration is rejected with an expected auth failure', async () => {
    registerUserMock.mockResolvedValue({
      error: {
        message: 'Email is already in use.',
      },
    });

    renderAuthHomePage();

    fireEvent.click(screen.getByRole('radio', { name: 'Create account' }));
    fireEvent.change(screen.getByTestId('auth-register-first-name'), {
      target: { value: 'Derek' },
    });
    fireEvent.change(screen.getByTestId('auth-register-last-name'), {
      target: { value: 'Dorazio' },
    });
    fireEvent.change(screen.getByTestId('auth-register-email'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-register-username'), {
      target: { value: 'derek' },
    });
    fireEvent.change(screen.getByTestId('auth-register-password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByTestId('auth-register-confirm-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-register-submit'));

    await screen.findByRole('alert');

    expect(screen.getByText('Email is already in use.')).toBeVisible();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.register.failed',
        data: expect.objectContaining({
          destination: '/welcome',
        }),
      }),
      expect.any(String),
    );
  });

  it('treats a malformed login response as an unexpected error path', async () => {
    loginUserMock.mockResolvedValue({
      data: null,
    });

    renderAuthHomePage();

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    await screen.findByRole('alert');

    expect(screen.getByText('Login response is missing data.')).toBeVisible();
    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.failed',
      }),
      expect.any(String),
    );
  });

  it('warns and keeps the invitation warning visible when invite preview lookup fails', async () => {
    fetchInvitationPreviewMock.mockRejectedValue(new Error('Preview unavailable'));

    renderAuthHomePage({
      pathname: '/',
      state: {
        from: '/invite/LEAGUE123',
      },
    });

    await screen.findByText(/We couldn't load the invitation preview/i);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.leagueInvitePreview.failed',
        data: expect.objectContaining({
          destination: '/invite/LEAGUE123',
          inviteCode: 'LEAGUE123',
        }),
      }),
      expect.any(String),
    );
  });
});
