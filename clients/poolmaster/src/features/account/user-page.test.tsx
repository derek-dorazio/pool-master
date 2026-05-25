import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  AUTH_ME_QUERY_KEY,
  type AuthSessionUser,
} from '@/features/auth/auth-session-cache';
import { AuthProvider } from '@/features/auth/auth-provider';
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

bindApiMocks({
  adminDeleteUser: adminDeleteUserMock,
  adminDisableUser: adminDisableUserMock,
  adminEnableUser: adminEnableUserMock,
  adminGetUserDetail: adminGetUserDetailMock,
  adminResetUserPassword: adminResetUserPasswordMock,
  adminSetUserRootAdmin: adminSetUserRootAdminMock,
  changeAccountPassword: changeAccountPasswordMock,
  inactivateAccount: inactivateAccountMock,
  deleteAccount: deleteAccountMock,
  getCurrentUser: getCurrentUserMock,
  logoutUser: logoutUserMock,
  reactivateAccount: reactivateAccountMock,
  refreshToken: refreshTokenMock,
  updateAccountPreferences: updateAccountPreferencesMock,
  updateAccountProfile: updateAccountProfileMock,
  updateAccountUsername: updateAccountUsernameMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function renderUserPage(initialEntry = '/users/user-1') {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  const utils = render(
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

  return { ...utils, queryClient };
}

function buildCurrentUser({
  id = 'user-1',
  isActive = true,
  isRootAdmin = false,
  ...overrides
}: Partial<AuthSessionUser> = {}): AuthSessionUser {
  return {
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
    sessionId: 'session-1',
    ...overrides,
  };
}

function primeCurrentUser(overrides: Partial<AuthSessionUser> = {}) {
  getCurrentUserMock.mockResolvedValue({
    data: {
      user: buildCurrentUser(overrides),
    },
  });
  refreshTokenMock.mockResolvedValue({ data: null });
}

function primeCurrentUserThenRefetches(updatedUser: AuthSessionUser) {
  getCurrentUserMock
    .mockResolvedValueOnce({
      data: {
        user: buildCurrentUser(),
      },
    })
    .mockResolvedValue({
      data: {
        user: updatedUser,
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
    const updatedUser = buildCurrentUser({
      email: 'updated@example.com',
      firstName: 'Updated',
      lastName: 'Person',
    });
    primeCurrentUserThenRefetches(updatedUser);
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

    const { queryClient } = renderUserPage();

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
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        email: 'updated@example.com',
        firstName: 'Updated',
        lastName: 'Person',
        sessionId: 'session-1',
      }),
    );
  });

  it('pool-master-rop.78.11 changes the self username in the auth query cache', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({ username: 'derekd' }));
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

    const { queryClient } = renderUserPage();

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
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        username: 'derekd',
        sessionId: 'session-1',
      }),
    );
  });

  it('pool-master-rop.78.11 updates preferences in the auth query cache', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({
      timezone: 'America/Chicago',
      timeFormat: '24H',
      dateFormat: 'YMD',
    }));
    updateAccountPreferencesMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'ddorazio',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: true,
          isRootAdmin: false,
          timezone: 'America/Chicago',
          locale: 'en-US',
          timeFormat: '24H',
          dateFormat: 'YMD',
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    const { queryClient } = renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-preferences'));
    await screen.findByTestId('user-page-preferences-dialog');
    fireEvent.change(screen.getByTestId('user-page-timezone'), {
      target: { value: 'America/Chicago' },
    });
    fireEvent.change(screen.getByTestId('user-page-time-format'), {
      target: { value: '24H' },
    });
    fireEvent.change(screen.getByTestId('user-page-date-format'), {
      target: { value: 'YMD' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-preferences'));

    await waitFor(() =>
      expect(updateAccountPreferencesMock).toHaveBeenCalledWith({
        body: {
          timezone: 'America/Chicago',
          locale: 'en-US',
          timeFormat: '24H',
          dateFormat: 'YMD',
        },
      }),
    );
    expect(await screen.findByText('Your preferences were updated.')).toBeVisible();
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        timezone: 'America/Chicago',
        timeFormat: '24H',
        dateFormat: 'YMD',
        sessionId: 'session-1',
      }),
    );
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

  it('pool-master-rop.78.11 inactivates the account in the auth query cache', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({ isActive: false }));
    inactivateAccountMock.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          email: 'derek@example.com',
          username: 'ddorazio',
          firstName: 'Derek',
          lastName: 'Dorazio',
          isActive: false,
          isRootAdmin: false,
          createdAt: '2026-04-13T00:00:00.000Z',
        },
      },
    });

    const { queryClient } = renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-inactivate'));

    await waitFor(() => expect(inactivateAccountMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        isActive: false,
        sessionId: 'session-1',
      }),
    );
  });

  it('pool-master-rop.78.11 reactivates an inactive account in the auth query cache', async () => {
    getCurrentUserMock
      .mockResolvedValueOnce({
        data: {
          user: buildCurrentUser({ isActive: false }),
        },
      })
      .mockResolvedValue({
        data: {
          user: buildCurrentUser({ isActive: true }),
        },
      });
    refreshTokenMock.mockResolvedValue({ data: null });
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

    const { queryClient } = renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-reactivate'));

    await waitFor(() => expect(reactivateAccountMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        isActive: true,
        sessionId: 'session-1',
      }),
    );
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
