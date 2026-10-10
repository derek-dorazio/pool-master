import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { UserDto } from '@/lib/api';
import { bindApiMocks } from '@/test/msw-api';
import { RootAdminManageLayout } from './root-admin-manage-layout';
import { RootAdminUserPage } from './root-admin-user-page';

const {
  deleteUserMock,
  disableUserMock,
  enableUserMock,
  getUserMock,
  resetUserPasswordMock,
  setUserRootAdminMock,
} = vi.hoisted(() => ({
  deleteUserMock: vi.fn(),
  disableUserMock: vi.fn(),
  enableUserMock: vi.fn(),
  getUserMock: vi.fn(),
  resetUserPasswordMock: vi.fn(),
  setUserRootAdminMock: vi.fn(),
}));

bindApiMocks({
  deleteUser: deleteUserMock,
  disableUser: disableUserMock,
  enableUser: enableUserMock,
  getUser: getUserMock,
  resetUserPassword: resetUserPasswordMock,
  setUserRootAdmin: setUserRootAdminMock,
});

function renderUserPage(initialEntry: string) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<RootAdminManageLayout />} path="/manage">
            <Route element={<div data-testid="users-list" />} path="users" />
            <Route element={<RootAdminUserPage />} path="users/:userId" />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildViewedUser({
  id = 'user-2',
  isActive = true,
  isRootAdmin = false,
}: {
  id?: string;
  isActive?: boolean;
  isRootAdmin?: boolean;
} = {}): UserDto {
  return {
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
  };
}

/** The user read answers for the primed user and refuses any other id. */
function primeAdminUserDetail(options: Parameters<typeof buildViewedUser>[0] = {}) {
  const user = buildViewedUser(options);
  getUserMock.mockImplementation(({ path }: { path: { userId: string } }) =>
    Promise.resolve(
      path.userId === user.id
        ? { data: { user } }
        : { error: { error: { code: 'USER_NOT_FOUND', message: 'User was not found.' } } },
    ),
  );
}

