import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProfileForm } from './profile-form';

const {
  mockUseProfile,
  mockUseUpdateProfile,
  mockProfile,
} = vi.hoisted(() => {
  const mockUseProfile = vi.fn();
  const mockUseUpdateProfile = vi.fn();
  const mockProfile = {
    id: 'user-1',
    displayName: 'Dave O',
    email: 'dave@example.com',
    authProvider: 'email' as const,
  };

  return { mockUseProfile, mockUseUpdateProfile, mockProfile };
});

vi.mock('./hooks/use-profile', () => ({
  useProfile: () =>
    mockUseProfile() ?? {
      data: mockProfile,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    },
  useUpdateProfile: () =>
    mockUseUpdateProfile() ?? {
      mutate: vi.fn(),
      isPending: false,
    },
}));

describe('ProfileForm', () => {
  beforeEach(() => {
    mockUseProfile.mockReset();
    mockUseUpdateProfile.mockReset();
  });

  it('renders form fields (displayName, email)', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('populates fields with profile data', () => {
    render(<ProfileForm />);

    expect(screen.getByLabelText('Display Name')).toHaveValue('Dave O');
    expect(screen.getByLabelText('Email')).toHaveValue('dave@example.com');
  });

  it('sends trimmed profile updates when values change', async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    mockUseUpdateProfile.mockReturnValue({ mutate, isPending: false });

    render(<ProfileForm />);

    await user.clear(screen.getByLabelText('Display Name'));
    await user.type(screen.getByLabelText('Display Name'), '  Dave Updated  ');
    await user.clear(screen.getByLabelText('Email'));
    await user.type(screen.getByLabelText('Email'), 'updated@example.com');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(mutate).toHaveBeenCalledWith({
      displayName: 'Dave Updated',
      email: 'updated@example.com',
    });
  });

  it('save button is disabled when form is clean (no changes)', () => {
    render(<ProfileForm />);

    const saveButton = screen.getByRole('button', { name: /save changes/i });
    expect(saveButton).toBeDisabled();
  });

  it('renders read-only email state for social-auth users', () => {
    mockUseProfile.mockReturnValue({
      data: {
        ...mockProfile,
        authProvider: 'google',
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ProfileForm />);

    expect(screen.getByLabelText('Email')).toHaveAttribute('readOnly');
    expect(
      screen.getByText(/Email is managed by your Google account/i),
    ).toBeInTheDocument();
  });

  it('does not render the unsupported bio field', () => {
    render(<ProfileForm />);
    expect(screen.queryByLabelText('Bio')).not.toBeInTheDocument();
  });

  it('renders loading state when isLoading', () => {
    mockUseProfile.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: vi.fn(),
    });

    render(<ProfileForm />);

    expect(screen.getByText('Profile')).toBeInTheDocument();
    expect(screen.queryByLabelText('Display Name')).not.toBeInTheDocument();
  });
});
