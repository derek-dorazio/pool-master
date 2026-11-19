import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CustomerUserDto, UserDto } from '@/lib/api';
import { AuthProvider } from '@/features/auth/auth-provider';
import { bindApiMocks } from '@/test/msw-api';
import { applyEnumFilter } from '@/test/data-grid-filters';
import { RootAdminCustomerUsersPage } from './root-admin-customer-users-page';

// /manage/customers/users: every user in one grid, each opening its dialog with Details, the
// account actions behind their confirms, and Edit for the name and the role.

const mocks = vi.hoisted(() => ({
  listCustomerUsers: vi.fn(),
  getUser: vi.fn(),
  refreshToken: vi.fn(),
  resetUserPassword: vi.fn(),
  disableUser: vi.fn(),
  enableUser: vi.fn(),
  deleteUser: vi.fn(),
  updateUserProfile: vi.fn(),
  setUserRootAdmin: vi.fn(),
}));

bindApiMocks(mocks);

const DIALOG = 'root-admin-customer-user-dialog';

function customer(overrides: Partial<CustomerUserDto> = {}): CustomerUserDto {
  return {
    id: 'user-2',
    email: 'target@example.com',
    username: 'target-user',
    firstName: 'Target',
    lastName: 'User',
    isRootAdmin: false,
    isActive: true,
    leagues: [
      { id: 'league-a', leagueCode: 'AARD1', name: 'Aardvark League' },
      { id: 'league-b', leagueCode: 'OFFICE1', name: 'Office Pool' },
    ],
    joinedAt: '2026-04-13T00:00:00.000Z',
    lastSignInAt: '2026-11-18T15:30:00.000Z',
    ...overrides,
  };
}

const SIGNED_IN_ADMIN: UserDto = {
  id: 'admin-1',
  email: 'admin@example.com',
  username: 'admin',
  firstName: 'Root',
  lastName: 'Admin',
  isActive: true,
  isRootAdmin: true,
  authProvider: 'email',
  timezone: 'America/New_York',
  locale: 'en-US',
  timeFormat: '12H',
  createdAt: '2026-01-01T00:00:00.000Z',
};

function seed(users: CustomerUserDto[] = [customer()]) {
  mocks.refreshToken.mockResolvedValue({ data: null });
  mocks.getUser.mockResolvedValue({ data: { user: SIGNED_IN_ADMIN } });
  mocks.listCustomerUsers.mockResolvedValue({ data: { users } });
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(entry = '/manage/customers/users') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route element={<><RootAdminCustomerUsersPage /><LocationProbe /></>} path="/manage/customers/users" />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>,
  );
}

async function openUser(id = 'user-2') {
  fireEvent.click(within(await screen.findByTestId(`root-admin-customer-user-${id}`)).getByRole('button', { name: 'Open details' }));
  return screen.findByTestId(DIALOG);
}

