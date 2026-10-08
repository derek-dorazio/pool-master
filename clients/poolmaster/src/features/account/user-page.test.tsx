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

/**
 * #202 — one mock per operation.
 *
 * This file used to hold two mocks for each of disable, enable, delete and read-user: an
 * `admin*` one and an `*Account` one, bound to the same generated client function so the second
 * binding silently won. There is one operation now, reached by `me` or by a user id, so there is
 * one mock.
 */
const {
  changeUserPasswordMock,
  deleteUserMock,
  disableUserMock,
  enableUserMock,
  getUserMock,
  logoutUserMock,
  refreshTokenMock,
  resetUserPasswordMock,
  setUserRootAdminMock,
  updateUserPreferencesMock,
  updateUserProfileMock,
  updateUserUsernameMock,
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
    changeUserPasswordMock: vi.fn(),
    deleteUserMock: vi.fn(),
    disableUserMock: vi.fn(),
    enableUserMock: vi.fn(),
    getUserMock: vi.fn(),
    logoutUserMock: vi.fn(),
    refreshTokenMock: vi.fn(),
    resetUserPasswordMock: vi.fn(),
    setUserRootAdminMock: vi.fn(),
    updateUserPreferencesMock: vi.fn(),
    updateUserProfileMock: vi.fn(),
    updateUserUsernameMock: vi.fn(),
    mockLogger,
  };
});

bindApiMocks({
  changeUserPassword: changeUserPasswordMock,
  deleteUser: deleteUserMock,
  disableUser: disableUserMock,
  enableUser: enableUserMock,
  getUser: getUserMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  resetUserPassword: resetUserPasswordMock,
  setUserRootAdmin: setUserRootAdminMock,
  updateUserPreferences: updateUserPreferencesMock,
  updateUserProfile: updateUserProfileMock,
  updateUserUsername: updateUserUsernameMock,
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
    ...overrides,
  };
}

/**
 * #202 — the reads this page makes are one operation.
 *
 * The signed-in user and another user are both `getUser`, reached as `me` or by a user id, so a
 * test that primes both answers by path. It used to prime two mocks bound to the same generated
 * function, where whichever was stubbed last won.
 */
const primedUsersByPath = new Map<string, AuthSessionUser>();

function primeUserRead(pathUserId: string, user: AuthSessionUser) {
  primedUsersByPath.set(pathUserId, user);
  getUserMock.mockImplementation(({ path }: { path: { userId: string } }) => {
    const primed = primedUsersByPath.get(path.userId);
    if (!primed) {
      return Promise.resolve({ error: { code: 'USER_NOT_FOUND', message: 'User was not found.' } });
    }

    return Promise.resolve({ data: { user: primed } });
  });
}

function primeCurrentUser(overrides: Partial<AuthSessionUser> = {}) {
  primeUserRead('me', buildCurrentUser(overrides));
  refreshTokenMock.mockResolvedValue({ data: null });
}

function primeCurrentUserThenRefetches(updatedUser: AuthSessionUser) {
  getUserMock
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
  primeUserRead(id, {
    id,
    email: 'target@example.com',
    username: 'target-user',
    firstName: 'Target',
    lastName: 'User',
    isActive,
    isRootAdmin,
    authProvider: 'email',
    timezone: 'America/New_York',
    locale: 'en-US',
    timeFormat: '12H',
    dateFormat: 'MDY',
    createdAt: '2026-04-13T00:00:00.000Z',
  });
}