describe('RootAdminUserPage', () => {
  afterEach(() => {
    deleteUserMock.mockReset();
    disableUserMock.mockReset();
    enableUserMock.mockReset();
    getUserMock.mockReset();
    resetUserPasswordMock.mockReset();
    setUserRootAdminMock.mockReset();
  });

  it('shows the user\'s name, account rows, access actions and a danger zone with delete locked while active', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });

    renderUserPage('/manage/users/user-2');

    expect(await screen.findByTestId('root-admin-user-page')).toBeVisible();
    expect(getUserMock).toHaveBeenCalledWith({
      path: {
        userId: 'user-2',
      },
    });
    expect(screen.getByRole('heading', { name: 'Target User', level: 1 })).toBeVisible();
    expect(within(screen.getByLabelText('Manage breadcrumbs')).getByText('Target User')).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('root-admin-user-email')).toHaveTextContent('target@example.com');
    expect(screen.getByTestId('root-admin-user-role')).toHaveTextContent('Member');
    expect(screen.getByTestId('root-admin-user-open-role')).toHaveTextContent('Make root admin');
    expect(screen.getByTestId('root-admin-user-open-reset-password')).toBeVisible();
    expect(within(screen.getByTestId('root-admin-user-danger-zone')).getByTestId('root-admin-user-open-lifecycle')).toHaveTextContent('Inactivate account');
    expect(screen.getByTestId('root-admin-user-open-delete')).toBeDisabled();
  });

  it('makes a member a root admin after the role change is confirmed', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });
    setUserRootAdminMock.mockResolvedValue({
      data: { success: true },
    });

    renderUserPage('/manage/users/user-2');

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

  it('shows the generated temporary password on the page once the reset is confirmed', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: true });
    resetUserPasswordMock.mockResolvedValue({
      data: {
        temporaryPassword: 'Pm-temp-password!9a',
      },
    });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-reset-password'));
    await screen.findByTestId('root-admin-user-reset-password-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-reset-password'));

    expect(await screen.findByTestId('root-admin-user-temp-password')).toHaveTextContent(
      'Pm-temp-password!9a',
    );
    await waitFor(() => expect(screen.queryByTestId('root-admin-user-reset-password-dialog')).not.toBeInTheDocument());
  });

  it('keeps the lifecycle dialog open and shows the server refusal when a root admin cannot inactivate the account', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: true, isActive: true });
    disableUserMock.mockResolvedValue({
      error: {
        error: {
          code: 'ACCOUNT_LAST_ROOT_ADMIN',
          message: 'This is the only root admin. Promote another root admin before deactivating the account.',
        },
      },
    });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-lifecycle'));
    const dialog = await screen.findByTestId('root-admin-user-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-lifecycle'));

    expect(await within(dialog).findByText(/only root admin/i)).toBeVisible();
    expect(screen.getByTestId('root-admin-user-lifecycle-dialog')).toBeVisible();
  });

  it('deletes with the account email when the root admin types it in another case or with spaces', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false, isActive: false });
    deleteUserMock.mockResolvedValue({ data: { success: true } });

    renderUserPage('/manage/users/user-2');

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

  it('shows an error state when a root admin opens a user who cannot be read', async () => {

    renderUserPage('/manage/users/user-missing');

    expect(await screen.findByTestId('root-admin-user-page-error')).toBeVisible();
  });

  it('reactivates an inactive user and closes the confirm dialog', async () => {
    primeAdminUserDetail({ id: 'user-2', isActive: false });
    enableUserMock.mockResolvedValue({ data: { user: buildViewedUser({ id: 'user-2', isActive: true }) } });

    renderUserPage('/manage/users/user-2');

    expect(await screen.findByTestId('root-admin-user-inactive-banner')).toBeVisible();
    fireEvent.click(screen.getByTestId('root-admin-user-open-lifecycle'));
    await screen.findByTestId('root-admin-user-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-lifecycle'));

    await waitFor(() => expect(enableUserMock).toHaveBeenCalledWith({ path: { userId: 'user-2' } }));
    await waitFor(() => expect(screen.queryByTestId('root-admin-user-lifecycle-dialog')).not.toBeInTheDocument());
  });

  it('shows the server refusal in the role dialog when demoting the last root admin', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: true });
    setUserRootAdminMock.mockResolvedValue({
      error: { error: { code: 'LAST_ROOT_ADMIN', message: 'Cannot remove the last remaining root admin.' } },
    });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-role'));
    const dialog = await screen.findByTestId('root-admin-user-role-dialog');
    fireEvent.click(screen.getByTestId('root-admin-user-submit-role'));

    expect(await within(dialog).findByText(/last remaining root admin/)).toBeVisible();
  });

  it('keeps the delete button disabled until the confirmation matches the viewed user\'s email', async () => {
    primeAdminUserDetail({ id: 'user-2', isActive: false });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-delete'));
    await screen.findByTestId('root-admin-user-delete-dialog');
    fireEvent.change(screen.getByTestId('root-admin-user-delete-confirmation'), { target: { value: 'someone@example.com' } });

    expect(screen.getByTestId('root-admin-user-submit-delete')).toBeDisabled();
    expect(deleteUserMock).not.toHaveBeenCalled();
  });

  it('leaves the role unchanged when the role change is cancelled', async () => {
    primeAdminUserDetail({ id: 'user-2', isRootAdmin: false });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-role'));
    const dialog = await screen.findByTestId('root-admin-user-role-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId('root-admin-user-role-dialog')).not.toBeInTheDocument());
    expect(setUserRootAdminMock).not.toHaveBeenCalled();
  });

  it('returns to the users list after deleting an inactive account', async () => {
    primeAdminUserDetail({ id: 'user-2', isActive: false });
    deleteUserMock.mockResolvedValue({ data: { success: true } });

    renderUserPage('/manage/users/user-2');

    await screen.findByTestId('root-admin-user-page');
    fireEvent.click(screen.getByTestId('root-admin-user-open-delete'));
    await screen.findByTestId('root-admin-user-delete-dialog');
    fireEvent.change(screen.getByTestId('root-admin-user-delete-confirmation'), {
      target: { value: 'target@example.com' },
    });
    fireEvent.click(screen.getByTestId('root-admin-user-submit-delete'));

    expect(await screen.findByTestId('users-list')).toBeInTheDocument();
  });
});
