import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AUTH_ME_QUERY_KEY, type AuthSessionUser } from '@/features/auth/auth-session-cache';
import { mockApi } from '@/test/msw-api';
import { buildCurrentUser, primeMyAccount, primeMyAccountThenRefetches, renderMyAccount } from '@/test/my-account-harness';

async function openDelete() {
  fireEvent.click(await screen.findByTestId('my-account-delete-open'));
  return screen.findByTestId('my-account-delete-dialog');
}

describe('My account › Account', () => {
  it('offers to hide an active account from its leagues, and keeps Delete locked with a (?) saying why', async () => {
    primeMyAccount();

    renderMyAccount();

    const row = await screen.findByTestId('my-account-lifecycle');
    expect(row).toHaveTextContent('Hide me from my leagues');
    expect(within(row).getByRole('button', { name: 'Inactivate' })).toBeEnabled();
    expect(screen.getByTestId('my-account-delete-open')).toBeDisabled();
    expect(screen.getByTestId('my-account-delete-help')).toBeInTheDocument();
  });

  it('inactivates the account after the member confirms, and marks the page Inactive without a reload', async () => {
    const inactive = buildCurrentUser({ isActive: false });
    primeMyAccountThenRefetches(inactive);
    mockApi.disableUser.mockResolvedValue({ data: { user: inactive } });

    const { queryClient } = renderMyAccount();

    fireEvent.click(await screen.findByTestId('my-account-lifecycle-open'));
    await screen.findByTestId('my-account-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('my-account-inactivate'));

    await waitFor(() => expect(mockApi.disableUser).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Account inactivated')).toBeVisible();
    expect(await screen.findByTestId('my-account-inactive-status')).toBeVisible();
    expect(screen.getByTestId('my-account-lifecycle')).toHaveTextContent('Show me in my leagues');
    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({ isActive: false });
  });

  it('reactivates an inactive account after the member confirms', async () => {
    const active = buildCurrentUser();
    primeMyAccountThenRefetches(active, { isActive: false });
    mockApi.enableUser.mockResolvedValue({ data: { user: active } });

    renderMyAccount();

    fireEvent.click(await screen.findByRole('button', { name: 'Reactivate' }));
    await screen.findByTestId('my-account-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('my-account-reactivate'));

    expect(await screen.findByText('Account reactivated')).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('my-account-inactive-status')).not.toBeInTheDocument());
  });

  it('shows the server reason and keeps the account active when inactivating fails', async () => {
    primeMyAccount();
    mockApi.disableUser.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The account could not be inactivated.' } },
    });

    renderMyAccount();

    fireEvent.click(await screen.findByTestId('my-account-lifecycle-open'));
    const dialog = await screen.findByTestId('my-account-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('my-account-inactivate'));

    expect(await within(dialog).findByText('The account could not be inactivated.')).toBeVisible();
    expect(screen.queryByTestId('my-account-inactive-status')).not.toBeInTheDocument();
  });

  it('shows the server reason and keeps the account inactive when reactivating fails, and starts clean next time', async () => {
    primeMyAccount({ isActive: false });
    mockApi.enableUser.mockResolvedValue({
      error: { error: { code: 'INTERNAL_ERROR', message: 'The account could not be reactivated.' } },
    });

    renderMyAccount();

    fireEvent.click(await screen.findByTestId('my-account-lifecycle-open'));
    const dialog = await screen.findByTestId('my-account-lifecycle-dialog');
    fireEvent.click(screen.getByTestId('my-account-reactivate'));

    expect(await within(dialog).findByText('The account could not be reactivated.')).toBeVisible();
    expect(screen.getByTestId('my-account-inactive-status')).toBeVisible();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('my-account-lifecycle-dialog')).not.toBeInTheDocument());
    fireEvent.click(screen.getByTestId('my-account-lifecycle-open'));
    expect(await screen.findByTestId('my-account-lifecycle-dialog')).not.toHaveTextContent('could not be reactivated');
  });

  it('deletes an inactive account with its own email, then signs out, returns home and toasts', async () => {
    primeMyAccount({ isActive: false });
    mockApi.deleteUser.mockResolvedValue({ data: { success: true } });
    mockApi.logoutUser.mockResolvedValue({ data: { success: true } });

    renderMyAccount();

    const dialog = await openDelete();
    // The box says which address to type, and the action waits for it.
    expect(dialog).toHaveTextContent('Enter derek@example.com exactly to confirm.');
    expect(screen.getByTestId('my-account-delete-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), { target: { value: 'derek@example.com' } });
    fireEvent.click(screen.getByTestId('my-account-delete-submit'));

    expect(await screen.findByTestId('root-route')).toBeInTheDocument();
    expect(mockApi.deleteUser).toHaveBeenCalledWith(expect.objectContaining({ path: { userId: 'me' }, body: { email: 'derek@example.com' } }));
    expect(mockApi.logoutUser).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Your account was deleted')).toBeVisible();
  });

  it('keeps the delete dialog open with the reason when league data still blocks the delete', async () => {
    primeMyAccount({ isActive: false });
    mockApi.deleteUser.mockResolvedValue({
      error: { error: { code: 'ACCOUNT_DELETE_DEPENDENCIES_EXIST', message: 'Account still owns or belongs to league-scoped data.' } },
    });

    renderMyAccount();

    const dialog = await openDelete();
    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), { target: { value: 'derek@example.com' } });
    fireEvent.click(screen.getByTestId('my-account-delete-submit'));

    expect(await within(dialog).findByText(/league-scoped data/)).toBeVisible();
    expect(screen.queryByText('Your account was deleted')).not.toBeInTheDocument();
  });

  it.each([
    ['Cancel', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
  ])('closes the delete dialog on %s and starts over with an empty confirmation next time', async (_how, close) => {
    primeMyAccount({ isActive: false });

    renderMyAccount();

    const dialog = await openDelete();
    fireEvent.change(screen.getByTestId('my-account-delete-confirmation'), { target: { value: 'derek@' } });
    close(dialog);
    await waitFor(() => expect(screen.queryByTestId('my-account-delete-dialog')).not.toBeInTheDocument());

    await openDelete();
    expect(screen.getByTestId('my-account-delete-confirmation')).toHaveValue('');
    expect(mockApi.deleteUser).not.toHaveBeenCalled();
  });
});