describe('UserPage', () => {
  afterEach(() => {
    changeUserPasswordMock.mockReset();
    deleteUserMock.mockReset();
    disableUserMock.mockReset();
    enableUserMock.mockReset();
    getUserMock.mockReset();
    primedUsersByPath.clear();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
    resetUserPasswordMock.mockReset();
    setUserRootAdminMock.mockReset();
    updateUserPreferencesMock.mockReset();
    updateUserProfileMock.mockReset();
    updateUserUsernameMock.mockReset();
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
    updateUserProfileMock.mockResolvedValue({
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
      expect(updateUserProfileMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
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
      }),
    );
  });

  it('pool-master-7wj.6 shows profile validation before submitting invalid email changes', async () => {
    primeCurrentUser();

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-profile'));
    await screen.findByTestId('user-page-profile-dialog');

    fireEvent.change(screen.getByTestId('user-page-email'), {
      target: { value: 'not-an-email' },
    });
    fireEvent.click(screen.getByTestId('user-page-save-profile'));

    expect(await screen.findByText(/invalid email/i)).toBeVisible();
    expect(updateUserProfileMock).not.toHaveBeenCalled();
  });

  it('pool-master-rop.78.11 changes the self username in the auth query cache', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({ username: 'derekd' }));
    updateUserUsernameMock.mockResolvedValue({
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
      expect(updateUserUsernameMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
        body: {
          username: 'derekd',
        },
      }),
    );
    expect(await screen.findByText('Your username was updated.')).toBeVisible();
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        username: 'derekd',
      }),
    );
  });

  it('pool-master-rop.78.11 updates preferences in the auth query cache', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({
      timezone: 'America/Chicago',
      timeFormat: '24H',
      dateFormat: 'YMD',
    }));
    updateUserPreferencesMock.mockResolvedValue({
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
      expect(updateUserPreferencesMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
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
      }),
    );
  });

  it('pool-master-l40 tells the user when a requested username is already taken', async () => {
    primeCurrentUser();
    updateUserUsernameMock.mockResolvedValue({
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
    disableUserMock.mockResolvedValue({
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

    await waitFor(() => expect(disableUserMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        isActive: false,
      }),
    );
  });

  it('tells an inactive user they stay signed in to reactivate or delete, never that sign-in is blocked', async () => {
    getUserMock.mockResolvedValue({
      data: {
        user: buildCurrentUser({ isActive: false }),
      },
    });

    renderUserPage();

    const banner = await screen.findByTestId('user-page-inactive-banner');
    expect(banner).not.toHaveTextContent(/cannot sign in/i);
    expect(banner).toHaveTextContent(/reactivate/i);
  });

  it('pool-master-rop.78.11 reactivates an inactive account in the auth query cache', async () => {
    getUserMock
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
    enableUserMock.mockResolvedValue({
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

    await waitFor(() => expect(enableUserMock).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        isActive: true,
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
    expect(getUserMock).toHaveBeenCalledWith({
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
    setUserRootAdminMock.mockResolvedValue({
      data: { success: true },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-role'));
    await screen.findByTestId('root-admin-user-role-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-role'));

    await waitFor(() =>
      expect(setUserRootAdminMock).toHaveBeenCalledWith({
        path: {
          userId: 'user-2',
        },
        body: {
          isRootAdmin: true,
        },
      }),
    );
  });

  it('generates a temporary password for the viewed user from the root-admin page', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });
    resetUserPasswordMock.mockResolvedValue({
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

  it('keeps the lifecycle dialog open and shows the server refusal when a root admin cannot inactivate the account', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: true, isActive: true });
    disableUserMock.mockResolvedValue({
      error: {
        error: {
          code: 'ACCOUNT_LAST_ROOT_ADMIN',
          message: 'This is the only root admin. Promote another root admin before deactivating the account.',
        },
      },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-lifecycle'));
    const dialog = await screen.findByTestId('root-admin-user-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-lifecycle'));

    expect(await within(dialog).findByText(/only root admin/i)).toBeVisible();
    expect(screen.getByTestId('root-admin-user-lifecycle-dialog')).toBeVisible();
  });

  it('deletes with the account email when the root admin types it in another case or with spaces', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: false });
    deleteUserMock.mockResolvedValue({ data: { success: true } });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-delete'));
    await screen.findByTestId('root-admin-user-delete-dialog');
    fireEvent.change(screen.getByTestId('root-admin-user-delete-confirmation'), {
      target: { value: ' Target@Example.com ' },
    });
    fireEvent.click(screen.getByTestId('root-admin-user-submit-delete'));

    await waitFor(() =>
      expect(deleteUserMock).toHaveBeenCalledWith({
        path: { userId: 'user-2' },
        body: { email: 'target@example.com' },
      }),
    );
  });

  it('sends the password change with the three fields the user typed', async () => {
    primeCurrentUser();
    changeUserPasswordMock.mockResolvedValue({ data: { success: true } });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-password'));
    await screen.findByTestId('user-page-password-dialog');
    fireEvent.change(screen.getByTestId('user-page-current-password'), { target: { value: 'OldPassword1' } });
    fireEvent.change(screen.getByTestId('user-page-new-password'), { target: { value: 'NewPassword1' } });
    fireEvent.change(screen.getByTestId('user-page-confirm-password'), { target: { value: 'NewPassword1' } });
    fireEvent.click(screen.getByTestId('user-page-save-password'));

    await waitFor(() =>
      expect(changeUserPasswordMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
        body: { currentPassword: 'OldPassword1', newPassword: 'NewPassword1', confirmNewPassword: 'NewPassword1' },
      }),
    );
  });

  it('shows the server refusal when the current password is wrong', async () => {
    primeCurrentUser();
    changeUserPasswordMock.mockResolvedValue({
      error: { error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' } },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-password'));
    const dialog = await screen.findByTestId('user-page-password-dialog');
    fireEvent.change(screen.getByTestId('user-page-current-password'), { target: { value: 'WrongPassword1' } });
    fireEvent.change(screen.getByTestId('user-page-new-password'), { target: { value: 'NewPassword1' } });
    fireEvent.change(screen.getByTestId('user-page-confirm-password'), { target: { value: 'NewPassword1' } });
    fireEvent.click(screen.getByTestId('user-page-save-password'));

    expect(await within(dialog).findByText('Current password is incorrect.')).toBeVisible();
  });

  it('deletes an inactive account with its own email and shows the deleted confirmation', async () => {
    primeCurrentUser({ isActive: false });
    deleteUserMock.mockResolvedValue({ data: { success: true } });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-delete'));
    await screen.findByTestId('user-page-delete-dialog');
    fireEvent.change(screen.getByTestId('user-page-delete-confirmation'), { target: { value: 'derek@example.com' } });
    fireEvent.click(screen.getByTestId('user-page-delete-submit'));

    expect(await screen.findByTestId('user-page-delete-success')).toBeVisible();
    expect(deleteUserMock).toHaveBeenCalledWith({ path: { userId: 'me' }, body: { email: 'derek@example.com' } });
  });

  it('keeps the delete dialog open with the reason when league data still blocks the delete', async () => {
    primeCurrentUser({ isActive: false });
    deleteUserMock.mockResolvedValue({
      error: {
        error: {
          code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST',
          message: 'Account still owns or belongs to league-scoped data.',
        },
      },
    });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-delete'));
    const dialog = await screen.findByTestId('user-page-delete-dialog');
    fireEvent.change(screen.getByTestId('user-page-delete-confirmation'), { target: { value: 'derek@example.com' } });
    fireEvent.click(screen.getByTestId('user-page-delete-submit'));

    expect(await within(dialog).findByText(/league-scoped data/)).toBeVisible();
    expect(screen.queryByTestId('user-page-delete-success')).not.toBeInTheDocument();
  });

  it('shows an error state when a root admin opens a user who cannot be read', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });

    renderUserPage('/users/user-missing');

    expect(await screen.findByTestId('root-admin-user-page-error')).toBeVisible();
  });

  it('reactivates an inactive user from the root-admin page and closes the dialog', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isActive: false });
    enableUserMock.mockResolvedValue({ data: { user: buildCurrentUser({ id: 'user-2', isActive: true }) } });

    renderUserPage('/users/user-2');

    expect(await screen.findByTestId('root-admin-user-inactive-banner')).toBeVisible();
    fireEvent.click(screen.getByTestId('root-admin-user-open-lifecycle'));
    await screen.findByTestId('root-admin-user-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-lifecycle'));

    await waitFor(() => expect(enableUserMock).toHaveBeenCalledWith({ path: { userId: 'user-2' } }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-user-lifecycle-dialog')).not.toBeInTheDocument());
  });

  it('shows the server refusal in the role dialog when demoting the last root admin', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: true });
    setUserRootAdminMock.mockResolvedValue({
      error: { error: { code: 'LAST_ROOT_ADMIN', message: 'Cannot remove the last remaining root admin.' } },
    });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-role'));
    const dialog = await screen.findByTestId('root-admin-user-role-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-role'));

    expect(await within(dialog).findByText(/last remaining root admin/)).toBeVisible();
  });

  it('keeps the delete button disabled until the confirmation matches the viewed user\'s email', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });
    primeAdminUserDetail({ id: 'user-2', isActive: false });

    renderUserPage('/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-delete'));
    await screen.findByTestId('root-admin-user-delete-dialog');
    fireEvent.change(screen.getByTestId('root-admin-user-delete-confirmation'), { target: { value: 'someone@example.com' } });

    expect(screen.getByTestId('root-admin-user-submit-delete')).toBeDisabled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});