describe('RootAdminCustomerUsersPage', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists every user with name, email, role, status, league count and joined date, under the Customers tabs with Users lit', async () => {
    seed([customer(), customer({ id: 'user-3', email: 'gone@example.com', firstName: 'Gone', lastName: 'Away', isActive: false, isRootAdmin: true, leagues: [] })]);
    renderPage();

    const target = within(await screen.findByTestId('root-admin-customer-user-user-2'));
    expect(target.getByText('Target User')).toBeInTheDocument();
    expect(target.getByText('target@example.com')).toBeInTheDocument();
    expect(target.getByText('Member')).toBeInTheDocument();
    expect(target.getByText('Active')).toBeInTheDocument();
    expect(target.getByText('2')).toBeInTheDocument();
    const gone = within(screen.getByTestId('root-admin-customer-user-user-3'));
    expect(gone.getByText('Root admin')).toBeInTheDocument();
    expect(gone.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getByTestId('root-admin-customers-tab-users')).toHaveAttribute('aria-current', 'page');
  });

  it('filters the loaded users by status in the grid, without asking the server again', async () => {
    seed([customer(), customer({ id: 'user-3', email: 'gone@example.com', isActive: false })]);
    renderPage();
    await screen.findByTestId('root-admin-customer-user-user-2');

    applyEnumFilter('root-admin-customer-users-filter-status', ['Inactive']);

    expect(screen.queryByTestId('root-admin-customer-user-user-2')).not.toBeInTheDocument();
    expect(screen.getByTestId('root-admin-customer-user-user-3')).toBeInTheDocument();
    expect(mocks.listCustomerUsers).toHaveBeenCalledTimes(1);
  });

  it('opens a user in view mode with Details, the three account actions, and Close and Edit, naming the user in the address', async () => {
    seed();
    renderPage();

    const dialog = within(await openUser());
    const details = within(screen.getByTestId(`${DIALOG}-details`));
    expect(details.getByTestId(`${DIALOG}-name`)).toHaveTextContent('Target User');
    expect(details.getByTestId(`${DIALOG}-email`)).toHaveTextContent('target@example.com');
    expect(details.getByTestId(`${DIALOG}-role`)).toHaveTextContent('Member');
    expect(details.getByTestId(`${DIALOG}-status`)).toHaveTextContent('Active');
    expect(details.getByTestId(`${DIALOG}-leagues`)).toHaveTextContent('Aardvark League, Office Pool');
    expect(details.getByTestId(`${DIALOG}-joined`)).not.toBeEmptyDOMElement();
    expect(details.getByTestId(`${DIALOG}-last-sign-in`)).not.toHaveTextContent('Not recorded yet');
    const actions = within(screen.getByTestId(`${DIALOG}-actions`));
    expect(actions.getByTestId(`${DIALOG}-open-reset-password`)).toBeEnabled();
    expect(actions.getByTestId(`${DIALOG}-open-lifecycle`)).toHaveTextContent('Deactivate');
    expect(dialog.getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(dialog.getByTestId(`${DIALOG}-edit`)).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/manage/customers/users?user=user-2');
  });

  it('opens the user named in the address, so a link from elsewhere lands on their dialog, and Close drops it from the address', async () => {
    seed();
    renderPage('/manage/customers/users?user=user-2');

    const dialog = within(await screen.findByTestId(DIALOG));
    expect(screen.getByTestId(`${DIALOG}-name`)).toHaveTextContent('Target User');

    fireEvent.click(dialog.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
    expect(screen.getByTestId('location')).toHaveTextContent(/^\/manage\/customers\/users$/);
  });

  it('says a user\'s last sign-in is not recorded yet, and lists no leagues, when they have neither', async () => {
    seed([customer({ lastSignInAt: null, leagues: [] })]);
    renderPage();

    await openUser();
    expect(screen.getByTestId(`${DIALOG}-last-sign-in`)).toHaveTextContent('Not recorded yet');
    expect(screen.getByTestId(`${DIALOG}-leagues`)).toHaveTextContent('None');
  });

  it('keeps Delete disabled on an active account, saying to deactivate first', async () => {
    seed();
    renderPage();

    await openUser();
    expect(screen.getByTestId(`${DIALOG}-open-delete`)).toBeDisabled();
    expect(screen.getByTestId(`${DIALOG}-action-delete`)).toHaveTextContent('Deactivate the account first');
  });

  it('resets a password only after its confirm, then shows the temporary password in the dialog', async () => {
    seed();
    mocks.resetUserPassword.mockResolvedValue({ data: { temporaryPassword: 'Temp-Pass-123' } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-reset-password`));
    expect(await screen.findByTestId(`${DIALOG}-reset-password`)).toBeInTheDocument();
    expect(mocks.resetUserPassword).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId(`${DIALOG}-submit-reset-password`));

    expect(await screen.findByTestId(`${DIALOG}-temp-password`)).toHaveTextContent('Temp-Pass-123');
    expect(mocks.resetUserPassword).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'user-2' } }));
    await waitFor(() => expect(screen.queryByTestId(`${DIALOG}-reset-password`)).not.toBeInTheDocument());
  });

  it('keeps the reset confirm open with the reason when the reset is refused', async () => {
    seed();
    mocks.resetUserPassword.mockResolvedValue({ error: { error: { code: 'USER_NOT_FOUND', message: 'User was not found.' } } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-reset-password`));
    fireEvent.click(await screen.findByTestId(`${DIALOG}-submit-reset-password`));

    expect(await screen.findByText('USER_NOT_FOUND: User was not found.')).toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-reset-password`)).toBeInTheDocument();
  });

  it('cancels a confirm without calling the server', async () => {
    seed();
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-lifecycle`));
    const confirm = within(await screen.findByTestId(`${DIALOG}-lifecycle`));
    fireEvent.click(confirm.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByTestId(`${DIALOG}-lifecycle`)).not.toBeInTheDocument());
    expect(mocks.disableUser).not.toHaveBeenCalled();
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
  });

  it('deactivates an active account after its confirm and reloads the users', async () => {
    seed();
    mocks.disableUser.mockResolvedValue({ data: { user: { ...SIGNED_IN_ADMIN, id: 'user-2', isActive: false } } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-lifecycle`));
    expect(await screen.findByText('Deactivate Target User?')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`${DIALOG}-submit-lifecycle`));

    await waitFor(() => expect(mocks.disableUser).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'user-2' } })));
    await waitFor(() => expect(mocks.listCustomerUsers).toHaveBeenCalledTimes(2));
    expect(mocks.enableUser).not.toHaveBeenCalled();
  });

  it('keeps the deactivate confirm open with the reason when it is refused, as for the last root admin', async () => {
    seed();
    mocks.disableUser.mockResolvedValue({ error: { error: { code: 'LAST_ROOT_ADMIN', message: 'The last root admin cannot be deactivated.' } } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-lifecycle`));
    fireEvent.click(await screen.findByTestId(`${DIALOG}-submit-lifecycle`));

    expect(await screen.findByText('LAST_ROOT_ADMIN: The last root admin cannot be deactivated.')).toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-lifecycle`)).toBeInTheDocument();
  });

  it('reactivates an inactive account after its confirm', async () => {
    seed([customer({ isActive: false })]);
    mocks.enableUser.mockResolvedValue({ data: { user: { ...SIGNED_IN_ADMIN, id: 'user-2' } } });
    renderPage();

    await openUser();
    expect(screen.getByTestId(`${DIALOG}-open-lifecycle`)).toHaveTextContent('Reactivate');
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-lifecycle`));
    fireEvent.click(await screen.findByTestId(`${DIALOG}-submit-lifecycle`));

    await waitFor(() => expect(mocks.enableUser).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'user-2' } })));
    expect(mocks.disableUser).not.toHaveBeenCalled();
  });

  it('deletes an inactive account only once its email is typed, ignoring case and spaces, then closes the dialog', async () => {
    seed([customer({ isActive: false })]);
    mocks.deleteUser.mockResolvedValue({ data: { success: true } });
    renderPage();

    await openUser();
    expect(screen.getByTestId(`${DIALOG}-open-delete`)).toBeEnabled();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-delete`));
    const submit = await screen.findByTestId(`${DIALOG}-submit-delete`);
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId(`${DIALOG}-delete-confirmation`), { target: { value: 'someone@example.com' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByTestId(`${DIALOG}-delete-confirmation`), { target: { value: '  Target@Example.com ' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);

    await waitFor(() => expect(mocks.deleteUser).toHaveBeenCalledWith(expect.objectContaining({
      path: { userId: 'user-2' },
      body: { email: 'target@example.com' },
    })));
    await waitFor(() => expect(screen.queryByTestId(DIALOG)).not.toBeInTheDocument());
  });

  it('keeps the delete confirm open with the reason when the delete is refused', async () => {
    seed([customer({ isActive: false })]);
    mocks.deleteUser.mockResolvedValue({ error: { error: { code: 'USER_DELETE_BLOCKED', message: 'This account still owns a league.' } } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-open-delete`));
    fireEvent.change(await screen.findByTestId(`${DIALOG}-delete-confirmation`), { target: { value: 'target@example.com' } });
    fireEvent.click(screen.getByTestId(`${DIALOG}-submit-delete`));

    expect(await screen.findByText('USER_DELETE_BLOCKED: This account still owns a league.')).toBeInTheDocument();
    expect(screen.getByTestId(DIALOG)).toBeInTheDocument();
  });

  it('saves a changed name with the account\'s own email and a changed role, then returns to view mode', async () => {
    seed();
    mocks.updateUserProfile.mockResolvedValue({ data: { user: { ...SIGNED_IN_ADMIN, id: 'user-2' } } });
    mocks.setUserRootAdmin.mockResolvedValue({ data: { success: true } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-edit`));
    fireEvent.change(screen.getByTestId(`${DIALOG}-first-name-input`), { target: { value: ' Tara ' } });
    fireEvent.change(screen.getByTestId(`${DIALOG}-role-input`), { target: { value: 'ROOT_ADMIN' } });
    await waitFor(() => expect(screen.getByTestId(`${DIALOG}-save`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`${DIALOG}-save`));

    await waitFor(() => expect(mocks.setUserRootAdmin).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'user-2' }, body: { isRootAdmin: true } })));
    expect(mocks.updateUserProfile).toHaveBeenCalledWith(expect.objectContaining({
      path: { userId: 'user-2' },
      body: { email: 'target@example.com', firstName: 'Tara', lastName: 'User' },
    }));
    expect(await screen.findByTestId(`${DIALOG}-edit`)).toBeInTheDocument();
  });

  it('sends only the role when the name is unchanged, and shows a refused save in the form', async () => {
    seed([customer({ isRootAdmin: true })]);
    mocks.setUserRootAdmin.mockResolvedValue({ error: { error: { code: 'LAST_ROOT_ADMIN', message: 'The last root admin cannot be removed.' } } });
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-edit`));
    fireEvent.change(screen.getByTestId(`${DIALOG}-role-input`), { target: { value: 'MEMBER' } });
    await waitFor(() => expect(screen.getByTestId(`${DIALOG}-save`)).toBeEnabled());
    fireEvent.click(screen.getByTestId(`${DIALOG}-save`));

    expect(await screen.findByText(/The last root admin cannot be removed\./)).toBeInTheDocument();
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
    expect(screen.getByTestId(`${DIALOG}-save`)).toBeInTheDocument();
  });

  it('refuses to save an empty first name', async () => {
    seed();
    renderPage();

    await openUser();
    fireEvent.click(screen.getByTestId(`${DIALOG}-edit`));
    fireEvent.change(screen.getByTestId(`${DIALOG}-first-name-input`), { target: { value: '  ' } });

    expect(await screen.findByText('Enter a first name.')).toBeInTheDocument();
    expect(screen.getByTestId(`${DIALOG}-save`)).toBeDisabled();
  });

  it('cancels an edit back to the view, unsaved', async () => {
    seed();
    renderPage();

    const dialog = within(await openUser());
    fireEvent.click(screen.getByTestId(`${DIALOG}-edit`));
    fireEvent.change(screen.getByTestId(`${DIALOG}-last-name-input`), { target: { value: 'Changed' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByTestId(`${DIALOG}-name`)).toHaveTextContent('Target User');
    expect(mocks.updateUserProfile).not.toHaveBeenCalled();
  });

  it('gives a root admin\'s own row a link to My account instead of the account actions, and locks their own role', async () => {
    seed([customer({ id: 'admin-1', email: 'admin@example.com', firstName: 'Root', lastName: 'Admin', isRootAdmin: true })]);
    renderPage();

    await openUser('admin-1');
    // The signed-in account loads after the grid; wait for it to mark the row as theirs.
    expect(await screen.findByTestId(`${DIALOG}-my-account`)).toHaveAttribute('href', '/my-account');
    expect(screen.queryByTestId(`${DIALOG}-open-reset-password`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`${DIALOG}-open-delete`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`${DIALOG}-edit`));
    expect(screen.getByTestId(`${DIALOG}-role-input`)).toBeDisabled();
  });
});
