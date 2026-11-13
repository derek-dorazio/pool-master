import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
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

/** Radix tabs switch on the mouse press, as a real click starts. */
function openCreateAccount() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Create account' }));
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
    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
  });

  it('offers a Forgot password? link on the sign in form, and not on the create account form', () => {
    renderAuthHomePage();

    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute('href', '/forgot-password');

    openCreateAccount();

    expect(screen.queryByRole('link', { name: 'Forgot password?' })).not.toBeInTheDocument();
  });

  it('hides the sign in password until the eye button is pressed, then shows it, and hides it again on a second press', () => {
    renderAuthHomePage();

    const password = screen.getByTestId('auth-login-password');
    fireEvent.change(password, { target: { value: 'password123' } });
    expect(password).toHaveAttribute('type', 'password');
    expect(password).toHaveAttribute('autocomplete', 'current-password');

    const toggle = screen.getByRole('button', { name: 'Show password' });
    fireEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'text');
    expect(password).toHaveValue('password123');
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(toggle);
    expect(password).toHaveAttribute('type', 'password');
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

    openCreateAccount();
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

    openCreateAccount();
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
    openCreateAccount();
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

  it('heads a co-owner invite "Join {team} in {league}" over the league card, with no sentences, steps or way back', async () => {
    fetchTeamOwnerInvitationPreviewMock.mockResolvedValue({
      inviteCode: 'TEAMCODE1',
      status: 'PENDING',
      league: { id: '7c0c4b1e-0000-4000-8000-000000000001', leagueCode: 'BIGDAWGS', name: 'Big Dawgs' },
      team: { id: '7c0c4b1e-0000-4000-8000-000000000002', name: 'Beer Bellies', iconKey: 'CAPTAIN_SMILE_FIELD' },
      roleAfterAccept: 'MEMBER',
    });

    renderAuthHomePage({ pathname: '/', state: { from: '/team-invite/TEAMCODE1' } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Join Beer Bellies in Big Dawgs' })).toBeVisible();
    const card = screen.getByTestId('invitation-context-card');
    expect(card).toHaveTextContent('Co-owner invite');
    expect(card).toHaveTextContent('Big Dawgs');
    expect(within(card).queryByRole('paragraph')).not.toBeInTheDocument();
    expect(screen.queryByText(/almost inside|as a co-owner|After you/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to invitation' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-steps')).not.toBeInTheDocument();
    expect(fetchTeamOwnerInvitationPreviewMock).toHaveBeenCalledWith('TEAMCODE1');
  });

  it('warns and shows the invitation warning when a co-owner invitation preview fails to load', async () => {
    fetchTeamOwnerInvitationPreviewMock.mockRejectedValue(new Error('Preview unavailable'));

    renderAuthHomePage({ pathname: '/', state: { from: '/team-invite/TEAMCODE1' } });

    expect(await screen.findByTestId('auth-invite-preview-error')).toBeVisible();
    expect(within(screen.getByTestId('auth-invite-preview-error')).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.teamInvitePreview.failed',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- expect.objectContaining(...) is Vitest's asymmetric-matcher sentinel, typed any by design.
        data: expect.objectContaining({ inviteCode: 'TEAMCODE1' }),
      }),
      expect.any(String),
    );
  });

  it('heads a league invite "Join {league}" over the league card, with no sentences, steps or way back', async () => {
    fetchInvitationPreviewMock.mockResolvedValue({
      inviteCode: 'LEAGUE123',
      status: 'PENDING',
      league: { id: '7c0c4b1e-0000-4000-8000-000000000001', leagueCode: 'BIGDAWGS', name: 'Big Dawgs' },
    });

    renderAuthHomePage({ pathname: '/', state: { from: '/invite/LEAGUE123' } });

    expect(await screen.findByRole('heading', { level: 1, name: 'Join Big Dawgs' })).toBeVisible();
    const card = screen.getByTestId('invitation-context-card');
    expect(card).toHaveTextContent('League invite');
    expect(card).toHaveTextContent('Invite code LEAGUE123');
    expect(within(card).queryByRole('paragraph')).not.toBeInTheDocument();
    expect(screen.queryByText(/almost inside|come back to this invitation|After you/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to invitation' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('auth-steps')).not.toBeInTheDocument();
  });

  it('heads a plain visit "Make every game day count." over the three How to Play step titles and the How to play and Plans links', () => {
    renderAuthHomePage();

    expect(screen.getByRole('heading', { level: 1, name: 'Make every game day count.' })).toBeVisible();
    const steps = within(screen.getByTestId('auth-steps')).getAllByRole('listitem');
    expect(steps.map((step) => within(step).getByRole('heading').textContent)).toEqual([
      'Start a league',
      'Run contests on real events',
      'Follow it live',
    ]);
    // Titles only: How to Play's step sentences stay on How to Play.
    expect(screen.queryByText(/invites everyone with one link/)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'How to play' })).toHaveAttribute('href', '/how-to-play');
    expect(screen.getByRole('link', { name: 'Plans' })).toHaveAttribute('href', '/plans');
  });

  it('shows no tagline, explainers, feature notes, post-form line or Continue to welcome link', () => {
    renderAuthHomePage();

    expect(screen.queryByText('The ultimate game-day contest manager.')).not.toBeInTheDocument();
    expect(screen.queryByText(/gives commissioners one place/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Commissioners create a league/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Members join by invitation/)).not.toBeInTheDocument();
    expect(screen.queryByText(/After you create your account/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Continue to welcome' })).not.toBeInTheDocument();
  });

  it('switches between Sign in and Create account as tabs, opening on Sign in', () => {
    renderAuthHomePage();

    expect(screen.getByRole('tablist', { name: 'Sign in or create account' })).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Sign in' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('auth-login-submit')).toHaveTextContent('Sign in');

    openCreateAccount();

    expect(screen.getByRole('tab', { name: 'Create account' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('sign-up-form')).toBeVisible();
    expect(screen.queryByTestId('auth-login-submit')).not.toBeInTheDocument();
  });

  it('gives the sign-in fields no sample text, only their labels', () => {
    renderAuthHomePage();

    expect(screen.getByTestId('auth-login-identifier')).not.toHaveAttribute('placeholder');
    expect(screen.getByLabelText('Username or email')).toBe(screen.getByTestId('auth-login-identifier'));
  });
});
