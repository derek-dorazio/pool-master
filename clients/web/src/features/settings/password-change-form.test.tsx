import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PasswordChangeForm } from './password-change-form';

const { mockUpdatePassword } = vi.hoisted(() => ({
  mockUpdatePassword: vi.fn(),
}));

vi.mock('./hooks/use-profile', () => ({
  useUpdatePassword: () => ({
    mutate: mockUpdatePassword,
    isPending: false,
  }),
}));

describe('PasswordChangeForm', () => {
  beforeEach(() => {
    mockUpdatePassword.mockReset();
    mockUpdatePassword.mockImplementation((_body, options) => {
      options?.onSuccess?.();
    });
  });

  it('shows "Change Password" button initially (form collapsed)', () => {
    render(<PasswordChangeForm />);
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument();
  });

  it('clicking the button reveals the form fields', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm />);

    await user.click(screen.getByRole('button', { name: 'Change Password' }));

    expect(screen.getByLabelText('Current Password')).toBeInTheDocument();
    expect(screen.getByLabelText('New Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm New Password')).toBeInTheDocument();
  });

  it('submits the current and new password then collapses the form on success', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm />);

    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'NewPass123!');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    await waitFor(() => {
      expect(mockUpdatePassword).toHaveBeenCalledWith(
        {
          currentPassword: 'oldpassword',
          newPassword: 'NewPass123!',
        },
        expect.any(Object),
      );
    });
    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change Password' })).toBeInTheDocument();
  });

  it('shows validation error when passwords do not match', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm />);

    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    await user.type(screen.getByLabelText('Current Password'), 'oldpassword');
    await user.type(screen.getByLabelText('New Password'), 'NewPass123!');
    await user.type(screen.getByLabelText('Confirm New Password'), 'DifferentPass');
    await user.click(screen.getByRole('button', { name: 'Update Password' }));

    expect(screen.getByText('Passwords do not match')).toBeInTheDocument();
  });

  it('shows password strength indicator when new password is entered', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm />);

    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    await user.type(screen.getByLabelText('New Password'), 'StrongP@ss1');

    expect(screen.getByText(/Strength:/)).toBeInTheDocument();
  });

  it('hides form when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<PasswordChangeForm />);

    await user.click(screen.getByRole('button', { name: 'Change Password' }));
    expect(screen.getByLabelText('Current Password')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Current Password')).not.toBeInTheDocument();
  });
});
