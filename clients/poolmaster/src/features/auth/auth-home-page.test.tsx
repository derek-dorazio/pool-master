import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  AUTH_ME_QUERY_KEY,
  type AuthSessionUser,
} from './auth-session-cache';
import { AuthHomePage } from './auth-home-page';
import type { fetchInvitationPreview } from '@/features/leagues/invitation-preview';
import type { fetchTeamOwnerInvitationPreview } from '@/features/teams/team-owner-invitation-preview';

const {
  authState,
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
    fetchInvitationPreviewMock: vi.fn<typeof fetchInvitationPreview>(),
    fetchTeamOwnerInvitationPreviewMock: vi.fn<typeof fetchTeamOwnerInvitationPreview>(),
    authState: {
      user: null,
      isAuthenticated: false,
      isLoading: false,
      isRootAdmin: false,
      clearSession: vi.fn(),
    },
    loginUserMock: vi.fn(),
    mockLogger: logger,
    registerUserMock: vi.fn(),
  };
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

bindApiMocks({
  loginUser: loginUserMock,
  registerUser: registerUserMock,
});

vi.mock('./auth-context', () => ({
  useAuth: () => authState,
}));

vi.mock('@/features/leagues/invitation-context-card', () => ({
  InvitationContextCard: ({
    title,
  }: {
    title: string;
  }) => <div data-testid="invitation-context-card">{title}</div>,
}));

vi.mock('@/features/leagues/invitation-preview', () => ({
  fetchInvitationPreview: fetchInvitationPreviewMock,
  getInvitationPreviewQueryKey: (inviteCode: string) => ['test', 'league-invite', inviteCode],
}));

