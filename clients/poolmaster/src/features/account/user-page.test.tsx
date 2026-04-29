import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/auth-provider';
import { useSessionStore } from '@/features/auth/session-store';
import { UserPage } from './user-page';

const {
  changeAccountPasswordMock,
  adminDeleteUserMock,
  adminDisableUserMock,
  adminEnableUserMock,
  adminGetUserDetailMock,
  adminResetUserPasswordMock,
  adminSetUserRootAdminMock,
  inactivateAccountMock,
  deleteAccountMock,
  getCurrentUserMock,
  logoutUserMock,
  reactivateAccountMock,
  refreshTokenMock,
  updateAccountPreferencesMock,
  updateAccountProfileMock,
  updateAccountUsernameMock,
  mockLogger,
} = vi.hoisted(() => {
  const mockLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  };
  mockLogger.child.mockReturnValue(mockLogger);

  return {
    adminDeleteUserMock: vi.fn(),
    adminDisableUserMock: vi.fn(),
    adminEnableUserMock: vi.fn(),
    adminGetUserDetailMock: vi.fn(),
    adminResetUserPasswordMock: vi.fn(),
    adminSetUserRootAdminMock: vi.fn(),
    changeAccountPasswordMock: vi.fn(),
    inactivateAccountMock: vi.fn(),
    deleteAccountMock: vi.fn(),
    getCurrentUserMock: vi.fn(),
    logoutUserMock: vi.fn(),
    reactivateAccountMock: vi.fn(),
    refreshTokenMock: vi.fn(),
    updateAccountPreferencesMock: vi.fn(),
    updateAccountProfileMock: vi.fn(),
    updateAccountUsernameMock: vi.fn(),
    mockLogger,
  };
});

vi.mock('@/lib/api', () => ({
  adminDeleteUser: (...args: unknown[]) => adminDeleteUserMock(...args),
  adminDisableUser: (...args: unknown[]) => adminDisableUserMock(...args),
  adminEnableUser: (...args: unknown[]) => adminEnableUserMock(...args),
  adminGetUserDetail: (...args: unknown[]) => adminGetUserDetailMock(...args),
  adminResetUserPassword: (...args: unknown[]) => adminResetUserPasswordMock(...args),
  adminSetUserRootAdmin: (...args: unknown[]) => adminSetUserRootAdminMock(...args),
  changeAccountPassword: (...args: unknown[]) => changeAccountPasswordMock(...args),
  inactivateAccount: (...args: unknown[]) => inactivateAccountMock(...args),
  deleteAccount: (...args: unknown[]) => deleteAccountMock(...args),
  getCurrentUser: (...args: unknown[]) => getCurrentUserMock(...args),
  logoutUser: (...args: unknown[]) => logoutUserMock(...args),
  reactivateAccount: (...args: unknown[]) => reactivateAccountMock(...args),
  refreshToken: (...args: unknown[]) => refreshTokenMock(...args),
  updateAccountPreferences: (...args: unknown[]) => updateAccountPreferencesMock(...args),
  updateAccountProfile: (...args: unknown[]) => updateAccountProfileMock(...args),
  updateAccountUsername: (...args: unknown[]) => updateAccountUsernameMock(...args),
}));

vi.mock('@/lib/logger', () => ({
  logger: mockLogger,
  useLogger: () => mockLogger,
}));

