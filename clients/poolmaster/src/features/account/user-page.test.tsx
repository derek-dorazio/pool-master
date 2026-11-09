import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindApiMocks } from '@/test/msw-api';
import {
  AUTH_ME_QUERY_KEY,
  type AuthSessionUser,
} from '@/features/auth/auth-session-cache';
import { AuthProvider } from '@/features/auth/auth-provider';
import { DEFAULT_DISPLAY_PREFERENCES } from '@/features/shared/ui';
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
  getUserEmailPreferencesMock,
  getUserMock,
  listUserPaymentsMock,
  logoutUserMock,
  refreshTokenMock,
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
    getUserEmailPreferencesMock: vi.fn(),
    getUserMock: vi.fn(),
    listUserPaymentsMock: vi.fn(),
    logoutUserMock: vi.fn(),
    refreshTokenMock: vi.fn(),
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
  getUserEmailPreferences: getUserEmailPreferencesMock,
  listUserPayments: listUserPaymentsMock,
  logoutUser: logoutUserMock,
  refreshToken: refreshTokenMock,
  updateUserPreferences: updateUserPreferencesMock,
  updateUserProfile: updateUserProfileMock,
  updateUserUsername: updateUserUsernameMock,
});

vi.mock('@/lib/logger', () => ({
  getOrCreateClientTraceId: () => 'test-trace-id',
  logger: mockLogger,
  getLogger: () => mockLogger,
}));

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

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
            <Route element={<LocationProbe />} path="/manage/users/:userId" />
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
  listUserPaymentsMock.mockResolvedValue({ data: { payments: [] } });
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