vi.mock('@/features/teams/team-owner-invitation-preview', () => ({
  fetchTeamOwnerInvitationPreview: fetchTeamOwnerInvitationPreviewMock,
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

  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<AuthHomePage />} path="/" />
          <Route element={<div data-testid="welcome-destination" />} path="/welcome" />
          <Route element={<div data-testid="manage-destination" />} path="/manage" />
          <Route element={<div data-testid="my-account-destination" />} path="/my-account" />
          <Route element={<div data-testid="invite-destination" />} path="/invite/:inviteCode" />
          <Route element={<div data-testid="league-destination" />} path="/league/:leagueCode" />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return { ...utils, queryClient };
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
    authState.user = null;
    authState.isAuthenticated = false;
    authState.isRootAdmin = false;
    authState.clearSession.mockReset();
  });

  it('opens on Create account with a banner naming the pool when an event page\'s start waits behind sign-up', () => {
    renderAuthHomePage({
      pathname: '/',
      state: { authMode: 'register', from: '/start?sport=american-football&page=championship-weekend&template=t-1' },
    });

    expect(screen.getByTestId('auth-start-banner')).toHaveTextContent('You\'re starting a Championship Weekend pool');
    expect(screen.getByRole('radio', { name: 'Create account' })).toBeChecked();
  });

  it('offers a Forgot password? link on the sign in form, and not on the create account form', () => {
    renderAuthHomePage();

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');

    fireEvent.click(screen.getByRole('radio', { name: 'Create account' }));

    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument();
  });

  it('signs in successfully and navigates to the destination', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser(),
      },
    });

    const { queryClient } = renderAuthHomePage();

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    await screen.findByTestId('welcome-destination');

    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)?.id).toBe('user-1');
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.login.succeeded',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({
          destination: '/welcome',
          userId: 'user-1',
        }),
      }),
      expect.any(String),
    );
  });

  it('sends an inactive account to its own account page after login, even with another destination requested', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser({ isActive: false }),
      },
    });

    renderAuthHomePage({ pathname: '/', state: { from: '/league/ABC123' } });

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    expect(await screen.findByTestId('my-account-destination')).toBeInTheDocument();
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({
          destination: '/manage',
          isRootAdmin: true,
        }),
      }),
      expect.any(String),
    );
  });

  it('lands a root admin on Manage, not on a page another account was signed out of', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser({ isRootAdmin: true }),
      },
    });

    renderAuthHomePage({
      pathname: '/',
      state: { from: '/league/ABC123', fromUserId: 'another-user' },
    });

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'admin@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    expect(await screen.findByTestId('manage-destination')).toBeInTheDocument();
    expect(screen.queryByTestId('league-destination')).not.toBeInTheDocument();
  });

  it('lands an ordinary member on Welcome, not on a page another account was signed out of', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser(),
      },
    });

    renderAuthHomePage({
      pathname: '/',
      state: { from: '/league/ABC123', fromUserId: 'another-user' },
    });

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    expect(await screen.findByTestId('welcome-destination')).toBeInTheDocument();
    expect(screen.queryByTestId('league-destination')).not.toBeInTheDocument();
  });

  it('returns the same account to the page it was signed out of', async () => {
    loginUserMock.mockResolvedValue({
      data: {
        user: createUser(),
      },
    });

    renderAuthHomePage({
      pathname: '/',
      state: { from: '/league/ABC123', fromUserId: 'user-1' },
    });

    fireEvent.change(screen.getByTestId('auth-login-identifier'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('auth-login-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('auth-login-submit'));

    expect(await screen.findByTestId('league-destination')).toBeInTheDocument();
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
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
        error: {
          code: 'AUTH_EMAIL_IN_USE',
          message: 'Email is already in use.',
        },
      },
    });

    renderAuthHomePage();

    fireEvent.click(screen.getByRole('radio', { name: 'Create account' }));
    fireEvent.change(screen.getByTestId('sign-up-first-name'), {
      target: { value: 'Derek' },
    });
    fireEvent.change(screen.getByTestId('sign-up-last-name'), {
      target: { value: 'Dorazio' },
    });
    fireEvent.change(screen.getByTestId('sign-up-email'), {
      target: { value: 'derek@example.com' },
    });
    fireEvent.change(screen.getByTestId('sign-up-username'), {
      target: { value: 'derek' },
    });
    fireEvent.change(screen.getByTestId('sign-up-password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByTestId('sign-up-confirm-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('sign-up-submit'));

    await screen.findByRole('alert');

    expect(screen.getByText('Email is already in use.')).toBeVisible();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.register.failed',
        data: { hasTeamInvitation: false },
      }),
      expect.any(String),
    );
  });

  it('pool-master-rop.78.11 writes registered users to the auth query cache', async () => {
    registerUserMock.mockResolvedValue({
      data: {
        user: createUser({
          id: 'user-registered',
          email: 'registered@example.com',
          username: 'registered',
        }),
      },
    });

    const { queryClient } = renderAuthHomePage();

    fireEvent.click(screen.getByRole('radio', { name: 'Create account' }));
    fireEvent.change(screen.getByTestId('sign-up-first-name'), {
      target: { value: 'Reg' },
    });
    fireEvent.change(screen.getByTestId('sign-up-last-name'), {
      target: { value: 'User' },
    });
    fireEvent.change(screen.getByTestId('sign-up-email'), {
      target: { value: 'registered@example.com' },
    });
    fireEvent.change(screen.getByTestId('sign-up-username'), {
      target: { value: 'registered' },
    });
    fireEvent.change(screen.getByTestId('sign-up-password'), {
      target: { value: 'password123' },
    });
    fireEvent.change(screen.getByTestId('sign-up-confirm-password'), {
      target: { value: 'password123' },
    });
    fireEvent.click(screen.getByTestId('sign-up-submit'));

    await screen.findByTestId('welcome-destination');

    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
      id: 'user-registered',
      email: 'registered@example.com',
      username: 'registered',
    });
  });

  function fillAndSubmitRegisterForm(timeZone?: string) {
    fireEvent.click(screen.getByRole('radio', { name: 'Create account' }));
    fireEvent.change(screen.getByTestId('sign-up-first-name'), { target: { value: 'Reg' } });
    fireEvent.change(screen.getByTestId('sign-up-last-name'), { target: { value: 'User' } });
    fireEvent.change(screen.getByTestId('sign-up-email'), {
      target: { value: 'registered@example.com' },
    });
    fireEvent.change(screen.getByTestId('sign-up-username'), { target: { value: 'registered' } });
    fireEvent.change(screen.getByTestId('sign-up-password'), { target: { value: 'password123' } });
    fireEvent.change(screen.getByTestId('sign-up-confirm-password'), {
      target: { value: 'password123' },
    });
    if (timeZone) {
      fireEvent.change(screen.getByTestId('sign-up-time-zone'), { target: { value: timeZone } });
    }
    fireEvent.click(screen.getByTestId('sign-up-submit'));
  }

  it('sends the time zone picked at signup and the browser locale with the new account', async () => {
    registerUserMock.mockResolvedValue({ data: { user: createUser({ id: 'user-registered' }) } });

    renderAuthHomePage();
    fillAndSubmitRegisterForm('America/Chicago');
    await screen.findByTestId('welcome-destination');

    expect(registerUserMock).toHaveBeenCalledTimes(1);
    expect(registerUserMock.mock.calls[0]?.[0]).toMatchObject({
      body: {
        timezone: 'America/Chicago',
        locale: Intl.DateTimeFormat().resolvedOptions().locale,
      },
    });
  });

  it('signs up again without the time zone and locale when the server refuses the browser zone, so signup still succeeds', async () => {
    registerUserMock
      .mockResolvedValueOnce({
        error: { error: { code: 'TIME_ZONE_UNKNOWN', message: 'Unknown time zone' } },
      })
      .mockResolvedValueOnce({ data: { user: createUser({ id: 'user-registered' }) } });

    renderAuthHomePage();
    fillAndSubmitRegisterForm();
    await screen.findByTestId('welcome-destination');

    expect(registerUserMock).toHaveBeenCalledTimes(2);
    const retryBody = (registerUserMock.mock.calls[1]?.[0] as { body: Record<string, unknown> }).body;
    expect(retryBody).not.toHaveProperty('timezone');
    expect(retryBody).not.toHaveProperty('locale');
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'auth.register.displayPreferencesRefused' }),
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
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({
          destination: '/invite/LEAGUE123',
          inviteCode: 'LEAGUE123',
        }),
      }),
      expect.any(String),
    );
  });
});