function renderUserPage(initialEntry = '/users/user-1') {
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route element={<UserPage />} path="/users/:userId" />
            <Route element={<div data-testid="root-route" />} path="/" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

function primeCurrentUser({
  id = 'user-1',
  isActive = true,
  isRootAdmin = false,
}: {
  id?: string;
  isActive?: boolean;
  isRootAdmin?: boolean;
} = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: {
        id,
        email: 'derek@example.com',
        username: 'ddorazio',
        firstName: 'Derek',
        lastName: 'Dorazio',
        isActive,
        isRootAdmin,
        timezone: 'America/New_York',
        locale: 'en-US',
        timeFormat: '12H',
        dateFormat: 'MDY',
        createdAt: '2026-04-13T00:00:00.000Z',
      },
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
}

function primeAdminUserDetail({
  id = 'user-2',
  isActive = true,
  isRootAdmin = false,
}: {
  id?: string;
  isActive?: boolean;
  isRootAdmin?: boolean;
} = {}) {
  adminGetUserDetailMock.mockResolvedValue({
    data: {
      id,
      email: 'target@example.com',
      username: 'target-user',
      firstName: 'Target',
      lastName: 'User',
      isActive,
      isRootAdmin,
      authProvider: 'EMAIL',
      timezone: 'America/New_York',
      locale: 'en-US',
      timeFormat: '12H',
      dateFormat: 'MDY',
      createdAt: '2026-04-13T00:00:00.000Z',
      viewerAuthority: {
        self: false,
        rootAdmin: true,
        viewer: false,
      },
    },
  });
}

describe('UserPage', () => {
  afterEach(() => {
    adminDeleteUserMock.mockReset();
    adminDisableUserMock.mockReset();
    adminEnableUserMock.mockReset();
    adminGetUserDetailMock.mockReset();
    adminResetUserPasswordMock.mockReset();
    adminSetUserRootAdminMock.mockReset();
    changeAccountPasswordMock.mockReset();
    inactivateAccountMock.mockReset();
    deleteAccountMock.mockReset();
    getCurrentUserMock.mockReset();
    logoutUserMock.mockReset();
    reactivateAccountMock.mockReset();
    refreshTokenMock.mockReset();
    updateAccountPreferencesMock.mockReset();
    updateAccountProfileMock.mockReset();
    updateAccountUsernameMock.mockReset();
    mockLogger.debug.mockReset();
    mockLogger.info.mockReset();
    mockLogger.warn.mockReset();
    mockLogger.error.mockReset();
    mockLogger.fatal.mockReset();
    mockLogger.child.mockClear();
    useSessionStore.getState().clearSession();
  });

  it('pool-master-mj2 shows user-focused My Profile copy without the implementation eyebrow', async () => {
    primeCurrentUser();

    renderUserPage();

    await screen.findByTestId('user-page');
    expect(screen.queryByText(/^User$/)).not.toBeInTheDocument();
    expect(
      screen.getByText('Manage your user profile, preferences, login, and account information.'),
    ).toBeVisible();
  });

  it('pool-master-aph keeps identity fields in a dedicated profile summary tile', async () => {
    primeCurrentUser();

    renderUserPage();

    const identitySummary = await screen.findByTestId('user-page-identity-summary');
    expect(within(identitySummary).getByText('Name')).toBeVisible();
    expect(within(identitySummary).getByText('Derek Dorazio')).toBeVisible();
    expect(within(identitySummary).getByText('Email')).toBeVisible();
    expect(within(identitySummary).getByText('derek@example.com')).toBeVisible();
    expect(within(identitySummary).getByText('Username')).toBeVisible();
    expect(within(identitySummary).getByText('ddorazio')).toBeVisible();

    const accountDetails = screen.getByTestId('user-page-account-details');
    expect(within(accountDetails).getByText('Member since')).toBeVisible();
    expect(within(accountDetails).getByText('Status')).toBeVisible();
    expect(within(accountDetails).getByText('Role')).toBeVisible();
    expect(within(accountDetails).getByText('Method')).toBeVisible();
    expect(within(accountDetails).queryByText('Auth provider')).not.toBeInTheDocument();
  });

  it('pool-master-l40 updates the self profile email from the canonical user page dialog', async () => {
    primeCurrentUser();
    updateAccountProfileMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'updated@example.com',
          username: 'ddorazio',
          firstName: 'Updated',
          lastName: 'Person',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-profile'));
    await screen.findByTestId('user-page-profile-dialog');

    fireEvent.change(screen.getByTestId('user-page-first-name'), {
      target: { value: 'Updated' },
    });
    fireEvent.change(screen.getByTestId('user-page-last-name'), {
      target: { value: 'Person' },
    });
    fireEvent.change(screen.getByTestId('user-page-email'), {
      target: { value: ' Updated@Example.com ' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-profile'));

    await waitFor(() =>
      expect(updateAccountProfileMock).toHaveBeenCalledWith({
        body: {
          email: 'updated@example.com',
          firstName: 'Updated',
          lastName: 'Person',
        },
      }),
    );
    await waitFor(() => expect(screen.getByText('Your profile was updated.')).toBeVisible());
  });

  it('pool-master-l40 changes the self username when the value is available', async () => {
    primeCurrentUser();
    updateAccountUsernameMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'derekd',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-username'));
    await screen.findByTestId('user-page-username-dialog');
    fireEvent.change(screen.getByTestId('user-page-username'), {
      target: { value: ' DerekD ' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-username'));

    await waitFor(() =>
      expect(updateAccountUsernameMock).toHaveBeenCalledWith({
        body: {
          username: 'derekd',
        },
      }),
    );
    expect(await screen.findByText('Your username was updated.')).toBeVisible();
  });

  it('pool-master-l40 tells the user when a requested username is already taken', async () => {
    primeCurrentUser();
    updateAccountUsernameMock.mockResolvedValue({
      data: null,
      error: {
        error: {
          code: 'ACCOUNT_USERNAME_TAKEN',
          message: 'That username is already taken. Choose another username.',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-username'));
    await screen.findByTestId('user-page-username-dialog');
    fireEvent.change(screen.getByTestId('user-page-username'), {
      target: { value: 'taken' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-username'));

    expect(
      await screen.findByText('That username is already taken. Choose another username.'),
    ).toBeVisible();
  });

  it('keeps delete locked until the account is inactive', async () => {
    primeCurrentUser({ isActive: true });

    renderUserPage();

    await screen.findByTestId('user-page');
    expect(screen.getByTestId('user-page-open-delete')).toBeDisabled();
  });

  it('reactivates an inactive account from the lifecycle dialog', async () => {
    primeCurrentUser({ isActive: false });
    reactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'ddorazio',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-reactivate'));

    await waitFor(() => expect(reactivateAccountMock).toHaveBeenCalledTimes(1));
  });

  it('shows a truthful placeholder for non-self user routes', async () => {
    primeCurrentUser({ id: 'user-1' });

    renderUserPage('/users/user-2');

    expect(await screen.findByTestId('user-page-non-self-placeholder')).toBeVisible();
    expect(screen.getByTestId('user-page-self-link')).toHaveAttribute('href', '/users/user-1');
  });

  it('shows root-admin account controls for a non-self user route', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });

    renderUserPage('/users/user-2');

    expect(await screen.findByTestId('root-admin-user-page')).toBeVisible();
    expect(adminGetUserDetailMock).toHaveBeenCalledWith({
      path: {
        userId: 'user-2',
      },
    });
    expect(screen.getByTestId('root-admin-user-open-role')).toBeVisible();
    expect(screen.getByTestId('root-admin-user-open-reset-password')).toBeVisible();
    expect(screen.getByTestId('root-admin-user-open-lifecycle')).toBeVisible();
    expect(screen.getByTestId('root-admin-user-open-delete')).toBeDisabled();
  });

  it('submits a root-admin role change from the non-self user page', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });
    adminSetUserRootAdminMock.mockResolvedValue({
      data: { success: true },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-role'));
    await screen.findByTestId('root-admin-user-role-dialog');
    fireEvent.change(screen.getByTestId('root-admin-user-role-reason'), {
      target: { value: 'Coverage promotion' },
    });
    fireEvent.click(screen.getByTestId('root-admin-user-submit-role'));

    await waitFor(() =>
      expect(adminSetUserRootAdminMock).toHaveBeenCalledWith({
        path: {
          userId: 'user-2',
        },
        body: {
          isRootAdmin: true,
          reason: 'Coverage promotion',
        },
      }),
    );
  });

  it('generates a temporary password for the viewed user from the root-admin page', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });
    adminResetUserPasswordMock.mockResolvedValue({
      data: {
        temporaryPassword: 'Pm-temp-password!9a',
      },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-reset-password'));
    await screen.findByTestId('root-admin-user-reset-password-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-reset-password'));

    expect(await screen.findByTestId('root-admin-user-temp-password')).toHaveTextContent(
      'Pm-temp-password!9a',
    );
  });

  it('pool-master-6nl shows linked team and league names when root-admin account delete is blocked by ownership', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: false });
    adminDeleteUserMock.mockResolvedValue({
      data: null,
      error: {
        error: {
          code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
          message: 'Account still owns or belongs to league-scoped data: user-2',
          details: {
            dependencyType: 'TEAM_OWNER',
            team: {
              id: 'team-1',
              name: 'Birdie Hunters',
            },
            league: {
              id: 'league-1',
              name: 'Masters League',
              leagueCode: 'MASTERS',
            },
          },
        },
      },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-delete'));
    fireEvent.change(screen.getByTestId('root-admin-user-delete-confirmation'), {
      target: { value: 'target@example.com' },
    });
    fireEvent.click(screen.getByTestId('root-admin-user-submit-delete'));

    expect(
      await screen.findByText(
        "Account cannot be deleted because it's still an owner of team",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Birdie Hunters' })).toHaveAttribute(
      'href',
      '/league/MASTERS/teams/team-1',
    );
    expect(screen.getByRole('link', { name: 'Masters League-MASTERS' })).toHaveAttribute(
      'href',
      '/league/MASTERS',
    );
  });
});
