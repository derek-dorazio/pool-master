import { render, screen } from '@testing-library/react';
import { ProfilePage } from './profile-page';

const useProfile = vi.fn();

vi.mock('./hooks/use-profile', () => ({
  useProfile: (...args: unknown[]) => useProfile(...args),
}));

vi.mock('./profile-form', () => ({
  ProfileForm: () => <div data-testid="profile-form">Profile Form</div>,
}));

vi.mock('./password-change-form', () => ({
  PasswordChangeForm: () => <div data-testid="password-change-form">Password Change Form</div>,
}));

vi.mock('./linked-accounts', () => ({
  LinkedAccounts: () => <div data-testid="linked-accounts">Linked Accounts</div>,
}));

describe('ProfilePage', () => {
  beforeEach(() => {
    useProfile.mockReturnValue({
      data: { authProvider: 'email' },
    });
  });

  it('shows password controls for email-auth users', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: 'Profile', level: 1 })).toBeInTheDocument();
    expect(screen.getByTestId('profile-form')).toBeInTheDocument();
    expect(screen.getByTestId('password-change-form')).toBeInTheDocument();
    expect(screen.getByTestId('linked-accounts')).toBeInTheDocument();
  });

  it('hides the password form for social-auth users', () => {
    useProfile.mockReturnValue({
      data: { authProvider: 'google' },
    });

    render(<ProfilePage />);

    expect(screen.getByTestId('profile-form')).toBeInTheDocument();
    expect(screen.queryByTestId('password-change-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('linked-accounts')).toBeInTheDocument();
  });
});