describe('UserPage', () => {
  afterEach(() => {
    changeUserPasswordMock.mockReset();
    deleteUserMock.mockReset();
    disableUserMock.mockReset();
    enableUserMock.mockReset();
    getUserMock.mockReset();
    getUserEmailPreferencesMock.mockReset();
    listUserPaymentsMock.mockReset();
    primedUsersByPath.clear();
    logoutUserMock.mockReset();
    refreshTokenMock.mockReset();
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

  it('lists the payments you made in your leagues, each naming its league and linking to it', async () => {
    primeCurrentUser();
    listUserPaymentsMock.mockResolvedValue({
      data: {
        payments: [{
          id: '0f6e3c1a-2222-4b4b-9c9c-000000000001',
          paidAt: '2026-10-24T15:00:00.000Z',
          amountCents: 0,
          description: 'Masters Pool: up to 50 entries, free while payments are off',
          league: { id: 'league-1', name: 'Big Dawgs', leagueCode: 'BIGDAWGS' },
        }],
      },
    });

    renderUserPage();

    const line = await screen.findByTestId('my-payment-0f6e3c1a-2222-4b4b-9c9c-000000000001');
    expect(line).toHaveTextContent('Big Dawgs');
    expect(line).toHaveTextContent('$0');
    expect(within(line).getByRole('link', { name: 'Masters Pool: up to 50 entries, free while payments are off' }))
      .toHaveAttribute('href', '/league/BIGDAWGS');
    expect(listUserPaymentsMock).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'me' } }));
  });

  it('says you have no payments yet when you have made none', async () => {
    primeCurrentUser();

    renderUserPage();

    expect(await screen.findByTestId('my-payments-empty')).toHaveTextContent('No payments yet.');
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

  it('saves the time zone picked from the list and the clock, and updates the signed-in session', async () => {
    primeCurrentUserThenRefetches(buildCurrentUser({
      timezone: 'America/Chicago',
      timeFormat: '24H',
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
    fireEvent.click(screen.getByTestId('user-page-save-preferences'));

    await waitFor(() =>
      expect(updateUserPreferencesMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
        body: {
          timezone: 'America/Chicago',
          locale: 'en-US',
          timeFormat: '24H',
        },
      }),
    );
    expect(await screen.findByText('Your preferences were updated.')).toBeVisible();
    await waitFor(() =>
      expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({
        timezone: 'America/Chicago',
        timeFormat: '24H',
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

  it('sends a root admin who opens another user\'s page to that user in Manage', async () => {
    primeCurrentUser({ id: 'admin-1', isRootAdmin: true });

    renderUserPage('/users/user-2');

    expect(await screen.findByTestId('location')).toHaveTextContent('/manage/users/user-2');
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

  it('signs out and returns to the home page when a deleted user picks Exit and sign out', async () => {
    primeCurrentUser({ isActive: false });
    deleteUserMock.mockResolvedValue({ data: { success: true } });
    logoutUserMock.mockResolvedValue({ data: { success: true } });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-delete'));
    await screen.findByTestId('user-page-delete-dialog');
    fireEvent.change(screen.getByTestId('user-page-delete-confirmation'), { target: { value: 'derek@example.com' } });
    fireEvent.click(screen.getByTestId('user-page-delete-submit'));
    const success = await screen.findByTestId('user-page-delete-success');
    fireEvent.click(within(success).getByRole('button', { name: 'Exit and sign out' }));

    expect(await screen.findByTestId('root-route')).toBeInTheDocument();
    expect(logoutUserMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['user-page-open-profile', 'user-page-profile-dialog'],
    ['user-page-open-username', 'user-page-username-dialog'],
    ['user-page-open-preferences', 'user-page-preferences-dialog'],
  ])('closes the dialog opened by %s without saving when Cancel is clicked', async (openTestId, dialogTestId) => {
    primeCurrentUser();

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId(openTestId));
    const dialog = await screen.findByTestId(dialogTestId);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId(dialogTestId)).not.toBeInTheDocument());
    expect(updateUserProfileMock).not.toHaveBeenCalled();
    expect(updateUserUsernameMock).not.toHaveBeenCalled();
    expect(updateUserPreferencesMock).not.toHaveBeenCalled();
  });

  it.each([
    ['user-page-open-profile', 'user-page-profile-dialog'],
    ['user-page-open-username', 'user-page-username-dialog'],
    ['user-page-open-preferences', 'user-page-preferences-dialog'],
    ['user-page-open-password', 'user-page-password-dialog'],
    ['user-page-open-lifecycle', 'user-page-lifecycle-dialog'],
  ])('closes the dialog opened by %s when Escape is pressed', async (openTestId, dialogTestId) => {
    primeCurrentUser();

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId(openTestId));
    const dialog = await screen.findByTestId(dialogTestId);
    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByTestId(dialogTestId)).not.toBeInTheDocument());
  });

  it('opens the email notifications dialog from its tile and closes it again', async () => {
    primeCurrentUser();
    getUserEmailPreferencesMock.mockResolvedValue({
      data: { preferences: [{ category: 'RESULTS', enabled: true }], emailSuppression: null },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-email-notifications'));
    const dialog = await screen.findByTestId('email-notifications-dialog');
    expect(await within(dialog).findByLabelText(/^Results/)).toBeChecked();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close Email notifications' }));

    await waitFor(() => expect(screen.queryByTestId('email-notifications-dialog')).not.toBeInTheDocument());
  });

  it('keeps the profile dialog open with the server reason when saving the profile fails', async () => {
    primeCurrentUser();
    updateUserProfileMock.mockResolvedValue({
      error: { error: { code: 'ACCOUNT_EMAIL_TAKEN', message: 'That email is already in use.' } },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-profile'));
    const dialog = await screen.findByTestId('user-page-profile-dialog');
    fireEvent.change(screen.getByTestId('user-page-email'), { target: { value: 'taken@example.com' } });
    fireEvent.click(screen.getByTestId('user-page-save-profile'));

    expect(await within(dialog).findByText('That email is already in use.')).toBeVisible();
    expect(screen.queryByText('Your profile was updated.')).not.toBeInTheDocument();
  });

  it('keeps the preferences dialog open with the server reason when saving preferences fails', async () => {
    primeCurrentUser();
    updateUserPreferencesMock.mockResolvedValue({
      error: { error: { code: 'VALIDATION_ERROR', message: 'That locale is not supported.' } },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-preferences'));
    const dialog = await screen.findByTestId('user-page-preferences-dialog');
    fireEvent.click(screen.getByTestId('user-page-save-preferences'));

    expect(await within(dialog).findByText('That locale is not supported.')).toBeVisible();
    expect(screen.queryByText('Your preferences were updated.')).not.toBeInTheDocument();
  });

  it('sends no locale or clock when the user clears the locale and picks the system default clock', async () => {
    primeCurrentUser();
    updateUserPreferencesMock.mockResolvedValue({
      data: { user: buildCurrentUser({ locale: undefined, timeFormat: undefined }) },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-preferences'));
    await screen.findByTestId('user-page-preferences-dialog');
    fireEvent.change(screen.getByTestId('user-page-locale'), { target: { value: '   ' } });
    fireEvent.change(screen.getByTestId('user-page-time-format'), { target: { value: '' } });
    expect(screen.getByTestId('user-page-locale')).toHaveValue('');
    fireEvent.click(screen.getByTestId('user-page-save-preferences'));

    await waitFor(() =>
      expect(updateUserPreferencesMock).toHaveBeenCalledWith({
        path: { userId: 'me' },
        body: { timezone: 'America/New_York', locale: undefined, timeFormat: undefined },
      }),
    );
  });

  it('opens the preferences dialog on the default time zone when the user has none saved', async () => {
    primeCurrentUser({ timezone: undefined, locale: undefined, timeFormat: undefined });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-preferences'));
    await screen.findByTestId('user-page-preferences-dialog');

    expect(screen.getByTestId('user-page-timezone')).toHaveValue(DEFAULT_DISPLAY_PREFERENCES.timeZone);
    expect(screen.getByTestId('user-page-locale')).toHaveValue('');
    expect(screen.getByTestId('user-page-time-format')).toHaveValue('');
  });

  it('shows the server reason and keeps the account active when inactivating fails', async () => {
    primeCurrentUser();
    disableUserMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The account could not be inactivated.' } },
    });

    renderUserPage();

    await screen.findByTestId('user-page');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-inactivate'));

    expect(await screen.findByText('The account could not be inactivated.')).toBeVisible();
    expect(screen.queryByTestId('user-page-inactive-banner')).not.toBeInTheDocument();
  });

  it('shows the server reason and keeps the account inactive when reactivating fails', async () => {
    primeCurrentUser({ isActive: false });
    enableUserMock.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The account could not be reactivated.' } },
    });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-lifecycle'));
    await screen.findByTestId('user-page-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('user-page-reactivate'));

    expect(await screen.findByText('The account could not be reactivated.')).toBeVisible();
    expect(screen.getByTestId('user-page-inactive-banner')).toBeVisible();
  });

  it('labels a root admin\'s role as Root admin in the account details', async () => {
    primeCurrentUser({ isRootAdmin: true });

    renderUserPage('/users/user-1');

    const accountDetails = await screen.findByTestId('user-page-account-details');
    expect(within(accountDetails).getByText('Root admin')).toBeVisible();
  });

  it.each([
    ['Cancel', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
  ])('closes the delete dialog on %s and starts over with an empty confirmation next time', async (_how, close) => {
    primeCurrentUser({ isActive: false });

    renderUserPage();

    await screen.findByTestId('user-page-inactive-banner');
    fireEvent.click(screen.getByTestId('user-page-open-delete'));
    const dialog = await screen.findByTestId('user-page-delete-dialog');
    fireEvent.change(screen.getByTestId('user-page-delete-confirmation'), { target: { value: 'derek@' } });
    close(dialog);
    await waitFor(() => expect(screen.queryByTestId('user-page-delete-dialog')).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId('user-page-open-delete'));
    await screen.findByTestId('user-page-delete-dialog');
    expect(screen.getByTestId('user-page-delete-confirmation')).toHaveValue('');
    expect(deleteUserMock).not.toHaveBeenCalled();
  });
});
