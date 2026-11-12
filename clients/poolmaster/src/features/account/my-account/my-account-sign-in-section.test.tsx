import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { mockApi } from '@/test/msw-api';
import { primeMyAccount, renderMyAccount } from '@/test/my-account-harness';

async function openPasswordDialog() {
  fireEvent.click(await screen.findByRole('button', { name: 'Change password' }));
  return screen.findByTestId('my-account-password-dialog');
}

function typePasswords(current: string, next: string) {
  fireEvent.change(screen.getByTestId('my-account-current-password'), { target: { value: current } });
  fireEvent.change(screen.getByTestId('my-account-new-password'), { target: { value: next } });
  fireEvent.change(screen.getByTestId('my-account-confirm-password'), { target: { value: next } });
}

describe('My account › Sign-in', () => {
  it('sends the password change with the three fields typed, then closes the dialog and toasts', async () => {
    primeMyAccount();
    mockApi.changeUserPassword.mockResolvedValue({ data: { success: true } });

    renderMyAccount();

    await openPasswordDialog();
    typePasswords('OldPassword1', 'NewPassword1');
    fireEvent.click(screen.getByTestId('my-account-password-save'));

    await waitFor(() =>
      expect(mockApi.changeUserPassword).toHaveBeenCalledWith(expect.objectContaining({
        path: { userId: 'me' },
        body: { currentPassword: 'OldPassword1', newPassword: 'NewPassword1', confirmNewPassword: 'NewPassword1' },
      })),
    );
    expect(await screen.findByText('Password changed')).toBeVisible();
    expect(screen.queryByTestId('my-account-password-dialog')).not.toBeInTheDocument();
  });

  it('keeps the dialog open with the server refusal when the current password is wrong', async () => {
    primeMyAccount();
    mockApi.changeUserPassword.mockResolvedValue({
      error: { error: { code: 'INVALID_CURRENT_PASSWORD', message: 'Current password is incorrect.' } },
    });

    renderMyAccount();

    const dialog = await openPasswordDialog();
    typePasswords('WrongPassword1', 'NewPassword1');
    fireEvent.click(screen.getByTestId('my-account-password-save'));

    expect(await within(dialog).findByText('Current password is incorrect.')).toBeVisible();
  });

  it('opens with empty boxes again after Escape closes it', async () => {
    primeMyAccount();

    renderMyAccount();

    const dialog = await openPasswordDialog();
    typePasswords('OldPassword1', 'NewPassword1');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('my-account-password-dialog')).not.toBeInTheDocument());

    await openPasswordDialog();
    expect(screen.getByTestId('my-account-current-password')).toHaveValue('');
    expect(mockApi.changeUserPassword).not.toHaveBeenCalled();
  });
});
