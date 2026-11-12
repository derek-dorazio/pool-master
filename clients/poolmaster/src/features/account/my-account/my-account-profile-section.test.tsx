import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AUTH_ME_QUERY_KEY, type AuthSessionUser } from '@/features/auth/auth-session-cache';
import { mockApi } from '@/test/msw-api';
import { buildCurrentUser, primeMyAccount, primeMyAccountThenRefetches, renderMyAccount } from '@/test/my-account-harness';

async function openProfileDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Edit Profile' }));
  return screen.findByTestId('my-account-profile-dialog');
}

describe('My account › Profile', () => {
  it('shows the name, email and username as they stand', async () => {
    primeMyAccount();

    renderMyAccount();

    expect(await screen.findByTestId('my-account-profile-name')).toHaveTextContent('Derek Dorazio');
    expect(screen.getByTestId('my-account-profile-email')).toHaveTextContent('derek@example.com');
    expect(screen.getByTestId('my-account-profile-username')).toHaveTextContent('ddorazio');
  });

  it('opens one dialog holding the name, email and username as they stand', async () => {
    primeMyAccount();

    renderMyAccount();

    await openProfileDialog();
    expect(screen.getByTestId('my-account-first-name')).toHaveValue('Derek');
    expect(screen.getByTestId('my-account-last-name')).toHaveValue('Dorazio');
    expect(screen.getByTestId('my-account-email')).toHaveValue('derek@example.com');
    expect(screen.getByTestId('my-account-username')).toHaveValue('ddorazio');
  });

  it('saves a changed name and email, trimmed and lower-cased, without touching the username, then closes and toasts', async () => {
    const updated = buildCurrentUser({ email: 'updated@example.com', firstName: 'Updated', lastName: 'Person' });
    primeMyAccountThenRefetches(updated);
    mockApi.updateUserProfile.mockResolvedValue({ data: { user: updated } });

    const { queryClient } = renderMyAccount();

    await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-first-name'), { target: { value: 'Updated' } });
    fireEvent.change(screen.getByTestId('my-account-last-name'), { target: { value: 'Person' } });
    fireEvent.change(screen.getByTestId('my-account-email'), { target: { value: ' Updated@Example.com ' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    await waitFor(() =>
      expect(mockApi.updateUserProfile).toHaveBeenCalledWith(expect.objectContaining({
        path: { userId: 'me' },
        body: { email: 'updated@example.com', firstName: 'Updated', lastName: 'Person' },
      })),
    );
    expect(await screen.findByText('Profile saved')).toBeVisible();
    expect(screen.queryByTestId('my-account-profile-dialog')).not.toBeInTheDocument();
    expect(mockApi.updateUserUsername).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('my-account-profile-name')).toHaveTextContent('Updated Person'));
    expect(queryClient.getQueryData<AuthSessionUser>(AUTH_ME_QUERY_KEY)).toMatchObject({ email: 'updated@example.com' });
  });

  it('saves a changed username alone, lower-cased, and shows it on the page', async () => {
    const updated = buildCurrentUser({ username: 'derekd' });
    primeMyAccountThenRefetches(updated);
    mockApi.updateUserUsername.mockResolvedValue({ data: { user: updated } });

    renderMyAccount();

    await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-username'), { target: { value: ' DerekD ' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    await waitFor(() =>
      expect(mockApi.updateUserUsername).toHaveBeenCalledWith(expect.objectContaining({
        path: { userId: 'me' },
        body: { username: 'derekd' },
      })),
    );
    expect(mockApi.updateUserProfile).not.toHaveBeenCalled();
    expect(await screen.findByText('Profile saved')).toBeVisible();
    await waitFor(() => expect(screen.getByTestId('my-account-profile-username')).toHaveTextContent('derekd'));
  });

  it('saves both halves when the name and the username changed', async () => {
    const renamed = buildCurrentUser({ firstName: 'Del' });
    primeMyAccountThenRefetches(buildCurrentUser({ firstName: 'Del', username: 'del' }));
    mockApi.updateUserProfile.mockResolvedValue({ data: { user: renamed } });
    mockApi.updateUserUsername.mockResolvedValue({ data: { user: { ...renamed, username: 'del' } } });

    renderMyAccount();

    await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-first-name'), { target: { value: 'Del' } });
    fireEvent.change(screen.getByTestId('my-account-username'), { target: { value: 'del' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    expect(await screen.findByText('Profile saved')).toBeVisible();
    expect(mockApi.updateUserProfile).toHaveBeenCalledTimes(1);
    expect(mockApi.updateUserUsername).toHaveBeenCalledTimes(1);
  });

  it('closes without a call when nothing changed', async () => {
    primeMyAccount();

    renderMyAccount();

    await openProfileDialog();
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    expect(await screen.findByText('Profile saved')).toBeVisible();
    expect(mockApi.updateUserProfile).not.toHaveBeenCalled();
    expect(mockApi.updateUserUsername).not.toHaveBeenCalled();
  });

  it('shows the email problem under the field and sends nothing when the email is not an address', async () => {
    primeMyAccount();

    renderMyAccount();

    await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    expect(await screen.findByText(/invalid email/i)).toBeVisible();
    expect(mockApi.updateUserProfile).not.toHaveBeenCalled();
  });

  it('keeps the dialog open with the server reason when the username is taken', async () => {
    primeMyAccount();
    mockApi.updateUserUsername.mockResolvedValue({
      error: { error: { code: 'ACCOUNT_USERNAME_TAKEN', message: 'That username is already taken. Choose another username.' } },
    });

    renderMyAccount();

    const dialog = await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-username'), { target: { value: 'taken' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    expect(await within(dialog).findByText('That username is already taken. Choose another username.')).toBeVisible();
    expect(screen.queryByText('Profile saved')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the server reason when saving the email fails, and sends no username', async () => {
    primeMyAccount();
    mockApi.updateUserProfile.mockResolvedValue({
      error: { error: { code: 'ACCOUNT_EMAIL_TAKEN', message: 'That email is already in use.' } },
    });

    renderMyAccount();

    const dialog = await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-email'), { target: { value: 'taken@example.com' } });
    fireEvent.change(screen.getByTestId('my-account-username'), { target: { value: 'newname' } });
    fireEvent.click(screen.getByTestId('my-account-profile-save'));

    expect(await within(dialog).findByText('That email is already in use.')).toBeVisible();
    expect(mockApi.updateUserUsername).not.toHaveBeenCalled();
  });

  it.each([
    ['Cancel', (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))],
    ['Escape', (dialog: HTMLElement) => fireEvent.keyDown(dialog, { key: 'Escape' })],
  ])('closes the dialog on %s without saving, and opens it next time on the saved values', async (_how, close) => {
    primeMyAccount();

    renderMyAccount();

    const dialog = await openProfileDialog();
    fireEvent.change(screen.getByTestId('my-account-first-name'), { target: { value: 'Typed' } });
    close(dialog);
    await waitFor(() => expect(screen.queryByTestId('my-account-profile-dialog')).not.toBeInTheDocument());

    await openProfileDialog();
    expect(screen.getByTestId('my-account-first-name')).toHaveValue('Derek');
    expect(mockApi.updateUserProfile).not.toHaveBeenCalled();
  });
});
